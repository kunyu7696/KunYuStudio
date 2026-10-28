/**
 * MCP 桥接审计日志（TR #4）。
 * 所有非 read 组工具调用（无论允许/拒绝）追加写入本地 JSONL，
 * 只进不出，不写任何上传逻辑。日志写失败静默吞掉，不影响主流程。
 */
export interface McpAuditEntry {
  ts: string
  tool: string
  group: string
  argsSummary: string
  decision: 'allow' | 'deny'
  result: 'success' | 'error' | 'denied'
}

export interface McpAuditLogDeps {
  getPath: () => string
  appendFile: (path: string, line: string) => void
}

export function appendMcpAudit(entry: McpAuditEntry, deps: McpAuditLogDeps): void {
  const line = JSON.stringify(entry) + '\n'
  try {
    deps.appendFile(deps.getPath(), line)
  } catch {
    /* 日志写失败不能影响主流程 */
  }
}
