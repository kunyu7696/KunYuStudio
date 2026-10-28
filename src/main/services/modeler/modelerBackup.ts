/**
 * modelerBackup：模型工坊文档落盘 / 自动保存 / 备份 / 崩溃恢复（P2-f，方案 §4.10）。
 *
 * - 显式保存 = 备份旧主文件（backups/<id>/<毫秒时间戳>.json，轮转留最近 5 份）
 *   → 原子写主文件（同目录 tmp + rename）→ 清自动保存影子文件；
 * - 自动保存 = 影子文件 <id>.autosave（原子写），不打断编辑、不覆盖主文件，
 *   应用崩溃后残留即视为「有未保存修改」的恢复线索；
 * - 崩溃恢复 = checkModelerDocRecovery 返回 autosave/主文件 mtime，
 *   渲染层据此提示「恢复 / 丢弃」，正常流程（显式保存/关闭文档）会清掉 autosave。
 * 纯 node fs 实现，不依赖 Electron，可直接 vitest。
 */
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { computeModelerRevision } from '../../../shared/modeler/revision'

/** 备份保留份数（超出最旧的删除） */
export const MODELER_BACKUP_KEEP = 5

/** 备份文件名戳：单调递增（同毫秒连保存不冲突；13 位等长保证字典序=时间序） */
let lastBackupStamp = 0
function nextBackupStamp(): number {
  const now = Date.now()
  lastBackupStamp = now > lastBackupStamp ? now : lastBackupStamp + 1
  return lastBackupStamp
}

function docsDir(root: string): string {
  return path.join(root, '.kunyu', 'modeler')
}

function backupsDir(root: string, id: string): string {
  return path.join(docsDir(root), 'backups', id)
}

/** id 清洗：仅允许安全文件名字符（防路径穿越） */
function safeId(id: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`非法文档 id：${id}`)
  return id
}

async function exists(p: string): Promise<boolean> {
  try {
    await fsp.access(p)
    return true
  } catch {
    return false
  }
}

async function mtime(p: string): Promise<number | null> {
  try {
    return (await fsp.stat(p)).mtimeMs
  } catch {
    return null
  }
}

/** 原子写：同目录临时文件 → rename（同卷内 rename 原子，崩溃不留半截文件） */
async function atomicWrite(file: string, content: string): Promise<void> {
  await fsp.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  await fsp.writeFile(tmp, content, 'utf8')
  await fsp.rename(tmp, file)
}

/** 备份轮转：文件名毫秒时间戳等长，字典序即时间序，超出保留数删最旧 */
async function rotateBackups(dir: string): Promise<void> {
  let names: string[]
  try {
    names = await fsp.readdir(dir)
  } catch {
    return
  }
  const files = names.filter((n) => n.endsWith('.json')).sort()
  const excess = files.length - MODELER_BACKUP_KEEP
  for (const n of files.slice(0, Math.max(0, excess))) {
    await fsp.rm(path.join(dir, n), { force: true })
  }
}

export interface ModelerDocRecoveryInfo {
  hasAutosave: boolean
  autosaveMtime: number | null
  docMtime: number | null
}

/**
 * 乐观锁冲突（checkpoint/revision 一致性）。
 * 写方基于过期 revision 写回时抛出——当前 revision 附在 message 中供用户定位。
 */
export class ModelerConflictError extends Error {
  /** 冲突时磁盘上的真实 revision（文档不存在为 null） */
  readonly currentRevision: string | null
  constructor(currentRevision: string | null, expectedRevision: string | null) {
    super(
      `文档已被其它来源修改（当前 revision ${currentRevision ?? '（不存在）'}，` +
        `你的编辑基于 ${expectedRevision ?? '（不存在）'}），保存已拒绝；` +
        '请重新打开文档合并修改后再保存。'
    )
    this.name = 'ModelerConflictError'
    this.currentRevision = currentRevision
  }
}

/** 读取当前文档 revision（文档不存在返回 null；ETag 语义，读内容哈希） */
export async function readModelerRevision(root: string, id: string): Promise<string | null> {
  const sid = safeId(id)
  const docFile = path.join(docsDir(root), `${sid}.json`)
  try {
    return computeModelerRevision(await fsp.readFile(docFile, 'utf8'))
  } catch {
    return null
  }
}

export interface SaveModelerDocOptions {
  /**
   * 乐观锁（P1②）：调用方读到的 revision（computeModelerRevision 输出）。
   * - undefined：不校验（权威写入方，如 AI 回写 / 历史调用）；
   * - null：调用方认为文档不存在（新建首存）——存在即冲突；
   * - 字符串：与磁盘当前 revision 不一致即抛 ModelerConflictError。
   */
  expectedRevision?: string | null
}

export interface SaveModelerDocResult {
  /** 写盘后的新 revision（= 所写内容的哈希），调用方据此更新编辑基线 */
  revision: string
}

/**
 * 显式保存：旧主文件先备份 → 原子写新主文件 → 清 autosave → 轮转备份目录。
 * 首次保存（无旧主文件）不产生备份。
 * P1②：携带 expectedRevision 时先做乐观锁校验，冲突拒绝且不产生备份噪音。
 */
export async function saveModelerDoc(
  root: string,
  id: string,
  content: string,
  opts?: SaveModelerDocOptions
): Promise<SaveModelerDocResult> {
  const sid = safeId(id)
  const docFile = path.join(docsDir(root), `${sid}.json`)
  const expected = opts?.expectedRevision
  if (expected !== undefined) {
    const current = await readModelerRevision(root, sid)
    if (current !== expected) throw new ModelerConflictError(current, expected)
  }
  if (await exists(docFile)) {
    const bdir = backupsDir(root, sid)
    await fsp.mkdir(bdir, { recursive: true })
    await fsp.copyFile(docFile, path.join(bdir, `${nextBackupStamp()}.json`))
  }
  await atomicWrite(docFile, content)
  await fsp.rm(path.join(docsDir(root), `${sid}.autosave`), { force: true })
  await rotateBackups(backupsDir(root, sid))
  return { revision: computeModelerRevision(content) }
}

/** 自动保存影子文件（content=null 删除；删除不存在目标不报错） */
export async function autosaveModelerDoc(root: string, id: string, content: string | null): Promise<void> {
  const sid = safeId(id)
  const file = path.join(docsDir(root), `${sid}.autosave`)
  if (content === null) {
    await fsp.rm(file, { force: true })
    return
  }
  await atomicWrite(file, content)
}

/** 崩溃恢复信息：autosave 存在性 + 两侧 mtime（渲染层比较决定是否提示） */
export async function checkModelerDocRecovery(root: string, id: string): Promise<ModelerDocRecoveryInfo> {
  const sid = safeId(id)
  const dir = docsDir(root)
  const autosaveFile = path.join(dir, `${sid}.autosave`)
  return {
    hasAutosave: await exists(autosaveFile),
    autosaveMtime: await mtime(autosaveFile),
    docMtime: await mtime(path.join(dir, `${sid}.json`))
  }
}
