import { computed, ref } from 'vue'
import type { ComboMatrixCell } from '../../../../../shared/types/monitor'
import { t } from '../../../i18n'
import type { MatrixHealthRow } from './types'

export function useMatrixHealth() {
  const matrixLoading = ref(false)
  const matrixCells = ref<ComboMatrixCell[]>([])
  const matrixHealthRows = computed<MatrixHealthRow[]>(() => {
    // 展示全部矩阵组合：新接入版本（如 26.3）门禁尚未回写 matrixHealth 档案时
    // 也要出现在看板里，以 health（unknown/beta）如实标记「未验证/禁用」状态，
    // 而不是隐身；统计列回退为 0。matrixHealth 档案本身仍由门禁单一写方回写。
    const rows = matrixCells.value.map((c) => ({
      loader: c.loader,
      mcVersion: c.mcVersion,
      templateCount: c.matrixHealth?.templateCount ?? 0,
      verifiedCount: c.matrixHealth?.verifiedCount ?? 0,
      passRate: c.matrixHealth?.passRate ?? 0,
      lastVerifiedAt: c.matrixHealth?.lastVerifiedAt ?? null,
      health: c.health
    }))
    const order: Record<string, number> = { fabric: 0, forge: 1, neoforge: 2 }
    return rows.sort((a, b) => {
      const lo = (order[a.loader] ?? 99) - (order[b.loader] ?? 99)
      if (lo !== 0) return lo
      return b.mcVersion > a.mcVersion ? 1 : b.mcVersion < a.mcVersion ? -1 : 0
    })
  })

  function matrixHealthDotClass(row: MatrixHealthRow): Record<string, boolean> {
    return {
      'ext-dot': true,
      'is-ok': row.health === 'green',
      'is-busy': row.health === 'yellow',
      'is-fail': row.health === 'red' || row.health === 'deprecated',
      'is-beta': row.health === 'beta',
      'is-idle': row.health === 'unknown'
    }
  }

  function matrixHealthLabel(row: MatrixHealthRow): string {
    let label: string
    switch (row.health) {
      case 'green':
        label = t('settings.ai.matrix.healthGreen')
        break
      case 'yellow':
        label = t('settings.ai.matrix.healthYellow')
        break
      case 'red':
        label = t('settings.ai.matrix.healthRed')
        break
      case 'deprecated':
        label = t('settings.ai.matrix.healthDeprecated')
        break
      case 'beta':
        label = t('settings.ai.matrix.healthBeta')
        break
      default:
        label = t('settings.ai.matrix.healthUnknown')
    }
    return t('settings.ai.matrix.label', { label, rate: row.passRate })
  }

  function formatMatrixTime(iso: string | null): string {
    if (!iso) return '—'
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    return d.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
  }

  async function refreshMatrixHealth(): Promise<void> {
    matrixLoading.value = true
    try {
      const state = await window.api.monitor.getState()
      matrixCells.value = state.cells ?? []
    } catch {
      matrixCells.value = []
    } finally {
      matrixLoading.value = false
    }
  }

  return {
    matrixLoading,
    matrixHealthRows,
    matrixHealthDotClass,
    matrixHealthLabel,
    formatMatrixTime,
    refreshMatrixHealth
  }
}
