/**
 * 可视化编辑器 → Fabric 1.20.1 代码/资源生成器。
 *
 * 设计文档第 9 章"版无关核心"：本文件是版相关适配层，
 * 输入为与加载器无关的语义资产（.kunyu/content/*.json），
 * 输出 ModBlocks/ModItems 注册代码、模型/方块状态/语言/战利品表 JSON 与占位 PNG。
 *
 * 生成产物全部登记在 .kunyu/content/generated.json，
 * 下次生成时据此清理已删除对象的旧文件。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  ContentDefinition,
  GeneratedFile,
  GameTestSchema,
  GenerateOptions,
  GenerationPlan,
  GenerateResult,
  ItemSchema,
  ModelAsset,
  PlannedFile
} from '../../../shared/types/content'
import { buildTemplateAnimations, geckoAnimationFile } from '../../../shared/utils/bbmodel'
import type { ModelDocument, TextureAnimation } from '../../../shared/modeler/types'
import { documentToAnimations } from '../../../shared/modeler/formats/bedrockAnim'
import { resolveEntityController } from '../../../shared/modeler/controller'
import { buildTextureMcmeta } from '../../../shared/modeler/flipbook'
import type { BlockSchema } from '../../../shared/schemas/block.schema'
import type { EntitySchema } from '../../../shared/schemas/entity.schema'
import type { EnchantmentSchema } from '../../../shared/schemas/enchantment.schema'
import { itemDisplayName } from '../../../shared/schemas/item.schema'
import { compileLootTable } from '../../../shared/schemas/loot.schema'
import { compileRecipe } from '../../../shared/schemas/recipe.schema'
import { dataPath, tagRegistryPath } from '../../../shared/dataPath'
import { toGeneratorBlocks } from '../blockAdapter'
import { applyItemHeldDisplay, compileModelToMcJson, pixelsToPng, pixelsToPngRect } from '../modelCompiler'
import {
  mojmapClientEntitySetupJava,
  mojmapEntityClassName,
  mojmapEntityJava,
  mojmapEntityModelClassName,
  mojmapEntityModelJava,
  mojmapEntityRendererClassName,
  mojmapEntityRendererJava,
  mojmapEntitySetupJava,
  mojmapModEntitiesJava
} from '../mojmapEntityCodegen'
import {
  compileEnchantmentJson,
  generateModEnchantmentsJava,
  isDataDrivenEnchantment
} from '../enchantmentCodegen'
import {
  resolveBlockPattern,
  synthesizeBlockTexture,
  synthesizeItemTexture
} from '../../templates/textureSynthesizer'
import { getCustomMcpManager } from '../ai/mcpClient'
import { generateGameTestClasses, gameTestJavaRelPath } from '../gameTestGenerator'
import { assertWithinRoot, writeFile } from '../fsService'
import { pascal } from './utils'
import { resolveModContext } from './context'
import { makeSink, type PlannedEntry } from './sink'
import { generateModBlocksJava } from './javaBlocks'
import { generateModItemsJava, itemSpriteKind } from './javaItems'
import {
  entityClassName,
  fabricClientJava,
  fabricEntityJava,
  fabricEntityJavaWithController,
  fabricEntityModelJava,
  fabricEntityRendererJava,
  fabricFallbackModelJava,
  fabricFallbackRendererJava,
  fabricGeoModelJava,
  fabricGeoRendererJava,
  fabricModEntitiesJava,
  resolveEntityCube,
  resolveEntityGeo,
  syncFabricGeckolib
} from './javaEntities'
import {
  blockItemModelJson,
  blockModelJson,
  blockstateJson,
  ensureTexturePng,
  itemModelJson,
  lootTableJson,
  syncLangFile,
  syncTagFile
} from './assets'
import {
  cleanupTemplateExample,
  collectManagedFiles,
  readManifest,
  syncFabricEnchantments,
  syncFabricMainClass,
  syncFabricModJson,
  syncMojmapEnchantmentMainClass,
  syncMojmapEntitiesMainClass,
  type Manifest,
  type RunResult
} from './sync'

export { mergeRegistryClass } from './registryMerge'
export { readModBlocksJava, resolveModContext } from './context'
export type { ModContext } from './context'
export { generateModBlocksJava } from './javaBlocks'
export { generateModItemsJava } from './javaItems'
export { GECKOLIB_VERSION } from './javaEntities'
export { protectForeignPlannedFiles } from './sync'

/**
 * 生图工具链路由：当 texture 类 MCP server（如 mc-texture-cli）就绪时，
 * 返回 serverId 供调用方记录/分支；Agent 的 FC 循环已通过 registerCustomMcpTools
 * 注册了 `{serverIdShort}_*` 前缀的 texture 工具，可直接对生成的 PNG 做像素化/调色板量化。
 * 无 texture server 时返回 null，沿用 textureSynthesizer 像素合成（向后兼容）。
 */
function textureMcpServerId(): string | null {
  const mgr = getCustomMcpManager()
  if (!mgr) return null
  const server = mgr.findServersByCategory('texture')[0]
  return server?.id ?? null
}

/**
 * 实体绑定的工坊模型文档（renderer.modelerDocId → .kunyu/modeler/<id>.json）。
 * 无绑定 / 文件名不安全 / 文件缺失 / JSON 损坏 → null（调用方各自回退）。
 * 与 resolveEntityAnimationFile 共用同一读盘与安全校验约定。
 */
