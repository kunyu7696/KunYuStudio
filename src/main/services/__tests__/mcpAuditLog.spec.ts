/**
 * mcpAuditLog（TR #4）单元测试：JSONL 追加、字段完整性、写失败静默。
 */
import { describe, expect, it } from 'vitest'
import { appendMcpAudit } from '../mcpAuditLog'

describe('appendMcpAudit', () => {
  it('追加一行合法 JSONL', () => {
    const lines: string[] = []
    appendMcpAudit(
      {
        ts: '2025-01-01T00:00:00.000Z',
        tool: 'texture_paint',
        group: 'interact',
        argsSummary: 'kind: item',
        decision: 'allow',
        result: 'success'
      },
      {
        getPath: () => '/tmp/fake.jsonl',
        appendFile: (_path, line) => lines.push(line)
      }
    )
    expect(lines).toHaveLength(1)
    const parsed = JSON.parse(lines[0]) as Record<string, unknown>
    expect(parsed['ts']).toBe('2025-01-01T00:00:00.000Z')
    expect(parsed['tool']).toBe('texture_paint')
    expect(parsed['group']).toBe('interact')
    expect(parsed['decision']).toBe('allow')
    expect(parsed['result']).toBe('success')
  })

  it('写失败静默吞掉不抛异常', () => {
    expect(() =>
      appendMcpAudit(
        {
          ts: '2025-01-01T00:00:00.000Z',
          tool: 'x',
          group: 'admin',
          argsSummary: '',
          decision: 'deny',
          result: 'denied'
        },
        {
          getPath: () => '/nonexistent/dir/x.jsonl',
          appendFile: () => {
            throw new Error('EACCES')
          }
        }
      )
    ).not.toThrow()
  })
})
