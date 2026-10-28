/**
 * 附魔 Java 真机编译验证（Fabric 1.20.1 Yarn 路线）。
 *
 * 本 spec 不在常规测试基线内：必须显式设置环境变量 VERIFY_ENCH_BUILD=1 才会执行，
 * 通过 `node scripts/verify-enchant-build.mjs` 触发。这样既能让 CI/手动按需跑真机
 * 编译，又不污染默认 `vitest run` 的 1112 测试基线。
 *
 * 验证链路：
 * 1. 用 enchantmentCodegen.generateModEnchantmentsJava 产出 ModEnchantments.java；
 * 2. 在 .kunyu/verify-enchant/ 下搭一个完整 Fabric Loom 1.20.1 工程（build.gradle /
 *    settings.gradle / gradle.properties / 主类 / fabric.mod.json），并复用缓存避免每次
 *    重新下载 Minecraft + Yarn mappings；
 * 3. 调用系统 `gradle --no-daemon compileJava` 用 JDK 17 真机编译；
 * 4. 断言 exit code 为 0，失败时把 javac 的 `错误:` / `error:` 行透出便于定位。
 *
 * 环境硬约束（沿用 project_memory）：
 * - Windows 排除默认 PATH 中的 Java 25，强制 JAVA_HOME=C:\Program Files\Java\jdk-17；
 * - Gradle 走腾讯云 + 阿里云镜像；javac 输出英语区域设置以便错误解析一致。
 */
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { generateModEnchantmentsJava } from '../enchantmentCodegen'
import type { ModContext } from '../contentGenerator'
import { createDefaultEnchantment, type EnchantmentSchema } from '../../../shared/schemas/enchantment.schema'

const ENABLED = process.env.VERIFY_ENCH_BUILD === '1'
// 默认 skip：避免常规 vitest run 误触真机编译（会下载数百 MB MC 依赖）
const describeMaybe = ENABLED ? describe : describe.skip

/** JDK 17 路径（项目硬约束：排除 Java 25） */
const JDK_17_HOME = process.env.JAVA_HOME ?? 'C:\\Program Files\\Java\\jdk-17'

/** 验证工程根目录（固定路径以复用 MC 下载缓存） */
const PROJECT_ROOT = process.cwd()
const VERIFY_DIR = join(PROJECT_ROOT, '.kunyu', 'verify-enchant')

/** Fabric Loom 1.20.1 build.gradle（腾讯云 + 阿里云镜像） */
const BUILD_GRADLE = `plugins {
    id 'fabric-loom' version '1.6.11'
    id 'java'
}

group = 'com.kunyu.verify'
version = '0.0.1'

repositories {
    maven { url 'https://mirrors.cloud.tencent.com/nexus/repository/maven-public/' }
    maven { url 'https://maven.aliyun.com/repository/public' }
    maven { url 'https://maven.aliyun.com/repository/gradle-plugin' }
    maven { url 'https://maven.fabricmc.net/' }
    mavenCentral()
}

dependencies {
    minecraft "com.mojang:minecraft:\${project.minecraft_version}"
    mappings "net.fabricmc:yarn:\${project.yarn_mappings}:v2"
    modImplementation "net.fabricmc:fabric-loader:\${project.loader_version}"
    modImplementation "net.fabricmc.fabric-api:fabric-api:\${project.fabric_version}"
}

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

tasks.withType(JavaCompile).configureEach {
    options.encoding = 'UTF-8'
    // 强制英语区域，确保 javac 错误消息可被脚本稳定解析
    options.compilerArgs << '-J-Duser.language=en' << '-J-Duser.country=US'
}

// Loom 默认会拆 remapJar；仅做 compileJava 即可验证类型/语法
`

const SETTINGS_GRADLE = `pluginManagement {
    repositories {
        maven { url 'https://maven.aliyun.com/repository/gradle-plugin' }
        maven { url 'https://maven.fabricmc.net/' }
        gradlePluginPortal()
    }
}
rootProject.name = 'verify-enchant'
`

const GRADLE_PROPS = `org.gradle.jvmargs=-Dfile.encoding=UTF-8 -Xmx2g
org.gradle.parallel=false
org.gradle.daemon=false
minecraft_version=1.20.1
yarn_mappings=1.20.1+build.10
loader_version=0.15.11
fabric_version=0.92.2+1.20.1
`

/** 主类（实现 ModInitializer，供 ModEnchantments 的 id() 引用） */
const MAIN_JAVA = `package com.kunyu.verify;

import net.fabricmc.api.ModInitializer;
import net.minecraft.util.Identifier;
import com.kunyu.verify.registry.ModEnchantments;

public class VerifyEnchantMod implements ModInitializer {
    public static final String MOD_ID = "verify_enchant";

    public static Identifier id(String name) {
        return Identifier.of(MOD_ID, name);
    }

    @Override
    public void onInitialize() {
        ModEnchantments.register();
    }
}
`

