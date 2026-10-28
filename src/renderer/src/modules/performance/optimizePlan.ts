/**
 * 一键优化向导：画像建议 → 安全动作的映射（纯逻辑，便于测试 TR-15/16）。
 *
 * 自动范围严格收敛：
 * - 仅 action=disable / remove 且能从 identity.filePath 取到 jar 文件名时生成动作
 * - config 需要 actionDetail 编码为 `路径::键=值`，否则不自动
 * - manual 一律不自动
 */
import type {
  ModIdentity,
  PlannedAction,
  ProfileAdvice
} from '../../../../shared/schemas/performance/profile'
import { t } from '../../i18n'

/** 跨平台取文件名（渲染端无 node:path） */
export function baseName(p: string): string {
  const parts = p.split(/[\\/]/).filter((s) => s.length > 0)
  return parts[parts.length - 1] ?? ''
}

/** 解析配置动作详情；约定 `相对路径::键=值` */
export function parseConfigDetail(detail: string): {
  file: string
  key: string
  value: string
} | null {
  const match = /^(.*?)::(.+?)=(.*)$/.exec(detail.trim())
  if (!match) return null
  const [, file, key, value] = match
  if (!file || !key) return null
  return { file, key, value }
}

/** 单条建议 → 可执行动作；不可自动返回 null */
export function actionFromAdvice(
  identity: ModIdentity,
  advice: ProfileAdvice
): PlannedAction | null {
  if (advice.action === 'disable' || advice.action === 'remove') {
    const file = baseName(identity.filePath)
    if (!file) return null
    return { kind: advice.action, target: file, adviceId: advice.id }
  }
  if (advice.action === 'config') {
    const parsed = parseConfigDetail(advice.actionDetail)
    if (!parsed) return null
    return {
      kind: 'config',
      target: parsed.file,
      configKey: parsed.key,
      configValue: parsed.value,
      adviceId: advice.id
    }
  }
  return null
}

export interface SelectableAdvice {
  advice: ProfileAdvice
  action: PlannedAction
}

/** 画像内所有可自动执行的建议（manual 已过滤） */
export function selectableAdvices(
  identity: ModIdentity,
  advices: ProfileAdvice[]
): SelectableAdvice[] {
  const result: SelectableAdvice[] = []
  for (const advice of advices) {
    const action = actionFromAdvice(identity, advice)
    if (action) result.push({ advice, action })
  }
  return result
}

/** 影响预览单行（向导执行前展示，无 IO） */
export interface PreviewLine {
  kind: PlannedAction['kind']
  target: string
  effect: string
}

/** 生成影响预览文本（纯函数，与主进程执行器语义一致） */
export function previewActions(actions: PlannedAction[]): PreviewLine[] {
  return actions.map((a) => {
    if (a.kind === 'disable') {
      return {
        kind: a.kind,
        target: a.target,
        effect: t('performance.wizard.effect.disable', { target: a.target })
      }
    }
    if (a.kind === 'remove') {
      return {
        kind: a.kind,
        target: a.target,
        effect: t('performance.wizard.effect.remove', { target: a.target })
      }
    }
    return {
      kind: a.kind,
      target: a.target,
      effect: t('performance.wizard.effect.config', {
        key: a.configKey ?? '',
        value: a.configValue ?? '',
        target: a.target
      })
    }
  })
}

/**
 * 开发环境运行目录：<project>/run/mods、<project>/run/config。
 * 整合包路径由 Task 17 的流程上下文提供。
 */
export function runtimeRoots(projectPath: string): {
  modsRoot: string
  configRoot: string
} {
  const root = projectPath.replace(/[\\/]+$/, '')
  return { modsRoot: `${root}/run/mods`, configRoot: `${root}/run/config` }
}
