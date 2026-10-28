/**
 * 音效工坊主进程服务。
 *
 * 链路：
 * 1. ensureFfmpeg：ffmpeg 缺失时按网络镜像设置从 gyan.dev / BtbN GitHub Releases
 *    下载 win64 压缩包到 userData/tools/ffmpeg/（运行时按需，不打进安装包），
 *    落盘后解包（archiveExtract）并记录版本 sidecar。
 * 2. convertToOgg：渲染层合成 WAV 字节 / 本地音频文件统一经
 *    `ffmpeg -c:a libvorbis -ar 44100` 转码为 OGG，落盘 assets/<ns>/sounds/。
 * 3. 声音库：扫描 sounds 目录 + 读写 assets/<ns>/sounds.json（原版资源包格式）。
 *
 * 命名空间解析：模组项目走 contentGenerator.resolveModContext（src/main/resources/assets/<modid>）；
 * 独立资源包项目走 resourcepackService 元数据（项目根 assets/<namespace>）。
 */
import { spawn } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, extname, join } from 'node:path'
import type {
  AudioConvertInput,
  AudioConvertResult,
  AudioLibrary,
  AudioToolStatus,
  SoundEventEntry,
  SoundFileInfo
} from '../../shared/types/audio'
import { validateContentId } from '../../shared/types/content'
import { extractZipToDir } from './archiveExtract'
import { resolveModContext } from './contentGenerator/context'
import { assertWithinRoot } from './fsService'
import { toolsRoot } from './decompileService'
import { getSection } from './settingsService'
import { httpDownload, fetchSha256Sidecar } from './httpUtil'
import { readResourcePackMeta, upgradeStandaloneResourcePack } from './resourcepackService'

/** FFmpeg 下载源（win64 压缩包） */
const GYAN_URL = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip'
const BTBN_URL =
  'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip'
/** 允许导入转换的源音频扩展名 */
export const AUDIO_IMPORT_EXTS = ['.wav', '.mp3', '.ogg', '.flac', '.m4a', '.aac'] as const
/** 试听读取上限（8MB，与资源包音效一致） */
const READ_MAX_BYTES = 8 * 1024 * 1024

export function ffmpegDir(): string {
  return join(toolsRoot(), 'ffmpeg')
}

export function ffmpegExePath(): string {
  return join(ffmpegDir(), 'bin', 'ffmpeg.exe')
}

/** 按镜像偏好给出 FFmpeg 候选下载地址（按优先级排序） */
export function buildFfmpegUrls(mirror: 'china' | 'official'): string[] {
  // gyan.dev 走 Cloudflare CDN，国内直连通常比 GitHub Releases 稳
  return mirror === 'china' ? [GYAN_URL, BTBN_URL] : [BTBN_URL, GYAN_URL]
}

/** 工具状态（不触发下载）。版本读 sidecar 文件，缺失回退空串。 */
export function ffmpegStatus(): AudioToolStatus {
  const exe = ffmpegExePath()
  if (!existsSync(exe)) return { installed: false, path: exe, version: '', integrity: 'unverified' }
  let version = ''
  try {
    version = readFileSync(join(ffmpegDir(), 'ffmpeg-version.txt'), 'utf-8').trim()
  } catch {
    /* sidecar 缺失不阻塞使用 */
  }
  let integrity: AudioToolStatus['integrity'] = 'unverified'
  try {
    const mark = readFileSync(join(ffmpegDir(), 'ffmpeg-integrity.txt'), 'utf-8').trim()
    if (mark === 'sha256-verified') integrity = 'sha256-verified'
  } catch {
    /* 无完整性记录 = 未校验（对外可见） */
  }
  return { installed: true, path: exe, version, integrity }
}

