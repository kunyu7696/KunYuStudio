/**
 * 功能标签库：功能 → 识别特征（mod id 精确匹配，OR 关系）。
 * R12 用它发现功能重复：同一功能标签命中 ≥2 个模组时建议保留一个。
 *
 * 仅收录模组 id（fabric.mod.json / mods.toml 的 modId，小写），
 * 因为画像集合天然以 modId 索引；包前缀特征可在需要时扩展。
 */
export interface FeatureTag {
  feature: string
  category: string
  modIds: string[]
}

export const FEATURE_TAGS: FeatureTag[] = [
  {
    feature: '渲染管线重写',
    category: '渲染',
    modIds: ['sodium', 'optifine', 'rubidium', 'embeddium', 'canvas', 'vulkanmod']
  },
  {
    feature: '光影加载',
    category: '渲染',
    modIds: ['iris', 'optifine', 'oculus']
  },
  {
    feature: '光照引擎',
    category: '性能',
    modIds: ['phosphor', 'starlight']
  },
  {
    feature: '小地图',
    category: '界面',
    modIds: ['journeymap', 'xaerominimap', 'antiqueatlas', 'map_atlases']
  },
  {
    feature: '物品与合成查询',
    category: '界面',
    modIds: ['jei', 'roughlyenoughitems', 'emi']
  },
  {
    feature: '通用服务端性能优化',
    category: '性能',
    modIds: ['lithium', 'performant']
  },
  {
    feature: '网络栈优化',
    category: '性能',
    modIds: ['krypton']
  },
  {
    feature: '内存占用优化',
    category: '性能',
    modIds: ['ferritecore', 'reduceddflang']
  },
  {
    feature: '启动加载优化',
    category: '性能',
    modIds: ['lazydfu', 'smoothboot']
  },
  {
    feature: '实体渲染剔除',
    category: '渲染',
    modIds: ['entityculling']
  },
  {
    feature: '背包整理',
    category: '界面',
    modIds: ['inventorysorter', 'inventoryprofilesnext']
  }
]