function loadModelerDoc(root: string, e: EntitySchema): ModelDocument | null {
  const docId = e.renderer.modelerDocId
  if (!docId || !/^[A-Za-z0-9_-]+$/.test(docId)) return null
  const docFile = join(root, '.kunyu', 'modeler', `${docId}.json`)
  if (!existsSync(docFile)) return null
  try {
    const doc = JSON.parse(readFileSync(docFile, 'utf8')) as ModelDocument
    return doc && typeof doc === 'object' ? doc : null
  } catch {
    return null
  }
}

/**
 * 实体动画解析：实体登记了工坊模型文档（renderer.modelerDocId）且
 * 文档内有已创作动画时，用 documentToAnimations 导出并与参数化模板合并
 * （同名动画以已创作为准，模板补全控制器引用的 idle/walk 等缺项）；
 * 无登记 / 文档缺失 / 文档无动画时回退纯模板三件套。
 * docId 仅允许安全文件名字符（防路径穿越，与 modelerGeoApply.safeId 同规则）。
 */
function resolveEntityAnimationFile(
  root: string,
  e: EntitySchema,
  boneNames: string[]
): { format_version: string; animations: Record<string, unknown> } {
  const template = buildTemplateAnimations(boneNames, e.id)
  const fallback = (): { format_version: string; animations: Record<string, unknown> } =>
    geckoAnimationFile(template)
  const doc = loadModelerDoc(root, e)
  if (!doc || !doc.animations) return fallback()
  try {
    const { output } = documentToAnimations(doc, { namespace: e.id })
    const authored: Record<string, unknown> = output.animations
    if (Object.keys(authored).length === 0) return fallback()
    return { format_version: '1.8.0', animations: { ...template, ...authored } }
  } catch {
    // 文档损坏不阻断生成：回退模板动画
    return fallback()
  }
}

/**
 * B1-2 实体动画控制器解析：绑定文档有合法控制器状态机时返回之
 * （实体 Java 按状态机生成谓词），否则 null（回退 idle/walk 二态）。
 */
function resolveEntityAnimationController(root: string, e: EntitySchema) {
  const doc = loadModelerDoc(root, e)
  return doc ? resolveEntityController(doc) : null
}

/**
 * B2-1 flipbook 贴图动画解析：① 工坊绑定文档第一张带动画的贴图（geo 实体主链，
 * 贴图本体 = renderer.texturePng 条带）；② 绑定模型资产的 textureAnimation
 * （cube 实体链，模型贴图循环同样消费该字段）。均无 → null（不写 mcmeta）。
 */
function resolveEntityTextureAnimation(
  root: string,
  e: EntitySchema,
  modelMap: Map<string, ModelAsset>
): TextureAnimation | null {
  const doc = loadModelerDoc(root, e)
  if (doc) {
    const animTex = Object.values(doc.textures ?? {}).find((t) => t?.animation)
    if (animTex?.animation) return animTex.animation
  }
  const bound = e.cubeModelId ? modelMap.get(e.cubeModelId) : undefined
  return bound?.textureAnimation ?? null
}

/** flipbook mcmeta 落盘（B2-1）：有动画元数据时在 PNG 旁写同名 .png.mcmeta */
function writeTexMcmeta(
  sink: ReturnType<typeof makeSink>,
  pngPath: string,
  anim: TextureAnimation | null | undefined
): void {
  const mcmeta = buildTextureMcmeta(anim ?? undefined)
  if (mcmeta) sink.text(`${pngPath}.mcmeta`, JSON.stringify(mcmeta, null, 2))
}

/**
 * 语义像素 → PNG 落盘（B2-1）：带动画且像素为竖直帧条（长度 = size² × 帧数，≥2 帧）
 * 时按帧条高度编码，否则按正方形编码。动画元数据不在此写（见 writeTexMcmeta）。
 */
function writePixelsPng(
  sink: ReturnType<typeof makeSink>,
  pngPath: string,
  src: { pixels: string[]; textureSize: number },
  anim: TextureAnimation | null | undefined
): void {
  const size = src.textureSize
  const stripH =
    anim && src.pixels.length % (size * size) === 0 && src.pixels.length >= size * size * 2
      ? src.pixels.length / size
      : null
  sink.bin(pngPath, stripH ? pixelsToPngRect(src.pixels, size, stripH) : pixelsToPng(src.pixels, size))
}

/**
 * 生成内核（实写 / dry-run 共用，保证预检与实际生成路径完全一致）：
 * 所有产物走 GenSink，由 sink 统一做漂移检测与跳过/覆盖决策。
 */
