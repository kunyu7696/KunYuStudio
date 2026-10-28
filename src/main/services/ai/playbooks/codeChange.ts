/**
 * Playbook：代码改动与构建（工程文件读写 + Gradle 构建验证 + 失败治愈）。
 * 对应 KunYu 纪律：edit 优先于 write（增量修改）、落盘前语法校验、构建失败九层分类、
 * 零产出强制重试。
 */
import type { Playbook } from './types'

export const codeChangePlaybook: Playbook = {
  id: 'code-change',
  title: '代码改动与构建规程',
  // P7 分工：「报错/崩溃/修复」类触发词移交 build-repair playbook（诊断怎么想），
  // 本规程只管「工程改动怎么改」（edit 优先、落盘校验、构建验证），触发词不重叠。
  triggers: ['修改', '重构', '编辑', '编译', '构建', 'gradle'],
  intents: ['code'],
  route: {
    tools: [
      'project_grep',
      'read_project_file',
      'edit_project_file',
      'write_project_file',
      'todo_write',
      'gradle_build'
    ],
    note:
      '定位用 project_grep；改既有文件先 read_project_file 读回原文，再用 edit_project_file ' +
      'search+replace 原地替换（大文件严禁 write_project_file 重吐整份）；仅新建/整体重写用 write_project_file；' +
      'gradle_build 是调度工具，由编排层调用，不可由模型直调。'
  },
  workflow: [
    '超过 2 步的任务先 todo_write 列全步骤',
    'project_grep/read_project_file 定位并读回原文',
    'edit_project_file 逐处原地替换（一次一处，可连续多次）',
    '构建验证（build-pass 断言）',
    '失败按九层分类诊断后最小修复'
  ],
  acceptanceGates: [
    'build-pass 断言通过（或如实标注未验证）',
    '全部改动文件落盘前经语法/格式校验',
    // P8：资源所有权 + optional 缺载保护（落盘时 lintJavaOwnership 同步做 warn 级体检）
    '资源有 owner：静态缓存有界或有清理路径，线程/连接池有 shutdown 收口',
    'optional 依赖类不出现在类加载期即解析的位置（static 字段类型、无条件入口、Mixin 目标）'
  ],
  failureContract: [
    '构建失败如实报告失败层与日志要点，禁止零产出假装完成',
    '已正确诊断但零文件变更时强制重试一次，不提前终止'
  ]
}
