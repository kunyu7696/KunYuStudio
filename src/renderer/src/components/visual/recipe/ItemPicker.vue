<template>
  <el-dialog
    :model-value="modelValue"
    :title="t('itemPicker.title')"
    width="560px"
    align-center
    append-to-body
    destroy-on-close
    @update:model-value="onClose"
  >
    <el-input
      v-model="query"
      :placeholder="t('itemPicker.searchPlaceholder')"
      clearable
      size="small"
      class="picker-search"
    >
      <template #prefix>
        <el-icon><Search /></el-icon>
      </template>
    </el-input>

    <!-- 自定义物品输入 -->
    <div class="picker-custom">
      <el-input
        v-model="customId"
        :placeholder="t('itemPicker.customPlaceholder')"
        size="small"
        clearable
        @keyup.enter="selectCustom"
      >
        <template #append>
          <el-button :disabled="!customId.trim()" @click="selectCustom">{{ t('itemPicker.add') }}</el-button>
        </template>
      </el-input>
      <span class="picker-custom-hint">{{ t('itemPicker.customHint') }}</span>
    </div>

    <!-- 分类标签 -->
    <div class="picker-cats">
      <el-tag
        v-for="cat in categories"
        :key="cat"
        :effect="activeCat === cat ? 'dark' : 'plain'"
        :class="{ 'picker-cat-active': activeCat === cat }"
        size="small"
        @click="activeCat = cat"
      >
        {{ catText(cat) }}
      </el-tag>
    </div>

    <div class="picker-grid">
      <button
        v-for="it in filteredItems"
        :key="it.id"
        class="picker-item"
        :class="{ 'picker-item-custom': it.custom }"
        :title="it.id"
        @click="select(it)"
      >
        <span class="picker-item-icon">
          <img
            v-for="(url, i) in resolveIconCandidates(it)"
            :key="url"
            :src="url"
            :alt="it.label"
            draggable="false"
            class="picker-item-img"
            :style="i === 0 ? {} : 'display:none'"
            @error="(e: Event) => {
              const img = e.target as HTMLImageElement;
              img.style.display = 'none';
              // 显示下一张；已经是最后一张则全部隐藏（回退到 initials）
              const next = img.nextElementSibling as HTMLImageElement | null;
              if (next) next.style.display = '';
            }"
          />
          <span v-if="resolveIconCandidates(it).length === 0" class="picker-item-initials">{{ initialsOf(it.id) }}</span>
        </span>
        <span class="picker-item-body">
          <span class="picker-item-label">{{ it.label }}</span>
          <span class="picker-item-id">{{ it.id }}</span>
        </span>
      </button>
      <p v-if="filteredItems.length === 0" class="picker-empty">{{ t('itemPicker.empty') }}</p>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { Search } from '@element-plus/icons-vue'
import { locale, t } from '../../../i18n'

interface ItemEntry {
  id: string
  label: string
  category: string
  custom?: boolean
  icon?: string
}

/** MC 原版物品 CDN 基础 URL（1.20.1） */
const MC_CDN = 'https://assets.mcasset.cloud/1.20.1/assets/minecraft/textures'

/** 为一个物品生成多个候选贴图 URL（按优先级） */
function buildItemIconCandidates(id: string): string[] {
  const [ns, name] = id.split(':')
  if (ns !== 'minecraft' || !name) return []
  // 先试 textures/item/（普通物品），再试 textures/block/（方块在物品栏显示的贴图）
  return [`${MC_CDN}/item/${name}.png`, `${MC_CDN}/block/${name}.png`]
}

/** 构建所有候选图标 URL */
function resolveIconCandidates(it: ItemEntry): string[] {
  if (it.icon) return [it.icon]
  if (it.custom) return []
  return buildItemIconCandidates(it.id)
}

/** 物品首字缩略图标（CDN 全失败时的回退） */
function initialsOf(id: string): string {
  const name = id.includes(':') ? id.split(':')[1] : id
  const parts = name.split('_')
  return parts.map((p) => p[0]?.toUpperCase() ?? '').slice(0, 2).join('')
}

