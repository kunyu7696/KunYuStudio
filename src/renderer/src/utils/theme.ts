/**
 * 主题模式应用：dark / light / system。
 * 解析结果缓存到 localStorage，main.ts 在 mount 前读取以避免首帧主题闪烁（FOUC）。
 */
import type { ThemeMode } from '../../../shared/types/settings'

const CACHE_KEY = 'kunyu:theme'

function systemPrefersDark(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  )
}

export function resolveTheme(mode: ThemeMode): 'dark' | 'light' {
  if (mode === 'system') return systemPrefersDark() ? 'dark' : 'light'
  return mode
}

function applyResolved(resolved: 'dark' | 'light'): void {
  const el = document.documentElement
  el.classList.toggle('dark', resolved === 'dark')
  el.classList.toggle('light', resolved === 'light')
}

let currentMode: ThemeMode = 'dark'
let mediaBound = false

/** system 模式下监听操作系统亮暗切换 */
function bindMediaListener(): void {
  if (mediaBound || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
  mediaBound = true
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (currentMode === 'system') applyResolved(resolveTheme('system'))
  })
}

/** 设置主题模式并立即应用；system 模式下缓存解析结果并跟随系统切换 */
export function setThemeMode(mode: ThemeMode): void {
  currentMode = mode
  const resolved = resolveTheme(mode)
  applyResolved(resolved)
  try {
    localStorage.setItem(CACHE_KEY, resolved)
  } catch {
    /* 隐私模式等场景写入失败时忽略，主题仍随设置生效 */
  }
  bindMediaListener()
}

/** mount 前按缓存的解析结果加 class，避免首帧主题闪烁；无缓存默认 dark */
export function applyInitialThemeFromCache(): void {
  let cached: string | null = null
  try {
    cached = localStorage.getItem(CACHE_KEY)
  } catch {
    /* 读取失败按默认 dark */
  }
  applyResolved(cached === 'light' ? 'light' : 'dark')
}
