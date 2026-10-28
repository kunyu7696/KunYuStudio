/**
 * shaderpackService 文件系统冒烟测试：
 * embedded（模组内嵌 shaderpacks/<packId>）与 standalone（项目根）两种布局的
 * 初始化、着色器文件读写删、安全路径校验，以及存量 standalone 光影包自动升级。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  deleteShaderFile,
  exportShaderPackZip,
  initShaderPack,
  listShaderFiles,
  readShaderFile,
  readShaderPackMeta,
  upgradeStandaloneShaderPack,
  writeShaderFile
} from '../shaderpackService'
import { registerProjectRoot, unregisterProjectRoot } from '../fsService'
import { openZip } from '../performance/jarReader'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ky-sp-svc-'))
  registerProjectRoot(root)
})

afterEach(() => {
  unregisterProjectRoot(root)
  rmSync(root, { recursive: true, force: true })
})

describe('光影包 embedded（模组内嵌）闭环', () => {
  it('init：元数据、shaderpacks/<packId>/shaders 目录与占位 properties（幂等）', () => {
    const meta = initShaderPack(root, {
      packId: 'my_shaders',
      name: 'My Shaders',
      loader: 'iris',
      mcVersion: '1.20.1',
      version: '1.0.0',
      description: '测试光影'
    })
    expect(meta.packId).toBe('my_shaders')
    const shaders = join(root, 'shaderpacks', 'my_shaders', 'shaders')
    expect(existsSync(shaders)).toBe(true)
    expect(existsSync(join(shaders, 'lib'))).toBe(true)
    expect(existsSync(join(shaders, 'lang'))).toBe(true)
    const propsPath = join(shaders, 'shaders.properties')
    expect(existsSync(propsPath)).toBe(true)
    expect(readFileSync(propsPath, 'utf-8')).toContain('My Shaders')

    // properties 已存在时不覆盖
    writeFileSync(propsPath, '# keep mine\n')
    initShaderPack(root, {
      packId: 'my_shaders',
      name: 'My Shaders',
      mcVersion: '1.20.1',
      description: '新描述'
    })
    expect(readFileSync(propsPath, 'utf-8')).toContain('keep mine')
  })

  it('管线文件写读删闭环，且出现在文件列表', () => {
    initShaderPack(root, {
      packId: 'my_shaders',
      name: 'My Shaders',
      mcVersion: '1.20.1',
      description: ''
    })
    const rel = 'shaders/gbuffers_terrain.fsh'
    const node = writeShaderFile(root, rel, 'void main() {}')
    expect(node.category).toBe('gbuffers')
    expect(node.ext).toBe('.fsh')
    const abs = join(root, 'shaderpacks', 'my_shaders', rel)
    expect(existsSync(abs)).toBe(true)
    expect(readShaderFile(root, rel)).toContain('void main')

    const files = listShaderFiles(root)
    expect(files.some((f) => f.relPath === rel && f.category === 'gbuffers')).toBe(true)
    // shaders.properties 也在列表中，归类 config
    expect(files.some((f) => f.relPath === 'shaders/shaders.properties' && f.category === 'config')).toBe(true)

    expect(deleteShaderFile(root, rel)).toBe(true)
    expect(listShaderFiles(root).some((f) => f.relPath === rel)).toBe(false)
  })

  it('lib 子目录文件可写读；shaders.properties 禁删；越界/非法类型拒绝', () => {
    initShaderPack(root, {
      packId: 'my_shaders',
      name: 'My Shaders',
      mcVersion: '1.20.1',
      description: ''
    })
    writeShaderFile(root, 'shaders/lib/common.glsl', '#version 150')
    expect(readShaderFile(root, 'shaders/lib/common.glsl')).toContain('#version')

    expect(() => deleteShaderFile(root, 'shaders/shaders.properties')).toThrow()
    expect(() => writeShaderFile(root, 'outside.txt', 'x')).toThrow()
    expect(() => writeShaderFile(root, 'shaders/../escape.fsh', 'x')).toThrow()
    expect(() => writeShaderFile(root, 'shaders/Bad-Name.fsh', 'x')).toThrow()
    expect(() => writeShaderFile(root, 'shaders/notes.md', 'x')).toThrow()
  })
})

describe('光影包 standalone（独立项目）闭环', () => {
  it('init：根即包根（shaders/ 平铺），packId 固定 default', () => {
    const meta = initShaderPack(
      root,
      { name: 'Standalone Shaders', mcVersion: '1.21.1', description: '独立光影' },
      'standalone'
    )
    expect(meta.packId).toBe('default')
    expect(existsSync(join(root, 'shaders', 'shaders.properties'))).toBe(true)
    expect(existsSync(join(root, 'shaders', 'lib'))).toBe(true)
    // 不应产生 shaderpacks 目录
    expect(existsSync(join(root, 'shaderpacks'))).toBe(false)
    expect(readShaderPackMeta(root)?.mcVersion).toBe('1.21.1')
  })

  it('文件写读删在 standalone 根路径下闭环', () => {
    initShaderPack(root, { name: 'P', mcVersion: '1.20.1', description: '' }, 'standalone')
    const rel = 'shaders/composite.fsh'
    writeShaderFile(root, rel, '/* composite */', 'standalone')
    expect(existsSync(join(root, rel))).toBe(true)
    expect(readShaderFile(root, rel, 'standalone')).toContain('composite')
    expect(listShaderFiles(root, 'standalone').some((f) => f.relPath === rel)).toBe(true)
    expect(deleteShaderFile(root, rel, 'standalone')).toBe(true)
  })

  it('upgrade：存在 shaders/ 但无元数据时推导默认 meta 并补全目录', () => {
    // 存量外部光影包：根 shaders/ 下已有管线文件
    mkdirSync(join(root, 'shaders'), { recursive: true })
    writeFileSync(join(root, 'shaders', 'gbuffers_terrain.fsh'), 'void main(){}')

    const upgraded = upgradeStandaloneShaderPack(root)
    expect(upgraded).not.toBeNull()
    expect(upgraded?.packId).toBe('default')
    expect(upgraded?.mcVersion).toBe('1.20.1')
    expect(upgraded?.loader).toBe('iris')
    expect(existsSync(join(root, '.kunyu', 'shaderpack.json'))).toBe(true)
    expect(existsSync(join(root, 'shaders', 'lib'))).toBe(true)
    expect(existsSync(join(root, 'shaders', 'shaders.properties'))).toBe(true)
    // 已有文件未被破坏，且进入文件列表
    expect(listShaderFiles(root, 'standalone').some((f) => f.relPath === 'shaders/gbuffers_terrain.fsh')).toBe(true)
    // 幂等
    expect(upgradeStandaloneShaderPack(root)?.packId).toBe('default')
  })

  it('upgrade：无 shaders/ 目录时无法识别，返回 null', () => {
    expect(upgradeStandaloneShaderPack(root)).toBeNull()
  })
})

