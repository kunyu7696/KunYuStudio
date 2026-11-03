/**
 * FancyMenu 开始菜单自定义——共享类型。
 *
 * Fabric 路径：config/fancymenu/layout.json
 * Forge  路径：config/fancymenu_forge/layout.json（旧版 fabric 也可能是 config/fancymenu/layout.json）
 *
 * FancyMenu JSON 里每个元素有 type + anchor + x/y + width/height + z 层级，
 * P1 只支持 button / image / text / rect 四种元素类型；action 只支持 command 与 url。
 */

/** 锚点枚举：元素 x/y 是相对锚点的偏移 */
export type FmAnchor =
  | 'top_left'
  | 'top_center'
  | 'top_right'
  | 'middle_left'
  | 'center'
  | 'middle_right'
  | 'bottom_left'
  | 'bottom_center'
  | 'bottom_right'

/** 点击行为：执行 MC 命令 / 打开 URL */
export interface FmAction {
  /** 'command' → 点击执行一条 MC 命令；'url' → 点击打开链接 */
  type: 'command' | 'url'
  /** command → 不带斜杠的命令体；url → http(s) 链接 */
  value: string
}

/** 元素通用字段 */
export interface FmElementBase {
  /** 元素 id（唯一，FancyMenu 内部引用用） */
  id: string
  /** 显示名（画布内标签） */
  name: string
  /** 锚点 */
  anchor: FmAnchor
  /** 相对锚点的 X 偏移（像素，允许负数） */
  x: number
  /** 相对锚点的 Y 偏移 */
  y: number
  /** 元素宽度（像素） */
  width: number
  /** 元素高度 */
  height: number
  /** 层级，越大越靠上（整数） */
  z: number
}

/** 按钮 */
export interface FmButton extends FmElementBase {
  type: 'button'
  /** 按钮文字 */
  text: string
  /** 文字颜色（#RRGGBB） */
  color?: string
  /** hover 文字颜色 */
  hoverColor?: string
  /** 按钮贴图路径（可选，覆盖默认按钮样式） */
  texture?: string
  /** 点击行为 */
  action?: FmAction
}

/** 贴图 */
export interface FmImage extends FmElementBase {
  type: 'image'
  /** 贴图资源路径（MC 资源包路径，如 'minecraft:textures/gui/title/background/panorama_0.png'） */
  url: string
}

/** 静态文字 */
export interface FmText extends FmElementBase {
  type: 'text'
  /** 文字内容（支持 \n 换行） */
  text: string
  /** 颜色（#RRGGBB） */
  color?: string
  /** 字号（像素） */
  size?: number
}

/** 矩形色块 */
export interface FmRect extends FmElementBase {
  type: 'rect'
  /** 填充颜色（#RRGGBB 或 #RRGGBBAA） */
  color: string
}

export type FmElement = FmButton | FmImage | FmText | FmRect

/** 整份菜单（layout.json 映射） */
export interface FancyMenuLayout {
  elements: FmElement[]
}

/** 读取结果（含探测到的文件路径，Fabric/Forge 差异） */
export interface FancyMenuReadResult {
  /** 实际读取的文件路径（绝对） */
  filePath: string
  /** 原始 JSON（保留未知字段回写） */
  raw: Record<string, unknown>
  /** 解析出的元素数组 */
  elements: FmElement[]
}
