/**
 * Blockbench MCP 插件 token 自动发现（对小白零配置）。
 *
 * @anningui/blockbench-mcp 的 HTTP 端强制 Authorization: Bearer <随机 token>，
 * token 由 Blockbench 端插件首次加载时生成，保存在 Blockbench 的 localStorage
 * （settings.bbmcp_secret），底层落在 Chromium LevelDB 的 Local Storage 目录。
 *
 * 用户手动复制 token 再粘进 KunYu 配置门槛太高，这里在拉起 stdio 网关前自动扫描：
 * - WAL（*.log，未压缩）命中率最高；SST（*.ldb，snappy 压缩）顺带扫未压缩块；
 * - Blockbench 运行中文件被 LevelDB 锁定，只读共享读不受影响；
 * - 扫不到就不注入，网关自身会把 401/不可达原因透传到 stderr。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * token 形态：插件生成的十六进制随机串（实测 48 位，放宽到 32-128）。
 * 约束：不能用 /i（大小写不敏感会把 value 前的 LevelDB 长度字节 'F'(0x46)
 * 吞进 token 变成 49 位 → 注入后 401）；且 token 前必须是非 hex 边界字符。
 */
const TOKEN_RE = /bbmcp_secret[\s\S]{0,240}?[^0-9a-f]([0-9a-f]{32,128})/

/** 网关标识：命令行或参数中出现 @anningui/blockbench-mcp */
const GATEWAY_RE = /@anningui\/blockbench-mcp/i

let cacheKey = ''
let cachedToken: string | null = null
let cachedAt = 0
/** 30s 内复用，避免每次重连都扫盘 */
const CACHE_TTL_MS = 30_000

/** 判断 stdio 配置是否为 blockbench-mcp 网关 */
export function isBlockbenchGateway(command: string, args: string[]): boolean {
  return GATEWAY_RE.test(`${command} ${args.join(' ')}`)
}

/** 默认 Blockbench LevelDB 目录（可注入，测试用） */
function defaultStorageDir(): string {
  // Windows：%APPDATA%/Blockbench（Electron 应用的 userData 风格）
  if (process.platform === 'win32') {
    const appData = process.env['APPDATA']
    if (!appData) return ''
    return join(appData, 'Blockbench', 'Local Storage', 'leveldb')
  }
  // macOS：~/Library/Application Support/Blockbench
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'Blockbench', 'Local Storage', 'leveldb')
  }
  // Linux：~/.config/Blockbench
  return join(homedir(), '.config', 'Blockbench', 'Local Storage', 'leveldb')
}

/**
 * 从 Blockbench 本地存储提取 MCP token；未安装/未生成/不可读时返回 null。
 * @param storageDir 测试注入目录；生产为 %APPDATA%/Blockbench/Local Storage/leveldb
 */
export function readBlockbenchMcpToken(storageDir?: string): string | null {
  const dir = storageDir ?? defaultStorageDir()
  if (!dir || !existsSync(dir)) return null

  const now = Date.now()
  if (cacheKey === dir && cachedToken && now - cachedAt < CACHE_TTL_MS) return cachedToken

  let entries: string[] = []
  try {
    entries = readdirSync(dir)
  } catch {
    return null
  }
  // WAL 优先（未压缩、含最新值），SST 兜底
  const files = entries
    .filter((f) => f.endsWith('.log'))
    .concat(entries.filter((f) => f.endsWith('.ldb')))

  for (const f of files) {
    let buf: Buffer
    try {
      buf = readFileSync(join(dir, f))
    } catch {
      // 文件被独占锁定等：跳过该文件
      continue
    }
    const m = buf.toString('latin1').match(TOKEN_RE)
    if (m?.[1]) {
      cacheKey = dir
      cachedToken = m[1]
      cachedAt = now
      return cachedToken
    }
  }
  return null
}

/**
 * 网关环境变量自动补全：识别为 blockbench-mcp 网关且用户未手填 BBMCP_TOKEN 时，
 * 自动注入从 Blockbench 存储中发现的 token。用户显式配置优先，不覆盖。
 */
export function enrichBlockbenchEnv(
  command: string,
  args: string[],
  env: Record<string, string>,
  storageDir?: string
): { env: Record<string, string>; tokenInjected: boolean } {
  if (!isBlockbenchGateway(command, args)) return { env, tokenInjected: false }
  if (env['BBMCP_TOKEN']?.trim()) return { env, tokenInjected: false }
  const token = readBlockbenchMcpToken(storageDir)
  if (!token) return { env, tokenInjected: false }
  return { env: { ...env, BBMCP_TOKEN: token }, tokenInjected: true }
}
