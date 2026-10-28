/**
 * 语义资产 chat 工具（从 toolRegistry.ts builtinContentTools 拆出）：
 * content_list / content_read / content_upsert / write_project_file /
 * texture_paint / texture_pixelize / texture_repaint / texture_asset_search / model_validate / item_validate。
 * 直接读写 .kunyu/content JSON，与可视化表单同源。
 */
import type { RegisteredTool, ToolRegistryDeps } from '../toolRegistry'
import { clipToolText } from './textClip'
import { checkProjectSourceWritable, lintBraceBalance, lintJavaOwnership } from './projectFilePolicy'
import { listContent, loadContent, saveContent, saveItemTexture, saveModelTexture } from '../../contentService'
import { searchImageAssets } from '../../imageAssetIndex'
import { validateModel, hasModelError } from '../../modelCompiler'
import {
  PAINT_SHAPES,
  PAINT_SHAPE_LABELS,
  paintPixels,
  validatePaintShape
} from '../pixelArtGenerator'
import { pixelizeDataUrl, pixelsToPngDataUrl } from '../pixelize'
import { repaintTexture } from '../textureRepaint'
import { saveGalleryItems } from '../galleryService'
import {
  normalizeItemSchema,
  validateItemSchema,
  type ItemSchema
} from '../../../../shared/schemas/item.schema'
import type {
  ContentDefinition,
  ContentKind,
  ModelAsset
} from '../../../../shared/types/content'
import { readFileSync } from 'node:fs'
import { resolve, relative } from 'node:path'

const CONTENT_KINDS = ['block', 'item', 'entity', 'model', 'enchantment', 'recipe', 'biome', 'advancement'] as const

function asContentKind(v: unknown): ContentKind | null {
  return typeof v === 'string' && (CONTENT_KINDS as readonly string[]).includes(v)
    ? (v as ContentKind)
    : null
}

/** Cube 模型 JSON 形状（写进工具描述，指导造匠正确构造 elements/UV） */
const MODEL_SHAPE_DESCRIPTION =
  '模型 JSON 关键字段：textureSize=16|32；pixels 为长度 textureSize² 的 #rrggbb/"" 数组' +
  '（可省略，省略时保留既有像素画）；elements[] 每项 {name,from:[x,y,z],to:[x,y,z]（0..16），' +
  'faces:{north|south|east|west|up|down:{uv:[u1,v1,u2,v2],texture:"#all",rotation?:0|90|180|270}}，' +
  '可选 rotation:{origin:[x,y,z],axis:"x"|"y"|"z",angle:22.5 的倍数（-45..45）}}；' +
  'textures:{all:"textures/model/<id>.png"}；display.gui={rotation:[30,225,0],scale:[0.625,0.625,0.625]}。' +
  '武器（刀/剑/枪/斧/法杖/匕首）必须先用 template_search 检索「weapon-3d-recipes」获取已验证配方' +
  '（katana/greatsword/spear/staff/axe/dagger 六套），按配方坐标构造 elements 并按用户描述改色改尺寸；' +
  '无配方匹配时可参考基础剑型：刃 blade from[7,5,7] to[9,14,9]；护手 from[5.5,4,6.5] to[10.5,5,9.5]；' +
  '握柄 from[7.5,1,7.5] to[8.5,4,8.5]；顶饰宝石 from[7.5,4.2,7.5] to[8.5,5,8.5]；' +
  '各面 uv 全用 [0,0,16,16] 映射 #all。贴图用 texture_paint（shape 选 sword/gem）生成。'

/** 方块 JSON 形状（与 block.schema.ts 契约同源） */
const BLOCK_SHAPE_DESCRIPTION =
  '方块 JSON 关键字段：kind:"block"；blockType:"simple"|"directional"|"toggle"|"interactive"|"entity"；' +
  'id 为小写下划线；displayName:{en_us,zh_cn} 至少填一种语言；' +
  'properties:{hardness:0-50,resistance:0-100,requiresTool:boolean,toolType:"hand"|"pickaxe"|"axe"|"shovel"|"hoe"|"sword",' +
  'miningLevel:0-4,lightLevel:0-15,opaque:boolean,renderType:"solid"|"cutout"|"translucent",' +
  'soundGroup:"stone"|"wood"|"gravel"|"metal"|"glass"|"wool",hasCollision:boolean,canBePushed:boolean,' +
  'dropsSelf:boolean,flammable:boolean}；texture:{path:"",generated:true,color:"#rrggbb"}（path 留空生成占位色）；' +
  'model:{type:"cube_all"|"cube"|"cross"|"slab"|"stairs"|"custom"}；cubeModelId:null 或 Cube 模型 id；' +
  'blockItem:{enabled:true,creativeTab:""}。blockStates/blockEntity/interaction 随 blockType 自动播种，仅保存语义。'

/** 实体 JSON 形状（与 entity.schema.ts 契约同源；仅语义，不生成 Java） */
const ENTITY_SHAPE_DESCRIPTION =
  '实体 JSON 关键字段：kind:"entity"；entityType:"passive"|"hostile"|"neutral"|"projectile"|"plain"；' +
  'id 为小写下划线；displayName:{en_us,zh_cn} 至少填一种语言；properties 为碰撞箱/追踪/生物分组/双配色；' +
  'attributes 为生命值/移速/攻击/击退抗性等数值；ai:{goals:[{type,priority,params}],targets:[{type,priority,params}]}；' +
  'spawn/spawnEgg/texture/renderer 为生成与渲染配置。切换 entityType 会自动播种该类型默认属性与 AI。'

/** 物品 JSON 形状（写进工具描述，指导造匠正确构造五类型配置；与 item.schema.ts 契约同源） */
const ITEM_SHAPE_DESCRIPTION =
  '物品 JSON 关键字段：kind:"item"；itemType:"simple"|"tool"|"armor"|"food"|"block_item"；' +
  'id 为小写下划线；displayName:{en_us,zh_cn} 至少填一种语言；' +
  'properties:{maxCount:1-64，有耐久时固定 1；maxDamage:0 表示无耐久；' +
  'rarity:"common"|"uncommon"|"rare"|"epic"；fireproof:boolean；creativeTab:string 可空}；' +
  'texture:{path:"",generated:true,color:"#rrggbb"}；像素画严禁手写 pixels——先 content_upsert 建物品骨架，' +
  '有用户参考图时用 texture_pixelize 像素化参考图，用户要求按文字改画/重绘时用 texture_repaint（用户自带图像 Key），' +
  '两者都没有时用 texture_paint 程序化生成（均返回 ASCII 预览自检重画）；' +
  'model:{parent 仅扁平 2D 用 "item/generated"，layer0:"item/<id>"，' +
  'cubeModel:{textureSize,pixels,elements,display?} 内嵌 3D 立方体模型（保存时自动导出为独立模型资产并绑定；' +
  '严禁给 cubeModel 配 parent:item/handheld——parent 链顶为 builtin/generated 时游戏会丢弃 elements 改从 layer0 重建致模型隐形，' +
  '编译器已自动内联原版手持 display，仅需在 display 槽位级覆盖如第三人称放大）}。' +
  '模型选择（硬性规则）：itemType=tool 的工具/武器一律默认产 3D cubeModel——先 template_search 检索 ' +
  '「weapon-3d-recipes」按 katana/greatsword/spear/staff/axe/dagger 配方构造，禁止只给扁平贴图模型；' +
  '仅用户明确说「扁平/2D/贴图即可」时才走 parent+layer0。simple/food 等装饰性物品仍默认扁平模型+好贴图。' +
  'tool:{toolKind:"pickaxe"|"axe"|"shovel"|"hoe"|"sword",material:"wood"|"stone"|"iron"|"gold"|"diamond"|"netherite",' +
  'attackDamage:number,attackSpeed:负值如-2.4,miningLevel:0-4}；' +
  'armor:{slot:"helmet"|"chestplate"|"leggings"|"boots",material,protection:0-20,durability:0-9999,' +
  'toughness:0-20,knockbackResistance:0-1}；' +
  'food:{hunger:1-20,saturation:0-1,meat:boolean,alwaysEdible:boolean,snack:boolean,effects:[{effect:"minecraft:speed"等,' +
  'duration:tick,amplifier:0起,chance:0-1}]}；block_item:{blockRef:"方块注册名如 ruby_ore"}。'

