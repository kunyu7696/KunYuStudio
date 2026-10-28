/**
 * 整合包版本迁移引导工作流。
 *
 * 解决的问题：整合包升 MC 版本远比模组项目凶险——
 * 已装的几十个社区模组未必都有目标版本、pack.toml/manifest/modrinth.index
 * 三处版本声明要同步、升级失败的模组得一个个追。本模块把整合包迁移做成与
 * 模组项目（migrationWorkflow）同款的显式状态机：
 *
 *   previewed → confirmed → applied → undone
 *
 * - preview：解析 pack.toml 现状（权威元数据源）→ 严格查版本矩阵 →
 *   产出三处版本声明的变更清单 + 已装模组目标版本可得性风险（线上核查
 *   超出纯函数边界，按「每个来源记录模组都需要人工核对」生成 warn 清单，
 *   目标版本不在矩阵中给 block）；
 * - decision（confirm）：含 block 风险拒绝确认；
 * - apply：强制备份先行（pack.toml / manifest.json / modrinth.index.json
 *   原样复制到 .kunyu/migrations/<id>/backup/），再按清单写盘；
 * - undo：从备份整量恢复。
 *
 * v1 范围：同加载器 MC 版本迁移。加载器切换改变的是整个模组生态位
 * （Fabric 模组和 Forge 模组不通用），preview 直接给 block 风险。
 * 与模组项目迁移记录共用 .kunyu/migrations/ 目录（kind 字段区分）。
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { getToolchain, isMojangEra } from '../../templates/loaderVersionMatrix'
import type { ModLoader } from '../../../shared/types/project'
import { parsePackToml } from '../modpack/packTomlIo'
import { readSources } from '../modpack/provenance'
import { packTomlLoaderKey } from '../../../shared/types/packToml'

export type PackMigrationState = 'previewed' | 'confirmed' | 'applied' | 'undone' | 'failed'

export interface PackMigrationChange {
  /** 项目相对 POSIX 路径 */
  relPath: string
  action: 'modify'
  /** 中文说明（如「minecraft: 1.20.1 → 1.21.1」），一行一条 */
  summary: string[]
}

export interface PackMigrationRisk {
  level: 'info' | 'warn' | 'block'
  message: string
}

export interface PackMigrationRecord {
  id: string
  kind: 'modpack'
  createdAt: string
  updatedAt: string
  state: PackMigrationState
  loader: ModLoader
  from: { mcVersion: string; loaderVersion: string | null }
  to: { mcVersion: string; loaderVersion: string }
  changes: PackMigrationChange[]
  risks: PackMigrationRisk[]
  /** apply 成功后的备份目录（绝对路径） */
  backupDir?: string
  /** state=failed 时的原因 */
  error?: string
}

// ---------------------------------------------------------------------------
// 落盘
// ---------------------------------------------------------------------------

function migrationsDir(root: string): string {
  return join(root, '.kunyu', 'migrations')
}

function recordPath(root: string, id: string): string {
  return join(migrationsDir(root), `${id}.json`)
}

function persist(root: string, record: PackMigrationRecord): void {
  const dir = migrationsDir(root)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  record.updatedAt = new Date().toISOString()
  writeFileSync(recordPath(root, record.id), JSON.stringify(record, null, 2) + '\n', 'utf-8')
}

