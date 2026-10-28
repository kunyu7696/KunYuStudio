/**
 * P4 工具元信息目录单测：resolveVisibility 各规则语义 + clampGameTestTimeout 夹取边界。
 * 规则语义集中维护于 toolPolicy，片段只引用规则名，本 spec 是该目录的唯一回归保障。
 * P6 追加命名纪律（行为级注解 + 反向路由）的完整性/防漂移/引用真实性三重交叉校验。
 */
import { describe, expect, test } from 'vitest'
import {
  annotateToolDescription,
  clampGameTestTimeout,
  resolveVisibility,
  TOOL_BEHAVIOR_LABELS,
  TOOL_BEHAVIORS,
  TOOL_ROUTING,
  TOOL_TIMEOUTS
} from '../fcTools/toolPolicy'
import {
  createToolRegistry,
  type RegisteredTool,
  type ToolRegistryDeps
} from '../toolRegistry'
import { builtinRetrievalTools } from '../fcTools/chatRetrievalTools'
import { builtinGameControlTools } from '../fcTools/gameControlTools'
import { builtinRecipeTools } from '../fcTools/recipeTools'
import { builtinMixinTools } from '../fcTools/mixinTools'
import { builtinValidationTools } from '../fcTools/validationTools'
import { builtinForgeNeoTools } from '../fcTools/forgeNeoTools'
import { builtinFabricTools } from '../fcTools/fabricTools'
import { builtinMarketTools } from '../fcTools/marketTools'
import { builtinTodoTools } from '../fcTools/todoTools'
import { builtinWebTools } from '../fcTools/webTools'
import { builtinIdeTools } from '../fcTools/ideTools'
import { builtinMemoryTools } from '../fcTools/memoryTools'
import { builtinSubAgentTools } from '../fcTools/subAgentTools'
import { builtinContentTools } from '../fcTools/contentTools'
import { builtinSchedulingTools } from '../fcTools/schedulingTools'
import { builtinDecompileTools } from '../fcTools/decompileTools'
import { builtinAudioTools } from '../fcTools/audioTools'
import { builtinFtbTools } from '../fcTools/ftbTools'
import { builtinPatchouliTools } from '../fcTools/patchouliTools'
import { builtinKubejsTools } from '../fcTools/kubejsTools'

const deps = (partial: Partial<ToolRegistryDeps>): ToolRegistryDeps => partial as ToolRegistryDeps

describe('resolveVisibility', () => {
  test("'always' 恒可见", () => {
    expect(resolveVisibility('always', deps({}))()).toBe(true)
  })

  test("'project' 仅在有打开项目时可见", () => {
    expect(resolveVisibility('project', deps({}))()).toBe(false)
    expect(resolveVisibility('project', deps({ projectRoot: () => null }))()).toBe(false)
    expect(resolveVisibility('project', deps({ projectRoot: () => 'D:/p' }))()).toBe(true)
  })

  test("'fabric-project' 需项目且 loader 为 fabric/未知", () => {
    // 无项目：不可见（即便 loader 未知）
    expect(resolveVisibility('fabric-project', deps({}))()).toBe(false)
    // loader 未注入 → 保持旧行为不门控
    expect(resolveVisibility('fabric-project', deps({ projectRoot: () => 'D:/p' }))()).toBe(true)
    // loader 未知（null）→ 不门控
    expect(
      resolveVisibility('fabric-project', deps({ projectRoot: () => 'D:/p', projectLoader: () => null }))()
    ).toBe(true)
    expect(
      resolveVisibility('fabric-project', deps({ projectRoot: () => 'D:/p', projectLoader: () => 'fabric' }))()
    ).toBe(true)
    // Forge/NeoForge（Mojmap）→ 隐藏 Yarn 写盘工具（P1-9）
    expect(
      resolveVisibility('fabric-project', deps({ projectRoot: () => 'D:/p', projectLoader: () => 'forge' }))()
    ).toBe(false)
    expect(
      resolveVisibility('fabric-project', deps({ projectRoot: () => 'D:/p', projectLoader: () => 'neoforge' }))()
    ).toBe(false)
  })

  test("'modpack' 需项目且类型为整合包", () => {
    expect(resolveVisibility('modpack', deps({}))()).toBe(false)
    expect(resolveVisibility('modpack', deps({ projectRoot: () => 'D:/p' }))()).toBe(false)
    expect(resolveVisibility('modpack', deps({ projectRoot: () => 'D:/p', projectType: () => 'mod' }))()).toBe(false)
    expect(
      resolveVisibility('modpack', deps({ projectRoot: () => 'D:/p', projectType: () => 'modpack' }))()
    ).toBe(true)
  })

  test("'scheduler' 需注入 runGradle", () => {
    expect(resolveVisibility('scheduler', deps({}))()).toBe(false)
    expect(resolveVisibility('scheduler', deps({ runGradle: () => '' }))()).toBe(true)
  })

  test("'kb-rag' 需注入 kbRag 端口", () => {
    expect(resolveVisibility('kb-rag', deps({}))()).toBe(false)
    expect(resolveVisibility('kb-rag', deps({ kbRag: async () => null }))()).toBe(true)
  })
})

