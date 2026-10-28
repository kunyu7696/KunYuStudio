/**
 * 特性⑤ 按加载器生成 build.gradle + gradle.properties。
 *
 * CI 矩阵中每个 loader 需要对应的构建脚本。
 * 调用已有模板函数（fabricTemplates / forgeTemplates / neoForgeTemplates），
 * 使用 'official' 镜像（CI runner 在海外，国内镜像反而慢）。
 *
 * 产物写到 `.kunyu/ci/build-<loader>.gradle` 和 `.kunyu/ci/gradle-<loader>.properties`，
 * CI 步骤 `cp` 到项目根后再 `./gradlew build`。
 */
import {
  buildGradle,
  gradleProperties as fabricGradleProperties,
  type FabricTemplateVars
} from '../../templates/fabricTemplates'
import {
  forgeBuildGradle,
  forgeGradleProperties,
  type ForgeTemplateVars
} from '../../templates/forgeTemplates'
import {
  neoForgeBuildGradle,
  neoForgeGradleProperties,
  type NeoForgeTemplateVars
} from '../../templates/neoForgeTemplates'
import {
  fabricTargetJdk,
  getToolchain,
  type FabricToolchain,
  type ForgeToolchain,
  type NeoForgeToolchain
} from '../../templates/loaderVersionMatrix'
import type { ModLoader } from '../../../shared/types/project'

/** CI 构建脚本产物 */
export interface LoaderBuildScript {
  buildGradle: string
  gradleProperties: string
}

/** 从项目元数据派生构建脚本所需的通用字段 */
export interface CiProjectMeta {
  modId: string
  modName: string
  version: string
  packageName: string
  mcVersion: string
}

/**
 * 按加载器生成 build.gradle + gradle.properties。
 * - fabric → buildGradle() + gradleProperties()
 * - forge → forgeBuildGradle() + forgeGradleProperties()
 * - neoforge → neoForgeBuildGradle() + neoForgeGradleProperties()
 *
 * 镜像固定 'official'：CI runner 在海外，国内镜像反而增加延迟。
 */
export function generateBuildScriptForLoader(
  loader: ModLoader,
  meta: CiProjectMeta
): LoaderBuildScript {
  // M23：按项目 MC 版本从统一矩阵取工具链，CI 脚本与脚手架版本严格一致
  switch (loader) {
    case 'fabric': {
      const f = getToolchain('fabric', meta.mcVersion) as FabricToolchain
      const v: FabricTemplateVars = {
        modId: meta.modId,
        modName: meta.modName,
        version: meta.version,
        packageName: meta.packageName,
        mcVersion: f.mcVersion,
        loaderVersion: f.loaderVersion,
        fabricVersion: f.fabricVersion,
        yarnVersion: f.yarnVersion,
        loomVersion: f.loomVersion,
        gradleVersion: f.gradleVersion,
        jdk: fabricTargetJdk(f)
      }
      return {
        buildGradle: buildGradle(v, 'official'),
        gradleProperties: fabricGradleProperties(v)
      }
    }
    case 'forge': {
      const f = getToolchain('forge', meta.mcVersion) as ForgeToolchain
      const v: ForgeTemplateVars = {
        modId: meta.modId,
        modName: meta.modName,
        version: meta.version,
        packageName: meta.packageName,
        mcVersion: f.mcVersion,
        forgeVersion: f.forgeVersion,
        loomLikeVersion: f.forgeGradleVersion,
        gradleVersion: f.gradleVersion,
        jdk: f.jdk,
        forgeConstructorStyle: f.forgeConstructorStyle
      }
      return {
        buildGradle: forgeBuildGradle(v, 'official'),
        gradleProperties: forgeGradleProperties(v)
      }
    }
    case 'neoforge': {
      const f = getToolchain('neoforge', meta.mcVersion) as NeoForgeToolchain
      const v: NeoForgeTemplateVars = {
        modId: meta.modId,
        modName: meta.modName,
        version: meta.version,
        packageName: meta.packageName,
        mcVersion: f.mcVersion,
        neoForgeVersion: f.neoForgeVersion,
        modDevGradleVersion: f.modDevGradleVersion,
        gradleVersion: f.gradleVersion,
        jdk: f.jdk
      }
      return {
        buildGradle: neoForgeBuildGradle(v, 'official'),
        gradleProperties: neoForgeGradleProperties(v)
      }
    }
    default:
      return generateBuildScriptForLoader('fabric', meta)
  }
}

/** 列举所有矩阵加载器需要生成的文件相对路径（.kunyu/ci/ 下） */
export function ciBuildScriptRelPaths(loaders: ModLoader[]): { loader: ModLoader; buildGradleRel: string; gradlePropsRel: string }[] {
  return loaders.map((loader) => ({
    loader,
    buildGradleRel: `.kunyu/ci/build-${loader}.gradle`,
    gradlePropsRel: `.kunyu/ci/gradle-${loader}.properties`
  }))
}

