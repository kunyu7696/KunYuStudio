import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import AgentTrack from '../AgentTrack.vue'
import { useAiAgentsStore } from '../../../stores/aiAgents'

/**
 * 流水线轨道可视化契约：
 * - 始终渲染五个阶段节点（理解/生成/构建/测试/导出）
 * - 无外框、无详情展开区、无工作流日志（日志在消息气泡内展示）
 * - idleWhenStopped（AI 助手面板）：无任务在跑时复位为「待命」，不留上一轮亮灯
 */
function mountTrack(props: { idleWhenStopped?: boolean } = {}) {
  return mount(AgentTrack, {
    props,
    global: { plugins: [ElementPlus] }
  })
}

describe('AgentTrack 流水线轨道', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('渲染五个阶段节点', () => {
    const w = mountTrack()
    const nodes = w.findAll('.at-node')
    expect(nodes).toHaveLength(5)
    expect(nodes.map((n) => n.find('.at-name').text())).toEqual([
      '理解',
      '生成',
      '构建',
      '测试',
      '导出'
    ])
  })

  it('仅渲染五节点，无外框/详情/工作流日志区', () => {
    const w = mountTrack()
    expect(w.find('.at-detail').exists()).toBe(false)
    expect(w.find('.at-flow').exists()).toBe(false)
    expect(w.findAll('.at-node')).toHaveLength(5)
  })

  /** 造出「上一轮跑完」的终态：五阶段全部完成 */
  function sealAllStagesDone(): void {
    const agents = useAiAgentsStore()
    agents.stages.forEach((s) => {
      s.phase = 'done'
      s.action = '完成'
    })
  }

  it('idleWhenStopped：无任务在跑时复位为待命，不留上一轮亮灯', async () => {
    const agents = useAiAgentsStore()
    agents.running = true
    sealAllStagesDone()
    const w = mountTrack({ idleWhenStopped: true })
    // 运行中：按真实阶段展示（全 done）
    expect(w.findAll('.at-node.is-done')).toHaveLength(5)
    expect(w.findAll('.at-link.is-done')).toHaveLength(4)

    // 任务结束：轨道回待命，连线也熄灭
    agents.running = false
    await w.vm.$nextTick()
    expect(w.findAll('.at-node.is-done')).toHaveLength(0)
    expect(w.findAll('.at-node.is-waiting')).toHaveLength(5)
    expect(w.findAll('.at-link.is-waiting')).toHaveLength(4)
    expect(w.findAll('.at-link.is-done')).toHaveLength(0)
  })

  it('默认（AI 制作页）：任务结束后仍保留上一轮阶段终态', async () => {
    const agents = useAiAgentsStore()
    agents.running = true
    sealAllStagesDone()
    const w = mountTrack()
    agents.running = false
    await w.vm.$nextTick()
    expect(w.findAll('.at-node.is-done')).toHaveLength(5)
  })
})
