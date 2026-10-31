<template>
  <!-- 操作区 -->
  <section class="uev-ops">
    <div class="uev-scroll">
      <!-- 注册 ID -->
      <div class="uo-block">
        <h3 class="uo-title">{{ t('unified.ops.basic') }}</h3>
        <label class="uo-field">
          <span>{{ t('unified.ops.id') }}</span>
          <input
            v-model="active.id"
            :placeholder="t('unified.ops.idPlaceholder')"
            spellcheck="false"
          />
        </label>
        <label class="uo-field">
          <span>{{ t('unified.ops.displayEn') }}</span>
          <input v-model="active.displayName.en_us" />
        </label>
        <label class="uo-field">
          <span>{{ t('unified.ops.displayZh') }}</span>
          <input v-model="active.displayName.zh_cn" />
        </label>
        <label v-if="active.type !== 'enchantment'" class="uo-field">
          <span>{{ t('unified.ops.description') }}</span>
          <input v-model="active.description" :placeholder="t('unified.ops.optional')" />
        </label>
      </div>

      <!-- Java 代码端（biome/advancement 无 Java 产物，隐藏） -->
      <div v-if="!isDatapackContent" class="uo-block">
        <h3 class="uo-title">
          <span class="uev-dot dot-java"></span>{{ t('unified.ops.javaSide') }}
        </h3>
        <template v-if="active.type !== 'enchantment'">
          <label class="uo-field">
            <span>{{ t('unified.ops.className') }}</span>
            <input v-model="active.java.className" />
          </label>
          <label class="uo-field">
            <span>{{ t('unified.ops.packageName') }}</span>
            <input v-model="active.java.packageName" />
          </label>
        </template>

        <!-- 方块属性 -->
        <template v-if="active.type === 'block'">
          <label class="uo-field">
            <span>{{ t('unified.ops.hardness') }}</span>
            <el-input-number v-model="blockProps.hardness" :min="0" :step="0.5" size="small" />
          </label>
          <label class="uo-field">
            <span>{{ t('unified.ops.resistance') }}</span>
            <el-input-number v-model="blockProps.resistance" :min="0" :step="0.5" size="small" />
          </label>
          <label class="uo-field">
            <span>{{ t('unified.ops.toolType') }}</span>
            <el-select v-model="blockProps.toolType" size="small">
              <el-option :label="t('unified.enum.hand')" value="hand" />
              <el-option :label="t('unified.enum.pickaxe')" value="pickaxe" />
              <el-option :label="t('unified.enum.shovel')" value="shovel" />
              <el-option :label="t('unified.enum.axe')" value="axe" />
              <el-option :label="t('unified.enum.hoe')" value="hoe" />
            </el-select>
          </label>
          <label class="uo-field">
            <span>{{ t('unified.ops.miningLevel') }}</span>
            <el-input-number v-model="blockProps.miningLevel" :min="0" :max="4" size="small" />
          </label>
          <label class="uo-field">
            <span>{{ t('unified.ops.lightLevel') }}</span>
            <el-input-number v-model="blockProps.lightLevel" :min="0" :max="15" size="small" />
          </label>
          <label class="uo-field uo-inline">
            <span>{{ t('unified.ops.opaque') }}</span>
            <el-switch v-model="blockProps.opaque" />
          </label>
          <label class="uo-field uo-inline">
            <span>{{ t('unified.ops.requiresTool') }}</span>
            <el-switch v-model="blockProps.requiresTool" />
          </label>
          <label class="uo-field uo-inline">
            <span>{{ t('unified.ops.hasCollision') }}</span>
            <el-switch v-model="blockProps.hasCollision" />
          </label>
        </template>

        <!-- 物品属性 -->
        <template v-else-if="active.type === 'item'">
          <label class="uo-field">
            <span>{{ t('unified.ops.itemType') }}</span>
            <el-select
              :model-value="active.java.itemType ?? 'simple'"
              size="small"
              @change="onItemTypeChange"
            >
              <el-option
                v-for="opt in itemTypeOptions"
                :key="opt.value"
                :label="enumLabel(opt.value, opt.label)"
                :value="opt.value"
              />
            </el-select>
          </label>

          <!-- 工具专属 -->
          <template v-if="itemType === 'tool' && active.java.tool">
            <label class="uo-field">
              <span>{{ t('unified.ops.toolKind') }}</span>
              <el-select v-model="active.java.tool.toolKind" size="small">
                <el-option
                  v-for="opt in toolKindOptions"
                  :key="opt.value"
                  :label="enumLabel(opt.value, opt.label)"
                  :value="opt.value"
                />
              </el-select>
            </label>
            <label class="uo-field">
              <span>{{ t('unified.ops.material') }}</span>
              <el-select v-model="active.java.tool.material" size="small">
                <el-option
                  v-for="opt in toolMaterialOptions"
                  :key="opt.value"
                  :label="enumLabel(opt.value, opt.label)"
                  :value="opt.value"
                />
              </el-select>
            </label>
            <label class="uo-field">
              <span>{{ t('unified.ops.attackBonus') }}</span>
              <el-input-number v-model="active.java.tool.attackDamage" :step="0.5" size="small" />
            </label>
            <label class="uo-field">
              <span>{{ t('unified.ops.attackSpeed') }}</span>
              <el-input-number v-model="active.java.tool.attackSpeed" :step="0.1" size="small" />
            </label>
          </template>

          <!-- 盔甲专属 -->
          <template v-else-if="itemType === 'armor' && active.java.armor">
            <label class="uo-field">
              <span>{{ t('unified.ops.armorSlot') }}</span>
              <el-select v-model="active.java.armor.slot" size="small">
                <el-option
                  v-for="opt in armorSlotOptions"
                  :key="opt.value"
                  :label="enumLabel(opt.value, opt.label)"
                  :value="opt.value"
                />
              </el-select>
            </label>
            <label class="uo-field">
              <span>{{ t('unified.ops.material') }}</span>
              <el-select v-model="active.java.armor.material" size="small">
                <el-option
                  v-for="opt in armorMaterialOptions"
                  :key="opt.value"
                  :label="enumLabel(opt.value, opt.label)"
                  :value="opt.value"
                />
              </el-select>
            </label>
            <label class="uo-field">
              <span>{{ t('unified.ops.armorProtection') }}</span>
              <el-input-number v-model="active.java.armor.protection" :min="0" size="small" />
            </label>
            <label class="uo-field">
              <span>{{ t('unified.ops.toughness') }}</span>
              <el-input-number v-model="active.java.armor.toughness" :min="0" :step="0.5" size="small" />
            </label>
          </template>

          <!-- 食物专属 -->
          <template v-else-if="itemType === 'food' && active.java.food">
            <label class="uo-field">
              <span>{{ t('unified.ops.hunger') }}</span>
              <el-input-number v-model="active.java.food.hunger" :min="1" :max="20" size="small" />
            </label>
            <label class="uo-field">
              <span>{{ t('unified.ops.saturation') }}</span>
              <el-input-number v-model="active.java.food.saturation" :min="0" :max="1" :step="0.1" size="small" />
            </label>
            <label class="uo-field uo-inline">
              <span>{{ t('unified.ops.alwaysEdible') }}</span>
              <el-switch v-model="active.java.food.alwaysEdible" />
            </label>
          </template>

          <!-- 方块物品专属 -->
          <template v-else-if="itemType === 'block_item'">
            <label class="uo-field">
              <span>{{ t('unified.ops.blockRef') }}</span>
              <input
                v-model="active.java.blockRef"
                :placeholder="t('unified.ops.blockRefPlaceholder')"
                spellcheck="false"
              />
            </label>
          </template>

          <label class="uo-field">
            <span>{{ t('unified.ops.maxCount') }}</span>
            <el-input-number v-model="itemProps.maxCount" :min="1" :max="99" size="small" />
          </label>
          <label class="uo-field">
            <span>{{ t('unified.ops.maxDamage') }}</span>
            <el-input-number v-model="itemProps.maxDamage" :min="0" size="small" />
          </label>
          <label class="uo-field">
            <span>{{ t('unified.ops.rarity') }}</span>
            <el-select v-model="itemProps.rarity" size="small">
              <el-option :label="t('unified.enum.common')" value="common" />
              <el-option :label="t('unified.enum.uncommon')" value="uncommon" />
              <el-option :label="t('unified.enum.rare')" value="rare" />
              <el-option :label="t('unified.enum.epic')" value="epic" />
            </el-select>
          </label>
          <label class="uo-field uo-inline">
            <span>{{ t('unified.ops.fireproof') }}</span>
            <el-switch v-model="itemProps.fireproof" />
          </label>
        </template>

        <!-- 实体属性 -->
        <template v-else-if="active.type === 'entity'">
          <label class="uo-field">
            <span>{{ t('unified.ops.entityType') }}</span>
            <el-select v-model="active.java.entityType" size="small">
              <el-option :label="t('unified.enum.passive')" value="passive" />
              <el-option :label="t('unified.enum.hostile')" value="hostile" />
              <el-option :label="t('unified.enum.neutral')" value="neutral" />
              <el-option :label="t('unified.enum.projectile')" value="projectile" />
            </el-select>
          </label>
          <label class="uo-field">
            <span>{{ t('unified.ops.width') }}</span>
            <el-input-number v-model="entityProps.width" :min="0" :step="0.1" size="small" />
          </label>
          <label class="uo-field">
            <span>{{ t('unified.ops.height') }}</span>
            <el-input-number v-model="entityProps.height" :min="0" :step="0.1" size="small" />
          </label>
          <label class="uo-field">
            <span>{{ t('unified.ops.maxHealth') }}</span>
            <el-input-number v-model="entityAttrs.maxHealth" :min="0" size="small" />
          </label>
          <label class="uo-field">
            <span>{{ t('unified.ops.movementSpeed') }}</span>
            <el-input-number v-model="entityAttrs.movementSpeed" :min="0" :step="0.05" size="small" />
          </label>
          <label class="uo-field">
            <span>{{ t('unified.ops.entityAttack') }}</span>
            <el-input-number v-model="entityAttrs.attackDamage" :min="0" size="small" />
          </label>
        </template>

        <!-- 附魔属性（无独立 Java 类：由生成器聚合进 ModEnchantments 或数据 JSON） -->
        <template v-else-if="active.type === 'enchantment'">
          <label class="uo-field">
            <span>{{ st('schema.enchantment.formDescEn') }}</span>
            <input v-model="enchProps.description.en_us" />
          </label>
          <label class="uo-field">
            <span>{{ st('schema.enchantment.formDescZh') }}</span>
            <input v-model="enchProps.description.zh_cn" />
          </label>
          <label class="uo-field">
            <span>{{ st('schema.enchantment.formRarity') }}</span>
            <el-select v-model="enchProps.rarity" size="small">
              <el-option
                v-for="opt in enchRarityOptions"
                :key="opt.value"
                :label="opt.label"
                :value="opt.value"
              />
            </el-select>
          </label>
          <label class="uo-field">
            <span>{{ st('schema.enchantment.formTarget') }}</span>
            <el-select v-model="enchProps.target" size="small">
              <el-option
                v-for="opt in enchTargetOptions"
                :key="opt.value"
                :label="opt.label"
                :value="opt.value"
              />
            </el-select>
          </label>
          <label class="uo-field">
            <span>{{ st('schema.enchantment.formSlots') }}</span>
            <el-select v-model="enchProps.slots" multiple size="small">
              <el-option
                v-for="opt in enchSlotOptions"
                :key="opt.value"
                :label="opt.label"
                :value="opt.value"
              />
            </el-select>
          </label>
          <label class="uo-field">
            <span>{{ st('schema.enchantment.formMaxLevel') }}</span>
            <el-input-number v-model="enchProps.maxLevel" :min="1" :max="255" size="small" />
          </label>
          <label class="uo-field uo-inline">
            <span>{{ st('schema.enchantment.formTreasure') }}</span>
            <el-switch v-model="enchProps.treasure" />
          </label>
          <label class="uo-field uo-inline">
            <span>{{ st('schema.enchantment.formCurse') }}</span>
            <el-switch v-model="enchProps.curse" />
          </label>
          <label class="uo-field">
            <span>{{ st('schema.enchantment.formMinCostBase') }}</span>
            <el-input-number v-model="enchProps.minCostBase" :min="0" size="small" />
          </label>
          <label class="uo-field">
            <span>{{ st('schema.enchantment.formMinCostPerLevel') }}</span>
            <el-input-number v-model="enchProps.minCostPerLevel" :min="0" size="small" />
          </label>
          <label class="uo-field">
            <span>{{ st('schema.enchantment.formMaxCostExtra') }}</span>
            <el-input-number v-model="enchProps.maxCostExtra" :min="0" size="small" />
          </label>
          <label class="uo-field">
            <span>{{ st('schema.enchantment.formAnvilCost') }}</span>
            <el-input-number v-model="enchProps.anvilCost" :min="0" size="small" />
          </label>
          <label class="uo-field uo-inline">
            <span>{{ t('unified.ops.damageBonus') }}</span>
            <el-switch v-model="enchDamageEnabled" />
          </label>
          <template v-if="enchProps.damageBonus">
            <label class="uo-field">
              <span>{{ t('unified.ops.damageBase') }}</span>
              <el-input-number v-model="enchProps.damageBonus.base" :min="0" :step="0.5" size="small" />
            </label>
            <label class="uo-field">
              <span>{{ t('unified.ops.damagePerLevel') }}</span>
              <el-input-number v-model="enchProps.damageBonus.perLevel" :min="0" :step="0.5" size="small" />
            </label>
          </template>
        </template>

        <label v-if="active.type !== 'enchantment'" class="uo-field">
          <span>{{ t('unified.ops.customLogic') }}</span>
          <textarea
            v-model="customLogicText"
            rows="3"
            :placeholder="t('unified.ops.customLogicPlaceholder')"
          />
        </label>
      </div>

      <!-- 资源包端（biome/advancement/enchantment 无资源产物，隐藏） -->
      <div v-if="!isDatapackContent && active.type !== 'enchantment'" class="uo-block">
        <h3 class="uo-title">
          <span class="uev-dot dot-assets"></span>{{ t('unified.ops.assetsSide') }}
        </h3>
        <label v-if="active.type === 'block'" class="uo-field">
          <span>{{ t('unified.ops.blockTexPath') }}</span>
          <input v-model="blockTexPath" placeholder="block/ruby_ore" />
        </label>
        <label v-else-if="active.type === 'item'" class="uo-field">
          <span>{{ t('unified.ops.itemTexPath') }}</span>
          <input v-model="itemTexPath" placeholder="item/ruby" />
        </label>
        <label v-else class="uo-field">
          <span>{{ t('unified.ops.entityTexPath') }}</span>
          <input v-model="entityTexPath" placeholder="entity/ruby_pig" />
        </label>

        <label v-if="active.type === 'block'" class="uo-field">
          <span>{{ t('unified.ops.modelType') }}</span>
          <el-select v-model="active.assets.model.type" size="small">
            <el-option :label="t('unified.enum.cube_all')" value="cube_all" />
            <el-option :label="t('unified.enum.cube')" value="cube" />
            <el-option :label="t('unified.enum.cross')" value="cross" />
            <el-option :label="t('unified.enum.custom')" value="custom" />
          </el-select>
        </label>
        <label v-else-if="active.type === 'item'" class="uo-field">
          <span>{{ t('unified.ops.modelParent') }}</span>
          <input v-model="itemModel.parent" />
        </label>

        <!-- 语言键 -->
        <div class="uo-lang">
          <div class="uo-lang-head">
            <span>{{ t('unified.ops.langKeys') }}</span>
            <el-button size="small" text @click="addLangKey">{{ t('unified.ops.langAdd') }}</el-button>
          </div>
          <div
            v-for="(_val, key) in active.assets.lang"
            :key="key"
            class="uo-lang-row"
          >
            <input v-model="langKeys[key]" class="uo-lang-key" />
            <input v-model="active.assets.lang[key]" class="uo-lang-val" />
            <el-icon class="uo-lang-del" @click="removeLangKey(key)"><Delete /></el-icon>
          </div>
        </div>
      </div>

      <!-- 生物群系 / 进度 / 标签：数据包文档双模式编辑（M17） -->
      <div v-if="isDatapackContent" class="uo-block">
        <h3 class="uo-title">
          <span class="uev-dot dot-data"></span>{{ t(hintKey) }}
        </h3>
        <p v-if="active.type === 'biome'" class="uo-hint">
          {{ t('unified.ops.biomeHint') }}
        </p>
        <p v-else-if="active.type === 'tag'" class="uo-hint">
          {{ t('unified.ops.tagHint') }}
        </p>
        <label v-if="active.type === 'tag'" class="uo-field">
          <span>{{ t('unified.ops.tagRegistry') }}</span>
          <el-select
            :model-value="active.data.tags?.[0]?.registry ?? 'item'"
            size="small"
            @change="onTagRegistryChange"
          >
            <el-option
              v-for="r in tagRegistryOptions"
              :key="r"
              :label="t(`unified.enum.tagRegistry.${r}`)"
              :value="r"
            />
          </el-select>
        </label>
        <PackDualEditor
          v-model:mode="dpMode"
          v-model:form-value="dpFormValue"
          v-model:form-context="dpFormContext"
          v-model:source-text="dpSourceText"
          :form="dpForm"
          language="json"
        />
      </div>

      <!-- 三端产物预览 -->
      <ProductsPreview v-if="!isDatapackContent" />
    </div>
  </section>
