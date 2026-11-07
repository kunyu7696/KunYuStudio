/**
 * 工具清单守门：docs/TOOLS-INVENTORY.json 必须与注册表实测一致。
 *
 * 背景：文档此前分别写着「93 个」和「66 个」，而实测无项目 35、模组项目 88——
 * 工具是按上下文门控动态暴露的，任何手写数字都会过期。
 * 现在数字只来自 collectToolInventory()，本测试负责发现"代码加了工具但没更新清单"。
 * 失败时按提示运行 `npm run tools:inventory` 重新生成即可。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { collectToolInventory, serializeInventory } from '../toolInventory'

const INVENTORY_PATH = resolve(process.cwd(), 'docs/TOOLS-INVENTORY.json')

describe('内置工具清单单一数据源', () => {
  it('docs/TOOLS-INVENTORY.json 与注册表实测完全一致', () => {
    const actual = serializeInventory(collectToolInventory())
    // 换行归一化：Windows checkout 时 git autocrlf 会把文件转成 CRLF，
    // 而 serializeInventory 始终产出 LF。这里统一成 LF 再比较，避免平台差异误报。
    const committed = readFileSync(INVENTORY_PATH, 'utf8').replace(/\r\n/g, '\n')
    expect(
      committed,
      '工具清单已过期：请运行 npm run tools:inventory 重新生成 docs/TOOLS-INVENTORY.json'
    ).toBe(actual)
  })

  it('三个运行态的工具数单调不减（项目上下文只会增加门控放行的工具）', () => {
    const inv = collectToolInventory()
    expect(inv.chat.count).toBeLessThanOrEqual(inv.mod.count)
    expect(inv.mod.count).toBeLessThanOrEqual(inv.modpack.count)
  })
})
