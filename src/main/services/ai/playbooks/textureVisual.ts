/**
 * Playbook：贴图与视觉资产（绘制/像素化/重绘 + 画廊持久化 + 离线三视角视觉评审）。
 * 对应 KunYu 纪律：AI 产出候选全部持久化项目画廊（不丢弃已消耗额度的资产）；
 * 评审失败回滚 + 列出原因（P0 视觉评审升级）。
 */
import type { Playbook } from './types'

export const textureVisualPlaybook: Playbook = {
  id: 'texture-visual',
  title: '贴图与视觉规程',
  triggers: ['贴图', '纹理', '材质', '像素画', '重绘', '像素化', 'texture', 'pixel'],
  intents: ['code'],
  route: {
    tools: ['texture_asset_search', 'texture_paint', 'texture_pixelize', 'texture_repaint'],
    note:
      '先 texture_asset_search 查项目画廊复用既有资产（零额度）；新绘制 texture_paint；' +
      '用户参考图转像素 texture_pixelize；既有贴图修改 texture_repaint。'
  },
  workflow: [
    'texture_asset_search 查画廊可复用资产',
    '绘制/像素化/重绘产出候选',
    '候选全部持久化到项目画廊（.kunyu/gallery）',
    '离线三视角视觉评审（数值指标 + 五项硬门）'
  ],
  acceptanceGates: [
    '评审 score≥82 且五项硬门全过、像素指标无越界',
    '已消耗额度生成的候选全部落画廊，不丢弃'
  ],
  failureContract: [
    '评审不合格回滚到评审前状态，并向用户列出未达标原因',
    '检出全透明/纯色贴图触发治愈重画，不交付空白贴图'
  ]
}
