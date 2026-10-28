/**
 * 特性⑤ CI 导出服务：config 读写 + workflow 落盘。
 *
 * - config 存 `.kunyu/ci-config.json`（用户可手编，读取时 stripBom + 防御性 parse）
 * - workflow 写 `.github/workflows/{build,release,gametest}.yml`
 * - 矩阵 build.gradle 写 `.kunyu/ci/build-<loader>.gradle` + `gradle-<loader>.properties`
 *
 * 路径安全：所有写操作经 assertWithinRoot 校验，必须在已注册项目根内。
 * Windows 陷阱：写 JSON 用 writeFileSync 不带 BOM（contentPackIo 同口径）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { assertWithinRoot } from '../fsService'
import {
  ciBuildScriptRelPaths,
  generateBuildScriptForLoader,
  type CiProjectMeta
} from './buildGradleForLoader'
import { previewWorkflows as previewWf } from './ciWorkflowGenerator'
import { parseCiConfig, type CiConfig, type CiExportResult } from '../../../shared/types/ci'
import type { ModLoader, Project } from '../../../shared/types/project'

const CI_CONFIG_REL = '.kunyu/ci-config.json'
const WORKFLOWS_DIR = '.github/workflows'
const CI_DIR = '.kunyu/ci'

/** 剥离 UTF-8 BOM（Windows 手编 JSON 常带 BOM，直接 parse 会失败） */
function stripBom(text: string): string {
  return text.startsWith('\uFEFF') ? text.slice(1) : text
}

/** 从 Project 派生 CI 构建脚本所需的元数据 */
export function deriveCiProjectMeta(project: Project, packageName: string): CiProjectMeta {
  return {
    modId: project.modId ?? 'mymod',
    modName: project.name,
    version: '1.0.0',
    packageName,
    mcVersion: project.mcVersion
  }
}

/**
 * 读取 `.kunyu/ci-config.json`。
 * - 文件不存在 → null
 * - BOM / 坏 JSON → null（用户需手改或重新生成）
 * - 字段缺失 → parseCiConfig 用默认值兜底
 */
export function getCiConfig(projectRoot: string): CiConfig | null {
  const abs = join(projectRoot, CI_CONFIG_REL)
  if (!existsSync(abs)) return null
  try {
    const raw = JSON.parse(stripBom(readFileSync(abs, 'utf8')))
    return parseCiConfig(raw)
  } catch {
    return null
  }
}

/**
 * 写 `.kunyu/ci-config.json`（pretty print，UTF-8 无 BOM）。
 */
export function setCiConfig(projectRoot: string, config: CiConfig): void {
  const dir = join(projectRoot, CI_DIR)
  assertWithinRoot(dir)
  mkdirSync(dir, { recursive: true })
  const abs = join(projectRoot, CI_CONFIG_REL)
  assertWithinRoot(abs)
  writeFileSync(abs, JSON.stringify(config, null, 2) + '\n', 'utf8')
}

/**
 * 导出所有已开启的工作流 + 矩阵构建脚本到项目目录。
 * - 写 `.github/workflows/{build,release,gametest}.yml`
 * - 写 `.kunyu/ci/build-<loader>.gradle` + `gradle-<loader>.properties`
 * - 未开启的工作流不写（已有的旧文件不主动删除，避免覆盖用户手改）
 */
export function exportCiWorkflows(
  projectRoot: string,
  config: CiConfig,
  meta: CiProjectMeta
): CiExportResult {
  try {
    // 1. 写工作流 yml
    const wfDir = join(projectRoot, WORKFLOWS_DIR)
    assertWithinRoot(wfDir)
    mkdirSync(wfDir, { recursive: true })

    const workflows: string[] = []
    if (config.workflows.build) {
      const yml = previewWf(config, meta).build
      if (yml) {
        const rel = `${WORKFLOWS_DIR}/build.yml`
        const abs = join(projectRoot, rel)
        assertWithinRoot(abs)
        writeFileSync(abs, yml, 'utf8')
        workflows.push(rel)
      }
    }
    if (config.workflows.release) {
      const yml = previewWf(config, meta).release
      if (yml) {
        const rel = `${WORKFLOWS_DIR}/release.yml`
        const abs = join(projectRoot, rel)
        assertWithinRoot(abs)
        writeFileSync(abs, yml, 'utf8')
        workflows.push(rel)
      }
    }
    if (config.workflows.gametest) {
      const yml = previewWf(config, meta).gametest
      if (yml) {
        const rel = `${WORKFLOWS_DIR}/gametest.yml`
        const abs = join(projectRoot, rel)
        assertWithinRoot(abs)
        writeFileSync(abs, yml, 'utf8')
        workflows.push(rel)
      }
    }

    // 2. 写矩阵构建脚本（仅 build 开启时）
    const buildScripts: string[] = []
    if (config.workflows.build) {
      const ciDir = join(projectRoot, CI_DIR)
      assertWithinRoot(ciDir)
      mkdirSync(ciDir, { recursive: true })

      const loaders: ModLoader[] = config.matrix.loaders.length > 0 ? config.matrix.loaders : ['fabric']
      for (const loader of loaders) {
        const script = generateBuildScriptForLoader(loader, meta)
        const gradleRel = `${CI_DIR}/build-${loader}.gradle`
        const propsRel = `${CI_DIR}/gradle-${loader}.properties`

        const gradleAbs = join(projectRoot, gradleRel)
        const propsAbs = join(projectRoot, propsRel)
        assertWithinRoot(gradleAbs)
        assertWithinRoot(propsAbs)

        writeFileSync(gradleAbs, script.buildGradle, 'utf8')
        writeFileSync(propsAbs, script.gradleProperties, 'utf8')
        buildScripts.push(gradleRel, propsRel)
      }
    }

    return { ok: true, workflows, buildScripts }
  } catch (err) {
    return { ok: false, workflows: [], buildScripts: [], error: (err as Error).message }
  }
}

/**
 * 重新生成工作流（读 config → export）。
 * 用户手改 yml 后可一键重新生成。
 */
export function regenerateWorkflows(projectRoot: string, meta: CiProjectMeta): CiExportResult {
  const config = getCiConfig(projectRoot)
  if (!config) {
    return { ok: false, workflows: [], buildScripts: [], error: 'CI 配置文件缺失，请先保存配置' }
  }
  return exportCiWorkflows(projectRoot, config, meta)
}

/**
 * 预览工作流 YAML（不写盘）。
 * 返回 { build?, release?, gametest? }，未开启的 kind 不含 key。
 */
export function previewWorkflows(
  _projectRoot: string,
  config: CiConfig,
  meta: CiProjectMeta
): Partial<Record<string, string>> {
  return previewWf(config, meta)
}

/** 列举矩阵加载器的构建脚本相对路径（UI 诊断用） */
export function listBuildScripts(_projectRoot: string, loaders: string[]): string[] {
  return ciBuildScriptRelPaths(loaders as never).flatMap((p) => [p.buildGradleRel, p.gradlePropsRel])
}

export { CI_CONFIG_REL, WORKFLOWS_DIR, CI_DIR }