/** 安装后探测版本号（ffmpeg -version 首行），失败返回空串 */
async function probeFfmpegVersion(exe: string): Promise<string> {
  return new Promise((resolvePromise) => {
    let out = ''
    let settled = false
    const done = (v: string): void => {
      if (!settled) {
        settled = true
        resolvePromise(v)
      }
    }
    try {
      const child = spawn(exe, ['-version'], { windowsHide: true })
      const timer = setTimeout(() => {
        child.kill()
        done('')
      }, 10_000)
      child.stdout.on('data', (c: Buffer) => {
        out += c.toString('utf-8')
      })
      child.on('error', () => {
        clearTimeout(timer)
        done('')
      })
      child.on('close', () => {
        clearTimeout(timer)
        const m = out.match(/ffmpeg version\s+(\S+)/)
        done(m?.[1] ?? '')
      })
    } catch {
      done('')
    }
  })
}

/**
 * 确保 ffmpeg 就绪：已安装直接返回；否则按镜像偏好逐个候选地址下载 zip，
 * 解包（strip 顶层目录）后校验 ffmpeg.exe 存在，失败删半成品再试下一个。
 */
export async function ensureFfmpeg(
  onProgress?: (loadedBytes: number, totalBytes: number) => void
): Promise<AudioToolStatus> {
  const current = ffmpegStatus()
  if (current.installed) return current
  if (process.platform !== 'win32') {
    throw new Error('FFmpeg 自动下载目前仅支持 Windows；请手动安装后重试')
  }
  const mirror = getSection('network').mirror
  const dest = ffmpegDir()
  const zipPath = join(tmpdir(), `kunyu-ffmpeg-${Date.now()}.zip`)
  const errors: string[] = []
  for (const url of buildFfmpegUrls(mirror)) {
    try {
      // 上游提供 .sha256 时强制校验；未提供则显式标记未校验（不静默当已验证）
      const expected = await fetchSha256Sidecar(url)
      await httpDownload(url, zipPath, {
        onProgress,
        ...(expected ? { expected: { sha256: expected } } : {})
      })
      rmSync(dest, { recursive: true, force: true })
      mkdirSync(dest, { recursive: true })
      extractZipToDir(readFileSync(zipPath), dest, { stripComponents: 1 })
      if (!existsSync(ffmpegExePath())) {
        throw new Error('压缩包内未找到 bin/ffmpeg.exe')
      }
      const version = await probeFfmpegVersion(ffmpegExePath())
      writeFileSync(join(dest, 'ffmpeg-version.txt'), version + '\n')
      writeFileSync(join(dest, 'ffmpeg-integrity.txt'), (expected ? 'sha256-verified' : 'unverified') + '\n')
      return {
        installed: true,
        path: ffmpegExePath(),
        version,
        integrity: expected ? 'sha256-verified' : 'unverified'
      }
    } catch (err) {
      rmSync(dest, { recursive: true, force: true })
      errors.push(`${url}：${(err as Error).message}`)
    } finally {
      rmSync(zipPath, { force: true })
    }
  }
  throw new Error(`FFmpeg 下载失败：${errors.join('；')}`)
}

/** 音频落地目标（命名空间 + sounds 目录 + sounds.json 路径） */
export interface AudioTarget {
  namespace: string
  /** assets/<ns> 绝对路径 */
  assetsDir: string
  /** assets/<ns>/sounds 绝对路径 */
  soundsDir: string
  /** assets/<ns>/sounds.json 绝对路径 */
  soundsJsonPath: string
  /** sounds 目录的包内相对 POSIX 路径 */
  soundsRelDir: string
}

/** 解析项目音频落地目标：模组项目优先，其次独立资源包项目 */
export function resolveAudioTarget(root: string): AudioTarget {
  assertWithinRoot(root)
  try {
    const ctx = resolveModContext(root)
    return {
      namespace: ctx.modId,
      assetsDir: ctx.assetsDir,
      soundsDir: join(ctx.assetsDir, 'sounds'),
      soundsJsonPath: join(ctx.assetsDir, 'sounds.json'),
      soundsRelDir: `assets/${ctx.modId}/sounds`
    }
  } catch {
    /* 非模组项目，尝试资源包 */
  }
  const meta = readResourcePackMeta(root) ?? upgradeStandaloneResourcePack(root)
  if (!meta) {
    throw new Error('未识别的项目结构：需要模组项目（含模组描述文件）或独立资源包项目（含 pack.mcmeta）')
  }
  const assetsDir = join(root, 'assets', meta.namespace)
  return {
    namespace: meta.namespace,
    assetsDir,
    soundsDir: join(assetsDir, 'sounds'),
    soundsJsonPath: join(assetsDir, 'sounds.json'),
    soundsRelDir: `assets/${meta.namespace}/sounds`
  }
}