/** 原版常用物品（约 120 个，分类覆盖主要玩法） */
const VANILLA_ITEMS: ItemEntry[] = [
  // —— 矿物 ——
  { id: 'minecraft:iron_ingot', label: '铁锭', category: '矿物' },
  { id: 'minecraft:gold_ingot', label: '金锭', category: '矿物' },
  { id: 'minecraft:diamond', label: '钻石', category: '矿物' },
  { id: 'minecraft:emerald', label: '绿宝石', category: '矿物' },
  { id: 'minecraft:lapis_lazuli', label: '青金石', category: '矿物' },
  { id: 'minecraft:redstone', label: '红石', category: '矿物' },
  { id: 'minecraft:coal', label: '煤炭', category: '矿物' },
  { id: 'minecraft:copper_ingot', label: '铜锭', category: '矿物' },
  { id: 'minecraft:netherite_ingot', label: '下界合金锭', category: '矿物' },
  { id: 'minecraft:quartz', label: '下界石英', category: '矿物' },
  { id: 'minecraft:amethyst_shard', label: '紫水晶碎片', category: '矿物' },
  { id: 'minecraft:prismarine_crystals', label: '海晶碎片', category: '矿物' },
  { id: 'minecraft:prismarine_shard', label: '海晶晶簇', category: '矿物' },

  // —— 矿石方块 ——
  { id: 'minecraft:iron_ore', label: '铁矿石', category: '矿石' },
  { id: 'minecraft:gold_ore', label: '金矿石', category: '矿石' },
  { id: 'minecraft:diamond_ore', label: '钻石矿石', category: '矿石' },
  { id: 'minecraft:coal_ore', label: '煤矿石', category: '矿石' },
  { id: 'minecraft:copper_ore', label: '铜矿石', category: '矿石' },
  { id: 'minecraft:redstone_ore', label: '红石矿石', category: '矿石' },
  { id: 'minecraft:lapis_ore', label: '青金石矿石', category: '矿石' },
  { id: 'minecraft:emerald_ore', label: '绿宝石矿石', category: '矿石' },
  { id: 'minecraft:nether_gold_ore', label: '下界金矿石', category: '矿石' },
  { id: 'minecraft:nether_quartz_ore', label: '下界石英矿石', category: '矿石' },
  { id: 'minecraft:deepslate_iron_ore', label: '深板岩铁矿石', category: '矿石' },
  { id: 'minecraft:deepslate_gold_ore', label: '深板岩金矿石', category: '矿石' },
  { id: 'minecraft:deepslate_diamond_ore', label: '深板岩钻石矿石', category: '矿石' },
  { id: 'minecraft:deepslate_coal_ore', label: '深板岩煤矿石', category: '矿石' },
  { id: 'minecraft:deepslate_redstone_ore', label: '深板岩红石矿石', category: '矿石' },
  { id: 'minecraft:deepslate_emerald_ore', label: '深板岩绿宝石矿石', category: '矿石' },

  // —— 基础材料 ——
  { id: 'minecraft:stick', label: '木棍', category: '基础' },
  { id: 'minecraft:string', label: '线', category: '基础' },
  { id: 'minecraft:leather', label: '皮革', category: '基础' },
  { id: 'minecraft:feather', label: '羽毛', category: '基础' },
  { id: 'minecraft:flint', label: '燧石', category: '基础' },
  { id: 'minecraft:iron_nugget', label: '铁粒', category: '基础' },
  { id: 'minecraft:gold_nugget', label: '金粒', category: '基础' },
  { id: 'minecraft:paper', label: '纸', category: '基础' },
  { id: 'minecraft:book', label: '书', category: '基础' },
  { id: 'minecraft:slime_ball', label: '黏液球', category: '基础' },
  { id: 'minecraft:blaze_rod', label: '烈焰棒', category: '基础' },
  { id: 'minecraft:blaze_powder', label: '烈焰粉', category: '基础' },
  { id: 'minecraft:ghast_tear', label: '恶魂之泪', category: '基础' },
  { id: 'minecraft:nether_star', label: '下界之星', category: '基础' },
  { id: 'minecraft:ender_pearl', label: '末影珍珠', category: '基础' },
  { id: 'minecraft:chorus_fruit', label: '紫颂果', category: '基础' },
  { id: 'minecraft:shulker_shell', label: '潜影壳', category: '基础' },
  { id: 'minecraft:heart_of_the_sea', label: '海洋之心', category: '基础' },
  { id: 'minecraft:nautilus_shell', label: '鹦鹉螺壳', category: '基础' },
  { id: 'minecraft:phantom_membrane', label: '幻翼膜', category: '基础' },
  { id: 'minecraft:rabbit_foot', label: '兔子脚', category: '基础' },
  { id: 'minecraft:spider_eye', label: '蜘蛛眼', category: '基础' },
  { id: 'minecraft:fermented_spider_eye', label: '发酵蜘蛛眼', category: '基础' },
  { id: 'minecraft:glowstone_dust', label: '荧石粉', category: '基础' },
  { id: 'minecraft:gunpowder', label: '火药', category: '基础' },
  { id: 'minecraft:sugar', label: '糖', category: '基础' },

  // —— 食物 ——
  { id: 'minecraft:apple', label: '苹果', category: '食物' },
  { id: 'minecraft:golden_apple', label: '金苹果', category: '食物' },
  { id: 'minecraft:enchanted_golden_apple', label: '附魔金苹果', category: '食物' },
  { id: 'minecraft:bread', label: '面包', category: '食物' },
  { id: 'minecraft:cooked_porkchop', label: '熟猪排', category: '食物' },
  { id: 'minecraft:cooked_beef', label: '熟牛排', category: '食物' },
  { id: 'minecraft:cooked_chicken', label: '熟鸡肉', category: '食物' },
  { id: 'minecraft:cooked_mutton', label: '熟羊肉', category: '食物' },
  { id: 'minecraft:cooked_cod', label: '熟鳕鱼', category: '食物' },
  { id: 'minecraft:cooked_salmon', label: '熟鲑鱼', category: '食物' },
  { id: 'minecraft:egg', label: '鸡蛋', category: '食物' },
  { id: 'minecraft:milk_bucket', label: '牛奶桶', category: '食物' },
  { id: 'minecraft:wheat', label: '小麦', category: '食物' },
  { id: 'minecraft:carrot', label: '胡萝卜', category: '食物' },
  { id: 'minecraft:potato', label: '马铃薯', category: '食物' },
  { id: 'minecraft:baked_potato', label: '烤马铃薯', category: '食物' },
  { id: 'minecraft:beetroot', label: '甜菜根', category: '食物' },
  { id: 'minecraft:melon_slice', label: '西瓜片', category: '食物' },
  { id: 'minecraft:honeycomb', label: '蜂巢', category: '食物' },
  { id: 'minecraft:honey_bottle', label: '蜂蜜瓶', category: '食物' },
  { id: 'minecraft:cookie', label: '曲奇', category: '食物' },
  { id: 'minecraft:cake', label: '蛋糕', category: '食物' },
  { id: 'minecraft:bowl', label: '碗', category: '食物' },
  { id: 'minecraft:mushroom_stew', label: '蘑菇汤', category: '食物' },
  { id: 'minecraft:rabbit_stew', label: '兔肉煲', category: '食物' },

  // —— 工具 ——
  { id: 'minecraft:iron_pickaxe', label: '铁镐', category: '工具' },
  { id: 'minecraft:iron_sword', label: '铁剑', category: '工具' },
  { id: 'minecraft:iron_axe', label: '铁斧', category: '工具' },
  { id: 'minecraft:iron_shovel', label: '铁铲', category: '工具' },
  { id: 'minecraft:iron_hoe', label: '铁锄', category: '工具' },
  { id: 'minecraft:diamond_pickaxe', label: '钻石镐', category: '工具' },
  { id: 'minecraft:diamond_sword', label: '钻石剑', category: '工具' },
  { id: 'minecraft:diamond_axe', label: '钻石斧', category: '工具' },
  { id: 'minecraft:diamond_shovel', label: '钻石铲', category: '工具' },
  { id: 'minecraft:diamond_hoe', label: '钻石锄', category: '工具' },
  { id: 'minecraft:netherite_pickaxe', label: '下界合金镐', category: '工具' },
  { id: 'minecraft:netherite_sword', label: '下界合金剑', category: '工具' },
  { id: 'minecraft:netherite_axe', label: '下界合金斧', category: '工具' },
  { id: 'minecraft:bow', label: '弓', category: '工具' },
  { id: 'minecraft:crossbow', label: '弩', category: '工具' },
  { id: 'minecraft:arrow', label: '箭', category: '工具' },
  { id: 'minecraft:torch', label: '火把', category: '工具' },
  { id: 'minecraft:flint_and_steel', label: '打火石', category: '工具' },
  { id: 'minecraft:bucket', label: '桶', category: '工具' },
  { id: 'minecraft:compass', label: '指南针', category: '工具' },
  { id: 'minecraft:clock', label: '时钟', category: '工具' },
  { id: 'minecraft:spyglass', label: '望远镜', category: '工具' },
  { id: 'minecraft:shield', label: '盾牌', category: '工具' },
  { id: 'minecraft:elytra', label: '鞘翅', category: '工具' },
  { id: 'minecraft:fishing_rod', label: '钓鱼竿', category: '工具' },
  { id: 'minecraft:carrot_on_a_stick', label: '胡萝卜钓竿', category: '工具' },
  { id: 'minecraft:warped_fungus_on_a_stick', label: '诡异菌钓竿', category: '工具' },

  // —— 方块 ——
  { id: 'minecraft:cobblestone', label: '圆石', category: '方块' },
  { id: 'minecraft:stone', label: '石头', category: '方块' },
  { id: 'minecraft:diorite', label: '闪长岩', category: '方块' },
  { id: 'minecraft:andesite', label: '安山岩', category: '方块' },
  { id: 'minecraft:granite', label: '花岗岩', category: '方块' },
  { id: 'minecraft:deepslate', label: '深板岩', category: '方块' },
  { id: 'minecraft:tuff', label: '凝灰岩', category: '方块' },
  { id: 'minecraft:calcite', label: '方解石', category: '方块' },
  { id: 'minecraft:dripstone_block', label: '滴水石方块', category: '方块' },
  { id: 'minecraft:mossy_cobblestone', label: '苔藓圆石', category: '方块' },
  { id: 'minecraft:planks', label: '木板', category: '方块' },
  { id: 'minecraft:oak_log', label: '橡木原木', category: '方块' },
  { id: 'minecraft:birch_log', label: '白桦原木', category: '方块' },
  { id: 'minecraft:spruce_log', label: '云杉原木', category: '方块' },
  { id: 'minecraft:jungle_log', label: '丛林原木', category: '方块' },
  { id: 'minecraft:acacia_log', label: '金合欢原木', category: '方块' },
  { id: 'minecraft:cherry_log', label: '樱花原木', category: '方块' },
  { id: 'minecraft:stone_bricks', label: '石砖', category: '方块' },
  { id: 'minecraft:bricks', label: '砖块', category: '方块' },
  { id: 'minecraft:nether_bricks', label: '下界砖', category: '方块' },
  { id: 'minecraft:red_nether_bricks', label: '红色下界砖', category: '方块' },
  { id: 'minecraft:end_stone_bricks', label: '末地石砖', category: '方块' },
  { id: 'minecraft:prismarine_bricks', label: '海晶石砖', category: '方块' },
  { id: 'minecraft:dark_prismarine', label: '暗海晶石', category: '方块' },
  { id: 'minecraft:purpur_block', label: '紫珀块', category: '方块' },
  { id: 'minecraft:tnt', label: 'TNT', category: '方块' },
  { id: 'minecraft:obsidian', label: '黑曜石', category: '方块' },
  { id: 'minecraft:crying_obsidian', label: '哭泣的黑曜石', category: '方块' },
  { id: 'minecraft:glowstone', label: '荧石', category: '方块' },
  { id: 'minecraft:sea_lantern', label: '海晶灯', category: '方块' },
  { id: 'minecraft:shroomlight', label: '菌光体', category: '方块' },
  { id: 'minecraft:jack_o_lantern', label: '南瓜灯', category: '方块' },
  { id: 'minecraft:magma_block', label: '岩浆块', category: '方块' },
  { id: 'minecraft:soul_lantern', label: '灵魂灯笼', category: '方块' },
  { id: 'minecraft:redstone_block', label: '红石块', category: '方块' },
  { id: 'minecraft:iron_block', label: '铁块', category: '方块' },
  { id: 'minecraft:gold_block', label: '金块', category: '方块' },
  { id: 'minecraft:diamond_block', label: '钻石块', category: '方块' },
  { id: 'minecraft:emerald_block', label: '绿宝石块', category: '方块' },
  { id: 'minecraft:lapis_block', label: '青金石块', category: '方块' },
  { id: 'minecraft:netherite_block', label: '下界合金块', category: '方块' },
  { id: 'minecraft:copper_block', label: '铜块', category: '方块' },
  { id: 'minecraft:cut_copper', label: '切制铜块', category: '方块' },
  { id: 'minecraft:oxidized_cut_copper', label: '氧化切制铜块', category: '方块' },

  // —— 功能方块 ——
  { id: 'minecraft:crafting_table', label: '工作台', category: '功能' },
  { id: 'minecraft:furnace', label: '熔炉', category: '功能' },
  { id: 'minecraft:chest', label: '箱子', category: '功能' },
  { id: 'minecraft:barrel', label: '木桶', category: '功能' },
  { id: 'minecraft:ender_chest', label: '末影箱', category: '功能' },
  { id: 'minecraft:shulker_box', label: '潜影盒', category: '功能' },
  { id: 'minecraft:hopper', label: '漏斗', category: '功能' },
  { id: 'minecraft:dispenser', label: '发射器', category: '功能' },
  { id: 'minecraft:dropper', label: '投掷器', category: '功能' },
  { id: 'minecraft:repeater', label: '红石中继器', category: '功能' },
  { id: 'minecraft:comparator', label: '红石比较器', category: '功能' },
  { id: 'minecraft:piston', label: '活塞', category: '功能' },
  { id: 'minecraft:sticky_piston', label: '黏性活塞', category: '功能' },
  { id: 'minecraft:observer', label: '观察者', category: '功能' },
  { id: 'minecraft:daylight_detector', label: '阳光检测器', category: '功能' },
  { id: 'minecraft:cauldron', label: '炼药锅', category: '功能' },
  { id: 'minecraft:brewing_stand', label: '酿造台', category: '功能' },
  { id: 'minecraft:anvil', label: '铁砧', category: '功能' },
  { id: 'minecraft:chiseled_bookshelf', label: '雕纹书架', category: '功能' },
  { id: 'minecraft:loom', label: '织布机', category: '功能' },
  { id: 'minecraft:cartography_table', label: '制图台', category: '功能' },
  { id: 'minecraft:smithing_table', label: '锻造台', category: '功能' },
  { id: 'minecraft:fletching_table', label: '制箭台', category: '功能' },
  { id: 'minecraft:stonecutter', label: '切石机', category: '功能' },
  { id: 'minecraft:grindstone', label: '砂轮', category: '功能' },
  { id: 'minecraft:lectern', label: '讲台', category: '功能' },
  { id: 'minecraft:bell', label: '钟', category: '功能' },
  { id: 'minecraft:beacon', label: '信标', category: '功能' },
  { id: 'minecraft:conduit', label: '潮涌核心', category: '功能' },
  { id: 'minecraft:end_portal_frame', label: '末地传送门框架', category: '功能' },
  { id: 'minecraft:nether_portal', label: '下界传送门', category: '功能' },

  // —— 农业 ——
  { id: 'minecraft:wheat_seeds', label: '小麦种子', category: '农业' },
  { id: 'minecraft:carrot', label: '胡萝卜', category: '农业' },
  { id: 'minecraft:potato', label: '马铃薯', category: '农业' },
  { id: 'minecraft:beetroot_seeds', label: '甜菜种子', category: '农业' },
  { id: 'minecraft:melon_seeds', label: '西瓜种子', category: '农业' },
  { id: 'minecraft:pumpkin_seeds', label: '南瓜种子', category: '农业' },
  { id: 'minecraft:bone_meal', label: '骨粉', category: '农业' },
  { id: 'minecraft:egg', label: '鸡蛋', category: '农业' },
  { id: 'minecraft:lead', label: '拴绳', category: '农业' },
  { id: 'minecraft:name_tag', label: '命名牌', category: '农业' },
  { id: 'minecraft:shears', label: '剪刀', category: '农业' },
  { id: 'minecraft:bucket', label: '桶', category: '农业' },

  // —— 药水/附魔 ——
  { id: 'minecraft:blaze_powder', label: '烈焰粉', category: '药水' },
  { id: 'minecraft:nether_wart', label: '下界疣', category: '药水' },
  { id: 'minecraft:glistering_melon_slice', label: '闪烁的西瓜片', category: '药水' },
  { id: 'minecraft:golden_carrot', label: '金胡萝卜', category: '药水' },
  { id: 'minecraft:magma_cream', label: '岩浆膏', category: '药水' },
  { id: 'minecraft:eye_of_spider', label: '蛛眼', category: '药水' },
  { id: 'minecraft:ghast_tear', label: '恶魂之泪', category: '药水' },
  { id: 'minecraft:redstone', label: '红石粉', category: '药水' },
  { id: 'minecraft:glowstone_dust', label: '荧石粉', category: '药水' },
  { id: 'minecraft:sugar', label: '糖', category: '药水' },
  { id: 'minecraft:paper', label: '纸', category: '附魔' },
  { id: 'minecraft:lapis_lazuli', label: '青金石', category: '附魔' },
  { id: 'minecraft:enchanted_book', label: '附魔书', category: '附魔' },

  // —— 本模组占位 ——
  { id: ':ruby', label: '本模组·红宝石', category: '本模组' },
  { id: ':ruby_ore', label: '本模组·红宝石矿石', category: '本模组' }
]

