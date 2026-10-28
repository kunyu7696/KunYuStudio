/**
 * P1 Mixin FC 工具单测：
 * mixin_target_lookup（内置速查/mcdev 追加/降级）、mixin_scaffold（骨架生成+落盘）、
 * mixin_register（mixins.json 创建/幂等/fabric.mod.json 同步）、mixin_validate（交叉校验）。
 */
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createToolRegistry, type ToolRegistry, type ToolResult } from '../toolRegistry'
import type { McpToolPort } from '../toolRegistry'

const CTX = { loader: 'fabric' as const, mcVersion: '1.20.1' }
const PKG = 'com.example.testmod'

let root: string
let registry: ToolRegistry

function writeFabricMod(): void {
  mkdirSync(join(root, 'src', 'main', 'resources'), { recursive: true })
  writeFileSync(
    join(root, 'src', 'main', 'resources', 'fabric.mod.json'),
    JSON.stringify({ id: 'testmod', name: 'Test Mod' })
  )
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'kunyu-mixin-'))
  writeFabricMod()
  writeFileSync(join(root, 'gradle.properties'), `maven_group=${PKG}\narchives_base_name=testmod\n`)
  registry = createToolRegistry({ projectRoot: () => root })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

async function run(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  return registry.executeTool(name, args, CTX)
}

const mixinJavaRel = (n: string): string => join('src', 'main', 'java', ...PKG.split('.'), 'mixin', n)
const cfgRel = (): string => join('src', 'main', 'resources', 'testmod.mixins.json')

describe('工具注册与可用性', () => {
  it('四个工具均注册；无项目时仅 target_lookup 暴露', () => {
    const names = registry.getToolDefinitions().map((d) => d.function.name)
    for (const n of ['mixin_target_lookup', 'mixin_scaffold', 'mixin_register', 'mixin_validate']) {
      expect(names).toContain(n)
    }
    const noProject = createToolRegistry({})
    const n2 = noProject.getToolDefinitions().map((d) => d.function.name)
    expect(n2).toContain('mixin_target_lookup')
    expect(n2).not.toContain('mixin_scaffold')
    expect(n2).not.toContain('mixin_register')
    expect(n2).not.toContain('mixin_validate')
  })
})

describe('mixin_target_lookup', () => {
  it('query 命中内置 Yarn 速查并标注端侧；mcdev 未就绪给降级提示', async () => {
    const r = await run('mixin_target_lookup', { query: 'MinecraftClient tick' })
    expect(r.ok).toBe(true)
    expect(r.text).toContain('net.minecraft.client.MinecraftClient')
    expect(r.text).toContain('tick()V')
    expect(r.text).toContain('client')
    expect(r.text).toContain('mcdev-mcp 未就绪')
  })

  it('mcdev 就绪时追加实时映射结果', async () => {
    const callStaticTool = vi.fn(async () => ({ ok: true, text: 'MCDEV-LIVE' }))
    const mcp = {
      isEnabled: () => true,
      getStatus: () => ({ kind: 'ready' }),
      callStaticTool
    } as unknown as McpToolPort
    const reg = createToolRegistry({ mcp })
    const r = await reg.executeTool(
      'mixin_target_lookup',
      { className: 'net.minecraft.entity.LivingEntity', methodName: 'damage' },
      CTX
    )
    expect(r.ok).toBe(true)
    expect(r.text).toContain('MCDEV-LIVE')
    expect(callStaticTool).toHaveBeenCalledWith('mc_get_method', {
      className: 'net.minecraft.entity.LivingEntity',
      methodName: 'damage'
    })
  })

  it('无参数时返回完整速查目录', async () => {
    const r = await run('mixin_target_lookup', {})
    expect(r.ok).toBe(true)
    expect(r.text).toContain('LivingEntity')
    expect(r.text).toContain('TitleScreen')
  })
})