/** 读取单条整合包迁移记录；不存在/损坏/非 modpack 类返回 null */
export function getPackMigration(root: string, id: string): PackMigrationRecord | null {
  const path = recordPath(root, id)
  if (!existsSync(path)) return null
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8').replace(/^\uFEFF/, '')) as PackMigrationRecord
    return raw && raw.kind === 'modpack' && typeof raw.id === 'string' ? raw : null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// pack.toml / 清单骨架纯函数改写（独立导出便于单测）
// ---------------------------------------------------------------------------

/**
 * 重写 pack.toml 的 versions 段：保留用户注释与字段顺序（smol-toml 会丢注释，
 * 所以走文本级行替换——versions 段内逐键替换，缺失键追加到段尾）。
 * pack.toml 组装时绝不回写的约定不变，这里是用户显式触发的迁移操作。
 */
export function updatePackTomlVersions(
  content: string,
  updates: Record<string, string>
): { text: string; applied: Array<{ key: string; oldValue: string | null; newValue: string }> } {
  const applied: Array<{ key: string; oldValue: string | null; newValue: string }> = []
  const pending = new Map(Object.entries(updates))
  const lines = content.split('\n')
  const out: string[] = []
  let inVersions = false
  for (const line of lines) {
    const headerM = /^\s*\[([^\]]+)\]\s*$/.exec(line)
    if (headerM) {
      inVersions = headerM[1]!.trim() === 'versions'
      out.push(line)
      continue
    }
    if (inVersions) {
      const kvM = /^\s*([A-Za-z0-9_.-]+)\s*=\s*"?([^"#]*)"?\s*(#.*)?$/.exec(line)
      if (kvM && pending.has(kvM[1]!)) {
        const key = kvM[1]!
        const newValue = pending.get(key)!
        pending.delete(key)
        applied.push({ key, oldValue: kvM[2]!.trim() || null, newValue })
        out.push(`${key} = "${newValue}"`)
        continue
      }
    }
    out.push(line)
  }
  // 缺失键追加到 versions 段尾（没有 versions 段则追加新段）
  if (pending.size > 0) {
    const additions = [...pending.entries()].map(([k, v]) => {
      applied.push({ key: k, oldValue: null, newValue: v })
      return `${k} = "${v}"`
    })
    const versionsIdx = out.findIndex((l) => /^\s*\[versions\]\s*$/.test(l))
    if (versionsIdx >= 0) {
      out.splice(versionsIdx + 1, 0, ...additions)
    } else {
      out.push('', '[versions]', ...additions)
    }
  }
  const text = out.join('\n')
  return { text: text.endsWith('\n') ? text : text + '\n', applied }
}

/** 重写 CurseForge manifest.json 的 minecraft.version 与 modLoaders（纯函数，JSON 层） */
export function updateCfManifestMc(
  content: string,
  mcVersion: string,
  loader: ModLoader,
  loaderVersion: string | null
): string | null {
  let doc: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(content)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    doc = parsed as Record<string, unknown>
  } catch {
    return null
  }
  const prevMc =
    doc['minecraft'] && typeof doc['minecraft'] === 'object' && !Array.isArray(doc['minecraft'])
      ? (doc['minecraft'] as Record<string, unknown>)
      : {}
  doc['minecraft'] = {
    ...prevMc,
    version: mcVersion,
    modLoaders: loaderVersion ? [{ id: `${loader}-${loaderVersion}`, primary: true }] : []
  }
  return JSON.stringify(doc, null, 2) + '\n'
}

/** 重写 Modrinth modrinth.index.json 的 dependencies.minecraft 与加载器键（纯函数，JSON 层） */
export function updateMrIndexMc(
  content: string,
  mcVersion: string,
  loader: ModLoader,
  loaderVersion: string | null
): string | null {
  let doc: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(content)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    doc = parsed as Record<string, unknown>
  } catch {
    return null
  }
  const prevDeps =
    doc['dependencies'] && typeof doc['dependencies'] === 'object' && !Array.isArray(doc['dependencies'])
      ? { ...(doc['dependencies'] as Record<string, unknown>) }
      : {}
  // 旧加载器键一律清掉（同加载器迁移时同键覆盖，跨键残留会误导启动器）
  for (const key of ['fabric-loader', 'forge', 'neoforge']) delete prevDeps[key]
  prevDeps['minecraft'] = mcVersion
  if (loaderVersion) prevDeps[packTomlLoaderKey(loader)] = loaderVersion
  doc['dependencies'] = prevDeps
  return JSON.stringify(doc, null, 2) + '\n'
}

// ---------------------------------------------------------------------------
// 状态机
// ---------------------------------------------------------------------------

/**
 * preview：解析 pack.toml（缺失/损坏给 block）→ 严格校验目标版本在矩阵中存在 →
 * 生成变更/风险清单并落盘。目标不合法不抛错，以 block 风险呈现。
 */
