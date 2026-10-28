/**
 * 构建产物 jar 选取（自 exportStage 下沉为中立模块，observerInstaller 同用）。
 *
 * 规则（对齐 docs/AI-AGENT-MODPACK-PLAN.md P0-a「可分发优先级排序」）：
 * - 排除 Gradle 附属分类产物：-sources / -javadoc / -dev（游戏不加载，只按 mtime 会误报）；
 * - shadow 肥包 `-all.jar` 优先于瘦 jar——瘦 jar 缺 shaded 依赖，进游戏 NoClassDefFoundError，
 *   与当初误选 -sources 同一性质；build/libs 只有 -all.jar 时必须选中而非返回 null；
 * - 其余（含 -slim）按 mtime 取新。
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

const NON_PRIMARY_JAR = /-(sources|javadoc|dev)\.jar$/i
const FAT_JAR = /-all\.jar$/i

/** 从一组 jar 文件名中挑出可分发候选（排除 sources/javadoc/dev）。 */
export function pickPrimaryJar(names: string[]): string[] {
  return names.filter((f) => f.endsWith('.jar') && !NON_PRIMARY_JAR.test(f))
}

/** `build/libs` 中可分发优先级最高的 jar 绝对路径（无则 null）。 */
export function latestBuiltJar(projectPath: string): string | null {
  const libs = resolve(projectPath, 'build', 'libs')
  if (!existsSync(libs)) return null
  const jars = pickPrimaryJar(readdirSync(libs))
    .map((f) => {
      let mtime = 0
      try {
        mtime = statSync(resolve(libs, f)).mtimeMs
      } catch {
        mtime = 0
      }
      return { f, mtime, fat: FAT_JAR.test(f) }
    })
    .filter((x) => x.mtime > 0)
    // 可分发优先级档（-all 肥包 > 其它）优先，同档按 mtime 取新
    .sort((a, b) => Number(b.fat) - Number(a.fat) || b.mtime - a.mtime)
  return jars.length > 0 ? resolve(libs, jars[0]!.f) : null
}