describe('mixin_scaffold', () => {
  it('参数校验：非法类名/类名不以 Mixin 结尾/缺 method', async () => {
    expect((await run('mixin_scaffold', { targetClass: 'LivingEntity', mixinClassName: 'XMixin', injection: 'inject' })).ok).toBe(false)
    expect((await run('mixin_scaffold', { targetClass: 'net.minecraft.entity.LivingEntity', mixinClassName: 'Living', injection: 'inject' })).ok).toBe(false)
    expect((await run('mixin_scaffold', { targetClass: 'net.minecraft.entity.LivingEntity', mixinClassName: 'LMixin', injection: 'inject' })).ok).toBe(false)
    expect((await run('mixin_scaffold', { targetClass: 'net.minecraft.entity.LivingEntity', mixinClassName: 'AMixin', injection: 'accessor' })).ok).toBe(false)
  })

  it('生成 @Inject HEAD 骨架并落盘（cancellable 用 CallbackInfoReturnable）', async () => {
    const r = await run('mixin_scaffold', {
      targetClass: 'net.minecraft.client.MinecraftClient',
      mixinClassName: 'ClientTickMixin',
      injection: 'inject',
      method: 'tick',
      cancellable: true,
      write: true
    })
    expect(r.ok).toBe(true)
    const rel = mixinJavaRel('ClientTickMixin.java')
    expect(existsSync(join(root, rel))).toBe(true)
    const src = readFileSync(join(root, rel), 'utf-8')
    expect(src).toContain(`package ${PKG}.mixin;`)
    expect(src).toContain('@Mixin(MinecraftClient.class)')
    expect(src).toContain('@Inject(method = "tick", at = @At("HEAD"), cancellable = true)')
    expect(src).toContain('CallbackInfoReturnable')
    expect(src).toContain('import net.minecraft.client.MinecraftClient;')
    // 重复写入被拒
    const again = await run('mixin_scaffold', {
      targetClass: 'net.minecraft.client.MinecraftClient',
      mixinClassName: 'ClientTickMixin',
      injection: 'inject',
      method: 'tick',
      write: true
    })
    expect(again.ok).toBe(false)
    expect(again.error).toContain('已存在')
  })

  it('accessor 生成 interface + @Accessor/@Mutable', async () => {
    const r = await run('mixin_scaffold', {
      targetClass: 'net.minecraft.entity.LivingEntity',
      mixinClassName: 'LivingAccessorMixin',
      injection: 'accessor',
      field: 'jumpingCooldown',
      fieldType: 'int',
      mutable: true
    })
    expect(r.ok).toBe(true)
    expect(r.text).toContain('public interface LivingAccessorMixin')
    expect(r.text).toContain('@Accessor("jumpingCooldown")')
    expect(r.text).toContain('@Mutable')
  })

  it('redirect 缺 invokeTarget 时 ok=false 并给 TODO 警告', async () => {
    const r = await run('mixin_scaffold', {
      targetClass: 'net.minecraft.client.MinecraftClient',
      mixinClassName: 'TickRedirectMixin',
      injection: 'redirect',
      method: 'tick'
    })
    expect(r.ok).toBe(false)
    expect(r.text).toContain('@Redirect')
    expect(r.text).toContain('invokeTarget')
  })

  it('无 fabric.mod.json 时落盘失败', async () => {
    rmSync(join(root, 'src', 'main', 'resources', 'fabric.mod.json'))
    const r = await run('mixin_scaffold', {
      targetClass: 'net.minecraft.client.MinecraftClient',
      mixinClassName: 'ClientTickMixin',
      injection: 'inject',
      method: 'tick',
      write: true
    })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('fabric.mod.json')
  })
})

describe('mixin_register', () => {
  it('首次创建标准 mixins.json 并同步 fabric.mod.json（通用数组、幂等）', async () => {
    const r1 = await run('mixin_register', { mixinClassName: 'LivingHurtMixin', environment: 'main' })
    expect(r1.ok).toBe(true)
    expect(r1.data).toMatchObject({ created: true, array: 'mixins', className: 'LivingHurtMixin' })
    const cfg = JSON.parse(readFileSync(join(root, cfgRel()), 'utf-8'))
    expect(cfg).toMatchObject({
      required: true,
      package: `${PKG}.mixin`,
      compatibilityLevel: 'JAVA_17'
    })
    expect(cfg['mixins']).toEqual(['LivingHurtMixin'])
    expect(cfg['client']).toEqual([])
    expect(cfg['injectors']).toEqual({ defaultRequire: 1 })
    const fabric = JSON.parse(readFileSync(join(root, 'src', 'main', 'resources', 'fabric.mod.json'), 'utf-8'))
    expect(fabric['mixins']).toEqual(['testmod.mixins.json'])

    const r2 = await run('mixin_register', { mixinClassName: `${PKG}.mixin.LivingHurtMixin`, environment: 'main' })
    expect(r2.ok).toBe(true)
    expect(r2.data).toMatchObject({ already: true })
    const cfg2 = JSON.parse(readFileSync(join(root, cfgRel()), 'utf-8'))
    expect(cfg2['mixins']).toEqual(['LivingHurtMixin'])
  })

  it('client 目标进 client 数组', async () => {
    const r = await run('mixin_register', { mixinClassName: 'ClientTickMixin', environment: 'client' })
    expect(r.ok).toBe(true)
    const cfg = JSON.parse(readFileSync(join(root, cfgRel()), 'utf-8'))
    expect(cfg['client']).toEqual(['ClientTickMixin'])
    expect(cfg['mixins']).toEqual([])
  })

  it('package 不一致时拒绝写入', async () => {
    mkdirSync(join(root, 'src', 'main', 'resources'), { recursive: true })
    writeFileSync(
      join(root, cfgRel()),
      JSON.stringify({ package: 'wrong.pkg.mixin', compatibilityLevel: 'JAVA_17', mixins: [], client: [] })
    )
    const r = await run('mixin_register', { mixinClassName: 'XMixin', environment: 'main' })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('package')
  })
})

