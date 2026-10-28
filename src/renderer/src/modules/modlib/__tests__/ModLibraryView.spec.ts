import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus, { ElMessageBox } from 'element-plus'
import ModLibraryView from '../ModLibraryView.vue'
import { useProjectStore } from '../../../stores/project'
import type { ModLibraryEntry } from '../../../../../shared/types/modLibrary'
import type { Project, ProjectType } from '../../../../../shared/types/project'

/**
 * 资源库视图契约（全局库，不绑定项目）：
 * - 未打开项目也列出库内资源，并展示库根目录（回答「下载的资源放哪」）
 * - 打开整合包项目时提供「加入当前整合包」；其它项目类型不显示该动作
 * - 筛选（搜索 / 类型 / 加载器 / MC 版本）透传给主进程 list
 * - 导入本地资源后刷新列表并广播变更事件
 * - 移除前二次确认；确认后调 remove
 */
const api = {
  modlib: {
    list: vi.fn(),
    root: vi.fn(),
    reveal: vi.fn(),
    remove: vi.fn(),
    pickAndImport: vi.fn(),
    enrichIcons: vi.fn(),
    addToProject: vi.fn(),
    listWorlds: vi.fn()
  },
  shell: { showItemInFolder: vi.fn() },
  modpack: {
    preview: vi.fn(),
    listSources: vi.fn(),
    listPacks: vi.fn()
  }
}

function entry(patch: Partial<ModLibraryEntry> = {}): ModLibraryEntry {
  return {
    fileName: 'sodium-0.5.11.jar',
    resourceType: 'mod',
    name: 'Sodium',
    platform: 'modrinth',
    projectId: 'AANobbMI',
    versionId: 'v1',
    slug: 'sodium',
    versionNumber: '0.5.11',
    loaders: ['fabric'],
    gameVersions: ['1.20.1'],
    size: 1024 * 1024,
    downloadUrl: 'https://cdn.modrinth.com/sodium.jar',
    addedAt: '2026-10-01T00:00:00.000Z',
    ...patch
  }
}

function project(type: ProjectType): Project {
  return {
    id: 'p1',
    name: type === 'modpack' ? '我的整合包' : '演示模组',
    type,
    path: 'C:\\proj\\p1',
    loader: type === 'mod' ? 'fabric' : null,
    mcVersion: '1.20.1',
    loaderVersion: type === 'mod' ? '0.15.11' : null,
    modId: 'demo',
    namespace: 'demo',
    jdkPath: null,
    description: '',
    createdAt: 0,
    lastOpenedAt: 0
  }
}

/** 已挂载的实例：测试结束统一卸载，避免残留的 kunyu:modlib-changed 监听影响调用计数 */
const mounted: ReturnType<typeof mount>[] = []

async function mountView(
  entries: ModLibraryEntry[],
  opts: { type?: ProjectType } = {}
): Promise<ReturnType<typeof mount>> {
  api.modlib.list.mockResolvedValue(entries)
  const store = useProjectStore()
  if (opts.type) {
    store.projects = [project(opts.type)]
    store.currentProjectId = 'p1'
  } else {
    store.projects = []
    store.currentProjectId = null
  }
  const w = mount(ModLibraryView, { global: { plugins: [ElementPlus] } })
  mounted.push(w)
  await flushPromises()
  return w
}

beforeEach(() => {
  setActivePinia(createPinia())
  Object.defineProperty(window, 'api', { value: api, configurable: true, writable: true })
  vi.clearAllMocks()
  api.modlib.root.mockResolvedValue('C:\\Users\\test\\AppData\\Roaming\\KunYu\\mod-library')
  api.modlib.reveal.mockResolvedValue(true)
  api.modlib.remove.mockResolvedValue(true)
  api.modlib.pickAndImport.mockResolvedValue([])
  api.modlib.enrichIcons.mockResolvedValue(false)
  api.modlib.addToProject.mockResolvedValue({ ok: true, fileName: 'sodium-0.5.11.jar', message: 'run/mods' })
  api.modlib.listWorlds.mockResolvedValue([])
  api.modpack.preview.mockResolvedValue({ ok: true, plan: null })
  api.modpack.listSources.mockResolvedValue([])
  api.modpack.listPacks.mockResolvedValue([])
})

afterEach(() => {
  while (mounted.length) mounted.pop()?.unmount()
})

