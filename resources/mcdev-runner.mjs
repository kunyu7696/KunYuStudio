/**
 * mcdev-mcp 内置启动器（随应用 extraResources 分发）。
 *
 * 背景：本应用以 ELECTRON_RUN_AS_NODE=1 方式让打包版 Electron 充当 Node 运行时
 * 直接执行 mcdev-mcp 的 ESM CLI，用户无需自行安装 Node.js / npx。
 * 但 mcdev-mcp 的 CLI 使用 commander 的 `program.parse()` 无参形式，commander
 * 一旦检测到 process.versions.electron 就按 Electron 约定切片 argv：
 *   - process.defaultApp=false（打包态）→ userArgs = argv.slice(1)
 * 于是脚本自身路径被误认为子命令，serve / init 均报 "unknown command"。
 *
 * 本启动器在 import 真正 CLI 之前把 process.defaultApp 置为 true，
 * 使 commander 走 argv.slice(2) 的标准 Node 语义（argv[0]=exe、argv[1]=脚本）。
 * 真正 CLI 入口路径由主进程通过环境变量 MCDEV_CLI_ENTRY 注入（必须是绝对路径）。
 */
try {
  Object.defineProperty(process, 'defaultApp', { value: true, configurable: true })
} catch {
  /* 非 Electron 运行时或属性不可写：忽略，标准 Node 下本就切片正确 */
}

const entry = process.env.MCDEV_CLI_ENTRY
if (!entry) {
  process.stderr.write('mcdev-runner: MCDEV_CLI_ENTRY is required\n')
  process.exit(2)
}

const { pathToFileURL } = await import('node:url')
await import(pathToFileURL(entry).href)
