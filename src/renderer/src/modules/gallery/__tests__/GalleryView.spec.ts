import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus, { ElMessage, ElMessageBox } from 'element-plus'
import GalleryView from '../GalleryView.vue'
import ModelPreview from '../../modeler/preview/ModelPreview.vue'
import { useProjectStore } from '../../../stores/project'
import type { GalleryItemDto } from '../../../../../shared/types/ipc'
import type { Project } from '../../../../../shared/types/project'

/**
 * 资产库（原画廊）视图契约：
 * - 打开项目时：列出该项目 AI 产出的全部画作：像素画布缩略图 + 需求描述 + 尺寸 + 来源标签
 * - 未打开项目时（主页进出）：跨项目汇总全部已登记项目的画作，按项目分组
 * - 搜索 / 来源筛选实时过滤
 * - 已绑定资产的画「用于资产」直接写回（不消耗 AI 额度），写回落在该画所属项目
 * - 未绑定资产的画「用于资产」先弹目标资产选择（读该画所属项目的 content.list）
 * - 删除需二次确认，确认后调 galleryDelete（带该画所属项目根）并从列表移除
 */
const ROOT = 'C:\\proj\\demo'
const ROOT_B = 'D:\\proj\\other'

/** 缩略图打桩上下文：只记录每次 fillRect 的颜色，用于断言像素确实被画上画布 */
const painted: string[] = []
const paintCtx = {
  fillStyle: '',
  clearRect: (): void => undefined,
  fillRect: (): void => {
    painted.push(paintCtx.fillStyle)
  }
}

const api = {
  content: {
    galleryList: vi.fn(),
    gallerySave: vi.fn(),
    galleryDelete: vi.fn(),
    list: vi.fn(),
    applyTextureCandidate: vi.fn(),
    load: vi.fn(),
    exportBbmodel: vi.fn(),
    modelApplyCandidate: vi.fn()
  },
  project: { list: vi.fn() }
}

/** 模型类画廊条目：卡片只给几何摘要，几何在预览/导出时按需 load */
function modelItem(patch: Partial<GalleryItemDto> = {}): GalleryItemDto {
  return {
    id: 'asset-model-crate',
    createdAt: '2026-10-15T03:00:00.000Z',
    entryKind: 'model',
    model: {
      geometry: 'cube',
      ownerKind: 'model',
      ownerId: 'crate',
      textureSize: 16,
      elementCount: 3
    },
    assetKind: 'model',
    assetId: 'crate',
    size: 16,
    prompt: '木箱',
    origin: 'project',
    palette: [],
    pixels: [],
    pngPath: '',
    ...patch
  }
}

function galleryItem(patch: Partial<GalleryItemDto> = {}): GalleryItemDto {
  return {
    id: 'g-1',
    createdAt: '2026-10-15T02:00:00.000Z',
    assetKind: 'item',
    assetId: 'ruby_sword',
    size: 16,
    prompt: '寒冰符文剑',
    provider: 'fake-image-model',
    origin: 'agent',
    appliedIndex: 1,
    palette: ['#ff0000'],
    pixels: Array.from({ length: 256 }, (_, i) => (i % 2 === 0 ? '#ff0000' : '')),
    pngPath: `${ROOT}\\.kunyu\\gallery\\g-1.png`,
    ...patch
  }
}

const project: Project = {
  id: 'p1',
  name: '演示模组',
  type: 'mod',
  path: ROOT,
  loader: 'fabric',
  mcVersion: '1.20.1',
  loaderVersion: '0.15.11',
  modId: 'demo',
  namespace: 'demo',
  jdkPath: null,
  description: '',
  createdAt: 0,
  lastOpenedAt: 0
}

const projectB: Project = {
  ...project,
  id: 'p2',
  name: '另一个整合包',
  type: 'modpack',
  path: ROOT_B,
  lastOpenedAt: 1
}

/** 挂载画廊并预置一个已打开的项目 */
async function mountView(items: GalleryItemDto[]): Promise<ReturnType<typeof mount>> {
  api.content.galleryList.mockResolvedValue(items)
  const store = useProjectStore()
  store.projects = [project]
  store.currentProjectId = 'p1'
  const w = mount(GalleryView, { global: { plugins: [ElementPlus] } })
  await flushPromises()
  return w
}

