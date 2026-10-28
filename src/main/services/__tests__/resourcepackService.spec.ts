/**
 * resourcepackService 文件系统冒烟测试：
 * 创建资源包 → pack.mcmeta 正确生成 → 写文件 → 文件树浏览 → 图标导入 → 删除。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  deleteResourceFile,
  exportResourcePackZip,
  importPackIcon,
  importResourceSound,
  initResourcePack,
  listResourceFiles,
  readResourceFile,
  readResourcePackMeta,
  readResourceSound,
  upgradeStandaloneResourcePack,
  writeResourceFile
} from '../resourcepackService'
import { registerProjectRoot, unregisterProjectRoot } from '../fsService'
import { openZip } from '../performance/jarReader'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ky-rp-svc-'))
  registerProjectRoot(root)
})

afterEach(() => {
  unregisterProjectRoot(root)
  rmSync(root, { recursive: true, force: true })
})

describe('资源包 P0 验收闭环', () => {
  it('init：生成元数据、pack.mcmeta（pack_format 正确）与标准目录，且幂等', () => {
    const meta = initResourcePack(root, {
      packId: 'my_pack',
      name: 'My Pack',
      mcVersion: '1.20.1',
      description: '测试包',
      namespace: 'mymod'
    })
    expect(meta.packFormat).toBe(15)
    expect(readResourcePackMeta(root)?.packId).toBe('my_pack')

    const mcmetaPath = join(root, 'resourcepacks', 'my_pack', 'pack.mcmeta')
    expect(existsSync(mcmetaPath)).toBe(true)
    const parsed = JSON.parse(readFileSync(mcmetaPath, 'utf-8')) as {
      pack: { pack_format: number; description: string }
    }
    expect(parsed.pack.pack_format).toBe(15)
    expect(parsed.pack.description).toBe('测试包')

    expect(existsSync(join(root, 'resourcepacks', 'my_pack', 'assets', 'mymod', 'models', 'block'))).toBe(true)
    expect(existsSync(join(root, 'resourcepacks', 'my_pack', 'assets', 'mymod', 'textures', 'item'))).toBe(true)

    // 再次 init 不覆盖已存在的 pack.mcmeta（描述被改写后仍保留）
    writeFileSync(mcmetaPath, '{"pack":{"pack_format":15,"description":"保留我"}}')
    initResourcePack(root, {
      packId: 'my_pack',
      name: 'My Pack',
      mcVersion: '1.20.1',
      description: '新描述',
      namespace: 'mymod'
    })
    expect(readFileSync(mcmetaPath, 'utf-8')).toContain('保留我')
  })

  it('写模型文件后，文件树按分类浏览并可读回', async () => {
    initResourcePack(root, {
      packId: 'my_pack',
      name: 'My Pack',
      mcVersion: '1.21.1',
      description: '',
      namespace: 'mymod'
    })
    const rel = 'assets/mymod/models/block/ruby_ore.json'
    const written = await writeResourceFile(root, rel, '{"parent":"block/cube_all"}')
    expect(written.category).toBe('model')
    expect(written.id).toBe('block/ruby_ore')
    expect(written.editable).toBe(true)
    expect(await readResourceFile(root, rel)).toContain('cube_all')

    const files = await listResourceFiles(root)
    expect(files.some((f) => f.relPath === 'pack.mcmeta' && f.category === 'root')).toBe(true)
    const model = files.find((f) => f.relPath === rel)
    expect(model?.ext).toBe('.json')
  })

  it('pack.mcmeta 禁止删除；普通文件可删；路径穿越被拒绝', async () => {
    initResourcePack(root, {
      packId: 'my_pack',
      name: 'My Pack',
      mcVersion: '1.20.1',
      description: '',
      namespace: 'mymod'
    })
    const rel = 'assets/mymod/lang/zh_cn.json'
    await writeResourceFile(root, rel, '{}')
    expect(await deleteResourceFile(root, rel)).toBe(true)
    expect((await listResourceFiles(root)).some((f) => f.relPath === rel)).toBe(false)

    expect(() => deleteResourceFile(root, 'pack.mcmeta')).toThrow()
    expect(() => writeResourceFile(root, '../escape.json', '{}')).toThrow()
  })

  it('导入 PNG 为 pack.png 并出现在文件树', async () => {
    initResourcePack(root, {
      packId: 'my_pack',
      name: 'My Pack',
      mcVersion: '1.20.1',
      description: '',
      namespace: 'mymod'
    })
    const src = join(root, 'source.png')
    writeFileSync(src, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    expect(await importPackIcon(root, src)).toBe('pack.png')
    const files = await listResourceFiles(root)
    const icon = files.find((f) => f.relPath === 'pack.png')
    expect(icon?.category).toBe('root')
    expect(icon?.editable).toBe(false)

    writeFileSync(join(root, 'a.txt'), 'x')
    expect(() => importPackIcon(root, join(root, 'a.txt'))).toThrow('PNG')
  })
})

describe('资源包 standalone（独立项目）闭环', () => {
  it('init：根即包根（pack.mcmeta + assets），packId 固定 default', () => {
    const meta = initResourcePack(
      root,
      { name: 'Standalone Pack', mcVersion: '1.21.1', description: '独立', namespace: 'standns' },
      'standalone'
    )
    expect(meta.packId).toBe('default')
    expect(meta.packFormat).toBe(34)
    expect(existsSync(join(root, 'pack.mcmeta'))).toBe(true)
    expect(existsSync(join(root, 'assets', 'standns', 'models', 'block'))).toBe(true)
    // 不应产生 resourcepacks 目录
    expect(existsSync(join(root, 'resourcepacks'))).toBe(false)
    // 元数据仍统一落 .kunyu
    expect(readResourcePackMeta(root)?.namespace).toBe('standns')
  })

  it('读写删在 standalone 根路径下闭环', async () => {
    initResourcePack(
      root,
      { name: 'P', mcVersion: '1.20.1', description: '', namespace: 'mymod' },
      'standalone'
    )
    const rel = 'assets/mymod/blockstates/ruby_ore.json'
    await writeResourceFile(root, rel, '{"variants":{}}', 'standalone')
    expect(await readResourceFile(root, rel, 'standalone')).toContain('variants')
    const files = await listResourceFiles(root, 'standalone')
    expect(files.some((f) => f.relPath === rel)).toBe(true)
    expect(await deleteResourceFile(root, rel, 'standalone')).toBe(true)
    expect(() => deleteResourceFile(root, 'pack.mcmeta', 'standalone')).toThrow()
  })

  it('upgrade：从现有 pack.mcmeta + assets 推导元数据并补全目录', () => {
    // 旧占位/外部资源包：根 pack.mcmeta + assets/old_pack 下已有文件
    writeFileSync(
      join(root, 'pack.mcmeta'),
      JSON.stringify({ pack: { pack_format: 34, description: '外部包' } })
    )
    mkdirSync(join(root, 'assets', 'old_pack', 'models', 'block'), { recursive: true })
    writeFileSync(join(root, 'assets', 'old_pack', 'models', 'block', 'x.json'), '{}')

    const upgraded = upgradeStandaloneResourcePack(root)
    expect(upgraded).not.toBeNull()
    expect(upgraded?.namespace).toBe('old_pack')
    expect(upgraded?.mcVersion).toBe('1.21.1')
    expect(upgraded?.packId).toBe('default')
    expect(upgraded?.description).toBe('外部包')
    // 元数据落盘；标准目录补全
    expect(existsSync(join(root, '.kunyu', 'resourcepack.json'))).toBe(true)
    expect(existsSync(join(root, 'assets', 'old_pack', 'sounds'))).toBe(true)
    // 二次调用返回现有 meta（幂等）
    expect(upgradeStandaloneResourcePack(root)?.namespace).toBe('old_pack')
  })

  it('upgrade：无 pack.mcmeta 时无法识别，返回 null', () => {
    expect(upgradeStandaloneResourcePack(root)).toBeNull()
  })
})

describe('资源包导出可分发 zip', () => {
  it('embedded：zip 顶层为 pack.mcmeta + assets/，不含 .kunyu 与外层包名目录', async () => {
    initResourcePack(root, {
      packId: 'my_pack',
      name: 'My Pack',
      mcVersion: '1.20.1',
      description: '导出测试',
      namespace: 'mymod'
    })
    await writeResourceFile(root, 'assets/mymod/lang/zh_cn.json', '{"a":"b"}')

    const out = exportResourcePackZip(root)
    expect(out).toBe(join(root, 'dist', 'my_pack.zip'))
    expect(existsSync(out)).toBe(true)
    const paths = openZip(out).entries().map((e) => e.path)
    expect(paths.some((p) => p === 'pack.mcmeta')).toBe(true)
    expect(paths.some((p) => p === 'assets/mymod/lang/zh_cn.json')).toBe(true)
    // 编辑器元数据、外层包名目录、产物目录自身均不得混入可分发 zip
    expect(paths.some((p) => p.includes('.kunyu'))).toBe(false)
    expect(paths.some((p) => p.startsWith('my_pack/'))).toBe(false)
    expect(paths.some((p) => p.startsWith('dist/'))).toBe(false)
  })

  it('standalone：白名单过滤——.kunyu/ 与杂散文件不入包', async () => {
    initResourcePack(
      root,
      { name: 'P', mcVersion: '1.21.1', description: '', namespace: 'standns' },
      'standalone'
    )
    await writeResourceFile(root, 'assets/standns/blockstates/x.json', '{}', 'standalone')
    // 项目根杂散文件（非包内容）必须被白名单挡掉
    writeFileSync(join(root, 'README.md'), '# 说明')

    const out = exportResourcePackZip(root, 'standalone')
    expect(out).toBe(join(root, 'dist', 'default.zip'))
    const zip = openZip(out)
    const paths = zip.entries().map((e) => e.path)
    expect(zip.read('pack.mcmeta')).not.toBeNull()
    expect(paths.some((p) => p === 'assets/standns/blockstates/x.json')).toBe(true)
    expect(paths.some((p) => p.includes('.kunyu'))).toBe(false)
    expect(paths.some((p) => p === 'README.md')).toBe(false)
  })

  it('pack.png 存在时随包导出', async () => {
    initResourcePack(root, {
      packId: 'icon_pack',
      name: 'Icon',
      mcVersion: '1.20.1',
      description: '',
      namespace: 'mymod'
    })
    // 最小合法 PNG（1x1，来自 importPackIcon 测试同款）
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    )
    writeFileSync(join(root, 'icon_src.png'), png)
    importPackIcon(root, join(root, 'icon_src.png'))

    const paths = openZip(exportResourcePackZip(root)).entries().map((e) => e.path)
    expect(paths.some((p) => p === 'pack.png')).toBe(true)
  })

  it('未初始化资源包时拒绝导出', () => {
    expect(() => exportResourcePackZip(root)).toThrow(/尚未创建资源包/)
  })
})

describe('资源包音效导入与试听', () => {
  const oggBytes = Buffer.from('OggS' + 'x'.repeat(60), 'utf-8')

  it('importResourceSound：.ogg 落位 assets/<ns>/sounds/ 并可 readResourceSound 读回 data URL', () => {
    initResourcePack(root, {
      packId: 'my_pack',
      name: 'My Pack',
      mcVersion: '1.21.1',
      description: '',
      namespace: 'mymod'
    })
    const src = join(root, 'click.ogg')
    writeFileSync(src, oggBytes)

    const rel = importResourceSound(root, src)
    expect(rel).toBe('assets/mymod/sounds/click.ogg')
    expect(existsSync(join(root, 'resourcepacks', 'my_pack', 'assets', 'mymod', 'sounds', 'click.ogg'))).toBe(true)

    const dataUrl = readResourceSound(root, rel)
    expect(dataUrl.startsWith('data:audio/ogg;base64,')).toBe(true)
    expect(Buffer.from(dataUrl.slice('data:audio/ogg;base64,'.length), 'base64')).toEqual(oggBytes)
  })

  it('拒绝非 .ogg / 文件名主干不合法 / 源文件不存在', () => {
    initResourcePack(root, {
      packId: 'my_pack',
      name: 'My Pack',
      mcVersion: '1.21.1',
      description: '',
      namespace: 'mymod'
    })
    const mp3 = join(root, 'click.mp3')
    writeFileSync(mp3, oggBytes)
    expect(() => importResourceSound(root, mp3)).toThrow(/\.ogg/)

    const badName = join(root, 'Click-Me.ogg')
    writeFileSync(badName, oggBytes)
    expect(() => importResourceSound(root, badName)).toThrow(/不合法/)

    expect(() => importResourceSound(root, join(root, 'ghost.ogg'))).toThrow(/不存在/)
  })

  it('readResourceSound：拒绝非 .ogg / 不存在的文件 / 路径穿越', () => {
    initResourcePack(root, {
      packId: 'my_pack',
      name: 'My Pack',
      mcVersion: '1.21.1',
      description: '',
      namespace: 'mymod'
    })
    expect(() => readResourceSound(root, 'assets/mymod/textures/item/x.png')).toThrow(/\.ogg/)
    expect(() => readResourceSound(root, 'assets/mymod/sounds/ghost.ogg')).toThrow(/不存在/)
    expect(() => readResourceSound(root, '../outside.ogg')).toThrow()
  })
})
