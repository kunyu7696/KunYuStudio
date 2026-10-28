import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 项目列表来自 projectService：单测mock，指向临时目录
vi.mock('../projectService', () => ({
  getAllProjects: vi.fn(() => [])
}))

import { getAllProjects } from '../projectService'
import { registerProjectRoot, unregisterProjectRoot } from '../fsService'
import { saveContent } from '../contentService'
import {
  exportCreation,
  importCreation,
  listCreations,
  previewSharePackage,
  readSharePackage,
  writeSharePackage
} from '../kunyuShareService'
import { createDefaultBlock } from '../../../shared/types/content'
import { createDefaultItem } from '../../../shared/schemas/item.schema'

const roots: string[] = []

/** 建临时项目根（注册 fsService 白名单 + fabric 元数据，满足 saveContent 校验上下文） */
function makeProject(name: string): string {
  const root = mkdtempSync(join(tmpdir(), `ky-share-${name}-`))
  registerProjectRoot(root)
  roots.push(root)
  const resources = join(root, 'src', 'main', 'resources')
  mkdirSync(resources, { recursive: true })
  writeFileSync(
    join(resources, 'fabric.mod.json'),
    JSON.stringify({ schemaVersion: 1, id: 'testmod', version: '1.0.0' })
  )
  writeFileSync(join(root, 'gradle.properties'), 'maven_group=com.kunyu.testmod\n')
  return root
}

afterEach(() => {
  while (roots.length) {
    const r = roots.pop()!
    unregisterProjectRoot(r)
    rmSync(r, { recursive: true, force: true })
  }
  vi.clearAllMocks()
})

describe('kunyuShareService — listCreations', () => {
  it('跨项目聚合语义创作并按更新时间倒序', () => {
    const p1 = makeProject('one')
    const p2 = makeProject('two')
    const item = createDefaultItem('ruby')
    saveContent(p1, item)
    const block = createDefaultBlock('ruby_ore')
    saveContent(p2, block)

    vi.mocked(getAllProjects).mockReturnValue([
      { id: '1', name: '项目一', type: 'mod', path: p1 },
      { id: '2', name: '项目二', type: 'mod', path: p2 }
    ] as ReturnType<typeof getAllProjects>)

    const list = listCreations()
    expect(list).toHaveLength(2)
    expect(list.map((c) => c.id).sort()).toEqual(['ruby', 'ruby_ore'])
    // 按更新时间倒序（同毫秒平局时容忍，不断言具体第一位）
    expect(list[0]!.updatedAt).toBeGreaterThanOrEqual(list[1]!.updatedAt)
    const ruby = list.find((c) => c.id === 'ruby')!
    expect(ruby.kind).toBe('item')
    expect(ruby.projectName).toBe('项目一')
    expect(ruby.displayName).toBeTruthy()
  })

  it('项目目录不存在时跳过而不整体失败', () => {
    const p1 = makeProject('ok')
    saveContent(p1, createDefaultItem('jade'))
    vi.mocked(getAllProjects).mockReturnValue([
      { id: '1', name: '好项目', type: 'mod', path: p1 },
      { id: '2', name: '幽灵项目', type: 'mod', path: join(tmpdir(), 'ky-share-nonexistent-dir') }
    ] as ReturnType<typeof getAllProjects>)
    const list = listCreations()
    expect(list).toHaveLength(1)
    expect(list[0]!.id).toBe('jade')
  })
})

