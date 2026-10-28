/**
 * P1 Mixin 工具四件套（Fabric 1.20.1 / Yarn / Mixin Java 17）：
 *
 * - mixin_target_lookup：注入目标速查（内置 Yarn 高频目标 + mcdev 实时映射查询 + Fabric 语料）
 * - mixin_scaffold：按注入类型生成 Mixin Java 骨架（可选直接落盘）
 * - mixin_register：幂等注册进 <modid>.mixins.json（client/main 数组）并同步 fabric.mod.json
 * - mixin_validate：交叉校验 java 骨架 / mixins.json / fabric.mod.json 三者一致性
 *
 * 设计原则：所有文件操作限定当前打开项目；配置文件 JSON 不写注释（注释仅存在于参考模板）。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getKnowledgeBase } from '../../knowledgeSearch'
import type { McpToolPort, RegisteredTool, ToolRegistryDeps, ToolResult } from '../toolRegistry'

const CLIP = 8000
function clip(text: string): string {
  return text.length <= CLIP ? text : `${text.slice(0, CLIP)}…（已截断）`
}

export type MixinEnv = 'client' | 'main'

/** 有模板/语料证据的 Yarn 1.20.1 高频注入目标（签名以 mcdev 实时查询为准，本表仅速查）。导出供 fabric_javadoc_lookup 复用。 */
export const YARN_TARGETS: Array<{
  clazz: string
  simple: string
  side: MixinEnv
  methods: string[]
  aliases: string[]
  note: string
}> = [
  {
    clazz: 'net.minecraft.client.MinecraftClient',
    simple: 'MinecraftClient',
    side: 'client',
    methods: ['tick()V', 'getCurrentFps()I'],
    aliases: ['客户端', '主循环', '帧率', 'fps', '每帧', '启动'],
    note: '客户端主循环；tick 的 HEAD/TAIL 是最常用挂点（参考包 inject_mixin 模板）。'
  },
  {
    clazz: 'net.minecraft.client.gui.screen.Screen',
    simple: 'Screen',
    side: 'client',
    methods: ['init()V', 'render(DrawContext,int,int,float)V', 'close()V'],
    aliases: ['界面', '屏幕', 'gui', '渲染界面', '初始化界面'],
    note: '屏幕初始化/渲染；改标题界面文字常用 @ModifyArg 打 drawWithShadow/draw（1.20.1 用 DrawContext）。'
  },
  {
    clazz: 'net.minecraft.client.gui.screen.TitleScreen',
    simple: 'TitleScreen',
    side: 'client',
    methods: ['render(DrawContext,int,int,float)V'],
    aliases: ['标题界面', '主菜单', '标题屏', '改标题'],
    note: '参考包 modify_arg_mixin 模板的原例目标。'
  },
  {
    clazz: 'net.minecraft.client.network.ClientPlayerEntity',
    simple: 'ClientPlayerEntity',
    side: 'client',
    methods: ['tick()V', 'sendChatMessage(String,boolean)V'],
    aliases: ['客户端玩家', '聊天消息', '发包'],
    note: '客户端玩家每帧逻辑、发包前改消息。'
  },
  {
    clazz: 'net.minecraft.entity.LivingEntity',
    simple: 'LivingEntity',
    side: 'main',
    methods: ['tick()V', 'damage(DamageSource,float)Z', 'setHealth(float)V', 'travel(Vec3d)V', 'jump()V'],
    aliases: ['生物', '伤害', '受伤', '血量', '生命', '跳跃', '移动', '死亡'],
    note: '通用生物：受伤改伤害值/取消、跳跃、移动；1.20.1 damage 签名为 (DamageSource, float)。'
  },
  {
    clazz: 'net.minecraft.entity.player.PlayerEntity',
    simple: 'PlayerEntity',
    side: 'main',
    methods: ['attack(Entity)V', 'tick()V'],
    aliases: ['玩家', '攻击实体'],
    note: '玩家攻击实体前后、玩家 tick。'
  },
  {
    clazz: 'net.minecraft.entity.Entity',
    simple: 'Entity',
    side: 'main',
    methods: ['tick()V', 'isAlive()Z', 'setVelocity(Vec3d)V'],
    aliases: ['实体基类', '速度', '所有实体'],
    note: '所有实体基类；范围最广，注入前先考虑更具体的子类。'
  },
  {
    clazz: 'net.minecraft.item.Item',
    simple: 'Item',
    side: 'main',
    methods: ['use(World,PlayerEntity,Hand)', 'inventoryTick(ItemStack,World,Entity,int,boolean)V'],
    aliases: ['物品', '右键', '使用物品', '背包'],
    note: '物品右键使用、背包每 tick。'
  },
  {
    clazz: 'net.minecraft.world.World',
    simple: 'World',
    side: 'main',
    methods: ['spawnEntity(Entity)Z', 'playSound(...)', 'getBlockState(BlockPos)'],
    aliases: ['世界', '生成实体', '音效', '方块状态'],
    note: '实体生成、音效、方块读取。'
  },
  {
    clazz: 'net.minecraft.server.MinecraftServer',
    simple: 'MinecraftServer',
    side: 'main',
    methods: ['tick(BooleanSupplier)V', 'saveAll(boolean,boolean,boolean)Z'],
    aliases: ['服务端', '服务器', '存档', '保存'],
    note: '服务端主循环/存档（仅通用或 server 侧 mixin）。'
  },
  {
    clazz: 'net.minecraft.client.font.TextRenderer',
    simple: 'TextRenderer',
    side: 'client',
    methods: ['draw(DrawContext,String,float,float,int)I', 'drawWithShadow(...)'],
    aliases: ['文字', '文本', '字体', '渲染文字'],
    note: '文字渲染参数修改（参考包模板原例；1.20.1 多为 DrawContext 重载，描述符以 mc_get_method 实测为准）。'
  }
]

