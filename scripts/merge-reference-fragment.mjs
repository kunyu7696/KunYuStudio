/**
 * 将 manifest.templates.fragment.json 并入 manifest.json（gen-loader-templates.mjs 流水线第二步）。
 *
 * - 模板数组按 id 去重追加（fragment 覆盖同名旧条目）
 * - stats 全量重算：templateCount/activeTemplateCount/inactiveComboCount/
 *   inactiveRegisteredTemplateCount/provenance 计数，vendorClaims.honest* 同步
 * - 合并成功后删除 fragment（避免打包冗余与双源不一致）
 *
 * 用法：node scripts/merge-reference-fragment.mjs
 */
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(process.cwd(), 'resources', 'ai-reference')
const manifestPath = resolve(root, 'manifest.json')
const fragmentPath = resolve(root, 'manifest.templates.fragment.json')

if (!existsSync(manifestPath)) throw new Error(`manifest 不存在：${manifestPath}`)
if (!existsSync(fragmentPath)) throw new Error(`fragment 不存在：${fragmentPath}`)

const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
const fragment = JSON.parse(readFileSync(fragmentPath, 'utf-8'))
if (!Array.isArray(fragment) || fragment.length === 0) throw new Error('fragment 为空或非数组')

// 1) 按 id 合并（fragment 优先）
const byId = new Map(manifest.templates.map((t) => [t.id, t]))
let overridden = 0
for (const t of fragment) {
  if (byId.has(t.id)) overridden += 1
  byId.set(t.id, t)
}
manifest.templates = [...byId.values()]

// 2) 全量重算 stats（诚实口径：以实际数组为准）
const provCounts = { pdf: 0, scaffold: 0, 'mdk-adapted': 0 }
for (const t of manifest.templates) {
  provCounts[t.provenance] = (provCounts[t.provenance] ?? 0) + 1
}
const inactiveCombos = manifest.scopeControl.registeredButInactive
manifest.stats = {
  ...manifest.stats,
  templateCount: manifest.templates.length,
  activeTemplateCount: manifest.templates.filter((t) => t.active === true).length,
  inactiveComboCount: inactiveCombos.length,
  inactiveRegisteredTemplateCount: inactiveCombos.reduce((a, c) => a + c.templateCount, 0),
  provenance: provCounts
}

// 3) vendorClaims：正式声明改为与实物一致，旧口径留档在 note
const claims = manifest.stats.vendorClaims
claims.claimedTemplateFiles = manifest.stats.templateCount
claims.claimedActiveTemplates = manifest.stats.activeTemplateCount
claims.note =
  'fabric/1.20.1 41 个模板沿用源 PDF 提取口径（pdf+scaffold）；' +
  'forge/1.20.1 与 neoforge/1.21.1 各 41 个模板由官方 MDK 适配改写（provenance=mdk-adapted），' +
  '与 fabric 目录一一对应（含记录在案的改名规则）。errorPatterns/apiIndex 为实际入库条数。'

manifest.generatedAt = new Date().toISOString()

writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8')
unlinkSync(fragmentPath)

console.log(
  `合并完成：templates=${manifest.templates.length}（fragment=${fragment.length}，覆盖=${overridden}），` +
    `inactiveCombos=${manifest.stats.inactiveComboCount}，provenance=${JSON.stringify(provCounts)}`
)
