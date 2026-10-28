/**
 * 托管 MC 实例路径解析（零配置运行环境 3b）。
 *
 * 实例根目录：userData/mcinstances（可在设置中覆盖）。每个实例一个目录，
 * 内含 versions/<mcVersion>/、libraries/、assets/、natives/<mcVersion>/。
 * 单独成模块，便于置备服务与启动逻辑共用且不引入额外依赖。
 */
import { app } from 'electron'
import { join } from 'node:path'

/**
 * 托管 MC 实例根目录。
 * @param override 覆盖值（设置项）；为空/null 时回退 userData/mcinstances。
 */
export function managedMcInstancesRoot(override?: string | null): string {
  const dir = override && override.trim() ? override.trim() : join(app.getPath('userData'), 'mcinstances')
  return dir
}

/** 单实例目录 */
export function mcInstanceDir(root: string, id: string): string {
  return join(root, id)
}

/** 实例元数据文件 */
export function mcInstanceMetaFile(root: string, id: string): string {
  return join(mcInstanceDir(root, id), 'instance.json')
}

/** 版本目录（存 <mcVersion>.json 与 <mcVersion>.jar） */
export function mcVersionDir(root: string, id: string, mcVersion: string): string {
  return join(mcInstanceDir(root, id), 'versions', mcVersion)
}

/** 库根目录（maven 布局） */
export function mcLibrariesDir(root: string, id: string): string {
  return join(mcInstanceDir(root, id), 'libraries')
}

/** 资产根目录 */
export function mcAssetsDir(root: string, id: string): string {
  return join(mcInstanceDir(root, id), 'assets')
}

/** 资产索引文件 */
export function mcAssetIndexFile(root: string, id: string, indexId: string): string {
  return join(mcAssetsDir(root, id), 'indexes', `${indexId}.json`)
}

/** 单个资产对象文件（objects/<hash 前两位>/<hash>） */
export function mcAssetObjectFile(root: string, id: string, hash: string): string {
  return join(mcAssetsDir(root, id), 'objects', hash.slice(0, 2), hash)
}

/** natives 解包目录（按 MC 版本隔离，避免多实例串扰） */
export function mcNativesDir(root: string, id: string, mcVersion: string): string {
  return join(mcInstanceDir(root, id), 'natives', mcVersion)
}
