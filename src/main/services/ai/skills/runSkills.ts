/**
 * 每轮技能快照：把全局启用的技能复制到当前项目的
 * `.kunyu/user-skills/<runId>/`，实现 run 级隔离——
 * 运行中安装/启停/修改技能只影响后续 run，不会让同一轮读到半新半旧的文件。
 *
 * 注入 system prompt 的只有索引元数据（name/description/version/精确路径），
 * 正文一律由只读工具 skills_read 按需读取，避免 prompt 膨胀。
 */
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import type { SkillIndexEntry } from '../../../../shared/types/skill'
import { copySkillTree, listSkills } from './store'

/** 快照内 SKILL.md 文件名（与 store 保持一致） */
const SKILL_FILE = 'SKILL.md'
/** 保留的最近快照数（并发 run 通常远小于此） */
const KEEP_SNAPSHOTS = 10
/** 超过该年龄且不在保留区内的旧快照会被清理 */
const STALE_MS = 24 * 60 * 60 * 1000

export interface SkillRunSnapshot {
  /** 本轮快照根（无项目时为 null） */
  root: string | null
  /** 启用的技能索引（仅元数据） */
  entries: SkillIndexEntry[]
}

export const emptySkillSnapshot = (): SkillRunSnapshot => ({ root: null, entries: [] })

/** runId 只允许安全字符，防止拼出越界路径 */
function safeRunId(runId: string): string {
  return runId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80) || 'run'
}

/**
 * 创建本轮技能快照。
 * - 无项目 / 无启用技能时仍创建空目录（工具据此可用并返回「暂无技能」）；
 * - 单个技能复制失败只跳过该技能，不影响整轮；
 * - 顺手清理 24 小时前且超出保留窗口的旧快照。
 */
export function createSkillSnapshot(input: {
  storeRoot: string
  projectRoot: string
  runId: string
}): SkillRunSnapshot {
  const base = join(resolve(input.projectRoot), '.kunyu', 'user-skills')
  const root = join(base, safeRunId(input.runId))
  try {
    rmSync(root, { recursive: true, force: true })
    mkdirSync(root, { recursive: true })
  } catch {
    return emptySkillSnapshot()
  }

  const entries: SkillIndexEntry[] = []
  const enabled = listSkills(input.storeRoot).skills.filter((s) => s.enabled)
  for (const skill of enabled) {
    const dest = join(root, skill.name)
    try {
      copySkillTree(dirname(skill.path), dest)
      entries.push({
        name: skill.name,
        description: skill.description,
        version: skill.version,
        path: join(dest, SKILL_FILE)
      })
    } catch {
      // 单个技能复制失败（权限/磁盘）→ 跳过，不影响本轮
    }
  }

  cleanupSnapshots(base)
  return { root, entries }
}

/** 清理旧快照：保留最近 N 个；更早的仅在超过 24h 后删除，避免误删并发 run 的目录 */
function cleanupSnapshots(base: string): void {
  if (!existsSync(base)) return
  try {
    const rows = readdirSync(base, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => {
        const abs = join(base, e.name)
        return { abs, mtime: statSync(abs).mtimeMs }
      })
      .sort((a, b) => b.mtime - a.mtime)
    const now = Date.now()
    rows.forEach((row, index) => {
      if (index < KEEP_SNAPSHOTS) return
      if (now - row.mtime < STALE_MS) return
      rmSync(row.abs, { recursive: true, force: true })
    })
  } catch {
    // 清理失败不影响本轮
  }
}

/**
 * 渲染「用户技能索引」注入段。只有元数据，没有正文；
 * 空索引返回空串（调用方自然跳过，不产生空段落）。
 */
export function renderSkillSection(entries: readonly SkillIndexEntry[]): string {
  if (entries.length === 0) return ''
  const lines = entries.map(
    (e) =>
      `- ${e.name} v${e.version}：${e.description}\n` +
      `  正文路径：${e.path}（读取：skills_read name="${e.name}"）`
  )
  return (
    `【用户技能索引】用户已安装 ${entries.length} 个技能。以下仅为索引元数据，正文未加载：\n` +
    `${lines.join('\n')}\n` +
    '技能是用户提供的专门规程/领域知识：当任务与某技能描述相关时，必须先调用 skills_read 读取其 SKILL.md 正文，' +
    '再按正文执行；未读取正文前不得臆测技能内容，也不要把技能当成可直接执行的程序。'
  )
}