/* ------------------------------ sounds.json ------------------------------ */

type SoundsJsonRaw = Record<
  string,
  { sounds?: Array<string | { name?: unknown }>; subtitle?: unknown }
>

/** 解析 sounds.json 文本为事件列表（兼容字符串/对象两种 sound 条目），按事件名排序 */
export function parseSoundsJson(text: string): SoundEventEntry[] {
  const raw = JSON.parse(text.replace(/^\uFEFF/, '')) as SoundsJsonRaw
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('sounds.json 顶层必须是对象')
  }
  const events: SoundEventEntry[] = []
  for (const [name, def] of Object.entries(raw)) {
    const sounds = (def?.sounds ?? [])
      .map((s) => (typeof s === 'string' ? s : typeof s?.name === 'string' ? s.name : ''))
      .filter((s) => s.length > 0)
    const entry: SoundEventEntry = { name, sounds }
    if (typeof def?.subtitle === 'string' && def.subtitle) entry.subtitle = def.subtitle
    events.push(entry)
  }
  return events.sort((a, b) => a.name.localeCompare(b.name))
}

/** 序列化事件列表为 sounds.json 文本（sound 条目统一对象形式，便于后续扩展 stream/volume） */
export function serializeSoundsJson(events: SoundEventEntry[]): string {
  const out: Record<string, { sounds: Array<{ name: string }>; subtitle?: string }> = {}
  for (const e of [...events].sort((a, b) => a.name.localeCompare(b.name))) {
    const def: { sounds: Array<{ name: string }>; subtitle?: string } = {
      sounds: e.sounds.map((name) => ({ name }))
    }
    if (e.subtitle) def.subtitle = e.subtitle
    out[e.name] = def
  }
  return JSON.stringify(out, null, 2) + '\n'
}

/** 读项目 sounds.json（不存在返回空列表；存在但损坏时抛错，防静默吞掉用户手写内容） */
export function readSoundEvents(root: string): SoundEventEntry[] {
  const target = resolveAudioTarget(root)
  if (!existsSync(target.soundsJsonPath)) return []
  return parseSoundsJson(readFileSync(target.soundsJsonPath, 'utf-8'))
}

function writeSoundEvents(target: AudioTarget, events: SoundEventEntry[]): void {
  mkdirSync(target.assetsDir, { recursive: true })
  writeFileSync(target.soundsJsonPath, serializeSoundsJson(events))
}

/** 音效事件名校验：小写字母/数字/_.-/，可带命名空间前缀（ns.path 形式） */
const EVENT_NAME_RE = /^[a-z0-9_.\-/]+$/

/**
 * 注册/更新音效事件：sounds 引用必须指向本命名空间下已存在的 stem 列表。
 * 同名事件覆盖（用户显式编辑保存）。
 */
export function registerSoundEvent(root: string, entry: SoundEventEntry): void {
  const target = resolveAudioTarget(root)
  const name = entry.name.trim()
  if (!EVENT_NAME_RE.test(name)) {
    throw new Error('事件名不合法：仅含小写字母、数字、下划线、点、斜杠、连字符')
  }
  if (entry.sounds.length === 0) throw new Error('事件至少引用一个音效文件')
  const events = readSoundEvents(root)
  const next: SoundEventEntry = {
    name,
    sounds: entry.sounds.map((s) => (s.includes(':') ? s : `${target.namespace}:${s}`)),
    ...(entry.subtitle?.trim() ? { subtitle: entry.subtitle.trim() } : {})
  }
  const idx = events.findIndex((e) => e.name === name)
  if (idx >= 0) events[idx] = next
  else events.push(next)
  writeSoundEvents(target, events)
}

