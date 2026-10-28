<template>
  <div class="pane">
    <header class="pane-head">
      <h2>{{ t('settings.ai.title') }}</h2>
      <p>
        {{ t('settings.ai.headerDesc') }}
      </p>
    </header>

    <!-- 版本矩阵健康度（技术债 #7） -->
    <section class="ext-card">
      <div class="ext-top">
        <div class="ext-title">
          <span class="ext-name">{{ t('settings.ai.matrix.section') }}</span>
          <el-tag size="small" effect="plain">{{ t('settings.ai.matrix.tag') }}</el-tag>
        </div>
        <el-button size="small" :loading="matrixLoading" @click="refreshMatrixHealth">{{ t('settings.ai.refresh') }}</el-button>
      </div>
      <p class="ext-desc">
        {{ t('settings.ai.matrix.desc') }}
      </p>
      <div v-if="matrixHealthRows.length === 0" class="ext-empty">
        {{ t('settings.ai.matrix.empty') }}
      </div>
      <el-table v-else :data="matrixHealthRows" size="small" class="matrix-table">
        <el-table-column prop="loader" label="Loader" width="90" />
        <el-table-column prop="mcVersion" :label="t('settings.ai.matrix.colMcVersion')" width="90" />
        <el-table-column prop="templateCount" :label="t('settings.ai.matrix.colTemplateCount')" width="90" align="right" />
        <el-table-column prop="verifiedCount" :label="t('settings.ai.matrix.colVerified')" width="80" align="right" />
        <el-table-column prop="passRate" :label="t('settings.ai.matrix.colPassRate')" width="130" align="right">
          <template #default="{ row }">
            {{ row.passRate }}%
          </template>
        </el-table-column>
        <el-table-column prop="lastVerifiedAt" :label="t('settings.ai.matrix.colLastVerified')" min-width="120">
          <template #default="{ row }">
            {{ formatMatrixTime(row.lastVerifiedAt) }}
          </template>
        </el-table-column>
        <el-table-column :label="t('settings.ai.matrix.colHealth')" width="90" align="center">
          <template #default="scope">
            <span class="ext-dot" :class="matrixHealthDotClass(scope.row as MatrixHealthRow)" :title="matrixHealthLabel(scope.row as MatrixHealthRow)" />
          </template>
        </el-table-column>
      </el-table>
    </section>

    <!-- 三栏配置：推荐厂商 / 自定义厂商 / 本地 Ollama -->
    <section class="ai-cols" data-setting-id="ai-default-provider">
      <!-- 栏 1：预置推荐厂商 -->
      <article class="ai-col">
        <div class="aic-head">
          <h3>{{ t('settings.ai.presetTitle') }}</h3>
          <span class="aic-sub">{{ t('settings.ai.presetSub') }}</span>
        </div>

        <el-select
          v-model="presetUrl"
          :placeholder="t('settings.ai.presetPh')"
          class="aic-select"
          @change="onSelectPreset"
        >
          <el-option
            v-for="ps in openaiPresets"
            :key="ps.baseUrl"
            :label="ps.name"
            :value="ps.baseUrl"
          />
        </el-select>

        <template v-if="presetDraft">
          <code class="aic-endpoint" :title="presetDraft.baseUrl">{{ presetDraft.baseUrl }}</code>

          <label class="aic-label">{{ t('settings.ai.apiKey') }}</label>
          <el-input
            v-model="presetDraft.apiKeyInput"
            type="password"
            show-password
            autocomplete="new-password"
            :placeholder="presetDraft.hasKey ? t('settings.ai.apiKeyConfigured') : t('settings.ai.apiKeyPh')"
          />
          <div class="aic-key-tools">
            <a class="aic-link" @click="openApiKeyUrl(presetDraft.apiKeyUrl)">
              {{ t('settings.ai.getKeyAt', { name: presetDraft.name }) }}
            </a>
            <a
              v-if="presetDraft.hasKey"
              class="aic-link aic-link-danger"
              @click="presetDraft.clearKey = !presetDraft.clearKey"
            >
              {{ presetDraft.clearKey ? t('settings.ai.keepKey') : t('settings.ai.clearKey') }}
            </a>
          </div>

          <ProviderModelFields :draft="presetDraft" @fetch="fetchModelsFor(presetDraft, { force: true })" />

          <TestResultLine :state="state(presetDraft?.id ?? '')" kind="openai-compatible" />

          <div class="aic-footer">
            <el-switch
              :model-value="enabledOf(presetDraft)"
              :disabled="!presetDraft.persisted"
              @change="(v) => onToggleEnabled(presetDraft, v === true)"
            />
            <el-radio
              :model-value="settings.ai.defaultProviderId ?? ''"
              :value="presetDraft.id"
              :disabled="!presetDraft.persisted"
              class="aic-default"
              @change="onSetDefault(presetDraft)"
            >
              {{ t('settings.ai.default') }}
            </el-radio>
            <div class="aic-spacer" />
            <el-button size="small" @click="testDraft(presetDraft)">{{ t('settings.ai.test') }}</el-button>
            <el-button size="small" type="primary" @click="saveDraft(presetDraft)">{{ t('common.save') }}</el-button>
          </div>
          <p v-if="!presetDraft.persisted" class="aic-tip">{{ t('settings.ai.newProviderTip') }}</p>
        </template>
        <p v-else class="aic-tip">{{ t('settings.ai.presetEmptyTip') }}</p>
      </article>

      <!-- 栏 2：自定义厂商 -->
      <article class="ai-col">
        <div class="aic-head">
          <h3>{{ t('settings.ai.customTitle') }}</h3>
          <span class="aic-sub">{{ t('settings.ai.customSub') }}</span>
        </div>

        <div class="aic-custom-head">
          <el-select
            v-model="customSelectedId"
            :placeholder="t('settings.ai.customSelectPh')"
            class="aic-select"
            @change="onSelectCustom"
          >
            <el-option
              v-for="p in customProviders"
              :key="p.id"
              :label="p.name || t('settings.ai.unnamedProvider')"
              :value="p.id"
            />
          </el-select>
          <el-button size="small" :icon="Plus" @click="newCustom" />
        </div>

        <template v-if="customDraft">
          <label class="aic-label">{{ t('settings.ai.name') }}</label>
          <el-input v-model="customDraftView.name" maxlength="100" :placeholder="t('settings.ai.providerNamePh')" />

          <label class="aic-label">{{ t('settings.ai.apiEndpoint') }}</label>
          <el-input v-model="customDraftView.baseUrl" placeholder="https://api.example.com/v1" spellcheck="false" />

          <label class="aic-label">{{ t('settings.ai.apiKey') }}</label>
          <el-input
            v-model="customDraftView.apiKeyInput"
            type="password"
            show-password
            autocomplete="new-password"
            :placeholder="customDraftView.hasKey ? t('settings.ai.apiKeyConfigured') : t('settings.ai.apiKeyPh')"
          />
          <div class="aic-key-tools">
            <span class="aic-tip">{{ t('settings.ai.customKeyHint') }}</span>
            <a
              v-if="customDraftView.hasKey"
              class="aic-link aic-link-danger"
              @click="customDraftView.clearKey = !customDraftView.clearKey"
            >
              {{ customDraftView.clearKey ? t('settings.ai.keepKey') : t('settings.ai.clearKey') }}
            </a>
          </div>

          <ProviderModelFields :draft="customDraftView" @fetch="fetchModelsFor(customDraftView, { force: true })" />

          <TestResultLine :state="state(customDraftView.id ?? '')" kind="openai-compatible" />

          <div class="aic-footer">
            <el-switch
              :model-value="enabledOf(customDraftView)"
              :disabled="!customDraftView.persisted"
              @change="(v) => onToggleEnabled(customDraftView, v === true)"
            />
            <el-radio
              :model-value="settings.ai.defaultProviderId ?? ''"
              :value="customDraftView.id"
              :disabled="!customDraftView.persisted"
              class="aic-default"
              @change="onSetDefault(customDraftView)"
            >
              {{ t('settings.ai.default') }}
            </el-radio>
            <div class="aic-spacer" />
            <el-button size="small" @click="testDraft(customDraftView)">{{ t('settings.ai.test') }}</el-button>
            <el-button
              v-if="customDraftView.persisted"
              size="small"
              type="danger"
              plain
              @click="removeCustom(customDraftView)"
            >
              {{ t('settings.ai.delete') }}
            </el-button>
            <el-button size="small" type="primary" @click="saveDraft(customDraftView)">{{ t('common.save') }}</el-button>
          </div>
        </template>
        <p v-else class="aic-tip">{{ t('settings.ai.customEmptyTip') }}</p>
      </article>

      <!-- 栏 3：本地 Ollama -->
      <article class="ai-col">
        <div class="aic-head">
          <h3>{{ t('settings.ai.ollamaTitle') }}</h3>
          <span class="aic-sub">{{ t('settings.ai.ollamaSub') }}</span>
        </div>

        <label class="aic-label">{{ t('settings.ai.ollamaUrl') }}</label>
        <el-input v-model="ollamaDraft.baseUrl" placeholder="http://localhost:11434" spellcheck="false" />

        <div class="aic-key-tools">
          <span class="aic-tip">{{ t('settings.ai.ollamaHintA') }}<code>ollama pull</code>{{ t('settings.ai.ollamaHintB') }}</span>
        </div>

        <ProviderModelFields :draft="ollamaDraft" @fetch="fetchModelsFor(ollamaDraft, { force: true })" />

        <TestResultLine :state="state(ollamaDraft.id)" kind="ollama" @download="openOllamaDownload" />

        <div class="aic-footer">
          <el-switch
            :model-value="enabledOf(ollamaDraft)"
            :disabled="!ollamaDraft.persisted"
            @change="(v) => onToggleEnabled(ollamaDraft, v === true)"
          />
          <el-radio
            :model-value="settings.ai.defaultProviderId ?? ''"
            :value="ollamaDraft.id"
            :disabled="!ollamaDraft.persisted"
            class="aic-default"
            @change="onSetDefault(ollamaDraft)"
          >
            {{ t('settings.ai.default') }}
          </el-radio>
          <div class="aic-spacer" />
          <el-button size="small" @click="testDraft(ollamaDraft)">{{ t('settings.ai.test') }}</el-button>
          <el-button size="small" type="primary" @click="saveDraft(ollamaDraft)">{{ t('common.save') }}</el-button>
        </div>
        <p v-if="!ollamaDraft.persisted" class="aic-tip">{{ t('settings.ai.ollamaTip') }}</p>
      </article>
    </section>

    <!-- 档位模型可选覆盖 -->
    <section class="ext-card" data-setting-id="ai-tier-models">
      <div class="ext-top">
        <div class="ext-title">
          <span class="ext-name">{{ t('settings.ai.tierSection') }}</span>
          <el-tag size="small" effect="plain">{{ t('settings.ai.tierTag') }}</el-tag>
        </div>
      </div>
      <p class="ext-desc">
        {{ t('settings.ai.tierDesc') }}
      </p>
      <div v-for="tier in TIER_METAS" :key="tier.id" class="tier-model-row">
        <span class="tier-model-name" :title="tier.title">{{ tier.name }}</span>
        <el-select
          :model-value="settings.ai.tierModels[tier.id]?.providerId ?? ''"
          :placeholder="t('settings.ai.tierProviderPh')"
          clearable
          size="small"
          class="tier-model-provider"
          @change="(v) => onTierProviderChange(tier.id, (v as string | null) ?? null)"
        >
          <el-option
            v-for="p in providers"
            :key="p.id"
            :label="p.name || p.id"
            :value="p.id"
          />
        </el-select>
        <el-input
          :model-value="settings.ai.tierModels[tier.id]?.model ?? ''"
          :placeholder="t('settings.ai.tierModelPh')"
          size="small"
          class="tier-model-model"
          @change="(v) => onTierModelChange(tier.id, (v as string).trim() || null)"
        />
      </div>
    </section>

    <!-- M7：mcdev-mcp 静态检索 -->
    <section class="ext-card">
      <div class="ext-top" data-setting-id="ai-mcp-enabled">
        <div class="ext-title">
          <span class="ext-name">{{ t('settings.ai.mcp.section') }}</span>
          <span
            class="ext-dot"
            :class="mcpDotClass"
            :title="mcpKindLabel"
          />
          <el-tag size="small" effect="plain">{{ mcpKindLabel }}</el-tag>
        </div>
        <el-switch
          :model-value="settings.ai.mcpEnabled"
          :loading="mcpBusy"
          @change="(v) => toggleMcp(v === true)"
        />
      </div>
      <p class="ext-desc">
        {{ t('settings.ai.mcp.desc') }}
      </p>
      <div v-if="monitor.mcp" class="ext-meta">
        <span v-if="monitor.mcp.kind === 'ready' && monitor.mcp.tools.length">
          {{ t('settings.ai.mcp.toolsFound', { n: monitor.mcp.tools.length }) }}
        </span>
        <span v-if="monitor.mcp.detail" class="ext-detail">{{ monitor.mcp.detail }}</span>
      </div>
      <!-- 后台初始化进度 -->
      <div v-if="monitor.mcp?.kind === 'initializing'" class="ext-init">
        <div class="ext-progress" :aria-label="t('settings.ai.mcp.initAria')">
          <span class="ext-progress-bar" />
        </div>
        <p class="ext-init-hint">
          {{ t('settings.ai.mcp.initHint') }}
        </p>
      </div>
      <!-- 未初始化/失败兜底：一键重试，手动命令仅作高级兜底 -->
      <div
        v-else-if="['not-initialized', 'error', 'package-unavailable', 'node-missing'].includes(monitor.mcp?.kind ?? '')"
        class="ext-init"
      >
        <p class="ext-init-hint">{{ t('settings.ai.mcp.retryHint') }}</p>
        <div class="ext-cmd">
          <el-button size="small" type="primary" :loading="mcpBusy" @click="retryMcpInit">
            {{ t('settings.ai.mcp.retry') }}
          </el-button>
          <code>{{ monitor.mcp?.initCommand }}</code>
          <el-button size="small" @click="copyInit">{{ t('settings.ai.mcp.copyCmd') }}</el-button>
        </div>
      </div>
      <div class="ext-actions">
        <el-button size="small" :loading="mcpBusy" @click="refreshMcp">{{ t('settings.ai.redetect') }}</el-button>
      </div>
    </section>

    <!-- 子代理委派（默认关）：AI 可把边界明确的调研类小任务交给子代理独立小循环执行 -->
    <section class="ext-card">
      <div class="ext-top" data-setting-id="ai-subagent-enabled">
        <div class="ext-title">
          <span class="ext-name">{{ t('settings.ai.subAgentSection') }}</span>
          <el-tag size="small" effect="plain">{{ t('settings.ai.subAgentTag') }}</el-tag>
        </div>
        <el-switch
          :model-value="settings.ai.subAgentEnabled"
          @change="(v) => settings.patchSection('ai', { subAgentEnabled: v === true })"
        />
      </div>
      <p class="ext-desc">
        {{ t('settings.ai.subAgentDesc') }}
      </p>
    </section>

    <!-- 实体自由编码模式 -->
    <section class="ext-card">
      <div class="ext-top" data-setting-id="ai-entity-freeform-enabled">
        <div class="ext-title">
          <span class="ext-name">{{ t('settings.ai.entityFreeformSection') }}</span>
          <el-tag size="small" effect="plain">{{ t('settings.ai.advancedTag') }}</el-tag>
        </div>
        <el-switch
          :model-value="settings.ai.entityFreeformEnabled"
          @change="(v) => settings.patchSection('ai', { entityFreeformEnabled: v === true })"
        />
      </div>
      <p class="ext-desc">
        {{ t('settings.ai.entityFreeformDesc') }}
      </p>
    </section>

    <!-- 全局自由编码模式 -->
    <section class="ext-card">
      <div class="ext-top" data-setting-id="ai-global-freeform-enabled">
        <div class="ext-title">
          <span class="ext-name">{{ t('settings.ai.globalFreeformSection') }}</span>
          <el-tag size="small" effect="plain" type="warning">{{ t('settings.ai.globalFreeformTag') }}</el-tag>
        </div>
        <el-switch
          :model-value="settings.ai.globalFreeformEnabled"
          @change="(v) => settings.patchSection('ai', { globalFreeformEnabled: v === true })"
        />
      </div>
      <p class="ext-desc">
        <strong style="color: var(--el-color-warning)">{{ t('settings.ai.gfWarnStrong') }}</strong>{{ t('settings.ai.gfDescA') }}<strong>{{ t('settings.ai.gfCostStrong') }}</strong>{{ t('settings.ai.gfDescB') }}
      </p>
    </section>

    <!-- 严格审查闸门：AI 落盘变更必须全部人工复核（保留/撤销）才放行下一次运行 -->
    <section class="ext-card">
      <div class="ext-top" data-setting-id="ai-strict-review">
        <div class="ext-title">
          <span class="ext-name">{{ t('settings.ai.strictReviewSection') }}</span>
          <el-tag size="small" effect="plain">{{ t('settings.ai.strictReviewTag') }}</el-tag>
        </div>
        <el-switch
          :model-value="settings.ai.strictReview"
          @change="(v) => settings.patchSection('ai', { strictReview: v === true })"
        />
      </div>
      <p class="ext-desc">
        {{ t('settings.ai.strictReviewDesc') }}
      </p>
    </section>

    <!-- M1：CUE 代码补全（Tab-Cue） -->
    <section class="ext-card">
      <div class="ext-top" data-setting-id="ai-cue-enabled">
        <div class="ext-title">
          <span class="ext-name">{{ t('settings.ai.cue.section') }}</span>
          <el-tag size="small" effect="plain">{{ t('settings.ai.cue.tag') }}</el-tag>
        </div>
        <el-switch
          :model-value="settings.ai.cue.enabled"
          @change="(v) => patchCue({ enabled: v === true })"
        />
      </div>
      <p class="ext-desc">
        {{ t('settings.ai.cue.desc') }}
      </p>
      <div v-if="settings.ai.cue.enabled" class="cue-grid">
        <label class="cue-field">
          <span class="cue-label">{{ t('settings.ai.cue.debounce') }}</span>
          <el-input-number
            :model-value="settings.ai.cue.debounceMs"
            :min="50"
            :max="1000"
            :step="10"
            size="small"
            controls-position="right"
            @change="(v) => patchCue({ debounceMs: typeof v === 'number' ? v : 150 })"
          />
        </label>
        <label class="cue-field">
          <span class="cue-label">{{ t('settings.ai.cue.maxPrefix') }}</span>
          <el-input-number
            :model-value="settings.ai.cue.maxPrefixChars"
            :min="200"
            :max="8000"
            :step="100"
            size="small"
            controls-position="right"
            @change="(v) => patchCue({ maxPrefixChars: typeof v === 'number' ? v : 2000 })"
          />
        </label>
        <label class="cue-field">
          <span class="cue-label">{{ t('settings.ai.cue.maxSuffix') }}</span>
          <el-input-number
            :model-value="settings.ai.cue.maxSuffixChars"
            :min="100"
            :max="4000"
            :step="100"
            size="small"
            controls-position="right"
            @change="(v) => patchCue({ maxSuffixChars: typeof v === 'number' ? v : 1000 })"
          />
        </label>
        <label class="cue-field cue-field-wide">
          <span class="cue-label">{{ t('settings.ai.cue.languages') }}</span>
          <el-select
            :model-value="settings.ai.cue.languages"
            multiple
            size="small"
            :placeholder="t('settings.ai.cue.languagesPh')"
            @change="(v) => patchCue({ languages: Array.isArray(v) ? (v as string[]).filter((x) => typeof x === 'string') : [] })"
          >
            <el-option label="java" value="java" />
            <el-option label="json" value="json" />
            <el-option label="properties" value="properties" />
            <el-option label="javascript" value="javascript" />
            <el-option label="typescript" value="typescript" />
          </el-select>
        </label>
        <label class="cue-field cue-field-wide">
          <span class="cue-label">{{ t('settings.ai.cue.modelLabel') }}</span>
          <el-input
            :model-value="settings.ai.cue.model"
            size="small"
            :placeholder="t('settings.ai.cue.modelPh')"
            @change="(v) => patchCue({ model: typeof v === 'string' ? v : '' })"
          />
        </label>
        <!-- M2：修改点导航 -->
        <label class="cue-field cue-field-wide cue-switch-field" data-setting-id="ai-cue-change-points">
          <span class="cue-label">
            {{ t('settings.ai.cue.changePoints') }}
            <small class="cue-hint">{{ t('settings.ai.cue.changePointsHint') }}</small>
          </span>
          <el-switch
            :model-value="settings.ai.cue.changePointsEnabled"
            @change="(v) => patchCue({ changePointsEnabled: v === true })"
          />
        </label>
        <label class="cue-field cue-field-wide cue-switch-field" data-setting-id="ai-cue-jump-after-accept">
          <span class="cue-label">
            {{ t('settings.ai.cue.jumpAfterAccept') }}
            <small class="cue-hint">{{ t('settings.ai.cue.jumpAfterAcceptHint') }}</small>
          </span>
          <el-switch
            :model-value="settings.ai.cue.jumpAfterAccept"
            :disabled="!settings.ai.cue.changePointsEnabled"
            @change="(v) => patchCue({ jumpAfterAccept: v === true })"
          />
        </label>
        <!-- M4：Java 智能 import -->
        <label class="cue-field cue-field-wide cue-switch-field" data-setting-id="ai-cue-java-auto-import">
          <span class="cue-label">
            {{ t('settings.ai.cue.javaImport') }}
            <small class="cue-hint">{{ t('settings.ai.cue.javaImportHint') }}</small>
          </span>
          <el-switch
            :model-value="settings.ai.cue.javaAutoImport"
            @change="(v) => patchCue({ javaAutoImport: v === true })"
          />
        </label>
        <label class="cue-field cue-field-wide cue-switch-field" data-setting-id="ai-cue-java-import-ai-fallback">
          <span class="cue-label">
            {{ t('settings.ai.cue.importAiFallback') }}
            <small class="cue-hint">{{ t('settings.ai.cue.importAiFallbackHint') }}</small>
          </span>
          <el-switch
            :model-value="settings.ai.cue.javaImportAiFallback"
            :disabled="!settings.ai.cue.javaAutoImport"
            @change="(v) => patchCue({ javaImportAiFallback: v === true })"
          />
        </label>
        <!-- M3：仓库级上下文 -->
        <label class="cue-field cue-field-wide cue-switch-field" data-setting-id="ai-cue-repo-context">
          <span class="cue-label">
            {{ t('settings.ai.cue.repoContext') }}
            <small class="cue-hint">{{ t('settings.ai.cue.repoContextHint') }}</small>
          </span>
          <el-switch
            :model-value="settings.ai.cue.repoContextEnabled"
            @change="(v) => patchCue({ repoContextEnabled: v === true })"
          />
        </label>
        <label class="cue-field cue-field-wide cue-switch-field" data-setting-id="ai-cue-chain-after-jump">
          <span class="cue-label">
            {{ t('settings.ai.cue.chain') }}
            <small class="cue-hint">{{ t('settings.ai.cue.chainHint') }}</small>
          </span>
          <el-switch
            :model-value="settings.ai.cue.chainAfterJump"
            :disabled="!settings.ai.cue.changePointsEnabled"
            @change="(v) => patchCue({ chainAfterJump: v === true })"
          />
        </label>
        <!-- M3 高级项：折叠展示 -->
        <div class="cue-field cue-field-wide">
          <details class="cue-advanced">
            <summary class="cue-advanced-summary">
              {{ t('settings.ai.cue.advanced') }}
            </summary>
            <div class="cue-advanced-body">
              <label class="cue-field">
                <span class="cue-label">{{ t('settings.ai.cue.contextBudget') }}</span>
                <el-input-number
                  :model-value="settings.ai.cue.repoContextMaxChars"
                  :min="500"
                  :max="16000"
                  :step="500"
                  size="small"
                  @change="(v) => patchCue({ repoContextMaxChars: typeof v === 'number' ? v : 3000 })"
                />
              </label>
              <label class="cue-field cue-switch-field">
                <span class="cue-label">
                  <small class="cue-hint">{{ t('settings.ai.cue.sourceGrep') }}</small>
                </span>
                <el-switch
                  :model-value="settings.ai.cue.repoContextSources.grep"
                  size="small"
                  @change="(v) => patchCue({ repoContextSources: { ...settings.ai.cue.repoContextSources, grep: v === true } })"
                />
              </label>
              <label class="cue-field cue-switch-field">
                <span class="cue-label">
                  <small class="cue-hint">{{ t('settings.ai.cue.sourceKb') }}</small>
                </span>
                <el-switch
                  :model-value="settings.ai.cue.repoContextSources.kb"
                  size="small"
                  @change="(v) => patchCue({ repoContextSources: { ...settings.ai.cue.repoContextSources, kb: v === true } })"
                />
              </label>
              <label class="cue-field cue-switch-field">
                <span class="cue-label">
                  <small class="cue-hint">{{ t('settings.ai.cue.sourceTemplates') }}</small>
                </span>
                <el-switch
                  :model-value="settings.ai.cue.repoContextSources.templates"
                  size="small"
                  @change="(v) => patchCue({ repoContextSources: { ...settings.ai.cue.repoContextSources, templates: v === true } })"
                />
              </label>
            </div>
          </details>
        </div>
      </div>
    </section>

    <!-- 知识库语料：版本指纹与过期提示（纯本地扫描，不发网络请求） -->
    <section class="ext-card">
      <div class="ext-top" data-setting-id="ai-knowledge-pack">
        <div class="ext-title">
          <span class="ext-name">{{ t('settings.ai.kb.section') }}</span>
          <el-tag size="small" :type="knowledgeTagType" effect="plain">
            {{ knowledgeTagText }}
          </el-tag>
        </div>
        <el-button size="small" @click="refreshKnowledgeStatus">{{ t('settings.ai.redetect') }}</el-button>
      </div>
      <p class="ext-desc">
        {{ knowledgeStatus?.message ?? t('settings.ai.kb.detecting') }}
        <template v-if="knowledgeStatus?.fingerprint">
          <br />
          {{ t('settings.ai.kb.fingerprint', {
            fp: knowledgeStatus.fingerprint.slice(0, 16),
            count: knowledgeStatus.fileCount,
            date: knowledgeStatus.generatedAt ?? t('settings.ai.kb.unregistered'),
            version: knowledgeStatus.corpusVersion ?? t('settings.ai.kb.unregistered')
          }) }}
        </template>
      </p>
      <p v-if="knowledgeStatus?.changedFiles.length" class="ext-desc">
        {{ t('settings.ai.kb.changedLabel') }}{{ knowledgeStatus.changedFiles.join('、') }}
      </p>
      <p
        v-if="knowledgeStatus && (knowledgeStatus.extraFiles.length || knowledgeStatus.missingFiles.length)"
        class="ext-desc"
      >
        <template v-if="knowledgeStatus.extraFiles.length">
          {{ t('settings.ai.kb.extraLabel') }}{{ knowledgeStatus.extraFiles.join('、') }}
        </template>
        <template v-if="knowledgeStatus.extraFiles.length && knowledgeStatus.missingFiles.length">
          ；
        </template>
        <template v-if="knowledgeStatus.missingFiles.length">
          {{ t('settings.ai.kb.missingLabel') }}{{ knowledgeStatus.missingFiles.join('、') }}
        </template>
      </p>
    </section>

    <!-- 知识库检索索引：向量层状态（ai-reference 模板 + knowledge 语料），支持手动重建 -->
    <section class="ext-card">
      <div class="ext-top" data-setting-id="ai-kb-rag-status">
        <div class="ext-title">
          <span class="ext-name">{{ t('settings.ai.rag.section') }}</span>
          <el-tag size="small" :type="ragTagType" effect="plain">{{ ragTagText }}</el-tag>
        </div>
        <div>
          <el-button size="small" @click="refreshRagStatus">{{ t('settings.ai.refresh') }}</el-button>
          <el-button size="small" :loading="ragRebuilding" @click="rebuildRagIndex">{{ t('settings.ai.rag.rebuild') }}</el-button>
        </div>
      </div>
      <p class="ext-desc">
        {{ ragStatus?.reason ?? (ragStatus?.ready ? t('settings.ai.rag.ready') : t('settings.ai.rag.notInit')) }}
        <template v-if="ragStatus">
          <br />
          {{ t('settings.ai.rag.modelLine', {
            model: ragStatus.model ?? '—',
            files: ragStatus.files,
            chunks: ragStatus.chunks,
            cache: formatRagCacheBytes(ragStatus.cacheBytes),
            watching: ragStatus.watching ? t('settings.ai.rag.watchOn') : t('settings.ai.rag.watchOff')
          }) }}
        </template>
      </p>
      <p v-if="ragStatus?.roots.length" class="ext-desc">
        <template v-for="(r, i) in ragStatus.roots" :key="r.alias">
          <template v-if="i > 0">；</template>{{ t('settings.ai.rag.rootLine', { alias: r.alias, files: r.files, chunks: r.chunks }) }}
        </template>
      </p>
    </section>

    <!-- 内置探针 kunyu-observer-agent（javaagent 形态：启动游戏自动挂载，无需注入） -->
    <section class="ext-card">
      <div class="ext-top" data-setting-id="ai-observer-agent">
        <div class="ext-title">
          <span class="ext-name">{{ t('settings.ai.observer.section') }}</span>
          <el-tag v-if="observerStatus.available" size="small" type="success" effect="plain">
            {{ t('settings.ai.observer.bundled', { version: observerStatus.version ?? '' }) }}
          </el-tag>
          <el-tag v-else size="small" type="warning" effect="plain">{{ t('settings.ai.observer.missing') }}</el-tag>
        </div>
        <el-switch
          size="small"
          :model-value="settings.ai.observerAutoInject"
          :disabled="!observerStatus.available"
          @change="(v) => settings.patchSection('ai', { observerAutoInject: v === true })"
        />
      </div>
      <p class="ext-desc">
        {{ t('settings.ai.observer.descA') }}<code>-javaagent</code>{{ t('settings.ai.observer.descB') }}
      </p>
    </section>

    <!-- 测试阶段自动启动游戏 -->
    <section class="ext-card">
      <div class="ext-top" data-setting-id="ai-auto-launch-game">
        <div class="ext-title">
          <span class="ext-name">{{ t('settings.ai.autoLaunchSection') }}</span>
          <el-tag size="small" effect="plain">{{ t('settings.ai.autoLaunchTag') }}</el-tag>
        </div>
        <el-switch
          :model-value="settings.ai.autoLaunchGameOnTest"
          @change="(v) => settings.patchSection('ai', { autoLaunchGameOnTest: v === true })"
        />
      </div>
      <p class="ext-desc">
        {{ t('settings.ai.autoLaunchDescA') }}<code>gradlew runClient</code>{{ t('settings.ai.autoLaunchDescB') }}
      </p>
    </section>

    <!-- P1：真机视觉自审 -->
    <section class="ext-card">
      <div class="ext-top" data-setting-id="ai-visual-review">
        <div class="ext-title">
          <span class="ext-name">{{ t('settings.ai.visualReviewSection') }}</span>
          <el-tag size="small" effect="plain">{{ t('settings.ai.visualReviewTag') }}</el-tag>
        </div>
        <el-switch
          :model-value="settings.ai.visualReviewEnabled"
          @change="(v) => settings.patchSection('ai', { visualReviewEnabled: v === true })"
        />
      </div>
      <p class="ext-desc">
        {{ t('settings.ai.visualReviewDesc') }}
      </p>
    </section>

    <!-- A3：开发者自定义 MCP server -->
    <section class="ext-card">
      <div class="ext-top" data-setting-id="ai-custom-mcp-servers">
        <div class="ext-title">
          <span class="ext-name">{{ t('settings.ai.customMcp.section') }}</span>
          <el-tag size="small" effect="plain">{{ t('settings.ai.customMcp.tag') }}</el-tag>
        </div>
        <el-button size="small" type="primary" :icon="Plus" @click="openMcpAdd">{{ t('settings.ai.customMcp.add') }}</el-button>
      </div>
      <p class="ext-desc">
        {{ t('settings.ai.customMcp.desc') }}
      </p>

      <!-- 推荐市场：社区 MCP 一键导入 -->
      <div class="mcp-market">
        <div class="mcp-market-title">{{ t('settings.ai.customMcp.marketTitle') }}</div>
        <div class="mcp-market-grid">
          <div v-for="preset in MCP_PRESETS" :key="preset.name" class="mcp-market-card">
            <div class="mcp-market-card-head">
              <span class="mcp-market-card-name">{{ preset.name }}</span>
              <el-tag size="small" :type="mcpCategoryTagType(preset.category)" effect="plain">{{ mcpCategoryLabel(preset.category) }}</el-tag>
              <el-tag size="small" :type="mcpPermissionTagType(preset.permission)" effect="plain">{{ mcpPermissionLabel(preset.permission) }}</el-tag>
            </div>
            <p class="mcp-market-card-desc">{{ mcpPresetDescription(preset) }}</p>
            <code class="mcp-market-card-cmd">{{ preset.command }} {{ preset.args.join(' ') }}</code>
            <div class="mcp-market-card-actions">
              <el-button
                size="small"
                type="primary"
                :disabled="isPresetImported(preset)"
                @click="importPreset(preset)"
              >
                {{ isPresetImported(preset) ? t('settings.ai.customMcp.imported') : t('settings.ai.customMcp.import') }}
              </el-button>
            </div>
          </div>
        </div>
      </div>

      <div v-if="customMcpServers.length === 0" class="ext-empty">
        {{ t('settings.ai.customMcp.empty') }}
      </div>
      <div v-for="server in customMcpServers" :key="server.id" class="mcp-row">
        <div class="mcp-row-head">
          <div class="mcp-row-info">
            <span class="mcp-row-name">{{ server.name }}</span>
            <span :class="customRuntimeDotClass(server.id)" :title="customRuntimeStatusLabel(server.id)" />
            <span class="mcp-row-status">{{ customRuntimeStatusLabel(server.id) }}</span>
            <el-tag v-if="!server.enabled" size="small" type="info" effect="plain">{{ t('settings.ai.customMcp.disabledTag') }}</el-tag>
          </div>
          <div class="mcp-row-actions">
            <el-button size="small" :loading="!!mcpTestState[server.id]?.loading" @click="testMcp(server)">
              {{ t('settings.ai.customMcp.test') }}
            </el-button>
            <el-button size="small" text @click="openMcpEdit(server)">{{ t('settings.ai.customMcp.edit') }}</el-button>
            <el-button size="small" text type="danger" @click="deleteMcp(server)">{{ t('settings.ai.delete') }}</el-button>
            <el-switch
              :model-value="server.enabled"
              size="small"
              @change="(v) => toggleMcpEnabled(server, Boolean(v))"
            />
          </div>
        </div>
        <code class="mcp-row-cmd">{{ server.command }} {{ server.args.join(' ') }}</code>
        <div v-if="mcpTestState[server.id]?.tools != null" class="mcp-test-ok">
          {{ t('settings.ai.customMcp.testOkLine', { n: mcpTestState[server.id].tools! }) }}
        </div>
        <div v-else-if="mcpTestState[server.id]?.error" class="mcp-test-fail">
          ✗ {{ mcpTestState[server.id].error }}
        </div>
      </div>
    </section>

    <!-- A3：MCP server 新增/编辑弹窗 -->
    <el-dialog
      v-model="mcpDraftVisible"
      :title="mcpDraft?.id && customMcpServers.some((s) => s.id === mcpDraft!.id) ? t('settings.ai.customMcp.editTitle') : t('settings.ai.customMcp.addTitle')"
      width="480px"
      align-center
      destroy-on-close
    >
      <div v-if="mcpDraft" class="mcp-form">
        <div class="mcp-form-row">
          <label>{{ t('settings.ai.name') }}</label>
          <el-input v-model="mcpDraft.name" :placeholder="t('settings.ai.customMcp.namePh')" />
        </div>
        <div class="mcp-form-row">
          <label>{{ t('settings.ai.customMcp.command') }}</label>
          <el-input v-model="mcpDraft.command" :placeholder="t('settings.ai.customMcp.commandPh')" />
        </div>
        <div class="mcp-form-row">
          <label>{{ t('settings.ai.customMcp.args') }}</label>
          <el-input
            v-model="mcpDraft.argsLine"
            placeholder='-y @modelcontextprotocol/server-filesystem "C:\"'
          />
          <small class="mcp-form-hint">{{ t('settings.ai.customMcp.argsHint') }}</small>
        </div>
        <div class="mcp-form-row">
          <label>{{ t('settings.ai.customMcp.env') }}</label>
          <el-input v-model="mcpDraft.envLine" placeholder="API_KEY=xxx, TOKEN=yyy" />
          <small class="mcp-form-hint">{{ t('settings.ai.customMcp.envHint') }}</small>
        </div>
        <div class="mcp-form-row mcp-form-row-inline">
          <label>{{ t('settings.ai.customMcp.timeout') }}</label>
          <el-input-number v-model="mcpDraft.timeoutMs" :min="5000" :max="60000" :step="5000" />
          <label>{{ t('settings.ai.customMcp.enabled') }}</label>
          <el-switch v-model="mcpDraft.enabled" />
        </div>
      </div>
      <template #footer>
        <el-button @click="closeMcpDraft">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" @click="saveMcpDraft">{{ t('common.save') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Plus } from '@element-plus/icons-vue'
