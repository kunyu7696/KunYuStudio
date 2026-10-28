/**
 * Shim：@deepseek-ai/dsh-home-paths（dsh-pet 未公开 peer 包）
 * resolveDshHome() 同步返回 home 路径，与安装通道同公式（DSH_HOME env 优先回退 ~/.dsh）。
 */
export const dshHomePathsShim = [
  '// kunyu DSH 兼容宿主本地桩：与 dsh-pet 安装通道同公式（DSH_HOME env 优先回退 ~/.dsh）',
  'import { homedir } from "node:os"',
  'import { join } from "node:path"',
  'export function resolveDshHome() {',
  '  return process.env.DSH_HOME || join(homedir(), ".dsh")',
  '}',
  ''
].join('\n')
