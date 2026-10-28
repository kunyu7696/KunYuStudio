/**
 * Playbook：性能设计前置纪律。
 *
 * performance by design：性能不是等卡顿报告
 * 再补的事后账，而是写高频路径之前的设计输入。通用化到 Java mod 生成场景：
 * - 先声明频率与规模：每 tick / 每秒 / 事件触发，随玩家/实体/区块怎么涨；
 * - 选最小实现：事件订阅优于轮询、缓存优于重算、批量优于单点；
 * - 高频路径三禁：禁 IO、禁反射、禁无界分配；
 * - 不拿玩法保真度/线程安全换跑分（红线）。
 */
import type { Playbook } from './types'

export const performanceDesignPlaybook: Playbook = {
  id: 'performance-design',
  title: '性能设计规程',
  triggers: [
    'tick',
    '事件',
    '监听',
    '定时',
    '周期',
    '轮询',
    '性能',
    '卡顿',
    'tps',
    'mspt',
    '扫描',
    '高频'
  ],
  route: {
    tools: ['project_grep', 'read_project_file', 'edit_project_file', 'fabric_javadoc_lookup'],
    note:
      '先 project_grep 找项目内已有同类高频路径的写法作基准；事件订阅签名存疑用 ' +
      'fabric_javadoc_lookup 逐字核对；改高频路径用 edit_project_file 最小替换。'
  },
  workflow: [
    '声明该路径的执行频率（每 tick/每秒/事件触发）与规模增长（玩家/实体/区块）',
    '选最小实现：事件订阅优于轮询、缓存优于重算、批量优于单点、早退优于全扫',
    '高频路径三禁：禁 IO、禁反射、禁无界分配（每 tick new 大对象 = GC 压力）',
    '写盘前 lintJavaOwnership 体检警告必须过一遍（线程/缓存有 owner）'
  ],
  acceptanceGates: [
    '高频路径在代码注释或汇报中声明了频率与代价，不是「先写上再说」',
    '线程安全未削弱：主线程数据不裸奔到异步回调',
    '未实测性能时如实标注「未做性能实测」，不宣称零开销'
  ],
  failureContract: [
    '不静默降低玩法保真度/耐久语义换性能——确需取舍时如实说明交用户定夺',
    '卡顿报告类任务先定位真实热点（timing/profiler 证据）再改，不凭直觉优化'
  ]
}
