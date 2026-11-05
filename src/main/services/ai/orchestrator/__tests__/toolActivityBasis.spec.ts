/**
 * 工具活动「依据」字段测试。
 *
 * 动作（读了什么/写了什么）此前已透明，但「依据」（为什么做、依据哪些读取/检索）
 * 是黑盒。buildToolActivity 现在可携带模型本轮自述（reason）与写入前的证据链（evidence）。
 */
import { describe, expect, it } from 'vitest'
import { buildToolActivity } from '../generatePipeline'

describe('buildToolActivity：动作依据', () => {
  it('写入动作携带模型自述与证据链', () => {
    const activity = buildToolActivity(
      'call-1',
      'write_project_file',
      { relPath: 'src/main/java/com/example/ExampleBlock.java' },
      true,
      '已写入 1.2 KB',
      {
        reason: '依据已验证模板实现方块类',
        evidence: ['read_project_file src/main/java/com/example/Registry.java · 读取 120 行']
      }
    )
    expect(activity.kind).toBe('write')
    expect(activity.path).toBe('src/main/java/com/example/ExampleBlock.java')
    expect(activity.reason).toBe('依据已验证模板实现方块类')
    expect(activity.evidence).toEqual([
      'read_project_file src/main/java/com/example/Registry.java · 读取 120 行'
    ])
  })

  it('无依据时不生成空字段（保持事件负载紧凑）', () => {
    const activity = buildToolActivity('call-2', 'read_project_file', { relPath: 'a.java' }, true, 'ok')
    expect('reason' in activity).toBe(false)
    expect('evidence' in activity).toBe(false)
  })

  it('空证据数组不写入字段', () => {
    const activity = buildToolActivity('call-3', 'write_project_file', {}, true, 'ok', {
      evidence: []
    })
    expect('evidence' in activity).toBe(false)
  })
})