/** 附魔 JSON 形状（与 enchantment.schema.ts 契约同源） */
const ENCHANTMENT_SHAPE_DESCRIPTION =
  '附魔 JSON 关键字段：kind:"enchantment"；id 为小写下划线；displayName:{en_us,zh_cn} 至少填一种语言；' +
  'description:{en_us,zh_cn} 为附魔说明（可空）；rarity:"COMMON"|"UNCOMMON"|"RARE"|"VERY_RARE"；' +
  'target 适用物品类别："ALL"|"ARMOR"|"ARMOR_FEET"|"ARMOR_LEGS"|"ARMOR_CHEST"|"ARMOR_HEAD"|' +
  '"WEAPON"|"TOOL"|"BOW"|"CROSSBOW"|"TRIDENT"|"FISHING_ROD"|"WEARABLE"|"BREAKABLE"|"VANISHABLE"；' +
  'slots 生效槽位数组："mainhand"|"offhand"|"head"|"chest"|"legs"|"feet"（至少 1 个）；' +
  'maxLevel:1-255；treasure:boolean（宝藏附魔）；curse:boolean（诅咒）；' +
  '附魔台消耗曲线 minCostBase/minCostPerLevel（第 L 级消耗=base+(L-1)*perLevel）、maxCostExtra（最大消耗=同级最小+增量）；' +
  'anvilCost:number；可选 damageBonus:{base,perLevel} 攻击伤害加成。' +
  '生成路线由工程加载器自动决定：1.20.1 Fabric/Forge 出 Java 注册类，NeoForge 1.21+ 出数据驱动 JSON。'

/** 喂给模型的物品文本：省略 texture.pixels 大数组，只给摘要（像素画不撑爆上下文） */
function itemToText(item: ItemSchema): string {
  const pixels = item.texture?.pixels
  if (!pixels || pixels.length === 0) return JSON.stringify(item, null, 2)
  return JSON.stringify(
    {
      ...item,
      texture: {
        ...item.texture,
        pixels: undefined,
        pixelsSummary: { length: pixels.length, painted: pixels.filter((p) => p).length }
      }
    },
    null,
    2
  )
}

/** 喂给模型的模型文本：省略 pixels 大数组，只给摘要（结构编辑不需要逐像素数据） */
function contentToText(def: ContentDefinition): string {
  if (def.kind === 'item') return itemToText(def as ItemSchema)
  if (def.kind !== 'model') return JSON.stringify(def, null, 2)
  const { pixels, ...rest } = def as ModelAsset
  return JSON.stringify(
    {
      ...rest,
      pixelsSummary: { length: pixels.length, painted: pixels.filter((p) => p).length }
    },
    null,
    2
  )
}

/** Agent 只改模型结构（未带 pixels）时合并既存像素，避免清空已绘制的贴图 */
function mergeModelForUpsert(input: ContentDefinition, root: string, prevId?: string): ContentDefinition {
  if (input.kind !== 'model') return input
  const m = input as ModelAsset
  if (Array.isArray(m.pixels) && m.pixels.length > 0) return m
  try {
    const existing = loadContent(root, 'model', prevId ?? m.id) as ModelAsset
    return {
      ...existing,
      ...m,
      pixels: existing.pixels,
      textureSize: m.textureSize ?? existing.textureSize,
      textures: m.textures ?? existing.textures,
      display: m.display ?? existing.display
    }
  } catch {
    return m
  }
}

/**
 * Agent 更新物品（texture 字段不全，常见不带 256 项 pixels）时逐字段合并既存贴图，
 * 避免丢掉用户已绘制的像素画 / 已导入的自定义贴图。
 */
function mergeItemForUpsert(input: ContentDefinition, root: string, prevId?: string): ContentDefinition {
  if (input.kind !== 'item') return input
  const item = input as ItemSchema
  if (Array.isArray(item.texture?.pixels) && item.texture.pixels.length > 0) return input
  try {
    const existing = loadContent(root, 'item', prevId ?? item.id) as ItemSchema
    const mergedTexture = {
      path: item.texture?.path || existing.texture?.path || '',
      generated: item.texture?.generated ?? existing.texture?.generated ?? true,
      color: item.texture?.color || existing.texture?.color || '#cbb37a',
      pixels: item.texture?.pixels ?? existing.texture?.pixels
    }
    return { ...existing, ...item, texture: mergedTexture }
  } catch {
    return input
  }
}

/** 换行归一到 LF（编辑匹配/回写都以 LF 为中间态，写回时再还原文件原有行尾） */
function toLf(text: string): string {
  return text.replace(/\r\n?/g, '\n')
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function lineOf(contentLf: string, index: number): number {
  return contentLf.slice(0, index).split('\n').length
}

/** 编辑片段在 content 中的一处真实命中（index/length 均为 LF 归一后的字符区间） */
interface EditHit {
  index: number
  length: number
}

/**
 * 片段定位（OpenAI Codex apply-patch 式「四遍递减严格度」）：
 * 严格档位优先，命中唯一即采用；某档位命中多处说明该 search 本身歧义（要求模型补上下文）；
 * 全部落空才回 -1，由调用方给最近邻行号提示。宽松档位容忍模型誊抄 search 时的空白/智能引号抖动，
 * 避免「一字不差」的过度苛刻把整轮打成空转。
 */
const PUNCT_EQUIV: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["'", ['‘', '’', '‚', '‛']],
  ['"', ['“', '”', '„', '‟']],
  ['-', ['‐', '‑', '‒', '–', '—', '−']]
]
/** 变体字符 → ASCII 规范字符 */
const PUNCT_CANON = new Map<string, string>(
  PUNCT_EQUIV.flatMap(([ascii, variants]) => variants.map((v) => [v, ascii] as const))
)
/** ASCII 规范字符 → 匹配其任一变体的正则片段 */
const PUNCT_GROUP = new Map<string, string>(
  PUNCT_EQUIV.map(([ascii, variants]) => [
    ascii,
    `(?:${[ascii, ...variants].map(escapeRegExp).join('|')})`
  ])
)

/** 第 3 档用：一行 → 正则片段（标点按等价类放宽，其余逐字转义） */
function unicodePatternLine(line: string): string {
  let out = ''
  for (const ch of line) {
    const canon = PUNCT_CANON.get(ch) ?? ch
    out += PUNCT_GROUP.get(canon) ?? escapeRegExp(ch)
  }
  return out
}

function collectHits(re: RegExp, contentLf: string): EditHit[] {
  const hits: EditHit[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(contentLf)) !== null) {
    hits.push({ index: m.index, length: m[0].length })
    if (m.index === re.lastIndex) re.lastIndex++
    if (hits.length >= 50) break
  }
  return hits
}

/** 第 0 档：逐字精确（indexOf 语义），返回全部非重叠命中 */
function exactHits(contentLf: string, searchLf: string): EditHit[] {
  const hits: EditHit[] = []
  let at = contentLf.indexOf(searchLf)
  while (at >= 0 && hits.length < 50) {
    hits.push({ index: at, length: searchLf.length })
    at = contentLf.indexOf(searchLf, at + Math.max(1, searchLf.length))
  }
  return hits
}

/** 逐行构造正则（joiner 控制行间空白抖动容忍度）后在全文找所有命中 */
function linePatternHits(
  contentLf: string,
  searchLf: string,
  joiner: string,
  lineFn: (line: string) => string
): EditHit[] {
  const pattern = searchLf.split('\n').map(lineFn).join(joiner)
  return collectHits(new RegExp(pattern, 'g'), contentLf)
}

const SEEK_PASSES: ReadonlyArray<(contentLf: string, searchLf: string) => EditHit[]> = [
  (c, s) => exactHits(c, s),
  (c, s) => linePatternHits(c, s, '[ \\t]*\\n', (l) => escapeRegExp(l.trimEnd())),
  (c, s) => linePatternHits(c, s, '[ \\t]*\\n[ \\t]*', (l) => escapeRegExp(l.trim())),
  (c, s) => linePatternHits(c, s, '[ \\t]*\\n[ \\t]*', (l) => unicodePatternLine(l.trim()))
]

/** 档位文案（成功回执/歧义提示用；宽松档位统一含「宽松匹配」便于识别兜底） */
const SEEK_PASS_LABELS = [
  '精确匹配',
  '宽松匹配（行尾空白）',
  '宽松匹配（两侧空白）',
  '宽松匹配（Unicode 标点归一）'
] as const

function seekSequence(contentLf: string, searchLf: string): { pass: number; hits: EditHit[] } {
  for (let p = 0; p < SEEK_PASSES.length; p++) {
    const hits = SEEK_PASSES[p](contentLf, searchLf)
    if (hits.length > 0) return { pass: p, hits }
  }
  return { pass: -1, hits: [] }
}

/** 单条编辑指令：search 为盘上原文片段，replace 为替换后片段 */
interface EditHunk {
  search: string
  replace: string
}

