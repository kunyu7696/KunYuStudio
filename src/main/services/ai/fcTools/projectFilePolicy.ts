/**
 * 项目源码文件安全策略（read_project_file / write_project_file 共用）。
 * 从 toolRegistry.ts 拆出的共享叶件。
 */

/**
 * 允许提交的源码/资源扩展名白名单。
 * 不含二进制（png/jar/class/zip）与脚本（sh/ps1/cmd）——二进制走贴图/模型专用工具，
 * 任意脚本落盘属于代码执行风险面。
 */
export const PROJECT_SOURCE_FILE_EXT_ALLOWED = [
  'java',
  'json',
  'mcmeta',
  'properties',
  'toml',
  'lang',
  'glsl',
  'vsh',
  'fsh',
  'gsh'
]

export const PROJECT_SOURCE_FILE_EXT_RE = new RegExp(
  `\\.(${PROJECT_SOURCE_FILE_EXT_ALLOWED.join('|')})$`,
  'i'
)

/**
 * Gradle 构建脚本/构建配置黑名单。
 * 背景：AI 最终 JSON 的 files[] 通道原本只校验相对路径/项目根约束，没有扩展名白名单，
 * 而 build.gradle 命中即会在同一轮 agent 的自动 `clean build` 里被执行——
 * 提示注入可直接升级为本机命令执行。这些文件只允许项目模板生成 + 人工编辑。
 */
export const GRADLE_BUILD_FILE_RE =
  /(^|\/)(build\.gradle(\.kts)?|settings\.gradle(\.kts)?|gradle\.properties|gradle-wrapper\.properties|gradlew(\.bat)?)$/i

const GRADLE_INTERNAL_DIR_RE = /(^|\/)\.gradle\//i

/**
 * 项目文件写盘统一闸门：扩展名白名单 + Gradle 构建文件黑名单。
 * write_project_file 工具与最终 JSON files[]（validateFileChanges）必须共用此函数，
 * 保证两条写盘通道护栏一致。
 */
export function checkProjectSourceWritable(relPath: string): { ok: boolean; reason?: string } {
  if (GRADLE_BUILD_FILE_RE.test(relPath) || GRADLE_INTERNAL_DIR_RE.test(relPath)) {
    return {
      ok: false,
      reason: '构建脚本/构建配置仅允许项目模板生成，AI 通道禁写，如需修改请手动编辑'
    }
  }
  if (!PROJECT_SOURCE_FILE_EXT_RE.test(relPath)) {
    return {
      ok: false,
      reason: `扩展名不在允许列表（${PROJECT_SOURCE_FILE_EXT_ALLOWED.join('/')}）`
    }
  }
  return { ok: true }
}

/**
 * 花括号配平快检（.java/.gradle/.kts 共用）：
 * 先剥离行注释/块注释/字符串字面量再计数，避免「字符串或注释里的大括号」误报。
 * 背景：生成内容曾因缺一个闭合括号导致整轮 Gradle 解析失败
 * （Unexpected input: '{'），且治愈循环零产出提前停止，坏文件留在盘上。
 * 局限：三引号文本块（Java text block / Groovy """）按普通引号处理，含大括号的
 * 文本块可能误报——生成代码中极少使用，可接受。
 * 返回 null 表示配平；否则返回可回传给模型的警告文案。
 */
export function lintBraceBalance(content: string): string | null {
  let depth = 0
  let i = 0
  const n = content.length
  let inLineComment = false
  let inBlockComment = false
  let quote: string | null = null
  while (i < n) {
    const ch = content[i]
    const next = i + 1 < n ? content[i + 1] : ''
    if (inLineComment) {
      if (ch === '\n' || ch === '\r') inLineComment = false
      i++
      continue
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false
        i += 2
        continue
      }
      i++
      continue
    }
    if (quote) {
      if (ch === '\\') {
        i += 2
        continue
      }
      if (ch === quote) quote = null
      i++
      continue
    }
    if (ch === '/' && next === '/') {
      inLineComment = true
      i += 2
      continue
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true
      i += 2
      continue
    }
    if (ch === '"' || ch === '\'') {
      quote = ch
      i++
      continue
    }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth < 0) return '花括号不平衡（出现多余的 }），文件疑似损坏'
    }
    i++
  }
  if (depth !== 0) return `花括号不平衡（缺 ${depth} 个 }），文件疑似不完整`
  return null
}

