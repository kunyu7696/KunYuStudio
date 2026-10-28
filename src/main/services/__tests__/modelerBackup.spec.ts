/**
 * modelerBackup 测试（P2-f）：原子保存、备份轮转、自动保存影子文件、崩溃恢复检测。
 * 用真实临时目录验证文件行为（含同毫秒连续保存的轮转稳定性）。
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  MODELER_BACKUP_KEEP,
  ModelerConflictError,
  autosaveModelerDoc,
  checkModelerDocRecovery,
  readModelerRevision,
  saveModelerDoc
} from '../modeler/modelerBackup'
import { computeModelerRevision } from '../../../shared/modeler/revision'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ky-modeler-bak-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const docFile = (id: string): string => join(root, '.kunyu', 'modeler', `${id}.json`)
const autosaveFile = (id: string): string => join(root, '.kunyu', 'modeler', `${id}.autosave`)
const backupsDir = (id: string): string => join(root, '.kunyu', 'modeler', 'backups', id)
const backupNames = (id: string): string[] =>
  existsSync(backupsDir(id)) ? readdirSync(backupsDir(id)).filter((n) => n.endsWith('.json')) : []

describe('saveModelerDoc', () => {
  it('首次保存：写主文件、无备份、目录自动创建', async () => {
    await saveModelerDoc(root, 'doc-a', '{"v":1}')
    expect(readFileSync(docFile('doc-a'), 'utf8')).toBe('{"v":1}')
    expect(backupNames('doc-a')).toEqual([])
  })

  it('二次保存：旧版本进入备份，主文件为新内容', async () => {
    await saveModelerDoc(root, 'doc-a', '{"v":1}')
    await saveModelerDoc(root, 'doc-a', '{"v":2}')
    expect(readFileSync(docFile('doc-a'), 'utf8')).toBe('{"v":2}')
    const names = backupNames('doc-a')
    expect(names).toHaveLength(1)
    expect(readFileSync(join(backupsDir('doc-a'), names[0]!), 'utf8')).toBe('{"v":1}')
  })

  it('连续保存超保留数：仅留最近 5 份（同毫秒文件名不冲突）', async () => {
    for (let i = 0; i < MODELER_BACKUP_KEEP + 3; i++) {
      await saveModelerDoc(root, 'doc-a', `{"v":${i}}`)
    }
    const names = backupNames('doc-a')
    expect(names).toHaveLength(MODELER_BACKUP_KEEP)
    // 字典序 = 时间序：最旧一份应为倒数第 MODELER_BACKUP_KEEP 次保存的内容
    const oldest = readFileSync(join(backupsDir('doc-a'), names[0]!), 'utf8')
    expect(oldest).toBe('{"v":2}') // 共 8 次保存 → 备份为 v1..v7，留 v3..v7 之前的版本 → 最旧是 v2 之后保存时的旧文件
    expect(readFileSync(docFile('doc-a'), 'utf8')).toBe(`{"v":${MODELER_BACKUP_KEEP + 2}}`)
  })

  it('保存后清理 autosave 影子文件', async () => {
    await autosaveModelerDoc(root, 'doc-a', '{"auto":1}')
    expect(existsSync(autosaveFile('doc-a'))).toBe(true)
    await saveModelerDoc(root, 'doc-a', '{"v":1}')
    expect(existsSync(autosaveFile('doc-a'))).toBe(false)
  })

  it('非法 id 拒绝（防路径穿越）', async () => {
    await expect(saveModelerDoc(root, '../evil', '{}')).rejects.toThrow('非法文档 id')
    await expect(saveModelerDoc(root, 'a/b', '{}')).rejects.toThrow('非法文档 id')
  })
})

describe('autosaveModelerDoc', () => {
  it('写入与删除影子文件', async () => {
    await autosaveModelerDoc(root, 'doc-b', '{"auto":true}')
    expect(readFileSync(autosaveFile('doc-b'), 'utf8')).toBe('{"auto":true}')
    await autosaveModelerDoc(root, 'doc-b', null)
    expect(existsSync(autosaveFile('doc-b'))).toBe(false)
  })

  it('删除不存在的影子文件不报错', async () => {
    await expect(autosaveModelerDoc(root, 'doc-b', null)).resolves.toBeUndefined()
  })
})

describe('checkModelerDocRecovery', () => {
  it('无任何文件：hasAutosave=false，mtime 全 null', async () => {
    const info = await checkModelerDocRecovery(root, 'doc-c')
    expect(info).toEqual({ hasAutosave: false, autosaveMtime: null, docMtime: null })
  })

  it('autosave 存在且比主文件新：可据此提示恢复', async () => {
    await saveModelerDoc(root, 'doc-c', '{"v":1}')
    // 人为制造时间差：先写主文件，稍后再写 autosave
    await new Promise((r) => setTimeout(r, 20))
    await autosaveModelerDoc(root, 'doc-c', '{"v":2}')
    const info = await checkModelerDocRecovery(root, 'doc-c')
    expect(info.hasAutosave).toBe(true)
    expect(info.autosaveMtime).toBeGreaterThan(info.docMtime ?? 0)
  })
})

/* ---------------------------------------------------------------------- */
/* P1②：revision 乐观锁（ETag 内容哈希）                                   */
/* ---------------------------------------------------------------------- */

