/**
 * 反编译工作区 FC 工具（decompileService 的 AI 封装）。
 *
 * - decompile_list_workspaces / decompile_search / decompile_read_file：
 *   只读浏览 userData/decompiled 下的既有反编译产物（不依赖打开的项目）；
 *   路径越界由 decompileService 自管安全根拦截，工具侧捕获后一律软失败。
 * - decompile_start：对指定 jar 启动 Vineflower 反编译（工具缺失时按镜像设置下载，
 *   需 Java 11+），属外部副作用；产物落新工作区，随后用上面三个只读工具浏览。
 */
import type { RegisteredTool } from '../toolRegistry'
import { listWorkspaces, readFileIn, searchIn, startDecompile } from '../../decompileService'

const CLIP = 8000
function clip(text: string): string {
  return text.length <= CLIP ? text : `${text.slice(0, CLIP)}…（已截断）`
}
function asString(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

/** 工作区入参解析：优先按目录名/根路径命中既有工作区，未命中原样交给服务层守卫判定 */
function resolveWorkspaceRoot(input: string): string {
  const q = input.trim()
  const hit = listWorkspaces().find((w) => w.name === q || w.root === q)
  return hit ? hit.root : q
}

export function builtinDecompileTools(): RegisteredTool[] {
  const tools: RegisteredTool[] = []

  /* decompile_list_workspaces */
  tools.push({
    kind: 'chat',
    def: {
      type: 'function',
      function: {
        name: 'decompile_list_workspaces',
        description:
          '列出全部反编译工作区（目录名/根路径/修改时间，按最近修改排序）。' +
          '产物在应用 userData/decompiled 下，与打开的项目无关。',
        parameters: { type: 'object', properties: {}, required: [] }
      }
    },
    visibility: 'always',
    execute: () => {
      const list = listWorkspaces()
      if (list.length === 0) {
        return { ok: true, text: '还没有反编译工作区。用 decompile_start 对 jar 启动反编译。', data: { workspaces: [] } }
      }
      const lines = list.map((w) => `- ${w.name}（${w.root}）`)
      return {
        ok: true,
        text: clip(`共 ${list.length} 个工作区：\n${lines.join('\n')}`),
        data: { workspaces: list }
      }
    }
  })

  /* decompile_search */
  tools.push({
    kind: 'chat',
    def: {
      type: 'function',
      function: {
        name: 'decompile_search',
        description:
          '在指定反编译工作区内按文件名模糊搜索 .java 类（大小写不敏感子串，上限 200）。' +
          '返回命中文件绝对路径列表。',
        parameters: {
          type: 'object',
          properties: {
            workspace: { type: 'string', description: '工作区目录名或根路径' },
            query: { type: 'string', description: '类名子串' }
          },
          required: ['workspace', 'query']
        }
      }
    },
    visibility: 'always',
    execute: (args) => {
      const ws = asString(args['workspace'])
      const query = asString(args['query']).trim()
      if (!ws) return { ok: false, text: '', error: '缺少 workspace 参数（工作区目录名或根路径）' }
      if (!query) return { ok: false, text: '', error: '缺少 query 参数（类名子串）' }
      try {
        const hits = searchIn(resolveWorkspaceRoot(ws), query)
        if (hits.length === 0) {
          return { ok: true, text: `未找到文件名包含「${query}」的 .java`, data: { hits: [] } }
        }
        const lines = hits.map((h) => `- ${h.path}`)
        return {
          ok: true,
          text: clip(`命中 ${hits.length} 个类：\n${lines.join('\n')}`),
          data: { hits }
        }
      } catch (err) {
        return { ok: false, text: '', error: (err as Error).message }
      }
    }
  })

  /* decompile_read_file */
  tools.push({
    kind: 'chat',
    def: {
      type: 'function',
      function: {
        name: 'decompile_read_file',
        description: '读取反编译工作区内单个文本文件全文（utf-8，超 2MB 截断）。',
        parameters: {
          type: 'object',
          properties: {
            workspace: { type: 'string', description: '工作区目录名或根路径' },
            path: { type: 'string', description: '工作区内相对路径，如 com/example/Demo.java' }
          },
          required: ['workspace', 'path']
        }
      }
    },
    visibility: 'always',
    execute: async (args) => {
      const ws = asString(args['workspace'])
      const rel = asString(args['path'])
      if (!ws) return { ok: false, text: '', error: '缺少 workspace 参数（工作区目录名或根路径）' }
      if (!rel) return { ok: false, text: '', error: '缺少 path 参数（工作区内相对路径）' }
      try {
        const f = await readFileIn(resolveWorkspaceRoot(ws), rel)
        return {
          ok: true,
          text: clip(f.content) + (f.truncated ? '\n（文件超 2MB，已截断）' : ''),
          data: { relPath: f.relPath, truncated: f.truncated }
        }
      } catch (err) {
        return { ok: false, text: '', error: (err as Error).message }
      }
    }
  })

  /* decompile_start */
  tools.push({
    kind: 'chat',
    def: {
      type: 'function',
      function: {
        name: 'decompile_start',
        description:
          '对指定 jar 启动 Vineflower 反编译：工具缺失时按网络镜像设置下载，需 Java 11+ 运行时。' +
          '产物落 userData/decompiled/<jar名>-<哈希>/ 新工作区，完成后用 decompile_search / decompile_read_file 浏览。',
        parameters: {
          type: 'object',
          properties: {
            jarPath: { type: 'string', description: '源 jar 绝对路径' }
          },
          required: ['jarPath']
        }
      }
    },
    visibility: 'always',
    execute: async (args) => {
      const jarPath = asString(args['jarPath']).trim()
      if (!jarPath) return { ok: false, text: '', error: '缺少 jarPath 参数（源 jar 绝对路径）' }
      try {
        const r = await startDecompile(jarPath)
        return {
          ok: true,
          text: `反编译完成：${r.fileCount} 个类 → ${r.outDir}`,
          data: { outDir: r.outDir, fileCount: r.fileCount, logTail: clip(r.logTail) }
        }
      } catch (err) {
        return { ok: false, text: '', error: (err as Error).message }
      }
    }
  })

  return tools
}