const POM_FILE = join('src', 'main', 'resources', 'fabric.mod.json')

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

/** 从 gradle.properties 读 maven_group；失败回退 com.<modid>。 */
function resolvePackage(root: string, modId: string): string {
  const p = join(root, 'gradle.properties')
  if (existsSync(p)) {
    const m = /^maven_group\s*=\s*(.+)$/m.exec(readFileSync(p, 'utf-8'))
    if (m && /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(m[1]!.trim())) return m[1]!.trim()
  }
  const suffix = modId.replace(/[^a-z0-9_]/g, '_').toLowerCase()
  return `com.${suffix || 'examplemod'}`
}

function mixinConfigPath(root: string, modId: string): string {
  return join(root, 'src', 'main', 'resources', `${modId}.mixins.json`)
}

function loadFabricMod(root: string): { path: string; json: Record<string, unknown>; modId: string } {
  const path = join(root, POM_FILE)
  if (!existsSync(path)) throw new Error('未找到 src/main/resources/fabric.mod.json')
  const json = readJson(path)
  if (typeof json['id'] !== 'string' || !json['id']) throw new Error('fabric.mod.json 缺少 id')
  return { path, json, modId: json['id'] }
}

/** Mixin 简单类名（剥 package 前缀）。 */
function simpleClassName(fqcn: string): string {
  return fqcn.includes('.') ? fqcn.slice(fqcn.lastIndexOf('.') + 1) : fqcn
}