</template>

<script setup lang="ts">
/**
 * OpsPanel：左栏操作区（基础信息 + Java 属性 + 资源包配置 + 产物预览）。
 * 从 UnifiedEditorView 抽出，逻辑零改动。
 */
import { computed } from 'vue'
import { Delete } from '@element-plus/icons-vue'
import { useUnifiedStore } from '../../../stores/unified'
import PackDualEditor from '../../../components/pack/PackDualEditor.vue'
import ProductsPreview from './ProductsPreview.vue'
import { useDatapackEditor } from '../composables/useDatapackEditor'
import { useFieldBindings } from '../composables/useFieldBindings'
import { applyUnifiedItemType } from '../../../../../shared/schemas/unified.schema'
import {
  getItemTypeOptions,
  getToolKindOptions,
  getToolMaterialOptions,
  getArmorSlotOptions,
  getArmorMaterialOptions,
  type ItemKindType
} from '../../../../../shared/schemas/item.schema'
import {
  ENCHANTMENT_RARITIES,
  ENCHANTMENT_TARGETS,
  ENCHANTMENT_SLOTS,
  type EnchantmentRarity,
  type EnchantmentItemTarget,
  type EnchantmentSlot
} from '../../../../../shared/schemas/enchantment.schema'
import { t, te, locale, st } from '../../../i18n'
import { TAG_REGISTRY_KINDS, type TagRegistryKind } from '../../../../../shared/dataPath'

