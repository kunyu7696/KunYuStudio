/**
 * 系统目录判定。
 *
 * PROJECT_RELOCATE 等通道会把渲染层选定的目录登记为项目可写根；
 * 必须拒绝系统目录（C:\\Windows / Program Files / ProgramData / 启动菜单 / 盘根 /
 * 应用自身目录），否则攻击者可经渲染层 XSS 把系统目录登记为可写根，
 * 再经 FS_WRITE_FILE 写任意扩展名 → 持久化 RCE。
 *
 * 独立模块便于单测，不引入 projectService / db 等重依赖。
 */
import { app } from 'electron'
import { existsSync, realpathSync, statSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { platform, tmpdir } from 'node:os'

const isWindows = platform() === 'win32'

/** 路径归一化：resolve + 小写，便于前缀比较（Windows 大小写不敏感） */
function norm(p: string): string {
  return resolve(p).toLowerCase()
}

/** target 是否等于 root 或落在 root 内 */
function isUnderOrEqual(target: string, root: string): boolean {
  const t = norm(target)
  const r = norm(root)
  if (t === r) return true
  return t.startsWith(r + sep)
}

/**
 * 判定路径是否为系统目录（或落在系统目录内）。
 * 非目录或不存在返回 false（调用方先经 dialog 选目录，存在性由调用方保证）。
 */
export function isSystemDirectory(p: string): boolean {
  if (!existsSync(p) || !statSync(p).isDirectory()) return false
  const targets: string[] = []
  if (isWindows) {
    targets.push(
      process.env.SystemRoot ?? 'C:\\Windows',
      process.env.ProgramFiles ?? 'C:\\Program Files',
      process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)',
      process.env.ProgramData ?? 'C:\\ProgramData'
    )
    // 启动菜单（持久化 RCE 风险最高）
    const appdata = process.env.APPDATA
    if (appdata) targets.push(join(appdata, 'Microsoft', 'Windows', 'Start Menu'))
  } else {
    targets.push('/usr', '/etc', '/var', '/bin', '/sbin', '/boot', '/lib', '/lib64', '/proc', '/sys', '/dev')
    // macOS 每用户临时目录位于 /var/folders 下（/var 是 /private/var 的符号链接），
    // 属合法用户空间；落在临时目录内的路径不触发 /var 系统目录判定（mac CI 实证误判）
    if (platform() === 'darwin') {
      const tmpRoots = [tmpdir()]
      try {
        tmpRoots.push(realpathSync(tmpdir()))
      } catch {
        /* realpath 失败仅用词法路径 */
      }
      if (tmpRoots.some((t) => isUnderOrEqual(p, t))) {
        const idx = targets.indexOf('/var')
        if (idx >= 0) targets.splice(idx, 1)
      }
    }
  }
  // 应用自身目录与 userData（防止把 app 资源登记为可写根后被篡改）
  targets.push(app.getAppPath())
  targets.push(app.getPath('userData'))
  // 盘根 / OS 根
  if (isWindows ? /^[a-z]:\\?$/.test(norm(p)) : norm(p) === '/') return true
  return targets.some((t) => isUnderOrEqual(p, t))
}
