#!/usr/bin/env node
/**
 * 附魔 Java 真机编译验证脚本（入口 runner）。
 *
 * 用途：对 enchantmentCodegen 生成的 ModEnchantments.java 跑真实 Fabric Loom 1.20.1
 * 编译，确认 Yarn 1.20.1 方法名（isTreasure/isCursed/getAttackDamage/
 * getMinPower/getMaxPower/getMaxLevel）与 EnchantmentTarget 映射等与运行时一致。
 *
 * 运行：
 *   node scripts/verify-enchant-build.mjs            # 默认跑 fabric 1.20.1 全量验证
 *   node scripts/verify-enchant-build.mjs --status   # 仅打印工具链状态，不跑编译
 *   node scripts/verify-enchant-build.mjs --clean    # 跑完后删除 .kunyu/verify-enchant 缓存
 *
 * 硬约束（沿用 project_memory）：
 * - JAVA_HOME 指向 C:\Program Files\Java\jdk-17（排除 PATH 中的 Java 25）；
 * - Gradle 走腾讯云 + 阿里云镜像（已在 spec 的 build.gradle 内配置）；
 * - 首次运行会下载 Minecraft 1.20.1 + Yarn mappings（数百 MB），需联网，耗时数分钟。
 *
 * 本脚本本身不直接 import TS 源码，而是通过 vitest 运行 enchantmentBuild.spec.ts
 * （该 spec 用 describeIf(VERIFY_ENCH_BUILD=1) 守护，默认 skip，不污染 1112 测试基线）。
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

const JDK_17_HOME = process.env.JAVA_HOME ?? 'C:\\Program Files\\Java\\jdk-17'
const SPEC = 'src/main/services/__tests__/enchantmentBuild.spec.ts'
const VITEST_BIN = join(ROOT, 'node_modules', 'vitest', 'vitest.mjs')

const args = process.argv.slice(2)
const statusOnly = args.includes('--status')
const cleanAfter = args.includes('--clean')

function log(msg) {
  console.log(`[verify-enchant] ${msg}`)
}

/** 工具链预检 */
function preflight() {
  const javaExe = join(JDK_17_HOME, 'bin', 'java.exe')
  const jdkOk = existsSync(javaExe)
  const vitestOk = existsSync(VITEST_BIN)
  const verifyDir = join(ROOT, '.kunyu', 'verify-enchant')
  const cacheExists = existsSync(join(verifyDir, 'build.gradle'))

  log(`JDK 17     : ${jdkOk ? 'OK ' : '缺失'}  ${JDK_17_HOME}`)
  log(`vitest     : ${vitestOk ? 'OK ' : '缺失'}  ${VITEST_BIN}`)
  log(`gradle     : 检测系统 gradle（spec 内会自动尝试 gradlew.bat 回退）`)
  log(`编译缓存   : ${cacheExists ? '已存在（复用 MC 下载）' : '未建（首次将下载 MC）'}`)

  if (!jdkOk) {
    log(`✗ JDK 17 未找到：${javaExe}`)
    log('  请安装 JDK 17 到 C:\\Program Files\\Java\\jdk-17，或设置 JAVA_HOME 指向已安装路径。')
    return false
  }
  if (!vitestOk) {
    log(`✗ vitest 未找到：${VITEST_BIN}`)
    log('  请先执行 npm install 安装项目依赖。')
    return false
  }
  return true
}

function runGradleCheck() {
  // 不阻塞：仅提示
  const r = spawnSync('gradle', ['-v'], { shell: true, encoding: 'utf-8', timeout: 20000 })
  if (r.status === 0) {
    const verLine = (r.stdout ?? '').split(/\r?\n/).find((l) => /^Gradle\s+\d/.test(l))
    log(`系统 gradle : OK  ${verLine ?? ''}`)
    return true
  }
  const wrapperBat = join(ROOT, '.kunyu', 'verify-enchant', 'gradlew.bat')
  if (existsSync(wrapperBat)) {
    log(`工程 gradlew.bat : OK  ${wrapperBat}`)
    return true
  }
  log('系统 gradle : ✗ 未找到')
  log('  请安装 Gradle 8.x（Loom 1.6 要求），或先在 .kunyu/verify-enchant 下执行 `gradle wrapper` 生成 wrapper。')
  return false
}

if (statusOnly) {
  log('=== 工具链状态（--status，不跑编译）===')
  preflight()
  runGradleCheck()
  log('=== 状态检查完成 ===')
  process.exit(0)
}

log('=== 附魔 Java 真机编译验证 ===')
if (!preflight()) process.exit(2)
runGradleCheck()

log(`运行 spec : ${SPEC}`)
const env = {
  ...process.env,
  VERIFY_ENCH_BUILD: '1',
  JAVA_HOME: JDK_17_HOME,
  PATH: `${join(JDK_17_HOME, 'bin')};${process.env.PATH ?? ''}`,
  // 强制英语区域，确保 javac 错误消息可被 spec 稳定解析
  LANG: 'en_US.UTF-8',
  LC_ALL: 'en_US.UTF-8'
}
if (cleanAfter) env.VERIFY_ENCH_CLEAN = '1'

// 不用 shell:true，避免 Windows CLIXML 噪声；vitest 自身控制台输出稳定
const r = spawnSync('node', [VITEST_BIN, 'run', SPEC], {
  cwd: ROOT,
  env,
  stdio: 'inherit'
})

const code = r.status ?? 1
if (code === 0) {
  log('✓ 附魔 Java 真机编译验证通过')
} else {
  log(`✗ 验证失败（退出码 ${code}）`)
  if (cleanAfter) log('  缓存已按要求清理')
}
process.exit(code)