function runGeneration(
  root: string,
  definitions: ContentDefinition[],
  dry: boolean,
  options?: GenerateOptions
): RunResult {
  const ctx = resolveModContext(root)
  // BlockSchema 先适配为生成器扁平方块；实体（kind='entity'）仅语义，不参与生成
  const blocks = toGeneratorBlocks(
    definitions.filter((d): d is BlockSchema => d.kind === 'block')
  )
  // blockItem.enabled=false 的方块只注册方块本体，不生成 BlockItem 与物品侧资源
  const itemBlocks = blocks.filter((b) => b.hasBlockItem)
  const items = definitions.filter((d): d is ItemSchema => d.kind === 'item')
  const models = definitions.filter((d): d is ModelAsset => d.kind === 'model')
  const modelMap = new Map(models.map((m) => [m.id, m]))
  const entities = definitions.filter((d): d is EntitySchema => d.kind === 'entity')
  // 建模实体参与注册：cube 模型 / blockbench_geo / AI 自定义类（customClass）。
  // 此前无模型实体被整体跳过，导致 AI 写了实体类却不注册、游戏内完全找不到；
  // 现在 customClass 实体即使无 cube 模型也注册（渲染器走默认占位，进游戏可召唤可见）。
  const cubeModeledEntities = entities.filter((e) => resolveEntityCube(e, modelMap))
  const geoModeledEntities = entities.filter((e) => resolveEntityGeo(e))
  const customClassEntities = entities.filter(
    (e) => e.customClass && !resolveEntityCube(e, modelMap) && !resolveEntityGeo(e)
  )
  const modeledEntities = [...cubeModeledEntities, ...geoModeledEntities, ...customClassEntities]
  const enchantments = definitions.filter((d): d is EnchantmentSchema => d.kind === 'enchantment')
  // 1.21+ NeoForge 附魔数据驱动（JSON），其余加载器走 Java 注册类
  const dataDrivenEnchantments = isDataDrivenEnchantment(ctx)
  const oldManifest = readManifest(root)

  const writes = new Map<string, PlannedEntry>()
  const deletes = new Map<string, { exists: boolean; drifted: boolean; skipped: boolean }>()
  // v1 清单或首轮（无清单）没有 hash 基线：本轮只建档，不判漂移
  const baseline = !oldManifest || Object.keys(oldManifest.fileHashes).length === 0
  // 上轮清单登记、本轮语义已删除的内容 id：注册类增量合并时这些 id 的旧注册语句
  // 不视为外来（否则用户在编辑器删除内容后，合并会把它永远并回来）
  const currentIds = new Set([...blocks.map((b) => b.id), ...items.map((i) => i.id)])
  const retiredContentIds = new Set(
    [...(oldManifest?.blockIds ?? []), ...(oldManifest?.itemIds ?? [])].filter(
      (id) => !currentIds.has(id)
    )
  )
  const sink = makeSink({
    root,
    dry,
    overwrite: new Set(options?.overwritePaths ?? []),
    oldHashes: oldManifest?.fileHashes ?? {},
    baseline,
    retiredContentIds,
    writes,
    deletes
  })

  // 1) Java 注册代码
  sink.text(join(ctx.registryDir, 'ModBlocks.java'), generateModBlocksJava(ctx, blocks))
  sink.text(
    join(ctx.registryDir, 'ModItems.java'),
    generateModItemsJava(ctx, itemBlocks, items, modeledEntities)
  )

  // 1b) Cube 模型：像素画 PNG 全量重写（模型 JSON 在引用方处生成）
  for (const m of models) {
    const modelTexPath = join(ctx.assetsDir, 'textures', 'model', `${m.id}.png`)
    writePixelsPng(sink, modelTexPath, m, m.textureAnimation)
    writeTexMcmeta(sink, modelTexPath, m.textureAnimation)
  }

  // 2) 方块资源
  for (const b of blocks) {
    const linkedModel = b.modelId ? modelMap.get(b.modelId) : undefined
    sink.text(
      join(ctx.assetsDir, 'blockstates', `${b.id}.json`),
      blockstateJson(ctx.modId, b.id)
    )

    const blockModelPath = join(ctx.assetsDir, 'models', 'block', `${b.id}.json`)
    if (linkedModel) {
      // 语义模型直出 Minecraft 原版模型 JSON（含 elements / 面 UV / display）
      sink.text(blockModelPath, JSON.stringify(compileModelToMcJson(linkedModel, ctx.modId), null, 2))
    } else {
      const textureRef = b.customTexture
        ? `${ctx.modId}:${b.customTexture.replace(/^textures\//, '').replace(/\.png$/, '')}`
        : `${ctx.modId}:block/${b.id}`
      sink.text(blockModelPath, blockModelJson(textureRef))
      // 自定义贴图缺失时补 16×16 占位 PNG（跨命名空间引用不归本 mod 管，跳过）
      if (b.customTexture && !b.customTexture.includes(':')) {
        ensureTexturePng(
          sink,
          join(ctx.assetsDir, 'textures', `${b.customTexture.replace(/^textures\//, '').replace(/\.png$/, '')}.png`),
          b.id,
          b.textureColor
        )
      }
    }

    if (b.hasBlockItem) {
      sink.text(
        join(ctx.assetsDir, 'models', 'item', `${b.id}.json`),
        blockItemModelJson(ctx.modId, b.id)
      )
    }

    // 模型自带贴图；自定义贴图不落 PNG；像素画优先，否则原版 cube_all 路径生成纯色 PNG
    if (!linkedModel && !b.customTexture) {
      const blockTexPath = join(ctx.assetsDir, 'textures', 'block', `${b.id}.png`)
      if (b.texturePixels) {
        // 像素画：尺寸由像素数推导（256=16，1024=32），仅支持方形
        const size = b.texturePixels.length === 1024 ? 32 : 16
        sink.bin(blockTexPath, pixelsToPng(b.texturePixels, size))
      } else {
        // 无像素画时按 id 猜花纹（宝石/砖/灯/矿石…）程序化合成，替代纯色块
        // 若 texture 类 MCP server（mc-texture-cli）就绪，Agent FC 循环可用其工具后处理
        void textureMcpServerId()
        sink.bin(
          blockTexPath,
          pixelsToPng(synthesizeBlockTexture(b.textureColor, resolveBlockPattern(b.id)), 16)
        )
      }
    }

    // 战利品表：自定义语义表优先（无视 dropsSelf），否则按 dropsSelf 自动派生掉落自身
    const blockLootPath = join(ctx.dataDir, ctx.modId, dataPath('loot_table', ctx.mcVersion), 'blocks', `${b.id}.json`)
    if (b.lootTable) {
      sink.text(
        blockLootPath,
        JSON.stringify(compileLootTable(b.lootTable, ctx.modId), null, 2)
      )
    } else if (b.dropsSelf) {
      sink.text(blockLootPath, lootTableJson(ctx.modId, b.id))
    }
  }

  // 3) 独立物品资源
  for (const i of items) {
    const linkedModel = i.cubeModelId ? modelMap.get(i.cubeModelId) : undefined
    // Agent 武器直出路径：物品内嵌 cubeModel（elements 非空）时无需独立模型资产
    const embeddedCube =
      !linkedModel && i.model.cubeModel && i.model.cubeModel.elements.length > 0
        ? i.model.cubeModel
        : null
    const modelPath = join(ctx.assetsDir, 'models', 'item', `${i.id}.json`)
    if (linkedModel) {
      // 物品直接使用带 elements 的模型 JSON；不挂 parent（链顶 builtin/generated 会让
      // ModelLoader 丢弃 elements 改走 ItemModelGenerator），手持朝向由 applyItemHeldDisplay
      // 内联原版 item/handheld 的 display 值，武器等大模型可在模型 display 里槽位级覆盖
      sink.text(
        modelPath,
        JSON.stringify(applyItemHeldDisplay(compileModelToMcJson(linkedModel, ctx.modId), linkedModel.display), null, 2)
      )
    } else if (embeddedCube) {
      // 内嵌 cube 模型：贴图复用物品 texture.pixels（texture_paint 产物），尺寸以像素数推断
      const px =
        i.texture.pixels && (i.texture.pixels.length === 256 || i.texture.pixels.length === 1024)
          ? i.texture.pixels
          : synthesizeItemTexture(i.texture.color, itemSpriteKind(i))
      const texSize = px.length === 1024 ? 32 : 16
      const tempModel: ModelAsset = {
        kind: 'model',
        id: i.id,
        displayName: i.displayName.zh_cn || i.displayName.en_us || i.id,
        description: '',
        textureSize: texSize,
        pixels: px,
        textures: { all: `textures/model/${i.id}.png` },
        elements: embeddedCube.elements,
        display: embeddedCube.display,
        createdAt: 0,
        updatedAt: 0
      }
      sink.text(
        modelPath,
        JSON.stringify(applyItemHeldDisplay(compileModelToMcJson(tempModel, ctx.modId), embeddedCube.display), null, 2)
      )
      sink.bin(join(ctx.assetsDir, 'textures', 'model', `${i.id}.png`), pixelsToPng(px, texSize))
    } else {
      const textureRef = i.texture.path
        ? `${ctx.modId}:${i.texture.path.replace(/^textures\//, '').replace(/\.png$/, '')}`
        : `${ctx.modId}:${i.model.layer0 || `item/${i.id}`}`
      sink.text(modelPath, itemModelJson(i.model.parent || 'item/generated', textureRef))
      // texture.path 指定的物品贴图缺失时补 16×16 占位 PNG
      if (i.texture.path && !i.texture.path.includes(':')) {
        ensureTexturePng(
          sink,
          join(ctx.assetsDir, 'textures', `${i.texture.path.replace(/^textures\//, '').replace(/\.png$/, '')}.png`),
          i.id,
          i.texture.color
        )
      }
    }

    if (!linkedModel && !embeddedCube && !i.texture.path) {
      const itemTexPath = join(ctx.assetsDir, 'textures', 'item', `${i.id}.png`)
      if (i.texture.pixels && i.texture.pixels.length === 256) {
        // 编辑器/AI 提供的像素画优先
        sink.bin(itemTexPath, pixelsToPng(i.texture.pixels, 16))
      } else {
        // 否则按物品种类程序化合成带明暗的像素画（替代纯色占位）
        sink.bin(itemTexPath, pixelsToPng(synthesizeItemTexture(i.texture.color, itemSpriteKind(i)), 16))
        // 若 texture 类 MCP server（mc-texture-cli）就绪，Agent FC 循环可用其工具对上述 PNG 后处理
        void textureMcpServerId()
      }
    }

    // 物品战利品表：供自定义逻辑/命令引用
    if (i.lootTable) {
      sink.text(
        join(ctx.dataDir, ctx.modId, dataPath('loot_table', ctx.mcVersion), 'items', `${i.id}.json`),
        JSON.stringify(compileLootTable(i.lootTable, ctx.modId), null, 2)
      )
    }
  }

  // 3b) 图集 source 声明：原版 blocks 图集仅收录 textures/block|item 等目录，
  // 本工具 cube 模型贴图统一落在 textures/model/，必须经 atlases 声明并入图集。
  // 注意：blocks 图集的 atlasInfoLocation 是 minecraft:blocks（BLOCK_ATLAS_TEXTURE → "blocks"），
  // 因此该 JSON 必须落在 assets/minecraft/atlases/blocks.json（mod 包可携带 minecraft 命名空间，
  // AtlasLoader.getAllResources 会合并各包 sources），放本 mod 命名空间下不会被读取
  const hasModelTextures =
    models.length > 0 || items.some((i) => i.model.cubeModel && i.model.cubeModel.elements.length > 0)
  if (hasModelTextures) {
    sink.text(
      join(ctx.resourcesDir, 'assets', 'minecraft', 'atlases', 'blocks.json'),
      JSON.stringify({ sources: [{ type: 'directory', source: 'model', prefix: 'model/' }] }, null, 2)
    )
  }

  // 3a) 实体 Java 产物（仅 Fabric/Yarn；仅已建模实体）
  if (ctx.loader === 'fabric' && modeledEntities.length > 0) {
    for (const e of modeledEntities) {
      const geoInfo = resolveEntityGeo(e)
      if (geoInfo) {
        // GeckoLib 骨骼动画实体：geo.json 原样落盘 + 参数化 idle/walk/attack 动画 +
        // GeoEntity 实体类 + GeoModel/GeoEntityRenderer 渲染层（不生成 EntityModelLayer）；
        // B1-2：工坊文档有合法控制器状态机时实体 Java 按状态机生成谓词
        const ctrl = resolveEntityAnimationController(root, e)
        sink.text(
          join(ctx.javaDir, 'entity', `${entityClassName(e)}.java`),
          fabricEntityJavaWithController(ctx, e, true, ctrl)
        )
        sink.text(
          join(ctx.javaDir, 'entity', `${pascal(e.id)}GeoModel.java`),
          fabricGeoModelJava(ctx, e)
        )
        sink.text(
          join(ctx.javaDir, 'entity', `${pascal(e.id)}Renderer.java`),
          fabricGeoRendererJava(ctx, e)
        )
        sink.text(
          join(ctx.assetsDir, 'geo', 'entity', `${e.id}.geo.json`),
          JSON.stringify(JSON.parse(e.renderer.geoJson!), null, 2)
        )
        sink.text(
          join(ctx.assetsDir, 'animations', 'entity', `${e.id}.animation.json`),
          // 已创作动画（工坊文档导出）优先，模板动画补全控制器引用缺项
          JSON.stringify(resolveEntityAnimationFile(root, e, geoInfo.boneNames), null, 2)
        )
        // 贴图：工坊文档主贴图（renderer.texturePng，「应用到实体」直出）优先；
        // 缺省内嵌 cube 像素画，再缺省按刷怪蛋主色铺底（geo 描述里的贴图尺寸）
        const cube = resolveEntityCube(e, modelMap)
        const size = Math.max(16, geoInfo.textureWidth, geoInfo.textureHeight)
        const geoTexPath = join(ctx.assetsDir, 'textures', 'entity', `${e.id}.png`)
        sink.bin(
          geoTexPath,
          e.renderer.texturePng
            ? Buffer.from(e.renderer.texturePng, 'base64')
            : cube
              ? pixelsToPng(cube.pixels, cube.textureSize)
              : pixelsToPng(
                  Array.from({ length: size * size }, () => e.properties.primaryColor),
                  size
                )
        )
        writeTexMcmeta(sink, geoTexPath, resolveEntityTextureAnimation(root, e, modelMap))
      } else {
        const cube = resolveEntityCube(e, modelMap)
        if (cube) {
          sink.text(join(ctx.javaDir, 'entity', `${entityClassName(e)}.java`), fabricEntityJava(ctx, e))
          sink.text(
            join(ctx.javaDir, 'entity', `${pascal(e.id)}Model.java`),
            fabricEntityModelJava(ctx, e, cube)
          )
          sink.text(
            join(ctx.javaDir, 'entity', `${pascal(e.id)}Renderer.java`),
            fabricEntityRendererJava(ctx, e)
          )
          const cubeTexPath = join(ctx.assetsDir, 'textures', 'entity', `${e.id}.png`)
          const cubeTexAnim = resolveEntityTextureAnimation(root, e, modelMap)
          writePixelsPng(sink, cubeTexPath, cube, cubeTexAnim)
          writeTexMcmeta(sink, cubeTexPath, cubeTexAnim)
        } else {
          // AI 自定义类实体（无 cube 模型）：实体类由 AI 负责，生成器补「占位模型 + 占位渲染器 + 默认贴图」，
          // 确保 ModEntities/客户端注册可编译，且进游戏后实体可见可召唤（AI 可后续覆盖为正式模型/渲染器）。
          sink.text(
            join(ctx.javaDir, 'entity', `${pascal(e.id)}Model.java`),
            fabricFallbackModelJava(ctx, e)
          )
          sink.text(
            join(ctx.javaDir, 'entity', `${pascal(e.id)}Renderer.java`),
            fabricFallbackRendererJava(ctx, e)
          )
          sink.bin(
            join(ctx.assetsDir, 'textures', 'entity', `${e.id}.png`),
            pixelsToPng(
              Array.from({ length: 16 * 16 }, () => e.properties.primaryColor),
              16
            )
          )
        }
      }
    }
    sink.text(
      join(ctx.registryDir, 'ModEntities.java'),
      fabricModEntitiesJava(ctx, modeledEntities)
    )
    sink.text(
      join(ctx.javaDir, `${ctx.modClassName}Client.java`),
      fabricClientJava(ctx, cubeModeledEntities, geoModeledEntities, customClassEntities)
    )
    // 主类 / fabric.mod.json 织入（保留用户手改，仅最小结构合并）
    syncFabricMainClass(ctx, modeledEntities, sink)
    syncFabricModJson(ctx, modeledEntities, sink, geoModeledEntities.length > 0)
    // GeckoLib 依赖织入（build.gradle / gradle.properties，幂等按标记增删）
    syncFabricGeckolib(root, geoModeledEntities, sink)
  } else if (ctx.loader === 'fabric') {
    // 无已建模实体：撤销历史织入，避免悬挂引用导致编译失败
    syncFabricMainClass(ctx, [], sink)
    syncFabricModJson(ctx, [], sink)
    syncFabricGeckolib(root, [], sink)
  } else if (modeledEntities.length > 0) {
    // Mojmap（Forge/NeoForge）实体分支：DeferredRegister + 注解驱动 Setup 织入
    for (const e of modeledEntities) {
      const geoInfo = resolveEntityGeo(e)
      const cube = resolveEntityCube(e, modelMap)
      // Mojmap 实体暂不支持 GeckoLib：geo 实体退化为静态 cube 路径；
      // 无 cube 数据时按 geo 贴图尺寸以主色铺底、空模型占位（实体类头注释显式标注）
      const size = Math.max(16, geoInfo?.textureWidth ?? 16, geoInfo?.textureHeight ?? 16)
      const cubeData = cube ?? {
        textureSize: size,
        pixels: Array.from({ length: size * size }, () => e.properties.primaryColor),
        elements: []
      }
      sink.text(
        join(ctx.javaDir, 'entity', `${mojmapEntityClassName(e)}.java`),
        mojmapEntityJava(ctx, e, geoInfo !== null)
      )
      sink.text(
        join(ctx.javaDir, 'entity', `${mojmapEntityModelClassName(e)}.java`),
        mojmapEntityModelJava(ctx, e, cubeData)
      )
      sink.text(
        join(ctx.javaDir, 'entity', `${mojmapEntityRendererClassName(e)}.java`),
        mojmapEntityRendererJava(ctx, e)
      )
      const mojmapTexPath = join(ctx.assetsDir, 'textures', 'entity', `${e.id}.png`)
      const mojmapTexAnim = resolveEntityTextureAnimation(root, e, modelMap)
      writePixelsPng(sink, mojmapTexPath, cubeData, mojmapTexAnim)
      writeTexMcmeta(sink, mojmapTexPath, mojmapTexAnim)
    }
    sink.text(
      join(ctx.registryDir, 'ModEntities.java'),
      mojmapModEntitiesJava(ctx, modeledEntities)
    )
    sink.text(
      join(ctx.javaDir, 'entity', 'ModEntitySetup.java'),
      mojmapEntitySetupJava(ctx, modeledEntities)
    )
    sink.text(
      join(ctx.javaDir, 'entity', 'ClientEntitySetup.java'),
      mojmapClientEntitySetupJava(ctx, modeledEntities)
    )
  }
  // Mojmap 主类织入：挂载/撤销 ModEntities.ENTITIES 事件总线注册（DeferredRegister 必须挂总线才生效）
  if (ctx.loader !== 'fabric') {
    syncMojmapEntitiesMainClass(ctx, modeledEntities.length > 0, sink)
  }

  // 刷怪蛋物品模型（所有加载器公共路径）：引用原版 template_spawn_egg 模板（双层染色），无需贴图文件。
  // 缺失会导致构建后资源校验报 FileNotFoundException: models/item/<id>_spawn_egg.json
  for (const e of modeledEntities) {
    if (e.spawnEgg.enabled) {
      sink.text(
        join(ctx.assetsDir, 'models', 'item', `${e.id}_spawn_egg.json`),
        JSON.stringify({ parent: 'minecraft:item/template_spawn_egg' }, null, 2)
      )
    }
  }

  // 3b) 实体战利品表（编译为数据文件，供实体类死亡掉落引用）
  for (const e of entities) {
    if (e.lootTable) {
      sink.text(
        join(ctx.dataDir, ctx.modId, dataPath('loot_table', ctx.mcVersion), 'entities', `${e.id}.json`),
        JSON.stringify(compileLootTable(e.lootTable, ctx.modId), null, 2)
      )
    }
  }

  // 3c) 配方（归属方块/物品/实体对象，编译为 data/<ns>/<recipeDir>/<id>.json）
  for (const d of definitions) {
    const recipeList = (d as { recipes?: import('../../../shared/schemas/recipe.schema').RecipeDef[] }).recipes
    if (!recipeList) continue
    for (const r of recipeList) {
      sink.text(
        join(ctx.dataDir, ctx.modId, dataPath('recipe', ctx.mcVersion), `${r.id}.json`),
        JSON.stringify(compileRecipe(r, ctx.modId, ctx.mcVersion), null, 2)
      )
    }
  }

  // 3d) 特性④ GameTest 无头测试类（仅 Fabric/Yarn；src/test/java/<pkg>/gametest/<Class>GameTests.java）
  // 使用 fabric:empty_3x3_3 内置模板，无需手编 .nbt 结构文件
  const gameTests = definitions.filter((d): d is GameTestSchema => d.kind === 'gametest')
  if (ctx.loader === 'fabric' && gameTests.length > 0) {
    const javaContent = generateGameTestClasses(gameTests, ctx)
    if (javaContent) {
      const javaRel = gameTestJavaRelPath(ctx)
      sink.text(join(root, javaRel), javaContent)
    }
  } else if (ctx.loader === 'fabric') {
    // 无 gametest 内容：清理历史产物（漂移保护仍生效）
    const stalePath = gameTestJavaRelPath(ctx)
    if (oldManifest?.files.includes(stalePath)) {
      sink.remove(join(root, stalePath))
    }
  }

  // 3e) 附魔：1.20.1 出 ModEnchantments.java 并织入主类；1.21 NeoForge 出数据 JSON
  if (!dataDrivenEnchantments && enchantments.length > 0) {
    sink.text(
      join(ctx.registryDir, 'ModEnchantments.java'),
      generateModEnchantmentsJava(ctx, enchantments)
    )
  }
  if (dataDrivenEnchantments) {
    for (const e of enchantments) {
      sink.text(
        join(ctx.dataDir, ctx.modId, dataPath('enchantment', ctx.mcVersion), `${e.id}.json`),
        JSON.stringify(compileEnchantmentJson(ctx, e), null, 2)
      )
    }
  }
  if (ctx.loader === 'fabric') {
    // 1.21+ 数据驱动时主类不保留 Java 注册织入：传空列表触发旧织入清理
    syncFabricEnchantments(ctx, dataDrivenEnchantments ? [] : enchantments, sink)
  } else {
    // Mojmap 路线总是同步；1.21+ 数据驱动时 active=false，清除升级前的旧织入
    syncMojmapEnchantmentMainClass(ctx, !dataDrivenEnchantments && enchantments.length > 0, sink)
  }

  // 4) 挖掘工具/等级标签（按 relPath 聚合，含上轮旧文件以便清理）
  // 标签目录 1.21+ 为 tags/block、tags/enchantment（单数），此前为复数
  const blockTagDir = tagRegistryPath('block', ctx.mcVersion)
  const enchantmentTagDir = tagRegistryPath('enchantment', ctx.mcVersion)
  const tagMap = new Map<string, string[]>()
  const putTag = (relPath: string, value: string): void => {
    const list = tagMap.get(relPath) ?? []
    list.push(value)
    tagMap.set(relPath, list)
  }
  for (const b of blocks) {
    if (b.miningTool !== 'hand' && b.miningTool !== 'sword') {
      putTag(
        `src/main/resources/data/minecraft/tags/${blockTagDir}/mineable/${b.miningTool}.json`,
        `${ctx.modId}:${b.id}`
      )
    }
    if (b.requiresTool && b.miningLevel >= 1) {
      const tag =
        b.miningLevel === 1
          ? 'needs_stone_tool'
          : b.miningLevel === 2
            ? 'needs_iron_tool'
            : 'needs_diamond_tool'
      putTag(
        `src/main/resources/data/minecraft/tags/${blockTagDir}/${tag}.json`,
        `${ctx.modId}:${b.id}`
      )
    }
  }
  // 1.21 数据驱动附魔：宝藏/诅咒语义通过附魔标签声明（JSON 本体无对应字段）
  if (dataDrivenEnchantments) {
    for (const e of enchantments) {
      if (e.treasure) {
        putTag(
          `src/main/resources/data/minecraft/tags/${enchantmentTagDir}/treasure.json`,
          `${ctx.modId}:${e.id}`
        )
      }
      if (e.curse) {
        putTag(
          `src/main/resources/data/minecraft/tags/${enchantmentTagDir}/curse.json`,
          `${ctx.modId}:${e.id}`
        )
      }
    }
  }
  const tagSnapshot: Record<string, string[]> = {}
  const allTagPaths = new Set([...Object.keys(oldManifest?.tags ?? {}), ...tagMap.keys()])
  for (const relPath of allTagPaths) {
    const removed = syncTagFile(
      join(root, relPath),
      tagMap.get(relPath) ?? [],
      oldManifest?.tags[relPath] ?? [],
      sink
    )
    if (!removed) tagSnapshot[relPath] = [...(tagMap.get(relPath) ?? [])].sort()
  }

  // 5) 语言文件（方块/物品/实体为多语言名称；模型/配方沿用单名）
  const enLangKeys: Record<string, string> = {}
  const zhLangKeys: Record<string, string> = {}
  const putLang = (kind: string, id: string, en: string, zh: string): void => {
    const key = `${kind}.${ctx.modId}.${id}`
    enLangKeys[key] = en || id
    zhLangKeys[key] = zh || id
  }
  for (const b of blocks) {
    putLang('block', b.id, b.nameEn, b.nameZh)
  }
  for (const i of items) {
    putLang('item', i.id, itemDisplayName(i, 'en_us'), itemDisplayName(i, 'zh_cn'))
  }
  for (const e of modeledEntities) {
    putLang('entity', e.id, e.displayName.en_us, e.displayName.zh_cn)
    if (e.spawnEgg.enabled) {
      putLang(
        'item',
        `${e.id}_spawn_egg`,
        `${e.displayName.en_us || e.id} Spawn Egg`,
        `${e.displayName.zh_cn || e.id}刷怪蛋`
      )
    }
  }
  for (const d of definitions) {
    if (d.kind !== 'model' && d.kind !== 'recipe') continue
    putLang(d.kind, d.id, d.displayName || d.id, d.displayName || d.id)
  }
  for (const e of enchantments) {
    putLang('enchantment', e.id, e.displayName.en_us, e.displayName.zh_cn)
    // 附魔描述语言键（enchantment.ns.id.desc）；双语皆空时不落键
    const descKey = `enchantment.${ctx.modId}.${e.id}.desc`
    if (e.description.en_us.trim()) enLangKeys[descKey] = e.description.en_us
    if (e.description.zh_cn.trim()) zhLangKeys[descKey] = e.description.zh_cn
  }
  const langKeyList = [...new Set([...Object.keys(enLangKeys), ...Object.keys(zhLangKeys)])].sort()
  // 首次生成时清理模板 example_block 的语言键
  const exampleLangKeys = oldManifest
    ? []
    : [`block.${ctx.modId}.example_block`, `item.${ctx.modId}.example_block`]
  const enLangPath = join(ctx.assetsDir, 'lang', 'en_us.json')
  const zhLangPath = join(ctx.assetsDir, 'lang', 'zh_cn.json')
  syncLangFile(enLangPath, enLangKeys, oldManifest?.langKeys ?? [], exampleLangKeys, sink)
  syncLangFile(zhLangPath, zhLangKeys, oldManifest?.langKeys ?? [], exampleLangKeys, sink)

  // 6) 清理：上轮清单中本轮不再产出的文件 + 首次运行清理模板 example
  if (!oldManifest) {
    cleanupTemplateExample(ctx, sink)
  } else {
    for (const old of oldManifest.files) {
      if (!writes.has(old)) sink.remove(join(root, old))
    }
  }

  return {
    blockIds: blocks.map((b) => b.id),
    itemIds: items.map((i) => i.id),
    modelIds: models.map((m) => m.id),
    tagSnapshot,
    langKeyList,
    writes,
    deletes,
    keptFromDelete: sink.keptFromDelete,
    prevDiverged: oldManifest?.diverged ?? []
  }
}