/** 注销音效事件（不存在时静默成功） */
export function unregisterSoundEvent(root: string, name: string): void {
  const target = resolveAudioTarget(root)
  const events = readSoundEvents(root).filter((e) => e.name !== name)
  writeSoundEvents(target, events)
}

/* ------------------------------ 转换与落盘 ------------------------------ */

function assertValidStem(stem: string): void {
  if (!validateContentId(stem)) {
    throw new Error('文件名主干不合法：小写字母开头，仅含小写字母、数字、下划线')
  }
}

/**
 * 把一份音源（渲染层 WAV 字节 / 本地文件）转码为 OGG Vorbis 44.1kHz 并落盘 sounds 目录。
 * 同名 .ogg 已存在则覆盖（FFmpeg -y）。
 */
export async function convertToOgg(
  input: AudioConvertInput,
  onEvent?: (phase: 'converting' | 'done', message: string) => void
): Promise<AudioConvertResult> {
  const target = resolveAudioTarget(input.root)
  assertValidStem(input.stem)
  const tool = await ensureFfmpeg()
  mkdirSync(target.soundsDir, { recursive: true })

  // 源就绪：字节落临时文件；路径直接校验扩展名
  let srcPath: string
  let cleanup: (() => void) | null = null
  if (input.source.kind === 'bytes') {
    const ext = extname(input.source.fileName).toLowerCase() || '.wav'
    if (!AUDIO_IMPORT_EXTS.includes(ext as (typeof AUDIO_IMPORT_EXTS)[number])) {
      throw new Error(`不支持的源格式 ${ext}（支持 ${AUDIO_IMPORT_EXTS.join('/')}）`)
    }
    srcPath = join(tmpdir(), `kunyu-audio-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`)
    await writeFile(srcPath, Buffer.from(input.source.data))
    cleanup = () => rmSync(srcPath, { force: true })
  } else {
    srcPath = input.source.srcPath
    if (!existsSync(srcPath) || !statSync(srcPath).isFile()) {
      throw new Error(`源音频文件不存在: ${srcPath}`)
    }
    const ext = extname(srcPath).toLowerCase()
    if (!AUDIO_IMPORT_EXTS.includes(ext as (typeof AUDIO_IMPORT_EXTS)[number])) {
      throw new Error(`不支持的源格式 ${ext}（支持 ${AUDIO_IMPORT_EXTS.join('/')}）`)
    }
  }

  const outPath = join(target.soundsDir, `${input.stem}.ogg`)
  onEvent?.('converting', basename(srcPath))
  const stderrTail: string[] = []
  try {
    await new Promise<void>((resolvePromise, rejectPromise) => {
      // -vn 丢弃专辑封面等视频流；-q:a 4 ≈ 128kbps VBR，游戏音效足够
      const child = spawn(
        tool.path,
        ['-hide_banner', '-loglevel', 'error', '-y', '-i', srcPath, '-vn', '-c:a', 'libvorbis', '-ar', '44100', '-q:a', '4', outPath],
        { windowsHide: true }
      )
      child.stderr.on('data', (c: Buffer) => {
        for (const line of c.toString('utf-8').split(/\r?\n/)) {
          const t = line.trim()
          if (!t) continue
          stderrTail.push(t)
          while (stderrTail.length > 8) stderrTail.shift()
        }
      })
      child.on('error', (err) => rejectPromise(new Error(`无法启动 FFmpeg：${err.message}`)))
      child.on('close', (code) => {
        if (code === 0 && existsSync(outPath)) resolvePromise()
        else {
          rmSync(outPath, { force: true })
          rejectPromise(new Error(`FFmpeg 转码失败（退出码 ${code}）：${stderrTail.join(' / ') || '无错误输出'}`))
        }
      })
    })
  } finally {
    cleanup?.()
  }
  const sizeBytes = statSync(outPath).size
  onEvent?.('done', `${input.stem}.ogg（${Math.round(sizeBytes / 1024)} KB）`)
  return { relPath: `${target.soundsRelDir}/${input.stem}.ogg`, sizeBytes }
}

