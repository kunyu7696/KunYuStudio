/**
 * Observer 访问令牌管理（S-05 / F4-03）。
 *
 * 主进程在启动游戏前生成一次性 token：
 * - 用户工程 runClient：写入 gradle.properties（kunyu.observer.token=...），
 *   由 build.gradle 的 -javaagent vmArg 传入游戏 JVM；
 * - 托管实例（mcLaunchService）：直接拼进 -javaagent 参数。
 * kunyu-observer-agent（javaagent 形态）从 agent 参数读取 token 并校验
 * X-Observer-Token 请求头（同时保留 -Dkunyu.observer.token 系统属性回退）。
 * 本模块提供进程内的 token 存取，供 observerClient 在 HTTP 请求中附带。
 */
import { randomBytes } from 'node:crypto'

/** 项目根 → token 的映射（同时只运行一个游戏实例，理论上只有一条） */
const tokenByRoot = new Map<string, string>()
/** 当前活动游戏实例的 token（observerClient 不感知 projectRoot，用全局 current） */
let currentToken = ''

/** 生成一个 URL 安全的随机 token（32 字节 base64url）。 */
export function generateObserverToken(): string {
  return randomBytes(32).toString('base64url')
}

/** 记录某项目根对应的 token（runClient 启动前调用），并设为 current。 */
export function setObserverToken(projectRoot: string, token: string): void {
  tokenByRoot.set(projectRoot, token)
  currentToken = token
}

/** 获取某项目根对应的 token；未设置返回空串（observer 端空 token 不校验）。 */
export function getObserverToken(projectRoot: string): string {
  return tokenByRoot.get(projectRoot) ?? ''
}

/** 获取当前活动游戏实例的 token（供 observerClient 附带请求头）。 */
export function getCurrentObserverToken(): string {
  return currentToken
}

/** 清除某项目根的 token（游戏退出时调用）。 */
export function clearObserverToken(projectRoot: string): void {
  tokenByRoot.delete(projectRoot)
  if (tokenByRoot.size === 0) currentToken = ''
}
