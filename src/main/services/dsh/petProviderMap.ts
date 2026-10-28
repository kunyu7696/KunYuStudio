/**
 * kunyu 服务商 ↔ dsh-pet 内置余额 provider 的映射。
 *
 * dsh-pet 的余额查询只认识它内置的 provider id（端点在原作里写死，如
 * deepseek-official → https://api.deepseek.com/user/balance），凭证也按
 * 固定 ref（DEEPSEEK_API_KEY）经 ctx.credentials.resolve 取；
 * 而 kunyu 服务商 id 是随机生成的（ai-xxxx），必须按 baseUrl 归属映射后
 * 原作才能走通余额链路。无法映射的服务商保持原 id，原作自然回 unsupported。
 */

/** dsh-pet 内置：DeepSeek 官方端点服务商 */
export const DSH_BALANCE_PROVIDER_DEEPSEEK = 'deepseek-official'

/** dsh-pet 取 DeepSeek apiKey 的凭据 ref（credentialRef shim 透传原值） */
export const DSH_CREDENTIAL_DEEPSEEK_API_KEY = 'DEEPSEEK_API_KEY'

/** baseUrl 是否指向 DeepSeek 官方 API（兼容带 /v1、尾斜杠、大写等写法） */
export function isDeepSeekOfficialBaseUrl(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname.toLowerCase() === 'api.deepseek.com'
  } catch {
    return false
  }
}

/**
 * 按 kunyu 服务商 baseUrl 给出 dsh-pet 可识别的余额 provider id。
 * @returns 认识的官方服务商返回 dsh-pet provider id；其余返回 null（余额显示 unsupported）
 */
export function dshBalanceProviderId(baseUrl: string): string | null {
  return isDeepSeekOfficialBaseUrl(baseUrl) ? DSH_BALANCE_PROVIDER_DEEPSEEK : null
}

/**
 * dsh-pet provider id 反查 kunyu 服务商 id（对话/碎碎念的 llm 调用走 kunyu 通道）。
 * 在给出的 provider 列表里按归属匹配；匹配不到原样返回。
 */
export function kunyuProviderIdForDsh(
  dshProviderId: string,
  providers: Array<{ id: string; baseUrl: string }>
): string {
  const hit = providers.find((p) => dshBalanceProviderId(p.baseUrl) === dshProviderId)
  return hit?.id ?? dshProviderId
}

/** dsh-pet 凭据 ref 是否 DeepSeek apiKey；不是返回 false（宿主 resolve 回 undefined） */
export function isDeepSeekCredentialRef(ref: unknown): boolean {
  return String(ref ?? '') === DSH_CREDENTIAL_DEEPSEEK_API_KEY
}
