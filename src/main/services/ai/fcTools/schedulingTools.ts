/**
 * 调度工具（从 toolRegistry.ts builtinSchedulingTools 拆出）。
 * 不暴露给模型 FC 循环；weaver/编排代码直接调用。
 * gradle_build：执行真实 Gradle clean build 并回传结果。
 */
import type { RegisteredTool, ToolRegistryDeps } from '../toolRegistry'
import { TOOL_RESULT_CLIP } from './textClip'
import { TOOL_TIMEOUTS } from './toolPolicy'
import { assertWithinRoot } from '../../fsService'

function clipTail(text: string, max: number): string {
  return text.length <= max ? text : text.slice(text.length - max)
}

export function builtinSchedulingTools(deps: ToolRegistryDeps): RegisteredTool[] {
  const tools: RegisteredTool[] = []

  tools.push({
    kind: 'scheduling',
    def: {
      type: 'function',
      function: {
        name: 'gradle_build',
        description: '执行真实 Gradle clean build 并返回结果（仅编排调度使用）。',
        parameters: {
          type: 'object',
          properties: {
            root: { type: 'string', description: '项目根绝对路径' }
          },
          required: ['root']
        }
      }
    },
    visibility: 'scheduler',
    execute: async (args) => {
      const runGradle = deps.runGradle
      if (!runGradle) return { ok: false, text: '', error: 'runGradle 不可用' }
      const root = typeof args['root'] === 'string' ? args['root'] : ''
      if (!root) return { ok: false, text: '', error: 'root 不能为空' }
      try {
        assertWithinRoot(root)
      } catch {
        return { ok: false, text: '', error: 'root 必须在已注册项目根目录内' }
      }
      let tail = ''
      const done = await new Promise<{ exitCode: number | null; cancelled: boolean; timedOut: boolean }>(
        (resolvePromise) => {
          runGradle(
            { root, tasks: ['clean', 'build'], javaHome: deps.javaHome?.(), timeoutMs: TOOL_TIMEOUTS.gradleBuild },
            (event) => {
              if (event.type === 'output' && event.text) {
                tail = clipTail(tail + event.text, TOOL_RESULT_CLIP)
              }
              if (event.type === 'phase' && event.phase === 'done') {
                resolvePromise({
                  exitCode: event.exitCode ?? null,
                  cancelled: event.cancelled === true,
                  timedOut: event.timedOut === true
                })
              }
            }
          )
        }
      )
      const ok = done.exitCode === 0 && !done.cancelled && !done.timedOut
      return {
        ok,
        text: ok
          ? `构建通过（exit 0）。`
          : `构建失败（exit ${done.exitCode}${done.timedOut ? '，超时' : done.cancelled ? '，被取消' : ''}）。日志尾部：\n${tail}`,
        data: done
      }
    }
  })

  return tools
}
