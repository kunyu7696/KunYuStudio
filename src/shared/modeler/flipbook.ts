/**
 * 贴图 flipbook 动画（B2-1，v2）：Java .png.mcmeta 公开格式子集。
 *
 * 设计（clean-room，仅依据 Minecraft Wiki 公开格式规范）：
 * - 贴图本体为竖直拼接帧条：width 即帧边长（仅支持方形帧），height = width × 帧数；
 * - frametime 单位为游戏刻（1 秒 = 20 刻）；interpolate 为帧间线性插值；
 *   frames 可自定义播放顺序（0 基索引，可重复），缺省 = 顺序播放全部帧；
 * - 元数据存于 `ModelTexture.animation`（随文档落盘、进撤销栈），生成器在落盘
 *   PNG 旁写同名 `.png.mcmeta`。
 */
import type { ModelTexture, TextureAnimation } from './types'

/** 帧数：height 必须是 width 的正整数倍且 ≥2，否则不是合法帧条 → null */
export function textureFrameCount(tex: Pick<ModelTexture, 'width' | 'height'>): number | null {
  if (tex.width <= 0 || tex.height <= 0) return null
  if (tex.height % tex.width !== 0) return null
  const n = tex.height / tex.width
  return n >= 2 ? n : null
}

export type TextureAnimationIssueCode =
  | 'animation_not_strip'
  | 'animation_frametime_invalid'
  | 'animation_frame_out_of_range'

export interface TextureAnimationIssue {
  code: TextureAnimationIssueCode
  message: string
}

/** 校验贴图动画元数据（无动画 → 空表；UI 提示与生成器预检共用） */
export function validateTextureAnimation(tex: ModelTexture): TextureAnimationIssue[] {
  const anim = tex.animation
  if (!anim) return []
  const issues: TextureAnimationIssue[] = []
  const frameCount = textureFrameCount(tex)
  if (frameCount === null) {
    issues.push({
      code: 'animation_not_strip',
      message: `贴图「${tex.name}」尺寸 ${tex.width}×${tex.height} 不是竖直帧条（高度需为宽度的整数倍且 ≥2 帧）`
    })
  }
  if (!Number.isInteger(anim.frametime) || anim.frametime < 1) {
    issues.push({
      code: 'animation_frametime_invalid',
      message: `贴图「${tex.name}」帧时长 frametime=${String(anim.frametime)} 非法（需为 ≥1 的整数刻）`
    })
  }
  if (anim.frames && anim.frames.length > 0) {
    const bad = anim.frames.filter(
      (f) => !Number.isInteger(f) || f < 0 || (frameCount !== null && f >= frameCount)
    )
    if (bad.length > 0) {
      issues.push({
        code: 'animation_frame_out_of_range',
        message: `贴图「${tex.name}」自定义帧序含越界帧：${bad.join(', ')}（共 ${frameCount ?? '?'} 帧）`
      })
    }
  }
  return issues
}

/**
 * 生成 .png.mcmeta 内容对象（仅写有定义的可选字段），调用方 JSON.stringify 落盘。
 * 无动画 → null（调用方跳过写文件）。
 */
export function buildTextureMcmeta(
  animation: TextureAnimation | undefined
): { animation: TextureAnimation } | null {
  if (!animation) return null
  const out: TextureAnimation = { frametime: animation.frametime }
  if (animation.interpolate) out.interpolate = true
  if (animation.frames && animation.frames.length > 0) out.frames = [...animation.frames]
  return { animation: out }
}