import { useSettingsStore } from '../../stores/settings'
import { useI18n } from '../../i18n'
import { useAiMonitorStore } from '../../stores/aiMonitor'
import { useProjectStore } from '../../stores/project'
import { MCP_PRESETS } from '../../../../shared/types/settings'
import { TIER_METAS } from '../../../../shared/types/tiers'
import { useMatrixHealth } from './ai/useMatrixHealth'
import { useAiProviders } from './ai/useAiProviders'
import { useTierModels } from './ai/useTierModels'
import { useObserverInject } from './ai/useObserverInject'
import { useMcpMonitor } from './ai/useMcpMonitor'
import { useCustomMcp } from './ai/useCustomMcp'
import { createProviderModelFields, TestResultLine } from './ai/providerFields'
import type { MatrixHealthRow, ProviderDraft } from './ai/types'
import type { CueSettings } from '../../../../shared/types/settings'
import type { KnowledgePackStatus } from '../../../../shared/types/ai'
import type { KbRagStatus } from '../../../../shared/types/models'

const settings = useSettingsStore()
const { t } = useI18n()
const monitor = useAiMonitorStore()
const projectStore = useProjectStore()

/** 知识库语料指纹状态：进入设置页扫一次，「重新检测」可再扫 */
const knowledgeStatus = ref<KnowledgePackStatus | null>(null)
const knowledgeTagText = computed(() => {
  if (knowledgeStatus.value?.autoRefreshed) return t('settings.ai.kb.tagAutoRefreshed')
  switch (knowledgeStatus.value?.state) {
    case 'ok':
      return t('settings.ai.kb.tagOk')
    case 'drifted':
      return t('settings.ai.kb.tagDrifted')
    case 'outdated':
      return t('settings.ai.kb.tagOutdated')
    case 'missing-manifest':
      return t('settings.ai.kb.tagMissingManifest')
    case 'empty':
      return t('settings.ai.kb.tagEmpty')
    default:
      return t('settings.ai.kb.tagDetecting')
  }
})
const knowledgeTagType = computed<'success' | 'warning' | 'danger' | 'info'>(() => {
  switch (knowledgeStatus.value?.state) {
    case 'ok':
      return 'success'
    case 'drifted':
      return 'danger'
    case 'outdated':
    case 'missing-manifest':
      return 'warning'
    default:
      return 'info'
  }
})
async function refreshKnowledgeStatus(): Promise<void> {
  try {
    knowledgeStatus.value = await window.api.knowledge.packStatus()
  } catch {
    knowledgeStatus.value = null
  }
}