// ---------------------------------------------------------------------------
// 生成代码资源所有权 + optional 缺载保护
//
// 两条纪律通用化到 Java mod 生成场景：
// - 资源所有权：每个引入的资源都要有 owner 与清理路径——无界静态缓存、
//   未关闭的 Executor/线程是 AI 生成代码最高频的两类泄漏；
// - optional 缺载保护：optional 依赖的类不能出现在类加载期即解析的位置
//   （static 字段类型、Mixin 目标），目标 mod 缺失时不得崩 base 初始化。
//
// 全部为 warn 级启发式（返回中文警告数组，不 block 落盘）：静态正则判定有误差，
// 误报代价比漏报小——警告随工具返回回填给模型，由其结合上下文自决。
// ---------------------------------------------------------------------------

/** 第三方包白名单之外前缀（这些视为 JDK/加载器/原版自有，不算 optional 依赖） */
const FIRST_PARTY_PACKAGE_RE =
  /^(java\.|javax\.|net\.minecraft\.|net\.fabricmc\.|net\.fabric\.|net\.minecraftforge\.|net\.neoforged\.|cpw\.mods\.|com\.mojang\.|com\.google\.|org\.slf4j\.|org\.apache\.logging\.|org\.jetbrains\.|org\.spongepowered\.)/

/** 从源码提取第三方 import 的简单类名（用于 optional 缺载启发式） */
function thirdPartyImports(content: string): Array<{ fqn: string; simple: string }> {
  const out: Array<{ fqn: string; simple: string }> = []
  const re = /^\s*import\s+(?:static\s+)?([\w.]+)\s*;/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(content)) !== null) {
    const fqn = m[1]
    if (FIRST_PARTY_PACKAGE_RE.test(fqn)) continue
    const simple = fqn.split('.').pop() ?? fqn
    // 通配 import 无法定位简单名，跳过（误报控制）
    if (simple === '*') continue
    out.push({ fqn, simple })
  }
  return out
}

/**
 * Java 资源所有权/缺载保护启发式检查：返回警告数组（空 = 未发现风险点）。
 */
export function lintJavaOwnership(content: string): string[] {
  const warnings: string[] = []

  // 1) 无界静态缓存：static 容器字段且全文无 clear(/remove(/invalidate( 清理路径
  if (
    /\bstatic\s+(?:final\s+)?(?:Map|HashMap|ConcurrentHashMap|List|ArrayList|Set|HashSet|Collection)\b/.test(
      content
    ) &&
    !/\.(clear|remove|invalidate|invalidateAll)\s*\(/.test(content)
  ) {
    warnings.push(
      '资源所有权：检测到 static 容器字段但全文无 clear/remove 清理路径——若该缓存随会话/世界/玩家增长，' +
        '请确认其有界（上限淘汰）或在对应生命周期事件中清理，避免常驻内存只增不减。'
    )
  }

  // 2) 线程/连接池未关：Executors/new Thread 但无 shutdown/interrupt 收口
  if (
    /Executors\.|new\s+Thread\s*\(/.test(content) &&
    !/\.(shutdown|shutdownNow|interrupt)\s*\(/.test(content)
  ) {
    warnings.push(
      '资源所有权：检测到 Executors/Thread 创建但无 shutdown/interrupt 收口——后台线程必须有 owner，' +
        '并在 mod 停用/世界卸载路径关闭，否则游戏退出后线程仍悬挂。'
    )
  }

  const thirdParty = thirdPartyImports(content)
  if (thirdParty.length > 0) {
    // 3) Mixin 目标为第三方类：注入目标缺失时整个 mixin config 可能崩
    if (/@Mixin\s*\(/.test(content)) {
      warnings.push(
        `optional 缺载保护：@Mixin 类引用了第三方类（${thirdParty
          .slice(0, 3)
          .map((t) => t.simple)
          .join('、')}）——若目标是 optional 依赖，请为其使用独立 mixin config + plugin 条件加载，或确认该依赖为必需；` +
          '否则目标 mod 缺失时注入阶段即崩溃。'
      )
    }
    // 4) static 字段类型为第三方类：类加载期即解析，目标缺失崩 base 初始化
    for (const t of thirdParty) {
      const staticFieldRe = new RegExp(`\\bstatic\\s+(?:final\\s+)?${t.simple}\\b`)
      if (staticFieldRe.test(content)) {
        warnings.push(
          `optional 缺载保护：static 字段类型为第三方类 ${t.simple}（${t.fqn}）——static 字段在本类加载时即触发目标类解析，` +
            '若该依赖为 optional，请把引用移到 presence check 之后的适配层，避免目标缺失时崩 base 初始化。'
        )
        break // 同类风险报一次即可
      }
    }
  }

  return warnings
}
