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
        <label class="uo-field">
          <span>{{ t('unified.ops.description') }}</span>
          <input v-model="active.description" :placeholder="t('unified.ops.optional')" />
        </label>
      </div>

      <!-- Java 代码端（biome/advancement 无 Java 产物，隐藏） -->
      <div v-if="!isDatapackContent" class="uo-block">
        <h3 class="uo-title">
          <span class="uev-dot dot-java"></span>{{ t('unified.ops.javaSide') }}
        </h3>
        <label class="uo-field">
          <span>{{ t('unified.ops.className') }}</span>
          <input v-model="active.java.className" />
        </label>
        <label class="uo-field">
          <span>{{ t('unified.ops.packageName') }}</span>
          <input v-model="active.java.packageName" />
        </label>

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
        <template v-else>
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

        <label class="uo-field">
          <span>{{ t('unified.ops.customLogic') }}</span>
          <textarea
            v-model="customLogicText"
            rows="3"
            :placeholder="t('unified.ops.customLogicPlaceholder')"
          />
        </label>
      </div>

      <!-- 资源包端（biome/advancement 无资源产物，隐藏） -->
      <div v-if="!isDatapackContent" class="uo-block">
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

      <!-- 生物群系 / 进度：数据包文档双模式编辑（M17） -->
      <div v-if="isDatapackContent" class="uo-block">
        <h3 class="uo-title">
          <span class="uev-dot dot-data"></span>{{ t(active.type === 'biome' ? 'unified.ops.biomeDefinition' : 'unified.ops.advancementDefinition') }}
        </h3>
        <p v-if="active.type === 'biome'" class="uo-hint">
          {{ t('unified.ops.biomeHint') }}
        </p>
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
import { t, te, locale } from '../../../i18n'

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

/** 双模式编辑器状态由父视图统一持有（onSave 提交同一份），经 props 传入 */
const props = defineProps<{ dp: ReturnType<typeof useDatapackEditor> }>()
const { isDatapackContent, dpForm, dpMode, dpFormValue, dpFormContext, dpSourceText } = props.dp
const {
  blockProps,
  itemProps,
  entityProps,
  entityAttrs,
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