export function previewPackMigration(root: string, targetMcVersion: string): PackMigrationRecord {
  const target = targetMcVersion.trim()
  const risks: PackMigrationRisk[] = []
  const changes: PackMigrationChange[] = []

  // pack.toml 是整合包权威元数据：缺失/损坏无法确定当前版本与加载器
  const packPath = join(root, 'pack.toml')
  let currentMc = ''
  let loader: ModLoader = 'fabric'
  let currentLoaderVersion: string | null = null
  let packText = ''
  if (!existsSync(packPath)) {
    risks.push({ level: 'block', message: '项目缺少 pack.toml，无法执行整合包迁移（请先完成一次组装以自愈生成）。' })
  } else {
    packText = readFileSync(packPath, 'utf-8')
    const parsed = parsePackToml(packText)
    if (!parsed.ok || !parsed.ir) {
      risks.push({ level: 'block', message: `pack.toml 解析失败：${parsed.error ?? '未知错误'}（请修复后再迁移）。` })
    } else {
      currentMc = parsed.ir.minecraft ?? ''
      loader = parsed.ir.loader ?? 'fabric'
      currentLoaderVersion = parsed.ir.loaderVersion
      if (!currentMc) risks.push({ level: 'block', message: 'pack.toml 缺少 versions.minecraft，无法确定当前版本。' })
      if (!parsed.ir.loader) risks.push({ level: 'block', message: 'pack.toml 缺少加载器版本键（fabric-loader/forge/neoforge），无法确定加载器。' })
    }
  }

  if (!target) risks.push({ level: 'block', message: '目标 MC 版本为空。' })
  if (target && target === currentMc) {
    risks.push({ level: 'block', message: `目标版本与当前相同（${currentMc}），无需迁移。` })
  }

  // 严格校验：getToolchain 对未知版本静默回退，必须比对回读值
  const tc = getToolchain(loader, target)
  const comboExists = tc.mcVersion === target
  if (target && !comboExists) {
    risks.push({
      level: 'block',
      message:
        `版本矩阵中没有 ${loader} + MC ${target} 的配套工具链（离线无法验证其存在性）。` +
        '如确认该版本真实存在，请先在 loaderVersionMatrix 登记后再迁移。'
    })
  }
  // 回读目标加载器版本：矩阵条目里的 loaderVersion 才是权威（可能因版本组合不同而变化）
  const targetLoaderVersion =
    tc.loader === 'fabric' ? tc.loaderVersion : tc.loader === 'forge' ? tc.forgeVersion : tc.neoForgeVersion

  if (comboExists && currentMc && !risks.some((r) => r.level === 'block')) {
    // ① pack.toml versions 段
    const summary = [`minecraft: ${currentMc} → ${target}`]
    if (currentLoaderVersion !== targetLoaderVersion) {
      summary.push(`${packTomlLoaderKey(loader)}: ${currentLoaderVersion ?? '（无）'} → ${targetLoaderVersion}`)
    }
    changes.push({ relPath: 'pack.toml', action: 'modify', summary })

    // ② 双清单骨架（存在才改，缺失给 info 提示）
    if (existsSync(join(root, 'manifest.json'))) {
      changes.push({ relPath: 'manifest.json', action: 'modify', summary: [`minecraft.version: ${currentMc} → ${target}`, `modLoaders: ${loader}-${targetLoaderVersion}`] })
    } else {
      risks.push({ level: 'info', message: 'manifest.json 不存在，迁移时跳过（下次组装会按新元数据生成）。' })
    }
    if (existsSync(join(root, 'modrinth.index.json'))) {
      changes.push({ relPath: 'modrinth.index.json', action: 'modify', summary: [`dependencies.minecraft: ${currentMc} → ${target}`] })
    } else {
      risks.push({ level: 'info', message: 'modrinth.index.json 不存在，迁移时跳过（下次组装会按新元数据生成）。' })
    }

    // ③ 已装模组目标版本可得性：线上核查超出纯函数边界，逐条生成人工核对 warn
    const sources = [...readSources(root).values()].filter((e) => e.platform !== 'local')
    if (sources.length > 0) {
      risks.push({
        level: 'warn',
        message:
          `${sources.length} 个平台来源模组需要逐一核对目标版本可得性（本次迁移不联网核查）：` +
          sources.slice(0, 8).map((s) => s.slug || s.name).join('、') + (sources.length > 8 ? ` 等 ${sources.length} 个` : '') +
          '。没有目标版本的模组需移除或等待作者更新，否则启动即崩。'
      })
    }
    const localCount = [...readSources(root).values()].length - sources.length
    if (localCount > 0) {
      risks.push({ level: 'warn', message: `${localCount} 个本地手工放入的模组无平台坐标，请自行确认是否兼容 ${target}。` })
    }

    // ④ 映射体系切换提示（影响自建模组内容包）
    if (isMojangEra(currentMc) !== isMojangEra(target)) {
      risks.push({
        level: 'warn',
        message: '跨映射体系迁移：项目内自建模组/内容包代码会发生 API 名漂移，建议先对模组项目执行 migrationWorkflow 再迁移整合包。'
      })
    }
    risks.push({ level: 'info', message: '迁移只改版本声明，不下载/替换任何模组 jar；目标版本模组集由下次组装时按市场重新安装。' })
  }

  const now = new Date().toISOString()
  const record: PackMigrationRecord = {
    id: `pmig-${now.replace(/[-:T.Z]/g, '').slice(0, 14)}-${randomUUID().slice(0, 4)}`,
    kind: 'modpack',
    createdAt: now,
    updatedAt: now,
    state: 'previewed',
    loader,
    from: { mcVersion: currentMc, loaderVersion: currentLoaderVersion },
    to: { mcVersion: target, loaderVersion: targetLoaderVersion },
    changes,
    risks
  }
  persist(root, record)
  return record
}