/** 枚举文案走语言包，缺失时回落共享 schema 里的中文原名（新增枚举值不受影响） */
function enumLabel(value: string, label: string): string {
  const key = `unified.enum.${value}`
  return te(key) ? t(key) : label
}

const store = useUnifiedStore()

/** 选项随语言切换重建（共享 schema 冻结常量为 zh-CN，这里按当前语言取） */
const itemTypeOptions = computed(() => getItemTypeOptions(locale.value))
const toolKindOptions = computed(() => getToolKindOptions(locale.value))
const toolMaterialOptions = computed(() => getToolMaterialOptions(locale.value))
const armorSlotOptions = computed(() => getArmorSlotOptions(locale.value))
const armorMaterialOptions = computed(() => getArmorMaterialOptions(locale.value))

/* ---- 附魔枚举选项：文案复用共享 schema.enchantment.*（st 随语言切换重算） ---- */
const ENCH_RARITY_KEY: Record<EnchantmentRarity, string> = {
  COMMON: 'schema.enchantment.rarityCommon',
  UNCOMMON: 'schema.enchantment.rarityUncommon',
  RARE: 'schema.enchantment.rarityRare',
  VERY_RARE: 'schema.enchantment.rarityVeryRare'
}
const ENCH_TARGET_KEY: Record<EnchantmentItemTarget, string> = {
  ALL: 'schema.enchantment.targetAll',
  ARMOR: 'schema.enchantment.targetArmor',
  ARMOR_FEET: 'schema.enchantment.targetArmorFeet',
  ARMOR_LEGS: 'schema.enchantment.targetArmorLegs',
  ARMOR_CHEST: 'schema.enchantment.targetArmorChest',
  ARMOR_HEAD: 'schema.enchantment.targetArmorHead',
  WEAPON: 'schema.enchantment.targetWeapon',
  TOOL: 'schema.enchantment.targetTool',
  BOW: 'schema.enchantment.targetBow',
  CROSSBOW: 'schema.enchantment.targetCrossbow',
  TRIDENT: 'schema.enchantment.targetTrident',
  FISHING_ROD: 'schema.enchantment.targetFishingRod',
  WEARABLE: 'schema.enchantment.targetWearable',
  BREAKABLE: 'schema.enchantment.targetBreakable',
  VANISHABLE: 'schema.enchantment.targetVanishable'
}
const ENCH_SLOT_KEY: Record<EnchantmentSlot, string> = {
  mainhand: 'schema.enchantment.slotMainhand',
  offhand: 'schema.enchantment.slotOffhand',
  head: 'schema.enchantment.slotHead',
  chest: 'schema.enchantment.slotChest',
  legs: 'schema.enchantment.slotLegs',
  feet: 'schema.enchantment.slotFeet'
}
const enchRarityOptions = computed(() =>
  ENCHANTMENT_RARITIES.map((r) => ({ value: r, label: st(ENCH_RARITY_KEY[r]) }))
)
const enchTargetOptions = computed(() =>
  ENCHANTMENT_TARGETS.map((x) => ({ value: x, label: st(ENCH_TARGET_KEY[x]) }))
)
const enchSlotOptions = computed(() =>
  ENCHANTMENT_SLOTS.map((s) => ({ value: s, label: st(ENCH_SLOT_KEY[s]) }))
)