export function builtinMixinTools(deps: ToolRegistryDeps): RegisteredTool[] {
  const tools: RegisteredTool[] = []

  /* ---------------- mixin_target_lookup ---------------- */
  tools.push({
    kind: 'chat',
    def: {
      type: 'function',
      function: {
        name: 'mixin_target_lookup',
        description:
          '查 Fabric 1.20.1（Yarn 映射）Mixin 注入目标：内置高频类/方法速查（含建议注入点与端侧），' +
          'mcdev-mcp 就绪时追加实时反编译签名（注意其索引可能是 Mojang official 名，写 Yarn 代码时以本工具速查/语料为准），' +
          '并附 Fabric Mixin 语料片段。写 @Inject/@Redirect 前必须先查，禁止凭记忆编造方法名与描述符。',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '类/方法关键词，如 MinecraftClient tick、伤害、TitleScreen' },
            className: { type: 'string', description: '已知完整类名时直接给（如 net.minecraft.entity.LivingEntity）' },
            methodName: { type: 'string', description: '连同 className 给定时查具体方法签名' }
          },
          required: []
        }
      }
    },
    execute: async (args) => {
      const query = asString(args['query']).trim()
      const className = asString(args['className']).trim()
      const methodName = asString(args['methodName']).trim()
      // query 分词（中英文），逐词在类名/方法/别名上做 OR 命中
      const tokens = (className || query)
        .toLowerCase()
        .split(/[\s.#,，、/]+/)
        .map((s) => s.trim())
        .filter((s) => s.length >= 2)
      const methodTok = methodName.toLowerCase()
      const matched = tokens.length
        ? YARN_TARGETS.filter((t) => {
            const hay = [t.clazz, t.simple, ...t.methods, ...t.aliases].join('\n').toLowerCase()
            const classHit = tokens.some((tok) => hay.includes(tok))
            const methodHit = methodTok && t.methods.some((m) => m.toLowerCase().includes(methodTok))
            // 给了 methodName 时要求方法也命中（类命中 AND 方法命中）；否则类命中即可
            return methodTok ? classHit && methodHit : classHit
          })
        : YARN_TARGETS

      const lines: string[] = []
      if (matched.length > 0) {
        lines.push('## Yarn 1.20.1 内置速查命中')
        for (const t of matched) {
          lines.push(
            `### ${t.clazz}（${t.side} 侧）\n方法：\n${t.methods.map((m) => `- ${m}`).join('\n')}\n建议：${t.note}`
          )
        }
      } else if (tokens.length) {
        lines.push(`内置速查未命中「${className || query}」，以下为 mcdev 实时检索与语料结果。`)
      } else {
        lines.push('## Yarn 1.20.1 常用注入目标速查（共 ' + YARN_TARGETS.length + ' 条，给 query/className 可过滤）')
        for (const t of YARN_TARGETS) lines.push(`- [${t.side}] ${t.clazz}：${t.methods.slice(0, 3).join('、')}`)
      }

      // mcdev 实时映射（就绪时）
      const mcp: McpToolPort | undefined = deps.mcp
      if (mcp && mcp.isEnabled() && mcp.getStatus().kind === 'ready') {
        try {
          let res: { ok: boolean; text: string; error?: string }
          if (className && methodName) {
            res = await mcp.callStaticTool('mc_get_method', { className, methodName })
          } else if (className) {
            res = await mcp.callStaticTool('mc_get_class', { className, view: 'methods' })
          } else if (query) {
            res = await mcp.callStaticTool('mc_search', { query, type: 'class', limit: 8 })
          } else {
            res = { ok: true, text: '' }
          }
          if (res.text) {
            lines.push(
              '## mcdev 实时映射（注意核对 Yarn/official 映射差异；可用 mcdev_mc_search 再查）\n' + res.text
            )
          }
          if (!res.ok) lines.push(`mcdev 查询失败：${res.error ?? '未知错误'}`)
        } catch (e) {
          lines.push(`mcdev 查询异常（已忽略）：${(e as Error).message}`)
        }
      } else {
        lines.push('（mcdev-mcp 未就绪：未做实时反编译核对；关键签名请用 fabric_docs_search 检索「Mixin」章节交叉确认）')
      }

      // 语料片段
      const kb = getKnowledgeBase('fabric')
      if (kb.available()) {
        const hits = kb.search('Mixin @Inject @At 注入点 method 描述符 cancellable', 3)
        if (hits.length > 0) {
          lines.push('## 内置 Fabric 语料相关片段')
          for (const h of hits) {
          const excerpt = h.chunk.text.length > 600 ? `${h.chunk.text.slice(0, 600)}…` : h.chunk.text
          lines.push(`### ${h.chunk.title}\n${excerpt}`)
        }
        }
      }

      return { ok: true, text: clip(lines.join('\n\n')), data: { builtinMatches: matched.length } }
    }
  })

  /* ---------------- mixin_scaffold ---------------- */
  type Injection = 'inject' | 'redirect' | 'modify_arg' | 'modify_variable' | 'accessor' | 'invoker'

  const scaffold = (params: {
    pkg: string
    targetClass: string
    mixinName: string
    injection: Injection
    method: string
    at: string
    descriptor: string
    cancellable: boolean
    handler: string
    field: string
    fieldType: string
    mutable: boolean
    invokeTarget: string
  }): { java: string; warnings: string[] } => {
    const { pkg, targetClass, mixinName, injection } = params
    const targetSimple = simpleClassName(targetClass)
    const warnings: string[] = []
    const imports = new Set<string>([
      'org.spongepowered.asm.mixin.Mixin'
    ])
    const isClient = targetClass.includes('.client.')
    const body: string[] = []

    if (injection === 'accessor') {
      imports.add('org.spongepowered.asm.mixin.gen.Accessor')
      if (params.mutable) imports.add('org.spongepowered.asm.mixin.Mutable')
      const cap = params.field.charAt(0).toUpperCase() + params.field.slice(1)
      body.push(
        `    @Accessor("${params.field}")`,
        `    ${params.fieldType} get${cap}();`,
        params.mutable ? `\n    @Mutable\n    @Accessor("${params.field}")\n    void set${cap}(${params.fieldType} value);` : ''
      )
      return {
        java:
          `package ${pkg}.mixin;\n\n` +
          [...imports].sort().map((i) => `import ${i};`).join('\n') +
          `\nimport ${targetClass};\n\n` +
          `@Mixin(${targetSimple}.class)\npublic interface ${mixinName} {\n` +
          body.filter(Boolean).join('\n') +
          '\n}\n',
        warnings
      }
    }

    if (injection === 'invoker') {
      imports.add('org.spongepowered.asm.mixin.gen.Invoker')
      body.push(
        `    @Invoker("${params.method}")`,
        `    // TODO: 按目标私有方法的真实返回类型/参数补全签名`,
        `    Object call${params.method.charAt(0).toUpperCase()}${params.method.slice(1)}();`
      )
      warnings.push('Invoker 签名必须与目标私有方法完全一致（返回类型+参数），请用 mixin_target_lookup 核对后补全。')
      return {
        java:
          `package ${pkg}.mixin;\n\n` +
          [...imports].sort().map((i) => `import ${i};`).join('\n') +
          `\nimport ${targetClass};\n\n` +
          `@Mixin(${targetSimple}.class)\npublic interface ${mixinName} {\n` +
          body.join('\n') +
          '\n}\n',
        warnings
      }
    }

    // 方法型注入
    imports.add('org.spongepowered.asm.mixin.injection.At')
    const methodAttr = params.descriptor
      ? `method = "${params.method}", desc = "${params.descriptor}"`
      : `method = "${params.method}"`
    if (!params.descriptor) warnings.push(`未提供方法描述符 desc：若目标存在重载，编译期可能注入到多个方法，建议 mixin_target_lookup 查准后补 desc。`)

    if (injection === 'inject') {
      imports.add('org.spongepowered.asm.mixin.injection.Inject')
      const returning = params.cancellable
      imports.add(
        returning
          ? 'org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable'
          : 'org.spongepowered.asm.mixin.injection.callback.CallbackInfo'
      )
      const ciType = returning ? `CallbackInfoReturnable<Object>` : 'CallbackInfo'
      body.push(
        `    @Inject(${methodAttr}, at = @At("${params.at}")${params.cancellable ? ', cancellable = true' : ''})`,
        `    private void ${params.handler}(${ciType} cir) {`,
        returning
          ? `        // TODO: 目标方法逻辑；需要改返回值时 cir.setReturnValue(...);（Object 换成真实返回类型）`
          : `        // TODO: 目标方法${params.at === 'HEAD' ? '执行前' : params.at === 'TAIL' || params.at === 'RETURN' ? '返回前/后' : ''}的自定义逻辑${params.cancellable ? '\n        // cir.cancel(); // 需要阻断原方法时取消' : ''}`,
        `    }`
      )
      if (returning) warnings.push('CallbackInfoReturnable 泛型当前为占位 Object，必须替换为目标方法真实返回类型。')
    } else if (injection === 'redirect') {
      imports.add('org.spongepowered.asm.mixin.injection.Redirect')
      if (!params.invokeTarget) warnings.push('@Redirect 必须给 invokeTarget（被重定向调用的 JVM 描述符），当前为占位 TODO，无法直接编译通过。')
      body.push(
        `    @Redirect(`,
        `        ${methodAttr},`,
        `        at = @At(value = "INVOKE", target = ${params.invokeTarget ? `"${params.invokeTarget}"` : '"L<owner>;<method>(<desc>)<ret>" // TODO'})`,
        `    )`,
        `    // TODO: 参数=原调用接收者+原调用参数；返回值=原被调方法返回类型`,
        `    private Object ${params.handler}(Object instance) {`,
        `        // 在此改写/短路被重定向的调用`,
        `        return null; // TODO`,
        `    }`
      )
      warnings.push('@Redirect 与其他注入者互斥风险较高；Fabric 生态更推荐 MixinExtras 的 @WrapOperation（loader 0.15 自带）。')
    } else if (injection === 'modify_arg') {
      imports.add('org.spongepowered.asm.mixin.injection.ModifyArg')
      if (!params.invokeTarget) warnings.push('@ModifyArg 必须给 invokeTarget（被调方法描述符）与参数 index，当前为占位。')
      body.push(
        `    @ModifyArg(`,
        `        ${methodAttr},`,
        `        at = @At(value = "INVOKE", target = ${params.invokeTarget ? `"${params.invokeTarget}"` : '"L<owner>;<method>(<desc>)<ret>" // TODO'}),`,
        `        index = 0 // TODO: 修改第几个参数`,
        `    )`,
        `    // TODO: 参数类型=被修改实参的类型；返回同类型新值`,
        `    private Object ${params.handler}(Object original) {`,
        `        return original;`,
        `    }`
      )
    } else {
      // modify_variable
      imports.add('org.spongepowered.asm.mixin.injection.ModifyVariable')
      body.push(
        `    @ModifyVariable(${methodAttr}, at = @At("${params.at}"), ordinal = 0)`,
        `    // TODO: 类型与变量类型一致；返回修改后的值`,
        `    private Object ${params.handler}(Object value) {`,
        `        return value;`,
        `    }`
      )
      warnings.push('@ModifyVariable 通常需要 ordinal/index/name 精确定位局部变量，占位 ordinal=0 可能注入失败。')
    }

    return {
      java:
        `package ${pkg}.mixin;\n\n` +
        [...imports].sort().map((i) => `import ${i};`).join('\n') +
        `\nimport ${targetClass};\n\n` +
        `/**\n * ${mixinName} — 注入 ${targetSimple}#${params.method}（${injection} @ ${params.at}）。\n` +
        ` * 端侧：${isClient ? 'client（须注册进 mixins.json 的 client 数组）' : '通用（mixins 数组）'}\n` +
        ` * 由 KunYuStudio mixin_scaffold 生成，TODO 项补全后用 gradle_build 真编译验证。\n */\n` +
        `@Mixin(${targetSimple}.class)\npublic class ${mixinName} {\n\n${body.join('\n')}\n}\n`,
      warnings
    }
  }

  tools.push({
    kind: 'chat',
    def: {
      type: 'function',
      function: {
        name: 'mixin_scaffold',
        description:
          '生成 Fabric 1.20.1 Mixin Java 骨架（inject/redirect/modify_arg/modify_variable/accessor/invoker）。' +
          '目标类与方法先用 mixin_target_lookup 查准；默认只返回代码，write=true 时幂等写入项目 ' +
          'src/main/java/<maven_group>/mixin/，随后必须用 mixin_register 注册、gradle_build 验证。' +
          'client 包下的目标会提示注册进 client 数组。',
        parameters: {
          type: 'object',
          properties: {
            targetClass: { type: 'string', description: 'Yarn 完整类名，如 net.minecraft.entity.LivingEntity' },
            mixinClassName: { type: 'string', description: 'Mixin 类简单名，如 LivingHurtMixin（必须以 Mixin 结尾）' },
            injection: { type: 'string', enum: ['inject', 'redirect', 'modify_arg', 'modify_variable', 'accessor', 'invoker'] },
            method: { type: 'string', description: '目标方法名（方法型注入/invoker 必填）' },
            descriptor: { type: 'string', description: '可选 JVM 描述符，存在重载时强烈建议提供' },
            at: { type: 'string', description: '注入点：HEAD/RETURN/TAIL/INVOKE，默认 HEAD' },
            cancellable: { type: 'boolean', description: '@Inject 是否需要 ci.cancel/改返回值（CallbackInfoReturnable）' },
            handlerName: { type: 'string', description: '处理器方法名，默认 on<Method>' },
            field: { type: 'string', description: 'accessor：目标字段名' },
            fieldType: { type: 'string', description: 'accessor：字段 Java 类型，默认 int' },
            mutable: { type: 'boolean', description: 'accessor：是否同时生成 @Mutable setter' },
            invokeTarget: { type: 'string', description: 'redirect/modify_arg：被调用的 JVM 描述符 Lowner;name(desc)ret' },
            write: { type: 'boolean', description: 'true 时直接写入项目（文件已存在则拒绝，除非 overwrite=true）' },
            overwrite: { type: 'boolean', description: '允许覆盖已存在的 Mixin 文件' }
          },
          required: ['targetClass', 'mixinClassName', 'injection']
        }
      }
    },
    visibility: 'project',
    execute: (args) => {
      const root = deps.projectRoot?.()
      if (!root) return { ok: false, text: '', error: '当前没有打开的项目' }
      const targetClass = asString(args['targetClass']).trim()
      const mixinName = asString(args['mixinClassName']).trim()
      const injection = asString(args['injection']) as Injection
      if (!/^[a-z][a-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)+$/.test(targetClass)) {
        return { ok: false, text: '', error: 'targetClass 必须是完整类名（小写包名+大写开头类名）' }
      }
      if (!/^[A-Z][A-Za-z0-9_]*Mixin$/.test(mixinName)) {
        return { ok: false, text: '', error: 'mixinClassName 必须是大驼峰且以 Mixin 结尾（如 LivingHurtMixin）' }
      }
      const method = asString(args['method']).trim()
      const needsMethod = injection !== 'accessor'
      if (needsMethod && !method) {
        return { ok: false, text: '', error: `${injection} 需要 method 参数` }
      }
      if (injection === 'accessor' && !asString(args['field']).trim()) {
        return { ok: false, text: '', error: 'accessor 需要 field 参数' }
      }
      let modId: string
      try {
        modId = loadFabricMod(root).modId
      } catch (e) {
        return { ok: false, text: '', error: (e as Error).message }
      }
      const pkg = resolvePackage(root, modId)
      const at = (asString(args['at']).trim() || 'HEAD').toUpperCase()
      if (!['HEAD', 'RETURN', 'TAIL', 'INVOKE'].includes(at)) {
        return { ok: false, text: '', error: 'at 仅支持 HEAD/RETURN/TAIL/INVOKE' }
      }
      const { java, warnings } = scaffold({
        pkg,
        targetClass,
        mixinName,
        injection,
        method,
        at,
        descriptor: asString(args['descriptor']).trim(),
        cancellable: args['cancellable'] === true,
        handler: asString(args['handlerName']).trim() || `on${method.charAt(0).toUpperCase()}${method.slice(1) || 'Injected'}`,
        field: asString(args['field']).trim(),
        fieldType: asString(args['fieldType']).trim() || 'int',
        mutable: args['mutable'] === true,
        invokeTarget: asString(args['invokeTarget']).trim()
      })

      let writeNote = '未写入（write 缺省 false）。确认 TODO 后再次调用并带 write=true，或手动创建文件。'
      const relPath = join('src', 'main', 'java', ...pkg.split('.'), 'mixin', `${mixinName}.java`)
      if (args['write'] === true) {
        const abs = join(root, relPath)
        if (existsSync(abs) && args['overwrite'] !== true) {
          return { ok: false, text: '', error: `${relPath} 已存在；确需覆盖请带 overwrite=true` }
        }
        mkdirSync(join(abs, '..'), { recursive: true })
        writeFileSync(abs, java, 'utf-8')
        const env: MixinEnv = targetClass.includes('.client.') ? 'client' : 'main'
        writeNote = `已写入 ${relPath}。下一步：mixin_register（environment=${env}）→ gradle_build。`
      }

      const text =
        `骨架已生成（${injection}），端侧=${targetClass.includes('.client.') ? 'client' : 'main'}。\n` +
        (warnings.length ? `待办/警告：\n${warnings.map((w) => `- ${w}`).join('\n')}\n` : '') +
        `\n${writeNote}\n\n` +
        '```java\n' + java + '```'
      const result: ToolResult = {
        ok: warnings.some((w) => w.includes('无法直接编译') || w.includes('必须给')) ? false : true,
        text: clip(text),
        data: { relPath, warnings, needsRegister: args['write'] === true }
      }
      return result
    }
  })

  /* ---------------- mixin_register ---------------- */
  tools.push({
    kind: 'chat',
    def: {
      type: 'function',
      function: {
        name: 'mixin_register',
        description:
          '把 Mixin 类幂等注册进 src/main/resources/<modid>.mixins.json（client 目标进 client 数组，其余进 mixins 数组），' +
          '配置缺失时按 Fabric 1.20.1 标准创建（package=maven_group.mixin、JAVA_17、defaultRequire=1），' +
          '并确保 fabric.mod.json 的 mixins 引用该配置。',
        parameters: {
          type: 'object',
          properties: {
            mixinClassName: { type: 'string', description: 'Mixin 类名（简单名或全限定名，全限定且在 package 下会自动剥离）' },
            environment: { type: 'string', enum: ['client', 'main'], description: 'client=客户端 Mixin；main=通用/服务端' }
          },
          required: ['mixinClassName', 'environment']
        }
      }
    },
    visibility: 'project',
    execute: (args) => {
      const root = deps.projectRoot?.()
      if (!root) return { ok: false, text: '', error: '当前没有打开的项目' }
      const rawName = asString(args['mixinClassName']).trim()
      const environment = (asString(args['environment']).trim() || 'main') as MixinEnv
      if (environment !== 'client' && environment !== 'main') {
        return { ok: false, text: '', error: 'environment 必须是 client 或 main' }
      }
      if (!rawName) return { ok: false, text: '', error: 'mixinClassName 不能为空' }

      let mod: ReturnType<typeof loadFabricMod>
      try {
        mod = loadFabricMod(root)
      } catch (e) {
        return { ok: false, text: '', error: (e as Error).message }
      }
      const pkg = resolvePackage(root, mod.modId)
      const mixinPkg = `${pkg}.mixin`
      let simple = rawName
      if (rawName.startsWith(mixinPkg + '.')) simple = rawName.slice(mixinPkg.length + 1)
      else if (rawName.includes('.')) simple = simpleClassName(rawName)
      if (!/^[A-Z][A-Za-z0-9_]*$/.test(simple)) {
        return { ok: false, text: '', error: `Mixin 类名不合法：${simple}` }
      }

      const cfgPath = mixinConfigPath(root, mod.modId)
      let cfg: Record<string, unknown>
      let created = false
      if (existsSync(cfgPath)) {
        try {
          cfg = readJson(cfgPath)
        } catch {
          return { ok: false, text: '', error: `${mod.modId}.mixins.json 不是合法 JSON` }
        }
      } else {
        cfg = {
          required: true,
          package: mixinPkg,
          compatibilityLevel: 'JAVA_17',
          mixins: [],
          client: [],
          injectors: { defaultRequire: 1 }
        }
        created = true
      }
      if (cfg['package'] !== mixinPkg) {
        return {
          ok: false,
          text: '',
          error: `mixins.json 的 package=${String(cfg['package'])} 与项目 ${mixinPkg} 不一致，拒绝自动写入（请人工确认）`
        }
      }
      const key = environment === 'client' ? 'client' : 'mixins'
      const list = Array.isArray(cfg[key]) ? (cfg[key] as unknown[]) : []
      const already = list.some((v) => v === simple)
      if (!Array.isArray(cfg[key])) cfg[key] = list
      if (!already) list.push(simple)

      // fabric.mod.json 引用幂等合并
      const ref = `${mod.modId}.mixins.json`
      const mixinRefs = Array.isArray(mod.json['mixins']) ? [...(mod.json['mixins'] as unknown[])] : []
      const hasRef = mixinRefs.some((v) => v === ref)
      if (!hasRef) {
        mixinRefs.push(ref)
        mod.json['mixins'] = mixinRefs
      }

      mkdirSync(join(cfgPath, '..'), { recursive: true })
      writeFileSync(cfgPath, `${JSON.stringify(cfg, null, 2)}\n`, 'utf-8')
      writeFileSync(mod.path, `${JSON.stringify(mod.json, null, 2)}\n`, 'utf-8')

      return {
        ok: true,
        text:
          `${created ? '创建' : '更新'} ${mod.modId}.mixins.json：${key} 数组${already ? '已包含' : '加入'} ${simple}（当前 ${list.length} 个）。\n` +
          `fabric.mod.json 的 mixins 引用${hasRef ? '原本已存在' : '已补充'}：${ref}\n` +
          `提醒：client 目标必须放 client 数组；写好 Java 后请执行 gradle_build 验证注入可解析。`,
        data: { config: `${mod.modId}.mixins.json`, array: key, className: simple, created, already, fabricRefAdded: !hasRef }
      }
    }
  })

  /* ---------------- mixin_validate ---------------- */
  tools.push({
    kind: 'chat',
    def: {
      type: 'function',
      function: {
        name: 'mixin_validate',
        description:
          '交叉校验项目 Mixin 装配：mixins.json（package/JAVA_17/数组/重复项）、fabric.mod.json 引用、' +
          '已注册类的 Java 文件（@Mixin/注解/方法型注入完整性/client 类是否误放通用数组）、' +
          '以及 java 文件存在但未注册的遗漏。给 mixinClassName 时只查该类。',
        parameters: {
          type: 'object',
          properties: {
            mixinClassName: { type: 'string', description: '可选：只校验某个 Mixin（简单名）' }
          },
          required: []
        }
      }
    },
    visibility: 'project',
    execute: (args) => {
      const root = deps.projectRoot?.()
      if (!root) return { ok: false, text: '', error: '当前没有打开的项目' }
      let mod: ReturnType<typeof loadFabricMod>
      try {
        mod = loadFabricMod(root)
      } catch (e) {
        return { ok: false, text: '', error: (e as Error).message }
      }
      const pkg = resolvePackage(root, mod.modId)
      const mixinPkg = `${pkg}.mixin`
      const only = asString(args['mixinClassName']).trim()
      const errors: string[] = []
      const warnings: string[] = []

      // 1) fabric.mod.json 引用
      const refs = Array.isArray(mod.json['mixins']) ? mod.json['mixins'] : []
      const ref = `${mod.modId}.mixins.json`
      if (!refs.includes(ref)) errors.push(`fabric.mod.json 的 mixins 未引用 ${ref}`)

      // 2) mixins.json
      const cfgPath = mixinConfigPath(root, mod.modId)
      if (!existsSync(cfgPath)) {
        errors.push(`缺少 ${mod.modId}.mixins.json（用 mixin_register 可自动创建）`)
      }
      let cfg: Record<string, unknown> = {}
      if (existsSync(cfgPath)) {
        try {
          cfg = readJson(cfgPath)
        } catch {
          errors.push(`${mod.modId}.mixins.json 不是合法 JSON`)
        }
        if (cfg['package'] !== mixinPkg) errors.push(`package 应为 ${mixinPkg}，实际 ${String(cfg['package'])}`)
        if (cfg['compatibilityLevel'] !== 'JAVA_17') errors.push('compatibilityLevel 应为 JAVA_17（1.20.1）')
        const injectors = cfg['injectors'] as Record<string, unknown> | undefined
        if (!injectors || injectors['defaultRequire'] !== 1) {
          warnings.push('未显式设置 injectors.defaultRequire=1（注入失败可能被静默吞掉）')
        }
      }

      const javaBase = join(root, 'src', 'main', 'java', ...pkg.split('.'), 'mixin')
      const declared: Array<{ name: string; side: MixinEnv }> = []
      for (const side of ['main', 'client'] as const) {
        const key = side === 'main' ? 'mixins' : 'client'
        const arr = Array.isArray(cfg[key]) ? (cfg[key] as unknown[]) : []
        const seen = new Set<string>()
        for (const item of arr) {
          if (typeof item !== 'string') {
            errors.push(`${key} 数组存在非字符串条目：${JSON.stringify(item)}`)
            continue
          }
          if (seen.has(item)) errors.push(`${key} 数组重复注册：${item}`)
          seen.add(item)
          declared.push({ name: item, side })
        }
      }

      // 3) 已注册 → java 文件存在且结构正确
      for (const { name, side } of declared) {
        if (only && name !== only && simpleClassName(name) !== only) continue
        // 支持 client 子包形式 "client.XxxMixin"
        const relJava = name.includes('.') ? `${name.replace(/\./g, '/')}.java` : `${name}.java`
        const path = join(javaBase, relJava)
        if (!existsSync(path)) {
          errors.push(`已注册的 Mixin 类文件不存在：${join(pkg.replace(/\./g, '/'), 'mixin', relJava)}`)
          continue
        }
        const src = readFileSync(path, 'utf-8')
        if (!/import\s+org\.spongepowered\.asm\.mixin\.Mixin\s*;/.test(src) || !/@Mixin\s*\(/.test(src)) {
          errors.push(`${name}：缺少 @Mixin 注解或其 import`)
        }
        // 方法型注入（class）而非 interface accessor
        const isInterface = /public\s+interface\s+/.test(src)
        if (!isInterface) {
          const injectMatches = [...src.matchAll(/@Inject\s*\(([^)]*)\)/gs)]
          for (const m of injectMatches) {
            const ann = m[1] ?? ''
            if (!/method\s*=/.test(ann)) errors.push(`${name}：@Inject 缺少 method 属性`)
            if (!/@At\s*\(/.test(ann)) errors.push(`${name}：@Inject 缺少 at = @At(...)`)
            if (/ci\.cancel\(\)|cir\.setReturnValue/.test(src) && !/cancellable\s*=\s*true/.test(ann)) {
              warnings.push(`${name}：使用了 cancel/setReturnValue 但 @Inject 未声明 cancellable=true`)
            }
          }
        }
        // client 引用检查
        if (side === 'main' && /import\s+net\.minecraft\.client\./.test(src)) {
          errors.push(`${name}：引用了 net.minecraft.client.* 却注册在通用 mixins 数组，必须移到 client 数组`)
        }
        if (side === 'client' && !name.startsWith('client.') && !/import\s+net\.minecraft\.client\./.test(src) && /@Mixin\(/.test(src)) {
          warnings.push(`${name}：注册在 client 数组但未 import client 包；若目标其实是通用类请移到 mixins 数组`)
        }
      }

      // 4) 磁盘上有 java 但未注册
      const declaredNames = new Set(declared.map((d) => d.name))
      const onDisk: string[] = []
      const walk = (dir: string, prefix: string): void => {
        if (!existsSync(dir)) return
        for (const ent of readdirSync(dir, { withFileTypes: true })) {
          if (ent.isDirectory()) walk(join(dir, ent.name), `${prefix}${ent.name}.`)
          else if (ent.name.endsWith('Mixin.java')) onDisk.push(prefix + ent.name.replace(/\.java$/, ''))
        }
      }
      walk(javaBase, '')
      for (const n of onDisk) {
        if (only && n !== only && simpleClassName(n) !== only) continue
        if (!declaredNames.has(n) && !declaredNames.has(simpleClassName(n))) {
          errors.push(`磁盘存在但未在 mixins.json 注册：${n}`)
        }
      }

      const scope = only ? `（仅 ${only}）` : ''
      const text =
        errors.length === 0
          ? `Mixin 装配校验通过 ✓ ${scope}（${declared.length} 个已注册类，${warnings.length} 条警告）` +
            (warnings.length ? `\n${warnings.map((w) => `⚠️ ${w}`).join('\n')}` : '')
          : `发现 ${errors.length} 个问题${scope}：\n${errors.map((e) => `- ✗ ${e}`).join('\n')}` +
            (warnings.length ? `\n警告：\n${warnings.map((w) => `- ⚠️ ${w}`).join('\n')}` : '')
      return {
        ok: errors.length === 0,
        text: clip(text),
        data: { valid: errors.length === 0, errors, warnings, declaredCount: declared.length }
      }
    }
  })

  return tools
}
