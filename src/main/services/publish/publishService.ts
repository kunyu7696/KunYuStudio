/**
 * 整合包发布服务（M18）：直发 Modrinth / CurseForge。
 *
 * 纯函数 + 依赖注入：不 import settingsService，token/projectId 由 handler 注入。
 * - Modrinth：POST /v2/version（multipart：data JSON 字段 + file zip），裸 token Authorization 头
 * - CurseForge：POST minecraft.curseforge.com/api/projects/{id}/upload-file（X-Api-Token 头），
 *   官方域名直连，不走 MCIM 镜像
 * - zip 魔数校验（PK\x03\x04）+ 大于 512MB 拒绝
 *
 * 语义分层：release（本地导出产物）≠ publish（远端发布）。
 * 产物存在于 dist/ 只说明 release 完成；publish 前必须过 runPublishPreflight 逐项门——
 * 产物合法 + 版本号/标题/changelog/MC 版本/加载器元数据完整，任何一项不过都不触碰网络，
 * 避免「MR 已上传才发现 CF 产物损坏」之类的半成品发布状态。
 */
import { closeSync, openSync, readFileSync, readSync, statSync } from 'node:fs'
import { basename } from 'node:path'
import { HttpUtilError, httpGetJson, httpPostMultipart } from '../httpUtil'
import { matchCfGameVersions, type CfGameVersion } from './cfVersions'

const MR_API = 'https://api.modrinth.com/v2'
const CF_API = 'https://minecraft.curseforge.com/api'
const MAX_ZIP_BYTES = 512 * 1024 * 1024
/** 版本号：x.y.z，可带 -beta.1 / +build 后缀（Modrinth version_number 约定） */
const VERSION_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/
/** MC 版本：1.20 / 1.20.1 形态 */
const MC_VERSION_RE = /^\d+\.\d+(\.\d+)?$/
const KNOWN_LOADERS = ['fabric', 'forge', 'neoforge', 'quilt']

export type PublishPlatform = 'modrinth' | 'curseforge'
export type ReleaseType = 'release' | 'beta' | 'alpha'

export interface PublishInput {
  /** Modrinth 产物（.mrpack）路径 */
  zipPath: string
  /** CurseForge 产物（-cf.zip）路径（P0-6：CF 绝不能上传 .mrpack，其故意不含 manifest.json） */
  cfZipPath?: string
  /** 版本号（如 1.0.0） */
  versionNumber: string
  /** 版本标题 */
  title: string
  /** 更新日志（markdown） */
  changelog: string
  releaseType: ReleaseType
  /** MC 版本（如 1.20.1） */
  mcVersion: string
  /** 加载器（fabric/forge/neoforge/quilt） */
  loader: string
}

export interface PublishResultEntry {
  platform: PublishPlatform
  ok: boolean
  /** 成功时的版本页链接 */
  url?: string
  error?: string
}

/** 读取 zip 并做魔数/大小校验；返回文件字节 */
function readZipChecked(zipPath: string): Buffer {
  let size: number
  try {
    size = statSync(zipPath).size
  } catch {
    throw new Error(`找不到整合包 zip：${zipPath}`)
  }
  if (size > MAX_ZIP_BYTES) {
    throw new Error(`zip 超过 512MB 上限（实际 ${(size / 1024 / 1024).toFixed(1)}MB），请精简内容后再发布`)
  }
  const buf = readFileSync(zipPath)
  // zip 魔数 PK\x03\x04（空 zip 为 PK\x05\x06，同样允许）
  if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) {
    throw new Error('文件不是合法的 zip（缺少 PK 魔数），请先执行「导出整合包」')
  }
  return buf
}

function toErrMsg(err: unknown): string {
  if (err instanceof HttpUtilError) {
    if (err.code === 'timeout') return '请求超时，请检查网络或稍后重试'
    if (err.code === 'network') return err.message
    return `平台返回错误：${err.message}`
  }
  return err instanceof Error ? err.message : String(err)
}

/* ---------------- 发布预检门（P0③） ---------------- */

/** 单项预检结论（结构对齐验收面板：逐项可溯源） */
export interface PublishPreflightCheck {
  id: string
  label: string
  ok: boolean
  /** 失败原因（ok=true 时缺省） */
  detail?: string
}

export interface PublishPreflightResult {
  /** 全部检查通过才为 true */
  ready: boolean
  checks: PublishPreflightCheck[]
}

/**
 * 产物轻量探测：存在性 + 大小上限 + PK 魔数（只读前 2 字节，
 * 不像 readZipChecked 那样整份读入——预检要便宜，上传时才全量加载）。
 */
