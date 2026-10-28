/**
 * 构建失败九层分类。
 *
 * 失败分层修复：构建失败不是一锅粥——按流水线顺序归为九层，
 * 每层有独立的修复策略与提示语。判定原则：
 * - 层级按真实构建流水线排序（toolchain→…→gameplay），早层失败会向下游级联，
 *   因此分类取「最早出现证据的层」——那通常才是根因；
 * - 证据来源双通道：Gradle 日志正则信号 + 参考包错误模式的 category 映射；
 * - 纯函数不写盘，直接 vitest；分类结果随 BuildConclusion 落库并注入治愈循环提示。
 */
import type { MatchedErrorPattern } from '../../../../shared/types/aiReference'
import type { BuildFailureLayer } from '../../../../shared/types/agent'

export type { BuildFailureLayer }

export interface BuildFailureClassification {
  layer: BuildFailureLayer
  /** 中文层级名（面板/摘要直显） */
  label: string
  /** 判定证据：首个命中日志行（截断）或命中模式 id */
  evidence: string
  /** 注入治愈循环的分层修复策略 */
  fixHint: string
}

interface LayerRule {
  layer: BuildFailureLayer
  label: string
  signals: RegExp[]
  /** 参考包 ErrorPattern.category → 本层 */
  categories: string[]
  fixHint: string
}

/**
 * 层级规则表（数组序 = 流水线序，扫描时首个有证据的层胜出）。
 * 正则统一 /i；命中行截取≤160 字符作为证据。
 */
