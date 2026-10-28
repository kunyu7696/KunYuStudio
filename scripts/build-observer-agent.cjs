#!/usr/bin/env node
/**
 * build-observer-agent.cjs
 * ========================
 * 构建 kunyu-observer-agent：覆盖 Fabric / Forge / NeoForge 全版本的 JVM javaagent
 * （替代旧 resources/observer-mod 的 Fabric-only Gradle 工程）。
 *
 * 纯 JDK 工具链：javac --release 8 编译 + jar cfm 打包，零外部依赖，无需 Gradle，
 * 不下载任何 Minecraft / 映射产物。class file v52 → Java 8 ~ 25+ 的 MC 全版本可加载。
 *
 * 产物：resources/observer-agent/dist/kunyu-observer-agent.jar
 * 用法：node scripts/build-observer-agent.cjs [--force]
 *       默认按 mtime 增量：源码 / MANIFEST 不比产物新则跳过（供 build:win 前置调用）。
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..')
const AGENT_DIR = path.join(ROOT, 'resources', 'observer-agent')
const SRC_DIR = path.join(AGENT_DIR, 'src')
const BUILD_DIR = path.join(AGENT_DIR, 'build')
const CLASSES_DIR = path.join(BUILD_DIR, 'classes')
const DIST_DIR = path.join(AGENT_DIR, 'dist')
const JAR = path.join(DIST_DIR, 'kunyu-observer-agent.jar')
const MANIFEST = path.join(AGENT_DIR, 'MANIFEST.MF')

const force = process.argv.includes('--force')

/** 递归收集 .java 源文件。 */
function collectSources(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) collectSources(p, out)
    else if (e.name.endsWith('.java')) out.push(p)
  }
  return out
}

function newestMtime(files) {
  let newest = 0
  for (const f of files) newest = Math.max(newest, fs.statSync(f).mtimeMs)
  return newest
}

/** 解析 JDK 工具：优先 JAVA_HOME/bin，其次 PATH。 */
function jdkTool(name) {
  const exe = process.platform === 'win32' ? `${name}.exe` : name
  if (process.env.JAVA_HOME) {
    const candidate = path.join(process.env.JAVA_HOME, 'bin', exe)
    if (fs.existsSync(candidate)) return candidate
  }
  return exe
}

if (!fs.existsSync(SRC_DIR)) {
  console.error('[observer-agent] 源码目录不存在：', SRC_DIR)
  process.exit(1)
}
const sources = collectSources(SRC_DIR)
if (sources.length === 0) {
  console.error('[observer-agent] 未找到任何 .java 源文件')
  process.exit(1)
}

/**
 * 读 Agent.java 里的 VERSION 常量：jar 已随仓库分发，仅靠 mtime 判断会漏掉
 * 「克隆后源文件与 jar 时间戳相同」的情形，用版本号兜底保证不会跑旧二进制。
 */
function agentVersion() {
  const src = fs.readFileSync(path.join(SRC_DIR, 'kunyu', 'observer', 'Agent.java'), 'utf-8')
  const m = src.match(/VERSION\s*=\s*"([^"]+)"/)
  return m ? m[1] : ''
}

const VERSION_FILE = `${JAR}.version`
const version = agentVersion()
const jarMtime = fs.existsSync(JAR) ? fs.statSync(JAR).mtimeMs : 0
const srcMtime = newestMtime([...sources, MANIFEST])
const versionMatched =
  fs.existsSync(VERSION_FILE) && fs.readFileSync(VERSION_FILE, 'utf-8').trim() === version
if (!force && versionMatched && jarMtime > srcMtime) {
  console.log(`[observer-agent] agent jar 已是最新（${version}），跳过构建`)
  process.exit(0)
}

const javac = jdkTool('javac')
const jar = jdkTool('jar')

fs.rmSync(CLASSES_DIR, { recursive: true, force: true })
fs.mkdirSync(CLASSES_DIR, { recursive: true })
fs.mkdirSync(DIST_DIR, { recursive: true })

// 源文件清单走 @argfile，避免 Windows 命令行长度上限
// 注意：javac argfile 里反斜杠是转义符，Windows 路径必须转正斜杠
fs.mkdirSync(BUILD_DIR, { recursive: true })
const argFile = path.join(BUILD_DIR, 'sources.txt')
fs.writeFileSync(argFile, sources.map((s) => `"${s.replace(/\\/g, '/')}"`).join('\n'), 'utf-8')

console.log(`[observer-agent] 编译 ${sources.length} 个源文件（javac --release 8）...`)
try {
  execFileSync(javac, ['--release', '8', '-encoding', 'UTF-8', '-d', CLASSES_DIR, `@${argFile}`], {
    stdio: 'inherit'
  })
} catch (e) {
  console.error('[observer-agent] 编译失败：', e.message)
  process.exit(1)
}

console.log('[observer-agent] 打包 jar...')
try {
  execFileSync(jar, ['cfm', JAR, MANIFEST, '-C', CLASSES_DIR, '.'], { stdio: 'inherit' })
} catch (e) {
  console.error('[observer-agent] 打包失败：', e.message)
  process.exit(1)
}
fs.writeFileSync(VERSION_FILE, `${version}\n`, 'utf-8')

const sizeKb = (fs.statSync(JAR).size / 1024).toFixed(1)
console.log(`[observer-agent] 完成：${path.relative(ROOT, JAR)}（${sizeKb} KB）`)