/**
 * 执行全量生成：读取 .kunyu/content 下全部语义资产，
 * 重写注册代码与资源，返回写入清单。
 * 漂移文件默认跳过（不覆盖用户手改）；用户在冲突对话框确认的路径经 overwritePaths 覆盖。
 */
export function generateContent(
  root: string,
  definitions: ContentDefinition[],
  options?: GenerateOptions
): GenerateResult {
  assertWithinRoot(root)
  const oldManifest = readManifest(root)
  const oldHashes = oldManifest?.fileHashes ?? {}
  const run = runGeneration(root, definitions, false, options)
  const { files: managedFiles, fileHashes, diverged } = collectManagedFiles(root, run, oldHashes)

  // 7) 写新清单
  const manifest: Manifest = {
    version: 2,
    files: managedFiles,
    blockIds: run.blockIds,
    itemIds: run.itemIds,
    modelIds: run.modelIds,
    tags: run.tagSnapshot,
    langKeys: run.langKeyList,
    fileHashes,
    diverged
  }
  writeFile(
    join(root, '.kunyu', 'content', 'generated.json'),
    JSON.stringify(manifest, null, 2) + '\n'
  )

  const writtenFiles: GeneratedFile[] = [
    ...[...run.writes.entries()]
      .filter(([, e]) => !e.skipped)
      .map(([path]) => ({ path, action: 'write' as const })),
    ...[...run.deletes.entries()]
      .filter(([, e]) => e.exists && !e.skipped)
      .map(([path]) => ({ path, action: 'delete' as const }))
  ].sort((a, b) => a.path.localeCompare(b.path))

  // 入口包与 maven_group 分歧时显式带回 UI，不再静默
  let packageDivergence: GenerateResult['packageDivergence'] = null
  try {
    const ctx = resolveModContext(root)
    if (ctx.packageDiverged) {
      packageDivergence = { packageName: ctx.packageName, mavenGroup: ctx.mavenGroup }
    }
  } catch {
    // 非模组项目（资源包/数据包等）无 ModContext，跳过
  }

  return {
    files: writtenFiles,
    blockIds: run.blockIds,
    itemIds: run.itemIds,
    diverged,
    packageDivergence
  }
}

