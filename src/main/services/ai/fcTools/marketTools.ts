/**
 * 织星（Weaver）社区模组 FC 工具四件套：
 *
 * - market_search_mods：CurseForge/Modrinth 双平台搜索（中文查询自动桥接翻译），只读咨询。
 * - market_mod_detail：模组详情（版本文件、gameVersions/loader、依赖、下载量），安装前必查。
 * - market_install_mod：把社区模组安装进当前整合包（自动装 required 依赖、冲突检测、
 *   写 .kunyu/modpack.json 来源记录供打包清单引用）。仅限整合包项目。
 * - market_list_installed：聚合 run/mods jar 与来源记录。
 *
 * EULA 边界：只下载社区 mod jar 到 run/mods，绝不触碰游戏本体；
 * CurseForge 默认走 MCIM 社区镜像（免 Key）；设置中的 marketplace.curseforgeApiKey
 * 填了用户自带 Key 时自动切回官方 API（计入作者下载归因）。
 */
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { getSection } from '../../settingsService'
import { getModDetail, installMod, searchMods } from '../../marketService'
import { auditDependencies, extractJarDeps } from '../../modpack/dependencyAudit'
import { createProvenanceRecorder, readSources } from '../../modpack/provenance'
import type { MarketProjectType, ModPlatform } from '../../../../shared/types/market'
import { PROJECT_TYPE_META } from '../../../../shared/types/market'
import type { RegisteredTool, ToolRegistryDeps } from '../toolRegistry'

const CLIP = 8000
function clip(text: string): string {
  return text.length <= CLIP ? text : `${text.slice(0, CLIP)}…（已截断）`
}
function asString(v: unknown): string {
  return typeof v === 'string' ? v : ''
}
function asPlatform(v: unknown): ModPlatform | null {
  return v === 'curseforge' || v === 'modrinth' ? v : null
}
function asProjectType(v: unknown): MarketProjectType {
  return v === 'datapack' || v === 'resourcepack' || v === 'shader' || v === 'modpack' ? v : 'mod'
}
function cfKey(): string {
  return getSection('marketplace').curseforgeApiKey
}

