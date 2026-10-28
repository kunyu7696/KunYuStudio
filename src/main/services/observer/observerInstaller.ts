/**
 * kunyu-observer-agent 落盘辅助：定位预构建的 javaagent jar。
 *
 * agent 源码在 resources/observer-agent（纯 JDK 工具链，javac --release 8），
 * 由 scripts/build-observer-agent.cjs 构建为 dist/kunyu-observer-agent.jar。
 * 本模块只做只读定位：javaagent 形态下 jar 直接被 -javaagent 引用，
 * 不再需要像旧 Fabric mod 那样复制进游戏 mods 目录。
 */
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** agent jar 固定文件名（无版本号，构建脚本单一产物） */
export const OBSERVER_AGENT_JAR_NAME = 'kunyu-observer-agent.jar'

/**
 * 在产物目录中定位 agent jar；不存在返回 null。
 * 固定文件名 + 存在即合法（agent 没有 sources/dev 等附属产物，无需主产物过滤）。
 */
export function findBuiltAgentJar(distDir: string): string | null {
  const candidate = join(distDir, OBSERVER_AGENT_JAR_NAME)
  if (!existsSync(candidate)) return null
  try {
    return statSync(candidate).isFile() ? candidate : null
  } catch {
    return null
  }
}
