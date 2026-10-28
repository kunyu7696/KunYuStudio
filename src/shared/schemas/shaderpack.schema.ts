/**
 * 光影包编辑器语义结构（P0：项目管理 + 分类文件树）。
 *
 * 光影包是独立分发单位（.zip），与模组 jar / 资源包不兼容：
 * zip 解开后顶层为 shaders/ 目录。开发期目录落在
 * <projectRoot>/shaderpacks/<packId>/shaders/，元数据存 .kunyu/shaderpack.json，
 * 后续版本可直接打包 shaderpacks/<packId>/ 导出 zip。
 *
 * GLSL 文件平铺在 shaders/ 下（不按管线阶段建子目录），仅 lib/ 存放 include 公共代码。
 */
import { validateContentId } from '../types/content'
import type { PackMcVersion } from '../types/project'
import { sharedT, type SharedLocale } from '../i18n'

/** 光影加载器 */
export type ShaderLoader = 'iris' | 'optifine'

/** 光影包元数据（存于项目 .kunyu/shaderpack.json） */
export interface ShaderPackMeta {
  /** 包目录名（shaderpacks/<packId>），小写安全字符 */
  packId: string
  /** 展示名（任意字符，未来写入 shaders.properties 的 name） */
  name: string
  mcVersion: McVersionLike
  loader: ShaderLoader
  /** 光影包自身版本（如 1.0.0） */
  version: string
  description: string
  createdAt: number
  updatedAt: number
}

/**
 * 光影包对 MC 版本不强约束目录（无 pack_format），仅做记录与后续兼容提示。
 * 可选值与 loaderVersionMatrix 登记的 10 个去重 MC 版本一致。
 */
export type McVersionLike = PackMcVersion

/** 合法 MC 版本集合（校验用；P0-4 起导出，作为包类版本白名单真源之一） */
export const VALID_MC_VERSIONS = new Set<string>([
  '1.16.5',
  '1.18.2',
  '1.19.2',
  '1.20.1',
  '1.20.4',
  '1.20.6',
  '1.21.1',
  '1.21.3',
  '1.21.4',
  '1.21.5'
])

/**
 * 文件树分组类别。
 * shader 类别对应 OptiFine/Iris 管线阶段文件（平铺于 shaders/），
 * lib/lang/config 为附属资源。
 */
export type ShaderFileCategory =
  | 'gbuffers'
  | 'composite'
  | 'deferred'
  | 'shadow'
  | 'shadowcomp'
  | 'final'
  | 'prepare'
  | 'begin'
  | 'setup'
  | 'lib'
  | 'lang'
  | 'config'

export interface ShaderCategoryInfo {
  key: ShaderFileCategory
  label: string
  hint: string
  /** 该类别新建文件时的扩展名（config 为固定文件不允许新建） */
  ext: string
  /** 是否允许在该类别下新建文件 */
  creatable: boolean
  /** 该类别下的子 pass 名（可选；gbuffers 有 11 个子 pass，shadow 有 shadow/shadowcomp） */
  subpasses?: SubpassInfo[]
}

/** 管线子 pass 元数据（用于新建文件下拉 + tooltip） */
export interface SubpassInfo {
  /** 完整文件名（不含扩展名），如 "gbuffers_terrain"、"shadow" */
  name: string
  /** 显示名 */
  displayName: string
  /** 一句话描述 */
  description: string
  /** 后备链上的下一个子 pass 名（null 表示已到链尾，缺失时回落 OpenGL 固定管线） */
  fallbackTo?: string | null
  /** 是否受雾效果影响 */
  fogAffected?: boolean
}

/**
 * 11 个 GBuffer 子 pass 的元数据。
 * 后备链说明：缺失时沿 fallbackTo 向左搜索替补；全部缺失则回落 OpenGL 固定管线。
 * 三条独立链：普通实体链（spidereyes→...→basic）、砖块链（terrain 独立）、天空链（skytextured→skybasic→basic）。
 */
