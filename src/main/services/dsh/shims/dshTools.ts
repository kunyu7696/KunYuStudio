/**
 * Shim：@deepseek-ai/dsh-tools（目录内非公开服务包）
 * 仅有明确约定的 defineTool / defineToolGroup 走声明式透传，实际注册走宿主 tools 服务。
 */
export const dshToolsShim = [
  '// kunyu DSH 兼容宿主本地桩：defineTool 为声明式透传，实际注册走宿主 tools 服务',
  'export function defineTool(def) {',
  '  return def',
  '}',
  'export function defineToolGroup(def) {',
  '  return def',
  '}',
  'export default { defineTool, defineToolGroup }',
  ''
].join('\n')
