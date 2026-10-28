/**
 * 工具结果文本截断（从 toolRegistry.ts 拆出的共享叶件）。
 * 片段文件经此引用常量与截断函数，避免反向依赖 toolRegistry 主文件造成运行时循环。
 */

/** 工具结果回填给模型前的文本截断上限 */
export const TOOL_RESULT_CLIP = 8_000

export function clipToolText(text: string, max = TOOL_RESULT_CLIP): string {
  return text.length <= max ? text : `${text.slice(0, max)}…（已截断）`
}
