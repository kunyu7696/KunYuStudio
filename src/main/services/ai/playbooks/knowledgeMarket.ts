/**
 * Playbook：检索与市场（参考包/知识库/原版数据只读检索 + 社区模组市场安装）。
 * 对应 KunYu 纪律：只读检索优先于凭记忆；整合包新需求优先社区模组而非从零实现；
 * 检索未命中如实声明未覆盖，不编造。
 */
import type { Playbook } from './types'

export const knowledgeMarketPlaybook: Playbook = {
  id: 'knowledge-market',
  title: '检索与市场规程',
  triggers: [
    '模组市场',
    '安装模组',
    '搜索模组',
    '模组',
    'modrinth',
    'curseforge',
    '整合包',
    '依赖',
    '知识库',
    '原版数据'
  ],
  projectTypes: ['modpack'],
  route: {
    tools: [
      'template_search',
      'kb_search',
      'mc_data_lookup',
      'error_analyze',
      'version_check',
      'api_validate',
      'market_search_mods',
      'market_mod_detail',
      'market_install_mod',
      'market_list_installed',
      'modpack_dependency_audit'
    ],
    note:
      '只读检索（template_search/kb_search/mc_data_lookup）优先于凭记忆；整合包新需求先 ' +
      'market_search_mods → market_mod_detail 核对 MC 版本与加载器 → market_install_mod；' +
      '装完 modpack_dependency_audit 审计依赖。'
  },
  workflow: [
    '只读检索先行（模板/知识库/原版数据），不编造 API',
    // P9 plan/apply 分离：多模组变更先出评审计划，应用时不简化不重排
    '多模组变更先列三级承诺清单（必装/可选/排除）交用户评审，评审通过再动手',
    '市场搜索 → 详情核对版本/加载器 → 按评审清单逐个安装，不擅自增删替换候选',
    'modpack_dependency_audit 确认前置齐全、无冲突'
  ],
  acceptanceGates: [
    '依赖审计无缺必需前置、无声明冲突共存',
    'API 用法与检索结果一致（version_check/api_validate 佐证）',
    '实际安装清单与评审清单一致；可选/排除项的处理结果如实标注'
  ],
  failureContract: [
    '检索未命中如实声明「参考包/知识库未覆盖」，不编造用法',
    '安装失败列明平台与原因；CurseForge 缺 Key 自动走 MCIM 社区镜像，不静默放弃',
    '可选候选未解析时如实报告，不静默提升为必装、也不静默丢弃'
  ]
}
