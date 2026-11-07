/**
 * 生成 docs/TOOLS-INVENTORY.json（工具数量的唯一数据源）。
 * 用法：npm run tools:inventory
 */
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { collectToolInventory, serializeInventory } from '../src/main/services/ai/toolInventory'

const inventory = collectToolInventory()
const outPath = resolve(process.cwd(), 'docs/TOOLS-INVENTORY.json')
writeFileSync(outPath, serializeInventory(inventory), 'utf8')

for (const [scenario, entry] of Object.entries(inventory)) {
  console.log(`[tools] ${scenario.padEnd(8)} ${String(entry.count).padStart(3)} 个  ${entry.label}`)
}
console.log(`[tools] 已写入 ${outPath}`)