/** 解析入参两种形态：单片段 {search,replace} 或 多片段 {edits:[{search,replace}...]} */
function parseEdits(args: Record<string, unknown>): { hunks: EditHunk[] } | { error: string } {
  const rawEdits = args['edits']
  const list: EditHunk[] = []
  if (Array.isArray(rawEdits)) {
    if (rawEdits.length === 0) return { error: 'edits 为空数组：至少给出一处替换' }
    if (rawEdits.length > 50) return { error: 'edits 过多（单次上限 50 处）：请拆分为多次调用' }
    for (let i = 0; i < rawEdits.length; i++) {
      const entry = rawEdits[i] as Record<string, unknown> | null
      const search = entry && typeof entry === 'object' ? entry['search'] : undefined
      const replace = entry && typeof entry === 'object' ? entry['replace'] : undefined
      if (typeof search !== 'string' || !search) return { error: `edits[${i}].search 为空或非字符串` }
      if (typeof replace !== 'string') return { error: `edits[${i}].replace 必须是字符串` }
      list.push({ search, replace })
    }
  } else {
    const search = typeof args['search'] === 'string' ? args['search'] : ''
    const replace = typeof args['replace'] === 'string' ? args['replace'] : ''
    if (!search) return { error: 'search 为空：必须给出要被替换的原文片段' }
    list.push({ search, replace })
  }
  for (let i = 0; i < list.length; i++) {
    if (list[i].search === list[i].replace) {
      return {
        error:
          list.length === 1
            ? 'search 与 replace 相同，编辑不产生变化，已拒绝'
            : `edits[${i}]：search 与 replace 相同，不产生变化`
      }
    }
  }
  return { hunks: list }
}

/** 未命中时的最近邻提示：按 search 里的标识符命中数给文件中最相关的几行（含行号） */
function nearestLines(contentLf: string, searchLf: string, limit = 5): string[] {
  const tokens = Array.from(new Set(searchLf.match(/[A-Za-z_][A-Za-z0-9_.]{3,}/g) ?? [])).slice(0, 8)
  if (tokens.length === 0) return []
  const scored: Array<{ n: number; text: string; score: number }> = []
  contentLf.split('\n').forEach((text, i) => {
    let score = 0
    for (const t of tokens) if (text.includes(t)) score++
    if (score > 0) scored.push({ n: i + 1, text, score })
  })
  scored.sort((a, b) => b.score - a.score || a.n - b.n)
  return scored.slice(0, limit).map((s) => `第 ${s.n} 行：${s.text.trim().slice(0, 140)}`)
}