/** 双模式编辑器状态由父视图统一持有（onSave 提交同一份），经 props 传入 */
const props = defineProps<{ dp: ReturnType<typeof useDatapackEditor> }>()
const { isDatapackContent, dpForm, dpMode, dpFormValue, dpFormContext, dpSourceText } = props.dp
const {
  blockProps,
  itemProps,
  entityProps,
  entityAttrs,
  enchProps,
  enchDamageEnabled,
  itemModel,
  customLogicText,
  blockTexPath,
  itemTexPath,
  entityTexPath,
  langKeys,
  addLangKey,
  removeLangKey
} = useFieldBindings()

/** 本组件仅在存在活动对象时渲染（父级 v-else 保证），模板内直接取值 */
const active = computed(() => store.active!)

/** 当前物品子类型（非物品对象回落 simple，仅用于模板分支） */
const itemType = computed<ItemKindType>(() =>
  active.value.type === 'item' ? (active.value.java.itemType ?? 'simple') : 'simple'
)

/** 切换物品子类型：清空旧类型专属配置并填入默认值（语义层 applyUnifiedItemType） */
function onItemTypeChange(next: unknown): void {
  applyUnifiedItemType(active.value, next as ItemKindType)
}

/** 数据包文档块的标题键（仅 biome/advancement/tag 会渲染该块） */
const hintKey = computed<string>(() =>
  active.value.type === 'biome'
    ? 'unified.ops.biomeDefinition'
    : active.value.type === 'advancement'
      ? 'unified.ops.advancementDefinition'
      : 'unified.ops.tagDefinition'
)