function buildGbuffersSubpasses(locale?: SharedLocale): SubpassInfo[] {
  const t = (key: string): string => sharedT(key, undefined, locale)
  return [
    { name: 'gbuffers_basic', displayName: 'gbuffers_basic', description: t('schema.shaderpack.subGbuffersBasic'), fallbackTo: null, fogAffected: false },
    { name: 'gbuffers_skybasic', displayName: 'gbuffers_skybasic', description: t('schema.shaderpack.subGbuffersSkybasic'), fallbackTo: 'gbuffers_basic', fogAffected: true },
    { name: 'gbuffers_skytextured', displayName: 'gbuffers_skytextured', description: t('schema.shaderpack.subGbuffersSkytextured'), fallbackTo: 'gbuffers_skybasic', fogAffected: true },
    { name: 'gbuffers_textured', displayName: 'gbuffers_textured', description: t('schema.shaderpack.subGbuffersTextured'), fallbackTo: 'gbuffers_basic', fogAffected: true },
    { name: 'gbuffers_textured_lit', displayName: 'gbuffers_textured_lit', description: t('schema.shaderpack.subGbuffersTexturedLit'), fallbackTo: 'gbuffers_textured', fogAffected: true },
    { name: 'gbuffers_entities', displayName: 'gbuffers_entities', description: t('schema.shaderpack.subGbuffersEntities'), fallbackTo: 'gbuffers_textured_lit', fogAffected: true },
    { name: 'gbuffers_hand', displayName: 'gbuffers_hand', description: t('schema.shaderpack.subGbuffersHand'), fallbackTo: 'gbuffers_textured_lit', fogAffected: true },
    { name: 'gbuffers_terrain', displayName: 'gbuffers_terrain', description: t('schema.shaderpack.subGbuffersTerrain'), fallbackTo: null, fogAffected: true },
    { name: 'gbuffers_water', displayName: 'gbuffers_water', description: t('schema.shaderpack.subGbuffersWater'), fallbackTo: null, fogAffected: true },
    { name: 'gbuffers_weather', displayName: 'gbuffers_weather', description: t('schema.shaderpack.subGbuffersWeather'), fallbackTo: 'gbuffers_textured_lit', fogAffected: true },
    { name: 'gbuffers_spidereyes', displayName: 'gbuffers_spidereyes', description: t('schema.shaderpack.subGbuffersSpidereyes'), fallbackTo: 'gbuffers_entities', fogAffected: true }
  ]
}

/** ShadowMap 子 pass */
function buildShadowSubpasses(locale?: SharedLocale): SubpassInfo[] {
  const t = (key: string): string => sharedT(key, undefined, locale)
  return [
    { name: 'shadow', displayName: 'shadow', description: t('schema.shaderpack.subShadow'), fallbackTo: null },
    { name: 'shadowcomp', displayName: 'shadowcomp', description: t('schema.shaderpack.subShadowcomp'), fallbackTo: 'shadow' }
  ]
}

