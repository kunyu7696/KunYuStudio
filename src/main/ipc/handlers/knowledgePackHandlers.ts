/**
 * 知识库 IPC：语料指纹一致性/过期状态（纯本地扫描，不发网络请求）；
 * kbRag 向量索引状态面板与手动重建。
 */
import { ipcMain } from 'electron'
import { IpcChannels } from '../../../shared/types/ipc'
import type { KnowledgePackStatus } from '../../../shared/types/ai'
import type { KbRagStatus } from '../../../shared/types/models'
import { getKnowledgePackStatus } from '../../services/knowledgePackService'
import { getKbRag } from '../../services/ai/kbRagSingleton'

export function registerKnowledgePackHandlers(): void {
  ipcMain.handle(
    IpcChannels.KNOWLEDGE_PACK_STATUS,
    // autoRefresh：语料增减/改动后自动重写指纹清单，免手工跑脚本；
    // 打包环境资源只读时写入失败，仍如实返回 drifted 供用户判断。
    (): KnowledgePackStatus => getKnowledgePackStatus(undefined, Date.now(), { autoRefresh: true })
  )

  // 索引状态查询：getKbRag 只建单例（扫语料纯文件 IO），不触发模型懒加载
  ipcMain.handle(IpcChannels.KB_RAG_STATUS, async (): Promise<KbRagStatus | null> => {
    const rag = await getKbRag()
    return rag ? rag.status() : null
  })

  // 重建索引：清缓存全量重编码（会触发模型下载/加载，属用户显式动作）
  ipcMain.handle(
    IpcChannels.KB_RAG_REBUILD,
    async (): Promise<{ ok: true; result: KbRagStatus } | { ok: false; errorMessage: string }> => {
      const rag = await getKbRag()
      if (!rag) return { ok: false as const, errorMessage: '知识库初始化失败' }
      try {
        await rag.rebuild()
        return { ok: true as const, result: rag.status() }
      } catch (err) {
        return { ok: false as const, errorMessage: (err as Error).message }
      }
    }
  )
}
