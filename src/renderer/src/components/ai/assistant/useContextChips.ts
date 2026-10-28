import { computed } from 'vue'
import { ElMessage } from 'element-plus'
import { useEditorStore } from '../../../stores/editor'
import { useProjectStore } from '../../../stores/project'
import { useBuildStore } from '../../../stores/build'
import { t } from '../../../i18n'

export interface ContextChip {
  label: string
  tip: string
}

export function useContextChips(options: {
  send: (presetText?: string) => Promise<void>
}) {
  const { send } = options
  const editor = useEditorStore()
  const projectStore = useProjectStore()
  const buildStore = useBuildStore()
  const currentProject = computed(() => projectStore.currentProject)

  // ---------- T70/T7.3：三加载器欢迎语与建议词 ----------
  const loaderLabel = computed(() => {
    switch (currentProject.value?.loader) {
      case 'fabric':
        return 'Fabric'
      case 'forge':
        return 'Forge'
      case 'neoforge':
        return 'NeoForge'
      default:
        return null
    }
  })
  const welcomeTitle = computed(() => {
    const p = currentProject.value
    if (p && loaderLabel.value) {
      const ver = p.mcVersion ? ` ${p.mcVersion}` : ''
      return t('assistant.welcome.titleLoader', { loader: loaderLabel.value, ver })
    }
    return t('assistant.welcome.titleDefault')
  })
  const suggestions = computed<string[]>(() => {
    switch (currentProject.value?.loader) {
      case 'fabric':
        return [
          t('assistant.welcome.sugRegisterBlock'),
          t('assistant.welcome.sugFabricMeta'),
          t('assistant.welcome.sugGradle')
        ]
      case 'forge':
        return [
          t('assistant.welcome.sugForgeRegister'),
          t('assistant.welcome.sugForgeMeta'),
          t('assistant.welcome.sugGradle')
        ]
      case 'neoforge':
        return [
          t('assistant.welcome.sugNeoforgeRegister'),
          t('assistant.welcome.sugNeoforgeMeta'),
          t('assistant.welcome.sugGradle')
        ]
      default:
        return [
          t('assistant.welcome.sugDefaultLoader'),
          t('assistant.welcome.sugRegisterBlock'),
          t('assistant.welcome.sugGradle')
        ]
    }
  })

  function relativeDisplay(path: string): string {
    const root = currentProject.value?.path
    if (root) {
      const norm = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '')
      const a = norm(path)
      const r = norm(root)
      if (a.startsWith(r + '/')) return a.slice(r.length + 1)
    }
    const parts = path.split(/[\\/]/)
    return parts[parts.length - 1] || path
  }

  const selectionChip = computed<ContextChip | null>(() => {
    const s = editor.activeSelection
    if (!s) return null
    return {
      label: t('assistant.chips.explainLabel', {
        path: relativeDisplay(s.path),
        from: s.startLine,
        to: s.endLine
      }),
      tip: t('assistant.chips.explainTip')
    }
  })
  const buildErrorChip = computed<ContextChip | null>(() => {
    const errors = buildStore.problems.filter((p) => p.severity === 'error')
    if (errors.length === 0 || buildStore.running) return null
    // 仅在最近一次构建失败、或尚无结果但已解析出错误时出现
    if (buildStore.lastResult && buildStore.lastResult.ok) return null
    return {
      label: t('assistant.chips.fixLabel', { n: errors.length }),
      tip: t('assistant.chips.fixTip')
    }
  })

  async function askExplainSelection(): Promise<void> {
    const s = editor.activeSelection
    if (!s) {
      ElMessage.warning(t('assistant.chips.selectFirst'))
      return
    }
    await send(
      t('assistant.chips.explainPrompt', {
        path: relativeDisplay(s.path),
        from: s.startLine,
        to: s.endLine
      })
    )
  }

  async function askFixBuild(): Promise<void> {
    const status = buildStore.statusText
    await send(t('assistant.chips.fixPrompt', { status }))
  }

  return {
    welcomeTitle,
    suggestions,
    selectionChip,
    buildErrorChip,
    askExplainSelection,
    askFixBuild
  }
}
