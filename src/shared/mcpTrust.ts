/**
 * MCP 插件官方认证白名单（主进程市场服务与渲染层 UI 共用）。
 *
 * 第三方 MCP 插件本质是在用户电脑上执行 npm/pypi 包代码。只有以下来源经 KunYu
 * 核验（官方组织发布 / 与 Minecraft 工具链集成验证过）才打「官方认证」徽章；
 * 其余 Registry/社区条目标为未认证，安装前必须弹第三方安全确认。
 */

/** MCP 官方组织作用域（官方参考服务器） */
export const CERTIFIED_SCOPES = ['@modelcontextprotocol/']

/** KunYu 逐一核验过的精确包标识符 */
export const CERTIFIED_EXACT = new Set([
  'mc-texture-cli', // KunYu 贴图工具链集成（--root 项目目录限定）
  'mc-asset', // 像素资产引擎，官方 Registry 收录
  '@mcdxai/minecraft-dev-mcp' // Minecraft 代码分析（只读）
])

/** 判断包标识符是否在官方认证白名单（自动忽略末尾 @version；保留 @scope 作用域） */
export function isCertifiedIdentifier(identifier: string): boolean {
  const raw = (identifier ?? '').trim()
  if (!raw) return false
  if (CERTIFIED_SCOPES.some((scope) => raw.startsWith(scope))) return true
  return CERTIFIED_EXACT.has(stripPackageVersion(raw))
}

/** 去掉包标识符末尾版本；注意保留 @scope 作用域前缀 */
export function stripPackageVersion(pkg: string): string {
  const s = pkg ?? ''
  if (s.startsWith('@')) {
    const second = s.indexOf('@', 1)
    return second >= 0 ? s.slice(0, second) : s
  }
  return s.replace(/@.*$/, '')
}

/** 从已安装 server 的 command/args 中粗提取包标识符（与 store.installedIdentifiers 同构） */
export function identifierFromArgs(args: string[]): string {
  const a = args ?? []
  const p = a.indexOf('-p')
  if (p >= 0) return stripPackageVersion(a[p + 1] ?? '')
  const idx = a.indexOf('-y')
  if (idx >= 0 && a[idx + 1]) return stripPackageVersion(a[idx + 1])
  return stripPackageVersion(a[0] ?? '')
}
