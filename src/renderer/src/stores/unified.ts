import { defineStore } from 'pinia'
import { toRaw } from 'vue'
import { ElMessage } from 'element-plus'
import {
  unifiedDisplayName,
  type UnifiedContent,
  type UnifiedContentType
} from '../../../shared/schemas/unified.schema'
import {
  createDefaultUnifiedBlock,
  createDefaultUnifiedItem,
  createDefaultUnifiedEntity,
  createDefaultUnifiedContent
} from '../../../shared/schemas/unified.schema'
import { blockToUnified, itemToUnified, entityToUnified, unifiedToBlock, unifiedToItem, unifiedToEntity, biomeToUnified, advancementToUnified, unifiedToBiome, unifiedToAdvancement } from '../../../shared/schemas/unified.adapter'
import {
  buildQuickRecipe,
  createQuickContent,
  type QuickCreateInput,
  type QuickCreateTemplateId
} from '../../../shared/schemas/quickCreate'
import { validateRecipe } from '../../../shared/schemas/recipe.schema'
import type { BlockSchema, ContentDoctorReport, ContentKind, ItemSchema, EntitySchema, GeneratedFile, ModelAsset, BiomeDefinition, AdvancementDefinition } from '../../../shared/types/content'

/**
 * 统一编辑器状态：内容对象列表、当前选中、新建/删除信号。
 * 对象从磁盘加载扁平 schema 后经适配层转为 UnifiedContent；
 * 保存时反向转回扁平 schema 走现有 content IPC；
 * Java 代码生成复用现有 content.generate 管线（flat schema → .java）。
 */