/** kbRag 向量索引状态：进入设置页查一次，「刷新」再查；「重建索引」清缓存全量重编码 */
const ragStatus = ref<KbRagStatus | null>(null)
const ragRebuilding = ref(false)
const ragTagText = computed(() => {
  switch (ragStatus.value?.backend) {
    case 'embedded-ready':
      return t('settings.ai.rag.tagReady')
    case 'fallback-keyword':
      return t('settings.ai.rag.tagFallback')
    case 'downloading':
      return t('settings.ai.rag.tagDownloading')
    case 'idle':
      return t('settings.ai.rag.tagIdle')
    default:
      return t('settings.ai.rag.tagUnknown')
  }
})
const ragTagType = computed<'success' | 'warning' | 'info'>(() => {
  switch (ragStatus.value?.backend) {
    case 'embedded-ready':
      return 'success'
    case 'fallback-keyword':
      return 'warning'
    default:
      return 'info'
  }
})
function formatRagCacheBytes(bytes: number): string {
  if (!bytes) return '0 B'
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
async function refreshRagStatus(): Promise<void> {
  try {
    ragStatus.value = await window.api.knowledge.ragStatus()
  } catch {
    ragStatus.value = null
  }
}
async function rebuildRagIndex(): Promise<void> {
  ragRebuilding.value = true
  try {
    const res = await window.api.knowledge.ragRebuild()
    if (res.ok) ragStatus.value = res.result
  } catch {
    /* 失败保留旧状态展示 */
  } finally {
    ragRebuilding.value = false
  }
}
const currentProject = computed(() => projectStore.currentProject)

// 版本矩阵健康度
const {
  matrixLoading,
  matrixHealthRows,
  matrixHealthDotClass,
  matrixHealthLabel,
  formatMatrixTime,
  refreshMatrixHealth
} = useMatrixHealth()

// 三栏提供商
const providers = computed(() => settings.ai.providers)
const {
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
} = useAiProviders()

/**
 * 模板非空别名：customDraft 是 ref，模板用 `<template v-if="customDraft">` 收窄。
 * vue-tsc 3.3.13 起不再把 v-if 的窄化带进块内子表达式，故这里显式断言非空；
 * 渲染期由 v-if 保证，无需额外判空。
 */
const customDraftView = computed<ProviderDraft>(() => customDraft.value as ProviderDraft)

// 档位模型
const { onTierProviderChange, onTierModelChange } = useTierModels()

// Observer-agent 状态
const { observerStatus, refreshObserverStatus } = useObserverInject()

// MCP 监控
const {
  mcpKindLabel,
  mcpBusy,
  mcpDotClass,
  toggleMcp,
  refreshMcp,
  retryMcpInit,
  copyInit
} = useMcpMonitor()

// 自定义 MCP
const {
  customMcpServers,
  mcpDraftVisible,
  mcpDraft,
  mcpTestState,
  mcpCategoryLabel,
  mcpCategoryTagType,
  mcpPermissionLabel,
  mcpPermissionTagType,
  mcpPresetDescription,
  isPresetImported,
  importPreset,
  openMcpAdd,
  openMcpEdit,
  closeMcpDraft,
  saveMcpDraft,
  toggleMcpEnabled,
  deleteMcp,
  testMcp,
  refreshCustomMcpStatus,
  syncCustomMcpServers,
  customRuntimeDotClass,
  customRuntimeStatusLabel
} = useCustomMcp()

// CUE 设置
async function patchCue(patch: Partial<CueSettings>): Promise<void> {
  await settings.patchSection('ai', { cue: { ...settings.ai.cue, ...patch } })
}

// 内联渲染组件（工厂注入依赖）
const ProviderModelFields = createProviderModelFields({
  allModelOptions,
  fetchingId,
  modelStatus
})

// 自定义 MCP 状态定时器
let customMcpRefreshTimer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  initProviderColumns()
  // 自动同步各厂商模型列表（24h 内命中缓存则零请求，失败静默降级为内置列表）
  autoFetchModels()
  void refreshKnowledgeStatus()
  void refreshRagStatus()
  void monitor.init()
  // 自定义 MCP：进入设置页时同步一次 + 定时刷新状态（便于看到连接中→就绪的变化）
  void syncCustomMcpServers()
  void refreshObserverStatus()
  customMcpRefreshTimer = setInterval(() => void refreshCustomMcpStatus(), 3000)
  void refreshMatrixHealth()
})