const tagRegistryOptions = TAG_REGISTRY_KINDS

/** 切换标签注册表（产物目录随之改变；id 保持不变） */
function onTagRegistryChange(next: unknown): void {
  if (typeof next !== 'string') return
  if (!(TAG_REGISTRY_KINDS as readonly string[]).includes(next)) return
  const entry = active.value.data.tags?.[0]
  if (!entry) return
  entry.registry = next as TagRegistryKind
}
</script>

<style scoped>
.uev-ops {
  flex: 2;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.uev-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
}

/* 操作区分块 */
.uo-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 0;
  border-bottom: 1px solid var(--ky-border);
}
.uo-block:first-child {
  padding-top: 2px;
}
.uo-block:last-child {
  border-bottom: none;
}
.uo-title {
  margin: 0 0 2px;
  font-size: 12px;
  font-weight: 600;
  color: var(--ky-accent);
  display: flex;
  align-items: center;
  gap: 6px;
}
.uev-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  display: inline-block;
}
.dot-java { background: #5b8def; }
.dot-assets { background: #46c9a7; }
.dot-data { background: #f9c98b; }
.uo-hint {
  font-size: 11px;
  color: var(--ky-text-dim);
  margin: 0 0 8px;
  line-height: 1.5;
}
.uo-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.uo-field > span {
  font-size: 11px;
  color: var(--ky-text-sub);
}
.uo-field input,
.uo-field textarea {
  background: var(--ky-bg);
  border: 1px solid var(--ky-border);
  border-radius: 6px;
  padding: 5px 9px;
  font-size: 12px;
  color: var(--ky-text);
  font-family: inherit;
}
.uo-field input:focus,
.uo-field textarea:focus {
  outline: none;
  border-color: var(--ky-accent);
}
.uo-field textarea {
  resize: vertical;
  font-family: var(--ky-mono, monospace);
  font-size: 11.5px;
}
.uo-field :deep(.el-input-number),
.uo-field :deep(.el-select) {
  width: 100%;
}
/* 开关类字段：标签与开关并排 */
.uo-inline {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}
.uo-inline > span {
  font-size: 11.5px;
}

/* 语言键 */
.uo-lang {
  margin-top: 4px;
  border-top: 1px dashed var(--ky-border);
  padding-top: 8px;
}
.uo-lang-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
  font-size: 11px;
  color: var(--ky-text-sub);
}
.uo-lang-row {
  display: flex;
  gap: 6px;
  margin-bottom: 5px;
}
.uo-lang-key {
  width: 96px;
  flex-shrink: 0;
  background: var(--ky-bg);
  border: 1px solid var(--ky-border);
  border-radius: 6px;
  padding: 3px 7px;
  font-size: 11px;
  font-family: var(--ky-mono, monospace);
  color: var(--ky-text);
}
.uo-lang-val {
  flex: 1;
  min-width: 0;
  background: var(--ky-bg);
  border: 1px solid var(--ky-border);
  border-radius: 6px;
  padding: 3px 7px;
  font-size: 11px;
  color: var(--ky-text);
}
.uo-lang-del {
  color: var(--ky-text-dim);
  cursor: pointer;
  padding: 3px;
  flex-shrink: 0;
}
.uo-lang-del:hover { color: #f38ba8; }
</style>
