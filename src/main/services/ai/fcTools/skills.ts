/**
 * 用户技能包只读工具（skills_list / skills_read）。
 *
 * 边界：
 * - 只读本轮 run 快照（`.kunyu/user-skills/<runId>/`），不读全局安装目录；
 * - 模型无法通过工具安装/启停/删除技能，这些只能由用户在设置页操作；
 * - 单次正文读取 ≤256 KiB（store 内硬限），且只允许文本类附件；
 * - 无项目上下文时工具不可见（与 memory/content 工具一致）。
 */
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { SkillIndexEntry } from '../../../../shared/types/skill'
import { SKILL_NAME_PATTERN } from '../../../../shared/types/skill'
import type { RegisteredTool, ToolRegistryDeps } from '../toolRegistry'
import { inspectSkillDir, readSkillFile } from '../skills/store'

function asString(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

/** 扫描快照目录，返回可用于索引的技能元数据（坏目录静默跳过） */
export function listSnapshotSkills(snapshotRoot: string): SkillIndexEntry[] {
  if (!existsSync(snapshotRoot)) return []
  const out: SkillIndexEntry[] = []
  try {
    for (const ent of readdirSync(snapshotRoot, { withFileTypes: true })) {
      if (!ent.isDirectory() || ent.isSymbolicLink()) continue
      try {
        const info = inspectSkillDir(join(snapshotRoot, ent.name))
        out.push({
          name: info.name,
          description: info.description,
          version: info.version,
          path: info.path
        })
      } catch {
        // 快照内坏目录（不应出现）→ 跳过
      }
    }
  } catch {
    return []
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

export function builtinSkillTools(deps: ToolRegistryDeps): RegisteredTool[] {
  const snapshotRoot = (): string | null => deps.skillsDir?.() ?? null

  return [
    {
      kind: 'chat',
      def: {
        type: 'function',
        function: {
          name: 'skills_list',
          description:
            '列出本轮启用的用户技能索引（name/description/version）。' +
            '这里只有元数据，没有正文；任务与某技能描述相关时，用 skills_read 读取其 SKILL.md 正文后再执行。',
          parameters: { type: 'object', properties: {} }
        }
      },
      visibility: 'project',
      execute: () => {
        const root = snapshotRoot()
        if (!root) return { ok: false, text: '', error: '本轮技能快照不可用（无项目或环境不支持）' }
        const entries = listSnapshotSkills(root)
        if (entries.length === 0) {
          return {
            ok: true,
            text: '本轮没有启用任何用户技能。技能由用户在「设置 → AI 助手 → 技能」中安装并启用。',
            data: { skills: [] }
          }
        }
        const text = entries
          .map((e) => `- ${e.name} v${e.version}：${e.description}`)
          .join('\n')
        return {
          ok: true,
          text: `本轮启用 ${entries.length} 个用户技能：\n${text}\n需要正文时调用 skills_read（name 取上列技能名）。`,
          data: { skills: entries }
        }
      }
    },
    {
      kind: 'chat',
      def: {
        type: 'function',
        function: {
          name: 'skills_read',
          description:
            '读取本轮启用的某个用户技能正文（默认 SKILL.md），用于按用户提供的专门规程执行任务。' +
            '单次读取上限 256 KiB，仅支持文本类附件。不要凭索引描述臆测正文内容。',
          parameters: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                description: '技能名（skills_list 返回的 name，如 my-skill）'
              },
              file: {
                type: 'string',
                description: '技能包内相对路径，默认 SKILL.md；附件如 references/style.md'
              }
            },
            required: ['name']
          }
        }
      },
      visibility: 'project',
      execute: (args) => {
        const root = snapshotRoot()
        if (!root) return { ok: false, text: '', error: '本轮技能快照不可用（无项目或环境不支持）' }
        const name = asString(args['name']).trim()
        if (!name || !SKILL_NAME_PATTERN.test(name)) {
          return { ok: false, text: '', error: `非法的技能名：${name || '(空)'}` }
        }
        const entries = listSnapshotSkills(root)
        if (!entries.some((e) => e.name === name)) {
          return {
            ok: false,
            text: '',
            error: `本轮未启用技能「${name}」，可先调用 skills_list 查看可用技能`
          }
        }
        const file = asString(args['file']).trim() || 'SKILL.md'
        const res = readSkillFile(root, name, file)
        if (!res.ok) return { ok: false, text: '', error: res.error }
        return {
          ok: true,
          text: res.text,
          data: { name, file, path: res.path, chars: res.text.length }
        }
      }
    }
  ]
}