describe('mixin_validate', () => {
  it('scaffold+register 全链路装配通过', async () => {
    const s = await run('mixin_scaffold', {
      targetClass: 'net.minecraft.client.MinecraftClient',
      mixinClassName: 'ClientTickMixin',
      injection: 'inject',
      method: 'tick',
      write: true
    })
    expect(s.ok).toBe(true)
    const r = await run('mixin_register', { mixinClassName: 'ClientTickMixin', environment: 'client' })
    expect(r.ok).toBe(true)
    const v = await run('mixin_validate', {})
    expect(v.ok).toBe(true)
    expect(v.text).toContain('校验通过')
  })

  it('磁盘存在但未注册 → 报错', async () => {
    await run('mixin_scaffold', {
      targetClass: 'net.minecraft.client.MinecraftClient',
      mixinClassName: 'ClientTickMixin',
      injection: 'inject',
      method: 'tick',
      write: true
    })
    const v = await run('mixin_validate', {})
    expect(v.ok).toBe(false)
    expect(v.text).toContain('未在 mixins.json 注册')
  })

  it('引用 client 包却放通用数组 → 报错', async () => {
    await run('mixin_scaffold', {
      targetClass: 'net.minecraft.client.MinecraftClient',
      mixinClassName: 'ClientTickMixin',
      injection: 'inject',
      method: 'tick',
      write: true
    })
    await run('mixin_register', { mixinClassName: 'ClientTickMixin', environment: 'main' })
    const v = await run('mixin_validate', {})
    expect(v.ok).toBe(false)
    expect(v.text).toContain('client 数组')
  })

  it('注册类文件缺失 + fabric.mod.json 缺引用 → 报错', async () => {
    // 手工只写配置，不写 java，且移除 fabric.mod.json 的 mixins
    await run('mixin_register', { mixinClassName: 'GhostMixin', environment: 'main' })
    const fabricPath = join(root, 'src', 'main', 'resources', 'fabric.mod.json')
    const fabric = JSON.parse(readFileSync(fabricPath, 'utf-8'))
    delete fabric['mixins']
    writeFileSync(fabricPath, JSON.stringify(fabric))
    const v = await run('mixin_validate', { mixinClassName: 'GhostMixin' })
    expect(v.ok).toBe(false)
    expect(v.text).toContain('文件不存在')
    expect(v.text).toContain('mixins 未引用')
  })

  it('compatibilityLevel 非 JAVA_17 → 报错；重复注册 → 报错', async () => {
    await run('mixin_register', { mixinClassName: 'LivingHurtMixin', environment: 'main' })
    const cfgPath = join(root, cfgRel())
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf-8'))
    cfg['compatibilityLevel'] = 'JAVA_16'
    cfg['mixins'].push('LivingHurtMixin')
    writeFileSync(cfgPath, JSON.stringify(cfg))
    const v = await run('mixin_validate', {})
    expect(v.ok).toBe(false)
    expect(v.text).toContain('JAVA_17')
    expect(v.text).toContain('重复注册')
  })

  it('cancel 但未 cancellable → 警告（不致命）', async () => {
    const rel = mixinJavaRel('WarnMixin.java')
    mkdirSync(join(root, join(rel, '..')), { recursive: true })
    writeFileSync(
      join(root, rel),
      `package ${PKG}.mixin;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
import net.minecraft.entity.LivingEntity;
@Mixin(LivingEntity.class)
public class WarnMixin {
  @Inject(method = "tick", at = @At("HEAD"))
  private void onTick(CallbackInfo ci) { ci.cancel(); }
}
`
    )
    await run('mixin_register', { mixinClassName: 'WarnMixin', environment: 'main' })
    const v = await run('mixin_validate', {})
    expect(v.ok).toBe(true)
    expect(v.text).toContain('cancellable=true')
  })
})