const props = defineProps<{ modelValue: boolean; namespace?: string }>()
const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'select', itemId: string): void
}>()

/* ---- 分类本地化 ---- */
const CATEGORY_KEY: Record<string, string> = {
  矿物: 'ore',
  矿石: 'oreBlock',
  基础: 'basic',
  食物: 'food',
  工具: 'tool',
  方块: 'block',
  功能: 'functional',
  农业: 'farming',
  药水: 'potion',
  附魔: 'enchanting',
  本模组: 'thisMod',
  自定义: 'custom'
}
function catText(cn: string): string {
  const key = CATEGORY_KEY[cn]
  return key ? t(`itemPicker.cat.${key}`) : cn
}

/* ---- 物品英文名映射（按需补充；缺失时回退中文 label） ---- */
const ITEM_EN: Record<string, string> = {
  iron_ingot: 'Iron Ingot', gold_ingot: 'Gold Ingot', diamond: 'Diamond', emerald: 'Emerald',
  lapis_lazuli: 'Lapis Lazuli', redstone: 'Redstone', coal: 'Coal', copper_ingot: 'Copper Ingot',
  netherite_ingot: 'Netherite Ingot', quartz: 'Nether Quartz', amethyst_shard: 'Amethyst Shard',
  prismarine_crystals: 'Prismarine Crystals', prismarine_shard: 'Prismarine Shard',
  iron_ore: 'Iron Ore', gold_ore: 'Gold Ore', diamond_ore: 'Diamond Ore', coal_ore: 'Coal Ore',
  copper_ore: 'Copper Ore', redstone_ore: 'Redstone Ore', lapis_ore: 'Lapis Lazuli Ore',
  emerald_ore: 'Emerald Ore', nether_gold_ore: 'Nether Gold Ore', nether_quartz_ore: 'Nether Quartz Ore',
  deepslate_iron_ore: 'Deepslate Iron Ore', deepslate_gold_ore: 'Deepslate Gold Ore',
  deepslate_diamond_ore: 'Deepslate Diamond Ore', deepslate_coal_ore: 'Deepslate Coal Ore',
  deepslate_redstone_ore: 'Deepslate Redstone Ore', deepslate_emerald_ore: 'Deepslate Emerald Ore',
  stick: 'Stick', string: 'String', leather: 'Leather', feather: 'Feather', flint: 'Flint',
  iron_nugget: 'Iron Nugget', gold_nugget: 'Gold Nugget', paper: 'Paper', book: 'Book',
  slime_ball: 'Slimeball', blaze_rod: 'Blaze Rod', blaze_powder: 'Blaze Powder',
  ghast_tear: 'Ghast Tear', nether_star: 'Nether Star', ender_pearl: 'Ender Pearl',
  chorus_fruit: 'Chorus Fruit', shulker_shell: 'Shulker Shell', heart_of_the_sea: 'Heart of the Sea',
  nautilus_shell: 'Nautilus Shell', phantom_membrane: 'Phantom Membrane', rabbit_foot: "Rabbit's Foot",
  spider_eye: 'Spider Eye', fermented_spider_eye: 'Fermented Spider Eye', glowstone_dust: 'Glowstone Dust',
  gunpowder: 'Gunpowder', sugar: 'Sugar',
  apple: 'Apple', golden_apple: 'Golden Apple', enchanted_golden_apple: 'Enchanted Golden Apple',
  bread: 'Bread', cooked_porkchop: 'Cooked Porkchop', cooked_beef: 'Cooked Beef',
  cooked_chicken: 'Cooked Chicken', cooked_mutton: 'Cooked Mutton', cooked_cod: 'Cooked Cod',
  cooked_salmon: 'Cooked Salmon', egg: 'Egg', milk_bucket: 'Milk Bucket', wheat: 'Wheat',
  carrot: 'Carrot', potato: 'Potato', baked_potato: 'Baked Potato', beetroot: 'Beetroot',
  melon_slice: 'Melon Slice', honeycomb: 'Honeycomb', honey_bottle: 'Honey Bottle',
  cookie: 'Cookie', cake: 'Cake', bowl: 'Bowl', mushroom_stew: 'Mushroom Stew', rabbit_stew: 'Rabbit Stew',
  iron_pickaxe: 'Iron Pickaxe', iron_sword: 'Iron Sword', iron_axe: 'Iron Axe',
  iron_shovel: 'Iron Shovel', iron_hoe: 'Iron Hoe', diamond_pickaxe: 'Diamond Pickaxe',
  diamond_sword: 'Diamond Sword', diamond_axe: 'Diamond Axe', diamond_shovel: 'Diamond Shovel',
  diamond_hoe: 'Diamond Hoe', netherite_pickaxe: 'Netherite Pickaxe', netherite_sword: 'Netherite Sword',
  netherite_axe: 'Netherite Axe', bow: 'Bow', crossbow: 'Crossbow', arrow: 'Arrow',
  torch: 'Torch', flint_and_steel: 'Flint and Steel', bucket: 'Bucket', compass: 'Compass',
  clock: 'Clock', spyglass: 'Spyglass', shield: 'Shield', elytra: 'Elytra',
  fishing_rod: 'Fishing Rod', carrot_on_a_stick: 'Carrot on a Stick', warped_fungus_on_a_stick: 'Warped Fungus on a Stick',
  cobblestone: 'Cobblestone', stone: 'Stone', diorite: 'Diorite', andesite: 'Andesite',
  granite: 'Granite', deepslate: 'Deepslate', tuff: 'Tuff', calcite: 'Calcite',
  dripstone_block: 'Dripstone Block', mossy_cobblestone: 'Mossy Cobblestone', planks: 'Planks',
  oak_log: 'Oak Log', birch_log: 'Birch Log', spruce_log: 'Spruce Log', jungle_log: 'Jungle Log',
  acacia_log: 'Acacia Log', cherry_log: 'Cherry Log', stone_bricks: 'Stone Bricks', bricks: 'Bricks',
  nether_bricks: 'Nether Bricks', red_nether_bricks: 'Red Nether Bricks', end_stone_bricks: 'End Stone Bricks',
  prismarine_bricks: 'Prismarine Bricks', dark_prismarine: 'Dark Prismarine', purpur_block: 'Purpur Block',
  tnt: 'TNT', obsidian: 'Obsidian', crying_obsidian: 'Crying Obsidian', glowstone: 'Glowstone',
  sea_lantern: 'Sea Lantern', shroomlight: 'Shroomlight', jack_o_lantern: "Jack o'Lantern",
  magma_block: 'Magma Block', soul_lantern: 'Soul Lantern', redstone_block: 'Redstone Block',
  iron_block: 'Iron Block', gold_block: 'Gold Block', diamond_block: 'Diamond Block',
  emerald_block: 'Emerald Block', lapis_block: 'Lapis Lazuli Block', netherite_block: 'Netherite Block',
  copper_block: 'Copper Block', cut_copper: 'Cut Copper', oxidized_cut_copper: 'Oxidized Cut Copper',
  crafting_table: 'Crafting Table', furnace: 'Furnace', chest: 'Chest', barrel: 'Barrel',
  ender_chest: 'Ender Chest', shulker_box: 'Shulker Box', hopper: 'Hopper', dispenser: 'Dispenser',
  dropper: 'Dropper', repeater: 'Redstone Repeater', comparator: 'Redstone Comparator',
  piston: 'Piston', sticky_piston: 'Sticky Piston', observer: 'Observer',
  daylight_detector: 'Daylight Detector', cauldron: 'Cauldron', brewing_stand: 'Brewing Stand',
  anvil: 'Anvil', chiseled_bookshelf: 'Chiseled Bookshelf', loom: 'Loom',
  cartography_table: 'Cartography Table', smithing_table: 'Smithing Table', fletching_table: 'Fletching Table',
  stonecutter: 'Stonecutter', grindstone: 'Grindstone', lectern: 'Lectern', bell: 'Bell',
  beacon: 'Beacon', conduit: 'Conduit', end_portal_frame: 'End Portal Frame', nether_portal: 'Nether Portal',
  wheat_seeds: 'Wheat Seeds', beetroot_seeds: 'Beetroot Seeds', melon_seeds: 'Melon Seeds',
  pumpkin_seeds: 'Pumpkin Seeds', bone_meal: 'Bone Meal', lead: 'Lead', name_tag: 'Name Tag',
  shears: 'Shears', nether_wart: 'Nether Wart', glistering_melon_slice: 'Glistering Melon Slice',
  golden_carrot: 'Golden Carrot', magma_cream: 'Magma Cream', eye_of_spider: 'Spider Eye',
  enchanted_book: 'Enchanted Book',
  ruby: 'This Mod · Ruby', ruby_ore: 'This Mod · Ruby Ore'
}