describe('ModLibraryView · 全局库展示', () => {
  it('未打开项目也列出库内 jar，并显示库根目录', async () => {
    const w = await mountView([entry()])
    expect(w.findAll('.mlv-card')).toHaveLength(1)
    expect(w.text()).toContain('Sodium')
    expect(w.text()).toContain('Fabric')
    expect(w.text()).toContain('1.20.1')
    expect(w.text()).toContain('mod-library')
    // 未打开项目：不提供「加入当前整合包」
    expect(w.text()).not.toContain('加入当前整合包')
  })

  it('库为空时显示空态与导入入口', async () => {
    const w = await mountView([])
    expect(w.text()).toContain('资源库还是空的')
    expect(w.text()).toContain('jar/zip/mrpack')
  })

  it('打开整合包项目时卡片提供「加入当前整合包」', async () => {
    const w = await mountView([entry()], { type: 'modpack' })
    expect(w.text()).toContain('加入当前整合包')
  })

  it('打开非整合包项目时不提供「加入当前整合包」', async () => {
    const w = await mountView([entry()], { type: 'mod' })
    expect(w.text()).not.toContain('加入当前整合包')
  })

  it('非 mod 类型条目显示类型徽标，mod 不显示', async () => {
    const w = await mountView([
      entry({ fileName: 'sodium.jar' }),
      entry({ fileName: 'terralith.zip', resourceType: 'datapack', loaders: [] }),
      entry({ fileName: 'faithful.zip', resourceType: 'resourcepack', loaders: [] })
    ])
    expect(w.text()).toContain('数据包')
    expect(w.text()).toContain('资源包')
    // mod 条目不出徽标：类型文字总数 = 2
    expect(w.findAll('.mlv-tag.is-type')).toHaveLength(2)
  })

  it('modpack 类型条目的加入按钮禁用', async () => {
    const w = await mountView([entry({ fileName: 'pack.mrpack', resourceType: 'modpack', loaders: [] })], { type: 'modpack' })
    const addBtn = w.findAll('button').find((b) => b.text().includes('加入当前整合包'))
    expect(addBtn).toBeTruthy()
    expect(addBtn!.attributes('disabled')).toBeDefined()
  })

  it('类型筛选选中后带 type 重新查询', async () => {
    const w = await mountView([])
    const selects = w.findAllComponents({ name: 'ElSelect' })
    // 第一个 select 是「全部类型」：v-model 走 update:modelValue，change 触发 reload
    selects[0].vm.$emit('update:modelValue', 'resourcepack')
    selects[0].vm.$emit('change', 'resourcepack')
    await flushPromises()
    expect(api.modlib.list).toHaveBeenLastCalledWith({
      type: 'resourcepack',
      loader: undefined,
      mcVersion: undefined,
      query: undefined
    })
  })

  it('搜索结果为空但存在筛选条件时提示清空条件', async () => {
    const w = await mountView([])
    await w.find('.mlv-search input').setValue('sodium')
    await w.find('.mlv-search input').trigger('keyup.enter')
    await flushPromises()
    expect(api.modlib.list).toHaveBeenLastCalledWith({
      type: undefined,
      loader: undefined,
      mcVersion: undefined,
      query: 'sodium'
    })
    expect(w.text()).toContain('没有匹配的资源')
  })
})

describe('ModLibraryView · 操作', () => {
  it('加入当前整合包调用 addToProject 并提示成功', async () => {
    const w = await mountView([entry()], { type: 'modpack' })
    const addBtn = w.findAll('button').find((b) => b.text().includes('加入当前整合包'))
    expect(addBtn).toBeTruthy()
    await addBtn!.trigger('click')
    await flushPromises()
    expect(api.modlib.addToProject).toHaveBeenCalledWith('C:\\proj\\p1', 'sodium-0.5.11.jar', undefined, undefined)
  })

  it('移除前二次确认，确认后调用 remove 并刷新', async () => {
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const w = await mountView([entry()])
    const removeBtn = w.findAll('button').find((b) => b.text().includes('移除'))
    await removeBtn!.trigger('click')
    await flushPromises()
    expect(ElMessageBox.confirm).toHaveBeenCalled()
    expect(api.modlib.remove).toHaveBeenCalledWith('sodium-0.5.11.jar')
    expect(api.modlib.list).toHaveBeenCalledTimes(2)
  })

  it('取消确认时不删除', async () => {
    vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue(new Error('cancel'))
    const w = await mountView([entry()])
    const removeBtn = w.findAll('button').find((b) => b.text().includes('移除'))
    await removeBtn!.trigger('click')
    await flushPromises()
    expect(api.modlib.remove).not.toHaveBeenCalled()
  })

  it('导入本地资源后刷新并广播变更事件', async () => {
    api.modlib.pickAndImport.mockResolvedValue([entry({ fileName: 'local.jar', platform: 'local' })])
    const changed = vi.fn()
    window.addEventListener('kunyu:modlib-changed', changed)
    const w = await mountView([])
    api.modlib.list.mockResolvedValue([entry({ fileName: 'local.jar', platform: 'local' })])
    const importBtn = w.findAll('button').find((b) => b.text().includes('导入本地资源'))
    await importBtn!.trigger('click')
    await flushPromises()
    expect(changed).toHaveBeenCalled()
    expect(w.text()).toContain('本地导入')
    window.removeEventListener('kunyu:modlib-changed', changed)
  })

  it('「在文件夹中显示」定位失败时提示', async () => {
    api.modlib.reveal.mockResolvedValue(false)
    const w = await mountView([entry()])
    const revealBtn = w.findAll('button').find((b) => b.text().includes('在文件夹中显示'))
    await revealBtn!.trigger('click')
    await flushPromises()
    expect(api.modlib.reveal).toHaveBeenCalledWith('sodium-0.5.11.jar')
  })
})
