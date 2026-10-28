/**
 * Shim：@electron/get + @electron-internal/extract-zip（dsh-pet 未公开 peer 包）
 * 仅 Electron 运行时下载兜底链路引用；kunyu 已优先探测 DSH 自带/本地 electron，
 * 落到下载兜底时给出明确指引而非静默失败。
 */
const ELECTRON_DOWNLOAD_MESSAGE =
  'kunyu 未内置 Electron 运行时下载；请将 electron 可执行文件放置到 %DSH_HOME%/electron/，或设置环境变量 DSH_PET_ELECTRON_PATH 指向 electron 可执行文件'

export const electronGetShim = [
  '// kunyu DSH 兼容宿主本地桩（@electron/get）：仅 Electron 运行时下载兜底链路使用',
  '// 坤宇已优先探测 DSH 自带/本地 electron，落到下载兜底时给出明确指引而非静默失败',
  'const message =',
  `  "${ELECTRON_DOWNLOAD_MESSAGE}"`,
  'export async function downloadArtifact() {',
  '  throw new Error(message)',
  '}',
  ''
].join('\n')

export const electronExtractZipShim = [
  '// kunyu DSH 兼容宿主本地桩（@electron-internal/extract-zip）：仅 Electron 运行时下载兜底链路使用',
  '// 坤宇已优先探测 DSH 自带/本地 electron，落到下载兜底时给出明确指引而非静默失败',
  'const message =',
  `  "${ELECTRON_DOWNLOAD_MESSAGE}"`,
  'async function extract() {',
  '  throw new Error(message)',
  '}',
  'export default extract',
  ''
].join('\n')
