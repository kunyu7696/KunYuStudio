/**
 * 全局事件总线（设计文档 9.2.3）
 * 模块之间不直接互相引用，通过事件总线解耦通信。
 */
export type EventHandler = (payload?: unknown) => void

class EventBus {
  private channels = new Map<string, Set<EventHandler>>()

  on(event: string, handler: EventHandler): () => void {
    let set = this.channels.get(event)
    if (!set) {
      set = new Set()
      this.channels.set(event, set)
    }
    set.add(handler)
    return () => this.off(event, handler)
  }

  once(event: string, handler: EventHandler): void {
    const off = this.on(event, (payload) => {
      off()
      handler(payload)
    })
  }

  off(event: string, handler: EventHandler): void {
    this.channels.get(event)?.delete(handler)
  }

  emit(event: string, payload?: unknown): void {
    this.channels.get(event)?.forEach((handler) => handler(payload))
  }

  clear(): void {
    this.channels.clear()
  }
}

export const eventBus = new EventBus()