// 切换项目后刷新探针注入状态（不同项目 run/mods 各自独立）
watch(
  () => currentProject.value?.id,
  () => {
    void refreshObserverStatus()
  }
)

onBeforeUnmount(() => {
  if (customMcpRefreshTimer) {
    clearInterval(customMcpRefreshTimer)
    customMcpRefreshTimer = null
  }
})
</script>

<style scoped>
.pane {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.pane-head h2 {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
}
.pane-head p {
  margin: 4px 0 14px;
  font-size: 12px;
  color: var(--ky-text-dim);
  line-height: 1.6;
}

/* 版本矩阵健康度表格 */
.matrix-table {
  width: 100%;
}
.matrix-table :deep(.el-table__header) {
  background: var(--ky-bg-panel);
}
.matrix-table :deep(.el-table__row) {
  background: transparent;
}

/* 纵向单列堆叠：推荐厂商 → 自定义 → 本地 Ollama 从上到下排列 */
.ai-cols {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ai-col {
  border: 1px solid var(--ky-border);
  border-radius: var(--ky-radius-control);
  background: var(--ky-bg-panel);
  padding: 8px 14px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.aic-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.aic-head h3 {
  margin: 0;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ky-text);
}

.aic-sub {
  font-size: 10px;
  color: var(--ky-text-dim);
}

.aic-select {
  width: 100%;
}

.aic-custom-head {
  display: flex;
  align-items: center;
  gap: 6px;
}

.aic-endpoint {
  font-family: var(--ky-font-mono);
  font-size: 10.5px;
  color: var(--ky-text-dim);
  background: rgba(127, 127, 127, 0.1);
  border-radius: 4px;
  padding: 2px 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.aic-label {
  font-size: 11px;
  color: var(--ky-text-sub);
}

.aic-key-tools {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}

.aic-link {
  font-size: 10.5px;
  color: var(--ky-accent);
  cursor: pointer;
}

.aic-link:hover {
  text-decoration: underline;
}

.aic-link-danger {
  color: var(--el-color-danger);
}

.aic-fields {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 0;
}

.aic-model-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.aic-model-select {
  flex: 1;
  min-width: 0;
}
/* 模型选项内的「推理」标签：标记思考型模型，便于用户识别 */
.aic-model-name {
  display: inline;
}
.aic-model-reasoning {
  margin-left: 6px;
  padding: 0 5px;
  border-radius: 4px;
  font-size: 10px;
  line-height: 15px;
  color: #a78bfa;
  background: rgba(167, 139, 250, 0.14);
  border: 1px solid rgba(167, 139, 250, 0.3);
  vertical-align: middle;
}

.aic-number {
  width: 100%;
}

.aic-temp-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.aic-temp-slider {
  flex: 1;
}

.aic-temp-value {
  width: 32px;
  text-align: right;
  font-size: 12px;
  color: var(--ky-text-sub);
  font-family: var(--ky-font-mono);
}

.aic-test {
  margin: 0;
  font-size: 11px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.aic-ok {
  color: var(--ky-accent);
}

.aic-fail {
  color: var(--el-color-danger);
}

.aic-testing {
  color: var(--ky-text-dim);
}

.aic-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  border-top: 1px solid var(--ky-border);
  padding-top: 6px;
  margin-top: 0;
}

.aic-default {
  margin-right: 0;
}

.aic-spacer {
  flex: 1;
}

.aic-tip {
  margin: 0;
  font-size: 10px;
  color: var(--ky-text-dim);
  line-height: 1.4;
}

.aic-tip code {
  font-family: var(--ky-font-mono);
}

/* M7：扩展服务卡片（mcdev-mcp / 内置探针） */
.ext-card {
  margin-top: 14px;
  border: 1px solid var(--ky-border);
  border-radius: 10px;
  background: var(--ky-bg-panel);
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ext-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.ext-title {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ext-name {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--ky-text);
}
.ext-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--ky-text-dim);
}
.ext-dot.is-ok {
  background: var(--ky-accent);
  box-shadow: 0 0 6px rgba(var(--ky-accent-rgb), 0.7);
}
.ext-dot.is-fail {
  background: var(--el-color-danger);
}
.ext-dot.is-busy {
  background: var(--el-color-warning);
  animation: ai-pulse 1s ease-in-out infinite;
}
.ext-dot.is-idle {
  background: var(--ky-text-dim);
}
@keyframes ai-pulse {
  50% {
    opacity: 0.35;
  }
}
.ext-desc {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--ky-text-dim);
}
.ext-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  font-size: 12px;
  color: var(--ky-text-sub);
}
.ext-detail {
  color: var(--ky-text-dim);
}
/* 内置初始化：不确定进度条（流光） */
.ext-progress {
  position: relative;
  height: 6px;
  border-radius: 3px;
  background: rgba(127, 127, 127, 0.18);
  overflow: hidden;
}
.ext-progress-bar {
  position: absolute;
  inset: 0;
  width: 40%;
  border-radius: 3px;
  background: linear-gradient(90deg, transparent, var(--ky-accent), transparent);
  animation: ext-progress-slide 1.4s ease-in-out infinite;
}
@keyframes ext-progress-slide {
  0% {
    transform: translateX(-110%);
  }
  100% {
    transform: translateX(360%);
  }
}
.ext-init {
  border: 1px dashed var(--ky-border);
  border-radius: var(--ky-radius-control);
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ext-init-hint {
  margin: 0;
  font-size: 12px;
  color: var(--ky-text-sub);
}
.ext-cmd {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.ext-cmd code {
  flex: 1;
  font-family: var(--ky-font-mono);
  font-size: 11.5px;
  color: var(--ky-text);
  background: rgba(127, 127, 127, 0.12);
  border-radius: 4px;
  padding: 4px 8px;
  user-select: all;
}
.ext-row {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  color: var(--ky-text-sub);
}
.ext-port {
  width: 150px;
}
.ext-actions {
  display: flex;
  gap: 8px;
}

/* 档位模型覆盖行 */
.tier-model-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 3px 0;
}
.tier-model-name {
  width: 72px;
  flex-shrink: 0;
  font-size: 12.5px;
  color: var(--ky-text);
}
.tier-model-provider {
  width: 190px;
  flex-shrink: 0;
}
.tier-model-model {
  flex: 1;
  min-width: 0;
}

/* A3：自定义 MCP server 行 */
.ext-empty {
  font-size: 12.5px;
  color: var(--ky-text-dim);
  padding: 10px 0 4px;
}
.mcp-row {
  border-top: 1px dashed var(--ky-border);
  padding: 10px 0 6px;
}
.mcp-row-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

/* MCP 推荐市场卡片 */
.mcp-market {
  margin: 12px 0 4px;
  padding: 10px;
  border: 1px solid var(--ky-border);
  border-radius: 6px;
  background: rgba(127, 127, 127, 0.06);
}
.mcp-market-title {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ky-text-sub);
  margin-bottom: 8px;
}
.mcp-market-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 8px;
}
.mcp-market-card {
  border: 1px solid var(--ky-border);
  border-radius: 5px;
  padding: 8px 10px;
  background: var(--ky-surface);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.mcp-market-card-head {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.mcp-market-card-name {
  font-size: 12.5px;
  font-weight: 600;
}
.mcp-market-card-desc {
  font-size: 11px;
  color: var(--ky-text-dim);
  line-height: 1.45;
  margin: 0;
}
.mcp-market-card-cmd {
  font-size: 10.5px;
  font-family: var(--ky-font-mono);
  color: var(--ky-text-sub);
  background: rgba(127, 127, 127, 0.12);
  border-radius: 3px;
  padding: 2px 6px;
  word-break: break-all;
}
.mcp-market-card-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 2px;
}
.mcp-row-info {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
}
.mcp-row-status {
  font-size: 11px;
  font-weight: 400;
  color: var(--ky-text-dim);
}
.mcp-row-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
.mcp-row-cmd {
  display: block;
  font-size: 11px;
  font-family: var(--ky-font-mono);
  color: var(--ky-text-sub);
  background: rgba(127, 127, 127, 0.12);
  border-radius: 4px;
  padding: 3px 8px;
  margin-top: 6px;
  word-break: break-all;
}
.mcp-test-ok {
  font-size: 11.5px;
  color: #6ee7b7;
  margin-top: 4px;
}
.mcp-test-fail {
  font-size: 11.5px;
  color: #fca5a5;
  margin-top: 4px;
}

/* A3：MCP server 编辑弹窗 */
.mcp-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.mcp-form-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.mcp-form-row label {
  font-size: 12.5px;
  color: var(--ky-text-sub);
}
.mcp-form-row-inline {
  flex-direction: row;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.mcp-form-row-inline label {
  font-size: 12px;
  color: var(--ky-text-sub);
}
.mcp-form-hint {
  font-size: 11px;
  color: var(--ky-text-dim);
}
/* M1：CUE 代码补全设置网格 */
.cue-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px 16px;
  margin-top: 10px;
}
.cue-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.cue-field-wide {
  grid-column: span 3;
}
.cue-label {
  font-size: 11px;
  color: var(--ky-text-sub);
}
/* M2：开关型字段横向排布（说明在左，switch 在右） */
.cue-switch-field {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.cue-switch-field .cue-label {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.cue-hint {
  font-size: 10px;
  color: var(--ky-text-dim);
}
/* M3：高级折叠区 */
.cue-advanced {
  border: 1px solid var(--ky-border, rgba(128, 128, 128, 0.2));
  border-radius: 6px;
  padding: 8px 12px;
}
.cue-advanced-summary {
  cursor: pointer;
  font-size: 11px;
  color: var(--ky-text-sub);
  user-select: none;
}
.cue-advanced-body {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
</style>
