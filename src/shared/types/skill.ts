/**
 * 用户技能包（Agent Skills）共享类型与限额。
 *
 * 格式沿用 Agent Skills 标准 `SKILL.md`：
 *   ---
 *   name: my-skill            # 1-64 位小写字母/数字/单连字符
 *   description: ...          # 1-1024 字符
 *   version: 1.0.0            # 可选
 *   ---
 *   正文（非空）
 *
 * 技能包是目录，可携带 references/scripts/assets 等附加文件；
 * 主进程只负责安装、扫描与按需读取，绝不执行其中的脚本。
 */

/** 安全限额：拒绝符号链接/特殊文件后仍限制体积，防止扫描拖垮主进程 */
export const SKILL_LIMITS = {
  /** 单个 SKILL.md 上限 */
  maxSkillFileBytes: 256 * 1024,
  /** 单个技能包目录最多文件/目录项数 */
  maxDirEntries: 1000,
  /** 单个技能包目录总字节上限 */
  maxDirBytes: 64 * 1024 * 1024,
  /** 单次正文读取上限 */
  maxReadBytes: 256 * 1024
} as const

/** Agent Skills name 规范：小写字母/数字，单连字符分隔 */
export const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** 技能来源（导入方式）：单文件 / 整目录 */
export type SkillSource = 'file' | 'directory'

/** 技能扫描后的元数据（不含正文） */
export interface SkillMeta {
  /** frontmatter name */
  name: string
  /** frontmatter description */
  description: string
  /** frontmatter version（缺省为 '0.0.0'） */
  version: string
  /** 是否启用（禁用项不会注入也不复制进 run 快照） */
  enabled: boolean
  /** 导入方式 */
  source: SkillSource
  /** 磁盘目录名（全局技能根下的一级目录） */
  dirName: string
  /** SKILL.md 绝对路径 */
  path: string
  /** 目录总字节数 */
  sizeBytes: number
  /** 目录项数（文件 + 子目录） */
  entryCount: number
  /** 目录最近修改时间 ISO */
  updatedAt: string
}

/** 被拒绝的技能包（扫描期问题，不阻塞其它技能） */
export interface SkillIssue {
  dirName: string
  message: string
}

export interface SkillListResult {
  /** 全局技能根（用户可「打开目录」） */
  root: string
  skills: SkillMeta[]
  issues: SkillIssue[]
}

/** 注入 system prompt 的索引项：只含元数据，不含正文 */
export interface SkillIndexEntry {
  name: string
  description: string
  version: string
  /** 本轮快照内 SKILL.md 的绝对路径（skills_read 的精确目标） */
  path: string
}

/** 技能安装/删除等操作结果（软失败，IPC 不抛异常） */
export interface SkillMutationResult {
  ok: boolean
  /** 操作的技能名（导入成功时返回） */
  name?: string
  error?: string
}
