/**
 * MCP 第三方插件沙箱（安全边界）。
 *
 * 威胁模型：市场安装的 MCP 插件是在用户机器上运行的第三方 npm/pypi 代码。
 * KunYu 无法审查每个包的实现，因此在进程边界做两层收敛：
 *
 * 1. 工作目录（cwd）：
 *    - 有打开项目 → cwd 强制为项目根；配合 --root/__PROJECT_ROOT__ 类参数，
 *      filesystem / mc-texture-cli 等工具自身的目录限制双保险。
 *    - 无打开项目 → 落到 userData/mcp-sandbox 独立空目录，插件默认读写不到用户文件。
 *
 * 2. 环境变量最小化：
 *    - 不再把 Electron 主进程的全部 env（含 ELECTRON_*、可能的代理/令牌变量）透传给第三方包；
 *    - 仅保留运行时（npx/node/uvx）必需的系统变量 + 用户显式配置的插件环境变量；
 *    - 注入 KUNYU_PROJECT_ROOT / KUNYU_MCP_SANDBOX 供配合的插件识别边界。
 *
 * 注意：这是「最小权限 + 目录限定」而非 OS 级强制沙箱（Windows Job/AppContainer、
 * Linux namespaces 超出 Electron 能力范围）；插件若主动访问绝对路径仍可逃逸，
 * 因此安装前必须对未认证第三方弹安全确认（见 PluginsView 安装流程）。
 */
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

/** Windows 下运行 npx/npm/node/cmd 必需的系统变量 */
const WIN_ENV_ALLOWLIST = [
  'PATH',
  'PATHEXT',
  'SYSTEMROOT',
  'SYSTEMDRIVE',
  'WINDIR',
  'TEMP',
  'TMP',
  'APPDATA',
  'LOCALAPPDATA',
  'USERPROFILE',
  'USERNAME',
  'COMPUTERNAME',
  'ComSpec',
  'COMSPEC',
  'HOMEDRIVE',
  'HOMEPATH',
  'NUMBER_OF_PROCESSORS',
  'PROCESSOR_ARCHITECTURE',
  'LANG',
  'LC_ALL'
]

/** macOS/Linux 下运行 npx/node/uvx 必需的系统变量 */
const NIX_ENV_ALLOWLIST = [
  'PATH',
  'HOME',
  'SHELL',
  'TMPDIR',
  'TMP',
  'TEMP',
  'LANG',
  'LC_ALL',
  'TERM',
  'USER',
  'LOGNAME',
  'XDG_CACHE_HOME',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME'
]

/** npm/uv 缓存与代理（用户机器配置的镜像加速/代理必须保留，否则 npx 拉包失败） */
const TOOLCHAIN_ENV = [
  'npm_config_cache',
  'NPM_CONFIG_CACHE',
  'npm_config_registry',
  'NPM_CONFIG_REGISTRY',
  'UV_CACHE_DIR',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'http_proxy',
  'https_proxy',
  'NO_PROXY',
  'no_proxy',
  'NODE_EXTRA_CA_CERTS'
]

/**
 * 解析插件子进程的工作目录。
 * @param projectRoot 当前激活项目根（null=未打开项目）
 * @param userDataRoot Electron userData 根（无项目时的沙箱父目录）
 * @returns 已存在的绝对目录
 */
export function resolveMcpCwd(projectRoot: string | null, userDataRoot: string): string {
  if (projectRoot && existsSync(projectRoot)) return projectRoot
  const sandbox = join(userDataRoot, 'mcp-sandbox')
  if (!existsSync(sandbox)) {
    mkdirSync(sandbox, { recursive: true })
  }
  return sandbox
}

/**
 * 构造最小化子进程环境：系统白名单 + 工具链变量 + 用户显式配置 + KunYu 注入。
 * @param pluginEnv 用户在安装弹窗里为该插件填写的环境变量（如 GITHUB_TOKEN）
 * @param cwd 沙箱工作目录（注入 KUNYU_PROJECT_ROOT）
 */
export function buildSandboxEnv(
  pluginEnv: Record<string, string>,
  cwd: string
): Record<string, string> {
  const allow = new Set(
    (process.platform === 'win32' ? WIN_ENV_ALLOWLIST : NIX_ENV_ALLOWLIST).concat(TOOLCHAIN_ENV)
  )
  const out: Record<string, string> = {}
  for (const key of allow) {
    const v = process.env[key]
    if (typeof v === 'string' && v.length > 0) out[key] = v
  }
  // 用户显式配置的插件变量（密钥等）最后叠加，可覆盖白名单
  for (const [k, v] of Object.entries(pluginEnv ?? {})) {
    if (typeof v === 'string' && v.length > 0) out[k] = v
  }
  out['KUNYU_PROJECT_ROOT'] = cwd
  out['KUNYU_MCP_SANDBOX'] = '1'
  return out
}