export function builtinContentTools(deps: ToolRegistryDeps): RegisteredTool[] {
  const available = (): boolean => Boolean(deps.projectRoot?.())
  const tools: RegisteredTool[] = []

  tools.push({
    kind: 'chat',
    def: {
      type: 'function',
      function: {
        name: 'content_list',
        description:
          '列出当前 Minecraft 模组项目可视化编辑器中的全部语义资产（方块/物品/实体/Cube 模型/附魔）。' +
          '造匠在创建或修改内容前应先调用，了解现有对象与 id，避免重名。',
        parameters: {
          type: 'object',
          properties: {
            kind: { type: 'string', description: '可选过滤：block | item | entity | model | enchantment' }
          },
          required: []
        }
      }
    },
    available,
    execute: (args) => {
      const root = deps.projectRoot?.()
      if (!root) return { ok: false, text: '', error: '当前没有打开的项目' }
      const kind = asContentKind(args['kind'])
      const list = listContent(root).filter((s) => !kind || s.kind === kind)
      return {
        ok: true,
        text: JSON.stringify(list, null, 2),
        data: { count: list.length, items: list }
      }
    }
  })

  tools.push({
    kind: 'chat',
    def: {
      type: 'function',
      function: {
        name: 'texture_asset_search',
        description:
          '检索项目内已落盘的 PNG 贴图资产（src/main/resources/assets/**，含代码生成器产物与手工导入贴图）。' +
          '生成新贴图（texture_paint/texture_repaint）或引用贴图路径前应先搜一下——能复用就不要重复生成，' +
          '保持项目风格统一且省图像额度。返回尺寸/命名空间/类型/是否含透明通道。',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '关键词（空格分隔多词），如 ruby sword；省略则列全部' },
            kind: { type: 'string', description: '按 textures/ 下一级目录过滤：block/item/entity/gui/...' },
            namespace: { type: 'string', description: '按 assets/<ns>/ 命名空间过滤' },
            withStats: { type: 'boolean', description: '额外统计透明占比与主色板（较慢，默认 false）' },
            limit: { type: 'integer', description: '返回上限 1-100，默认 30' }
          },
          required: []
        }
      }
    },
    available,
    execute: (args) => {
      const root = deps.projectRoot?.()
      if (!root) return { ok: false, text: '', error: '当前没有打开的项目' }
      const limit = Math.max(1, Math.min(100, typeof args['limit'] === 'number' ? Math.round(args['limit'] as number) : 30))
      const list = searchImageAssets(root, typeof args['query'] === 'string' ? (args['query'] as string) : '', {
        kind: typeof args['kind'] === 'string' && args['kind'] ? (args['kind'] as string) : undefined,
        namespace: typeof args['namespace'] === 'string' && args['namespace'] ? (args['namespace'] as string) : undefined,
        withStats: args['withStats'] === true,
        limit
      })
      if (list.length === 0) {
        return { ok: true, text: '项目内没有找到匹配的 PNG 贴图资产。', data: { count: 0, items: [] } }
      }
      return { ok: true, text: clipToolText(JSON.stringify(list, null, 2)), data: { count: list.length, items: list } }
    }
  })

  tools.push({
    kind: 'chat',
    def: {
      type: 'function',
      function: {
        name: 'content_read',
        description:
          '读取一个语义资产的完整 JSON（方块/物品/实体/Cube 模型/附魔）。' +
          '修改前必须先 read 获取当前值；模型返回中 pixels 以摘要形式省略。',
        parameters: {
          type: 'object',
          properties: {
            kind: { type: 'string', description: 'block | item | entity | model | enchantment' },
            id: { type: 'string', description: '对象 id（如 ruby_crate）' }
          },
          required: ['kind', 'id']
        }
      }
    },
    available,
    execute: (args) => {
      const root = deps.projectRoot?.()
      if (!root) return { ok: false, text: '', error: '当前没有打开的项目' }
      const kind = asContentKind(args['kind'])
      const id = typeof args['id'] === 'string' ? args['id'] : ''
      if (!kind) return { ok: false, text: '', error: 'kind 必须是 block/item/entity/model/enchantment' }
      if (!id) return { ok: false, text: '', error: 'id 不能为空' }
      try {
        const def = loadContent(root, kind, id)
        return { ok: true, text: clipToolText(contentToText(def)), data: def }
      } catch (err) {
        return { ok: false, text: '', error: `读取失败：${(err as Error).message}` }
      }
    }
  })

  tools.push({
    kind: 'chat',
    def: {
      type: 'function',
      function: {
        name: 'content_upsert',
        description:
          '创建或整体更新一个语义资产（写入 .kunyu/content，与可视化表单同源；保存后用户点「生成」产出 Java/资源）。' +
          '造匠用于创建/修改方块、物品、实体、Cube 模型与附魔。content 必须是完整对象；重命名时用 prevId 给旧 id。' +
          '物品（kind:"item"）构造前先用 item_validate 自检五类型配置；更新已有物品时 texture 未带 pixels 会自动保留既存像素画。' +
          BLOCK_SHAPE_DESCRIPTION +
          ENTITY_SHAPE_DESCRIPTION +
          MODEL_SHAPE_DESCRIPTION +
          ENCHANTMENT_SHAPE_DESCRIPTION,
        parameters: {
          type: 'object',
          properties: {
            content: {
              type: 'object',
              description: '完整语义资产对象，必须含 kind 与 id'
            },
            prevId: { type: 'string', description: '重命名场景下的旧 id（可选）' }
          },
          required: ['content']
        }
      }
    },
    available,
    execute: (args) => {
      const root = deps.projectRoot?.()
      if (!root) return { ok: false, text: '', error: '当前没有打开的项目' }
      const raw = args['content']
      if (!raw || typeof raw !== 'object') {
        return { ok: false, text: '', error: 'content 必须是对象' }
      }
      const def = raw as ContentDefinition
      if (!asContentKind(def.kind)) return { ok: false, text: '', error: 'content.kind 非法' }
      if (typeof def.id !== 'string' || !def.id) {
        return { ok: false, text: '', error: 'content.id 不能为空' }
      }
      const prevId = typeof args['prevId'] === 'string' ? args['prevId'] : undefined
      try {
        const merged = mergeItemForUpsert(mergeModelForUpsert(def, root, prevId), root, prevId)
        const summary = saveContent(root, merged, prevId)
        // 武器 3D 护栏：tool 物品无 cube 模型时回填警告，促使本轮补 cubeModel（策略见工具描述）
        let warning = ''
        if (merged.kind === 'item') {
          const item = merged as ItemSchema
          const hasCube =
            (item.model?.cubeModel?.elements?.length ?? 0) > 0 || !!item.cubeModelId
          if (item.itemType === 'tool' && !hasCube) {
            warning =
              '\n⚠️ 3D 护栏：这是 tool 类物品但没有任何 Cube 模型——生成后游戏里将是一根扁平贴图杆，手持效果不合格。' +
              '除非用户明确说「扁平/2D/贴图即可」，否则请立即再次调用 content_upsert 为 model.cubeModel 填入武器配方' +
              '（先 template_search 检索「weapon-3d-recipes」获取 katana/greatsword/spear/staff/axe/dagger 已验证坐标）。'
          }
        }
        return {
          ok: true,
          text: `已保存 ${summary.kind}：${summary.id}（${summary.displayName}）。用户在编辑器点「生成代码与资源」后写入 Java 与资源文件。${summary.overwritten ? '\n⚠️ 已覆盖既有语义资产，旧版本已备份至 .bak 文件。' : ''}${warning}`,
          data: summary
        }
      } catch (err) {
        return { ok: false, text: '', error: `保存失败：${(err as Error).message}` }
      }
    }
  })

  // 后补：复杂行为代码的分片落盘通道。
  // 背景：文件产出原本只能经最终 coder JSON 的 files 数组一次性返回；太阳能熔炉这类
  // 十余个文件的大任务上，reasoner 会在思维链里草拟全部代码（实测 228K 字符/60K tokens），
  // 把输出预算耗尽后正文零产出。逐文件工具调用把单次巨型产出拆成小批次，且每批即时校验。
  // write-through：闸门全过后立即写盘（工作台实时可见 AI 产出，不再是运行中途黑盒）；
  // 未注入 writeThrough 端口（无项目/旧测试）时退回旧行为——仅登记，
  // 变更经 ToolResult.data.__kyFileChange 回传 generatePipeline，与最终 JSON files 合并后统一落盘。
  // 两条路径下内存记账与终点复核完全一致（路径安全闸门不绕过；复核拒绝时 write-through 版回滚）。
  tools.push({
    kind: 'chat',
    def: {
      type: 'function',
      function: {
        name: 'write_project_file',
        description:
          '把一个完整源码/资源文件分片提交到当前项目，每次调用只写一个文件、可连续多次调用。' +
          '仅用于 content_upsert 语义资产无法表达的复杂实现：方块实体（BlockEntity）、' +
          'Screen/ScreenHandler、入口类织入、Mixin、配方/战利品表等。' +
          '方块/物品/实体的新增与修改一律走 content_upsert；贴图像素走 texture_paint/texture_pixelize/texture_repaint。' +
          '严禁用本工具直写注册类、blockstate/模型/语言 JSON（可视化编辑器不可见、生成器会覆盖）。' +
          'relPath 为项目相对 POSIX 路径（如 src/main/java/com/x/Foo.java）；' +
          'content 必须是可直接使用的完整文件，禁止 TODO/占位符；同一路径多次提交以最后一次为准。' +
          '修改既有文件请优先用 edit_project_file（只给 search/replace 片段，避免大文件重吐整份导致截断）；' +
          '本工具用于新建文件或整体重写。',
        parameters: {
          type: 'object',
          properties: {
            relPath: {
              type: 'string',
              description: '项目内相对路径（/ 分隔），禁止绝对路径与 .. 段'
            },
            content: { type: 'string', description: '完整文件文本内容' },
            action: {
              type: 'string',
              enum: ['create', 'modify'],
              description: 'create=新建或整体覆盖（默认）；modify=修改既有文件'
            }
          },
          required: ['relPath', 'content']
        }
      }
    },
    available,
    execute: (args) => {
      const root = deps.projectRoot?.()
      if (!root) return { ok: false, text: '', error: '当前没有打开的项目' }
      const rawPath = String(args['relPath'] ?? '')
      const content = typeof args['content'] === 'string' ? args['content'] : ''
      const action = args['action'] === 'modify' ? 'modify' : 'create'
      if (!content.trim()) return { ok: false, text: '', error: 'content 为空，已拒绝' }
      // 先按反斜杠归一化并识别 UNC/盘符，再剥前导斜杠（否则 //server 会被误剥成合法相对路径）
      const norm = rawPath.replace(/\\/g, '/')
      if (/^[a-zA-Z]:/.test(norm) || norm.startsWith('//')) {
        return { ok: false, text: '', error: '拒绝绝对路径/UNC 路径' }
      }
      const posix = norm.replace(/^\/+/, '')
      const segs = posix.split('/')
      if (!posix || segs.some((s) => s === '' || s === '.' || s === '..')) {
        return { ok: false, text: '', error: '路径为空或包含 . / .. / 空段，已拒绝' }
      }
      const writable = checkProjectSourceWritable(posix)
      if (!writable.ok) {
        return { ok: false, text: '', error: `${writable.reason}：${posix}` }
      }
      // 模组项目机械护栏：blockstates/models/lang/tags 属于语义资产自动生成资源，
      // AI 直写会绕过可视化编辑器且被生成器覆盖，必须走 content_upsert。
      if (deps.projectType?.() === 'mod' && /(^|\/)(blockstates|models|lang|tags)\//.test(posix)) {
        return {
          ok: false,
          text: '',
          error:
            `路径属于可视化编辑器自动生成资源（${posix}），直写会导致编辑器不可见/被覆盖。` +
            '请改用 content_upsert 写入语义资产，保存后流水线会自动生成对应 JSON。'
        }
      }
      if (/\b(TODO|FIXME)\b|占位符|请在此处?填写|<your-[a-z]+>/i.test(content)) {
        return { ok: false, text: '', error: '内容含 TODO/占位符，必须提交完整实现' }
      }
      // 语法完整性硬护栏：拒绝截断/丢括号的半成品落盘（实测缺一个
      // 闭合括号即废掉整轮 Gradle 构建）。当场拒绝 → 模型在下一轮工具调用自纠。
      // 资源所有权/缺载保护警告（warn 级，不 block，随返回回填模型自决）
      let ownershipWarn = ''
      if (posix.endsWith('.java')) {
        const braceErr = lintBraceBalance(content)
        if (braceErr) {
          return {
            ok: false,
            text: '',
            error: `${braceErr}：${posix}。content 必须是完整、语法闭合的文件全文，请修正后重新提交`
          }
        }
        const warnings = lintJavaOwnership(content)
        if (warnings.length > 0) {
          ownershipWarn = '\n⚠ 生成代码体检提示：\n' + warnings.map((w) => `- ${w}`).join('\n')
        }
      } else if (/\.(json|mcmeta)$/.test(posix)) {
        try {
          JSON.parse(content)
        } catch (err) {
          return {
            ok: false,
            text: '',
            error: `JSON 解析失败（${String((err as Error).message).slice(0, 120)}）：${posix}，请修正后重新提交完整 JSON`
          }
        }
      }
      // 最终落盘前 validateFileChanges 会再做一次项目根约束；此处无 .. 的纯相对路径无法逃逸
      // write-through：立即写盘让工作台实时可见；写失败当场拒绝，模型下一轮自纠。
      const wt = deps.writeThrough?.() ?? null
      if (wt) {
        try {
          wt.write(posix, action, content)
        } catch (err) {
          return { ok: false, text: '', error: `写盘失败：${(err as Error).message}：${posix}` }
        }
      }
      return {
        ok: true,
        text:
          (wt
            ? `已写入磁盘：${posix}（${action}，${content.length} 字符），工作台立即可见。`
            : `已接受文件变更：${posix}（${action}，${content.length} 字符），将在生成结束时统一写盘。`) +
          '请继续调用 write_project_file 提交下一个文件，全部写完后再输出最终汇总。' +
          ownershipWarn,
        data: { __kyFileChange: true, path: posix, action, content }
      }
    }
  })

  // 工作流 A：既有文件的增量编辑通道。
  // 背景：write_project_file 只收完整 content——改一行也要重吐整份大文件，实测在大文件上导致
  // （1）输出预算耗尽正文截断、（2）同一文件出现「两份不一样的版本」。
  // edit_project_file 以 { search, replace }（或 edits:[{search,replace}...] 多片段）原地改盘上文件：
  // 读磁盘现行内容 → 四遍递减严格度定位（精确/行尾空白/两侧空白/Unicode 标点归一）→ 只替换命中片段，
  // 输出量与文件大小解耦。编辑后仍走同一套闸门（路径/扩展名/自动生成资源禁写/花括号配平/JSON 解析），
  // 产物经 __kyFileChange 回填 generatePipeline 的 toolWrittenFiles，
  // 完备性与终点复核与 write_project_file 完全同权（不会因走编辑通道而绕过硬门）。
  tools.push({
    kind: 'chat',
    def: {
      type: 'function',
      function: {
        name: 'edit_project_file',
        description:
          '对项目内既有文件做增量替换：给出 search（文件中已存在的原文片段）与 replace（替换后片段），' +
          '工具读磁盘现行内容 → 定位 → 原地替换写回，文件其余部分一字不动。' +
          '修改既有文件一律优先用本工具（尤其源码大文件），不要用 write_project_file 重吐整份；' +
          'search 必须逐字复制文件里的原文（含缩进），并用足够上下文保证在文件中唯一；' +
          '匹配按「精确 → 忽略行尾空白 → 忽略两侧空白 → Unicode 标点归一」逐级放宽，' +
          '未命中/多处命中会回传附近行号，请据此修正 search 后重试；' +
          '同一文件的多个互不重叠改动可用 edits:[{search,replace}...] 一次提交' +
          '（按位置自动排序应用，任一片段未命中/歧义即整批拒绝，不会留下半成品）；单处改动直接用 search/replace。' +
          '新建文件或整体重写仍用 write_project_file。路径/扩展名规则同 write_project_file。',
        parameters: {
          type: 'object',
          properties: {
            relPath: {
              type: 'string',
              description: '项目内相对路径（/ 分隔），禁止绝对路径与 .. 段'
            },
            search: {
              type: 'string',
              description: '要被替换的原文片段，须与文件现有内容逐字一致（含缩进）且在文件中唯一'
            },
            replace: { type: 'string', description: '替换后的片段（空串表示删除该片段）' },
            edits: {
              type: 'array',
              description:
                '多片段批量编辑：与 search/replace 二选一；一次提交同一文件的多处互不重叠改动',
              items: {
                type: 'object',
                properties: {
                  search: { type: 'string', description: '要被替换的原文片段（逐字一致且在文件中唯一）' },
                  replace: { type: 'string', description: '替换后的片段' }
                },
                required: ['search', 'replace']
              }
            }
          },
          required: ['relPath']
        }
      }
    },
    available,
    execute: (args) => {
      const root = deps.projectRoot?.()
      if (!root) return { ok: false, text: '', error: '当前没有打开的项目' }
      const rawPath = String(args['relPath'] ?? '')
      const parsed = parseEdits(args)
      if ('error' in parsed) return { ok: false, text: '', error: parsed.error }
      const hunks = parsed.hunks
      const multi = hunks.length > 1
      const norm = rawPath.replace(/\\/g, '/')
      if (/^[a-zA-Z]:/.test(norm) || norm.startsWith('//')) {
        return { ok: false, text: '', error: '拒绝绝对路径/UNC 路径' }
      }
      const posix = norm.replace(/^\/+/, '')
      const segs = posix.split('/')
      if (!posix || segs.some((s) => s === '' || s === '.' || s === '..')) {
        return { ok: false, text: '', error: '路径为空或包含 . / .. / 空段，已拒绝' }
      }
      const writable = checkProjectSourceWritable(posix)
      if (!writable.ok) {
        return { ok: false, text: '', error: `${writable.reason}：${posix}` }
      }
      if (deps.projectType?.() === 'mod' && /(^|\/)(blockstates|models|lang|tags)\//.test(posix)) {
        return {
          ok: false,
          text: '',
          error:
            `路径属于可视化编辑器自动生成资源（${posix}），编辑会导致编辑器不可见/被覆盖。` +
            '请改用 content_upsert 更新语义资产。'
        }
      }
      const todoRe = /\b(TODO|FIXME)\b|占位符|请在此处?填写|<your-[a-z]+>/i
      for (let i = 0; i < hunks.length; i++) {
        if (todoRe.test(hunks[i].replace)) {
          return {
            ok: false,
            text: '',
            error: (multi ? `edits[${i}]：` : '') + 'replace 含 TODO/占位符，必须给出完整实现'
          }
        }
      }
      const abs = resolve(root, posix)
      let raw: string
      try {
        raw = readFileSync(abs, 'utf8')
      } catch {
        return {
          ok: false,
          text: '',
          error: `文件不存在或不可读：${posix}。新建文件请改用 write_project_file 提交完整内容`
        }
      }
      const eol = raw.includes('\r\n') ? '\r\n' : '\n'
      const contentLf = toLf(raw)
      // 逐片段定位：严格档位命中唯一才采用；未命中/歧义/区间重叠一律整批拒绝（原子性，不写半成品）
      const regions: Array<{
        index: number
        length: number
        replaceLf: string
        pass: number
        line: number
      }> = []
      for (let i = 0; i < hunks.length; i++) {
        const searchLf = toLf(hunks[i].search)
        const where = multi ? `edits[${i}]：` : ''
        const seek = seekSequence(contentLf, searchLf)
        if (seek.pass < 0) {
          const hints = nearestLines(contentLf, searchLf)
          return {
            ok: false,
            text: '',
            error:
              `${where}search 未在 ${posix} 中命中（已逐字匹配并逐级放宽到空白/标点）。` +
              '请先用 read_project_file 读回原文，逐字复制要替换的片段（含缩进）后重试。' +
              (hints.length ? `\n文件中最接近的行：\n${hints.join('\n')}` : '')
          }
        }
        if (seek.hits.length > 1) {
          const lines = seek.hits.map((h) => lineOf(contentLf, h.index))
          return {
            ok: false,
            text: '',
            error:
              `${where}search 在 ${posix} 中命中 ${seek.hits.length > 5 ? '多于 5' : seek.hits.length} 处` +
              `（第 ${lines.join('、')} 行），无法确定替换哪一处。` +
              '请在 search 中包含前后各 1~2 行上下文使其唯一后重试'
          }
        }
        const hit = seek.hits[0]
        regions.push({
          index: hit.index,
          length: hit.length,
          replaceLf: toLf(hunks[i].replace),
          pass: seek.pass,
          line: lineOf(contentLf, hit.index)
        })
      }
      const ordered = [...regions].sort((a, b) => a.index - b.index)
      for (let i = 1; i < ordered.length; i++) {
        if (ordered[i - 1].index + ordered[i - 1].length > ordered[i].index) {
          return {
            ok: false,
            text: '',
            error:
              `多处替换区间重叠（第 ${ordered[i - 1].line} 行与第 ${ordered[i].line} 行），` +
              '请拆分为多次调用或调整 search 上下文'
          }
        }
      }
      // 自底向上应用：前面的替换不会让后面的区间偏移失效
      let newLf = contentLf
      for (const r of [...ordered].sort((a, b) => b.index - a.index)) {
        newLf = newLf.slice(0, r.index) + r.replaceLf + newLf.slice(r.index + r.length)
      }
      const newContent = eol === '\r\n' ? newLf.replace(/\n/g, '\r\n') : newLf
      // 语法完整性硬护栏：编辑后拼出的全文同样必须闭合（replace 丢括号 = 废掉整轮 Gradle 构建）
      // 资源所有权/缺载保护警告（warn 级，随返回回填模型自决）
      let ownershipWarn = ''
      if (posix.endsWith('.java')) {
        const braceErr = lintBraceBalance(newContent)
        if (braceErr) {
          return {
            ok: false,
            text: '',
            error:
              `${braceErr}（编辑后全文）：${posix}。replace 片段必须与文件其余部分拼成语法闭合的完整文件，` +
              '请修正后重试'
          }
        }
        const warnings = lintJavaOwnership(newContent)
        if (warnings.length > 0) {
          ownershipWarn = '\n⚠ 生成代码体检提示：\n' + warnings.map((w) => `- ${w}`).join('\n')
        }
      } else if (/\.(json|mcmeta)$/.test(posix)) {
        try {
          JSON.parse(newContent)
        } catch (err) {
          return {
            ok: false,
            text: '',
            error: `编辑后 JSON 解析失败（${String((err as Error).message).slice(0, 120)}）：${posix}，请修正后重试`
          }
        }
      }
      const wt = deps.writeThrough?.() ?? null
      if (wt) {
        try {
          wt.write(posix, 'modify', newContent)
        } catch (err) {
          return { ok: false, text: '', error: `写盘失败：${(err as Error).message}：${posix}` }
        }
      }
      const delta = newContent.length - raw.length
      const loose = ordered.some((r) => r.pass > 0)
      const detail = multi
        ? `${ordered.length} 处替换（第 ${ordered.map((r) => r.line).join('、')} 行${loose ? '，含宽松匹配' : ''}）`
        : `第 ${ordered[0].line} 行起，${SEEK_PASS_LABELS[ordered[0].pass]}`
      return {
        ok: true,
        text:
          (wt ? `已编辑并写入磁盘：${posix}` : `已接受编辑：${posix}`) +
          `（${detail}，文件 ${raw.length}→${newContent.length} 字符，Δ${delta >= 0 ? '+' : ''}${delta}）` +
          (wt ? '，工作台立即可见。' : '，将在生成结束时统一写盘。') +
          '请继续提交后续编辑/文件，全部完成后输出最终汇总。' +
          ownershipWarn,
        data: { __kyFileChange: true, path: posix, action: 'modify', content: newContent }
      }
    }
  })

  tools.push({
    kind: 'chat',
    def: {
      type: 'function',
      function: {
        name: 'texture_paint',
        description:
          '程序化像素画生成器：把形状模板+配色光栅化为 16x16 像素画（自动描边/三阶明暗/高光），' +
          '质量远高于手写 pixels，物品与 Cube 模型贴图的首选。' +
          'PNG 落盘路径固定：kind="model" → assets/<modid>/textures/model/<id>.png；' +
          'kind="item" → assets/<modid>/textures/item/<id>.png——模型 JSON 的贴图引用必须与之对应' +
          '（如 <modid>:model/<id>）。语义资产已存在则同步更新其像素画；不存在也能直接生成 PNG（无需先 content_upsert）。' +
          '返回 ASCII 预览供自检——不满意换 shape/配色重画即可。' +
          'GUI 等 256x256 大贴图超出本工具能力，应改用原版贴图引用（如 minecraft:textures/gui/container/furnace.png）。' +
          '复杂贴图且 mc-texture-cli 已连接时可改用其 [texture] 类工具。' +
          `可选 shape：${PAINT_SHAPES.map((s) => `${s}(${PAINT_SHAPE_LABELS[s]})`).join('、')}。` +
          '方块贴图通过其 Cube 模型（kind:"model"）绘制。',
        parameters: {
          type: 'object',
          properties: {
            kind: { type: 'string', description: 'item | model（方块走其 Cube 模型）' },
            id: { type: 'string', description: '已存在的语义资产 id（如 devil_cry_blade）' },
            shape: {
              type: 'string',
              description:
                '形状模板：sword|pickaxe|axe|shovel|hoe|gem|ingot|food|orb|rod|blob'
            },
            primary: { type: 'string', description: '主色 #rrggbb（刃/主体）' },
            accent: { type: 'string', description: '点缀色 #rrggbb（宝石/护手/饰带，可省略）' },
            secondary: { type: 'string', description: '副色 #rrggbb（握柄/杆，可省略）' }
          },
          required: ['kind', 'id', 'shape', 'primary']
        }
      }
    },
    available,
    execute: (args) => {
      const root = deps.projectRoot?.()
      if (!root) return { ok: false, text: '', error: '当前没有打开的项目' }
      const kind = args['kind'] === 'model' ? 'model' : args['kind'] === 'item' ? 'item' : null
      if (!kind) return { ok: false, text: '', error: 'kind 必须是 item 或 model' }
      const id = typeof args['id'] === 'string' ? args['id'] : ''
      if (!id) return { ok: false, text: '', error: 'id 不能为空' }
      const shape = validatePaintShape(args['shape'])
      if (!shape) {
        return {
          ok: false,
          text: '',
          error: `shape 非法，可选：${PAINT_SHAPES.join('|')}`
        }
      }
      const result = paintPixels({
        shape,
        primary: typeof args['primary'] === 'string' ? args['primary'] : '',
        accent: typeof args['accent'] === 'string' ? args['accent'] : undefined,
        secondary: typeof args['secondary'] === 'string' ? args['secondary'] : undefined
      })
      const toneLine = `轮廓${result.tones.o} 暗${result.tones.d} 中${result.tones.m} 亮${result.tones.l} 高光${result.tones.h}`
      const preview =
        `ASCII 预览（. 透明，o 轮廓，d/m/l/h 主体四阶，a/A 点缀，g/G 副色）：\n${result.ascii}\n` +
        '不满意可换 shape 或配色重画；满意则继续后续步骤。'
      // 像素画必须同时物化为 PNG，否则模型 JSON 的贴图引用在磁盘上永远缺失（run#9 回归）
      const materialize = (): string =>
        kind === 'model'
          ? saveModelTexture(root, id, result.pixels, 16)
          : saveItemTexture(root, id, result.pixels)
      try {
        const def = loadContent(root, kind, id)
        if (kind === 'item' && def.kind === 'item') {
          def.texture = { ...def.texture, pixels: result.pixels }
        } else if (kind === 'model' && def.kind === 'model') {
          const model = def as ModelAsset
          model.textureSize = 16
          model.pixels = result.pixels
        } else {
          return { ok: false, text: '', error: `${id} 不是 ${kind} 类型` }
        }
        saveContent(root, def)
        const rel = materialize()
        return {
          ok: true,
          text:
            `已用 ${shape} 模板绘制 ${result.painted} 像素，保存到 ${kind}/${id} 并写入 PNG：${rel}（${toneLine}）。\n` +
            preview,
          data: { shape, painted: result.painted, tones: result.tones, png: rel }
        }
      } catch (err) {
        // 语义资产不存在时不再要求先 content_upsert——直接进入纹理直出：
        // 把像素画 PNG 落到约定路径（model → textures/model/<id>.png，item → textures/item/<id>.png），
        // 让模型/物品 JSON 中形如 <modid>:model/<id> 的贴图引用立即闭合（run#9 零贴图回归）。
        try {
          const rel = materialize()
          return {
            ok: true,
            text:
              `${kind}/${id} 语义资产不存在，已跳过建骨架直接生成 PNG：${rel}（${toneLine}）。\n` +
              `请确保模型/物品 JSON 的贴图引用与该路径一致（如 <modid>:model/${id}）。\n` +
              preview,
            data: { shape, painted: result.painted, tones: result.tones, png: rel }
          }
        } catch (err2) {
          return { ok: false, text: '', error: `绘制失败：${(err2 as Error).message}` }
        }
      }
    }
  })

  tools.push({
    kind: 'chat',
    def: {
      type: 'function',
      function: {
        name: 'texture_pixelize',
        description:
          '贴图工坊·像素化后处理：把用户上传的参考图（或项目内 PNG）降采样+限色量化+自动描边，' +
          '生成 16x16/32x32 MC 风像素贴图并写入指定 item/model 资产。' +
          '用户提供参考图（照片/截图/AI 大图）要求"照这个做贴图"时用本工具，不要手写 pixels。' +
          '图片来源三选一：imageRef（用户参考图序号，从 1 开始，省略且仅 1 张时自动使用）、' +
          'dataUrl（image/png base64）、relPath（项目内 PNG 相对路径）。返回 ASCII 预览自检。',
        parameters: {
          type: 'object',
          properties: {
            kind: { type: 'string', description: 'item | model（方块走其 Cube 模型）' },
            id: { type: 'string', description: '已存在的语义资产 id（先用 content_upsert 建骨架）' },
            imageRef: { type: 'integer', description: '用户参考图序号，从 1 开始' },
            dataUrl: { type: 'string', description: 'PNG data URL（data:image/png;base64,...）' },
            relPath: { type: 'string', description: '项目内 PNG 相对路径（如 assets/modid/textures/item/x.png）' },
            size: { type: 'integer', description: '目标边长 16|32|64，默认 16' },
            maxColors: { type: 'integer', description: '调色板最大颜色数 2-256，默认 32' },
            dither: { type: 'string', description: 'floyd（默认，渐变顺）| none（色块干净）' },
            outline: { type: 'boolean', description: '透明背景精灵自动描边，默认 true' }
          },
          required: ['kind', 'id']
        }
      }
    },
    available,
    execute: (args) => {
      const root = deps.projectRoot?.()
      if (!root) return { ok: false, text: '', error: '当前没有打开的项目' }
      const kind = args['kind'] === 'model' ? 'model' : args['kind'] === 'item' ? 'item' : null
      if (!kind) return { ok: false, text: '', error: 'kind 必须是 item 或 model' }
      const id = typeof args['id'] === 'string' ? args['id'] : ''
      if (!id) return { ok: false, text: '', error: 'id 不能为空' }

      // 解析图片来源 → PNG data URL
      let dataUrl: string | null = null
      const refs = deps.referenceImages?.() ?? []
      if (typeof args['dataUrl'] === 'string' && args['dataUrl'].startsWith('data:image/')) {
        dataUrl = args['dataUrl'] as string
      } else if (typeof args['relPath'] === 'string' && args['relPath']) {
        const rel = args['relPath'] as string
        const abs = resolve(root, rel)
        const r = relative(root, abs)
        if (r.startsWith('..') || resolve(root) === abs) {
          return { ok: false, text: '', error: 'relPath 非法：路径越出项目根' }
        }
        if (!abs.toLowerCase().endsWith('.png')) {
          return { ok: false, text: '', error: 'relPath 必须指向 .png 文件' }
        }
        try {
          dataUrl = `data:image/png;base64,${readFileSync(abs).toString('base64')}`
        } catch {
          return { ok: false, text: '', error: `读取不到文件：${rel}` }
        }
      } else {
        const refIdx = typeof args['imageRef'] === 'number' ? (args['imageRef'] as number) - 1 : 0
        const ref = refs[refIdx]
        if (!ref) {
          return {
            ok: false,
            text: '',
            error: refs.length === 0
              ? '本轮没有可用参考图：请让用户先上传图片，或提供 dataUrl/relPath'
              : `imageRef 超出范围（本轮共 ${refs.length} 张参考图）`
          }
        }
        dataUrl = ref
      }

      // item 贴图固定 16x16（ItemTexture schema 仅接受 256 项）；model 支持 16/32
      const sizeVal =
        typeof args['size'] === 'number' ? (args['size'] as number) : 16
      if (kind === 'item' && sizeVal !== 16) {
        return { ok: false, text: '', error: '物品贴图仅支持 16x16（32/64 请用 Cube 模型 kind=model）' }
      }
      if (kind === 'model' && sizeVal !== 16 && sizeVal !== 32) {
        return { ok: false, text: '', error: '模型贴图仅支持 16 或 32' }
      }
      try {
        const result = pixelizeDataUrl(dataUrl, {
          size: sizeVal,
          maxColors: typeof args['maxColors'] === 'number' ? (args['maxColors'] as number) : undefined,
          dither: args['dither'] === 'none' ? 'none' : 'floyd',
          outline: typeof args['outline'] === 'boolean' ? (args['outline'] as boolean) : undefined
        })
        const def = loadContent(root, kind, id)
        if (kind === 'item' && def.kind === 'item') {
          def.texture = { ...def.texture, pixels: result.pixels }
        } else if (kind === 'model' && def.kind === 'model') {
          const model = def as ModelAsset
          model.textureSize = result.size as 16 | 32
          model.pixels = result.pixels
        } else {
          return { ok: false, text: '', error: `${id} 不是 ${kind} 类型` }
        }
        saveContent(root, def)
        return {
          ok: true,
          text:
            `已像素化参考图并保存到 ${kind}/${id}（${result.size}x${result.size}，调色板 ${result.palette.length} 色）。\n` +
            `ASCII 预览（空格透明，字符越密越亮）：\n${result.ascii}\n` +
            '不满意可调 maxColors（更少更复古）/ dither=none / outline 后重试。',
          data: { size: result.size, colors: result.palette.length }
        }
      } catch (err) {
        return { ok: false, text: '', error: `像素化失败：${(err as Error).message}` }
      }
    }
  })

  tools.push({
    kind: 'chat',
    def: {
      type: 'function',
      function: {
        name: 'texture_repaint',
        description:
          '贴图工坊·AI 重绘：用用户自带 Key 的图像模型（设置中配 imageModel，如 cogview-3/seedream/dall-e-3）' +
          '按文字描述改画贴图，再自动像素化（限色/抖动/描边）写回 item/model 资产。' +
          '用户说"把贴图改成…/重绘成…/来个更酷的版本"时用本工具；不接参考图时以资产当前贴图为底稿。' +
          '默认出 4 个候选方案并全部上报到聊天「产物」卡供用户挑选（第一张自动写回）；' +
          '用户明确只要一张（省额度）时把 candidates 设为 1。' +
          '工作台不内置云端额度，未配置图像供应商时会返回配置指引。',
        parameters: {
          type: 'object',
          properties: {
            kind: { type: 'string', description: 'item | model（方块走其 Cube 模型）' },
            id: { type: 'string', description: '已存在的语义资产 id（先用 content_upsert 建骨架）' },
            prompt: { type: 'string', description: '画面描述（中文即可，会自动补像素风约束）' },
            imageRef: { type: 'integer', description: '用户参考图序号，从 1 开始（省略则用资产当前贴图）' },
            dataUrl: { type: 'string', description: 'PNG data URL，显式指定底稿' },
            relPath: { type: 'string', description: '项目内 PNG 相对路径，作为底稿' },
            size: { type: 'integer', description: '目标边长 16|32，物品仅 16；省略沿用当前尺寸' },
            maxColors: { type: 'integer', description: '像素化调色板上限 2-256，默认 32' },
            dither: { type: 'string', description: 'floyd（默认）| none' },
            outline: { type: 'boolean', description: '透明背景精灵自动描边，默认 true' },
            removeBackground: {
              type: 'boolean',
              description:
                'AI 出图先自动抠掉平整底色再像素化，默认 true（MC 精灵要求背景透明；' +
                '误检护栏触发时自动跳过并在结果里说明）。要保留 AI 原图底色时传 false'
            },
            candidates: {
              type: 'integer',
              description: '候选张数 1-4，默认 4；每张都消耗一次出图额度，用户要省钱时传 1'
            },
            providerId: { type: 'string', description: '指定图像供应商 id，省略用默认图像供应商' }
          },
          required: ['kind', 'id', 'prompt']
        }
      }
    },
    available,
    execute: async (args, ctx) => {
      const root = deps.projectRoot?.()
      if (!root) return { ok: false, text: '', error: '当前没有打开的项目' }
      const kind = args['kind'] === 'model' ? 'model' : args['kind'] === 'item' ? 'item' : null
      if (!kind) return { ok: false, text: '', error: 'kind 必须是 item 或 model' }
      const id = typeof args['id'] === 'string' ? args['id'] : ''
      if (!id) return { ok: false, text: '', error: 'id 不能为空' }
      const prompt = typeof args['prompt'] === 'string' ? args['prompt'] : ''
      if (!prompt.trim()) return { ok: false, text: '', error: 'prompt 不能为空' }

      // 读当前资产 → 决定 size 与默认底稿
      let def: ReturnType<typeof loadContent>
      try {
        def = loadContent(root, kind, id)
      } catch (err) {
        return { ok: false, text: '', error: `加载 ${kind}/${id} 失败：${(err as Error).message}` }
      }
      const currentPixels = kind === 'item' && def.kind === 'item'
        ? def.texture.pixels
        : def.kind === 'model'
          ? (def as ModelAsset).pixels
          : null
      if (currentPixels === null) {
        return { ok: false, text: '', error: `${id} 不是 ${kind} 类型` }
      }
      const currentSize = kind === 'model' ? (def as ModelAsset).textureSize : 16
      const sizeVal = typeof args['size'] === 'number' ? (args['size'] as number) : currentSize
      if (kind === 'item' && sizeVal !== 16) {
        return { ok: false, text: '', error: '物品贴图仅支持 16x16（32 请用 Cube 模型 kind=model）' }
      }
      if (sizeVal !== 16 && sizeVal !== 32) {
        return { ok: false, text: '', error: '模型贴图仅支持 16 或 32' }
      }

      // 底稿三来源：显式 dataUrl/relPath/imageRef；缺省用资产当前贴图
      let sourceDataUrl: string | null = null
      if (typeof args['dataUrl'] === 'string' && args['dataUrl'].startsWith('data:image/')) {
        sourceDataUrl = args['dataUrl'] as string
      } else if (typeof args['relPath'] === 'string' && args['relPath']) {
        const rel = args['relPath'] as string
        const abs = resolve(root, rel)
        const r = relative(root, abs)
        if (r.startsWith('..') || resolve(root) === abs) {
          return { ok: false, text: '', error: 'relPath 非法：路径越出项目根' }
        }
        if (!abs.toLowerCase().endsWith('.png')) {
          return { ok: false, text: '', error: 'relPath 必须指向 .png 文件' }
        }
        try {
          sourceDataUrl = `data:image/png;base64,${readFileSync(abs).toString('base64')}`
        } catch {
          return { ok: false, text: '', error: `读取不到文件：${rel}` }
        }
      } else if (typeof args['imageRef'] === 'number' || (!args['dataUrl'] && !args['relPath'])) {
        const refs = deps.referenceImages?.() ?? []
        const refIdx = typeof args['imageRef'] === 'number' ? (args['imageRef'] as number) - 1 : 0
        const ref = refs[refIdx]
        if (ref) sourceDataUrl = ref
      }
      // 没给任何外部底稿 → 当前像素重编码为 PNG
      if (!sourceDataUrl) {
        sourceDataUrl = pixelsToPngDataUrl(sizeVal, currentPixels ?? [])
      }

      // 候选张数：1-4，默认 4（全部上报给聊天「产物」卡的画廊，第 1 张自动写回）
      const candidateN = Math.max(
        1,
        Math.min(4, typeof args['candidates'] === 'number' ? Math.round(args['candidates'] as number) : 4)
      )

      const outcome = await repaintTexture({
        sourceDataUrl,
        prompt,
        size: sizeVal as 16 | 32,
        n: candidateN,
        providerId: typeof args['providerId'] === 'string' ? (args['providerId'] as string) : undefined,
        removeBackground: args['removeBackground'] === false ? false : undefined,
        pixelize: {
          maxColors: typeof args['maxColors'] === 'number' ? (args['maxColors'] as number) : undefined,
          dither: args['dither'] === 'none' ? 'none' : 'floyd',
          outline: typeof args['outline'] === 'boolean' ? (args['outline'] as boolean) : undefined
        }
      })
      if (!outcome.ok) {
        return { ok: false, text: '', error: `AI 重绘失败（${outcome.errorKind}）：${outcome.errorMessage}` }
      }
      const variant = outcome.data.variants[0]
      if (!variant) return { ok: false, text: '', error: '图像服务未返回候选图' }

      if (kind === 'item' && def.kind === 'item') {
        def.texture = { ...def.texture, pixels: variant.pixels }
      } else if (def.kind === 'model') {
        const model = def as ModelAsset
        model.textureSize = outcome.data.size
        model.pixels = variant.pixels
      }
      saveContent(root, def)

      // 全部候选入库画廊：AI 产出的每张都是资产，一张不丢；
      // 开发者之后可在「画廊」模块里零额度复用（写回资产/二次编辑），不必重跑 AI 烧额度。
      saveGalleryItems(
        root,
        outcome.data.variants.map((v, i) => ({
          assetKind: kind,
          assetId: id,
          size: outcome.data.size,
          prompt: prompt.trim(),
          provider: outcome.data.model,
          origin: 'agent' as const,
          appliedIndex: i === 0 ? 1 : undefined,
          palette: v.palette,
          pixels: v.pixels
        }))
      )

      // 全部候选上报到聊天「产物」卡：开发者可在聊天里看到每张画并挑一个写回。
      // reportArtifact 未注入（集成桥/单测直调）时静默跳过。
      ctx.reportArtifact?.({
        id: `tex-cand-${ctx.toolCallId ?? id}`,
        kind: 'texture-candidates',
        title: `贴图候选 · ${kind}/${id}（${outcome.data.variants.length} 个）`,
        textureCandidates: {
          assetKind: kind,
          assetId: id,
          size: outcome.data.size,
          prompt: prompt.trim().slice(0, 200),
          provider: outcome.data.model,
          appliedIndex: 1,
          warnings: outcome.data.warnings,
          variants: outcome.data.variants.map((v, i) => ({
            index: i + 1,
            dataUrl: v.dataUrl,
            pixels: v.pixels,
            palette: v.palette,
            colorCount: v.palette.length,
            sourceToken: v.sourceToken
          }))
        }
      })

      return {
        ok: true,
        text:
          `已用 ${outcome.data.model} 按「${prompt}」重绘并像素化，保存到 ${kind}/${id}` +
          `（${outcome.data.size}x${outcome.data.size}，调色板 ${variant.palette.length} 色）。\n` +
          (outcome.data.variants.length > 1
            ? `共 ${outcome.data.variants.length} 个候选已展示在聊天「产物」卡，第 1 张已自动写回；` +
              '不要复述候选，等用户点选后如需替换再用本工具。\n'
            : '') +
          (outcome.data.warnings.length ? `提示：${outcome.data.warnings.join('；')}\n` : '') +
          `ASCII 预览（空格透明）：\n${variant.ascii}\n` +
          '不满意就换 prompt / maxColors / dither=none 再来一次。',
        data: {
          size: outcome.data.size,
          model: outcome.data.model,
          colors: variant.palette.length,
          variantCount: outcome.data.variants.length
        }
      }
    }
  })

  tools.push({
    kind: 'chat',
    def: {
      type: 'function',
      function: {
        name: 'model_validate',
        description:
          '校验 Cube 模型 JSON（坐标范围、旋转角度、UV 越界、贴图变量、像素数组长度等），返回中文诊断。' +
          '造匠在 content_upsert 模型前应先自检。' + MODEL_SHAPE_DESCRIPTION,
        parameters: {
          type: 'object',
          properties: {
            model: { type: 'object', description: '待校验的模型对象；不传时改用 id 读取已保存模型' },
            id: { type: 'string', description: '已保存模型的 id（model 缺省时使用）' }
          },
          required: []
        }
      }
    },
    available,
    execute: (args) => {
      const root = deps.projectRoot?.()
      if (!root) return { ok: false, text: '', error: '当前没有打开的项目' }
      let model: ModelAsset | null = null
      if (args['model'] && typeof args['model'] === 'object') {
        const candidate = args['model'] as ContentDefinition
        if (candidate.kind === 'model') model = candidate as ModelAsset
      } else if (typeof args['id'] === 'string') {
        try {
          const loaded = loadContent(root, 'model', args['id'])
          if (loaded.kind === 'model') model = loaded
        } catch (err) {
          return { ok: false, text: '', error: `读取模型失败：${(err as Error).message}` }
        }
      }
      if (!model) return { ok: false, text: '', error: '请提供 model 对象或已保存模型的 id' }
      const diags = validateModel(model)
      const lines = diags.map(
        (d) =>
          `- [${d.severity === 'error' ? '错误' : '警告'}] ${d.code}` +
          `${d.elementIndex !== undefined ? `（立方体 ${d.elementIndex + 1}）` : ''}${d.face ? `（面 ${d.face}）` : ''}：${d.message}`
      )
      const text =
        diags.length === 0
          ? '模型校验通过，无错误或警告。'
          : `共 ${diags.length} 项诊断：\n${lines.join('\n')}`
      return { ok: !hasModelError(diags), text, data: { diags } }
    }
  })

  // 物品五类型自检（与 saveContent 校验同源，避免 LLM 拿报错试错）
  tools.push({
    kind: 'chat',
    def: {
      type: 'function',
      function: {
        name: 'item_validate',
        description:
          '校验物品语义 JSON（五类型 simple/tool/armor/food/block_item 的必填配置、数值范围、注册名规则），' +
          '返回中文诊断与归一化预览。造匠在 content_upsert 物品前应先自检。' + ITEM_SHAPE_DESCRIPTION,
        parameters: {
          type: 'object',
          properties: {
            content: { type: 'object', description: '待校验的物品语义 JSON（kind 必须为 item）' }
          },
          required: ['content']
        }
      }
    },
    available,
    execute: (args) => {
      const raw = args['content']
      if (!raw || typeof raw !== 'object') return { ok: false, text: '', error: 'content 必须是对象' }
      const item = raw as ItemSchema
      if (item.kind !== 'item') return { ok: false, text: '', error: 'content.kind 必须是 item' }
      if (typeof item.id !== 'string' || !item.id) {
        return { ok: false, text: '', error: 'content.id 不能为空' }
      }
      try {
        const normalized = normalizeItemSchema(item)
        const err = validateItemSchema(normalized)
        const issues = err ? [err] : []
        const preview = itemToText(normalized)
        const text =
          (issues.length > 0
            ? `发现 ${issues.length} 个问题：\n${issues.map((i) => `- ${i}`).join('\n')}`
            : '物品语义 JSON 合法。') + `\n\n归一化预览：\n${preview}`
        return { ok: issues.length === 0, text: clipToolText(text), data: { issues, normalized } }
      } catch (err) {
        return { ok: false, text: '', error: `校验失败：${(err as Error).message}` }
      }
    }
  })

  return tools
}