export const useUnifiedStore = defineStore('unified', {
  state: () => ({
    objects: [] as UnifiedContent[],
    active: null as UnifiedContent | null,
    /** 新建信号：{ type } 由树触发、视图消费 */
    createSignal: null as { type: UnifiedContentType } | null,
    /** 删除信号：{ obj } */
    deleteSignal: null as { obj: UnifiedContent } | null,
    /**
     * 模型工坊「打开关联对象」信号：请求工坊定位并选中指定对象（只选中，不灌模型）。
     * 只带定位；视图消费后清空。
     */
    openObjectSignal: null as { type: 'block' | 'item' | 'entity'; id: string } | null,
    loading: false,
    saving: false,
    generating: false,
    /** 最近一次生成器写入/清理的文件清单 */
    lastGenerated: [] as GeneratedFile[],
    /** 最近一轮漂移（用户手改、被跳过覆盖）的相对路径 */
    diverged: [] as string[]
  }),

  getters: {
    blocks: (s) => s.objects.filter((o) => o.type === 'block'),
    items: (s) => s.objects.filter((o) => o.type === 'item'),
    entities: (s) => s.objects.filter((o) => o.type === 'entity'),
    biomes: (s) => s.objects.filter((o) => o.type === 'biome'),
    advancements: (s) => s.objects.filter((o) => o.type === 'advancement')
  },

  actions: {
    /** 从磁盘加载所有 block/item/entity/biome/advancement 并转为 UnifiedContent */
    async load(root: string, namespace = 'mymod'): Promise<void> {
      this.loading = true
      try {
        const summaries = await window.api.content.list(root)
        const objects: UnifiedContent[] = []
        for (const s of summaries) {
          if (s.kind === 'block' || s.kind === 'item' || s.kind === 'entity') {
            const def = (await window.api.content.load(root, s.kind, s.id)) as
              | BlockSchema
              | ItemSchema
              | EntitySchema
            if (s.kind === 'block') objects.push(blockToUnified(def as BlockSchema, namespace))
            else if (s.kind === 'item') objects.push(itemToUnified(def as ItemSchema, namespace))
            else objects.push(entityToUnified(def as EntitySchema, namespace))
          } else if (s.kind === 'biome') {
            const def = (await window.api.content.load(root, s.kind, s.id)) as BiomeDefinition
            objects.push(biomeToUnified(def))
          } else if (s.kind === 'advancement') {
            const def = (await window.api.content.load(root, s.kind, s.id)) as AdvancementDefinition
            objects.push(advancementToUnified(def))
          }
        }
        this.objects = objects
      } finally {
        this.loading = false
      }
    },

    select(obj: UnifiedContent | null): void {
      // Pinia state 中的对象是 reactive proxy，structuredClone 无法克隆 Proxy，需先 toRaw
      this.active = obj ? structuredClone(toRaw(obj)) : null
    },

    requestCreate(type: UnifiedContentType): void {
      this.createSignal = { type }
    },

    requestDelete(obj: UnifiedContent): void {
      this.deleteSignal = { obj }
    },

    clearSignals(): void {
      this.createSignal = null
      this.deleteSignal = null
      this.openObjectSignal = null
    },

    /** 模型工坊「打开关联对象」：请求工坊定位并选中对象（视图消费后清空信号） */
    requestOpenObject(signal: { type: 'block' | 'item' | 'entity'; id: string }): void {
      this.openObjectSignal = signal
    },

    /** 新建默认对象并设为当前编辑；explicitId 用于「自定义」直接指定注册名 */
    beginNew(type: UnifiedContentType, namespace = 'mymod', explicitId?: string): void {
      const id = explicitId ?? `new_${type}_${Date.now().toString(36).slice(-4)}`
      const obj =
        type === 'block'
          ? createDefaultUnifiedBlock(id, namespace)
          : type === 'item'
            ? createDefaultUnifiedItem(id, namespace)
            : type === 'entity'
              ? createDefaultUnifiedEntity(id, namespace)
              : createDefaultUnifiedContent(type, id, namespace)
      this.active = obj
    },

    /**
     * QuickCreate（C5）：按预置模板直接创建字段已填好的对象，跳过需求理解。
     * recipe 模板不在此处理（对象级入口应调用 addQuickRecipeToActive）。
     */
    beginQuickCreate(
      template: Exclude<QuickCreateTemplateId, 'recipe'>,
      input: QuickCreateInput
    ): void {
      this.active = createQuickContent(template, input)
    },

    /**
     * 为当前编辑对象追加一份起步配方（QuickCreate「配方」模板）。
     * @returns null=成功；否则为中文错误消息
     */
    addQuickRecipeToActive(): string | null {
      if (!this.active) return '请先选中或新建一个内容对象，再为其快速创建配方'
      if (this.active.type === 'entity') return '实体类型不支持配方'
      let recipe
      try {
        recipe = buildQuickRecipe(this.active)
      } catch (e) {
        return e instanceof Error ? e.message : '快速创建配方失败'
      }
      const err = validateRecipe(recipe)
      if (err) return err
      const list = this.active.data.recipes ?? []
      // 同 id 配方已存在则覆盖（起步配方幂等）
      const idx = list.findIndex((r) => r.id === recipe.id)
      if (idx >= 0) list[idx] = recipe
      else list.push(recipe)
      this.active.data.recipes = list
      return null
    },

    /** 保存当前对象（UnifiedContent → 扁平 schema → content.save） */
    async save(root: string): Promise<string | null> {
      if (!this.active) return '没有正在编辑的对象'
      this.saving = true
      try {
        const obj = this.active

        // 纯数据包类型（biome/advancement）：无 java 产物与 Cube 模型，doc 直转扁平定义保存
        if (obj.type === 'biome' || obj.type === 'advancement') {
          const flat =
            obj.type === 'biome' ? unifiedToBiome(obj) : unifiedToAdvancement(obj)
          const plain = JSON.parse(JSON.stringify(flat)) as BiomeDefinition | AdvancementDefinition
          const summary = await window.api.content.save(root, plain, undefined)
          await this.load(root, 'mymod')
          const reloaded = this.objects.find((o) => o.type === summary.kind && o.id === summary.id)
          if (reloaded) this.active = structuredClone(toRaw(reloaded))
          return null
        }

        // 嵌入式 Cube 模型：导出为独立 ModelAsset 并绑定 cubeModelId
        const cm = obj.assets.model.cubeModel
        if (cm) {
          const modelAsset: ModelAsset = {
            kind: 'model',
            id: obj.id,
            displayName: unifiedDisplayName(obj, 'en_us'),
            description: obj.description ?? '',
            textureSize: cm.textureSize,
            pixels: [...cm.pixels],
            textures: { all: `textures/model/${obj.id}.png` },
            elements: JSON.parse(JSON.stringify(cm.elements)) as ModelAsset['elements'],
            ambientOcclusion: true,
            createdAt: obj.meta.createdAt,
            updatedAt: Date.now()
          }
          await window.api.content.save(root, modelAsset, undefined)
          obj.java.cubeModelId = modelAsset.id
          // 主贴图像素同步，保证未走模型链路时外观一致
          if (obj.type === 'block' && obj.assets.textures.block?.[0]) {
            obj.assets.textures.block[0].pixels = [...cm.pixels]
          } else if (obj.type === 'item' && obj.assets.textures.item) {
            obj.assets.textures.item.pixels = [...cm.pixels]
          } else if (obj.type === 'entity' && obj.assets.textures.entity) {
            obj.assets.textures.entity.pixels = [...cm.pixels]
          }
        }

        let def: BlockSchema | ItemSchema | EntitySchema
        if (obj.type === 'block') def = unifiedToBlock(obj)
        else if (obj.type === 'item') def = unifiedToItem(obj)
        else def = unifiedToEntity(obj)
        const plain = JSON.parse(JSON.stringify(def)) as BlockSchema | ItemSchema | EntitySchema
        const summary = await window.api.content.save(root, plain, undefined)
        // 刷新列表并重新加载该对象
        await this.load(root, obj.java.packageName.split('.')[0] || 'mymod')
        const reloaded = this.objects.find((o) => o.type === summary.kind && o.id === summary.id)
        if (reloaded) this.active = structuredClone(toRaw(reloaded))
        return null
      } catch (err) {
        return (err as Error).message
      } finally {
        this.saving = false
      }
    },

    async remove(root: string, obj: UnifiedContent): Promise<void> {
      const kind: ContentKind =
        obj.type === 'block'
          ? 'block'
          : obj.type === 'item'
            ? 'item'
            : obj.type === 'biome'
              ? 'biome'
              : obj.type === 'advancement'
                ? 'advancement'
                : 'entity'
      await window.api.content.remove(root, kind, obj.id)
      if (this.active?.id === obj.id && this.active?.type === obj.type) {
        this.active = null
      }
      this.objects = this.objects.filter((o) => !(o.type === obj.type && o.id === obj.id))
    },

    /**
     * 生成 Java 代码（及合并的资源/数据产物）。
     * 复用现有 content.generate：它读取全部 flat schema 并重新生成
     * ModBlocks/ModItems 等注册类，同时做漂移检测。
     * @param overwritePaths 用户确认覆盖的手改文件（相对路径）
     */
    async generateJava(root: string, overwritePaths?: string[]): Promise<string | null> {
      this.generating = true
      try {
        const result = await window.api.content.generate(
          root,
          overwritePaths ? { overwritePaths: [...overwritePaths] } : undefined
        )
        this.lastGenerated = result.files
        this.diverged = result.diverged
        // 入口包与 maven_group 分歧时显式警告（否则注册类生成
        // 到无人引用的包，构建全绿但游戏里没有内容）
        if (result.packageDivergence) {
          ElMessage({
            type: 'warning',
            duration: 0,
            showClose: true,
            message:
              `包名不一致：源码入口包为 ${result.packageDivergence.packageName}，` +
              `而 gradle.properties 的 maven_group=${result.packageDivergence.mavenGroup}。` +
              '生成器已按实际入口包落码；建议统一两者（改 maven_group 或迁移源码包），否则构建脚本与源码可能脱节。'
          })
        }
        return null
      } catch (err) {
        return (err as Error).message
      } finally {
        this.generating = false
      }
    },

    /** 当前对象实际生成的 Java 产物（相对路径），用于产物视图点击跳转 */
    generatedJavaFor(active: UnifiedContent | null): GeneratedFile[] {
      if (!active) return []
      return this.lastGenerated.filter(
        (f) => f.action === 'write' && f.path.endsWith('.java') && f.path.includes(active.id)
      )
    },

    /**
     * 反向同步（P3.4）：把 ModBlocks.java 中该方块的手改属性解析回语义表单。
     * 目前仅支持方块。回写磁盘后重新加载列表与当前对象。
     * @returns 提示信息；null 表示成功
     */
    async reverseSync(root: string): Promise<string | null> {
      if (!this.active) return '没有正在编辑的对象'
      if (this.active.type !== 'block') return '反向同步目前仅支持方块'
      const id = this.active.id
      try {
        const applied = (await window.api.content.reverseSync(root, id)) as number
        if (applied === 0) return '未在 ModBlocks.java 中找到该方块声明，或属性无变化'
        await this.load(root, this.active.java.packageName.split('.')[0] || 'mymod')
        const reloaded = this.objects.find((o) => o.type === 'block' && o.id === id)
        if (reloaded) this.active = structuredClone(toRaw(reloaded))
        return null
      } catch (err) {
        return (err as Error).message
      }
    },

    /**
     * 建模工坊：把 .bbmodel 导入到当前活动对象的嵌入式 Cube 模型。
     * 主进程同时落盘一份独立 ModelAsset（id = 当前对象 id），保存对象时会再次同步。
     */
    async importBbmodelIntoActive(root: string): Promise<{
      canceled?: boolean
      warnings?: string[]
      error?: string
    }> {
      const active = this.active
      if (!active) return { error: '没有正在编辑的对象' }
      const res = await window.api.content.importBbmodel(root, active.id)
      if (res.canceled) return { canceled: true }
      if (res.error) return { error: res.error }
      try {
        const loaded = (await window.api.content.load(root, 'model', res.id ?? active.id)) as ModelAsset
        if (loaded.kind !== 'model') return { error: '导入结果不是模型资产' }
        active.assets.model.cubeModel = {
          textureSize: loaded.textureSize,
          pixels: [...loaded.pixels],
          elements: JSON.parse(JSON.stringify(loaded.elements)) as ModelAsset['elements']
        }
        active.java.cubeModelId = loaded.id
        return { warnings: res.warnings ?? [] }
      } catch (err) {
        return { error: (err as Error).message }
      }
    },

    /** 建模工坊 B2：导入 OBJ 并体素化到当前活动对象的嵌入式 Cube 模型（主进程同时落盘 ModelAsset） */
    async importObjIntoActive(
      root: string,
      resolution?: number
    ): Promise<{ canceled?: boolean; warnings?: string[]; mtlLoaded?: boolean; error?: string }> {
      const active = this.active
      if (!active) return { error: '没有正在编辑的对象' }
      const res = await window.api.content.importObj(root, active.id, resolution)
      if (res.canceled) return { canceled: true }
      if (res.error) return { error: res.error }
      const loaded = res.model
      if (!loaded || loaded.kind !== 'model') return { error: '导入结果不是模型资产' }
      active.assets.model.cubeModel = {
        textureSize: loaded.textureSize,
        pixels: [...loaded.pixels],
        elements: JSON.parse(JSON.stringify(loaded.elements)) as ModelAsset['elements']
      }
      active.java.cubeModelId = loaded.id
      return { warnings: res.warnings ?? [], mtlLoaded: res.mtlLoaded }
    },

    /** 建模工坊：导出当前对象的嵌入式 Cube 模型为 .bbmodel（含内嵌贴图） */
    async exportActiveBbmodel(root: string): Promise<{ canceled?: boolean; path?: string; error?: string }> {
      const a = this.active
      const cm = a?.assets.model.cubeModel
      if (!a || !cm) return { error: '当前对象没有 3D 模型，请先进入 3D 建模' }
      const asset: ModelAsset = {
        kind: 'model',
        id: a.id,
        displayName: a.id,
        description: a.description ?? '',
        textureSize: cm.textureSize,
        pixels: [...cm.pixels],
        textures: { all: `textures/model/${a.id}.png` },
        elements: JSON.parse(JSON.stringify(cm.elements)) as ModelAsset['elements'],
        ambientOcclusion: true,
        createdAt: a.meta.createdAt,
        updatedAt: Date.now()
      }
      const res = await window.api.content.exportBbmodel(root, asset)
      if (res.canceled) return { canceled: true }
      if (res.error) return { error: res.error }
      return { path: res.path }
    },

    /** 内容资源体检：只读检查跨对象引用，报告交由视图弹框展示 */
    async runDoctor(root: string): Promise<ContentDoctorReport> {
      return window.api.content.doctor(root)
    }
  }
})
