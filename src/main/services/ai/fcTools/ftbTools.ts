/**
 * FTB 任务书 FC 工具（ftbQuestService 的 AI 封装）。
 *
 * - ftb_list_chapters / ftb_read_chapter：只读浏览 config/ftbquests/quests/chapters/ 下章节；
 * - ftb_save_chapter：整章写入（经 buildFtbQuestChapter 序列化为规范 SNBT，与解析器互逆），
 *   同名覆盖，prevId 提供重命名语义。
 * 任务类型固定 item 提交、奖励固定 item（与编辑器第一版一致）；id 合法性与路径守卫由服务层负责，
 * 工具侧捕获后软失败。
 */
import type { FtbQuest, FtbQuestChapter } from '../../../../shared/types/ftbquest'
import type { RegisteredTool, ToolRegistryDeps } from '../toolRegistry'
import { listChapters, readChapter, saveChapter } from '../../ftbQuestService'

const CLIP = 8000
function clip(text: string): string {
  return text.length <= CLIP ? text : `${text.slice(0, CLIP)}…（已截断）`
}
function asString(v: unknown): string {
  return typeof v === 'string' ? v : ''
}
function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

/** 入参 → 结构化章节（轻量结构校验；id 合法性由服务层 validateContentId 把关） */
function asChapter(raw: unknown): { chapter?: FtbQuestChapter; error?: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'chapter 必须是对象' }
  const o = raw as Record<string, unknown>
  const id = asString(o['id']).trim()
  const title = asString(o['title']).trim()
  if (!id) return { error: 'chapter.id 缺失（小写字母开头，仅小写字母/数字/下划线）' }
  if (!title) return { error: 'chapter.title 缺失' }
  const icon = asString(o['icon']).trim() || 'minecraft:book'
  const rawQuests = o['quests']
  if (!Array.isArray(rawQuests)) return { error: 'chapter.quests 必须是数组' }
  const quests: FtbQuest[] = []
  for (let i = 0; i < rawQuests.length; i++) {
    const q = rawQuests[i] as Record<string, unknown> | null
    if (!q || typeof q !== 'object' || Array.isArray(q)) return { error: `quests[${i}] 必须是对象` }
    const qid = asString(q['id']).trim()
    const qtitle = asString(q['title']).trim()
    const item = asString(q['item']).trim()
    if (!qid || !qtitle || !item) return { error: `quests[${i}] 需要 id/title/item（物品 id，如 minecraft:oak_log）` }
    const quest: FtbQuest = {
      id: qid,
      title: qtitle,
      description: asStringArray(q['description']),
      dependencies: asStringArray(q['dependencies']),
      item
    }
    const reward = q['reward']
    if (reward && typeof reward === 'object' && !Array.isArray(reward)) {
      const rItem = asString((reward as Record<string, unknown>)['item']).trim()
      const rCount = Number((reward as Record<string, unknown>)['count'])
      if (rItem) quest.reward = { item: rItem, count: Number.isFinite(rCount) && rCount > 0 ? Math.floor(rCount) : 1 }
    }
    quests.push(quest)
  }
  return { chapter: { id, title, icon, quests } }
}

export function builtinFtbTools(deps: ToolRegistryDeps): RegisteredTool[] {
  const tools: RegisteredTool[] = []

  /* ftb_list_chapters */
  tools.push({
    kind: 'chat',
    def: {
      type: 'function',
      function: {
        name: 'ftb_list_chapters',
        description:
          '列出当前项目 FTB 任务书全部章节（id/标题/图标/任务数），无法解析的文件列入警告。' +
          '改章节前先调用了解已有结构。',
        parameters: { type: 'object', properties: {}, required: [] }
      }
    },
    visibility: 'project',
    execute: () => {
      const root = deps.projectRoot?.()
      if (!root) return { ok: false, text: '', error: '当前没有打开的项目' }
      try {
        const r = listChapters(root)
        const lines = r.chapters.map((c) => `- ${c.id}「${c.title}」（${c.questCount} 个任务，图标 ${c.icon}）`)
        const warn = r.warnings.length ? `\n解析警告：\n${r.warnings.map((w) => `- ⚠️ ${w}`).join('\n')}` : ''
        const text = r.chapters.length
          ? `共 ${r.chapters.length} 个章节：\n${lines.join('\n')}${warn}`
          : '还没有章节（config/ftbquests/quests/chapters/ 为空）。'
        return { ok: true, text: clip(text), data: r }
      } catch (err) {
        return { ok: false, text: '', error: (err as Error).message }
      }
    }
  })

  /* ftb_read_chapter */
  tools.push({
    kind: 'chat',
    def: {
      type: 'function',
      function: {
        name: 'ftb_read_chapter',
        description: '读取单个章节完整 JSON（含任务明细：提交物品/描述/前置依赖/奖励）。',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string', description: '章节 id（文件名主干）' }
          },
          required: ['id']
        }
      }
    },
    visibility: 'project',
    execute: (args) => {
      const root = deps.projectRoot?.()
      if (!root) return { ok: false, text: '', error: '当前没有打开的项目' }
      const id = asString(args['id']).trim()
      if (!id) return { ok: false, text: '', error: '缺少 id 参数（章节 id）' }
      try {
        const chapter = readChapter(root, id)
        return { ok: true, text: clip(JSON.stringify(chapter, null, 2)), data: chapter }
      } catch (err) {
        return { ok: false, text: '', error: (err as Error).message }
      }
    }
  })

  /* ftb_save_chapter */
  tools.push({
    kind: 'chat',
    def: {
      type: 'function',
      function: {
        name: 'ftb_save_chapter',
        description:
          '整章写入 FTB 任务书（新建或同名覆盖），序列化为规范 SNBT 落盘。' +
          '任务为 item 提交类型；dependencies 填前置任务 id；reward 可选 { item, count }。',
        parameters: {
          type: 'object',
          properties: {
            chapter: {
              type: 'object',
              description:
                '章节对象：{ id, title, icon?, quests: [{ id, title, item, description?, dependencies?, reward? }] }'
            },
            prevId: { type: 'string', description: '重命名时的旧章节 id（可选，提供则删除旧文件）' }
          },
          required: ['chapter']
        }
      }
    },
    visibility: 'project',
    execute: (args) => {
      const root = deps.projectRoot?.()
      if (!root) return { ok: false, text: '', error: '当前没有打开的项目' }
      const parsed = asChapter(args['chapter'])
      if (!parsed.chapter) return { ok: false, text: '', error: parsed.error }
      const prevId = asString(args['prevId']).trim()
      try {
        saveChapter(root, parsed.chapter, prevId || undefined)
        const c = parsed.chapter
        return {
          ok: true,
          text: `已保存章节 ${c.id}「${c.title}」（${c.quests.length} 个任务）`,
          data: { id: c.id, questCount: c.quests.length, renamed: Boolean(prevId && prevId !== c.id) }
        }
      } catch (err) {
        return { ok: false, text: '', error: (err as Error).message }
      }
    }
  })

  return tools
}
