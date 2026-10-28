/**
 * Playbook：游戏内验证（kunyu-observer 真机验证 + 无头 GameTest + 场景断言）。
 * 对应 KunYu 纪律：INCONCLUSIVE 显式化——验证证据不足时如实呈现未验证，
 * 禁止把未验证说成已验证；验证结束清理测试世界。
 */
import type { Playbook } from './types'

export const gameTestPlaybook: Playbook = {
  id: 'game-test',
  title: '游戏内验证规程',
  triggers: ['游戏内', '进游戏', '截图', '实测', '验证', '启动游戏', 'gametest', '刷怪', '召唤'],
  intents: ['verify'],
  route: {
    tools: [
      'mc_launch',
      'mc_state',
      'mc_ensure_test_world',
      'mc_world',
      'mc_command',
      'mc_input',
      'mc_observe_entity',
      'mc_inventory',
      'mc_screenshot',
      'mc_cleanup_test_world',
      'run_game_test',
      'mc_test_scenario',
      'fabric_log_debugger'
    ],
    note:
      'observer 在线时 mc_* 直连游戏验证；无头预跑 run_game_test；场景断言 mc_test_scenario；' +
      '崩溃/异常日志诊断 fabric_log_debugger；observer 不可达 → 声明未验证，不假装实测。'
  },
  workflow: [
    'mc_launch / mc_ensure_test_world 准备验证环境',
    'mc_observe_entity/mc_world/mc_screenshot/mc_input 执行观察与操作',
    '按断言判定（runtime-world / runtime-inventory / gametest-runtime）',
    'mc_cleanup_test_world 清理测试世界'
  ],
  acceptanceGates: [
    '结论基于真机证据（截图/世界状态/背包/GameTest 报告）',
    'user-confirmation 类视觉效果挂真机截图交由用户人工确认'
  ],
  failureContract: [
    '观察端不可达或证据不足 → 判定 INCONCLUSIVE 显式呈现，禁止把未验证说成已验证',
    '验证结束清理测试世界，不残留状态影响下次验证'
  ]
}