describe('光影包 world*/properties 收录（P1-3）', () => {
  it('init 创建 world0/world-1/world1 目录（nether/the_end 非法目录名已移除）', () => {
    initShaderPack(root, { name: 'W', mcVersion: '1.20.1', description: '' }, 'standalone')
    const shaders = join(root, 'shaders')
    expect(existsSync(join(shaders, 'world0'))).toBe(true)
    expect(existsSync(join(shaders, 'world-1'))).toBe(true)
    expect(existsSync(join(shaders, 'world1'))).toBe(true)
    expect(existsSync(join(shaders, 'world_nether'))).toBe(false)
    expect(existsSync(join(shaders, 'world_the_end'))).toBe(false)
  })

  it('顶层 block/item/entity.properties 收录为 config', () => {
    initShaderPack(root, { name: 'W', mcVersion: '1.20.1', description: '' }, 'standalone')
    writeShaderFile(root, 'shaders/block.properties', 'block.1=stone\n', 'standalone')
    writeShaderFile(root, 'shaders/item.properties', 'item.1=stick\n', 'standalone')
    writeShaderFile(root, 'shaders/entity.properties', 'entity.1=zombie\n', 'standalone')
    const files = listShaderFiles(root, 'standalone')
    expect(files.some((f) => f.relPath === 'shaders/block.properties' && f.category === 'config')).toBe(true)
    expect(files.some((f) => f.relPath === 'shaders/item.properties' && f.category === 'config')).toBe(true)
    expect(files.some((f) => f.relPath === 'shaders/entity.properties' && f.category === 'config')).toBe(true)
  })

  it('世界子目录管线文件收录并按前缀分类', () => {
    initShaderPack(root, { name: 'W', mcVersion: '1.20.1', description: '' }, 'standalone')
    writeShaderFile(root, 'shaders/world0/gbuffers_terrain.fsh', 'void main(){}', 'standalone')
    writeShaderFile(root, 'shaders/world-1/composite.fsh', 'void main(){}', 'standalone')
    writeShaderFile(root, 'shaders/world1/shadowcomp.fsh', 'void main(){}', 'standalone')
    const files = listShaderFiles(root, 'standalone')
    expect(files.some((f) => f.relPath === 'shaders/world0/gbuffers_terrain.fsh' && f.category === 'gbuffers')).toBe(true)
    expect(files.some((f) => f.relPath === 'shaders/world-1/composite.fsh' && f.category === 'composite')).toBe(true)
    expect(files.some((f) => f.relPath === 'shaders/world1/shadowcomp.fsh' && f.category === 'shadowcomp')).toBe(true)
  })

  it('.csh/.inc 白名单收录；.png 走二进制 data URL 往返', () => {
    initShaderPack(root, { name: 'W', mcVersion: '1.20.1', description: '' }, 'standalone')
    writeShaderFile(root, 'shaders/lib/common.inc', '#include guard\n', 'standalone')
    writeShaderFile(root, 'shaders/shadowcomp.csh', 'void main(){}', 'standalone')
    const files = listShaderFiles(root, 'standalone')
    expect(files.some((f) => f.relPath === 'shaders/lib/common.inc')).toBe(true)
    expect(files.some((f) => f.relPath === 'shaders/shadowcomp.csh')).toBe(true)

    // 1×1 透明 PNG（合法字节）→ data URL 写入 → 原样读回
    const png1x1 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
    const dataUrl = `data:image/png;base64,${png1x1}`
    writeShaderFile(root, 'shaders/noise.png', dataUrl, 'standalone')
    expect(readShaderFile(root, 'shaders/noise.png', 'standalone')).toBe(dataUrl)
    expect(listShaderFiles(root, 'standalone').some((f) => f.relPath === 'shaders/noise.png')).toBe(true)

    // 文本内容写 .png 必须拒绝（防二进制被写坏）
    expect(() => writeShaderFile(root, 'shaders/bad.png', 'not-a-png', 'standalone')).toThrow(/data:image\/png/)
    // 非 PNG 魔数的 base64 必须拒绝
    expect(() =>
      writeShaderFile(root, 'shaders/bad.png', 'data:image/png;base64,AAAAAAAAAAAA', 'standalone')
    ).toThrow(/PNG 文件头/)
  })

  it('世界子目录 shaders.properties 收录为 config', () => {
    initShaderPack(root, { name: 'W', mcVersion: '1.20.1', description: '' }, 'standalone')
    writeShaderFile(root, 'shaders/world0/shaders.properties', 'name=W\n', 'standalone')
    const files = listShaderFiles(root, 'standalone')
    expect(files.some((f) => f.relPath === 'shaders/world0/shaders.properties' && f.category === 'config')).toBe(true)
  })

  it('世界子目录非管线 .properties 不收录（仅 shaders.properties 收录）', () => {
    initShaderPack(root, { name: 'W', mcVersion: '1.20.1', description: '' }, 'standalone')
    // 手动写入非白名单 properties（绕过 collect 验证收录行为）
    const dir = join(root, 'shaders', 'world0')
    writeFileSync(join(dir, 'random.properties'), 'x=1\n')
    const files = listShaderFiles(root, 'standalone')
    expect(files.some((f) => f.relPath === 'shaders/world0/random.properties')).toBe(false)
  })
})