describe('kunyuShareService — 分享包导出/读取', () => {
  it('导出包含 format 标识与完整语义内容', () => {
    const p = makeProject('exp')
    saveContent(p, createDefaultItem('topaz'))
    const pkg = exportCreation(p, 'item', 'topaz')
    expect(pkg.format).toBe('kunyu-share@1')
    expect(pkg.exportedAt).toBeTruthy()
    expect(pkg.content.kind).toBe('item')
    expect(pkg.content.id).toBe('topaz')
  })

  it('写入后可读回（往返一致），带 BOM 的文件也能解析', () => {
    const p = makeProject('roundtrip')
    saveContent(p, createDefaultBlock('jade_ore'))
    const pkg = exportCreation(p, 'block', 'jade_ore')
    const file = join(p, 'out.kyshare.json')
    writeSharePackage(file, pkg)
    expect(existsSync(file)).toBe(true)

    const back = readSharePackage(file)
    expect(back.content.id).toBe('jade_ore')

    // Windows 常见 BOM 前缀也能解析
    const bomFile = join(p, 'bom.kyshare.json')
    writeFileSync(bomFile, '\uFEFF' + readFileSync(file, 'utf-8'), 'utf-8')
    expect(readSharePackage(bomFile).content.id).toBe('jade_ore')
  })

  it('format 不符或内容损坏时抛中文错误', () => {
    const p = makeProject('bad')
    const f1 = join(p, 'a.json')
    writeFileSync(f1, JSON.stringify({ format: 'other@1', content: {} }), 'utf-8')
    expect(() => readSharePackage(f1)).toThrow('不是有效的 KunYu 分享包')

    const f2 = join(p, 'b.json')
    writeFileSync(
      f2,
      JSON.stringify({ format: 'kunyu-share@1', content: { kind: 'item', id: 'BAD ID!' } }),
      'utf-8'
    )
    expect(() => readSharePackage(f2)).toThrow('分享包内容损坏')
  })

  it('导出自动补 loader/mcVersion/provenance，许可证来自选项', () => {
    const p = makeProject('meta')
    saveContent(p, createDefaultItem('sapphire'))
    vi.mocked(getAllProjects).mockReturnValue([
      {
        id: '1',
        name: '元数据项目',
        type: 'mod',
        path: p,
        loader: 'fabric',
        mcVersion: '1.21.1'
      }
    ] as ReturnType<typeof getAllProjects>)

    const pkg = exportCreation(p, 'item', 'sapphire', { license: 'MIT' })
    expect(pkg.loader).toBe('fabric')
    expect(pkg.mcVersion).toBe('1.21.1')
    expect(pkg.license).toBe('MIT')
    expect(pkg.provenance).toContain('元数据项目')
  })

  it('项目未登记时导出仍成功，新字段缺省且不写入 JSON 键', () => {
    const p = makeProject('unreg')
    saveContent(p, createDefaultItem('citrine'))
    // getAllProjects 默认 mock 返回 []：路径未登记
    const pkg = exportCreation(p, 'item', 'citrine')
    expect(pkg.loader).toBeUndefined()
    expect(pkg.mcVersion).toBeUndefined()
    expect(pkg.license).toBeUndefined()
    expect(pkg.provenance).toBeUndefined()

    const file = join(p, 'unreg.kyshare.json')
    writeSharePackage(file, pkg)
    const raw = JSON.parse(readFileSync(file, 'utf-8')) as Record<string, unknown>
    expect('loader' in raw).toBe(false)
    expect('mcVersion' in raw).toBe(false)
    expect('license' in raw).toBe(false)
  })

  it('新字段序列化往返一致；旧包（无新字段）读取兼容', () => {
    const p = makeProject('compat')
    saveContent(p, createDefaultItem('garnet'))
    vi.mocked(getAllProjects).mockReturnValue([
      { id: '1', name: '往返项目', type: 'mod', path: p, loader: 'neoforge', mcVersion: '1.20.4' }
    ] as ReturnType<typeof getAllProjects>)

    const pkg = exportCreation(p, 'item', 'garnet', { license: 'CC-BY-4.0' })
    pkg.dependencies = ['fabric-api']
    const file = join(p, 'meta.kyshare.json')
    writeSharePackage(file, pkg)
    const back = readSharePackage(file)
    expect(back.loader).toBe('neoforge')
    expect(back.mcVersion).toBe('1.20.4')
    expect(back.license).toBe('CC-BY-4.0')
    expect(back.dependencies).toEqual(['fabric-api'])
    expect(back.provenance).toContain('往返项目')

    // 旧格式包：仅 format/exportedAt/content，读取与导入均不炸
    const oldFile = join(p, 'old.kyshare.json')
    writeFileSync(
      oldFile,
      JSON.stringify({
        format: 'kunyu-share@1',
        exportedAt: '2025-01-01T00:00:00.000Z',
        content: pkg.content
      }),
      'utf-8'
    )
    const oldPkg = readSharePackage(oldFile)
    expect(oldPkg.loader).toBeUndefined()
    expect(oldPkg.license).toBeUndefined()
    const dst = makeProject('old-dst')
    const r = importCreation(oldPkg, dst)
    expect(r.status).toBe('imported')
  })
})