describe('createToolRegistry 规则接线', () => {
  const names = (d: ToolRegistryDeps): string[] =>
    createToolRegistry(d)
      .getToolDefinitions()
      .map((def) => def.function.name)

  test('无项目时 project 类工具不进入定义列表', () => {
    const list = names({})
    expect(list).not.toContain('project_grep')
    expect(list).not.toContain('fabric_content_register')
  })

  test('有项目且 loader=fabric 时 project / fabric-project 工具均可见', () => {
    const list = names({ projectRoot: () => 'D:/p', projectLoader: () => 'fabric' })
    expect(list).toContain('project_grep')
    expect(list).toContain('fabric_content_register')
  })

  test('有项目但 loader=forge 时 fabric-project 工具被隐藏（P1-9）', () => {
    const list = names({ projectRoot: () => 'D:/p', projectLoader: () => 'forge' })
    expect(list).toContain('project_grep')
    expect(list).not.toContain('fabric_content_register')
  })

  test('scheduler 工具不进模型定义列表，仅 includeScheduling 时出现', () => {
    const reg = createToolRegistry({ runGradle: () => '' })
    expect(reg.getToolDefinitions().map((d) => d.function.name)).not.toContain('gradle_build')
    expect(
      reg.getToolDefinitions({ includeScheduling: true }).map((d) => d.function.name)
    ).toContain('gradle_build')
  })
})

describe('clampGameTestTimeout', () => {
  test('缺省 / undefined 时取目录默认值', () => {
    expect(clampGameTestTimeout()).toBe(TOOL_TIMEOUTS.gameTestDefault)
    expect(clampGameTestTimeout(undefined)).toBe(120_000)
  })

  test('区间内原样返回', () => {
    expect(clampGameTestTimeout(60_000)).toBe(60_000)
    expect(clampGameTestTimeout(TOOL_TIMEOUTS.gameTestMin)).toBe(TOOL_TIMEOUTS.gameTestMin)
    expect(clampGameTestTimeout(TOOL_TIMEOUTS.gameTestMax)).toBe(TOOL_TIMEOUTS.gameTestMax)
  })

  test('低于下限夹到下限，高于上限夹到上限', () => {
    expect(clampGameTestTimeout(1)).toBe(TOOL_TIMEOUTS.gameTestMin)
    expect(clampGameTestTimeout(0)).toBe(TOOL_TIMEOUTS.gameTestMin)
    expect(clampGameTestTimeout(999_999)).toBe(TOOL_TIMEOUTS.gameTestMax)
  })
})

