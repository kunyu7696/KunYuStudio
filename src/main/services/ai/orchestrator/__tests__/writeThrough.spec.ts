/**
 * T1 write-through 端口单测：
 * - write 即时落盘 + onFileWritten 事实上报（path/action/字节数）
 * - modify 首次写入前快照原文；同一文件多次提交快照只记首次
 * - rollback：create → 删文件；modify → 恢复首次写入前快照；幂等跳过未知路径
 * - written() 集合随写入/回滚增减（终点统一写盘循环去重的依据）
 */
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createWriteThrough, type FileWrittenInfo } from '../writeThrough'

/** 与生产 writeFileSafe 同语义：先建父目录再写 */
const fakeWriteFile = (abs: string, content: string): void => {
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, content, 'utf8')
}

describe('writeThrough（T1 即时写盘）', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'kunyu-wt-'))
  })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  const make = (events: FileWrittenInfo[]) =>
    createWriteThrough({
      projectRoot: root,
      writeFile: fakeWriteFile,
      onFileWritten: (info) => events.push(info)
    })

  it('write 即时落盘并上报 file-written 事实', () => {
    const events: FileWrittenInfo[] = []
    const wt = make(events)
    wt.write('src/main/java/com/x/Foo.java', 'create', 'class Foo {}\n')

    expect(readFileSync(join(root, 'src/main/java/com/x/Foo.java'), 'utf8')).toBe('class Foo {}\n')
    expect(events).toEqual([
      { path: 'src/main/java/com/x/Foo.java', action: 'create', bytes: Buffer.byteLength('class Foo {}\n', 'utf8') }
    ])
    expect(wt.written().has('src/main/java/com/x/Foo.java')).toBe(true)
  })

  it('modify 同文件多次提交：内容以最后一次为准，快照只记首次原文', () => {
    const target = join(root, 'a.java')
    writeFileSync(target, 'ORIGINAL', 'utf8')
    const wt = make([])

    wt.write('a.java', 'modify', 'V1')
    wt.write('a.java', 'modify', 'V2')
    expect(readFileSync(target, 'utf8')).toBe('V2')

    wt.rollback(['a.java'])
    // 恢复快照=首次写入前的 ORIGINAL，而不是中间态 V1
    expect(readFileSync(target, 'utf8')).toBe('ORIGINAL')
    expect(wt.written().size).toBe(0)
  })

  it('rollback create：删除已创建的文件', () => {
    const wt = make([])
    wt.write('new.txt', 'create', 'hello')
    expect(existsSync(join(root, 'new.txt'))).toBe(true)

    wt.rollback(['new.txt'])
    expect(existsSync(join(root, 'new.txt'))).toBe(false)
    expect(wt.written().has('new.txt')).toBe(false)
  })

  it('rollback modify：恢复既有文件原文', () => {
    const target = join(root, 'old.txt')
    writeFileSync(target, ' before ', 'utf8')
    const wt = make([])
    wt.write('old.txt', 'modify', 'after')

    wt.rollback(['old.txt'])
    expect(readFileSync(target, 'utf8')).toBe(' before ')
  })

  it('rollback 幂等：未知/已回滚路径静默跳过', () => {
    const wt = make([])
    wt.write('x.txt', 'create', '1')
    wt.rollback(['never-written.txt']) // 未写过的路径不抛错
    wt.rollback(['x.txt'])
    wt.rollback(['x.txt']) // 重复回滚同一路径不抛错
    expect(existsSync(join(root, 'x.txt'))).toBe(false)
  })

  it('onFileWritten 缺省时 write 不依赖回调', () => {
    const wt = createWriteThrough({ projectRoot: root, writeFile: fakeWriteFile })
    wt.write('s.txt', 'create', 'v')
    expect(readFileSync(join(root, 's.txt'), 'utf8')).toBe('v')
  })

  it('writeFile 抛错时向上传播（工具层转 ok:false），且不计入 written', () => {
    const wt = createWriteThrough({
      projectRoot: root,
      writeFile: () => {
        throw new Error('EPERM')
      }
    })
    expect(() => wt.write('f.txt', 'create', 'v')).toThrow('EPERM')
    expect(wt.written().has('f.txt')).toBe(false)
  })
})

describe('writeThrough · T2 snapshotOf（对比/回滚快照读取口）', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'kunyu-wt-snap-'))
  })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  const make = () => createWriteThrough({ projectRoot: root, writeFile: fakeWriteFile })

  it('modify：snapshotOf 返回首次写入前的原文（多次提交仍是最初原文）', () => {
    writeFileSync(join(root, 'm.java'), 'ORIGINAL', 'utf8')
    const wt = make()
    wt.write('m.java', 'modify', 'V1')
    wt.write('m.java', 'modify', 'V2')
    expect(wt.snapshotOf('m.java')).toBe('ORIGINAL')
  })

  it('create：snapshotOf 返回 null（原文不存在，回滚=删文件）', () => {
    const wt = make()
    wt.write('c.java', 'create', 'class C {}\n')
    expect(wt.snapshotOf('c.java')).toBeNull()
  })

  it('未 write-through 过的路径返回 undefined', () => {
    const wt = make()
    expect(wt.snapshotOf('never.java')).toBeUndefined()
  })

  it('rollback 后快照被消费：snapshotOf 回到 undefined（防重复回滚）', () => {
    writeFileSync(join(root, 'r.java'), 'BEFORE', 'utf8')
    const wt = make()
    wt.write('r.java', 'modify', 'AFTER')
    wt.rollback(['r.java'])
    expect(wt.snapshotOf('r.java')).toBeUndefined()
  })
})