describe('kunyuShareService — importCreation', () => {
  it('导入到空项目成功并落盘', () => {
    const src = makeProject('src')
    const dst = makeProject('dst')
    saveContent(src, createDefaultItem('amber'))
    const pkg = exportCreation(src, 'item', 'amber')

    const r = importCreation(pkg, dst)
    expect(r.status).toBe('imported')
    expect(r.id).toBe('amber')
    expect(existsSync(join(dst, '.kunyu', 'content', 'items', 'amber.json'))).toBe(true)
  })

  it('同 kind+id 冲突时返回 conflict，overwrite 后覆盖成功', () => {
    const src = makeProject('src2')
    const dst = makeProject('dst2')
    saveContent(src, createDefaultItem('opal'))
    saveContent(dst, createDefaultItem('opal'))
    const pkg = exportCreation(src, 'item', 'opal')

    const conflict = importCreation(pkg, dst)
    expect(conflict.status).toBe('conflict')
    expect(conflict.kind).toBe('item')

    const done = importCreation(pkg, dst, true)
    expect(done.status).toBe('imported')
    expect(done.id).toBe('opal')
  })

  it('不同 kind 的同 id 不构成冲突', () => {
    const src = makeProject('src3')
    const dst = makeProject('dst3')
    saveContent(src, createDefaultItem('pearl'))
    saveContent(dst, createDefaultBlock('pearl')) // 同 id 但 kind 不同
    const pkg = exportCreation(src, 'item', 'pearl')
    const r = importCreation(pkg, dst)
    expect(r.status).toBe('imported')
  })
})

describe('kunyuShareService — previewSharePackage', () => {
  it('返回包元数据且不向目标项目落盘', () => {
    const src = makeProject('pv-src')
    const dst = makeProject('pv-dst')
    saveContent(src, createDefaultItem('moonstone'))
    vi.mocked(getAllProjects).mockReturnValue([
      { id: '1', name: '预览源', type: 'mod', path: src, loader: 'forge', mcVersion: '1.20.1' }
    ] as ReturnType<typeof getAllProjects>)
    const pkg = exportCreation(src, 'item', 'moonstone', { license: 'LEARNING-ONLY' })

    const preview = previewSharePackage(pkg, join(src, 'm.kyshare.json'), dst)
    expect(preview.status).toBe('preview')
    expect(preview.kind).toBe('item')
    expect(preview.id).toBe('moonstone')
    expect(preview.displayName).toBeTruthy()
    expect(preview.loader).toBe('forge')
    expect(preview.mcVersion).toBe('1.20.1')
    expect(preview.license).toBe('LEARNING-ONLY')
    expect(preview.conflict).toBe(false)
    // 预览不落盘
    expect(existsSync(join(dst, '.kunyu', 'content', 'items', 'moonstone.json'))).toBe(false)
  })

  it('旧包缺字段时预览字段为 undefined；同 kind+id 时标记冲突', () => {
    const src = makeProject('pv-src2')
    const dst = makeProject('pv-dst2')
    saveContent(src, createDefaultItem('sunstone'))
    saveContent(dst, createDefaultItem('sunstone'))
    const pkg = exportCreation(src, 'item', 'sunstone') // 项目未登记 → 无元数据
    const oldPkg = {
      format: 'kunyu-share@1',
      exportedAt: '2025-01-01T00:00:00.000Z',
      content: pkg.content
    } as const

    const preview = previewSharePackage(oldPkg, join(src, 'old.kyshare.json'), dst)
    expect(preview.loader).toBeUndefined()
    expect(preview.mcVersion).toBeUndefined()
    expect(preview.license).toBeUndefined()
    expect(preview.dependencies).toBeUndefined()
    expect(preview.provenance).toBeUndefined()
    expect(preview.conflict).toBe(true)
    expect(preview.existingDisplayName).toBeTruthy()
  })
})
