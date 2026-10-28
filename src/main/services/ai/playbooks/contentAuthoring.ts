/**
 * Playbook：内容创作（方块/物品/实体/配方等语义资产）。
 * 五段结构见 types.ts；内容对应 KunYu「双轨硬约束」纪律：语义资产唯一入口 content_upsert。
 */
import type { Playbook } from './types'

export const contentAuthoringPlaybook: Playbook = {
  id: 'content-authoring',
  title: '内容创作规程',
  triggers: ['方块', '物品', '实体', '配方', '进度', '群系', '附魔', '生物', 'content_upsert', '语义资产'],
  contentTypes: [
    'block',
    'item',
    'entity',
    'recipe',
    'gui',
    'advancement',
    'worldgen',
    'tag',
    'command',
    'enchantment'
  ],
  intents: ['code'],
  route: {
    tools: [
      'content_list',
      'content_read',
      'content_upsert',
      'item_validate',
      'model_validate',
      'recipe_validate',
      'recipe_create',
      'recipe_generate'
    ],
    note:
      '改既有内容先 content_list/content_read 读回语义资产再改；新增唯一入口 content_upsert' +
      '（严禁 write_project_file 直写注册链，产物在可视化编辑器不可见）；保存前用对应 validate 工具自检。'
  },
  workflow: [
    '修改场景先 content_list/content_read 读回既有语义资产',
    'content_upsert 写入语义资产（自定义行为类先 write_project_file 写 Java，再填 customClass 全限定名）',
    'item_validate/model_validate/recipe_validate 自检',
    '契约登记可自动判定的断言（file-exists / registry-entry）'
  ],
  acceptanceGates: [
    '对应 validate 工具返回通过',
    '自定义行为类已落盘且 customClass 已填，缺其一 = 不注册 = 游戏里找不到'
  ],
  failureContract: [
    '校验不过如实列出差异项，禁止假装保存成功',
    '语义资产表达不了的复杂实现（BlockEntity/Screen/Mixin）才回退 write_project_file，并向用户说明原因'
  ]
}