function mustGet(root: string, id: string): PackMigrationRecord {
  const rec = getPackMigration(root, id)
  if (!rec) throw new Error(`整合包迁移记录不存在：${id}`)
  return rec
}

/** decision：确认迁移（含 block 风险时拒绝）。previewed → confirmed */
export function confirmPackMigration(root: string, id: string): PackMigrationRecord {
  const rec = mustGet(root, id)
  if (rec.state !== 'previewed') {
    throw new Error(`当前状态（${rec.state}）不允许确认：只有 previewed 状态可以确认。`)
  }
  const block = rec.risks.find((r) => r.level === 'block')
  if (block) throw new Error(`存在阻断级风险，无法确认：${block.message}`)
  rec.state = 'confirmed'
  persist(root, rec)
  return rec
}

/** apply：强制备份先行（备份失败不改动任何文件），confirmed → applied（失败 → failed） */
export function applyPackMigration(root: string, id: string): PackMigrationRecord {
  const rec = mustGet(root, id)
  if (rec.state !== 'confirmed') {
    throw new Error(`当前状态（${rec.state}）不允许执行：只有 confirmed 状态可以执行。`)
  }
  const backupDir = join(migrationsDir(root), rec.id, 'backup')
  try {
    // ① 强制备份
    for (const change of rec.changes) {
      const abs = join(root, ...change.relPath.split('/'))
      if (!existsSync(abs)) throw new Error(`待修改文件不存在：${change.relPath}`)
      const backupPath = join(backupDir, ...change.relPath.split('/'))
      mkdirSync(join(backupPath, '..'), { recursive: true })
      copyFileSync(abs, backupPath)
    }
    // ② 按清单写盘
    for (const change of rec.changes) {
      const abs = join(root, ...change.relPath.split('/'))
      if (change.relPath === 'pack.toml') {
        const { text } = updatePackTomlVersions(readFileSync(abs, 'utf-8'), {
          minecraft: rec.to.mcVersion,
          [packTomlLoaderKey(rec.loader)]: rec.to.loaderVersion
        })
        writeFileSync(abs, text, 'utf-8')
      } else if (change.relPath === 'manifest.json') {
        const updated = updateCfManifestMc(readFileSync(abs, 'utf-8'), rec.to.mcVersion, rec.loader, rec.to.loaderVersion)
        if (updated === null) throw new Error('manifest.json 不是合法 JSON，无法迁移')
        writeFileSync(abs, updated, 'utf-8')
      } else if (change.relPath === 'modrinth.index.json') {
        const updated = updateMrIndexMc(readFileSync(abs, 'utf-8'), rec.to.mcVersion, rec.loader, rec.to.loaderVersion)
        if (updated === null) throw new Error('modrinth.index.json 不是合法 JSON，无法迁移')
        writeFileSync(abs, updated, 'utf-8')
      } else {
        throw new Error(`未知的迁移改写目标：${change.relPath}`)
      }
    }
    rec.state = 'applied'
    rec.backupDir = backupDir
  } catch (err) {
    rec.state = 'failed'
    rec.error = (err as Error).message
  }
  persist(root, rec)
  if (rec.state === 'failed') {
    throw new Error(`整合包迁移执行失败（未改动或已中断，备份在 ${backupDir}）：${rec.error}`)
  }
  return rec
}

/** undo：从备份整量恢复，applied → undone */
export function undoPackMigration(root: string, id: string): PackMigrationRecord {
  const rec = mustGet(root, id)
  if (rec.state !== 'applied') {
    throw new Error(`当前状态（${rec.state}）不允许回滚：只有 applied 状态可以回滚。`)
  }
  const backupDir = rec.backupDir ?? join(migrationsDir(root), rec.id, 'backup')
  for (const change of rec.changes) {
    const backupPath = join(backupDir, ...change.relPath.split('/'))
    if (!existsSync(backupPath)) {
      throw new Error(`备份缺失，无法回滚：${backupPath}（请从版本控制恢复）`)
    }
    copyFileSync(backupPath, join(root, ...change.relPath.split('/')))
  }
  rec.state = 'undone'
  persist(root, rec)
  return rec
}
