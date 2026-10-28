import { computed, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useSettingsStore } from '../../../stores/settings'
import {
  AI_PROVIDER_PRESETS,
  createCustomProvider,
  createPresetProvider,
  type AiErrorKind,
  type AiProviderConfig,
  type AiProviderPreset
} from '../../../../../shared/types/ai'
import type { ProviderDraft, TestState } from './types'
import { t } from '../../../i18n'

/** 错误类型文案（函数取值，保证语言切换后重算） */
function errorKindLabel(kind: AiErrorKind): string {
  switch (kind) {
    case 'network':
      return t('settings.ai.errKindNetwork')
    case 'timeout':
      return t('settings.ai.errKindTimeout')
    case 'auth':
      return t('settings.ai.errKindAuth')
    case 'model':
      return t('settings.ai.errKindModel')
    case 'server':
      return t('settings.ai.errKindServer')
    case 'config':
      return t('settings.ai.errKindConfig')
    case 'rateLimit':
      return t('settings.ai.errKindRateLimit')
  }
}

// ---------- 栏 1：推荐厂商 ----------
const openaiPresets: AiProviderPreset[] = AI_PROVIDER_PRESETS.filter(
  (p) => p.kind === 'openai-compatible'
)
const ollamaPreset = AI_PROVIDER_PRESETS.find((p) => p.kind === 'ollama')
const PRESET_URLS = new Set(openaiPresets.map((p) => p.baseUrl))