/**
 * 生成预检（dry-run，零副作用）：列出计划写入/删除文件，
 * 并标出磁盘内容相对工具上次产物已漂移、需要用户决策的冲突项。
 */
export function planGeneration(root: string, definitions: ContentDefinition[]): GenerationPlan {
  assertWithinRoot(root)
  const oldManifest = readManifest(root)
  const run = runGeneration(root, definitions, true)
  const toPlanned = (
    rp: string,
    e: { exists: boolean; drifted: boolean; skipped: boolean },
    action: 'write' | 'delete'
  ): PlannedFile => ({ path: rp, action, exists: e.exists, drifted: e.drifted, willWrite: !e.skipped })
  const writes = [...run.writes.entries()]
    .map(([rp, e]) => toPlanned(rp, e, 'write'))
    .sort((a, b) => a.path.localeCompare(b.path))
  const deletes = [...run.deletes.entries()]
    .map(([rp, e]) => toPlanned(rp, e, 'delete'))
    .sort((a, b) => a.path.localeCompare(b.path))
  // 冲突 = 漂移且默认策略下不会落盘（跳过）的项；merge 已处理的（注册类增量合并、
  // lang/tags 合并写）不需要用户决策，不进冲突列表
  const conflicts = [...writes, ...deletes].filter((f) => f.drifted && f.exists && !f.willWrite)
  return {
    conflicts,
    writes,
    deletes,
    diverged: oldManifest?.diverged ?? []
  }
}