const FABRIC_MOD_JSON = `{
  "schemaVersion": 1,
  "id": "verify_enchant",
  "version": "0.0.1",
  "name": "Verify Enchant",
  "description": "KunYu 附魔代码生成真机编译验证用最小工程。",
  "main": "com.kunyu.verify.VerifyEnchantMod",
  "depends": {
    "fabricloader": ">=0.15",
    "minecraft": "~1.20.1",
    "java": ">=17"
  }
}
`

/** 构造验证用 ModContext（仅填 enchantmentCodegen 实际读取的字段） */
function makeCtx(): ModContext {
  return {
    loader: 'fabric',
    mcVersion: '1.20.1',
    modId: 'verify_enchant',
    modClassName: 'VerifyEnchantMod',
    packageName: 'com.kunyu.verify',
    mavenGroup: 'com.kunyu.verify',
    packageDiverged: false,
    pkgPath: join(VERIFY_DIR, 'src', 'main', 'java', 'com', 'kunyu', 'verify'),
    javaDir: join(VERIFY_DIR, 'src', 'main', 'java'),
    registryDir: join(VERIFY_DIR, 'src', 'main', 'java', 'com', 'kunyu', 'verify', 'registry'),
    resourcesDir: join(VERIFY_DIR, 'src', 'main', 'resources'),
    assetsDir: join(VERIFY_DIR, 'src', 'main', 'resources', 'assets'),
    dataDir: join(VERIFY_DIR, 'src', 'main', 'resources', 'data')
  }
}

/** 构造覆盖所有 override 分支的测试附魔集（复用 createDefaultEnchantment 保证字段完整） */
function makeEnchantments(): EnchantmentSchema[] {
  // createDefaultEnchantment 已在 1112 基线测试中验证默认值合法，这里只覆盖需要的 override 分支
  const base = (id: string): EnchantmentSchema => {
    const d = createDefaultEnchantment(id)
    // 重置伤害与稀有度便于按例覆盖
    d.damageBonus = null
    d.treasure = false
    d.curse = false
    return d
  }
  const a = base('plain_strike')
  a.rarity = 'COMMON'
  a.target = 'WEAPON'
  a.slots = ['mainhand']
  a.maxLevel = 3

  const b = base('soul_fire')
  b.rarity = 'RARE'
  b.target = 'WEAPON'
  b.slots = ['mainhand']
  b.maxLevel = 5
  b.treasure = true
  b.damageBonus = { base: 2.5, perLevel: 1.5 }

  const c = base('doom_curse')
  c.rarity = 'VERY_RARE'
  c.target = 'ARMOR_CHEST'
  c.slots = ['chest']
  c.maxLevel = 1
  c.curse = true

  return [a, b, c]
}

/** 写入工程骨架（仅首次创建，后续复用以缓存 MC 下载） */
function scaffoldProject(): void {
  mkdirSync(join(VERIFY_DIR, 'src', 'main', 'java', 'com', 'kunyu', 'verify', 'registry'), {
    recursive: true
  })
  mkdirSync(join(VERIFY_DIR, 'src', 'main', 'resources'), { recursive: true })

  const files: Array<[string, string]> = [
    [join(VERIFY_DIR, 'build.gradle'), BUILD_GRADLE],
    [join(VERIFY_DIR, 'settings.gradle'), SETTINGS_GRADLE],
    [join(VERIFY_DIR, 'gradle.properties'), GRADLE_PROPS],
    [join(VERIFY_DIR, 'src', 'main', 'java', 'com', 'kunyu', 'verify', 'VerifyEnchantMod.java'), MAIN_JAVA],
    [join(VERIFY_DIR, 'src', 'main', 'resources', 'fabric.mod.json'), FABRIC_MOD_JSON]
  ]
  for (const [p, content] of files) {
    if (!existsSync(p)) writeFileSync(p, content, 'utf-8')
  }
}

/** 检测系统 gradle 与 JDK 17 是否就绪 */
function checkToolchain(): { gradle: string | null; jdkOk: boolean; reason?: string } {
  const javaExe = join(JDK_17_HOME, 'bin', 'java.exe')
  if (!existsSync(javaExe)) {
    return { gradle: null, jdkOk: false, reason: `JDK 17 不存在于 ${javaExe}（project_memory 硬约束）` }
  }
  // 优先用工程内 gradlew.bat（若已生成），否则回退系统 gradle
  const gradlewBat = join(VERIFY_DIR, 'gradlew.bat')
  if (existsSync(gradlewBat)) {
    return { gradle: gradlewBat, jdkOk: true }
  }
  const r = spawnSync('gradle', ['-v'], { shell: true, encoding: 'utf-8', timeout: 30000 })
  if (r.status === 0) {
    return { gradle: 'gradle', jdkOk: true }
  }
  return {
    gradle: null,
    jdkOk: true,
    reason:
      '系统未找到 gradle，且工程内无 gradlew.bat。请先安装 Gradle 8.x，或在工程目录执行 `gradle wrapper` 生成 wrapper 后重试。'
  }
}

