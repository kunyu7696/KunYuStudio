/**
 * 托管 JDK 路径解析（零配置运行环境 3a）。
 * 单独成模块以避免 jdkService 与 jdkProvisionService 相互导入形成环。
 */
import { app } from 'electron'
import { join } from 'node:path'

/**
 * 应用内下载的托管 JDK 根目录。
 * @param override 设置项 java.managedJdkDir；为空/null 时回退 userData/jdks。
 */
export function managedJdkRoot(override?: string | null): string {
  const dir = override && override.trim() ? override.trim() : join(app.getPath('userData'), 'jdks')
  return dir
}