export function builtinMarketTools(deps: ToolRegistryDeps): RegisteredTool[] {
  const tools: RegisteredTool[] = []

  /* market_search_mods */
  tools.push({
    kind: 'chat',
    def: {
      type: 'function',
      function: {
        name: 'market_search_mods',
        description:
          '搜索 CurseForge/Modrinth 社区内容（模组/数据包/资源包/光影包/整合包）。做整合包时优先搜索社区 mod，不要从零造轮子。' +
          '中文查询会自动翻译桥接（如 钠→Sodium、光影→shaders）。' +
          '平台默认 Modrinth（API 开放、免密钥）；CurseForge 未配置 Key 时自动走 MCIM 社区镜像，配置 Key 后走官方 API。',
        parameters: {
          type: 'object',
          properties: {
            platform: { type: 'string', enum: ['curseforge', 'modrinth'], description: '缺省 modrinth' },
            query: { type: 'string', description: '关键词（中英文均可），如 性能优化、sodium、littlemaid' },
            projectType: {
              type: 'string',
              enum: ['mod', 'datapack', 'resourcepack', 'shader', 'modpack'],
              description: '内容类型，缺省 mod（模组）'
            },
            mcVersion: { type: 'string', description: 'Minecraft 版本过滤，如 1.20.1' },
            loader: { type: 'string', description: '加载器过滤（仅 mod 生效），如 fabric/forge/neoforge' },
            pageSize: { type: 'number', description: '每页数量，默认 20，上限 50' }
          },
          required: ['query']
        }
      }
    },
    execute: async (args) => {
      const platform = asPlatform(args['platform']) ?? 'modrinth'
      const projectType = asProjectType(args['projectType'])
      const query = asString(args['query']).trim()
      try {
        const result = await searchMods(
          {
            platform,
            query,
            projectType,
            loader: asString(args['loader']).trim() || undefined,
            gameVersion: asString(args['mcVersion']).trim() || undefined,
            pageSize: typeof args['pageSize'] === 'number' ? args['pageSize'] : undefined
          },
          cfKey()
        )
        const typeLabel = PROJECT_TYPE_META[projectType].label
        if (result.items.length === 0) {
          return { ok: true, text: `未找到匹配「${query}」的${typeLabel}（${platform}）`, data: { count: 0 } }
        }
        const lines = result.items.map(
          (m) =>
            `- ${m.name}（id=${m.id}，slug=${m.slug}，下载 ${m.downloads}，loaders=${m.loaders.join('/') || '?'}，MC=${m.gameVersions.slice(0, 5).join('/') || '?'}）\n  ${m.summary}`
        )
        const note = result.translatedTerms?.length
          ? `中文桥接：${result.translatedTerms.map((t) => `${t.zh}→${t.en}`).join('、')}\n`
          : ''
        return {
          ok: true,
          text: clip(`${note}共 ${result.total ?? result.items.length} 个结果（hasMore=${result.hasMore}）：\n${lines.join('\n')}`),
          data: { count: result.items.length, ids: result.items.map((m) => m.id) }
        }
      } catch (e) {
        return { ok: false, text: '', error: `搜索失败：${(e as Error).message}` }
      }
    }
  })

  /* market_mod_detail */
  tools.push({
    kind: 'chat',
    def: {
      type: 'function',
      function: {
        name: 'market_mod_detail',
        description:
          '查看模组详情：版本文件列表（含 gameVersions/loaders/依赖）、下载量、简介。' +
          'market_install_mod 安装前必须先用本工具核对目标 MC 版本与加载器是否匹配，并选定 versionId。',
        parameters: {
          type: 'object',
          properties: {
            platform: { type: 'string', enum: ['curseforge', 'modrinth'] },
            modId: { type: 'string', description: '平台内模组 id（market_search_mods 返回的 id）' },
            projectType: {
              type: 'string',
              enum: ['mod', 'datapack', 'resourcepack', 'shader', 'modpack'],
              description: '内容类型，缺省 mod；与搜索时保持一致'
            }
          },
          required: ['platform', 'modId']
        }
      }
    },
    execute: async (args) => {
      const platform = asPlatform(args['platform'])
      if (!platform) return { ok: false, text: '', error: 'platform 必须是 curseforge 或 modrinth' }
      const modId = asString(args['modId']).trim()
      if (!modId) return { ok: false, text: '', error: '缺少 modId' }
      try {
        const detail = await getModDetail(platform, modId, cfKey(), asProjectType(args['projectType']))
        const files = detail.files.slice(0, 10).map((f) => {
          const reqDeps = f.dependencies.filter((d) => d.relationType === 'required').length
          return (
            `- versionId=${f.id} ${f.versionNumber}（${f.fileName}，MC=${f.gameVersions.join('/') || '?'}，` +
            `loader=${f.loaders.join('/') || '?'}${reqDeps ? `，required 依赖 ${reqDeps} 个` : ''}）`
          )
        })
        const text =
          `${detail.name}（${platform}/${modId}，slug=${detail.slug}，下载 ${detail.downloads}）\n` +
          `${detail.summary}\n作者：${detail.authors.join('、') || '?'}　主页：${detail.url}\n` +
          `支持：MC=${detail.gameVersions.slice(0, 8).join('/') || '?'}，loaders=${detail.loaders.join('/') || '?'}\n` +
          `最新版本文件（最多列 10 个）：\n${files.join('\n') || '（无文件）'}`
        return { ok: true, text: clip(text), data: { slug: detail.slug, fileCount: detail.files.length } }
      } catch (e) {
        return { ok: false, text: '', error: `获取详情失败：${(e as Error).message}` }
      }
    }
  })

  /* market_install_mod */
  tools.push({
    kind: 'chat',
    def: {
      type: 'function',
      function: {
        name: 'market_install_mod',
        description:
          '把社区模组安装进当前整合包：下载 jar 到 run/mods、自动安装 required 依赖（深度上限 5）、' +
          '冲突检测、写入来源记录（.kunyu/modpack.json，打包时生成 CurseForge/Modrinth 清单引用）。' +
          '仅限整合包项目。默认不覆盖已有同模组文件——冲突时先告知用户，确认后再 overwrite=true。' +
          '安装前必须先用 market_mod_detail 核对 MC 版本与加载器。',
        parameters: {
          type: 'object',
          properties: {
            platform: { type: 'string', enum: ['curseforge', 'modrinth'] },
            modId: { type: 'string', description: '平台内模组 id' },
            versionId: { type: 'string', description: '版本文件 id（缺省取最新文件）' },
            includeDependencies: { type: 'boolean', description: '是否一并安装 required 依赖，默认 true' },
            overwrite: { type: 'boolean', description: '同模组已存在时是否覆盖，默认 false' }
          },
          required: ['platform', 'modId']
        }
      }
    },
    visibility: 'modpack',
    execute: async (args) => {
      const root = deps.projectRoot?.()
      if (!root) return { ok: false, text: '', error: '当前没有打开的项目' }
      const platform = asPlatform(args['platform'])
      if (!platform) return { ok: false, text: '', error: 'platform 必须是 curseforge 或 modrinth' }
      const modId = asString(args['modId']).trim()
      if (!modId) return { ok: false, text: '', error: '缺少 modId' }
      try {
        // 先取详情：选定文件并回显 gameVersions/loaders 供模型自检
        const detail = await getModDetail(platform, modId, cfKey())
        const versionId = asString(args['versionId']).trim()
        const file = detail.files.find((f) => f.id === versionId) ?? detail.files[0]
        if (!file) return { ok: false, text: '', error: '该模组没有可安装的版本文件' }

        const provenance = createProvenanceRecorder(root)
        const r = await installMod(
          {
            platform,
            modId,
            versionId: file.id,
            projectPath: root,
            includeDependencies: args['includeDependencies'] !== false,
            overwrite: args['overwrite'] === true
          },
          cfKey(),
          undefined,
          provenance
        )
        if (!r.ok) {
          if (r.conflict) {
            return {
              ok: false,
              text: '',
              error: `${r.error}。如需覆盖安装请向用户确认后 overwrite=true`,
              data: { conflict: r.conflict }
            }
          }
          return { ok: false, text: '', error: r.error ?? '安装失败' }
        }
        const text =
          `已安装 ${detail.name} ${file.versionNumber} → run/mods/${r.fileName}\n` +
          `文件兼容性：MC=${file.gameVersions.join('/') || '?'}，loader=${file.loaders.join('/') || '?'}（请核对与项目一致）` +
          (r.dependenciesInstalled?.length
            ? `\n依赖已安装 ${r.dependenciesInstalled.length} 个：${r.dependenciesInstalled.join('、')}`
            : '') +
          `\n来源记录已写入 .kunyu/modpack.json；打包导出时会生成 ${platform} 清单引用。`
        return { ok: true, text: clip(text), data: { fileName: r.fileName, dependencies: r.dependenciesInstalled } }
      } catch (e) {
        return { ok: false, text: '', error: `安装失败：${(e as Error).message}` }
      }
    }
  })

  /* market_list_installed */
  tools.push({
    kind: 'chat',
    def: {
      type: 'function',
      function: {
        name: 'market_list_installed',
        description:
          '列出当前整合包已安装的模组：run/mods 下 jar 文件 + 来源记录（平台/slug/版本/安装时间）。' +
          '用于核对已装清单、避免重复安装。',
        parameters: { type: 'object', properties: {}, required: [] }
      }
    },
    visibility: 'modpack',
    execute: () => {
      const root = deps.projectRoot?.()
      if (!root) return { ok: false, text: '', error: '当前没有打开的项目' }
      const modsDir = join(root, 'run', 'mods')
      const jars = existsSync(modsDir)
        ? readdirSync(modsDir).filter((n) => n.toLowerCase().endsWith('.jar'))
        : []
      const sources = readSources(root)
      if (jars.length === 0) return { ok: true, text: 'run/mods 为空：尚未安装任何模组', data: { count: 0 } }
      const lines = jars.map((jar) => {
        const src = sources.get(jar)
        return src
          ? `- ${jar} ← ${src.platform}/${src.slug}@${src.versionNumber}（${src.installedAt}）`
          : `- ${jar}（无来源记录：本地手动放入）`
      })
      return { ok: true, text: clip(`已安装 ${jars.length} 个模组：\n${lines.join('\n')}`), data: { count: jars.length } }
    }
  })

  /* modpack_dependency_audit：P3-1b 依赖缺席前置审计 */
  tools.push({
    kind: 'chat',
    def: {
      type: 'function',
      function: {
        name: 'modpack_dependency_audit',
        description:
          '审计当前整合包 run/mods 的模组间依赖：解析每个 jar 的内嵌元数据（Fabric fabric.mod.json / Forge mods.toml），' +
          '比对全包 modId 集合，给出「缺必需前置（启动必炸）」「缺可选联动（功能降级）」「声明冲突却共存」三档中文告警。' +
          '装新模组/打包前各跑一次，把启动崩溃前置到装包阶段发现。',
        parameters: { type: 'object', properties: {}, required: [] }
      }
    },
    visibility: 'modpack',
    execute: () => {
      const root = deps.projectRoot?.()
      if (!root) return { ok: false, text: '', error: '当前没有打开的项目' }
      const modsDir = join(root, 'run', 'mods')
      const jars = existsSync(modsDir)
        ? readdirSync(modsDir).filter((n) => n.toLowerCase().endsWith('.jar'))
        : []
      if (jars.length === 0) return { ok: true, text: 'run/mods 为空：无可审计的模组', data: { count: 0 } }
      const r = auditDependencies(jars.map((n) => extractJarDeps(join(modsDir, n), n)))
      const lines: string[] = [
        `已审计 ${jars.length} 个 jar（成功解析 ${r.parsed} 个${r.skipped.length ? `，${r.skipped.length} 个元数据损坏跳过：${r.skipped.join('、')}` : ''}）`
      ]
      if (r.missingRequired.length === 0 && r.conflicts.length === 0 && r.missingOptional.length === 0) {
        lines.push('未发现缺失依赖或冲突共存：全部模组的必需/可选前置都在包内。')
      } else {
        if (r.missingRequired.length > 0) lines.push('【缺必需前置·启动必炸】\n' + r.missingRequired.map((m) => `- ${m}`).join('\n'))
        if (r.conflicts.length > 0) lines.push('【冲突共存】\n' + r.conflicts.map((m) => `- ${m}`).join('\n'))
        if (r.missingOptional.length > 0) lines.push('【可选联动未装·功能降级】\n' + r.missingOptional.map((m) => `- ${m}`).join('\n'))
      }
      return {
        ok: true,
        text: clip(lines.join('\n')),
        data: {
          parsed: r.parsed,
          skipped: r.skipped,
          missingRequired: r.missingRequired,
          missingOptional: r.missingOptional,
          conflicts: r.conflicts
        }
      }
    }
  })

  return tools
}