/** 后处理 pass（begin/setup/prepare/composite/composite1-9/deferred/final） */
function buildCompositeSubpasses(locale?: SharedLocale): SubpassInfo[] {
  const t = (key: string): string => sharedT(key, undefined, locale)
  return [
    { name: 'begin', displayName: 'begin', description: t('schema.shaderpack.subBegin'), fallbackTo: null },
    { name: 'setup', displayName: 'setup', description: t('schema.shaderpack.subSetup'), fallbackTo: null },
    { name: 'prepare', displayName: 'prepare', description: t('schema.shaderpack.subPrepare'), fallbackTo: null },
    { name: 'composite', displayName: 'composite', description: t('schema.shaderpack.subComposite'), fallbackTo: null },
    { name: 'composite1', displayName: 'composite1', description: t('schema.shaderpack.subComposite1'), fallbackTo: null },
    { name: 'composite2', displayName: 'composite2', description: t('schema.shaderpack.subComposite2'), fallbackTo: null },
    { name: 'composite3', displayName: 'composite3', description: t('schema.shaderpack.subComposite3'), fallbackTo: null },
    { name: 'composite4', displayName: 'composite4', description: t('schema.shaderpack.subComposite4'), fallbackTo: null },
    { name: 'composite5', displayName: 'composite5', description: t('schema.shaderpack.subComposite5'), fallbackTo: null },
    { name: 'composite6', displayName: 'composite6', description: t('schema.shaderpack.subComposite6'), fallbackTo: null },
    { name: 'composite7', displayName: 'composite7', description: t('schema.shaderpack.subComposite7'), fallbackTo: null },
    { name: 'composite8', displayName: 'composite8', description: t('schema.shaderpack.subComposite8'), fallbackTo: null },
    { name: 'composite9', displayName: 'composite9', description: t('schema.shaderpack.subComposite9'), fallbackTo: null },
    { name: 'deferred', displayName: 'deferred', description: t('schema.shaderpack.subDeferred'), fallbackTo: null },
    { name: 'final', displayName: 'final', description: t('schema.shaderpack.subFinal'), fallbackTo: null }
  ]
}

/** 类别注册表 builder（常量在 import 时按当前语言冻结，getter 支持按语言重建） */
function buildShaderCategories(locale?: SharedLocale): ShaderCategoryInfo[] {
  const t = (key: string): string => sharedT(key, undefined, locale)
  const gbuffersSubpasses = buildGbuffersSubpasses(locale)
  const shadowSubpasses = buildShadowSubpasses(locale)
  const compositeSubpasses = buildCompositeSubpasses(locale)
  return [
    {
      key: 'gbuffers',
      label: t('schema.shaderpack.catGbuffers'),
      hint: t('schema.shaderpack.catGbuffersHint'),
      ext: '',
      creatable: true,
      subpasses: gbuffersSubpasses
    },
    {
      key: 'shadow',
      label: t('schema.shaderpack.catShadow'),
      hint: t('schema.shaderpack.catShadowHint'),
      ext: '',
      creatable: true,
      subpasses: shadowSubpasses.filter((p) => p.name === 'shadow')
    },
    {
      key: 'shadowcomp',
      label: t('schema.shaderpack.catShadowcomp'),
      hint: t('schema.shaderpack.catShadowcompHint'),
      ext: '',
      creatable: true,
      subpasses: shadowSubpasses.filter((p) => p.name === 'shadowcomp')
    },
    {
      key: 'prepare',
      label: t('schema.shaderpack.catPrepare'),
      hint: t('schema.shaderpack.catPrepareHint'),
      ext: '',
      creatable: true,
      subpasses: compositeSubpasses.filter((p) => p.name === 'prepare')
    },
    {
      key: 'begin',
      label: t('schema.shaderpack.catBegin'),
      hint: t('schema.shaderpack.catBeginHint'),
      ext: '',
      creatable: true,
      subpasses: compositeSubpasses.filter((p) => p.name === 'begin')
    },
    {
      key: 'setup',
      label: t('schema.shaderpack.catSetup'),
      hint: t('schema.shaderpack.catSetupHint'),
      ext: '',
      creatable: true,
      subpasses: compositeSubpasses.filter((p) => p.name === 'setup')
    },
    {
      key: 'composite',
      label: t('schema.shaderpack.catComposite'),
      hint: t('schema.shaderpack.catCompositeHint'),
      ext: '',
      creatable: true,
      subpasses: compositeSubpasses.filter((p) => p.name.startsWith('composite'))
    },
    {
      key: 'deferred',
      label: t('schema.shaderpack.catDeferred'),
      hint: t('schema.shaderpack.catDeferredHint'),
      ext: '',
      creatable: true,
      subpasses: compositeSubpasses.filter((p) => p.name === 'deferred')
    },
    {
      key: 'final',
      label: t('schema.shaderpack.catFinal'),
      hint: t('schema.shaderpack.catFinalHint'),
      ext: '',
      creatable: true,
      subpasses: compositeSubpasses.filter((p) => p.name === 'final')
    },
    { key: 'lib', label: t('schema.shaderpack.catLib'), hint: t('schema.shaderpack.catLibHint'), ext: '.glsl', creatable: true },
    { key: 'lang', label: t('schema.shaderpack.catLang'), hint: t('schema.shaderpack.catLangHint'), ext: '.lang', creatable: true },
    { key: 'config', label: t('schema.shaderpack.catConfig'), hint: t('schema.shaderpack.catConfigHint'), ext: '.properties', creatable: false }
  ]
}

