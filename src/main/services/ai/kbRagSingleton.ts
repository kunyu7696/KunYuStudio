/**
 * C2 本地 RAG 的 Electron 单例装配：语料指向参考包 + knowledge 语料目录，缓存与模型放 userData。
 * 单独成文件，保持 kbRagService.ts 本身不依赖 electron（vitest 纯 Node 可测）。
 *
 * 语料清单策略（MAX_FILES 精确选）：
 * - ai-reference：优先从 manifest.templates 精确挑活跃组合模板 + 顶层文档，
 *   避免目录遍历被枚举顺序随机截断；manifest 不可用时回退全量遍历；
 * - knowledge：resources/knowledge（fabric/mcwiki/kubejs md）整体入向量层。
 */
import { app } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { EmbedBackend } from '../../../shared/types/models'
import { defaultKnowledgeRoot } from '../knowledgeSearch'
import { collectCorpusFiles, createKbRag } from './kbRagService'
import { getReferenceService, resolveReferenceDir } from './referencePackageService'

export type KbRagInstance = ReturnType<typeof createKbRag>

const REFERENCE_ALIAS = 'ai-reference'
const KNOWLEDGE_ALIAS = 'knowledge'
/** 参考包顶层文档（system prompt / 能力清单）：不在 manifest.templates 里，单独补入 */
const REFERENCE_TOP_DOCS = ['system_prompt_base.md', 'kunyu_capabilities.md']

/** A3：embedding 模型缓存根目录（xenova env.cacheDir），预置流水线与 RAG 共用 */
export function kbModelsDir(): string {
  return join(app.getPath('userData'), 'ai', 'kb-rag', 'models')
}

/**
 * 按 manifest 活跃组合精确挑语料；失败返回 null（服务内部回退 roots 目录遍历）。
 * knowledge 语料目录小且平铺，直接遍历拼入同一清单。
 */
function listManifestFiles(): Array<{ alias: string; file: string }> | null {
  try {
    const manifest = getReferenceService().getManifest()
    if (!manifest) return null
    const dir = resolveReferenceDir()
    const out: Array<{ alias: string; file: string }> = manifest.templates.map((t) => ({
      alias: REFERENCE_ALIAS,
      file: join(dir, t.file)
    }))
    for (const doc of REFERENCE_TOP_DOCS) {
      const abs = join(dir, doc)
      if (existsSync(abs)) out.push({ alias: REFERENCE_ALIAS, file: abs })
    }
    out.push(...collectCorpusFiles([{ alias: KNOWLEDGE_ALIAS, dir: defaultKnowledgeRoot() }]))
    return out
  } catch {
    return null
  }
}

let singleton: KbRagInstance | null = null
let creating: Promise<KbRagInstance | null> | null = null

/** 获取 RAG 单例（懒创建）；初始化失败返回 null，由工具层走软失败文案。 */
export function getKbRag(): Promise<KbRagInstance | null> {
  if (singleton) return Promise.resolve(singleton)
  if (creating) return creating
  creating = (async () => {
    try {
      const userData = app.getPath('userData')
      singleton = createKbRag({
        roots: [
          { alias: REFERENCE_ALIAS, dir: resolveReferenceDir() },
          { alias: KNOWLEDGE_ALIAS, dir: defaultKnowledgeRoot() }
        ],
        listFiles: listManifestFiles,
        // 二进制向量缓存（旧 embeddings.json 首次启动自动迁移并删除）
        cachePath: join(userData, 'ai', 'kb-rag', 'embeddings.bin'),
        modelsDir: kbModelsDir(),
        watch: true
      })
      return singleton
    } catch (e) {
      console.warn('[kb-rag] 初始化失败：', (e as Error).message)
      return null
    } finally {
      creating = null
    }
  })()
  return creating
}

/** A3：当前 kbRag 离线路由状态（同步，用于 UI 状态圆点与模型列表） */
export function getKbBackend(): EmbedBackend {
  if (!singleton && !creating) return 'idle'
  if (!singleton && creating) return 'downloading'
  return singleton!.status().backend
}

/** 判断 kbRag 是否已就绪（同步，用于门控：未就绪时绝不调用 getKbRag 触发懒加载） */
export function isKbRagReady(): boolean {
  return !!singleton && singleton.status().ready
}