/** 挂载画廊且不打开任何项目（主页进出）：跨项目汇总模式 */
async function mountAggregate(byRoot: Record<string, GalleryItemDto[]>): Promise<ReturnType<typeof mount>> {
  api.content.galleryList.mockImplementation(async (root: string) => byRoot[root] ?? [])
  const store = useProjectStore()
  store.projects = [project, projectB]
  store.currentProjectId = null
  const w = mount(GalleryView, { global: { plugins: [ElementPlus] } })
  await flushPromises()
  return w
}

beforeEach(() => {
  setActivePinia(createPinia())
  Object.defineProperty(window, 'api', { value: api, configurable: true, writable: true })
  vi.clearAllMocks()
  // jsdom 不实现 canvas 2D：打桩一个只记录调用的上下文，让缩略图的绘制路径可被断言
  painted.length = 0
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(paintCtx as never)
})

describe('GalleryView · 列表与筛选', () => {
  it('打开即列出全部画作：像素画布缩略图 + 需求 + 尺寸 + 来源标签', async () => {
    const w = await mountView([
      galleryItem(),
      galleryItem({
        id: 'g-2',
        assetKind: 'free',
        assetId: '',
        size: 32,
        prompt: '岩浆方块',
        origin: 'workshop',
        pngPath: `${ROOT}\\.kunyu\\gallery\\g-2.png`
      })
    ])
    expect(api.content.galleryList).toHaveBeenCalledWith(ROOT)
    const cards = w.findAll('.gallery-item')
    expect(cards).toHaveLength(2)
    // 缩略图是 canvas（按 16/32 内部分辨率绘制像素，CSS 放大后 pixelated）
    const canvases = w.findAll('.gallery-thumb canvas')
    expect(canvases).toHaveLength(2)
    expect(canvases[0].attributes('width')).toBe('16')
    expect(canvases[1].attributes('width')).toBe('32')
    // 像素确实按颜色画上画布：两张画的 fixture 像素都是「隔一格上色」，
    // 各自被画 128 次（16×16 与 32×32 画布），共 256 次 fillRect
    expect(painted.length).toBe(256)
    expect(painted.every((fill) => fill === '#ff0000')).toBe(true)
    expect(w.text()).toContain('寒冰符文剑')
    expect(w.text()).toContain('岩浆方块')
    expect(w.text()).toContain('16×16')
    expect(w.text()).toContain('物品 · ruby_sword')
    expect(w.text()).toContain('未绑定资产')
    expect(w.text()).toContain('2 / 2 项')
  })

  it('空画廊给出引导文案，不列出卡片', async () => {
    const w = await mountView([])
    expect(w.findAll('.gallery-item')).toHaveLength(0)
    expect(w.text()).toContain('资产库还是空的')
  })

  it('来源筛选只保留命中来源的条目', async () => {
    const w = await mountView([
      galleryItem(),
      galleryItem({ id: 'g-2', assetKind: 'free', assetId: '', origin: 'workshop' })
    ])
    expect(w.findAll('.gallery-item')).toHaveLength(2)
    // 切到「工坊」
    const radios = w.findAll('.gallery-toolbar .el-radio-button__original-radio')
    await radios[2].setValue()
    await flushPromises()
    expect(w.findAll('.gallery-item')).toHaveLength(1)
    expect(w.text()).toContain('未绑定资产')
  })
})

