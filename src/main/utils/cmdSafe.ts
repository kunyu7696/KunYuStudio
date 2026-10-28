/**
 * cmd.exe 安全校验（S-01：命令注入）。
 *
 * Windows 下通过 `cmd.exe /c <str>` 执行时，cmd 会对整条命令行做**二次解析**，
 * 未转义的 `& | ; < > ^ % ! "` 具备语法意义（命令分隔 / 管道 / 重定向 / 转义 /
 * 变量展开 / 引号分组），可导致任意命令注入。Node 的 spawn 虽会自动给含空格的
 * 参数加双引号，但对 `&` 等元字符无效——已复现 `wrapper` 路径含 `&`
 * 时 `whoami` 被执行。
 *
 * 最稳妥的修复是**拒绝这些字符进入 cmd /c**（路径、包名、CLI 参数正常情况下
 * 均不含它们）。非 Windows 路径不经 cmd.exe，无需校验。
 */

/** cmd.exe 元字符集合（含引号，防止引号注入） */
const CMD_META_RE = /[&|;<>^%!"]/

/**
 * 断言字符串可安全进入 `cmd.exe /c`，否则抛错。
 * @param label 用于错误信息的标签（如"项目路径""MCP 命令"）
 */
export function assertCmdSafe(label: string, value: string): void {
  if (CMD_META_RE.test(value)) {
    throw new Error(
      `${label} 包含危险字符（& | ; < > ^ % ! "），无法安全通过 cmd.exe 执行`
    )
  }
}

/** 谓词形式，供需要软失败的场景使用 */
export function isCmdSafe(value: string): boolean {
  return !CMD_META_RE.test(value)
}
