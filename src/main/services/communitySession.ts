/**
 * 社区桥接 <webview> 分区（persist:community）会话配置。
 *
 * 背景：Planet Minecraft 等 Cloudflare Under Attack 站点做浏览器一致性校验，
 * UA 字符串与 sec-ch-ua 客户端提示必须同源。此前渲染层把 UA 写死为 Chrome 136，
 * 而 Electron 实际 Chromium 版本更高——版本对不上会被判定为伪造浏览器，
 * 挑战脚本反复重载（__cf_chl_rt_tk 死循环），交互式人机验证永远渲染不出来。
 *
 * 解法：在分区级 session 上用 process.versions.chrome（真实 Chromium 版本）
 * 构造 UA，UA 与 sec-ch-ua 一致后挑战页可正常渲染，由开发者自行完成验证；
 * cf_clearance 存进持久分区，后续访问免挑战。分区级设置对子框架同样生效，
 * 比 webview 的 useragent 属性（仅顶层）更彻底。
 */
import { session } from 'electron'

/** 社区桥接 webview 使用的持久分区名（与 CommunityView.vue 的 partition 属性一致） */
export const COMMUNITY_PARTITION = 'persist:community'

/**
 * 允许挂载社区 webview 的平台主机（与 CommunityView 的平台页签一致，子域一并放行）。
 * 仅在 attach 时校验；页面内后续跳转到第三方站点是内嵌浏览的正常行为，
 * 相关内容运行在已剥离 preload、强制沙箱的独立 webContents 中。
 */
export const COMMUNITY_ALLOWED_HOSTS = [
  'mcmod.cn',
  'klpbbs.com',
  'minebbs.com',
  'littleskin.cn',
  'namemc.com',
  'bbsmc.net',
  'sodamc.com',
  'modrinth.com',
  'curseforge.com',
  'github.com'
] as const

/** 仅 https + 白名单主机（含子域）可挂载为社区 webview */
export function isAllowedCommunityUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:') return false
    return COMMUNITY_ALLOWED_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`))
  } catch {
    return false
  }
}

/** 访客页面允许申请的权限：仅「写入剪贴板」（站点复制按钮），其余（摄像头/麦克风/通知/地理位置/全屏等）一律拒绝 */
const ALLOWED_GUEST_PERMISSIONS = new Set(['clipboard-sanitized-write'])

/**
 * 按真实 Chromium 版本构造纯桌面 Chrome UA（不含 Electron 标识）。
 * @param chromeVersion process.versions.chrome，如 '142.0.7444.177'
 */
export function communityUserAgent(chromeVersion: string): string {
  return (
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    `(KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`
  )
}

/** 在社区分区上安装 UA 与权限策略（app ready 后、首个 webview 创建前调用一次） */
export function setupCommunitySession(): void {
  const sess = session.fromPartition(COMMUNITY_PARTITION)
  sess.setUserAgent(communityUserAgent(process.versions.chrome))
  // 权限默认拒绝：内嵌浏览只需展示页面，摄像头/麦克风/通知/地理位置/全屏等一律不授予。
  // 被拒权限由站点自身的错误提示体现，不静默放行任何能力。
  sess.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(ALLOWED_GUEST_PERMISSIONS.has(permission))
  })
  sess.setPermissionCheckHandler((_wc, permission) => ALLOWED_GUEST_PERMISSIONS.has(permission))
}
