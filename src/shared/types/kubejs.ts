/**
 * KubeJS 脚本共享类型。
 *
 * 对应项目内 kubejs/{startup,server,client}_scripts/*.js 三目录，语义固定：
 * - startup_scripts：启动期执行（注册自定义物品/方块等）；
 * - server_scripts：服务端事件（配方、服务器生命周期、玩家事件等）；
 * - client_scripts：客户端事件（界面、提示、渲染相关）。
 * 脚本以 Monaco JS 编辑，辅以事件 API 代码片段与内置模板库。
 */

/** 三个脚本目录之一 */
export type KubejsScriptDir = 'startup' | 'server' | 'client'

/** 单个脚本文件摘要 */
export interface KubejsScriptFile {
  dir: KubejsScriptDir
  /** 文件名去 .js 后缀（小写字母开头 + 小写/数字/下划线） */
  stem: string
  /** 项目相对 POSIX 路径（kubejs/<dir>_scripts/<stem>.js） */
  relPath: string
  sizeBytes: number
  /** mtime 毫秒时间戳 */
  modifiedAt: number
}

/** 脚本列表结果：含尚不存在的目录标记与读取警告 */
export interface KubejsListResult {
  scripts: KubejsScriptFile[]
  /** 尚不存在的脚本目录（新建/模板落盘时自动创建） */
  missingDirs: KubejsScriptDir[]
  warnings: string[]
}

/** 内置脚本模板 */
export interface KubejsTemplate {
  id: string
  name: string
  description: string
  /** 落盘目录 */
  dir: KubejsScriptDir
  /** 落盘文件名（去 .js 后缀） */
  stem: string
  content: string
}
