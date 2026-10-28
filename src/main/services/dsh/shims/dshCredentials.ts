/**
 * Shim：@deepseek-ai/dsh-credentials（dsh-pet 未公开 peer 包）
 * credentialRef 透传（插件侧固定传 DEEPSEEK_API_KEY 等字符串 ref）；
 * 宿主侧 credentials.resolve 由 petService.resolvePetCredential 提供真实 apiKey
 * （仅官方 DeepSeek 服务商），无凭证时返回 undefined，插件显示余额不可用。
 */
export const dshCredentialsShim = [
  '// kunyu DSH 兼容宿主本地桩：credentialRef 透传（ref 原样传入宿主 resolve）',
  'export function credentialRef(ref) {',
  '  return ref',
  '}',
  ''
].join('\n')
