/**
 * DSH 社区插件的本地桩注册表：每个桩一个文件，按包名映射到 index.js 源码。
 * 新增插件的未公开 peer 依赖时在此登记，安装通道统一经 shimIndexSource 落盘。
 */
import { dshCredentialsShim } from './dshCredentials'
import { dshHomePathsShim } from './dshHomePaths'
import { dshLlmShim } from './dshLlm'
import { dshToolsShim } from './dshTools'
import { electronExtractZipShim, electronGetShim } from './electronDownload'

const SHIM_SOURCES: Record<string, string> = {
  '@deepseek-ai/dsh-tools': dshToolsShim,
  '@deepseek-ai/dsh-llm': dshLlmShim,
  '@deepseek-ai/dsh-home-paths': dshHomePathsShim,
  '@deepseek-ai/dsh-credentials': dshCredentialsShim,
  '@electron/get': electronGetShim,
  '@electron-internal/extract-zip': electronExtractZipShim
}

/** 取桩的 index.js 源码；未登记的包名回退最小占位（缺失能力在加载报告中体现） */
export function shimIndexSource(shimName: string): string {
  return (
    SHIM_SOURCES[shimName] ?? [
      `// kunyu DSH 兼容宿主本地桩（${shimName}）：最小占位，缺失能力在加载报告中体现`,
      'const stub = {}',
      'export default stub',
      ''
    ].join('\n')
  )
}

/**
 * dsh-pet 的未公开 peer 包：DSH 桌面端由运行时 bundle 注入（物理不存在），
 * 公共 npm 上只有 0.0.1-rc.x 旧版，装不动。副本落位后按清单写本地桩，
 * 依赖解析走 node_modules 向上查找（dsh-pet/lib → …/dsh-plugins/node_modules）。
 * dsh-llm/dsh-home-paths/dsh-credentials 有完整语义，@electron/get 与
 * @electron-internal/extract-zip 仅 Electron 下载兜底用（探测几乎必命中），落抛错桩。
 */
export const DSH_PET_SHIMS = [
  '@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-home-paths',
  '@deepseek-ai/dsh-credentials',
  '@electron/get',
  '@electron-internal/extract-zip'
]