function probeZip(zipPath: string): { ok: boolean; detail?: string } {
  let size: number
  try {
    size = statSync(zipPath).size
  } catch {
    return { ok: false, detail: `找不到产物文件：${zipPath}` }
  }
  if (size > MAX_ZIP_BYTES) {
    return { ok: false, detail: `zip 超过 512MB 上限（实际 ${(size / 1024 / 1024).toFixed(1)}MB）` }
  }
  try {
    const fd = openSync(zipPath, 'r')
    const head = Buffer.alloc(2)
    readSync(fd, head, 0, 2, 0)
    closeSync(fd)
    if (head[0] !== 0x50 || head[1] !== 0x4b) {
      return { ok: false, detail: '不是合法的 zip（缺少 PK 魔数），请先执行「组装并导出」' }
    }
  } catch {
    return { ok: false, detail: '产物文件不可读' }
  }
  return { ok: true }
}

/**
 * 发布预检门：直发 Modrinth/CF 前的逐项检查（纯同步、不触碰网络）。
 * 只查「产物 + 元数据」这些全局阻塞项；平台 token/projectId 缺失维持
 * publishModpack 的部分失败语义（未配置的平台单独报错，不阻断另一平台）。
 */
export function runPublishPreflight(
  input: PublishInput,
  platforms: PublishPlatform[]
): PublishPreflightResult {
  const checks: PublishPreflightCheck[] = []
  const push = (id: string, label: string, ok: boolean, detail?: string): void => {
    checks.push(detail ? { id, label, ok, detail } : { id, label, ok })
  }

  const version = input.versionNumber.trim()
  const versionOk = VERSION_RE.test(version)
  push(
    'version',
    '版本号',
    versionOk,
    versionOk ? undefined : `「${version || '(空)'}」需为 x.y.z 格式（如 1.0.0，可带 -beta.1/+build 后缀）`
  )

  const titleOk = input.title.trim().length > 0
  push('title', '版本标题', titleOk, titleOk ? undefined : '标题为空，平台版本页无法展示')

  const changelogOk = input.changelog.trim().length > 0
  push(
    'changelog',
    '更新日志',
    changelogOk,
    changelogOk ? undefined : 'changelog 为空——发布页必须向用户说明本版变更'
  )

  const mcOk = MC_VERSION_RE.test(input.mcVersion.trim())
  push(
    'mc-version',
    'MC 版本',
    mcOk,
    mcOk ? undefined : `「${input.mcVersion.trim() || '(空)'}」需为 1.20 / 1.20.1 形态`
  )

  const loader = input.loader.trim().toLowerCase()
  const loaderOk = KNOWN_LOADERS.includes(loader)
  push(
    'loader',
    '加载器',
    loaderOk,
    loaderOk ? undefined : `「${input.loader.trim() || '(空)'}」非已知加载器（${KNOWN_LOADERS.join('/')}）`
  )

  // 产物按勾选平台逐项探测（与上传时的选文件逻辑对齐：CF 用 cfZipPath 回退 zipPath）
  if (platforms.includes('modrinth')) {
    const r = probeZip(input.zipPath)
    push('artifact-modrinth', 'Modrinth 产物（.mrpack）', r.ok, r.detail)
  }
  if (platforms.includes('curseforge')) {
    const r = probeZip(input.cfZipPath || input.zipPath)
    push('artifact-curseforge', 'CurseForge 产物（-cf.zip）', r.ok, r.detail)
  }

  return { ready: checks.every((c) => c.ok), checks }
}

/** 发布到 Modrinth：创建 version 并上传 zip */
export async function publishToModrinth(
  input: PublishInput,
  auth: { token: string; projectId: string }
): Promise<string> {
  const zip = readZipChecked(input.zipPath)
  const data = {
    name: input.title,
    version_number: input.versionNumber,
    changelog: input.changelog,
    game_versions: [input.mcVersion],
    version_type: input.releaseType,
    loaders: [input.loader.toLowerCase()],
    featured: false,
    project_id: auth.projectId,
    file_parts: ['file'],
    primary_file: 'file'
  }
  const res = await httpPostMultipart<{ id?: string }>(`${MR_API}/version`, {
    headers: { Authorization: auth.token },
    fields: {
      data: JSON.stringify(data),
      file: {
        data: zip,
        filename: basename(input.zipPath),
        contentType: 'application/zip'
      }
    }
  })
  const versionId = res.data?.id
  return versionId
    ? `https://modrinth.com/project/${auth.projectId}/version/${versionId}`
    : `https://modrinth.com/project/${auth.projectId}/versions`
}

/* ---------------- CurseForge ---------------- */

/** gameVersions 进程内缓存（10 分钟） */
let cfVersionsCache: { at: number; list: CfGameVersion[] } | null = null
const CF_CACHE_TTL = 10 * 60 * 1000

