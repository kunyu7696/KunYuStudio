/**
 * Java 反向解析（统一编辑器 P3.4）。
 *
 * 当用户直接手改生成的 ModBlocks.java（改数值/加方法）后，
 * 把声明段反向解析为属性补丁，回写到方块语义 JSON：
 *   手改 Java → ReverseBlockPatch → BlockProperties → 下一轮表单/生成
 *
 * 边界：只识别「我们自己生成的」链式调用形态（Fabric Yarn 与
 * Forge/NeoForge Mojmap 两套命名），不做通用 Java 语法解析；
 * 手写的任意表达式无法识别时该字段被忽略。
 */
import type { BlockProperties } from './block.schema'

/** 回写到 BlockProperties 的补丁（字段与语义 schema 同名） */
export type ReverseBlockPatch = Partial<Pick<BlockProperties,
  'hardness' | 'resistance' | 'requiresTool' | 'lightLevel' | 'opaque' | 'hasCollision' | 'soundGroup'
>>

/** 从完整 ModBlocks.java 中切出指定方块的声明段；找不到返回 null */
export function extractBlockSegment(javaSrc: string, blockId: string): string | null {
  const CONST = blockId.toUpperCase()

  // Forge/NeoForge：BLOCKS.register("id", () -> new Block(...))
  const regRe = new RegExp(`BLOCKS\\.register\\("${escapeRe(blockId)}"`)
  const regMatch = regRe.exec(javaSrc)
  if (regMatch) {
    const open = regMatch.index + regMatch[0].lastIndexOf('(')
    const end = matchParen(javaSrc, open)
    if (end >= 0) return javaSrc.slice(regMatch.index, end + 1)
  }

  // Fabric：public static final Block CONST = new Block(...)
  const declRe = new RegExp(`public static final Block ${escapeRe(CONST)} = new Block\\(`)
  const declMatch = declRe.exec(javaSrc)
  if (declMatch) {
    // 定位 new Block( 的开括号（即匹配文本的最后一个字符）
    const open = declMatch.index + declMatch[0].length - 1
    const end = matchParen(javaSrc, open)
    if (end >= 0) return javaSrc.slice(declMatch.index, end + 1)
  }
  return null
}

/**
 * 从开括号位置做括号配对，返回匹配闭括号下标。
 * 跳过字符串字面量与行注释（生成代码形态简单，无需完整词法分析）。
 */
function matchParen(src: string, openIndex: number): number {
  let depth = 0
  let inString: false | '"' | "'" = false
  for (let i = openIndex; i < src.length; i++) {
    const ch = src[i]
    if (inString) {
      if (ch === '\\') {
        i++
        continue
      }
      if (ch === inString) inString = false
      continue
    }
    if (ch === '"' || ch === "'") {
      inString = ch as '"' | "'"
    } else if (ch === '/' && src[i + 1] === '/') {
      const nl = src.indexOf('\n', i)
      if (nl < 0) return -1
      i = nl
    } else if (ch === '(') {
      depth++
    } else if (ch === ')') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * 解析声明段为属性补丁。
 * 未出现的调用按生成器约定回落到默认（不透明/有碰撞/需工具=false/光照0），
 * 因为生成器只在属性非默认时才写出对应方法。
 */
export function parseBlockSegment(segment: string): ReverseBlockPatch {
  const patch: ReverseBlockPatch = {}

  // .strength(h, r)（两套命名一致；数字可能带 f）
  const strength = segment.match(/\.strength\(\s*([-\d.]+)f?\s*,\s*([-\d.]+)f?\s*\)/)
  if (strength) {
    const h = Number.parseFloat(strength[1])
    const r = Number.parseFloat(strength[2])
    if (Number.isFinite(h)) patch.hardness = round2(h)
    if (Number.isFinite(r)) patch.resistance = round2(r)
  }

  // .sounds(BlockSoundGroup.X) / .sound(SoundType.X)
  const sound = segment.match(/\.(?:sounds|sound)\(\s*(?:BlockSoundGroup|SoundType)\.([A-Z_]+)\s*\)/)
  if (sound) {
    const g = sound[1].toLowerCase()
    if (['stone', 'wood', 'gravel', 'metal', 'glass', 'wool'].includes(g)) {
      patch.soundGroup = g as BlockProperties['soundGroup']
    }
  }

  // .requiresTool() / .requiresCorrectToolForDrops()
  patch.requiresTool = /\.(?:requiresTool|requiresCorrectToolForDrops)\(\)/.test(segment)

  // .luminance(state -> n) / .lightLevel(state -> n)
  const light = segment.match(/\.(?:luminance|lightLevel)\(\s*state\s*->\s*(\d+)\s*\)/)
  patch.lightLevel = light ? Math.min(15, Math.max(0, Number.parseInt(light[1], 10))) : 0

  // .noCollision() / .noCollission()（原版 Mojmap 拼写为 noCollission）
  patch.hasCollision = !/\.noColli(?:s|ss)ion\(\)/.test(segment)

  // .nonOpaque() / .noOcclusion() 出现 → 不阻挡光线
  patch.opaque = !/\.(?:nonOpaque|noOcclusion)\(\)/.test(segment)

  return patch
}

/** 一步到位：切段 + 解析；找不到声明返回 null */
export function parseBlockJava(javaSrc: string, blockId: string): ReverseBlockPatch | null {
  const segment = extractBlockSegment(javaSrc, blockId)
  if (!segment) return null
  return parseBlockSegment(segment)
}
