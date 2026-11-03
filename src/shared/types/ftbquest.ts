/**
 * FTB 任务书（FTB Quests）共享类型。
 *
 * 对应项目内 config/ftbquests/quests/chapters/<章节id>.snbt（SNBT：无引号键 NBT 文本）。
 * SNBT 里每个 quest 有 x / y 整数坐标，FTB Quests 在 MC 内用这些坐标布置画布节点；
 * 本工具完整透传这些字段，支持拖拽连线画布（FtbQuestCanvas）实时编辑。
 */

/** 单个任务（item 提交类型） */
export interface FtbQuest {
  /** 任务 id（章节内唯一，snake_case 推荐） */
  id: string
  /** 展示名（中文可） */
  title: string
  /** 任务描述行（可空） */
  description: string[]
  /** 前置任务 id 列表（画布连线 + 保存时回写） */
  dependencies: string[]
  /** 提交物品 id（如 minecraft:oak_log） */
  item: string
  /** 奖励（可空） */
  reward?: { item: string; count: number }
  /** 画布 X 坐标（FTB Quests SNBT 里是整数像素；画布组件用） */
  x?: number
  /** 画布 Y 坐标 */
  y?: number
}

/** 画布节点尺寸常量（与 FtbQuestCanvas.vue 对齐） */
export const FTB_QUEST_NODE_W = 180
export const FTB_QUEST_NODE_H = 88

/** 章节（一个 .snbt 文件） */
export interface FtbQuestChapter {
  /** 章节 id（文件名主干，snake_case） */
  id: string
  /** 章节展示名 */
  title: string
  /** 图标物品 id */
  icon: string
  quests: FtbQuest[]
}

/** 章节列表项（列表页用，不含任务明细） */
export interface FtbQuestChapterSummary {
  id: string
  title: string
  icon: string
  questCount: number
}

/** 章节列表结果：无法解析的文件不静默丢弃，记入 warnings 提示用户 */
export interface FtbQuestListResult {
  chapters: FtbQuestChapterSummary[]
  /** 人类可读的解析失败提示（一行一条） */
  warnings: string[]
}
