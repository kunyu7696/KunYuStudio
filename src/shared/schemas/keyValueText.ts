/**
 * key=value 文本解析/生成（.lang 多语言、shaders.properties 配置）。
 * 注释行原样收集，表单保存时重新拼回文件头部，避免丢失用户说明。
 */

export interface KeyValueTextDoc {
  /** 顶部注释行（# / ; 开头，或无法解析为键值的行） */
  comments: string[]
  entries: { key: string; value: string }[]
}

/** 解析 key=value 文本；空行忽略，注释与非法行归入 comments */
export function parseKeyValueText(text: string): KeyValueTextDoc {
  const comments: string[] = []
  const entries: { key: string; value: string }[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('#') || line.startsWith(';')) {
      comments.push(line)
      continue
    }
    const idx = line.indexOf('=')
    if (idx <= 0) {
      comments.push(line)
      continue
    }
    const key = line.slice(0, idx).trim()
    const value = line.slice(idx + 1).trim()
    if (!key) {
      comments.push(line)
      continue
    }
    entries.push({ key, value })
  }
  return { comments, entries }
}

/** 生成 key=value 文本：注释行在前，键值行在后 */
export function buildKeyValueText(doc: KeyValueTextDoc): string {
  const lines: string[] = [...doc.comments]
  if (lines.length > 0 && doc.entries.length > 0) lines.push('')
  for (const e of doc.entries) lines.push(`${e.key}=${e.value}`)
  return `${lines.join('\n')}\n`
}