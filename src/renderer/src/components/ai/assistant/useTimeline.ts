import { computed, ref } from 'vue'
import { useAiAgentsStore } from '../../../stores/aiAgents'
import type { AgentTimelineTool } from '../../../stores/aiAgents'
import {
  View,
  EditPen,
  Search,
  SetUp,
  Monitor,
  Picture,
  DataAnalysis,
  Tools,
  Connection
} from '@element-plus/icons-vue'
import { t } from '../../../i18n'

type ToolGroup = 'read' | 'write' | 'search' | 'command' | 'asset' | 'game' | 'analyze'

/** 工具分组与图标（未登记的工具归入 analyze「分析」）；verbKey 对应 assistant.timeline.tool.*，在 metaOf 调用点求值 */
const TOOL_META: Record<string, { group: ToolGroup; icon: unknown; verbKey: string }> = {
  content_read: { group: 'read', icon: View, verbKey: 'readFile' },
  content_list: { group: 'read', icon: View, verbKey: 'listFile' },
  content_upsert: { group: 'write', icon: EditPen, verbKey: 'writeFile' },
  read_project_file: { group: 'read', icon: View, verbKey: 'readFile' },
  write_project_file: { group: 'write', icon: EditPen, verbKey: 'writeFile' },
  project_grep: { group: 'search', icon: Search, verbKey: 'searchFile' },
  kb_search: { group: 'search', icon: Search, verbKey: 'kbSearch' },
  template_search: { group: 'search', icon: Search, verbKey: 'templateSearch' },
  mc_data_lookup: { group: 'search', icon: Search, verbKey: 'mcDataLookup' },
  web_fetch: { group: 'search', icon: Search, verbKey: 'webFetch' },
  gradle_build: { group: 'command', icon: SetUp, verbKey: 'gradleBuild' },
  mc_command: { group: 'command', icon: Monitor, verbKey: 'mcCommand' },
  texture_paint: { group: 'asset', icon: Picture, verbKey: 'texturePaint' },
  texture_pixelize: { group: 'asset', icon: Picture, verbKey: 'texturePixelize' },
  texture_repaint: { group: 'asset', icon: Picture, verbKey: 'textureRepaint' },
  model_validate: { group: 'asset', icon: Picture, verbKey: 'modelValidate' },
  item_validate: { group: 'asset', icon: Picture, verbKey: 'itemValidate' },
  mc_state: { group: 'game', icon: Monitor, verbKey: 'mcState' },
  mc_screenshot: { group: 'game', icon: Monitor, verbKey: 'mcScreenshot' },
  mc_chat: { group: 'game', icon: Monitor, verbKey: 'mcChat' },
  mc_world: { group: 'game', icon: Monitor, verbKey: 'mcWorld' },
  mc_observe_entity: { group: 'game', icon: Monitor, verbKey: 'mcObserveEntity' },
  mc_inventory: { group: 'game', icon: Monitor, verbKey: 'mcInventory' },
  mc_input: { group: 'game', icon: Monitor, verbKey: 'mcInput' },
  mc_ensure_test_world: { group: 'game', icon: Monitor, verbKey: 'mcEnsureTestWorld' },
  error_analyze: { group: 'analyze', icon: DataAnalysis, verbKey: 'errorAnalyze' },
  version_check: { group: 'analyze', icon: DataAnalysis, verbKey: 'versionCheck' },
  api_validate: { group: 'analyze', icon: DataAnalysis, verbKey: 'apiValidate' },
  agent_delegate: { group: 'analyze', icon: Connection, verbKey: 'agentDelegate' },
  agent_delegate_batch: { group: 'analyze', icon: Connection, verbKey: 'agentDelegateBatch' }
}

const GROUP_ORDER: ToolGroup[] = ['read', 'write', 'search', 'command', 'asset', 'game', 'analyze']

const GROUP_SUMMARY: Record<ToolGroup, (n: number) => string> = {
  read: (n) => t('assistant.timeline.sumRead', { n }),
  write: (n) => t('assistant.timeline.sumWrite', { n }),
  search: (n) => t('assistant.timeline.sumSearch', { n }),
  command: (n) => t('assistant.timeline.sumCommand', { n }),
  asset: (n) => t('assistant.timeline.sumAsset', { n }),
  game: (n) => t('assistant.timeline.sumGame', { n }),
  analyze: (n) => t('assistant.timeline.sumAnalyze', { n })
}

/** 子代理嵌套段：一次委派的完整过程（任务标题 + 内部工具活动 + 结论摘要） */
export interface SubAgentSegment {
  kind: 'subagent'
  key: string
  /** 委派调用 id（主代理 agent_delegate 的 callId） */
  callId: string
  /** 子任务标题（取首个活动携带的 subAgentTask；批模式下各子任务各自成段） */
  task: string
  /** 委派工具名（agent_delegate / agent_delegate_batch） */
  tool: string
  /** 子代理内部工具活动（按到达顺序） */
  items: AgentTimelineTool[]
  /** 委派本身的结果（主代理 tool-activity 回填的结论首行） */
  ok?: boolean
  resultSummary?: string
  stage: AgentTimelineTool['stage']
  at: string
}

export type TimelineSegment =
  | { kind: 'tools'; key: string; items: AgentTimelineTool[] }
  | { kind: 'log'; key: string; text: string }
  | SubAgentSegment

export function metaOf(tool: string): { group: ToolGroup; icon: unknown; verb: string } {
  const meta = TOOL_META[tool]
  if (!meta) return { group: 'analyze', icon: Tools, verb: tool }
  return { group: meta.group, icon: meta.icon, verb: t(`assistant.timeline.tool.${meta.verbKey}`) }
}