describe('GalleryView · 复用（免 AI 额度）', () => {
  it('已绑定资产的画「用于资产」直接写回，不调用 AI 重绘', async () => {
    const success = vi.spyOn(ElMessage, 'success').mockImplementation(() => undefined as never)
    api.content.applyTextureCandidate.mockResolvedValue({
      ok: true,
      relPath: 'textures/item/ruby_sword.png',
      pngWritten: true,
      size: 16
    })
    const w = await mountView([galleryItem()])
    await w.findAll('.gallery-item-actions button')[0].trigger('click')
    await flushPromises()
    expect(api.content.applyTextureCandidate).toHaveBeenCalledTimes(1)
    const [root, kind, id, pixels, size] = api.content.applyTextureCandidate.mock.calls[0]
    expect(root).toBe(ROOT)
    expect(kind).toBe('item')
    expect(id).toBe('ruby_sword')
    expect((pixels as string[]).length).toBe(256)
    expect(size).toBe(16)
    expect(success).toHaveBeenCalled()
    success.mockRestore()
  })

  it('未绑定资产的画「用于资产」弹目标选择，并读取项目资产列表', async () => {
    api.content.list.mockResolvedValue([
      { kind: 'item', id: 'ruby_sword', displayName: 'Ruby Sword', path: '', updatedAt: 0 },
      { kind: 'block', id: 'ore', displayName: 'Ore', path: '', updatedAt: 0 }
    ])
    const w = await mountView([galleryItem({ assetKind: 'free', assetId: '' })])
    await w.findAll('.gallery-item-actions button')[0].trigger('click')
    await flushPromises()
    expect(api.content.list).toHaveBeenCalledWith(ROOT)
    // 弹窗挂到 body：只有 item/model 类型可作目标
    expect(document.body.textContent).toContain('选择目标资产')
    expect(document.body.textContent).toContain('Ruby Sword')
    expect(document.body.textContent).not.toContain('Ore')
    // 未选目标时按钮禁用，不会误写回
    expect(api.content.applyTextureCandidate).not.toHaveBeenCalled()
  })

  it('删除需二次确认，确认后调 galleryDelete 并从列表移除', async () => {
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    api.content.galleryDelete.mockResolvedValue(true)
    const w = await mountView([galleryItem()])
    // 动作顺序：用于资产 / 工坊编辑 / 导出分享包 / 删除
    await w.findAll('.gallery-item-actions button')[3].trigger('click')
    await flushPromises()
    expect(ElMessageBox.confirm).toHaveBeenCalled()
    expect(api.content.galleryDelete).toHaveBeenCalledWith(ROOT, 'g-1')
    expect(w.findAll('.gallery-item')).toHaveLength(0)
  })

  it('取消删除确认时不调用 galleryDelete', async () => {
    vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue(new Error('cancel'))
    const w = await mountView([galleryItem()])
    await w.findAll('.gallery-item-actions button')[3].trigger('click')
    await flushPromises()
    expect(api.content.galleryDelete).not.toHaveBeenCalled()
    expect(w.findAll('.gallery-item')).toHaveLength(1)
  })
})

describe('GalleryView · 跨项目汇总（主页进出，未打开项目）', () => {
  it('汇总全部已登记项目的画作并按项目分组显示组标题', async () => {
    const w = await mountAggregate({
      [ROOT]: [galleryItem()],
      [ROOT_B]: [
        galleryItem({ id: 'g-2', prompt: '岩浆符文', size: 32, assetKind: 'free', assetId: '' })
      ]
    })
    // 每个项目各读一次
    expect(api.content.galleryList).toHaveBeenCalledWith(ROOT)
    expect(api.content.galleryList).toHaveBeenCalledWith(ROOT_B)
    expect(w.findAll('.gallery-item')).toHaveLength(2)
    const titles = w.findAll('.gallery-group-title').map((t) => t.text())
    expect(titles).toHaveLength(2)
    expect(titles[0]).toContain('另一个整合包')
    expect(titles[0]).toContain('1 项')
    expect(titles[1]).toContain('演示模组')
    expect(w.text()).toContain('当前未打开项目，可跨项目直接写回资产')
    expect(w.text()).toContain('2 个项目')
  })

  it('单项目读取失败不影响其余项目的画作', async () => {
    api.content.galleryList.mockImplementation(async (root: string) => {
      if (root === ROOT_B) throw new Error('路径失效')
      return [galleryItem()]
    })
    const store = useProjectStore()
    store.projects = [project, projectB]
    store.currentProjectId = null
    const w = mount(GalleryView, { global: { plugins: [ElementPlus] } })
    await flushPromises()
    expect(w.findAll('.gallery-item')).toHaveLength(1)
    expect(w.text()).toContain('演示模组')
  })

  it('无任何项目/无画作时给出汇总模式的引导文案', async () => {
    const store = useProjectStore()
    store.projects = []
    store.currentProjectId = null
    api.project.list.mockResolvedValue([])
    const w = mount(GalleryView, { global: { plugins: [ElementPlus] } })
    await flushPromises()
    expect(w.findAll('.gallery-item')).toHaveLength(0)
    expect(w.text()).toContain('还没有任何 AI 产出的画')
  })

  it('汇总模式写回落在该画所属项目（不是当前打开项目）', async () => {
    const success = vi.spyOn(ElMessage, 'success').mockImplementation(() => undefined as never)
    api.content.applyTextureCandidate.mockResolvedValue({
      ok: true,
      relPath: 'textures/item/ruby_sword.png',
      pngWritten: true,
      size: 16
    })
    const w = await mountAggregate({ [ROOT_B]: [galleryItem()] })
    await w.findAll('.gallery-item-actions button')[0].trigger('click')
    await flushPromises()
    expect(api.content.applyTextureCandidate).toHaveBeenCalledTimes(1)
    // 第一参 = 画所属项目根（ROOT_B），而非任何「当前项目」
    expect(api.content.applyTextureCandidate.mock.calls[0][0]).toBe(ROOT_B)
    expect(api.content.applyTextureCandidate.mock.calls[0][2]).toBe('ruby_sword')
    success.mockRestore()
  })

  it('汇总模式删除时带该画所属项目根，且只移除同项目同名条目', async () => {
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    api.content.galleryDelete.mockResolvedValue(true)
    const w = await mountAggregate({
      [ROOT]: [galleryItem()],
      [ROOT_B]: [galleryItem()]
    })
    // 两个项目各有一条同 id 的条目：删第一条（排序后 ROOT_B 在前）
    await w.findAll('.gallery-item-actions button')[3].trigger('click')
    await flushPromises()
    expect(api.content.galleryDelete).toHaveBeenCalledWith(ROOT_B, 'g-1')
    expect(w.findAll('.gallery-item')).toHaveLength(1)
  })
})

