/**
 * 整合包组装用哈希工具（Modrinth index 需要 sha1 + sha512 双哈希）。
 * 零新依赖，基于 node:crypto。
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

export interface FileHashes {
  sha1: string
  sha512: string
  /** 文件字节数（现算，避免与记录不符） */
  size: number
}

/** 字符串或 Buffer 的 sha1（十六进制小写） */
export function sha1Of(data: string | Buffer): string {
  return createHash('sha1').update(data).digest('hex')
}

/** 字符串或 Buffer 的 sha512（十六进制小写） */
export function sha512Of(data: string | Buffer): string {
  return createHash('sha512').update(data).digest('hex')
}

/** 读取文件并计算双哈希；文件不可读时返回 null（调用方降级处理） */
export function fileHashes(absPath: string): FileHashes | null {
  try {
    const data = readFileSync(absPath)
    return { sha1: sha1Of(data), sha512: sha512Of(data), size: data.length }
  } catch {
    return null
  }
}