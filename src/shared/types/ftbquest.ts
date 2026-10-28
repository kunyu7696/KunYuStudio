/**
 * FTB 任务书（FTB Quests）共享类型。
 *
 * 对应项目内 config/ftbquests/quests/chapters/<章节id>.snbt（SNBT：无引号键 NBT 文本）。
 * 第一版编辑器覆盖「列表 + 表单 + 依赖展示」：任务类型固定 item（提交物品），
 * 奖励固定 item 类型；坐标/拖拽连线画布不在本版范围。
 */

/** 单个任务（item 提交类型） */
export interface FtbQuest {
  /** 任务 id（章节内唯一，snake_case 推荐） */
  id: string
  /** 展示名（中文可） */
  title: string
  /** 任务描述行（可空） */
  description: string[]
  /** 前置任务 id 列表（展示用；保存时回写） */
  dependencies: string[]
  /** 提交物品 id（如 minecraft:oak_log） */
  item: string
  /** 奖励（可空） */
  reward?: { item: string; count: number }
}

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