/** 类别注册表（文件树分组顺序与新建模板共用；UI 侧请用 getShaderCategories 建立响应式） */
export const SHADER_CATEGORIES: ShaderCategoryInfo[] = buildShaderCategories()

/** 按语言取类别注册表（组件 computed 内传 locale.value 建立响应式依赖） */
export function getShaderCategories(locale?: SharedLocale): ShaderCategoryInfo[] {
  return buildShaderCategories(locale)
}

export function shaderCategoryInfo(key: string): ShaderCategoryInfo | undefined {
  return SHADER_CATEGORIES.find((c) => c.key === key)
}

/** 着色器阶段（决定扩展名）；lib/lang/config 不使用阶段概念 */
export type ShaderStage = 'vertex' | 'fragment' | 'geometry'

/** 着色器阶段选项 builder（常量在 import 时按当前语言冻结，getter 支持按语言重建） */
function buildShaderStageOptions(
  locale?: SharedLocale
): { value: ShaderStage; label: string; ext: string }[] {
  const t = (key: string): string => sharedT(key, undefined, locale)
  return [
    { value: 'vertex', label: t('schema.shaderpack.stageVertex'), ext: '.vsh' },
    { value: 'fragment', label: t('schema.shaderpack.stageFragment'), ext: '.fsh' },
    { value: 'geometry', label: t('schema.shaderpack.stageGeometry'), ext: '.gsh' }
  ]
}

/** 着色器阶段选项（UI 侧请用 getShaderStageOptions 建立响应式） */
export const SHADER_STAGE_OPTIONS: { value: ShaderStage; label: string; ext: string }[] =
  buildShaderStageOptions()

/** 按语言取阶段选项（组件 computed 内传 locale.value 建立响应式依赖） */
export function getShaderStageOptions(
  locale?: SharedLocale
): { value: ShaderStage; label: string; ext: string }[] {
  return buildShaderStageOptions(locale)
}

export function stageExtension(stage: ShaderStage): string {
  return SHADER_STAGE_OPTIONS.find((s) => s.value === stage)?.ext ?? '.vsh'
}

/** 光影包文件节点（文件树 + 编辑目标） */
export interface ShaderPackFile {
  /** 不含扩展名的文件名（lib/lang 仅文件名部分） */
  id: string
  /** 相对包根的路径：shaders/gbuffers_terrain.vsh / shaders/lib/common.glsl */
  relPath: string
  category: ShaderFileCategory
  /** 文件扩展名（.vsh/.fsh/.gsh/.glsl/.lang/.properties） */
  ext: string
  updatedAt: number
}

/**
 * 按文件名前缀分类（shaders/ 平铺文件的管线阶段判定）。
 * lib/lang/config 由调用方按所在子目录先判定，此处只处理管线文件。
 */
