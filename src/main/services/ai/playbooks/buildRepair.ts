/**
 * Playbook：构建修复诊断（假设-证伪纪律）。
 *
 * 核心洞察：修复循环的最大浪费不是改错代码，
 * 而是「诊断未证实就改代码、同一失败反复做同类改动」。落到 KunYu：
 * - 假设先行：动手前显式陈述根因假设 + 一条能证伪它的检查；
 * - 同失败即证伪：重跑后败在同一层 = 上一假设已被证伪，先修诊断而非改更多代码；
 * - 重复反馈 = 新观察：用户再次报同一现象时，先对比被测产物与旧假设再动手；
 * - 编译通过 ≠ 玩法修复：只建立「构建假设」被证实，玩法行为另需真机验证。
 *
 * 与 code-change playbook 的分工：code-change 管「工程改动怎么改」（edit 优先、
 * 语法校验），本规程管「失败诊断怎么想」（分层、假设、证伪），触发词不重叠。
 */
import type { Playbook } from './types'

export const buildRepairPlaybook: Playbook = {
  id: 'build-repair',
  title: '构建修复诊断规程',
  triggers: ['构建失败', '修复', '报错', '崩溃', '编译错误', '闪退', '打不开', '构建不过'],
  intents: ['fix'],
  route: {
    tools: [
      'error_analyze',
      'fabric_log_debugger',
      'project_grep',
      'read_project_file',
      'edit_project_file',
      'mixin_target_lookup'
    ],
    note:
      '构建/编译报错先用 error_analyze 命中错误模式；游戏运行崩溃/日志诊断用 fabric_log_debugger；' +
      'Mixin 注入目标存疑用 mixin_target_lookup 逐字核对签名；定位到文件后 read_project_file 读回原文，' +
      'edit_project_file 只改报错指向的位置。'
  },
  workflow: [
    '保留完整失败输出，按九层分类定层（toolchain→gameplay 取最早证据层）',
    '编译错取首个项目自有 error；崩溃取最深 Caused by 与首个自有栈帧',
    '显式陈述根因假设，以及一条能证伪该假设的检查（如重跑后该 error 应消失）',
    '做最小修复（含配套元数据/资源联动），不要顺手改无关代码',
    '原样重跑同一失败检查，让结果检验诊断'
  ],
  acceptanceGates: [
    '重跑同一检查通过，根因假设被证据证实才算修复成立',
    '编译通过 ≠ 玩法修复：运行期行为改动需如实标注是否已真机验证',
    '报告失败层、证据与假设结论，不省略'
  ],
  failureContract: [
    '重跑后败在同一层 = 上一假设已证伪：停止改代码，先修诊断换方向',
    '用户重复反馈同一现象 = 新失败观察：先对比被测产物与旧假设再动手，不当延续确认',
    '修复预算耗尽或假设无法证实时如实停止并说明剩余疑点，禁止假装成功'
  ]
}