/** 拉取 CF 全量 gameVersions（带 10 分钟进程缓存） */
export async function listCfGameVersions(token: string): Promise<CfGameVersion[]> {
  if (cfVersionsCache && Date.now() - cfVersionsCache.at < CF_CACHE_TTL) {
    return cfVersionsCache.list
  }
  const res = await httpGetJson<CfGameVersion[]>(`${CF_API}/game/versions`, {
    headers: { 'X-Api-Token': token }
  })
  const list = Array.isArray(res.data) ? res.data : []
  cfVersionsCache = { at: Date.now(), list }
  return list
}

/** 测试专用：清空缓存 */
export function __resetCfVersionsCache(): void {
  cfVersionsCache = null
}

/**
 * 预检：解析 CF gameVersions 是否覆盖当前 MC 版本 + 加载器。
 * 匹配失败返回 suggestions 供人工选择（不猜测）。
 */
export async function preflightCurseForge(
  token: string,
  mcVersion: string,
  loader: string
): Promise<{ ready: boolean; gameVersionIds: number[]; suggestions: string[] }> {
  const all = await listCfGameVersions(token)
  const match = matchCfGameVersions(all, mcVersion, loader)
  if (!match.mcVersion || !match.loader) {
    return { ready: false, gameVersionIds: [], suggestions: match.suggestions }
  }
  return {
    ready: true,
    gameVersionIds: [match.mcVersion.id, match.loader.id],
    suggestions: []
  }
}

/** 发布到 CurseForge：upload-file（multipart：metadata JSON 字段 + file zip） */
export async function publishToCurseForge(
  input: PublishInput,
  auth: { token: string; projectId: string }
): Promise<string> {
  const zip = readZipChecked(input.zipPath)
  const pre = await preflightCurseForge(auth.token, input.mcVersion, input.loader)
  if (!pre.ready) {
    throw new Error(
      `CurseForge 未匹配到 MC ${input.mcVersion} / ${input.loader} 的版本条目` +
        (pre.suggestions.length ? `；可选版本参考：${pre.suggestions.join('、')}` : '')
    )
  }
  const metadata = {
    changelog: input.changelog,
    changelogType: 'markdown',
    displayName: input.title,
    gameVersions: pre.gameVersionIds,
    releaseType: input.releaseType
  }
  const res = await httpPostMultipart<{ id?: number }>(
    `${CF_API}/projects/${encodeURIComponent(auth.projectId)}/upload-file`,
    {
      headers: { 'X-Api-Token': auth.token },
      fields: {
        metadata: JSON.stringify(metadata),
        file: {
          data: zip,
          filename: basename(input.zipPath),
          contentType: 'application/zip'
        }
      }
    }
  )
  const fileId = res.data?.id
  return fileId
    ? `https://www.curseforge.com/minecraft/modpacks/${auth.projectId}/files/${fileId}`
    : `https://authors.curseforge.com/`
}

/** 平台发布执行器：按勾选平台执行，部分失败不回滚 */
export async function publishModpack(
  input: PublishInput,
  platforms: PublishPlatform[],
  auth: {
    modrinth?: { token: string; projectId: string }
    curseforge?: { token: string; projectId: string }
  }
): Promise<PublishResultEntry[]> {
  // P0③ 预检门：产物/元数据任一项不过 → 全部平台返回预检错误，不上传任何字节。
  // （fail fast：否则 MR 上传成功后才发现 CF 产物损坏，就留下半成品发布状态）
  const preflight = runPublishPreflight(input, platforms)
  if (!preflight.ready) {
    const msg =
      '发布预检未通过：' +
      preflight.checks
        .filter((c) => !c.ok)
        .map((c) => `${c.label}${c.detail ? `（${c.detail}）` : ''}`)
        .join('；')
    return platforms.map((platform) => ({ platform, ok: false, error: msg }))
  }
  const results: PublishResultEntry[] = []
  // Modrinth 先、CurseForge 后（MR 接口反馈更快，先行失败可尽早暴露）
  for (const platform of ['modrinth', 'curseforge'] as const) {
    if (!platforms.includes(platform)) continue
    const a = auth[platform]
    if (!a?.token || !a.projectId) {
      results.push({ platform, ok: false, error: '未配置 token 或项目 ID，请先到「设置 → 发布」填写' })
      continue
    }
    // P0-6：按平台选产物——CF 上传 -cf.zip（含 manifest.json），MR 上传 .mrpack
    const effInput: PublishInput =
      platform === 'curseforge' ? { ...input, zipPath: input.cfZipPath || input.zipPath } : input
    try {
      const url =
        platform === 'modrinth'
          ? await publishToModrinth(effInput, a)
          : await publishToCurseForge(effInput, a)
      results.push({ platform, ok: true, url })
    } catch (err) {
      results.push({ platform, ok: false, error: toErrMsg(err) })
    }
  }
  return results
}
