/**
 * KubeJS 脚本 FC 工具（kubejsService 的 AI 封装）。
 *
 * - kubejs_list_scripts / kubejs_read_script：只读浏览 kubejs/{startup,server,client}_scripts/*.js；
 * - kubejs_write_script：单文件写入（自动创建目录，同名覆盖）；
 * - kubejs_list_templates / kubejs_apply_template：内置骨架库（物品/方块注册、配方、事件），
 *   落盘为新脚本，目标已存在时拒绝（防覆盖用户代码）。
 * id 合法性与根守卫由服务层负责，工具侧捕获后软失败。
 */
import type { KubejsScriptDir } from '../../../../shared/types/kubejs'
import type { RegisteredTool, ToolRegistryDeps } from '../toolRegistry'
import { applyTemplate, listScripts, listTemplates, readScript, writeScript } from '../../kubejsService'

const CLIP = 8000
function clip(text: string): string {
  return text.length <= CLIP ? text : `${text.slice(0, CLIP)}…（已截断）`
}
function asString(v: unknown): string {
  return typeof v === 'string' ? v : ''
}
function asDir(v: unknown): KubejsScriptDir | null {
  return v === 'startup' || v === 'server' || v === 'client' ? v : null
}

export function builtinKubejsTools(deps: ToolRegistryDeps): RegisteredTool[] {
  const tools: RegisteredTool[] = []

  /* kubejs_list_scripts */
  tools.push({
    kind: 'chat',
    def: {
      type: 'function',
      function: {
        name: 'kubejs_list_scripts',
        description:
          '列出当前项目全部 KubeJS 脚本（目录/文件名/大小/修改时间），' +
          '尚不存在的脚本目录记入 missingDirs，读取异常记入 warnings。',
        parameters: { type: 'object', properties: {}, required: [] }
      }
    },
    visibility: 'project',
    execute: () => {
      const root = deps.projectRoot?.()
      if (!root) return { ok: false, text: '', error: '当前没有打开的项目' }
      try {
        const r = listScripts(root)
        const lines = r.scripts.map((s) => `- ${s.relPath}（${Math.round(s.sizeBytes / 1024)} KB）`)
        const missing = r.missingDirs.length ? `\n目录尚不存在：${r.missingDirs.join('、')}` : ''
        const warn = r.warnings.length ? `\n警告：\n${r.warnings.map((w) => `- ⚠️ ${w}`).join('\n')}` : ''
        const text = r.scripts.length
          ? `共 ${r.scripts.length} 个脚本：\n${lines.join('\n')}${missing}${warn}`
          : `还没有 KubeJS 脚本。${missing}`
        return { ok: true, text: clip(text), data: r }
      } catch (err) {
        return { ok: false, text: '', error: (err as Error).message }
      }
    }
  })

  /* kubejs_read_script */
  tools.push({
    kind: 'chat',
    def: {
      type: 'function',
      function: {
        name: 'kubejs_read_script',
        description: '读取单个 KubeJS 脚本全文（utf-8，BOM 容忍）。',
        parameters: {
          type: 'object',
          properties: {
            dir: { type: 'string', enum: ['startup', 'server', 'client'], description: '脚本目录' },
            stem: { type: 'string', description: '文件名去 .js 后缀' }
          },
          required: ['dir', 'stem']
        }
      }
    },
    visibility: 'project',
    execute: (args) => {
      const root = deps.projectRoot?.()
      if (!root) return { ok: false, text: '', error: '当前没有打开的项目' }
      const dir = asDir(args['dir'])
      const stem = asString(args['stem']).trim()
      if (!dir) return { ok: false, text: '', error: 'dir 必须是 startup / server / client' }
      if (!stem) return { ok: false, text: '', error: '缺少 stem 参数（文件名去 .js 后缀）' }
      try {
        const content = readScript(root, dir, stem)
        return { ok: true, text: clip(content), data: { dir, stem } }
      } catch (err) {
        return { ok: false, text: '', error: (err as Error).message }
      }
    }
  })

  /* kubejs_write_script */
  tools.push({
    kind: 'chat',
    def: {
      type: 'function',
      function: {
        name: 'kubejs_write_script',
        description:
          '写入 KubeJS 脚本（新建或同名覆盖，目录自动创建）。' +
          'stem 须小写字母开头、仅含小写字母/数字/下划线。',
        parameters: {
          type: 'object',
          properties: {
            dir: { type: 'string', enum: ['startup', 'server', 'client'], description: '脚本目录' },
            stem: { type: 'string', description: '文件名去 .js 后缀' },
            content: { type: 'string', description: '脚本完整内容' }
          },
          required: ['dir', 'stem', 'content']
        }
      }
    },
    visibility: 'project',
    execute: (args) => {
      const root = deps.projectRoot?.()
      if (!root) return { ok: false, text: '', error: '当前没有打开的项目' }
      const dir = asDir(args['dir'])
      const stem = asString(args['stem']).trim()
      const content = asString(args['content'])
      if (!dir) return { ok: false, text: '', error: 'dir 必须是 startup / server / client' }
      if (!stem) return { ok: false, text: '', error: '缺少 stem 参数（文件名去 .js 后缀）' }
      if (!content) return { ok: false, text: '', error: '缺少 content 参数（脚本完整内容）' }
      try {
        writeScript(root, dir, stem, content)
        return { ok: true, text: `已写入 kubejs/${dir}_scripts/${stem}.js（${content.length} 字符）`, data: { dir, stem } }
      } catch (err) {
        return { ok: false, text: '', error: (err as Error).message }
      }
    }
  })

  /* kubejs_list_templates */
  tools.push({
    kind: 'chat',
    def: {
      type: 'function',
      function: {
        name: 'kubejs_list_templates',
        description: '列出内置 KubeJS 脚本模板（id/名称/落盘目录/用途说明），不含模板正文。',
        parameters: { type: 'object', properties: {}, required: [] }
      }
    },
    visibility: 'always',
    execute: () => {
      const metas = listTemplates().map((t) => ({ id: t.id, name: t.name, dir: t.dir, stem: t.stem, description: t.description }))
      const lines = metas.map((t) => `- ${t.id}「${t.name}」（${t.dir} → ${t.stem}.js）：${t.description}`)
      return { ok: true, text: clip(`内置模板 ${metas.length} 个：\n${lines.join('\n')}`), data: { templates: metas } }
    }
  })

  /* kubejs_apply_template */
  tools.push({
    kind: 'chat',
    def: {
      type: 'function',
      function: {
        name: 'kubejs_apply_template',
        description: '把内置模板落盘为新脚本；目标已存在时拒绝（防覆盖用户代码）。',
        parameters: {
          type: 'object',
          properties: {
            templateId: { type: 'string', description: '模板 id（kubejs_list_templates 获取）' }
          },
          required: ['templateId']
        }
      }
    },
    visibility: 'project',
    execute: (args) => {
      const root = deps.projectRoot?.()
      if (!root) return { ok: false, text: '', error: '当前没有打开的项目' }
      const templateId = asString(args['templateId']).trim()
      if (!templateId) return { ok: false, text: '', error: '缺少 templateId 参数' }
      try {
        const file = applyTemplate(root, templateId)
        return { ok: true, text: `已落盘模板 ${templateId} → ${file.relPath}`, data: file }
      } catch (err) {
        return { ok: false, text: '', error: (err as Error).message }
      }
    }
  })

  return tools
}