/* ------------------------------ 声音库浏览 ------------------------------ */

/** 列出声音库：sounds 目录下全部 .ogg + sounds.json 事件（标注引用关系） */
export function listAudioLibrary(root: string): AudioLibrary {
  const target = resolveAudioTarget(root)
  const events = existsSync(target.soundsJsonPath)
    ? parseSoundsJson(readFileSync(target.soundsJsonPath, 'utf-8'))
    : []
  // 事件 → 引用的本命名空间 stem 集合
  const stemEvents = new Map<string, string[]>()
  for (const e of events) {
    for (const s of e.sounds) {
      const m = s.match(/^([a-z0-9_.-]+):(.+)$/)
      if (!m || m[1] !== target.namespace) continue
      // 仅支持扁平 sounds 目录（不含子目录）
      const stem = m[2]!
      if (stem.includes('/')) continue
      const list = stemEvents.get(stem) ?? []
      list.push(e.name)
      stemEvents.set(stem, list)
    }
  }
  const files: SoundFileInfo[] = []
  if (existsSync(target.soundsDir)) {
    for (const name of readdirSync(target.soundsDir)) {
      if (!name.toLowerCase().endsWith('.ogg')) continue
      const abs = join(target.soundsDir, name)
      if (!statSync(abs).isFile()) continue
      const stem = name.slice(0, -4)
      files.push({
        stem,
        relPath: `${target.soundsRelDir}/${name}`,
        sizeBytes: statSync(abs).size,
        events: (stemEvents.get(stem) ?? []).sort()
      })
    }
  }
  files.sort((a, b) => a.stem.localeCompare(b.stem))
  return {
    namespace: target.namespace,
    soundsRelDir: target.soundsRelDir,
    files,
    events
  }
}

/** 删除 .ogg 音效文件，并从所有事件中摘除对应引用（事件本身保留） */
export function removeSound(root: string, stem: string): void {
  const target = resolveAudioTarget(root)
  assertValidStem(stem)
  rmSync(join(target.soundsDir, `${stem}.ogg`), { force: true })
  if (existsSync(target.soundsJsonPath)) {
    const fullId = `${target.namespace}:${stem}`
    const events = parseSoundsJson(readFileSync(target.soundsJsonPath, 'utf-8')).map((e) => ({
      ...e,
      sounds: e.sounds.filter((s) => s !== fullId)
    }))
    writeSoundEvents(target, events)
  }
}

/** 读取 .ogg 为 data URL（渲染层试听用；上限 8MB） */
export function readSoundDataUrl(root: string, stem: string): string {
  const target = resolveAudioTarget(root)
  assertValidStem(stem)
  const abs = join(target.soundsDir, `${stem}.ogg`)
  if (!existsSync(abs)) throw new Error('音效文件不存在')
  if (statSync(abs).size > READ_MAX_BYTES) throw new Error('音效文件超过 8MB，请用系统播放器试听')
  return `data:audio/ogg;base64,${readFileSync(abs).toString('base64')}`
}

/** 源文件读取上限（20MB，MIDI/采样源） */
const SOURCE_READ_MAX_BYTES = 20 * 1024 * 1024
const SOURCE_EXTS = [...AUDIO_IMPORT_EXTS, '.mid', '.midi'] as const

/**
 * 读取用户经文件对话框显式选中的源音频/MIDI 字节。
 * 路径来自用户显式选择（dialog.selectFile），等价于用户授权读取，不走项目根守卫。
 */
export function readSourceBytes(path: string): Uint8Array {
  if (!existsSync(path) || !statSync(path).isFile()) {
    throw new Error(`文件不存在: ${path}`)
  }
  const ext = extname(path).toLowerCase()
  if (!SOURCE_EXTS.includes(ext as (typeof SOURCE_EXTS)[number])) {
    throw new Error(`不支持的源格式 ${ext}`)
  }
  if (statSync(path).size > SOURCE_READ_MAX_BYTES) {
    throw new Error('文件超过 20MB，不支持读取')
  }
  return new Uint8Array(readFileSync(path))
}