describe('光影包导出可分发 zip', () => {
  it('embedded：zip 顶层为 shaders/，不含 .kunyu 与外层包名目录', () => {
    initShaderPack(root, {
      packId: 'my_shaders',
      name: 'My Shaders',
      mcVersion: '1.20.1',
      description: ''
    })
    writeShaderFile(root, 'shaders/gbuffers_terrain.fsh', 'void main() {}')

    const out = exportShaderPackZip(root)
    expect(out).toBe(join(root, 'dist', 'my_shaders.zip'))
    expect(existsSync(out)).toBe(true)
    const paths = openZip(out).entries().map((e) => e.path)
    expect(paths.some((p) => p === 'shaders/shaders.properties')).toBe(true)
    expect(paths.some((p) => p === 'shaders/gbuffers_terrain.fsh')).toBe(true)
    // 编辑器元数据与外层目录不得混入可分发产物
    expect(paths.some((p) => p.includes('.kunyu'))).toBe(false)
    expect(paths.some((p) => p.startsWith('my_shaders/'))).toBe(false)
  })

  it('standalone：产物 dist/default.zip，内容字节与源文件一致', () => {
    initShaderPack(root, { name: 'P', mcVersion: '1.21.1', description: '' }, 'standalone')
    writeShaderFile(root, 'shaders/composite.fsh', '/* hi */', 'standalone')
    const out = exportShaderPackZip(root, 'standalone')
    expect(out).toBe(join(root, 'dist', 'default.zip'))
    const zip = openZip(out)
    expect(zip.read('shaders/composite.fsh').toString('utf8')).toContain('/* hi */')
  })

  it('未初始化光影包时拒绝导出', () => {
    expect(() => exportShaderPackZip(root)).toThrow(/尚未创建光影包/)
  })
})
