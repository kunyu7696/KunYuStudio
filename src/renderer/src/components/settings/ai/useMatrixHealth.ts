import { computed, ref } from 'vue'
import type { ComboMatrixCell } from '../../../../../shared/types/monitor'
import { t } from '../../../i18n'
import type { MatrixHealthRow } from './types'

/** 三态门禁的阶段顺序（编译 → 加载 → 进游戏） */
export const MATRIX_STAGE_KEYS = ['compile', 'load', 'runtime'] as const
export type MatrixStageKey = (typeof MATRIX_STAGE_KEYS)[number]

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
      health: c.health,
      stages: c.matrixHealth?.stages
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

  /**
   * 编译态解析：优先读 stages.compile；但该字段当前不由门禁写入
   * （CI 编译门禁只更新 templateCount/verifiedCount/passRate 与 health），
   * 缺省时从统计派生，避免三态点里「编译」永远灰：
   *  green → 通过；yellow（待重测）/red/deprecated → 失败；unknown/beta（无档案）→ 未跑
   */
  function matrixStageState(
    row: MatrixHealthRow,
    stage: MatrixStageKey
  ): 'pass' | 'fail' | 'pending' {
    const result = row.stages?.[stage]
    if (result) return result.pass ? 'pass' : 'fail'
    if (stage !== 'compile') return 'pending'
    switch (row.health) {
      case 'green':
        return 'pass'
      case 'yellow':
      case 'red':
      case 'deprecated':
        return 'fail'
      default:
        return 'pending'
    }
  }

  /** 三态状态点：pass=绿 / fail=红 / pending=灰（未跑） */
  function matrixStageDotClass(row: MatrixHealthRow, stage: MatrixStageKey): Record<string, boolean> {
    const state = matrixStageState(row, stage)
    return {
      'ext-dot': true,
      'is-ok': state === 'pass',
      'is-fail': state === 'fail',
      'is-idle': state === 'pending'
    }
  }

  function matrixStageLabel(row: MatrixHealthRow, stage: MatrixStageKey): string {
    const name = t(`settings.ai.matrix.stage.${stage}`)
    const state = matrixStageState(row, stage)
    const stateText =
      state === 'pass'
        ? t('settings.ai.matrix.stagePass')
        : state === 'fail'
          ? t('settings.ai.matrix.stageFail')
          : t('settings.ai.matrix.stagePending')
    const result = row.stages?.[stage]
    let note = ''
    if (result?.note) {
      note = ` — ${result.note}`
    } else if (stage === 'compile' && state !== 'pending') {
      // 编译态由统计派生时说清来源，避免与真实落库的阶段结论混淆
      note = ` — ${t('settings.ai.matrix.stageCompileDerived', { rate: row.passRate })}`
    }
    return t('settings.ai.matrix.stageLabel', { stage: name, state: stateText, note })
  }

  function formatMatrixTime(iso: string | null): string {
    if (!iso) return '—'
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    return d.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
  }

  /** 进入设置页时读取当前状态（只读，不写盘） */
  async function loadMatrixHealth(): Promise<void> {
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

  /**
   * 刷新按钮：重读参考包基线，把比本地 overlay 更新的门禁结论并进来。
   * 返回本次采纳的条数（0 = 已是最新）。
   */
  async function refreshMatrixHealth(): Promise<number> {
    matrixLoading.value = true
    try {
      const res = await window.api.monitor.refresh()
      matrixCells.value = res.state.cells ?? []
      return res.syncedCombos ?? 0
    } catch {
      return 0
    } finally {
      matrixLoading.value = false
    }
  }

  return {
    matrixLoading,
    matrixHealthRows,
    matrixHealthDotClass,
    matrixHealthLabel,
    matrixStageDotClass,
    matrixStageLabel,
    formatMatrixTime,
    loadMatrixHealth,
    refreshMatrixHealth
  }
}
