/**
 * CI 矩阵健康快照导出（统一成套整改后的配套步骤）。
 *
 * 数据流向：矩阵门禁（test:matrix）真机构建 → 写统一存储 overlay
 * （.dev-userdata/ai/ai-reference-overlay.json，运行时唯一真源）→ 本脚本把
 * health/verifiedAt/matrixHealth 快照合并回仓库 manifest.json（发布基线），
 * 由 CI artifact + commit 落回仓库。方向单向（overlay → manifest），
 * 门禁与任何测试均不直接写 manifest。
 *
 * 为什么必须「合并」而不是「整体覆盖」：
 * 每个 CI 作业都以空 overlay 起步（overlay 不在仓库里）。三态门禁里的
 * load/runtime 作业只写 stages.load / stages.runtime，它们的 overlay 记录
 * 里没有编译统计（templateCount/verifiedCount/passRate 全是占位 0）、
 * health 也只会是 unknown。若整体覆盖，跑过运行时门禁的组合反而会
 * 从 green/100% 变成 unknown/0%——证据最全的组合数据看起来最差。
 * 故：只有写出 stages.compile 的作业（全量矩阵门禁）才拥有统计与灯色的解释权；
 * 只带 load/runtime 的作业仅合并阶段结果，其余字段一律保留基线值。
 *
 * 用法：node scripts/exportMatrixHealth.mjs
 * 环境变量：KY_MATRIX_HEALTH_PATH 可覆盖 overlay 读取路径。
 * overlay 不存在时打印提示并以 0 退出（不阻塞 CI）。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 把单条 overlay 组合记录合并进 manifest 指纹（纯函数，供回归测试直接调用）。
 * @returns 是否发生了合并（无 matrixHealth 档案时不动基线）
 */
export function mergeFingerprint(fp, combo) {
  const incoming = combo?.matrixHealth
  if (!incoming) return false

  const base = fp.matrixHealth ?? {}
  const incomingStages = incoming.stages ?? {}
  // 阶段是逐态累积的：保留基线已有的阶段，overlay 里的同名阶段覆盖之
  const stages = { ...(base.stages ?? {}), ...incomingStages }
  // 只有跑过编译门禁的作业才有资格改写统计与灯色
  const compileGate = Boolean(incomingStages.compile)

  if (compileGate) {
    fp.matrixHealth = { ...incoming, stages }
    fp.health = combo.health
    fp.verifiedAt = combo.verifiedAt
    return true
  }

  fp.matrixHealth = {
    templateCount: base.templateCount ?? 0,
    verifiedCount: base.verifiedCount ?? 0,
    passRate: base.passRate ?? 0,
    lastVerifiedAt: base.lastVerifiedAt ?? null,
    stages
  }
  return true
}

function main() {
  const root = resolve(import.meta.dirname, '..')
  const overlayPath =
    process.env.KY_MATRIX_HEALTH_PATH ??
    join(root, '.dev-userdata', 'ai', 'ai-reference-overlay.json')
  const manifestPath = join(root, 'resources', 'ai-reference', 'manifest.json')

  if (!existsSync(overlayPath)) {
    console.warn(`[export-matrix-health] overlay 不存在（${overlayPath}），跳过导出`)
    return
  }

  const overlay = JSON.parse(readFileSync(overlayPath, 'utf-8'))
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))

  let updated = 0
  for (const fp of manifest.versionFingerprints ?? []) {
    if (mergeFingerprint(fp, overlay.combos?.[fp.id])) updated++
  }

  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8')
  console.log(`[export-matrix-health] 已把 ${updated} 个组合的门禁档案快照导出到 manifest.json`)
}

// 仅在直接执行时跑 CLI；被 vitest 导入做回归测试时不产生副作用
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