/** 从编译输出提取错误行（兼容 javac 英文与中文输出） */
function extractErrors(output: string): string[] {
  const lines = output.split(/\r?\n/)
  return lines.filter((l) => /\.java:\d+:\s*error:|错误：|error:/i.test(l)).slice(0, 30)
}

describeMaybe('附魔 Java 真机编译验证（Fabric 1.20.1 Yarn）', () => {
  it(
    'generateModEnchantmentsJava 产出的 ModEnchantments.java 可被 Loom 真机编译通过',
    () => {
      const tool = checkToolchain()
      expect(tool.jdkOk, tool.reason ?? 'JDK 17 未就绪').toBe(true)
      if (!tool.gradle) {
        // 工具链缺失：跳过而非失败，给出可读指引
        console.warn(`[verify-enchant] 跳过：${tool.reason}`)
        expect(tool.reason).toBeDefined()
        return
      }

      scaffoldProject()

      // 1) 生成 ModEnchantments.java
      const ctx = makeCtx()
      const list = makeEnchantments()
      const java = generateModEnchantmentsJava(ctx, list)
      const modEnchPath = join(ctx.registryDir, 'ModEnchantments.java')
      writeFileSync(modEnchPath, java, 'utf-8')

      // 2) 跑 gradle compileJava（JDK 17）
      const gradleArgs =
        tool.gradle === 'gradle'
          ? ['--no-daemon', '--console=plain', '--warning-mode=summary', 'compileJava']
          : ['--no-daemon', '--console=plain', '--warning-mode=summary', 'compileJava']

      const env = {
        ...process.env,
        JAVA_HOME: JDK_17_HOME,
        PATH: `${join(JDK_17_HOME, 'bin')};${process.env.PATH ?? ''}`,
        // 强制英语区域，确保 javac 错误消息稳定
        LANG: 'en_US.UTF-8',
        LC_ALL: 'en_US.UTF-8'
      }

      const result = spawnSync(tool.gradle, gradleArgs, {
        cwd: VERIFY_DIR,
        env,
        shell: true,
        encoding: 'utf-8',
        timeout: 600000, // 10 分钟：首次需下载 MC + Yarn mappings
        maxBuffer: 32 * 1024 * 1024
      })

      const combined = `${result.stdout ?? ''}\n${result.stderr ?? ''}`

      if (result.status !== 0) {
        const errors = extractErrors(combined)
        console.error('[verify-enchant] 编译失败，错误行：\n' + errors.join('\n'))
        console.error('[verify-enchant] 完整输出末尾 4KB：\n' + combined.slice(-4096))
      }

      expect(result.status, `编译应成功，但 gradle 退出码 = ${result.status}`).toBe(0)
      // 产物存在性兜底
      expect(existsSync(join(VERIFY_DIR, 'build', 'classes', 'java', 'main'))).toBe(true)
    },
    600000
  )

  it('无附魔时 ModEnchantments.java 仍可编译（撤销织入分支）', () => {
    const tool = checkToolchain()
    if (!tool.gradle || !tool.jdkOk) {
      console.warn(`[verify-enchant] 跳过空附魔用例：${tool.reason ?? '工具链缺失'}`)
      expect(tool.reason ?? 'skip').toBeDefined()
      return
    }

    scaffoldProject()
    const ctx = makeCtx()
    const java = generateModEnchantmentsJava(ctx, [])
    writeFileSync(join(ctx.registryDir, 'ModEnchantments.java'), java, 'utf-8')

    const env = {
      ...process.env,
      JAVA_HOME: JDK_17_HOME,
      PATH: `${join(JDK_17_HOME, 'bin')};${process.env.PATH ?? ''}`,
      LANG: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8'
    }
    const result = spawnSync(
      tool.gradle,
      ['--no-daemon', '--console=plain', '--warning-mode=summary', 'compileJava'],
      { cwd: VERIFY_DIR, env, shell: true, encoding: 'utf-8', timeout: 600000, maxBuffer: 32 * 1024 * 1024 }
    )

    if (result.status !== 0) {
      const combined = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
      console.error('[verify-enchant] 空附魔编译失败：\n' + extractErrors(combined).join('\n'))
    }
    expect(result.status, '空附魔分支应编译通过').toBe(0)
  }, 600000)
})

// 清理钩子：仅在显式 VERIFY_ENCH_CLEAN=1 时删除工程（保留缓存）
if (process.env.VERIFY_ENCH_CLEAN === '1' && existsSync(VERIFY_DIR)) {
  rmSync(VERIFY_DIR, { recursive: true, force: true })
}