/** 物品显示名：英文环境用映射，缺失/中文环境回退中文 label */
function itemLabel(it: ItemEntry): string {
  if (locale.value !== 'en-US') return it.label
  const key = it.id.includes(':') ? it.id.split(':').pop()! : it.id
  return ITEM_EN[key] ?? it.label
}

const query = ref('')
const customId = ref('')
const customItems = ref<ItemEntry[]>([])
const activeCat = ref('全部')

const categories = computed(() => {
  const cats = new Set<string>(['全部'])
  for (const it of VANILLA_ITEMS) cats.add(it.category)
  for (const it of customItems.value) cats.add(it.category)
  return [...cats]
})

/** 合并：原版 + 用户自定义（label/category 经本地化映射后用于展示与搜索） */
const allItems = computed(() =>
  [...VANILLA_ITEMS, ...customItems.value].map((it) => ({
    ...it,
    label: itemLabel(it),
    category: catText(it.category)
  }))
)

/** 「全部」的本地化标签 */
const allCategoryLabel = computed(() => catText('全部'))

const filteredItems = computed(() => {
  let list = allItems.value
  const active = activeCat.value === '全部' ? allCategoryLabel.value : catText(activeCat.value)
  if (activeCat.value !== '全部') list = list.filter((it) => it.category === active)
  const q = query.value.trim().toLowerCase()
  if (!q) return list
  return list.filter(
    (it) =>
      it.id.toLowerCase().includes(q) ||
      it.label.toLowerCase().includes(q) ||
      it.category.toLowerCase().includes(q)
  )
})

