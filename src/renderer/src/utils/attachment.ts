/**
 * AI 对话附件处理：图片/照片读取与压缩、文本类文档内容抽取。
 *
 * 设计约束：
 * - 图片走视觉模型（data URL），发送前统一压缩（最长边 1568 / JPEG 0.85），
 *   避免截图直接撑爆请求体；气泡展示另存 256px 小缩略图（可随 localStorage 持久化）。
 * - 仅支持文本类文档（代码/配置/Markdown 等），内容抽取后以 <document> 块拼入提问；
 *   PDF/Word 等二进制格式不在渲染层解析，明确拒绝并提示。
 * - 原始 dataUrl 与文档文本只在内存中随当次请求使用，绝不写入 localStorage。
 */
import type { ChatAttachment } from '../../../shared/types/ai'
import { t } from '../i18n'

/** 图片体积上限（字节） */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024
/** 文本文档体积上限（字节） */
const MAX_DOC_BYTES = 512 * 1024
/** 发送给模型的图片最长边 */
const IMAGE_MAX_EDGE = 1568
/** 气泡缩略图最长边 */
const THUMB_MAX_EDGE = 256
/** 单个文档抽取字符上限（防止 prompt 过长） */
const DOC_CHAR_LIMIT = 60000

/** 可抽取的文本类文档扩展名（Minecraft 开发常见代码/配置全覆盖） */
const DOC_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'log', 'ini', 'cfg', 'conf', 'properties',
  'json', 'json5', 'toml', 'yaml', 'yml', 'xml', 'html', 'htm', 'css', 'scss', 'less',
  'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'vue', 'java', 'kt', 'kts', 'gradle',
  'c', 'h', 'cpp', 'hpp', 'cc', 'cs', 'go', 'py', 'rs', 'rb', 'php', 'sh', 'bash', 'bat', 'cmd', 'sql',
  'mcmeta', 'lang', 'vsh', 'fsh', 'gsh', 'glsl'
])

/** file input accept 属性 */
export const ATTACHMENT_ACCEPT =
  'image/*,.txt,.md,.markdown,.log,.ini,.cfg,.conf,.properties,.json,.json5,.toml,.yaml,.yml,' +
  '.xml,.html,.htm,.css,.scss,.less,.js,.jsx,.mjs,.cjs,.ts,.tsx,.vue,.java,.kt,.kts,.gradle,' +
  '.c,.h,.cpp,.hpp,.cc,.cs,.go,.py,.rs,.rb,.php,.sh,.bash,.bat,.cmd,.sql,.mcmeta,.lang,.vsh,.fsh,.gsh,.glsl'

/** 最多一次携带的附件数量 */
export const MAX_ATTACHMENTS = 6

export interface ReadAttachmentsResult {
  ok: ChatAttachment[]
  /** 被拒绝文件的用户可读原因 */
  rejected: string[]
}

function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i + 1).toLowerCase() : ''
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error(t('attachment.readFailed')))
    reader.readAsDataURL(file)
  })
}

function readAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error(t('attachment.readFailed')))
    reader.readAsText(file, 'utf-8')
  })
}

/** 用 canvas 把图片压缩到最长边不超过 maxEdge，返回指定格式的 data URL */
function compressDataUrl(
  dataUrl: string,
  maxEdge: number,
  quality: number,
  mime: 'image/jpeg' | 'image/png' = 'image/jpeg'
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const { width, height } = img
      const scale = Math.min(1, maxEdge / Math.max(width, height))
      const w = Math.max(1, Math.round(width * scale))
      const h = Math.max(1, Math.round(height * scale))
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error(t('attachment.canvasInitFailed')))
        return
      }
      ctx.drawImage(img, 0, 0, w, h)
      resolve(canvas.toDataURL(mime, quality))
    }
    img.onerror = () => reject(new Error(t('attachment.imageDecodeFailed')))
    img.src = dataUrl
  })
}

async function readImage(file: File): Promise<ChatAttachment> {
  const raw = await readAsDataUrl(file)
  // 原图必须保留 PNG（alpha 通道供贴图工坊像素化描边使用）；缩略图用 JPEG 控制持久化体积
  const [dataUrl, thumbUrl] = await Promise.all([
    compressDataUrl(raw, IMAGE_MAX_EDGE, 0.9, 'image/png'),
    compressDataUrl(raw, THUMB_MAX_EDGE, 0.7, 'image/jpeg')
  ])
  return {
    kind: 'image',
    name: file.name,
    size: file.size,
    mimeType: 'image/png',
    dataUrl,
    thumbUrl
  }
}

async function readDoc(file: File): Promise<ChatAttachment> {
  const full = await readAsText(file)
  const text = full.length > DOC_CHAR_LIMIT ? full.slice(0, DOC_CHAR_LIMIT) + '\n' + t('attachment.docTruncated') : full
  return {
    kind: 'doc',
    name: file.name,
    size: file.size,
    mimeType: file.type || 'text/plain',
    text
  }
}

/**
 * 读取用户选择的文件为附件。
 * 图片自动压缩；文本文档抽取内容；不支持的类型/超限文件进入 rejected。
 */
export async function readAttachments(files: ArrayLike<File> | File[]): Promise<ReadAttachmentsResult> {
  const list = Array.from(files)
  const ok: ChatAttachment[] = []
  const rejected: string[] = []
  for (const file of list) {
    if (ok.length >= MAX_ATTACHMENTS) {
      rejected.push(t('attachment.tooMany', { name: file.name, max: MAX_ATTACHMENTS }))
      continue
    }
    try {
      const isImage = file.type.startsWith('image/')
      const ext = extOf(file.name)
      if (isImage) {
        if (file.size > MAX_IMAGE_BYTES) {
          rejected.push(t('attachment.imageTooLarge', { name: file.name, limit: formatBytes(MAX_IMAGE_BYTES) }))
          continue
        }
        ok.push(await readImage(file))
      } else if (DOC_EXTENSIONS.has(ext)) {
        if (file.size > MAX_DOC_BYTES) {
          rejected.push(t('attachment.docTooLarge', { name: file.name, limit: formatBytes(MAX_DOC_BYTES) }))
          continue
        }
        ok.push(await readDoc(file))
      } else {
        rejected.push(t('attachment.unsupported', { name: file.name }))
      }
    } catch (err) {
      rejected.push(t('attachment.readFailedWithName', { name: file.name, error: (err as Error).message }))
    }
  }
  return { ok, rejected }
}

/** 持久化/展示用副本：剥离原始大图与文档文本，仅保留元信息与缩略图 */
export function toDisplayAttachment(a: ChatAttachment): ChatAttachment {
  return {
    kind: a.kind,
    name: a.name,
    size: a.size,
    mimeType: a.mimeType,
    thumbUrl: a.thumbUrl
  }
}

/** 把文本文档内容拼入用户提问（图片走独立多模态通道，不进文本） */
export function buildPromptWithDocs(prompt: string, docs: ChatAttachment[]): string {
  if (docs.length === 0) return prompt
  const blocks = docs
    .filter((d) => d.kind === 'doc' && d.text !== undefined)
    .map((d) => `<document name="${d.name}" type="${d.mimeType}">\n${d.text ?? ''}\n</document>`)
  if (blocks.length === 0) return prompt
  const header = t('attachment.docsHeader', { n: blocks.length })
  return prompt.trim() ? `${prompt}\n\n${header}\n\n${blocks.join('\n\n')}` : `${header}\n\n${blocks.join('\n\n')}`
}

/** 字节数人类可读 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
