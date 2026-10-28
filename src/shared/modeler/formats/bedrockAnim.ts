/**
 * Bedrock / GeckoLib 动画文件编解码（方案 §4.9，P4-b）。
 *
 * 产物契约：bedrock.dev 公开规范的 .animation.json（format_version 1.8.0 子集）：
 * { format_version, animations: { "animation.<ns>.<name>": { loop, animation_length,
 *   bones: { <boneName>: { lerp_mode?, rotation|position|scale: { "<t>": [x,y,z] |
 *     { pre?, post?, lerp_mode? } } } } } } }。
 * clean-room 红线：仅依据 bedrock.dev / 官方 wiki 公开规范独立实现，
 * 不读取、不复制任何第三方编辑器（Blockbench 等）源码。
 *
 * 与几何文件的关系：.animation.json 只承载动画，不含几何；因此导入是
 * 「合并进既有文档」（骨骼名 → 组节点 id），而非 geoToDocument 那样的整文档导入。
 * 骨骼名映射与几何导出共用 assignBoneNames（重名骨骼两侧改名一致）。
 * 旋转语义与几何一致：Bedrock X/Y 取反（Z 不变），导入导出对称互逆
 * （复用 bedrock.ts 的 rotationToDoc/rotationToGeo）。
 *
 * 插值映射（文档模型按帧记插值，Bedrock 按通道记 lerp_mode，本模块为超集）：
 * - 导出：全通道同插值 → 数组简写（catmullrom 提为通道级 lerp_mode）；
 *   混合或含 step → 逐帧对象形 { post, lerp_mode }，step 帧的下一帧补
 *   pre=本帧值（Bedrock 读者的「保持」语义）；
 * - 导入：对象形 lerp_mode 优先（含我们自写的 "step" 标记，自有文件往返无损）；
 *   pre≠post 且非 step 续值标记 → 取 post 并告警（不连续跳变为文档化子集降级）；
 * - molang 字符串关键帧 / 非数值向量 → 告警跳过。
 */
import { sortKeyframes } from '../anim'
import { isIdentityEasing } from '../curve'
import type {
  AnimationChannelName,
  Interpolation,
  Keyframe,
  LoopMode,
  ModelAnimation,
  ModelDocument,
  NodeId,
  Vec3
} from '../types'
import { assignBoneNames, rotationToDoc, rotationToGeo } from './bedrock'
import type { BedrockFormatData } from './bedrock'
import type { FormatDowngrade, FormatExportResult, FormatImportResult } from './types'

/* ------------------------------------------------------------------ */
/* .animation.json 类型（1.8.0 公开规范子集）                             */
/* ------------------------------------------------------------------ */

/** 关键帧值：数组简写 / 对象形（pre/post/lerp_mode） / molang 字符串（不支持，告警） */
export type BedrockAnimKeyValue = number[] | { pre?: number[]; post?: number[]; lerp_mode?: string } | string

export type BedrockAnimChannelJson = Record<string, BedrockAnimKeyValue>

export interface BedrockAnimBoneJson {
  lerp_mode?: string
  rotation?: BedrockAnimChannelJson
  position?: BedrockAnimChannelJson
  scale?: BedrockAnimChannelJson
}

export interface BedrockAnimationJson {
  loop?: boolean | 'hold_on_last_frame'
  animation_length?: number
  bones?: Record<string, BedrockAnimBoneJson>
}

export interface BedrockAnimationFileJson {
  format_version?: string
  animations?: Record<string, BedrockAnimationJson>
}

/** 导出产物类型：format_version 与 animations 保证存在（导入解析用宽松类型） */
export interface BedrockAnimationFile extends BedrockAnimationFileJson {
  format_version: '1.8.0'
  animations: Record<string, BedrockAnimationJson>
}

/* ------------------------------------------------------------------ */
/* 小工具（编解码模块自包含约定，与 bedrock.ts 同形）                       */
/* ------------------------------------------------------------------ */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}

/** 时间点 → bedrock 键名字符串（0 / 0.5 / 1） */
function timeKey(t: number): string {
  return String(round3(t))
}

function safeIdPart(raw: string, fallback: string): string {
  const s = raw.replace(/[^a-zA-Z0-9_-]/g, '_')
  return s.length > 0 ? s : fallback
}

