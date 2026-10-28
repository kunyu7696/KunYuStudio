/**
 * 普通问答的工程上下文组装（M7/T7.2）。
 *
 * 纯函数：输入渲染层各 store 的快照，输出一段注入 system 消息的 Markdown 上下文块。
 * 不做任何 I/O；文件内容、问题列表长度均有硬上限，避免 token 膨胀。
 */
import type { FileNode } from '../../../shared/types/fs'
import type { BuildProblem } from '../../../shared/types/build'
import { t } from '../i18n'

const MAX_FILE_CHARS = 8000
const MAX_STRUCTURE_LINES = 200
const MAX_PROBLEMS = 6
const MAX_PROBLEM_MSG = 300

export interface ProjectSnapshot {
  name: string
  type: string
  loader: string | null
  mcVersion: string
  modId: string | null
  path: string
}

export interface ActiveFileSnapshot {
  /** 绝对路径 */
  path: string
  language: string
  content: string
  dirty: boolean
}

export interface SelectionSnapshot {
  path: string
  startLine: number
  endLine: number
  text: string
}

export interface ChatContextSnapshot {
  project?: ProjectSnapshot
  activeFile?: ActiveFileSnapshot
  selection?: SelectionSnapshot
  structureRoot?: FileNode | null
  problems?: BuildProblem[]
  lastBuild?: { ok: boolean; statusText: string } | null
}

function relativize(abs: string, root: string): string {
  const norm = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '')
  const a = norm(abs)
  const r = norm(root)
  if (a === r) return '.'
  if (a.startsWith(r + '/')) return a.slice(r.length + 1)
  return a
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text
  const head = Math.floor(max * 0.7)
  const tail = max - head
  return (
    text.slice(0, head) +
    `\n\n${t('chatContext.omitted', { n: text.length - max })}\n\n` +
    text.slice(text.length - tail)
  )
}

const SKIP_DIRS = new Set([
  'build',
  '.gradle',
  'run',
  '.idea',
  'node_modules',
  '.git',
  '.vscode',
  'dist',
  'out'
])

/** 项目树 → 带缩进清单（限深度 3、跳过构建产物、限条数） */
export function renderStructure(root: FileNode): string[] {
  const lines: string[] = []
  const walk = (node: FileNode, depth: number, prefix: string): void => {
    if (lines.length >= MAX_STRUCTURE_LINES) return
    if (node !== root) {
      lines.push(`${prefix}${node.name}${node.kind === 'directory' ? '/' : ''}`)
    }
    if (node.kind !== 'directory' || depth >= 3 || !node.children) return
    const children = [...node.children]
      .filter((c) => c.kind !== 'directory' || !SKIP_DIRS.has(c.name))
      .sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1
        return a.name.localeCompare(b.name)
      })
    for (const child of children) {
      if (lines.length >= MAX_STRUCTURE_LINES) {
        lines.push(`${prefix}  …`)
        return
      }
      walk(child, depth + 1, `${prefix}  `)
    }
  }
  walk(root, 0, '')
  return lines
}

function loaderToolchainLine(p: ProjectSnapshot): string {
  switch (p.loader) {
    case 'fabric':
      return t('chatContext.toolchainFabric')
    case 'forge':
      return t('chatContext.toolchainForge')
    case 'neoforge':
      return t('chatContext.toolchainNeoforge')
    default:
      return p.type
  }
}

/**
 * 组装上下文块；任何一节为空即跳过，整体为空时返回空串（调用方不注入）。
 */
export function buildChatContextBlock(s: ChatContextSnapshot): string {
  const sections: string[] = []

  if (s.project) {
    const p = s.project
    const lines = [
      t('chatContext.lineProject', { name: p.name, path: p.path }),
      t('chatContext.lineLoaderVersion', {
        loader: p.loader ? p.loader : t('chatContext.unspecifiedLoader'),
        mc: p.mcVersion
      }),
      t('chatContext.lineToolchain', { toolchain: loaderToolchainLine(p) })
    ]
    if (p.modId) lines.push(t('chatContext.lineModId', { id: p.modId }))
    sections.push(t('chatContext.sectionProject') + '\n' + lines.join('\n'))
  }

  if (s.structureRoot && s.project) {
    const tree = renderStructure(s.structureRoot)
    if (tree.length > 0) {
      sections.push(
        t('chatContext.sectionStructure') + '\n```\n' +
          tree.join('\n') +
          '\n```'
      )
    }
  }

  if (s.selection && s.project) {
    sections.push(
      t('chatContext.sectionSelection', {
        path: relativize(s.selection.path, s.project.path),
        start: s.selection.startLine,
        end: s.selection.endLine
      }) +
        '\n```java\n' +
        clip(s.selection.text.replace(/\s+$/g, ''), 4000) +
        '\n```'
    )
  } else if (s.activeFile && s.project) {
    const f = s.activeFile
    sections.push(
      t('chatContext.sectionActiveFile', {
        path: relativize(f.path, s.project.path),
        dirty: f.dirty ? t('chatContext.dirtySuffix') : ''
      }) +
        '\n```\n' +
        clip(f.content.replace(/\s+$/g, ''), MAX_FILE_CHARS) +
        '\n```'
    )
  }

  if (s.problems && s.problems.length > 0 && s.project) {
    const errors = s.problems.filter((p) => p.severity === 'error')
    const picked = (errors.length > 0 ? errors : s.problems).slice(0, MAX_PROBLEMS)
    const body = picked
      .map((p) => {
        const pos = p.line ? `:${p.line}${p.column ? `:${p.column}` : ''}` : ''
        const loc = p.file ? `${relativize(p.file, s.project!.path)}${pos}` : t('chatContext.noFile')
        return `- [${p.severity}] ${loc} — ${p.message.slice(0, MAX_PROBLEM_MSG)}`
      })
      .join('\n')
    sections.push(t('chatContext.sectionProblems', { n: picked.length }) + `\n${body}`)
  }

  if (s.lastBuild) {
    sections.push(
      t('chatContext.sectionLastBuild') +
        '\n' +
        t('chatContext.lastBuildLine', {
          result: s.lastBuild.ok ? t('chatContext.buildOk') : t('chatContext.buildFail'),
          text: s.lastBuild.statusText
        })
    )
  }

  if (sections.length === 0) return ''
  return t('chatContext.header') + '\n\n' + sections.join('\n\n')
}