const LAYER_RULES: LayerRule[] = [
  {
    layer: 'toolchain',
    label: '工具链层',
    signals: [
      /Unsupported class file major version/i,
      /JAVA_HOME/i,
      /invalid source release/i,
      /error: release version \d+ not supported/i,
      /Gradle (requires|daemon).*JVM/i,
      /Could not determine java version/i,
      /Plugin \[id: 'fabric-loom'/i,
      /Could not find (plugin|fabric-loom)/i,
      /Could not expand value|MissingPropertyException/i
    ],
    categories: ['build_config'],
    fixHint:
      '失败在工具链层：先修环境/构建配置，不要改业务代码。核对 JAVA_HOME 指向的 JDK 版本是否匹配该 MC 组合' +
      '（1.20.1=JDK 17，1.21+=JDK 21）、Gradle wrapper 版本能否驱动该 loom/arch-loom、build.gradle 的插件与' +
      'toolchain 声明是否自洽；修好后原样重跑构建。'
  },
  {
    layer: 'dependency',
    label: '依赖层',
    signals: [
      /Could not resolve(?!.*task)/i,
      /Could not find .+\.(jar|pom|module)/i,
      /Could not (GET|HEAD|download).*(401|403|404|timed out)/i,
      /Failed to (download|fetch).*(maven|artifact|dependenc)/i,
      /dependency verification failed/i,
      /Searched in the following locations/i,
      /Could not resolve net\.(fabricmc|neoforged)|Could not resolve (com|net|org|io)\./i
    ],
    categories: [],
    fixHint:
      '失败在依赖层：坐标/仓库/网络问题，不要改业务代码。核对 repositories 声明是否覆盖该依赖所在仓库、' +
      '依赖坐标与版本在官方 maven 上真实存在（yarn/loader/loom 版本逐字核对）、离线或代理导致的 401/403/超时' +
      '需要先恢复网络或换镜像；版本写错就只改版本号。'
  },
  {
    layer: 'compile',
    label: '编译层',
    signals: [
      /Compilation failed|Compilation error/i,
      />\s*Task :compile\w* FAILED/i,
      /error: cannot find symbol/i,
      /error: incompatible types/i,
      /error: (method|class|interface|constructor).*(not found|does not exist)/i,
      /does not override|method does not override/i,
      /must either be declared abstract/i,
      /error: package .+ does not exist/i
    ],
    categories: ['api_fabrication', 'version_confusion', 'import_package', 'entity_error'],
    fixHint:
      '失败在编译层：按 error: 指向的文件与行号做最小修复。cannot find symbol 多为映射名/包名写错——对照' +
      '目标加载器+版本的 API 索引逐字核对类名、方法名、签名；abstract/override 错误对照基类真实方法表；' +
      '用 edit_project_file 只改报错位置，不要重吐整份文件。'
  },
  {
    layer: 'resources',
    label: '资源层',
    signals: [
      />\s*Task :processResources FAILED/i,
      /Failed to process resources/i,
      /JsonSyntaxException|JsonParseException|MalformedJson/i,
      /FileNotFoundIdentifierException|Unable to load model/i,
      /Invalid (model|blockstate|lang).*(json|file)/i,
      /Failed to (load|parse).*(assets|model|texture|lang)/i
    ],
    categories: ['json_error'],
    fixHint:
      '失败在资源层：修 assets/data 下的 JSON 与引用。用 JSON 校验逐文件过一遍（尾随逗号/注释/单引号最常见）、' +
      '命名空间与路径要和代码里的 Identifier 一致、模型引用的贴图路径必须真实存在、processResources 的' +
      '${version} 等占位符在 gradle.properties 里有定义。'
  },
  {
    layer: 'packaging',
    label: '打包层',
    signals: [
      />\s*Task :(remapJar|jar|shadowJar|remapSourcesJar|remap) FAILED/i,
      /Failed to remap|remapping failed/i,
      /tiny-?remapper/i,
      /zip.*(duplicate|corrupt|error)/i,
      /Failed to (obfuscate|sign|shadow)/i
    ],
    categories: [],
    fixHint:
      '失败在打包层：编译已过，卡在 remap/打包。核对 loom/arch-loom 的 mappings 配置与 jar 任务定制（archive 命名、' +
      'manifest、嵌套 jar）、不要把 resources 输出目录重复打进 jar；mapping 下载失败退回依赖层思路检查网络。'
  },
  {
    layer: 'bootstrap',
    label: '引导层',
    signals: [
      /Could not find or load main class/i,
      /Error occurred during initialization/i,
      /no main manifest attribute/i,
      /Invalid (mod json|fabric\.mod\.json|mods\.toml)/i,
      /Could not find entrypoint|entrypoint .* does not implement/i,
      /Failed to start the (minecraft|game|server)/i,
      /Exception in thread "main"/i
    ],
    categories: [],
    fixHint:
      '失败在引导层：游戏 JVM 早期启动即崩，mod 代码尚未执行。核对 fabric.mod.json/mods.toml/neoforge.mods.toml 的' +
      'entrypoint 类全限定名与 implements 声明、access widener/transformer 路径、依赖 mod 的 depends 声明；' +
      'entrypoint 类必须能被无参实例化。'
  },
  {
    layer: 'mixin',
    label: 'Mixin 层',
    signals: [
      /Mixin apply (failed|error)/i,
      /InjectionError/i,
      /InvalidMixinException/i,
      /Critical injection failure/i,
      /Mixin transformation of .+ failed/i,
      /Unable to locate (method|field).*(mixin|target)/i
    ],
    categories: ['mixin_error'],
    fixHint:
      '失败在 Mixin 层：目标方法签名/描述符与当前映射不匹配。对照目标版本+yarn/mojmap 的真实方法名与 JVM 描述符' +
      '逐字核对 @Inject/@Redirect/@At 的 method 与 target；LVT 序号/capture 失败优先改用更稳的注入点；' +
      '确认 mixins.json 的 package 与类路径一致。'
  },
  {
    layer: 'registry',
    label: '注册层',
    signals: [
      /already registered|duplicate registration/i,
      /No such entry in registry|Registry .*(not found|missing)/i,
      /Failed to register/i,
      /Identifier .*(invalid|already)/i,
      /RegistryObject.*not present/i
    ],
    categories: [],
    fixHint:
      '失败在注册链：重复注册就删掉多余注册调用（同一 Identifier 只能注册一次）、找不到条目先确认注册顺序' +
      '（先注册后引用，别在静态初始化顺序上踩坑）、Identifier 命名空间/路径拼写与注册表类型逐字核对。'
  },
  {
    layer: 'gameplay',
    label: '玩法层',
    signals: [
      /Exception ticking (world|entity|block)/i,
      /NullPointerException.*(tick|render|interact)/i,
      /Error executing task on (Server|Client)/i,
      /game crashed.*crash report/i,
      /Exception in server tick loop/i
    ],
    categories: [],
    fixHint:
      '失败在玩法层：编译注册都过了，游戏内运行期才炸。按崩溃报告堆栈顶端的自有类做定向修复——tick/render 路径' +
      '判空（NPE 最常见）、状态机边界、客户端服务端逻辑分流（别在服务端调渲染类）；修完必须重跑真机验证。'
  }
]

/** 从日志中找首个命中行（截断 160 字符） */
function firstHitLine(log: string, re: RegExp): string | null {
  for (const line of log.split(/\r?\n/)) {
    if (re.test(line)) return line.trim().slice(0, 160)
  }
  return null
}

/**
 * 分类构建失败：按流水线序扫描九层，返回最早有证据的层。
 * 证据优先级：日志信号行 > 参考包模式 category 映射。
 * 全部无证据返回 null（治愈循环按原有「未命中已知模式」路径处理）。
 */
export function classifyBuildFailure(
  log: string,
  matched: MatchedErrorPattern[]
): BuildFailureClassification | null {
  if (!log && matched.length === 0) return null
  for (const rule of LAYER_RULES) {
    for (const re of rule.signals) {
      const hit = log ? firstHitLine(log, re) : null
      if (hit !== null) {
        return { layer: rule.layer, label: rule.label, evidence: hit, fixHint: rule.fixHint }
      }
    }
    if (rule.categories.length > 0) {
      const hitPattern = matched.find((m) => rule.categories.includes(m.pattern.category))
      if (hitPattern) {
        return {
          layer: rule.layer,
          label: rule.label,
          evidence: `命中错误模式 ${hitPattern.pattern.id}（${hitPattern.pattern.category}）`,
          fixHint: rule.fixHint
        }
      }
    }
  }
  return null
}

/**
 * 同一失败重现判定（假设-证伪纪律）。
 *
 * 判定原则：败在同一层即视为「上一根因假设已被证伪」——证据逐字可能因轮次
 * 略有差异（行号/路径漂移），但层级相同足以说明修复方向未触及根因。
 * 任一侧无分类（null）时无法判定证伪，返回 false（保持原有修复路径）。
 */
export function isSameFailure(
  prev: BuildFailureClassification | null,
  next: BuildFailureClassification | null
): boolean {
  if (prev === null || next === null) return false
  return prev.layer === next.layer
}
