/**
 * M12 社区搜索中→英查询桥接（纯函数，可单测）。
 *
 * 背景：Modrinth / CurseForge 的索引以英文为主，中文关键词（如"光影""小地图"
 * "钠"）直接上送几乎零召回。本模块在发请求前把中文查询翻译/扩展为英文：
 *  - 知名模组别名（钠 → Sodium）：精确指向目标模组，优先级最高
 *  - 通用术语（光影 → shaders）：按词翻译
 *  - 未收录的中文片段保留：为平台上少量带中文标题的国产模组兜底
 *
 * 匹配策略：别名 → 术语，两张表均按中文词条长度降序做最长匹配，
 * 避免"旅行地图"被短词"地图"提前截断。
 */
import type { TranslatedTerm } from '../../shared/types/market'

/** 知名模组中文别名 → 平台英文检索名（专名精确命中，最先处理） */
const ZH_MOD_ALIASES: Record<string, string> = {
  旅行地图: 'JourneyMap',
  植物魔法: 'Botania',
  神秘时代: 'Thaumcraft',
  热力膨胀: 'Thermal Expansion',
  应用能源: 'Applied Energistics',
  沉浸工程: 'Immersive Engineering',
  暮色森林: 'Twilight Forest',
  无尽贪婪: 'Avaritia',
  幸运方块: 'Lucky Block',
  星辉魔法: 'Astral Sorcery',
  血魔法: 'Blood Magic',
  等价交换: 'ProjectE',
  拔刀剑: 'SlashBlade',
  自定义史蒂夫: 'CustomSteve',
  连锁挖矿: 'veinminer',
  连锁采集: 'veinminer',
  苹果皮: 'AppleSkin',
  钠: 'Sodium',
  锂: 'Lithium',
  铯: 'Cesium',
  铟: 'Indium',
  磷: 'Phosphor',
  星光: 'Starlight',
  铁素体: 'FerriteCore',
  动态帧率: 'Dynamic FPS',
  钠扩展: 'Sodium Extra',
  连接纹理: 'Continuity',
  地毯: 'Carpet Mod',
  林业: 'Forestry',
  铁路: 'Railcraft',
  暮色: 'Twilight Forest',
  神秘: 'Thaumcraft',
  // M12 补充：社区高频模组中文名
  物品管理器: 'JEI',
  合成管理器: 'JEI',
  创世神: 'WorldEdit',
  高清修复: 'OptiFine',
  光影前置: 'Iris',
  鸢尾: 'Iris',
  模组菜单: 'Mod Menu',
  织物: 'Fabric API',
  帕秋莉: 'Patchouli',
  饰品栏: 'Curios',
  饰品: 'Curios',
  匠魂: "Tinkers Construct",
  通用机械: 'Mekanism',
  工业2: 'IndustrialCraft 2',
  星系: 'Galacticraft',
  宝可梦: 'Pixelmon',
  精灵宝可梦: 'Pixelmon',
  口袋妖怪: 'Pixelmon',
  起源: 'Origins',
  吸血鬼: 'Vampirism',
  农夫乐事: "Farmer's Delight",
  潘马斯农场: "Pam's HarvestCraft",
  潘马斯: "Pam's HarvestCraft",
  水产养殖: 'Aquaculture',
  亚历克斯的生物: "Alex's Mobs",
  冰与火之歌: 'Ice and Fire',
  虚无世界: 'Advent of Ascension',
  侏罗纪: 'JurassiCraft',
  龙珠: 'Dragon Block',
  天堂: 'Aether',
  天境: 'Aether',
  电脑: 'ComputerCraft',
  自由视角: 'Freecam',
  鼠标手势: 'Mouse Tweaks',
  铁箱子: 'Iron Chests',
  更多箱子: 'Iron Chests',
  储物抽屉: 'Storage Drawers',
  抽屉: 'Storage Drawers',
  搬箱: 'Carry On',
  按键设置: 'Controlling',
  登录验证: 'Auth Me',
  皮肤图层: '3D Skin Layers',
  声音物理: 'Sound Physics'
}

