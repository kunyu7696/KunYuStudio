/**
 * 版本迁移引导工作流。
 *
 * 解决的问题：MC 版本迁移是「改几个版本号」看起来简单、踩坑巨多的操作——
 * 工具链版本不配套、JDK 要求跳变、Yarn/Mojang 映射切换导致 API 名漂移、
 * 改坏了回不去。本模块把它做成显式状态机：
 *
 *   previewed → confirmed → applied → undone
 *
 * - preview：解析当前项目（加载器/mcVersion）→ 严格查版本矩阵 → 产出
 *   逐项变更清单（gradle.properties 版本键、Gradle wrapper）+ 风险清单
 *   （info/warn/block），记录落盘 .kunyu/migrations/<id>.json；
 * - decision（confirm）：用户/Agent 看完 preview 后确认；含 block 风险拒绝确认；
 * - apply：强制备份先行（备份失败一律不改动），再按清单写盘；
 * - undo：从备份整量恢复，可回滚。
 *
 * v1 范围：同加载器 MC 版本迁移。加载器切换涉及 build.gradle 模板整体重生成
 * 与代码 API 漂移，属于 bridge 档迁移流水线，preview 直接给 block 风险。
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { ModLoader } from '../../../shared/types/project'
import { getToolchain, isMojangEra, type LoaderToolchain } from '../../templates/loaderVersionMatrix'
import { resolveModContext } from '../contentGenerator/context'

export type MigrationState = 'previewed' | 'confirmed' | 'applied' | 'undone' | 'failed'

export interface MigrationChange {
  /** 项目相对 POSIX 路径 */
  relPath: string
  action: 'modify'
  /** 中文说明（如「minecraft_version: 1.20.1 → 1.21.1」），一行一条 */
  summary: string[]
}

export interface MigrationRisk {
  level: 'info' | 'warn' | 'block'
  message: string
}

export interface MigrationRecord {
  id: string
  createdAt: string
  updatedAt: string
  state: MigrationState
  loader: ModLoader
  from: { mcVersion: string }
  to: { mcVersion: string }
  changes: MigrationChange[]
  risks: MigrationRisk[]
  /** apply 成功后的备份目录（绝对路径） */
  backupDir?: string
  /** state=failed 时的原因 */
  error?: string
}

// ---------------------------------------------------------------------------
// gradle.properties / wrapper 纯函数改写（独立导出便于单测）
// ---------------------------------------------------------------------------

/** 键值更新结果：oldValue 为 null 表示该键原本不存在 */
export interface PropsUpdateEntry {
  key: string
  oldValue: string | null
  newValue: string | null // null = 删除该键
}

/**
 * 逐行改写 gradle.properties：存在的键原位替换（保留注释与顺序），
 * null 值删除该键，缺失的新键追加到文件末尾（带迁移标记注释）。
 */
export function updateGradleProperties(
  content: string,
  updates: Record<string, string | null>,
  marker: string
): { text: string; applied: PropsUpdateEntry[] } {
  const applied: PropsUpdateEntry[] = []
  const pending = new Map(Object.entries(updates))
  const lines = content.split('\n')
  const out: string[] = []
  for (const line of lines) {
    const m = /^([A-Za-z0-9_.-]+)\s*=\s*(.*)$/.exec(line)
    if (m && pending.has(m[1]!)) {
      const key = m[1]!
      const newValue = pending.get(key)!
      pending.delete(key)
      const oldValue = m[2]!.trim()
      applied.push({ key, oldValue, newValue })
      if (newValue !== null) out.push(`${key}=${newValue}`)
      // newValue=null → 丢弃该行
      continue
    }
    out.push(line)
  }
  const additions: string[] = []
  for (const [key, newValue] of pending) {
    if (newValue === null) continue
    applied.push({ key, oldValue: null, newValue })
    additions.push(`${key}=${newValue}`)
  }
  if (additions.length > 0) {
    out.push('', `# ${marker}`, ...additions)
  }
  // 折叠可能产生的连续空行尾部
  const text = out.join('\n').replace(/\n{3,}/g, '\n\n')
  return { text: text.endsWith('\n') ? text : text + '\n', applied }
}

/** 改写 gradle-wrapper.properties 的 distributionUrl 版本段；找不到版本段返回 null */
export function updateWrapperProperties(content: string, gradleVersion: string): string | null {
  const re = /(distributionUrl\s*=\s*.*gradle-)([0-9][\d.]*?)(-(?:bin|all)\.zip)/
  const m = re.exec(content)
  if (!m) return null
  return content.replace(re, `$1${gradleVersion}$3`)
}

// ---------------------------------------------------------------------------
// 状态机
// ---------------------------------------------------------------------------

function migrationsDir(root: string): string {
  return join(root, '.kunyu', 'migrations')
}

function recordPath(root: string, id: string): string {
  return join(migrationsDir(root), `${id}.json`)
}

function persist(root: string, record: MigrationRecord): void {
  const dir = migrationsDir(root)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  record.updatedAt = new Date().toISOString()
  writeFileSync(recordPath(root, record.id), JSON.stringify(record, null, 2) + '\n', 'utf-8')
}

