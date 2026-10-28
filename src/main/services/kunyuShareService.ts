/**
 * KunYu 创作社区服务（本地创作广场）。
 * 无自有服务器：聚合本机全部项目的语义创作；作品互换走 .kyshare.json
 * 分享包（语义 JSON 单文件，贴图 pixels 内嵌于语义，导入后生成时重建 PNG）。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { listContent, loadContent, saveContent } from './contentService'
import { getAllProjects } from './projectService'
import { validateContentId, type ContentKind } from '../../shared/types/content'
import { contentDisplayName } from '../../shared/schemas/item.schema'
import {
  KY_SHARE_FORMAT,
  type CreationEntry,
  type ImportCreationResult,
  type KySharePackage,
  type SharePackagePreview
} from '../../shared/types/community'

const CONTENT_KINDS: readonly ContentKind[] = [
  'block',
  'entity',
  'item',
  'model',
  'recipe',
  'texture',
  'enchantment'
]

/** 聚合全部项目的语义创作（项目目录不可读时跳过，按更新时间倒序） */
export function listCreations(): CreationEntry[] {
  const out: CreationEntry[] = []
  for (const p of getAllProjects()) {
    if (!existsSync(p.path)) continue
    let summaries
    try {
      summaries = listContent(p.path)
    } catch {
      continue // 单个项目损坏不影响整体聚合
    }
    for (const s of summaries) {
      out.push({
        projectPath: p.path,
        projectName: p.name,
        kind: s.kind,
        id: s.id,
        displayName: s.displayName,
        filePath: s.path,
        updatedAt: s.updatedAt
      })
    }
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt)
}

/**
 * 导出单个创作为 .kyshare.json 分享包对象。
 * 自动补元数据：loader/mcVersion 来自项目元数据（项目列表未登记该路径时留空），
 * provenance 记录来源项目名；license 由用户在导出对话框选择（可选）。
 */
export function exportCreation(
  projectPath: string,
  kind: ContentKind,
  id: string,
  options?: { license?: string }
): KySharePackage {
  const def = loadContent(projectPath, kind, id)
  const project = getAllProjects().find((p) => p.path === projectPath)
  return {
    format: KY_SHARE_FORMAT,
    exportedAt: new Date().toISOString(),
    loader: project?.loader ?? undefined,
    mcVersion: project?.mcVersion || undefined,
    license: options?.license || undefined,
    provenance: project ? `导出自 KunYu 项目「${project.name}」` : undefined,
    content: def
  }
}

/** 把分享包写入磁盘（保存对话框已在 handler 层完成路径选择） */
export function writeSharePackage(filePath: string, pkg: KySharePackage): void {
  writeFileSync(filePath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8')
}

/** 读取并粗校验分享包文件（细校验由导入时 saveContent 的 schema 校验完成） */
export function readSharePackage(filePath: string): KySharePackage {
  const raw = JSON.parse(
    readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, '')
  ) as KySharePackage
  if (raw?.format !== KY_SHARE_FORMAT) {
    throw new Error('不是有效的 KunYu 分享包（format 标识不符）')
  }
  const c = raw.content
  if (!c || !CONTENT_KINDS.includes(c.kind) || !validateContentId(c.id)) {
    throw new Error('分享包内容损坏：内容类型或注册名不合法')
  }
  return raw
}

/**
 * 生成导入预览（不落盘）：提取包元数据 + 与目标项目的冲突检测，
 * 供渲染层在确认导入前醒目展示 loader/版本/许可证；旧包缺字段时字段为空。
 */
export function previewSharePackage(
  pkg: KySharePackage,
  filePath: string,
  targetProjectPath: string
): SharePackagePreview {
  const def = pkg.content
  const existing = listContent(targetProjectPath).find(
    (s) => s.kind === def.kind && s.id === def.id
  )
  return {
    status: 'preview',
    filePath,
    kind: def.kind,
    id: def.id,
    displayName: contentDisplayName(def),
    exportedAt: pkg.exportedAt,
    loader: pkg.loader,
    mcVersion: pkg.mcVersion,
    license: pkg.license,
    dependencies: pkg.dependencies,
    provenance: pkg.provenance,
    conflict: existing !== undefined,
    existingDisplayName: existing?.displayName
  }
}

/**
 * 导入分享包到目标项目。
 * - 同 kind+id 已存在且未确认覆盖 → 返回 conflict（UI 确认后以 overwrite=true 重试）；
 * - 落盘走 saveContent：schema 校验 + 归一化 + 写入，损坏包在此抛错。
 */
export function importCreation(
  pkg: KySharePackage,
  targetProjectPath: string,
  overwrite = false
): ImportCreationResult {
  const def = pkg.content
  const existing = listContent(targetProjectPath).find(
    (s) => s.kind === def.kind && s.id === def.id
  )
  if (existing && !overwrite) {
    return { status: 'conflict', kind: def.kind, id: def.id, displayName: existing.displayName }
  }
  const saved = saveContent(targetProjectPath, def)
  return { status: 'imported', kind: saved.kind, id: saved.id, displayName: saved.displayName }
}