export function classifyShaderFile(fileName: string): ShaderFileCategory {
  if (fileName.startsWith('gbuffers')) return 'gbuffers'
  // shadowcomp 必须在 shadow 之前判定（前缀重叠）
  if (fileName.startsWith('shadowcomp')) return 'shadowcomp'
  if (fileName.startsWith('shadow')) return 'shadow'
  if (fileName.startsWith('prepare')) return 'prepare'
  if (fileName.startsWith('begin')) return 'begin'
  if (fileName.startsWith('setup')) return 'setup'
  if (fileName.startsWith('composite')) return 'composite'
  if (fileName.startsWith('deferred')) return 'deferred'
  if (fileName.startsWith('final')) return 'final'
  return 'composite'
}

/**
 * 解析管线文件名到结构化结果。
 * @returns 分类 + 子 pass 名（如 "gbuffers_terrain" → { category: 'gbuffers', subpass: 'gbuffers_terrain' }）；
 *          非管线文件返回 { category, subpass: null }。
 */
export function parseShaderFileName(fileName: string): {
  category: ShaderFileCategory
  subpass: string | null
} {
  const category = classifyShaderFile(fileName)
  // 检查是否匹配某个已知子 pass（精确匹配优先；composite 会匹配 composite1-9）
  const catInfo = SHADER_CATEGORIES.find((c) => c.key === category)
  if (catInfo?.subpasses) {
    const match = catInfo.subpasses.find((s) => s.name === fileName)
    if (match) return { category, subpass: match.name }
  }
  return { category, subpass: null }
}

/** 检查管线文件名是否是该分类下的合法子 pass */
export function isValidSubpassName(category: ShaderFileCategory, subpassName: string): boolean {
  const catInfo = SHADER_CATEGORIES.find((c) => c.key === category)
  if (!catInfo?.subpasses) return false
  return catInfo.subpasses.some((s) => s.name === subpassName)
}

/** 查询子 pass 的详细元数据 */
export function subpassInfo(category: ShaderFileCategory, subpassName: string): SubpassInfo | undefined {
  const catInfo = SHADER_CATEGORIES.find((c) => c.key === category)
  return catInfo?.subpasses?.find((s) => s.name === subpassName)
}

/** 沿后备链查找替补 pass（null 表示链尾，缺失时回落固定管线） */
export function fallbackChain(category: ShaderFileCategory, subpassName: string): SubpassInfo[] {
  const result: SubpassInfo[] = []
  let current = subpassInfo(category, subpassName)
  while (current) {
    result.push(current)
    if (!current.fallbackTo) break
    current = subpassInfo(category, current.fallbackTo)
  }
  return result
}

/** 新建光影包元数据 */
export function createShaderPackMeta(input: {
  packId: string
  name: string
  loader: ShaderLoader
  mcVersion: McVersionLike
  version: string
  description: string
}): ShaderPackMeta {
  const now = Date.now()
  return {
    packId: input.packId,
    name: input.name || input.packId,
    mcVersion: input.mcVersion,
    loader: input.loader,
    version: input.version || '1.0.0',
    description: input.description || '',
    createdAt: now,
    updatedAt: now
  }
}

/** 校验光影包元数据；返回错误消息，合法返回 null */
export function validateShaderPackMeta(meta: ShaderPackMeta): string | null {
  if (!validateContentId(meta.packId)) {
    return sharedT('schema.common.errPackIdInvalid')
  }
  if (!(meta.name || '').trim()) {
    return sharedT('schema.shaderpack.errNameRequired')
  }
  if (meta.loader !== 'iris' && meta.loader !== 'optifine') {
    return sharedT('schema.shaderpack.errLoaderUnsupported', { v: meta.loader })
  }
  if (!VALID_MC_VERSIONS.has(meta.mcVersion)) {
    return sharedT('schema.common.errMcVersionUnsupported', { v: meta.mcVersion })
  }
  return null
}

const TEMPLATE_NOTE =
  '由 KunYu 光影包编辑器生成；实时预览请在游戏内加载光影包验证'

