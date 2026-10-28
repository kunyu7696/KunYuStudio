/**
 * 模型文档 revision（乐观锁 ETag）。
 *
 * 设计：revision = 文档内容的 FNV-1a 64-bit 哈希（16 位十六进制串）。
 * - 无侧车文件：不引入 .rev 状态，天然兼容历史文档、跨重启不失效、无状态错位；
 * - 主进程（modelerBackup 写回校验）与渲染层（编辑会话记录基线）共用同一实现，
 *   保证「读到的 revision」与「写回时的 expectedRevision」口径严格一致；
 * - 语义等价于 HTTP ETag：写方必须基于自己读到的内容版本写回，
 *   期间文档被其它来源（AI 回写 / 另一编辑会话）改动则冲突拒绝。
 */
export function computeModelerRevision(content: string): string {
  // FNV-1a 64-bit：offset basis 与 prime 为算法标准常数；
  // JS 字符串为 UTF-16 码元，高低字节分别混入避免奇偶字节碰撞。
  let hash = 0xcbf29ce484222325n
  const prime = 0x100000001b3n
  const mask = 0xffffffffffffffffn
  for (let i = 0; i < content.length; i++) {
    const code = content.charCodeAt(i)
    hash ^= BigInt(code & 0xff)
    hash = (hash * prime) & mask
    hash ^= BigInt(code >> 8)
    hash = (hash * prime) & mask
  }
  return hash.toString(16).padStart(16, '0')
}
