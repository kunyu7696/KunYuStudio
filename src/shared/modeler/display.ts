/**
 * display 槽位域：槽位中文标签与常用预设（P3-e，方案 §4.2）。
 *
 * 数值取自 Minecraft 官方 wiki 公开的 display 标签示例（原版方块在
 * GUI/地面/展示框的标准摆放），仅作为快速起步预设，全部可在面板微调。
 * 本层为纯数据：不依赖 DOM/three/Electron。
 */
import type { DisplaySlot, DisplayTransform, Vec3 } from './types'

export const DISPLAY_SLOT_LABELS: Record<DisplaySlot, string> = {
  thirdperson_righthand: '第三人称 右手',
  thirdperson_lefthand: '第三人称 左手',
  firstperson_righthand: '第一人称 右手',
  firstperson_lefthand: '第一人称 左手',
  head: '头部佩戴',
  gui: '界面 GUI',
  ground: '掉落物（地面）',
  fixed: '展示框（固定）'
}

/** display 槽位顺序（面板下拉与预设应用目标） */
export const DISPLAY_SLOT_ORDER: readonly DisplaySlot[] = [
  'gui',
  'ground',
  'fixed',
  'head',
  'thirdperson_righthand',
  'thirdperson_lefthand',
  'firstperson_righthand',
  'firstperson_lefthand'
]

/** 恒等变换判定（面板提交时清除无意义的空变换，保持文档干净） */
export function isIdentityTransform(t: DisplayTransform): boolean {
  const zero = (v?: Vec3): boolean => !v || v.every((n) => n === 0)
  const one = (v?: Vec3): boolean => !v || v.every((n) => n === 1)
  return zero(t.rotation) && zero(t.translation) && one(t.scale)
}

/** 去掉 undefined 字段（Java display 标签省略零值字段的等价表达） */
export function compactTransform(t: DisplayTransform): DisplayTransform {
  const out: DisplayTransform = {}
  if (t.rotation) out.rotation = [...t.rotation]
  if (t.translation) out.translation = [...t.translation]
  if (t.scale) out.scale = [...t.scale]
  return out
}

/** 常用 display 预设（应用到当前选中槽位） */
export const DISPLAY_PRESETS: Record<string, DisplayTransform> = {
  '原版方块·界面': { rotation: [30, 225, 0], scale: [0.625, 0.625, 0.625] },
  '原版方块·地面': { translation: [0, 3, 0], scale: [0.25, 0.25, 0.25] },
  '原版方块·展示框': { rotation: [0, 180, 0], scale: [0.5, 0.5, 0.5] },
  '手持·斜握 45°': { rotation: [0, 45, 0] },
  '头部·举高佩戴': { translation: [0, 14.25, 0] }
}