describe('GalleryView · 项目已有像素资产汇总', () => {
  it('项目资产条目来源标为「项目资产」，动作只保留「工坊编辑 / 导出分享包」（无用于资产/删除）', async () => {
    const w = await mountView([
      galleryItem({
        id: 'asset-item-ruby',
        assetId: 'ruby',
        prompt: '红宝石',
        origin: 'project',
        provider: undefined,
        appliedIndex: undefined,
        pngPath: ''
      })
    ])
    expect(w.findAll('.gallery-item')).toHaveLength(1)
    // 项目资产就是资产本身：不提供「用于资产」（写回自身无意义）与「删除」（非 AI 额度产物）
    const actions = w.findAll('.gallery-item-actions button')
    expect(actions).toHaveLength(2)
    expect(actions[0].text()).toContain('工坊编辑')
    expect(actions[1].text()).toContain('导出分享包')
    // 缩略图照旧按像素绘制（fixture 隔格上色 → 128 次 fillRect）
    expect(painted.length).toBe(128)
    expect(w.text()).toContain('物品 · ruby')
    // 预览弹窗来源显示「项目资产」（弹窗挂到 body）
    await w.findAll('.gallery-thumb')[0].trigger('click')
    await flushPromises()
    expect(document.body.textContent).toContain('项目资产')
  })

  it('方块绑定的画标签为「方块 · id」，「用于资产」直接写回该方块', async () => {
    const success = vi.spyOn(ElMessage, 'success').mockImplementation(() => undefined as never)
    api.content.applyTextureCandidate.mockResolvedValue({
      ok: true,
      relPath: 'textures/block/ruby_ore.png',
      pngWritten: true,
      size: 16
    })
    const w = await mountView([galleryItem({ assetKind: 'block', assetId: 'ruby_ore' })])
    expect(w.text()).toContain('方块 · ruby_ore')
    await w.findAll('.gallery-item-actions button')[0].trigger('click')
    await flushPromises()
    const [root, kind, id] = api.content.applyTextureCandidate.mock.calls[0]
    expect(root).toBe(ROOT)
    expect(kind).toBe('block')
    expect(id).toBe('ruby_ore')
    success.mockRestore()
  })

  it('来源筛选「项目资产」只保留项目已有像素资产', async () => {
    const w = await mountView([
      galleryItem(),
      galleryItem({ id: 'asset-item-ruby', assetId: 'ruby', origin: 'project', pngPath: '' })
    ])
    expect(w.findAll('.gallery-item')).toHaveLength(2)
    const radios = w.findAll('.gallery-toolbar .el-radio-button__original-radio')
    await radios[3].setValue()
    await flushPromises()
    expect(w.findAll('.gallery-item')).toHaveLength(1)
    expect(w.text()).toContain('物品 · ruby')
  })
})