export function useAiProviders() {
  const settings = useSettingsStore()
  const providers = computed(() => settings.ai.providers)

  /** 各栏「获取模型列表」的临时状态（按 provider id 隔离） */
  const modelOptionsMap = ref<Record<string, string[]>>({})
  const fetchingId = ref<string | null>(null)
  /** 模型列表新鲜度：fetchedAt 来自主进程缓存/实时拉取 */
  const modelMetaMap = ref<Record<string, { fetchedAt: number; fromCache: boolean }>>({})
  /** 上次拉取失败原因（自动拉取失败时静默展示，不弹窗） */
  const modelErrorMap = ref<Record<string, string>>({})

  // ---------- 测试状态 ----------
  const testStates = ref<Record<string, TestState>>({})

  function state(id: string): TestState | undefined {
    return testStates.value[id]
  }

  async function runTest(id: string): Promise<void> {
    testStates.value[id] = { status: 'testing' }
    const res = await window.api.ai.test(id)
    if (res.ok) {
      testStates.value[id] = { status: 'ok', latencyMs: res.latencyMs }
    } else {
      testStates.value[id] = {
        status: 'fail',
        errorMessage: t('settings.ai.testErrLine', {
          kind: errorKindLabel(res.errorKind ?? 'server'),
          msg: res.errorMessage ?? t('settings.unknownError')
        })
      }
    }
  }

  // ---------- 三栏草稿模型 ----------
  function toDraft(p: AiProviderConfig, persisted: boolean): ProviderDraft {
    return {
      id: p.id,
      kind: p.kind,
      name: p.name,
      baseUrl: p.baseUrl,
      apiKeyUrl: p.apiKeyUrl,
      model: p.model,
      imageModel: p.imageModel ?? '',
      maxTokens: p.maxTokens,
      contextWindow: p.contextWindow ?? 0,
      temperature: p.temperature,
      apiKeyInput: '',
      hasKey: Boolean(p.apiKey),
      clearKey: false,
      persisted
    }
  }

  function findProvider(id: string): AiProviderConfig | undefined {
    return providers.value.find((p) => p.id === id)
  }

  function enabledOf(d: ProviderDraft | null): boolean {
    return d ? findProvider(d.id)?.enabled ?? false : false
  }

  /** 草稿校验并落盘（新增或更新）；返回是否成功 */
  async function saveDraft(d: ProviderDraft): Promise<boolean> {
    const name = d.name.trim()
    const baseUrl = d.baseUrl.trim()
    if (!name) {
      ElMessage.error(t('settings.ai.errNameRequired'))
      return false
    }
    if (!/^https?:\/\//.test(baseUrl)) {
      ElMessage.error(t('settings.ai.errEndpointInvalid'))
      return false
    }
    const existing = findProvider(d.id)
    const apiKey = d.clearKey ? '' : d.apiKeyInput ? d.apiKeyInput : existing?.apiKey ?? ''
    const config: AiProviderConfig = {
      id: d.id,
      name,
      kind: d.kind,
      baseUrl,
      apiKey,
      apiKeyUrl: d.apiKeyUrl,
      model: d.model.trim(),
      imageModel: d.imageModel.trim(),
      maxTokens: d.maxTokens,
      contextWindow: d.contextWindow > 0 ? d.contextWindow : undefined,
      temperature: d.temperature,
      enabled: existing?.enabled ?? true
    }
    const next = d.persisted
      ? providers.value.map((p) => (p.id === d.id ? config : p))
      : [...providers.value, config]
    await settings.patchSection('ai', { providers: next })
    d.persisted = true
    d.hasKey = Boolean(apiKey)
    d.apiKeyInput = ''
    d.clearKey = false
    ElMessage.success(t('settings.ai.savedOk', { name }))
    return true
  }

  async function testDraft(d: ProviderDraft | null): Promise<void> {
    if (!d) return
    if (!d.persisted) {
      ElMessage.warning(t('settings.ai.saveFirstTest'))
      return
    }
    await runTest(d.id)
  }

  async function onToggleEnabled(d: ProviderDraft | null, enabled: boolean): Promise<void> {
    const p = d ? findProvider(d.id) : undefined
    if (!p) return
    await settings.patchSection('ai', {
      providers: providers.value.map((x) => (x.id === p.id ? { ...x, enabled } : x))
    })
  }

  async function onSetDefault(d: ProviderDraft | null): Promise<void> {
    if (!d) return
    if (!d.persisted) {
      ElMessage.warning(t('settings.ai.saveFirstDefault'))
      return
    }
    await settings.patchSection('ai', { defaultProviderId: d.id })
  }

  /**
   * 拉取模型列表。silent=true 用于进入设置页自动同步：失败不弹窗，只在状态行提示；
   * force=true 跳过主进程 24h 缓存强制联网（用户点「刷新」）。
   */
  async function fetchModels(
    providerId: string,
    opts: { silent?: boolean; force?: boolean } = {}
  ): Promise<void> {
    fetchingId.value = providerId
    const res = await window.api.ai.listModels(providerId, opts.force)
    fetchingId.value = null
    if (res.ok) {
      modelOptionsMap.value[providerId] = res.data.models
      modelMetaMap.value[providerId] = {
        fetchedAt: res.data.fetchedAt,
        fromCache: res.data.fromCache
      }
      delete modelErrorMap.value[providerId]
      if (res.data.models.length === 0 && !opts.silent) {
        ElMessage.warning(t('settings.ai.noModels'))
      }
      return
    }
    modelErrorMap.value[providerId] = t('settings.ai.testErrLine', {
      kind: errorKindLabel(res.errorKind),
      msg: res.errorMessage
    })
    if (!opts.silent) {
      ElMessage.error(modelErrorMap.value[providerId])
    }
  }

  /** 获取模型列表前先确保草稿已落盘（接口读的是已存配置） */
  async function fetchModelsFor(
    d: ProviderDraft | null,
    opts: { silent?: boolean; force?: boolean } = {}
  ): Promise<void> {
    if (!d) return
    if (!d.persisted) {
      // 自动同步不做隐式保存；手动拉取时先落盘
      if (opts.silent) return
      const ok = await saveDraft(d)
      if (!ok) return
    }
    await fetchModels(d.id, opts)
  }

  /** 模型选项 = 实时拉取结果在前 + 预设推荐模型补缺（去重） */
  function allModelOptions(d: ProviderDraft): string[] {
    const fetched = modelOptionsMap.value[d.id] ?? []
    const preset = openaiPresets.find((p) => p.baseUrl === d.baseUrl)
    const recommended = preset?.recommendedModels ?? (preset?.recommendedModel ? [preset.recommendedModel] : [])
    const seen = new Set<string>()
    const merged: string[] = []
    for (const m of [...fetched, ...recommended]) {
      if (m && !seen.has(m)) { seen.add(m); merged.push(m) }
    }
    return merged
  }

  /** 模型列表同步状态文案：显示数量与新鲜度，失败时如实说明当前是内置列表 */
  function modelStatus(d: ProviderDraft): string {
    const meta = modelMetaMap.value[d.id]
    const count = modelOptionsMap.value[d.id]?.length ?? 0
    const error = modelErrorMap.value[d.id]
    if (error && !meta) return t('settings.ai.modelStatusUnreachable')
    if (!meta) return ''
    const ago = formatAgo(meta.fetchedAt)
    if (error) return t('settings.ai.modelStatusFail', { count, ago })
    return meta.fromCache
      ? t('settings.ai.modelStatusCache', { count, ago })
      : t('settings.ai.modelStatusFresh', { count, ago })
  }

  function formatAgo(ts: number): string {
    const diff = Date.now() - ts
    if (diff < 60_000) return t('settings.ai.agoJust')
    if (diff < 3_600_000) return t('settings.ai.agoMinutes', { n: Math.floor(diff / 60_000) })
    if (diff < 86_400_000) return t('settings.ai.agoHours', { n: Math.floor(diff / 3_600_000) })
    return t('settings.ai.agoDays', { n: Math.floor(diff / 86_400_000) })
  }

  /** 进入设置页自动同步：已配 Key（或 Ollama）的厂商各拉一次，命中缓存则零请求 */
  function autoFetchModels(): void {
    for (const p of providers.value) {
      if (p.enabled && (p.kind === 'ollama' || Boolean(p.apiKey))) {
        void fetchModels(p.id, { silent: true })
      }
    }
  }

  const presetUrl = ref('')
  const presetDraft = ref<ProviderDraft | null>(null)

  function onSelectPreset(url: string): void {
    const preset = openaiPresets.find((p) => p.baseUrl === url)
    if (!preset) return
    const existing = providers.value.find((p) => p.kind === 'openai-compatible' && p.baseUrl === url)
    if (existing) {
      presetDraft.value = toDraft(existing, true)
    } else {
      // 未添加过：用预设生成未落盘草稿，保存后才进入提供商列表
      presetDraft.value = toDraft(createPresetProvider(preset), false)
    }
  }

  // ---------- 栏 2：自定义厂商 ----------
  const customProviders = computed(() =>
    providers.value.filter((p) => p.kind === 'openai-compatible' && !PRESET_URLS.has(p.baseUrl))
  )
  const customSelectedId = ref('')
  const customDraft = ref<ProviderDraft | null>(null)

  function onSelectCustom(id: string): void {
    const p = customProviders.value.find((x) => x.id === id)
    customDraft.value = p ? toDraft(p, true) : null
  }

  function newCustom(): void {
    customSelectedId.value = ''
    customDraft.value = toDraft(createCustomProvider(), false)
  }

  async function removeCustom(d: ProviderDraft): Promise<void> {
    try {
      await ElMessageBox.confirm(
        t('settings.ai.removeConfirm', { name: d.name || d.id }),
        t('settings.ai.removeTitle'),
        { type: 'warning', confirmButtonText: t('settings.ai.delete'), cancelButtonText: t('common.cancel') }
      )
    } catch {
      return
    }
    const next = providers.value.filter((x) => x.id !== d.id)
    const patch: { providers: AiProviderConfig[]; defaultProviderId?: string | null } = { providers: next }
    if (settings.ai.defaultProviderId === d.id) patch.defaultProviderId = null
    await settings.patchSection('ai', patch)
    delete testStates.value[d.id]
    customDraft.value = null
    customSelectedId.value = customProviders.value[0]?.id ?? ''
    if (customSelectedId.value) onSelectCustom(customSelectedId.value)
    ElMessage.success(t('settings.ai.removed'))
  }

  // ---------- 栏 3：Ollama ----------
  const ollamaDraft = ref<ProviderDraft>(
    toDraft(ollamaPreset ? createPresetProvider(ollamaPreset) : createCustomProvider(), false)
  )

  const OLLAMA_DOWNLOAD_URL = 'https://ollama.com/download'
  function openOllamaDownload(): void {
    void window.api.shell.openExternal(OLLAMA_DOWNLOAD_URL)
  }

  function openApiKeyUrl(url: string): void {
    if (url) void window.api.shell.openExternal(url)
  }

  /** 进入分类：自动选中已配置的栏位；Ollama 已保存则自动探测（FR-16） */
  function initProviderColumns(): void {
    const firstPreset = providers.value.find(
      (p) => p.kind === 'openai-compatible' && PRESET_URLS.has(p.baseUrl)
    )
    if (firstPreset) {
      presetUrl.value = firstPreset.baseUrl
      onSelectPreset(firstPreset.baseUrl)
    }
    const firstCustom = customProviders.value[0]
    if (firstCustom) {
      customSelectedId.value = firstCustom.id
      onSelectCustom(firstCustom.id)
    }
    const existingOllama = providers.value.find((p) => p.kind === 'ollama')
    if (existingOllama) {
      ollamaDraft.value = toDraft(existingOllama, true)
      void runTest(existingOllama.id)
    }
  }

  return {
    providers,
    fetchingId,
    state,
    enabledOf,
    saveDraft,
    testDraft,
    onToggleEnabled,
    onSetDefault,
    fetchModelsFor,
    allModelOptions,
    modelStatus,
    autoFetchModels,
    openApiKeyUrl,
    openaiPresets,
    presetUrl,
    presetDraft,
    onSelectPreset,
    customProviders,
    customSelectedId,
    customDraft,
    onSelectCustom,
    newCustom,
    removeCustom,
    ollamaDraft,
    openOllamaDownload,
    initProviderColumns
  }
}