/** 从工具参数 JSON 中提取最能代表本次调用的目标（路径/查询词/命令） */
export function toolTarget(item: AgentTimelineTool): string {
  try {
    const args = JSON.parse(item.body) as Record<string, unknown>
    const keys = ['relPath', 'path', 'filePath', 'file', 'query', 'pattern', 'command', 'task', 'name']
    for (const k of keys) {
      const v = args[k]
      if (typeof v === 'string' && v.trim()) return v
    }
  } catch {
    /* 非 JSON 参数，走原文兜底 */
  }
  return item.body.length > 120 ? item.body.slice(0, 120) + '…' : item.body
}

/** 路径类目标拆成目录 + 文件名（目录灰色、文件名高亮）；目录过长省略前部 */
export function pathParts(target: string): { head: string; name: string } | null {
  const i = target.lastIndexOf('/')
  if (i <= 0) return null
  let head = target.slice(0, i + 1)
  if (head.length > 24) head = '…/' + head.slice(-24)
  return { head, name: target.slice(i + 1) }
}

/** 一段工具调用的聚合摘要，如「已写入 1 个文件，执行 1 条命令」 */
export function segmentSummary(items: AgentTimelineTool[]): string {
  const counts = new Map<ToolGroup, number>()
  for (const it of items) {
    const g = metaOf(it.tool).group
    counts.set(g, (counts.get(g) ?? 0) + 1)
  }
  return GROUP_ORDER.filter((g) => counts.has(g))
    .map((g) => GROUP_SUMMARY[g](counts.get(g)!))
    .join(t('assistant.timeline.sumJoin'))
}

export function useTimeline() {
  const agents = useAiAgentsStore()

  /**
   * 连续的工具调用聚合成一段（中间被日志打断则另起一段），日志各自独立成段。
   * M3：子代理内部活动（subAgent=true）从平铺流抽出，按 parentCallId 聚成
   * subagent 嵌套段；委派工具调用（agent_delegate）本身不重复出现——其占位
   * 由嵌套段替代（结果回填后标题/结论同步更新）。
   */
  const timelineSegments = computed<TimelineSegment[]>(() => {
    const subAgentTaskFallback = t('assistant.timeline.subAgentTask')
    const segs: TimelineSegment[] = []
    let buf: AgentTimelineTool[] = []
    let seq = 0
    const flush = (): void => {
      if (buf.length) {
        segs.push({ kind: 'tools', key: `t-${seq++}`, items: buf })
        buf = []
      }
    }
    /** parentCallId → 嵌套段（首次出现时建段，后续活动追加） */
    const subSegByParent = new Map<string, SubAgentSegment>()
    /** 委派调用 id → 主代理占位卡片（可能先于子活动到达） */
    const delegateCard = new Map<string, AgentTimelineTool>()

    for (const item of agents.timeline) {
      if (item.kind === 'log') {
        flush()
        segs.push({ kind: 'log', key: `l-${seq++}`, text: item.text })
        continue
      }
      if (item.subAgent && item.parentCallId) {
        flush()
        let seg = subSegByParent.get(item.parentCallId)
        if (!seg) {
          seg = {
            kind: 'subagent',
            key: `sa-${seq++}`,
            callId: item.parentCallId,
            task: item.subAgentTask ?? subAgentTaskFallback,
            tool: 'agent_delegate',
            items: [],
            stage: item.stage,
            at: item.at
          }
          subSegByParent.set(item.parentCallId, seg)
          segs.push(seg)
        }
        seg.items.push(item)
        if (item.subAgentTask && seg.task === subAgentTaskFallback) seg.task = item.subAgentTask
        // 批模式：不同子任务各自成段更清晰——但段已按 parentCallId 聚合；
        // 多任务共存时按 task 拆段（同 callId 下多 task 时后到的另立段）
        continue
      }
      // 主代理委派卡片：登记后不直接进平铺流（等子活动到达时由嵌套段替代；
      // 若子代理静默执行无任何活动上报，则平铺展示该卡片兜底）
      if (item.tool === 'agent_delegate' || item.tool === 'agent_delegate_batch') {
        flush()
        delegateCard.set(item.id.replace(/^tool-/, ''), item)
        // 先平铺占位；子活动到达时本卡片已入 segs，届时被替换为嵌套段
        segs.push({ kind: 'tools', key: `t-${seq++}`, items: [item] })
        continue
      }
      buf.push(item)
    }
    flush()

    // 后处理：把「委派占位段」与「子代理嵌套段」合并——
    // 若某委派已有嵌套段，删除其平铺占位，并把委派结果回填进嵌套段
    const result: TimelineSegment[] = []
    for (const seg of segs) {
      if (seg.kind === 'tools' && seg.items.length === 1) {
        const only = seg.items[0]!
        if (only.tool === 'agent_delegate' || only.tool === 'agent_delegate_batch') {
          const callId = only.id.replace(/^tool-/, '')
          const nested = subSegByParent.get(callId)
          if (nested) {
            nested.ok = only.ok
            nested.resultSummary = only.resultSummary
            nested.tool = only.tool
            // 嵌套段已在结果流中（按首个子活动位置）；跳过平铺占位
            continue
          }
        }
      }
      result.push(seg)
    }
    return result
  })

  /** 工具组折叠状态（key 为段 key），默认折叠，与示例图一致 */
  const toolSegOpen = ref<Record<string, boolean>>({})
  function toggleSeg(key: string): void {
    toolSegOpen.value[key] = !toolSegOpen.value[key]
  }

  return {
    timelineSegments,
    toolSegOpen,
    toggleSeg
  }
}
