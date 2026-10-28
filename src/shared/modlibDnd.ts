/**
 * Mod 库拖放协议常量（渲染层拖拽源与放置目标共用）。
 */
import type { ResourceLibraryType } from './types/modLibrary'

export const MODLIB_MIME = 'application/x-kunyu-modlib'

export interface ModlibDragPayload {
  /** Mod 库内资源文件名（add-to-project 的定位键） */
  fileName: string
  /** 资源展示名（仅诊断用） */
  name: string
  /** 资源类型（加入项目时按类型分流落盘；旧载荷缺省按 mod 处理） */
  resourceType?: ResourceLibraryType
}
