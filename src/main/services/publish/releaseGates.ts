/**
 * 发布质量门（发布前 preflight 检查）。
 *
 * 与 runPublishPreflight（产物 + 元数据逐项门）互补：这里查「项目内容质量」——
 * 许可合规、依赖缺席、运行验收、版本组合健康度。质量门三态语义：
 * - severity 'block'：硬门，不过则禁止发布（不触碰网络）
 * - severity 'warn'：软告警，如实呈现由人定夺（INCONCLUSIVE 显式化，不假放行也不误拦截）
 *
 * 纯同步、不触网；组合健康度经 deps.getHealth 注入（主进程传参考包服务，测试传桩），
 * 本模块不 import electron，保持单测零 mock。
 */
import { classifyJars, isGameVessel } from '../modpack/classify'
import { auditDependencies, extractJarDeps } from '../modpack/dependencyAudit'
import { readLaunchTestRecord } from '../modpack/launchTest'
import { classifyRedistribution } from '../modpack/licensePolicy'
import { scanModCandidates } from '../modpack/modpackAssembler'
import { readSources } from '../modpack/provenance'
import type { ComboHealth } from '../../../shared/types/monitor'

/** 单项质量门结论 */
export interface ReleaseGateCheck {
  id: string
  label: string
  /** block=硬门（不过禁止发布）；warn=软告警（呈现由人定夺） */
  severity: 'block' | 'warn'
  ok: boolean
  detail?: string
}

export interface ReleaseQualityResult {
  /** 全部 block 项通过才为 true（warn 项不影响 ready） */
  ready: boolean
  checks: ReleaseGateCheck[]
}

export interface ReleaseGateMeta {
  mcVersion: string
  loader: string
}

export interface ReleaseGateDeps {
  /** 查询 (loader, mcVersion) 组合健康度（主进程接参考包服务，测试接桩） */
  getHealth(loader: string, mcVersion: string): ComboHealth
}

function fmtTime(at: number): string {
  return new Date(at).toLocaleString('zh-CN', { hour12: false })
}

/**
 * 发布质量门：逐项产出 block/warn 检查结论。
 * 检查面：
 * 1. 许可合规（随包再分发）：restricted 硬门 / copyleft、unknown 软告警
 * 2. 依赖审计：缺必需前置、冲突共存硬门 / 缺可选联动软告警
 * 3. 运行验收：最近一次启动测试 verdict 分档（无记录=未验证软告警）
 * 4. 组合健康度：版本矩阵灯色（非 green/yellow 软告警）
 */