/** 规范化自定义 ID：冒号前缀补命名空间，无冒号补 minecraft */
function normalizeCustomId(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  if (trimmed.startsWith(':')) {
    const ns = props.namespace?.trim() || 'mod'
    return `${ns}${trimmed}`
  }
  if (trimmed.includes(':')) return trimmed
  return `minecraft:${trimmed}`
}

function select(it: ItemEntry): void {
  emit('select', it.id)
  emit('update:modelValue', false)
  query.value = ''
}

function selectCustom(): void {
  const raw = customId.value.trim()
  if (!raw) return
  const normalized = normalizeCustomId(raw)
  // 已在原版列表中？直接选
  const existing = allItems.value.find((it) => it.id === normalized)
  if (existing) {
    select(existing)
    customId.value = ''
    return
  }
  // 加入自定义列表
  const entry: ItemEntry = {
    id: normalized,
    label: normalized.includes(':') ? normalized.split(':').pop()! : normalized,
    category: '自定义',
    custom: true
  }
  customItems.value.push(entry)
  select(entry)
  customId.value = ''
}

function onClose(v: boolean): void {
  emit('update:modelValue', v)
  if (!v) {
    query.value = ''
    customId.value = ''
  }
}
</script>

<style scoped>
.picker-search {
  margin-bottom: 8px;
}
.picker-custom {
  margin-bottom: 8px;
}
.picker-custom-hint {
  display: block;
  font-size: 10.5px;
  color: var(--ky-text-dim);
  margin-top: 3px;
}
.picker-cats {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 8px;
}
.picker-cat-active {
  font-weight: 600;
}
.picker-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
  max-height: 340px;
  overflow-y: auto;
}
.picker-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border: 1px solid var(--ky-border);
  border-radius: 5px;
  background: rgba(127, 127, 127, 0.06);
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
  text-align: left;
}
.picker-item:hover {
  border-color: var(--ky-accent, #89b4fa);
  background: rgba(137, 180, 250, 0.08);
}
.picker-item-custom {
  border-style: dashed;
  border-color: var(--ky-accent, #89b4fa);
  background: rgba(137, 180, 250, 0.06);
}
.picker-item-icon {
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.15);
  overflow: hidden;
}
.picker-item-icon img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  image-rendering: pixelated;
}
.picker-item-initials {
  font-size: 11px;
  font-weight: 700;
  color: var(--ky-text-dim);
  letter-spacing: 0.5px;
}
.picker-item-body {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.picker-item-label {
  font-size: 12.5px;
  font-weight: 500;
  color: var(--ky-text);
}
.picker-item-id {
  font-size: 10px;
  color: var(--ky-text-dim);
  font-family: var(--ky-font-mono);
  word-break: break-all;
}
.picker-empty {
  grid-column: 1 / -1;
  text-align: center;
  font-size: 12.5px;
  color: var(--ky-text-dim);
  padding: 12px;
}
</style>