function uniqueId(base: string, used: Set<string>): string {
  let id = base
  let n = 2
  while (used.has(id)) id = `${base}_${n++}`
  used.add(id)
  return id
}

/** 数值三元组（非数值/molang 返回 null） */
function vec3Of(raw: unknown): Vec3 | null {
  if (!Array.isArray(raw)) return null
  const x = Number(raw[0])
  const y = Number(raw[1])
  const z = Number(raw[2])
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null
  return [round3(x), round3(y), round3(z)]
}

/* ------------------------------------------------------------------ */
/* 导出：ModelDocument → .animation.json                                 */
/* ------------------------------------------------------------------ */

export interface BedrockAnimExportOptions {
  /**
   * 动画命名空间（animation.<ns>.<name> 的 <ns>）。
   * 缺省：formatData.bedrock.identifier 去 geometry. 前缀 → doc.id。
   * p4-gen 实体链路显式传实体 id，与生成器模板动画命名一致。
   */
  namespace?: string
}

function resolveNamespace(doc: ModelDocument, options?: BedrockAnimExportOptions): string {
  if (options?.namespace) return options.namespace.replace(/[^a-zA-Z0-9_.-]/g, '_')
  const bedrock = (isRecord(doc.formatData?.bedrock) ? doc.formatData!.bedrock : {}) as BedrockFormatData
  const idf = bedrock.identifier?.replace(/^geometry\./i, '')
  return (idf && idf.replace(/[^a-zA-Z0-9_.-]/g, '_')) || safeIdPart(doc.id, 'model')
}

/** 导出值换算：rotation 通道 X/Y 取反，position/scale 直通 */
function valueToBedrock(value: Vec3, channel: AnimationChannelName): number[] {
  const v = channel === 'rotation' ? rotationToGeo(value) : value
  return [round3(v[0]), round3(v[1]), round3(v[2])]
}

/** 单通道导出：全同插值用数组简写，混合/含 step 用对象形（含 step 保持的 pre 续值） */
function channelToBedrock(keys: Keyframe[], channel: AnimationChannelName): { json: BedrockAnimChannelJson; lerpMode?: 'catmullrom' } {
  const sorted = sortKeyframes(keys)
  const uniform = sorted.every((k) => k.interpolation === sorted[0]!.interpolation)
  const json: BedrockAnimChannelJson = {}
  if (uniform && sorted[0]!.interpolation !== 'step') {
    for (const k of sorted) json[timeKey(k.time)] = valueToBedrock(k.value, channel)
    return { json, ...(sorted[0]!.interpolation === 'catmullrom' ? { lerpMode: 'catmullrom' as const } : {}) }
  }
  for (let i = 0; i < sorted.length; i++) {
    const k = sorted[i]!
    const entry: { pre?: number[]; post?: number[]; lerp_mode?: string } = {
      post: valueToBedrock(k.value, channel)
    }
    if (k.interpolation !== 'linear') entry.lerp_mode = k.interpolation
    // step 段内保持：本帧是 step 后续帧的取值来源 —— 下一帧 pre 续本帧值
    if (i > 0 && sorted[i - 1]!.interpolation === 'step') {
      entry.pre = valueToBedrock(sorted[i - 1]!.value, channel)
    }
    json[timeKey(k.time)] = entry
  }
  return { json }
}

