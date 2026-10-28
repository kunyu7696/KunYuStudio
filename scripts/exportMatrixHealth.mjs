/**
 * CI 矩阵健康快照导出（统一成套整改后的配套步骤）。
 *
 * 数据流向：矩阵门禁（test:matrix）真机构建 → 写统一存储 overlay
 * （.dev-userdata/ai/ai-reference-overlay.json，运行时唯一真源）→ 本脚本把
 * health/verifiedAt/matrixHealth 快照合并回仓库 manifest.json（发布基线），
 * 由 CI artifact + commit 落回仓库。方向单向（overlay → manifest），
 * 门禁与任何测试均不直接写 manifest。
 *
 * 用法：node scripts/exportMatrixHealth.mjs
 * 环境变量：KY_MATRIX_HEALTH_PATH 可覆盖 overlay 读取路径。
 * overlay 不存在时打印提示并以 0 退出（不阻塞 CI）。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const overlayPath =
  process.env.KY_MATRIX_HEALTH_PATH ??
  join(root, '.dev-userdata', 'ai', 'ai-reference-overlay.json')
const manifestPath = join(root, 'resources', 'ai-reference', 'manifest.json')

if (!existsSync(overlayPath)) {
  console.warn(`[export-matrix-health] overlay 不存在（${overlayPath}），跳过导出`)
  process.exit(0)
}

const overlay = JSON.parse(readFileSync(overlayPath, 'utf-8'))
const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))

let updated = 0
for (const fp of manifest.versionFingerprints ?? []) {
  const combo = overlay.combos?.[fp.id]
  // 只导出带门禁档案的组合（matrixHealth 由真机构建产生；探针/监测记录不含档案不回写）
  if (!combo?.matrixHealth) continue
  fp.matrixHealth = combo.matrixHealth
  fp.health = combo.health
  fp.verifiedAt = combo.verifiedAt
  updated++
}

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8')
console.log(`[export-matrix-health] 已把 ${updated} 个组合的门禁档案快照导出到 manifest.json`)