describe('命名纪律（P6）', () => {
  /**
   * 绕过 visibility 直收各域片段的全量工具名单（含当前未暴露的），
   * 作为行为级/反向路由目录的校验基准——与 toolRegistry.createToolRegistry 的
   * put() 序列保持同一来源，片段新增工具这里自动可见、漏登记即红。
   */
  const collectAll = (): RegisteredTool[] => {
    const d = deps({})
    return [
      ...builtinRetrievalTools(d),
      ...builtinGameControlTools(d),
      ...builtinRecipeTools(d),
      ...builtinMixinTools(d),
      ...builtinValidationTools(d),
      ...builtinForgeNeoTools(d),
      ...builtinFabricTools(d),
      ...builtinMarketTools(d),
      ...builtinTodoTools(),
      ...builtinWebTools(),
      ...builtinIdeTools(d),
      ...builtinMemoryTools(d),
      ...builtinSubAgentTools(d),
      ...builtinContentTools(d),
      ...builtinSchedulingTools(d),
      ...builtinDecompileTools(),
      ...builtinAudioTools(d),
      ...builtinFtbTools(d),
      ...builtinPatchouliTools(d),
      ...builtinKubejsTools(d)
    ]
  }
  const allNames = (): string[] => collectAll().map((t) => t.def.function.name)

  test('全量名单无重名（目录键与工具一一对应的前提）', () => {
    const names = allNames()
    expect(names.length).toBeGreaterThan(50)
    expect(new Set(names).size).toBe(names.length)
  })

  test('行为级目录完整且不多余（防漂移）', () => {
    const names = allNames()
    for (const n of names) {
      expect(TOOL_BEHAVIORS[n], `工具 ${n} 未登记行为级`).toBeDefined()
    }
    for (const k of Object.keys(TOOL_BEHAVIORS)) {
      expect(names, `行为级目录键 ${k} 无对应工具`).toContain(k)
    }
  })

  test('反向路由目录完整且不多余（防漂移）', () => {
    const names = allNames()
    for (const n of names) {
      expect(TOOL_ROUTING[n], `工具 ${n} 未登记反向路由`).toBeDefined()
    }
    for (const k of Object.keys(TOOL_ROUTING)) {
      expect(names, `反向路由目录键 ${k} 无对应工具`).toContain(k)
    }
  })

  test('反向路由引用的工具名真实存在（提取全部蛇形标识符逐一校验）', () => {
    const names = new Set(allNames())
    for (const [owner, routing] of Object.entries(TOOL_ROUTING)) {
      const refs = routing.match(/[a-z][a-z0-9]*(?:_[a-z0-9]+)+/g) ?? []
      for (const ref of refs) {
        expect(names.has(ref), `${owner} 的反向路由引用了不存在的工具「${ref}」`).toBe(true)
      }
    }
  })

  test('行为级取值均在三级枚举内且有中文标签', () => {
    for (const [k, b] of Object.entries(TOOL_BEHAVIORS)) {
      expect(TOOL_BEHAVIOR_LABELS[b], `工具 ${k} 的行为级 ${b} 无标签`).toBeDefined()
    }
  })

  test('入库后 description 已渲染行为级标签与反向路由（put 唯一渲染点）', () => {
    const reg = createToolRegistry(deps({ runGradle: () => '' }))
    const byName = new Map(
      reg.getToolDefinitions({ includeScheduling: true }).map((d) => [d.function.name, d.function.description])
    )
    // 恒可见只读工具：标签前置 + 反向路由后置
    const tpl = byName.get('template_search')
    expect(tpl).toMatch(/^【只读】/)
    expect(tpl).toContain('不适用：')
    expect(tpl).toContain('project_grep')
    // 调度工具同样经过渲染
    const gradle = byName.get('gradle_build')
    expect(gradle).toMatch(/^【外部副作用】/)
    // 有项目上下文时的写盘工具标签
    const regWithProject = createToolRegistry(deps({ projectRoot: () => 'D:/p' }))
    const wp = regWithProject
      .getToolDefinitions()
      .find((d) => d.function.name === 'write_project_file')
    expect(wp?.function.description).toMatch(/^【写项目盘】/)
  })

  test('annotateToolDescription：未登记工具原样返回（外部 MCP 桥接路径）', () => {
    expect(annotateToolDescription('unknown_mcp_tool', '外部工具描述')).toBe('外部工具描述')
  })
})