export function documentToAnimations(
  doc: ModelDocument,
  options?: BedrockAnimExportOptions
): FormatExportResult<BedrockAnimationFile> {
  const downgrades: FormatDowngrade[] = []
  const boneNameByNodeId = assignBoneNames(doc)
  const namespace = resolveNamespace(doc, options)
  const animations: Record<string, BedrockAnimationJson> = {}

  for (const anim of Object.values(doc.animations)) {
    const key = anim.name.includes('.')
      ? anim.name
      : `animation.${namespace}.${safeIdPart(anim.name, 'anim')}`
    const out: BedrockAnimationJson = { animation_length: round3(anim.length) }
    if (anim.loop === 'loop') out.loop = true
    else if (anim.loop === 'hold') out.loop = 'hold_on_last_frame'

    const bones: Record<string, BedrockAnimBoneJson> = {}
    for (const [nodeId, channels] of Object.entries(anim.channels)) {
      const node = doc.nodes[nodeId]
      const boneName = node?.type === 'group' ? boneNameByNodeId.get(nodeId) : undefined
      if (!boneName) {
        downgrades.push({
          severity: 'warning',
          code: 'channel_target_not_bone',
          nodeId,
          message: `动画「${anim.name}」的通道目标「${node?.name ?? nodeId}」不是骨骼（组节点），Bedrock 动画只能作用于骨骼，已跳过`
        })
        continue
      }
      const bone: BedrockAnimBoneJson = {}
      for (const channel of ['rotation', 'position', 'scale'] as const) {
        const keys = channels[channel]
        if (!keys || keys.length === 0) continue
        if (keys.some((k) => k.easing && !isIdentityEasing(k.easing))) {
          downgrades.push({
            severity: 'warning',
            code: 'easing_dropped',
            nodeId,
            message: `动画「${anim.name}」骨骼「${boneName}」的 ${channel} 通道含自定义缓动，Bedrock 动画不支持，导出后该区间按线性插值`
          })
        }
        const { json, lerpMode } = channelToBedrock(keys, channel)
        if (lerpMode) bone.lerp_mode = lerpMode
        bone[channel] = json
      }
      if (bone.rotation || bone.position || bone.scale) bones[boneName] = bone
    }
    if (Object.keys(bones).length > 0) out.bones = bones
    animations[key] = out
  }

  return { output: { format_version: '1.8.0', animations }, downgrades }
}

/* ------------------------------------------------------------------ */
/* 导入：.animation.json 合并进既有文档                                    */
/* ------------------------------------------------------------------ */

function loopToDoc(raw: BedrockAnimationJson['loop']): LoopMode {
  if (raw === true) return 'loop'
  if (raw === 'hold_on_last_frame') return 'hold'
  return 'once'
}

function lerpToInterpolation(raw: unknown, fallback: Interpolation): Interpolation {
  if (raw === 'catmullrom') return 'catmullrom'
  if (raw === 'step') return 'step'
  if (raw === 'linear') return 'linear'
  return fallback
}

/**
 * 解析单通道关键帧表。
 * prevRawPost 追踪（Bedrock 空间）上一帧 post：对象形 pre 等于上一帧 post 时
 * 视为我们自写的 step 续值标记（静默）；否则 pre≠post 属外来不连续跳变，告警取 post。
 */
function channelToDoc(
  raw: BedrockAnimChannelJson,
  channel: AnimationChannelName,
  channelLerp: Interpolation,
  ctx: string,
  downgrades: FormatDowngrade[]
): Keyframe[] {
  const entries = Object.entries(raw)
    .map(([t, v]): [number, BedrockAnimKeyValue] => [Number(t), v])
    .filter(([t]) => Number.isFinite(t))
    .sort((a, b) => a[0] - b[0])

  const keys: Keyframe[] = []
  let prevRawPost: Vec3 | null = null
  for (const [t, v] of entries) {
    let vec: Vec3 | null = null
    let interpolation = channelLerp
    if (typeof v === 'string') {
      downgrades.push({
        severity: 'warning',
        code: 'keyframe_molang',
        message: `${ctx} 的 ${channel} 通道在 t=${timeKey(t)} 含 molang 表达式关键帧，已跳过`
      })
      continue
    }
    if (Array.isArray(v)) {
      vec = vec3Of(v)
    } else if (isRecord(v)) {
      interpolation = lerpToInterpolation(v.lerp_mode, channelLerp)
      const post = vec3Of(v.post)
      const pre = vec3Of(v.pre)
      vec = post ?? pre
      if (post && pre && (post[0] !== pre[0] || post[1] !== pre[1] || post[2] !== pre[2])) {
        const isStepContinuation =
          prevRawPost !== null &&
          pre[0] === prevRawPost[0] &&
          pre[1] === prevRawPost[1] &&
          pre[2] === prevRawPost[2]
        if (!isStepContinuation && v.lerp_mode !== 'step') {
          downgrades.push({
            severity: 'info',
            code: 'keyframe_discontinuous',
            message: `${ctx} 的 ${channel} 通道在 t=${timeKey(t)} 含 pre/post 双值关键帧（不连续跳变），已按 post 值导入`
          })
        }
      }
    }
    if (!vec) {
      downgrades.push({
        severity: 'warning',
        code: 'keyframe_invalid',
        message: `${ctx} 的 ${channel} 通道在 t=${timeKey(t)} 的关键帧值无法解析，已跳过`
      })
      continue
    }
    const value: Vec3 = channel === 'rotation' ? rotationToDoc(vec) : vec
    keys.push({ time: round3(t), value, interpolation })
    prevRawPost = vec
  }
  return keys
}

