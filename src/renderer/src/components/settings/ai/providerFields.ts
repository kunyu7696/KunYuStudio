import { defineComponent, h, type Ref } from 'vue'
import { ElButton, ElInput, ElInputNumber, ElOption, ElSelect, ElSlider } from 'element-plus'
import { isReasoningModel } from '../../../../../shared/types/ai'
import { t } from '../../../i18n'
import type { ProviderDraft, TestState } from './types'

// 栏内复用小组件：模型 / Token / 温度 + 测试结果行
// ProviderModelFields 依赖草稿域的模型选项与拉取状态，由工厂注入；
// 渲染走 h() 并随组件 vnode 继承宿主 SFC 的 scopeId，宿主 scoped 样式照常命中。

export function createProviderModelFields(deps: {
  allModelOptions: (d: ProviderDraft) => string[]
  fetchingId: Ref<string | null>
  /** 模型列表同步状态（数量 + 新鲜度 + 失败说明） */
  modelStatus: (d: ProviderDraft) => string
}) {
  return defineComponent({
    props: {
      draft: { type: Object as () => ProviderDraft, required: true }
    },
    emits: ['fetch'],
    setup(props, { emit }) {
      return () =>
        h('div', { class: 'aic-fields' }, [
          h('label', { class: 'aic-label' }, t('settings.ai.model')),
          h('div', { class: 'aic-model-row' }, [
            h(
              ElSelect,
              {
                modelValue: props.draft.model,
                'onUpdate:modelValue': (v: string) => (props.draft.model = v),
                filterable: true,
                allowCreate: true,
                defaultFirstOption: true,
                placeholder: t('settings.ai.modelPh'),
                class: 'aic-model-select'
              },
              () =>
                deps.allModelOptions(props.draft).map((m) =>
                  h(ElOption, { key: m, value: m, label: m }, () => [
                    h('span', { class: 'aic-model-name' }, m),
                    isReasoningModel(m)
                      ? h('span', { class: 'aic-model-reasoning' }, t('settings.ai.reasoningTag'))
                      : null
                  ])
                )
            ),
            h(
              ElButton,
              {
                size: 'small',
                loading: deps.fetchingId.value === props.draft.id,
                onClick: () => emit('fetch')
              },
              () => t('settings.ai.refresh')
            )
          ]),
          deps.modelStatus(props.draft)
            ? h('p', { class: 'aic-tip' }, deps.modelStatus(props.draft))
            : null,
          // 图像生成模型（贴图工坊 AI 重绘）：仅 OpenAI 兼容供应商显示；Ollama 暂不支持
          props.draft.kind === 'openai-compatible'
            ? h('label', { class: 'aic-label' }, t('settings.ai.imageModel'))
            : null,
          props.draft.kind === 'openai-compatible'
            ? h(ElInput, {
                modelValue: props.draft.imageModel,
                'onUpdate:modelValue': (v: string) => (props.draft.imageModel = v),
                size: 'small',
                placeholder: t('settings.ai.imageModelPh'),
                spellcheck: false
              })
            : null,
          props.draft.kind === 'openai-compatible'
            ? h('p', { class: 'aic-tip' }, t('settings.ai.imageModelHint'))
            : null,
          h('label', { class: 'aic-label' }, t('settings.ai.maxTokens')),
          h(ElInputNumber, {
            modelValue: props.draft.maxTokens,
            'onUpdate:modelValue': (v: number | undefined) => (props.draft.maxTokens = v ?? 16384),
            min: 256,
            max: 128000,
            step: 256,
            controlsPosition: 'right',
            size: 'small',
            class: 'aic-number'
          }),
          h('label', { class: 'aic-label' }, t('settings.ai.contextWindow')),
          h(ElInputNumber, {
            modelValue: props.draft.contextWindow,
            'onUpdate:modelValue': (v: number | undefined) => (props.draft.contextWindow = v ?? 0),
            min: 0,
            max: 2000000,
            step: 1000,
            controlsPosition: 'right',
            size: 'small',
            class: 'aic-number'
          }),
          h(
            'p',
            { class: 'aic-tip' },
            t('settings.ai.contextWindowHint')
          ),
          h('label', { class: 'aic-label' }, t('settings.ai.temperature')),
          h('div', { class: 'aic-temp-row' }, [
            h(ElSlider, {
              modelValue: props.draft.temperature,
              'onUpdate:modelValue': (v: number | number[]) =>
                (props.draft.temperature = Array.isArray(v) ? (v[0] ?? 0.7) : v),
              min: 0,
              max: 2,
              step: 0.1,
              class: 'aic-temp-slider'
            }),
            h('span', { class: 'aic-temp-value' }, props.draft.temperature.toFixed(1))
          ])
        ])
    }
  })
}

export const TestResultLine = defineComponent({
  props: {
    state: { type: Object as () => TestState | undefined, required: false },
    kind: { type: String as () => 'openai-compatible' | 'ollama', required: true }
  },
  emits: ['download'],
  setup(props, { emit }) {
    return () => {
      const s = props.state
      if (!s) return null
      if (s.status === 'testing') return h('p', { class: 'aic-test aic-testing' }, t('settings.ai.testing'))
      if (s.status === 'ok')
        return h('p', { class: 'aic-test aic-ok' }, t('settings.ai.testOk', { ms: s.latencyMs ?? '-' }))
      return h('p', { class: 'aic-test aic-fail' }, [
        h('span', null, t('settings.ai.testFailLine', { msg: s.errorMessage ?? t('settings.ai.testFailShort') })),
        props.kind === 'ollama'
          ? h(
              'a',
              { class: 'aic-link', onClick: () => emit('download') },
              t('settings.ai.ollamaDownload')
            )
          : null
      ])
    }
  }
})