describe('computeModelerRevision / readModelerRevision', () => {
  it('哈希确定性：同内容同 revision，不同内容不同 revision', () => {
    expect(computeModelerRevision('{"a":1}')).toBe(computeModelerRevision('{"a":1}'))
    expect(computeModelerRevision('{"a":1}')).not.toBe(computeModelerRevision('{"a":2}'))
    expect(computeModelerRevision('')).toMatch(/^[0-9a-f]{16}$/)
  })

  it('readModelerRevision：文档不存在为 null，存在即内容哈希', async () => {
    expect(await readModelerRevision(root, 'doc-r')).toBeNull()
    await saveModelerDoc(root, 'doc-r', '{"v":1}')
    expect(await readModelerRevision(root, 'doc-r')).toBe(computeModelerRevision('{"v":1}'))
  })
})

describe('saveModelerDoc 乐观锁（P1②）', () => {
  it('不带 expectedRevision：不校验（权威写入/历史调用兼容），返回新 revision', async () => {
    const r1 = await saveModelerDoc(root, 'doc-l', '{"v":1}')
    expect(r1.revision).toBe(computeModelerRevision('{"v":1}'))
    const r2 = await saveModelerDoc(root, 'doc-l', '{"v":2}')
    expect(r2.revision).toBe(computeModelerRevision('{"v":2}'))
  })

  it('基线匹配：正常写盘并返回新 revision（连续两次乐观锁保存）', async () => {
    const r1 = await saveModelerDoc(root, 'doc-l', '{"v":1}', { expectedRevision: null })
    const r2 = await saveModelerDoc(root, 'doc-l', '{"v":2}', { expectedRevision: r1.revision })
    expect(readFileSync(docFile('doc-l'), 'utf8')).toBe('{"v":2}')
    expect(await readModelerRevision(root, 'doc-l')).toBe(r2.revision)
  })

  it('基线过期：拒绝写盘、不产生备份、附当前 revision', async () => {
    await saveModelerDoc(root, 'doc-l', '{"v":1}')
    const stale = computeModelerRevision('{"v":1}')
    await saveModelerDoc(root, 'doc-l', '{"v":2}') // 另一来源先改了
    const err = await saveModelerDoc(root, 'doc-l', '{"v":9}', { expectedRevision: stale }).catch((e) => e)
    expect(err).toBeInstanceOf(ModelerConflictError)
    expect((err as ModelerConflictError).currentRevision).toBe(computeModelerRevision('{"v":2}'))
    expect((err as Error).message).toContain('保存已拒绝')
    // 主文件未被覆盖，且没有产生新备份
    expect(readFileSync(docFile('doc-l'), 'utf8')).toBe('{"v":2}')
    expect(backupNames('doc-l')).toHaveLength(1)
  })

  it('expectedRevision=null 但文档已存在：冲突（新建首存语义）', async () => {
    await saveModelerDoc(root, 'doc-l', '{"v":1}')
    await expect(saveModelerDoc(root, 'doc-l', '{"v":2}', { expectedRevision: null })).rejects.toThrow(
      ModelerConflictError
    )
  })

  it('expectedRevision=null 且文档不存在：放行（真实首存）', async () => {
    const r = await saveModelerDoc(root, 'doc-l', '{"v":1}', { expectedRevision: null })
    expect(r.revision).toBe(computeModelerRevision('{"v":1}'))
  })
})