/** 顶点着色器最小模板（OptiFine 传统 GLSL 120 写法，Iris 兼容） */
function vertexTemplate(): string {
  return `#version 120
// ${TEMPLATE_NOTE}

varying vec2 texcoord;
varying vec4 vertexColor;

void main() {
    texcoord = (gl_TextureMatrix[0] * gl_MultiTexCoord0).xy;
    vertexColor = gl_Color;
    gl_Position = ftransform();
}
`
}

/** 片元着色器最小模板 */
function fragmentTemplate(): string {
  return `#version 120
// ${TEMPLATE_NOTE}

uniform sampler2D texture;

varying vec2 texcoord;
varying vec4 vertexColor;

void main() {
    vec4 albedo = texture2D(texture, texcoord) * vertexColor;
    /* DRAWBUFFERS:0 */
    gl_FragColor = albedo;
}
`
}

/** 几何着色器最小骨架（仅含版本与声明注释，具体逻辑按加载器文档补全） */
function geometryTemplate(): string {
  return `#version 120
// ${TEMPLATE_NOTE}
// 注意：几何着色器为加载器扩展能力，请按 Iris/OptiFine 文档编写布局声明。

`
}

/** lib 公共库模板 */
function libTemplate(id: string): string {
  return `// ${id}.glsl — 公共 GLSL 库（${TEMPLATE_NOTE}）
// 在 shader 文件中通过以下方式引入：
// #include "${id}"

`
}

/** lang 文件模板 */
function langTemplate(id: string): string {
  return `# ${id}.lang — 光影选项多语言（key=value）
# 例：option.SHADOW_QUALITY=阴影质量

`
}

/** 初始化时写入的 shaders.properties 占位 */
export function shaderPropertiesTemplate(meta: ShaderPackMeta): string {
  return `# ${meta.name} 光影包配置
# 加载器：${meta.loader}，MC：${meta.mcVersion}

name=${meta.name}

# ---- 光影设置界面骨架（OptiFine / Iris 通用约定）----
# 1) 在 .vsh/.fsh/.csh/.glsl 中用 #define 声明选项（Iris/OptiFine 会扫描注释里的可选取值）：
#      #define SHADOW_QUALITY 1 // [0 1 2 3]
# 2) 在下面把选项加入设置界面（screen）与滑块列表（sliders）：
#      screen=option.SHADOW_QUALITY
#      screen.Lighting=option.SHADOW_QUALITY
#      screen.Lighting.columns=1
#      sliders=option.SHADOW_QUALITY
# 3) 在 lang/en_us.lang 与 lang/zh_cn.lang 提供标签（中文标签 key 必须在 lang 白名单内）：
#      option.SHADOW_QUALITY=阴影质量
#      value.SHADOW_QUALITY.0=关闭
#      value.SHADOW_QUALITY.1=低

`
}

/**
 * 新建文件的内容模板。
 * @param category 文件类别（gbuffers/composite/.../lib/lang）
 * @param id 不含扩展名的文件名
 * @param stage 着色器阶段（仅管线类别使用）
 */
export function createShaderFileTemplate(
  category: ShaderFileCategory,
  id: string,
  stage: ShaderStage
): string {
  if (category === 'lib') return libTemplate(id)
  if (category === 'lang') return langTemplate(id)
  // 六类管线 pass：按 vsh/fsh/gsh 阶段取模板
  if (stage === 'vertex') return vertexTemplate()
  if (stage === 'fragment') return fragmentTemplate()
  return geometryTemplate()
}

/**
 * 新建文件的包内相对路径。
 * 管线类别平铺 shaders/，lib/lang 入子目录。
 */
export function shaderFileRelPath(
  category: ShaderFileCategory,
  id: string,
  stage: ShaderStage
): string {
  if (category === 'lib') return `shaders/lib/${id}.glsl`
  if (category === 'lang') return `shaders/lang/${id}.lang`
  return `shaders/${id}${stageExtension(stage)}`
}
