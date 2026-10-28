/**
 * dev / 打包运行判别 —— 主进程所有 dev|prod 分支的唯一口径。
 *
 * 背景：Electron 44 起，`electron <路径>` 启动的 dev 模式下 app.isPackaged 同样
 * 返回 true（isPackaged 与 defaultApp 语义解耦，实测 dev 下 defaultApp=true 且
 * isPackaged=true）。单看 isPackaged 会把 dev 误判为打包版，资源目录随之解析到
 * <electron-dist>/resources 下——版本矩阵空白、mcdata/知识库/模型目录在 dev 失效
 * 均同此根因。
 *
 * 口径：app.isPackaged 为 true 且 process.defaultApp 不为 true 才算打包版。
 * - 真实 dev（electron <path>）：isPackaged=true、defaultApp=true ⇒ 非打包
 * - 真实打包版（自有可执行文件）：isPackaged=true、defaultApp=undefined ⇒ 打包
 * - 单测 mock app.isPackaged 的语义不变（mock true ⇒ 打包分支，vitest 无 defaultApp）
 *
 * 取 app 为入参而非自行 import 'electron'：mcDataService/knowledgeSearch 等模块
 * 会在无 electron 依赖的工具环境中被 import，本模块保持零依赖可被安全复用。
 */
export function isPackagedRuntime(app: { isPackaged: boolean } | undefined): boolean {
  const proc = process as NodeJS.Process & { defaultApp?: boolean }
  return app?.isPackaged === true && proc.defaultApp !== true
}