/** 读取单条迁移记录；不存在/损坏返回 null */
export function getMigration(root: string, id: string): MigrationRecord | null {
  const path = recordPath(root, id)
  if (!existsSync(path)) return null
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8').replace(/^\uFEFF/, '')) as MigrationRecord
    return raw && typeof raw.id === 'string' ? raw : null
  } catch {
    return null
  }
}

/** 全部迁移记录，按创建时间倒序（最新在前）；坏项跳过 */
export function listMigrations(root: string): MigrationRecord[] {
  const dir = migrationsDir(root)
  if (!existsSync(dir)) return []
  const out: MigrationRecord[] = []
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue
    const rec = getMigration(root, name.replace(/\.json$/, ''))
    if (rec) out.push(rec)
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/** 各加载器在 gradle.properties 里的版本键 → 工具链字段取值 */
function versionKeysFor(tc: LoaderToolchain): Record<string, string | null> {
  const updates: Record<string, string | null> = { minecraft_version: tc.mcVersion }
  switch (tc.loader) {
    case 'fabric':
      updates['loader_version'] = tc.loaderVersion
      updates['fabric_version'] = tc.fabricVersion
      // 26.x 起 Yarn 无构建：目标 yarnVersion 为空串表示该键必须删除
      updates['yarn_mappings'] = tc.yarnVersion ? tc.yarnVersion : null
      break
    case 'forge':
      updates['forge_version'] = tc.forgeVersion
      break
    case 'neoforge':
      updates['neoforge_version'] = tc.neoForgeVersion
      break
  }
  return updates
}

function readCurrentMcVersion(propsText: string): string {
  const m = /^minecraft_version\s*=\s*(.+)$/m.exec(propsText)
  return m ? m[1]!.trim() : ''
}

/**
 * preview：解析项目 → 严格校验目标版本在版本矩阵中存在 → 生成变更/风险清单并落盘。
 * 非模组项目（无描述文件）直接抛错；目标不合法不会抛错，而是以 block 风险呈现
 * （显式面板语义：看得见、拦得住）。
 */
export function previewMigration(root: string, targetMcVersion: string): MigrationRecord {
  const target = targetMcVersion.trim()
  const { loader } = resolveModContext(root) // 非模组项目抛错（中文说明）
  const propsPath = join(root, 'gradle.properties')
  const propsText = existsSync(propsPath) ? readFileSync(propsPath, 'utf-8') : ''
  const currentMc = readCurrentMcVersion(propsText)

  const risks: MigrationRisk[] = []
  const changes: MigrationChange[] = []

  if (!propsText) {
    risks.push({ level: 'block', message: '项目缺少 gradle.properties，无法执行版本迁移。' })
  }
  if (!target) {
    risks.push({ level: 'block', message: '目标 MC 版本为空。' })
  }
  if (target && target === currentMc) {
    risks.push({ level: 'block', message: `目标版本与当前相同（${currentMc}），无需迁移。` })
  }

  // 严格校验：getToolchain 对未知版本会静默回退默认版本，必须比对回读值
  const tc = getToolchain(loader, target)
  const comboExists = tc.mcVersion === target
  if (target && !comboExists) {
    risks.push({
      level: 'block',
      message:
        `版本矩阵中没有 ${loader} + MC ${target} 的配套工具链（离线无法验证其存在性）。` +
        '如确认该版本真实存在，请先在 loaderVersionMatrix 登记工具链后再迁移。'
    })
  }

  const currentTc = currentMc ? getToolchain(loader, currentMc) : null
  if (comboExists && propsText) {
    // gradle.properties 版本键变更
    const updates = versionKeysFor(tc)
    const summary: string[] = []
    for (const [key, newValue] of Object.entries(updates)) {
      const cur = new RegExp(`^${key}\\s*=\\s*(.+)$`, 'm').exec(propsText)?.[1]?.trim() ?? null
      if (cur === newValue) continue
      summary.push(
        newValue === null
          ? `${key}: ${cur ?? '（无）'} → 删除（目标版本不再需要该键）`
          : `${key}: ${cur ?? '（无）'} → ${newValue}`
      )
    }
    if (summary.length > 0) {
      changes.push({ relPath: 'gradle.properties', action: 'modify', summary })
    }

    // Gradle wrapper 变更
    const wrapperPath = join(root, 'gradle', 'wrapper', 'gradle-wrapper.properties')
    if (existsSync(wrapperPath)) {
      const wrapperText = readFileSync(wrapperPath, 'utf-8')
      const curGradle = /gradle-([0-9][\d.]*)-(?:bin|all)\.zip/.exec(wrapperText)?.[1] ?? null
      if (curGradle && curGradle !== tc.gradleVersion) {
        changes.push({
          relPath: 'gradle/wrapper/gradle-wrapper.properties',
          action: 'modify',
          summary: [`Gradle: ${curGradle} → ${tc.gradleVersion}`]
        })
      }
    } else {
      risks.push({ level: 'info', message: '项目没有 gradle-wrapper.properties，wrapper 版本由全局 Gradle 决定，不在本次迁移范围。' })
    }

    // JDK 跳变风险
    if (currentTc && currentTc.jdk !== tc.jdk) {
      risks.push({
        level: 'warn',
        message: `JDK 要求变化：${currentMc} 用 JDK ${currentTc.jdk}，${target} 需要 JDK ${tc.jdk}——迁移后请在设置中切换 JDK 再构建。`
      })
    }
    // 映射体系切换风险（Yarn ↔ Mojang 官方映射）：API 名大面积漂移
    if (currentMc && isMojangEra(currentMc) !== isMojangEra(target)) {
      risks.push({
        level: 'warn',
        message:
          `跨映射体系迁移（${isMojangEra(currentMc) ? 'Mojang 映射' : 'Yarn 映射'} → ${isMojangEra(target) ? 'Mojang 映射' : 'Yarn 映射'}）：` +
          '业务代码里的类/方法名会大面积漂移，迁移后必须重跑构建并逐项修复编译错误，建议先提交版本控制。'
      })
    } else if (tc.loader === 'fabric' && currentTc?.loader === 'fabric' && currentTc.yarnVersion !== tc.yarnVersion && tc.yarnVersion) {
      risks.push({ level: 'warn', message: `Yarn 映射版本变化（${currentTc.yarnVersion || '（无）'} → ${tc.yarnVersion}）：个别 API 名可能漂移，迁移后需重跑构建验证。` })
    }
    risks.push({ level: 'info', message: '语义资产（方块/物品/实体）与版本无关，不受迁移影响；build.gradle 若有内联版本写死需人工核对。' })
  }

  const now = new Date().toISOString()
  const record: MigrationRecord = {
    id: `mig-${now.replace(/[-:T.Z]/g, '').slice(0, 14)}-${randomUUID().slice(0, 4)}`,
    createdAt: now,
    updatedAt: now,
    state: 'previewed',
    loader,
    from: { mcVersion: currentMc },
    to: { mcVersion: target },
    changes,
    risks
  }
  persist(root, record)
  return record
}

function mustGet(root: string, id: string): MigrationRecord {
  const rec = getMigration(root, id)
  if (!rec) throw new Error(`迁移记录不存在：${id}`)
  return rec
}

/** decision：确认迁移（含 block 风险时拒绝）。previewed → confirmed */
export function confirmMigration(root: string, id: string): MigrationRecord {
  const rec = mustGet(root, id)
  if (rec.state !== 'previewed') {
    throw new Error(`当前状态（${rec.state}）不允许确认：只有 previewed 状态可以确认。`)
  }
  const block = rec.risks.find((r) => r.level === 'block')
  if (block) {
    throw new Error(`存在阻断级风险，无法确认：${block.message}`)
  }
  rec.state = 'confirmed'
  persist(root, rec)
  return rec
}

/** apply：强制备份先行（备份失败不改动任何文件），confirmed → applied（失败 → failed） */
export function applyMigration(root: string, id: string): MigrationRecord {
  const rec = mustGet(root, id)
  if (rec.state !== 'confirmed') {
    throw new Error(`当前状态（${rec.state}）不允许执行：只有 confirmed 状态可以执行。`)
  }
  const backupDir = join(migrationsDir(root), rec.id, 'backup')
  try {
    // ① 强制备份：所有待修改文件原样复制到 .kunyu/migrations/<id>/backup/
    for (const change of rec.changes) {
      const abs = join(root, ...change.relPath.split('/'))
      if (!existsSync(abs)) throw new Error(`待修改文件不存在：${change.relPath}`)
      const backupPath = join(backupDir, ...change.relPath.split('/'))
      mkdirSync(join(backupPath, '..'), { recursive: true })
      copyFileSync(abs, backupPath)
    }
    // ② 按清单写盘
    const tc = getToolchain(rec.loader, rec.to.mcVersion)
    for (const change of rec.changes) {
      const abs = join(root, ...change.relPath.split('/'))
      if (change.relPath === 'gradle.properties') {
        const { text } = updateGradleProperties(
          readFileSync(abs, 'utf-8'),
          versionKeysFor(tc),
          `Migration ${rec.id}`
        )
        writeFileSync(abs, text, 'utf-8')
      } else if (change.relPath === 'gradle/wrapper/gradle-wrapper.properties') {
        const updated = updateWrapperProperties(readFileSync(abs, 'utf-8'), tc.gradleVersion)
        if (updated === null) throw new Error('gradle-wrapper.properties 中找不到 distributionUrl 版本段')
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
    throw new Error(`迁移执行失败（未改动或已中断，备份在 ${backupDir}）：${rec.error}`)
  }
  return rec
}

/** undo：从备份整量恢复，applied → undone */
export function undoMigration(root: string, id: string): MigrationRecord {
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

/** 清理单条迁移记录（含备份目录）；仅用户手动触发 */
export function deleteMigration(root: string, id: string): boolean {
  const rec = getMigration(root, id)
  if (!rec) return false
  try {
    rmSync(recordPath(root, id), { force: true })
    rmSync(join(migrationsDir(root), id), { recursive: true, force: true })
    return true
  } catch {
    return false
  }
}
