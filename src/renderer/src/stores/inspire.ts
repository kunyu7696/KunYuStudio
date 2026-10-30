import { defineStore } from 'pinia'

/**
 * 灵感台素材卡片：文本 / 链接 / 图片。
 * - text：body 为正文
 * - link：body 为 http(s) URL
 * - image：body 为本地图片绝对路径（渲染时转 file://）或 http(s) URL
 */
export interface InspirePin {
  id: string
  kind: 'text' | 'link' | 'image'
  title: string
  body: string
  /** manual = 手动钉入；ai = AI 创意卡片钉入 */
  source: 'manual' | 'ai'
  createdAt: number
}

const PINS_KEY = 'kunyu:inspire-pins'
/** 钉板上限：防止 localStorage 无限膨胀，超出丢弃最旧 */
const MAX_PINS = 200

/** 读取持久化钉板；解析失败/结构不符时回退空板（不阻塞启动） */
function readPins(): InspirePin[] {
  try {
    const raw = localStorage.getItem(PINS_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (p): p is InspirePin =>
        typeof p === 'object' &&
        p !== null &&
        typeof (p as InspirePin).id === 'string' &&
        ['text', 'link', 'image'].includes((p as InspirePin).kind) &&
        typeof (p as InspirePin).body === 'string'
    )
  } catch {
    return []
  }
}

/**
 * 灵感台钉板状态：应用级（不随项目开关清空），持久化到 localStorage。
 * 卡片体量小（文本/路径/URL），localStorage 足够；图片只存路径不落二进制。
 */
export const useInspireStore = defineStore('inspire', {
  state: () => ({
    pins: readPins() as InspirePin[]
  }),

  actions: {
    persist(): void {
      localStorage.setItem(PINS_KEY, JSON.stringify(this.pins))
    },

    addPin(input: Omit<InspirePin, 'id' | 'createdAt'>): InspirePin {
      const pin: InspirePin = {
        ...input,
        id: `pin-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        createdAt: Date.now()
      }
      this.pins.unshift(pin)
      if (this.pins.length > MAX_PINS) this.pins.length = MAX_PINS
      this.persist()
      return pin
    },

    removePin(id: string): void {
      const idx = this.pins.findIndex((p) => p.id === id)
      if (idx < 0) return
      this.pins.splice(idx, 1)
      this.persist()
    },

    /** AI 创意是否已钉入（按标题判重，避免重复钉同一条创意） */
    hasAiPin(title: string): boolean {
      return this.pins.some((p) => p.source === 'ai' && p.title === title)
    }
  }
})