export function runReleaseQualityGates(
  projectRoot: string,
  meta: ReleaseGateMeta,
  deps: ReleaseGateDeps
): ReleaseQualityResult {
  const checks: ReleaseGateCheck[] = []
  const push = (
    id: string,
    label: string,
    severity: 'block' | 'warn',
    ok: boolean,
    detail?: string
  ): void => {
    checks.push(detail ? { id, label, severity, ok, detail } : { id, label, severity, ok })
  }

  const candidates = scanModCandidates(projectRoot).filter(
    (c) => c.validZip && !isGameVessel(c.fileName)
  )
  const sources = readSources(projectRoot)

  /* ---- 1. 许可合规（只查随包再分发的 jar；清单引用走平台 CDN 不构成再分发） ---- */
  const bundled = classifyJars(candidates, sources).jars.filter((j) => j.bundledInOverrides)
  const byClass = { restricted: [] as string[], copyleft: [] as string[], unknown: [] as string[] }
  for (const j of bundled) {
    const cls = classifyRedistribution(sources.get(j.fileName)?.license ?? null)
    if (cls === 'permissive') continue
    byClass[cls].push(j.fileName)
  }
  push(
    'license-restricted',
    '许可合规（限制性许可）',
    'block',
    byClass.restricted.length === 0,
    byClass.restricted.length > 0
      ? `${byClass.restricted.join('、')} 为保留所有权利/专有许可，原则上禁止随包再分发：请改为平台清单引用或取得作者授权。`
      : undefined
  )
  push(
    'license-copyleft',
    '许可合规（copyleft 义务）',
    'warn',
    byClass.copyleft.length === 0,
    byClass.copyleft.length > 0
      ? `${byClass.copyleft.join('、')} 为 copyleft 许可：可再分发但须保留声明并遵守其义务，请在整合包说明中注明。`
      : undefined
  )
  push(
    'license-unknown',
    '许可合规（许可未知）',
    'warn',
    byClass.unknown.length === 0,
    byClass.unknown.length > 0
      ? `${byClass.unknown.length} 个随包模组无许可数据（${byClass.unknown.slice(0, 5).join('、')}${byClass.unknown.length > 5 ? ' 等' : ''}）：CurseForge API 不返回许可字段，发布前请人工确认。`
      : undefined
  )

  /* ---- 2. 依赖审计（jar 内元数据声明 vs 全包 modId 集合） ---- */
  const audit = auditDependencies(
    candidates.map((c) => extractJarDeps(c.absPath, c.fileName))
  )
  push(
    'deps-required',
    '依赖审计（必需前置）',
    'block',
    audit.missingRequired.length === 0,
    audit.missingRequired.length > 0
      ? `缺必需前置：${audit.missingRequired.join('；')}`
      : undefined
  )
  push(
    'deps-conflicts',
    '依赖审计（冲突共存）',
    'block',
    audit.conflicts.length === 0,
    audit.conflicts.length > 0 ? `声明冲突的模组共存：${audit.conflicts.join('；')}` : undefined
  )
  push(
    'deps-optional',
    '依赖审计（可选联动）',
    'warn',
    audit.missingOptional.length === 0,
    audit.missingOptional.length > 0
      ? `可选联动缺席（相关功能将降级不可用）：${audit.missingOptional.join('；')}`
      : undefined
  )

  /* ---- 2.5 导出产物卫生（P9：测试/观察控制组件不得随包发布） ----
   * kunyu-observer 系是开发期观察组件（legacy 观察 mod jar；现行 javaagent 不走 mods
   * 目录不受影响）——随包发布会把 KunYu 工具链内部组件塞给终端玩家，硬门拦截。 */
  const testControlJars = candidates
    .map((c) => c.fileName)
    .filter((name) => /^kunyu-observer.*\.jar$/i.test(name))
  push(
    'artifact-hygiene',
    '导出产物卫生（测试控制组件）',
    'block',
    testControlJars.length === 0,
    testControlJars.length > 0
      ? `${testControlJars.join('、')} 为 KunYu 开发期观察/测试组件，不得随包发布：请从 run/mods 移除后再导出。`
      : undefined
  )

  /* ---- 3. 运行验收（最近一次启动测试落盘记录） ---- */
  const record = readLaunchTestRecord(projectRoot)
  if (!record) {
    push(
      'launch-test',
      '运行验收（启动测试）',
      'warn',
      false,
      '尚未做过启动测试——整合包能否真实进入游戏未验证（INCONCLUSIVE）。建议先执行「启动测试」再发布。'
    )
  } else if (record.verdict === 'crashed' || record.verdict === 'failed') {
    push(
      'launch-test',
      '运行验收（启动测试）',
      'block',
      false,
      `最近一次启动测试（${fmtTime(record.at)}）判定为 ${record.verdict}：${record.summary}`
    )
  } else if (record.verdict === 'timeout' || record.verdict === 'launched-only') {
    push(
      'launch-test',
      '运行验收（启动测试）',
      'warn',
      false,
      `最近一次启动测试（${fmtTime(record.at)}）未获充分证据（${record.verdict}）：${record.summary}`
    )
  } else {
    push(
      'launch-test',
      '运行验收（启动测试）',
      'warn',
      true,
      `最近一次启动测试（${fmtTime(record.at)}）通过：${record.verdict}`
    )
  }

  /* ---- 4. 组合健康度（版本矩阵灯色：真机验证状态） ---- */
  const health = deps.getHealth(meta.loader, meta.mcVersion)
  const healthOk = health === 'green' || health === 'yellow'
  push(
    'combo-health',
    '版本组合健康度',
    'warn',
    healthOk,
    healthOk
      ? health === 'yellow'
        ? '该组合灯色为黄（存在版本漂移提示），发布前请留意。'
        : undefined
      : health === 'unknown'
        ? `组合 ${meta.loader}/${meta.mcVersion} 尚未完成真机验证（灯色未知），发布前建议先跑构建探针。`
        : `组合 ${meta.loader}/${meta.mcVersion} 灯色为 ${health}（异常/弃用），发布有风险，请人工确认。`
  )

  return { ready: checks.filter((c) => c.severity === 'block').every((c) => c.ok), checks }
}