/** 通用中文术语 → 英文检索词 */
const ZH_TERMS: Record<string, string> = {
  一键整理: 'inventory sorting',
  动态光源: 'dynamic lights',
  世界生成: 'worldgen',
  资源包: 'resource pack',
  材质包: 'resource pack',
  小地图: 'minimap',
  大地图: 'world map',
  物品管理: 'item management',
  物品显示: 'tooltip',
  高亮显示: 'wthit',
  光影包: 'shaders',
  数据包: 'datapack',
  信息显示: 'hud display',
  群系: 'biomes',
  自动化: 'automation',
  传送门: 'portal',
  地形: 'terrain',
  天气: 'weather',
  季节: 'seasons',
  材质: 'textures',
  音效: 'sound',
  音乐: 'music',
  相机: 'camera',
  光影: 'shaders',
  优化: 'optimization',
  性能: 'performance',
  背包: 'inventory',
  存储: 'storage',
  箱子: 'storage',
  地图: 'map',
  物品: 'items',
  科技: 'technology',
  魔法: 'magic',
  家具: 'furniture',
  装饰: 'decoration',
  武器: 'weapons',
  盔甲: 'armor',
  工具: 'tools',
  生物: 'mobs',
  怪物: 'monsters',
  动物: 'animals',
  农业: 'farming',
  食物: 'food',
  传送: 'teleport',
  权限: 'permissions',
  经济: 'economy',
  红石: 'redstone',
  维度: 'dimension',
  地牢: 'dungeon',
  结构: 'structures',
  村民: 'villager',
  任务: 'quests',
  宠物: 'pets',
  能源: 'energy',
  管道: 'pipes',
  机器: 'machines',
  合成: 'crafting',
  飞行: 'fly',
  翅膀: 'elytra',
  载具: 'vehicles',
  矿石: 'ores',
  皮肤: 'skin',
  表情: 'emotes',
  动作: 'animation',
  语音: 'voice chat',
  物理: 'physics',
  建筑: 'building',
  字体: 'font',
  显示: 'hud display',
  // M12 补充：社区高频搜索术语
  前置: 'dependency',
  附属: 'addon',
  整合包: 'modpack',
  合成表: 'crafting recipes',
  附魔: 'enchantments',
  药水: 'potions',
  枪械: 'guns',
  刀剑: 'swords',
  盾牌: 'shield',
  联机: 'multiplayer',
  服务器: 'server',
  领地: 'claim',
  圈地: 'claim',
  商店: 'shop',
  菜单: 'menu',
  内存: 'memory',
  帧率: 'fps',
  卡顿: 'lag',
  存档: 'world save',
  种子: 'seed',
  村庄: 'village',
  下界: 'nether',
  末地: 'end',
  末影龙: 'ender dragon',
  凋零: 'wither',
  樱花: 'cherry blossom',
  竹子: 'bamboo',
  僵尸: 'zombies',
  女巫: 'witch',
  傀儡: 'golem',
  狼人: 'werewolves',
  汽车: 'cars',
  飞机: 'planes',
  火箭: 'rockets',
  太空: 'space',
  星球: 'planets',
  发电: 'power generation',
  电力: 'electricity',
  核能: 'nuclear',
  反应堆: 'reactor',
  挖矿: 'mining',
  采矿: 'mining',
  法术: 'spells',
  法杖: 'wands',
  卷轴: 'scrolls',
  祭坛: 'altar',
  符文: 'runes',
  线缆: 'cables',
  自动合成: 'autocrafting',
  养蜂: 'bees',
  蜜蜂: 'bees',
  作物: 'crops',
  烹饪: 'cooking',
  厨房: 'kitchen',
  钓鱼: 'fishing',
  繁殖: 'breeding',
  恐龙: 'dinosaurs',
  鸟类: 'birds',
  海洋: 'ocean',
  遗迹: 'ruins',
  城堡: 'castle',
  城市: 'city',
  尸体: 'corpse',
  交易: 'trading',
  路径点: 'waypoints',
  血量显示: 'health display',
  中文输入: 'chinese input',
  视角: 'perspective',
  死亡不掉落: 'keep inventory',
  宝石: 'gems',
  水晶: 'crystals',
  矿物: 'minerals',
  图腾: 'totem',
  戒指: 'rings',
  护符: 'amulet',
  酿酒: 'brewing',
  蜂蜜: 'honey',
  咖啡: 'coffee',
  茶叶: 'tea',
  家具家电: 'appliances',
  灯具: 'lighting',
  方块: 'blocks',
  电脑模组: 'computers',
  电路: 'circuits'
}

/** 翻译结果 */
export interface TranslateResult {
  /** 实际发往平台的查询串（英文优先，未收录中文保留兜底） */
  query: string
  /** 命中的中文词条（供 UI 展示"已转英文"） */
  terms: TranslatedTerm[]
  /** 词典未收录、只能原样保留的中文片段（供 UI 提示召回可能有限/建议去中文社区搜） */
  untranslated: string[]
}

/** 连续 CJK 字符检测 */
const CJK_RE = /[㐀-䶿一-鿿豈-﫿]/

/** 判断字符串是否含中文 */
export function containsChinese(text: string): boolean {
  return CJK_RE.test(text)
}

/** 按键长度降序排列词条，保证最长匹配优先 */
function sortedEntries(map: Record<string, string>): Array<[string, string]> {
  return Object.entries(map).sort((a, b) => b[0].length - a[0].length)
}

const ALIAS_ENTRIES = sortedEntries(ZH_MOD_ALIASES)
const TERM_ENTRIES = sortedEntries(ZH_TERMS)

/**
 * 把中文搜索词翻译为平台可召回的英文查询。
 * 纯英文/空串原样返回（terms 为空）；混合查询保留英文 token。
 */
export function translateZhQuery(raw: string): TranslateResult {
  const original = raw.trim()
  if (!original) return { query: '', terms: [], untranslated: [] }

  let text = original
  const terms: TranslatedTerm[] = []
  const seenEn = new Set<string>()

  const applyMap = (map: Array<[string, string]>, kind: TranslatedTerm['kind']): void => {
    for (const [zh, en] of map) {
      if (!text.includes(zh)) continue
      const enKey = en.toLowerCase()
      // 同一英文检索名只插入/记录一次
      if (!seenEn.has(enKey)) {
        seenEn.add(enKey)
        terms.push({ zh, en, kind })
        text = `${text} ${en}`
      }
      // 移除已识别的中文片段，避免短词二次命中（"旅行地图"→不再命中"地图"）
      text = text.split(zh).join(' ')
    }
  }

  // 模组专名优先，再处理通用术语
  applyMap(ALIAS_ENTRIES, 'alias')
  applyMap(TERM_ENTRIES, 'term')

  // 英文/数字 token 去重保序前置；未收录中文片段保留排到末尾兜底
  const enTokens: string[] = []
  const zhLeftovers: string[] = []
  const seenToken = new Set<string>()
  for (const tok of text.split(/\s+/).map((t) => t.trim()).filter(Boolean)) {
    const key = tok.toLowerCase()
    if (seenToken.has(key)) continue
    seenToken.add(key)
    if (containsChinese(tok)) zhLeftovers.push(tok)
    else enTokens.push(tok)
  }

  return {
    query: [...enTokens, ...zhLeftovers].join(' '),
    terms,
    untranslated: zhLeftovers
  }
}