describe('GalleryView · 3D 模型汇总', () => {
  it('模型条目不做 WebGL 缩略图，只给几何摘要与「3D」角标', async () => {
    const w = await mountView([modelItem()])
    expect(w.findAll('.gallery-item')).toHaveLength(1)
    // 卡片不建 canvas（每卡一个 WebGL 实例会拖垮列表）
    expect(w.findAll('.gallery-thumb canvas')).toHaveLength(0)
    expect(w.text()).toContain('立方体')
    expect(w.text()).toContain('模型资产 · crate')
    expect(w.text()).toContain('3 元素')
    expect(w.text()).toContain('3D')
    expect(w.text()).toContain('模型 · crate')
    // 无贴图时用几何线稿 + 类型角标补足图标
    expect(w.findAll('.gallery-model-glyph')).toHaveLength(1)
    expect(w.findAll('.gallery-model-corner')).toHaveLength(1)
  })

  it('有贴图的模型条目以贴图作封面，并保留几何类型角标', async () => {
    const pixels = Array.from({ length: 16 * 16 }, () => 'ff0000ff')
    const w = await mountView([modelItem({ pixels })])
    expect(w.findAll('.gallery-model-tex')).toHaveLength(1)
    expect(w.findAll('.gallery-model-poster')).toHaveLength(0)
    expect(w.findAll('.gallery-model-corner')).toHaveLength(1)
    expect(w.text()).toContain('3D')
  })

  it('骨骼模型条目显示骨骼数与几何定性，且摘要里带归属对象', async () => {
    const w = await mountView([
      modelItem({
        id: 'object-entity-golem-geo',
        assetId: 'golem',
        prompt: '石傀儡',
        model: {
          geometry: 'blockbench',
          ownerKind: 'entity',
          ownerId: 'golem',
          textureSize: 16,
          elementCount: 0,
          boneCount: 5
        }
      })
    ])
    expect(w.text()).toContain('骨骼')
    expect(w.text()).toContain('实体 · golem')
    expect(w.text()).toContain('5 骨骼')
  })

  it('点开模型卡在弹窗里只读预览（renderer 截图式挂载只读编辑器）', async () => {
    api.content.load.mockResolvedValue({
      kind: 'model',
      id: 'crate',
      textureSize: 16,
      pixels: Array.from({ length: 256 }, () => ''),
      elements: [
        {
          name: '立方体 1',
          from: [0, 0, 0],
          to: [16, 16, 16],
          shade: true,
          faces: {
            down: { uv: [0, 0, 16, 16], texture: 'all' },
            up: { uv: [0, 0, 16, 16], texture: 'all' },
            north: { uv: [0, 0, 16, 16], texture: 'all' },
            south: { uv: [0, 0, 16, 16], texture: 'all' },
            west: { uv: [0, 0, 16, 16], texture: 'all' },
            east: { uv: [0, 0, 16, 16], texture: 'all' }
          }
        }
      ]
    })
    const w = await mountView([modelItem()])
    await w.findAll('.gallery-thumb')[0].trigger('click')
    await flushPromises()
    expect(api.content.load).toHaveBeenCalledWith(ROOT, 'model', 'crate')
    const preview = w.findComponent(ModelPreview)
    expect(preview.exists()).toBe(true)
    expect(preview.props('shape')).toBe('elements')
    // jsdom 无 WebGL：只断言只读渲染意图（ModelPreview 自身不暴露编辑入口）
  })

  it('几何读不到时降级为骨骼摘要 / 文件引用，不崩', async () => {
    api.content.load.mockRejectedValue(new Error('对象不存在'))
    const w = await mountView([
      modelItem({
        id: 'object-entity-golem-geo',
        assetId: 'golem',
        model: {
          geometry: 'blockbench',
          ownerKind: 'entity',
          ownerId: 'golem',
          textureSize: 16,
          elementCount: 0,
          boneCount: 5
        }
      })
    ])
    await w.findAll('.gallery-thumb')[0].trigger('click')
    await flushPromises()
    expect(document.body.textContent).toContain('读取模型失败')
  })

  it('只有独立模型资产能导出 .bbmodel（内嵌模型没有独立文件，按钮禁用）', async () => {
    const w = await mountView([
      modelItem({
        id: 'object-block-altar',
        assetId: 'altar',
        prompt: '祭坛',
        model: {
          geometry: 'cube',
          ownerKind: 'block',
          ownerId: 'altar',
          textureSize: 16,
          elementCount: 1
        }
      }),
      modelItem()
    ])
    const cards = w.findAll('.gallery-item')
    // 排序后：归档时间 03:00 的两条同毫秒 → 保持数组顺序（祭坛在前）
    const altarBtns = cards[0].findAll('button').map((b) => b.text())
    const crateBtns = cards[1].findAll('button').map((b) => b.text())
    // 内嵌（方块）模型：不能导出（无独立文件），也不能送进模型工坊以外的独立资产动作
    expect(altarBtns.some((t) => t.includes('导出 .bbmodel'))).toBe(true)
    expect(
      cards[0]
        .findAll('button')
        .find((b) => b.text().includes('导出 .bbmodel'))!
        .attributes('disabled')
    ).toBeDefined()
    expect(
      cards[1]
        .findAll('button')
        .find((b) => b.text().includes('导出 .bbmodel'))!
        .attributes('disabled')
    ).toBeUndefined()
    // 项目资产不提供删除 → 每卡 5 个动作（外加作为封面的缩略图按钮，共 6 个 button 元素）
    expect(altarBtns).toHaveLength(6)
    expect(crateBtns).toHaveLength(6)
    // 「送进模型工坊」只对绑定了对象的模型开放（独立模型资产本身没有可编辑的对象）
    const workshopOf = (card: (typeof cards)[number]): string | undefined =>
      card
        .findAll('button')
        .find((b) => b.text().includes('送进模型工坊'))!
        .attributes('disabled')
    expect(workshopOf(cards[0])).toBeUndefined()
    expect(workshopOf(cards[1])).toBeDefined()
  })

  it('导出 .bbmodel 会把模型资产交给 exportBbmodel，取消时不提示成功', async () => {
    const success = vi.spyOn(ElMessage, 'success').mockImplementation(() => undefined as never)
    api.content.load.mockResolvedValue({ ...modelItem().model, kind: 'model', elements: [{}] })
    api.content.exportBbmodel.mockResolvedValue({ canceled: true, path: '' })
    const w = await mountView([modelItem()])
    const btn = w
      .findAll('.gallery-item-actions button')
      .find((b) => b.text().includes('导出 .bbmodel'))!
    await btn.trigger('click')
    await flushPromises()
    expect(api.content.exportBbmodel).toHaveBeenCalledTimes(1)
    expect(api.content.exportBbmodel.mock.calls[0][0]).toBe(ROOT)
    expect(success).not.toHaveBeenCalled()
    success.mockRestore()
  })

  it('写回目标对象：选目标后调 modelApplyCandidate；needsConfirm 时二次确认后重试', async () => {
    const success = vi.spyOn(ElMessage, 'success').mockImplementation(() => undefined as never)
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    api.content.list.mockResolvedValue([
      { kind: 'block', id: 'altar', displayName: '祭坛' },
      { kind: 'item', id: 'wand', displayName: '法杖' }
    ])
    api.content.modelApplyCandidate
      .mockResolvedValueOnce({ ok: false, needsConfirm: true, errorMessage: '会清空骨骼几何' })
      .mockResolvedValueOnce({ ok: true, written: ['x'], replacedGeo: true })
    const w = await mountView([modelItem()])
    const btn = w
      .findAll('.gallery-item-actions button')
      .find((b) => b.text().includes('写回目标对象'))!
    await btn.trigger('click')
    await flushPromises()
    expect(api.content.list).toHaveBeenCalledWith(ROOT)

    // 目标选择弹窗挂到 body：选中「祭坛」后确认
    const body = document.body
    const option = Array.from(body.querySelectorAll('.el-select-dropdown__item')).find((el) =>
      el.textContent?.includes('祭坛')
    )
    option?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()
    const confirmBtn = Array.from(body.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === '写回对象'
    )!
    confirmBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()

    expect(confirm).toHaveBeenCalledTimes(1)
    expect(api.content.modelApplyCandidate).toHaveBeenCalledTimes(2)
    const first = api.content.modelApplyCandidate.mock.calls[0]
    expect(first[0]).toBe(ROOT)
    expect(first[1]).toEqual({ ownerKind: 'model', ownerId: 'crate' })
    expect(first[2]).toBe(ROOT)
    expect(first[3]).toEqual({ kind: 'block', id: 'altar' })
    // 确认后带 confirm=true 重试
    expect(api.content.modelApplyCandidate.mock.calls[1][4]).toBe(true)
    expect(success).toHaveBeenCalled()
    success.mockRestore()
    confirm.mockRestore()
  })
})