/**
 * 把 .animation.json 合并进既有文档：骨骼名 → 组节点 id（首个同名骨骼，
 * 与几何导入一致）；找不到的骨骼跳过通道并告警。同名动画直接新增条目
 * （动画名不强制唯一，id 由骨骼键确定性派生并去重）。
 */
export function mergeAnimationsIntoDocument(
  input: string | BedrockAnimationFileJson,
  doc: ModelDocument
): FormatImportResult {
  let data: unknown = input
  if (typeof input === 'string') {
    try {
      data = JSON.parse(input)
    } catch (e) {
      throw new Error(`.animation.json 解析失败：${String(e)}`)
    }
  }
  if (!isRecord(data) || !isRecord(data.animations)) {
    throw new Error('不是合法的 Bedrock 动画文件：缺少 animations 对象')
  }

  const downgrades: FormatDowngrade[] = []
  /* 骨骼名 → 组节点 id（首个同名）；重名骨骼整体告警一次 */
  const groupIdByName = new Map<string, NodeId>()
  let sawDuplicateName = false
  for (const node of Object.values(doc.nodes)) {
    if (node.type !== 'group') continue
    if (groupIdByName.has(node.name)) sawDuplicateName = true
    else groupIdByName.set(node.name, node.id)
  }
  if (sawDuplicateName) {
    downgrades.push({
      severity: 'warning',
      code: 'duplicate_bone_name',
      message: '文档存在重名骨骼，动画通道一律挂到首个同名骨骼'
    })
  }

  const animations: Record<string, ModelAnimation> = { ...doc.animations }
  const usedIds = new Set(Object.keys(doc.animations))

  for (const [animKey, rawAnim] of Object.entries(data.animations)) {
    const raw = (isRecord(rawAnim) ? rawAnim : {}) as BedrockAnimationJson
    const ctx = `动画「${animKey}」`
    const channels: ModelAnimation['channels'] = {}
    let maxKeyTime = 0

    const rawBones = isRecord(raw.bones) ? raw.bones : {}
    for (const [boneName, rawBone] of Object.entries(rawBones)) {
      if (!isRecord(rawBone)) continue
      const nodeId = groupIdByName.get(boneName)
      if (!nodeId) {
        downgrades.push({
          severity: 'warning',
          code: 'bone_missing',
          message: `${ctx} 引用的骨骼「${boneName}」在文档中不存在，其通道已跳过`
        })
        continue
      }
      const boneCtx = `${ctx} 骨骼「${boneName}」`
      const channelLerp = lerpToInterpolation(rawBone.lerp_mode, 'linear')
      const nodeChannels: ModelAnimation['channels'][string] = {}
      for (const channel of ['rotation', 'position', 'scale'] as const) {
        const rawChannel = rawBone[channel]
        if (!isRecord(rawChannel)) continue
        const keys = channelToDoc(rawChannel as BedrockAnimChannelJson, channel, channelLerp, boneCtx, downgrades)
        if (keys.length === 0) continue
        nodeChannels[channel] = keys
        for (const k of keys) if (k.time > maxKeyTime) maxKeyTime = k.time
      }
      if (Object.keys(nodeChannels).length > 0) channels[nodeId] = nodeChannels
    }

    const id = uniqueId(safeIdPart(animKey.replace(/\./g, '_'), 'anim'), usedIds)
    animations[id] = {
      id,
      name: animKey,
      length:
        typeof raw.animation_length === 'number' && Number.isFinite(raw.animation_length)
          ? round3(raw.animation_length)
          : round3(maxKeyTime),
      loop: loopToDoc(raw.loop),
      channels
    }
  }

  return { doc: { ...doc, animations }, downgrades }
}
