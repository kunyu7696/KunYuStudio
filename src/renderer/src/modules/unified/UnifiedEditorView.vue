<template>
  <div class="uev">
    <!-- ============ 顶部：类型 Tab | 标题 | 放弃 / 保存 ============ -->
    <header class="uev-head">
      <div class="uev-head-tabs">
        <el-radio-group
          :model-value="store.active?.type ?? ''"
          size="small"
          @update:model-value="onKindTab"
        >
          <el-radio-button value="item">{{ t('unified.kind.item') }}</el-radio-button>
          <el-radio-button value="block">{{ t('unified.kind.block') }}</el-radio-button>
          <el-radio-button value="entity">{{ t('unified.kind.entity') }}</el-radio-button>
          <el-radio-button value="biome">{{ t('unified.kind.biome') }}</el-radio-button>
          <el-radio-button value="advancement">{{ t('unified.kind.advancement') }}</el-radio-button>
        </el-radio-group>
      </div>

      <div class="uev-head-main">
        <!-- 对象切换：侧栏已改为文件树，对象切换放顶部 -->
        <el-select
          :model-value="store.active?.id ?? ''"
          size="small"
          class="uev-object-select"
          :placeholder="t('unified.objectSelect')"
          @update:model-value="onSwitchObject"
        >
          <el-option-group
            v-for="grp in objectGroups"
            :key="grp.label"
            :label="grp.label"
          >
            <el-option
              v-for="o in grp.items"
              :key="o.id"
              :label="`${unifiedDisplayName(o)}（${o.id}）`"
              :value="o.id"
            />
          </el-option-group>
        </el-select>
        <el-dropdown trigger="click" @command="onNewObject">
          <el-button size="small" :icon="Plus">{{ t('unified.create') }}</el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="block">{{ t('unified.newObject.block') }}</el-dropdown-item>
              <el-dropdown-item command="item">{{ t('unified.newObject.item') }}</el-dropdown-item>
              <el-dropdown-item command="entity">{{ t('unified.newObject.entity') }}</el-dropdown-item>
              <el-dropdown-item command="biome">{{ t('unified.newObject.biome') }}</el-dropdown-item>
              <el-dropdown-item command="advancement">{{ t('unified.newObject.advancement') }}</el-dropdown-item>
              <el-dropdown-item divided command="custom:block">{{ t('unified.newObject.customBlock') }}</el-dropdown-item>
              <el-dropdown-item command="custom:item">{{ t('unified.newObject.customItem') }}</el-dropdown-item>
              <el-dropdown-item command="custom:entity">{{ t('unified.newObject.customEntity') }}</el-dropdown-item>
              <el-dropdown-item command="custom:biome">{{ t('unified.newObject.customBiome') }}</el-dropdown-item>
              <el-dropdown-item command="custom:advancement">{{ t('unified.newObject.customAdvancement') }}</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <el-dropdown trigger="click" @command="onQuickCreate">
          <el-button
            size="small"
            type="primary"
            plain
            :icon="Lightning"
            :disabled="!quickCreateEnabled"
            :title="quickCreateEnabled ? '' : t('unified.quickCreateDisabledTip')"
          >{{ t('unified.quickCreate') }}</el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item
                v-for="tpl in quickTemplates"
                :key="tpl.id"
                :command="tpl.id"
                :disabled="tpl.id === 'recipe' && !canQuickRecipe"
                :title="quickTemplateHint(tpl)"
              >{{ quickTemplateLabel(tpl) }}</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <el-button
          size="small"
          :loading="doctorLoading"
          :title="t('unified.doctorTip')"
          @click="onDoctor"
        >
          <el-icon class="uev-btn-icon"><DocumentChecked /></el-icon>{{ t('unified.doctor') }}
        </el-button>

        <div v-if="store.active" class="uev-head-title">
          <span class="uev-title-name">{{ unifiedDisplayName(store.active) }}</span>
          <span class="uev-title-id">{{ store.active.id }}</span>
        </div>
        <span v-else class="uev-head-placeholder">{{ t('unified.objectPlaceholder') }}</span>

        <div v-if="store.active" class="uev-head-actions">
          <el-button :disabled="store.saving" @click="onDiscard">{{ t('unified.discard') }}</el-button>
          <el-button type="primary" :loading="store.saving" @click="onSave">{{ t('unified.save') }}</el-button>
        </div>
      </div>
    </header>

    <!-- ============ 空状态 ============ -->
    <div v-if="!store.active" class="uev-empty">
      <el-icon :size="48" color="var(--ky-text-dim)"><Document /></el-icon>
      <p>{{ t('unified.emptySelect') }}</p>
      <p class="uev-empty-hint">{{ t('unified.emptyHint') }}</p>
    </div>

    <!-- ============ 主体工作区 ============ -->
    <div v-else class="uev-main">
      <!-- 左栏：操作区 + 对应配方编辑 -->
      <div class="uev-col-left">
        <OpsPanel :dp="dp" />

        <!-- 对应配方编辑（biome/advancement 无配方/战利品概念，隐藏） -->
        <section v-if="!isDatapackContent" class="uev-linked">
          <el-tabs v-model="dataTab" class="uev-data-tabs">
            <!-- 配方 -->
            <el-tab-pane :label="t('unified.tabRecipes')" name="recipes">
              <RecipePane />
            </el-tab-pane>

            <!-- 战利品表 -->
            <el-tab-pane :label="t('unified.tabLoot')" name="loot">
              <LootPane />
            </el-tab-pane>
          </el-tabs>
        </section>
      </div>

      <!-- 右栏：只读模型预览 + 模型摘要（P0：完整建模能力将由独立模型工坊提供） -->
      <aside class="uev-col-right">
        <!-- ===== 生物群系 / 进度：无 3D 预览，展示数据包说明 ===== -->
        <DatapackPreview v-if="isDatapackContent" />

        <template v-else>
          <!-- 有嵌入模型：按元素装配只读预览 + 摘要 -->
          <template v-if="modelAsset">
            <ModelPreview
              class="uev-preview"
              shape="elements"
              fill
              :elements="modelAsset.elements"
              :pixels="modelAsset.pixels"
              :texture-size="modelAsset.textureSize"
            />
            <section class="uev-side-panel">
              <h4 class="uev-side-title">{{ t('unified.summary.title') }}</h4>
              <div class="uev-summary-line"><span>{{ t('unified.summary.format') }}</span><b>{{ t('unified.summary.javaCube') }}</b></div>
              <div class="uev-summary-line"><span>{{ t('unified.summary.cubes') }}</span><b>{{ modelAsset.elements.length }}</b></div>
              <div class="uev-summary-line"><span>{{ t('unified.summary.texture') }}</span><b>{{ modelAsset.textureSize }}×{{ modelAsset.textureSize }}</b></div>
              <div class="uev-summary-line"><span>{{ t('unified.summary.animation') }}</span><b>0</b></div>
              <el-button
                size="small"
                type="primary"
                class="uev-workshop-btn"
                :title="t('unified.openInModelerTip')"
                @click="onOpenInModeler"
              >{{ t('unified.openInModeler') }}</el-button>
            </section>
          </template>
          <!-- 无嵌入模型：cube/plane 整体贴图预览 -->
          <ModelPreview
            v-else
            class="uev-preview"
            fill
            :shape="stageShape"
            :pixels="activePixels"
            :texture-size="stageTextureSize"
          />
        </template>

        <footer class="uev-tools">
          <el-button v-if="!isDatapackContent" size="small" @click="openTextureEditor">
            <el-icon class="uev-btn-icon"><EditPen /></el-icon>{{ t('unified.tools.editTexture') }}
          </el-button>
          <el-button
            v-if="!isDatapackContent"
            size="small"
            :title="t('unified.tools.repaintTip')"
            @click="openRepaint"
          >
            <el-icon class="uev-btn-icon"><MagicStick /></el-icon>{{ t('unified.tools.repaint') }}
          </el-button>
          <el-button
            v-if="canCubeModel && !modelAsset"
            size="small"
            :title="t('unified.openInModelerTip')"
            @click="onOpenInModeler"
          >
            <el-icon class="uev-btn-icon"><Share /></el-icon>{{ t('unified.tools.modeler') }}
          </el-button>
          <el-button
            v-if="canCubeModel"
            size="small"
            :title="t('unified.tools.importBbTip')"
            @click="onImportBbmodel"
          >
            <el-icon class="uev-btn-icon"><Upload /></el-icon>{{ t('unified.tools.importBb') }}
          </el-button>
          <el-button
            v-if="canCubeModel"
            size="small"
            :title="t('unified.tools.importObjTip')"
            @click="onImportObj"
          >
            <el-icon class="uev-btn-icon"><Box /></el-icon>{{ t('unified.tools.importObj') }}
          </el-button>
          <el-button
            v-if="cubeModel"
            size="small"
            :title="t('unified.tools.exportBbTip')"
            @click="onExportBbmodel"
          >
            <el-icon class="uev-btn-icon"><Download /></el-icon>{{ t('unified.tools.exportBb') }}
          </el-button>
          <el-button
            v-if="store.active.type === 'block'"
            size="small"
            :title="t('unified.tools.reverseSyncTip')"
            @click="onReverseSync"
          >
            <el-icon class="uev-btn-icon"><RefreshLeft /></el-icon>{{ t('unified.tools.reverseSync') }}
          </el-button>
          <el-button v-if="!isDatapackContent" size="small" :loading="store.generating" @click="onGenerate">
            <el-icon class="uev-btn-icon"><Cpu /></el-icon>{{ t('unified.tools.generate') }}
          </el-button>
          <span v-if="isDatapackContent" class="uev-tools-hint">
            {{ t('unified.tools.dpSyncHint') }}
          </span>
          <span v-else class="uev-tools-hint">{{ t('unified.tools.navHint') }}</span>
        </footer>
      </aside>
    </div>

    <!-- ============ 贴图编辑器弹窗 ============ -->
    <el-dialog
      v-model="textureDialogOpen"
      :title="t('unified.textureDialogTitle', { id: store.active?.id ?? '' })"
      width="auto"
      class="uev-tex-dialog"
      @closed="onTextureDialogClosed"
    >
      <div class="uev-tex-body">
        <PixelCanvas :model="textureModel" @painted="onTexturePainted" />
        <ModelPreview
          :pixels="textureModel.pixels"
          :shape="store.active?.type === 'block' ? 'cube' : 'plane'"
          :texture-size="textureModel.textureSize"
        />
      </div>
      <template #footer>
        <el-button @click="textureDialogOpen = false">{{ t('unified.done') }}</el-button>
      </template>
    </el-dialog>

    <!-- ============ AI 重绘候选画廊（整图 / 局部 mask，4 候选即时换 3D） ============ -->
    <RepaintDialog
      v-model="repaintOpen"
      :size="repaintTarget.size"
      :pixels="repaintTarget.pixels"
      :shape="repaintTarget.shape"
      :asset-kind="repaintAssetKind"
      :asset-id="repaintAssetId"
      @applied="onRepaintApplied"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * UnifiedEditorView：统一编辑器主视图。
 * 按内容对象（物品/方块/实体）编辑，三端（Java/资源包/数据包）实时同步。
 *
 * 布局（按设计草图）：
 * - 顶部：类型 Tab（物品/方块/实体）| 对象标题 | 放弃 / 保存
 * - 左栏：操作区（基础信息 + Java 属性 + 资源包配置 + 产物预览）
 *         + 对应配方编辑（配方 / 战利品表分段）
 * - 右栏：只读模型预览 + 模型摘要（完整建模能力由独立模型工坊提供，P1）
 * AI 对话框为应用右侧常驻面板，不在本视图内重复实现。
 *
 * 脚本逻辑按内聚块抽为 composables/ 下的 useXxx，
 * 大体量模板区块抽为 sections/ 下的子组件；本文件保留为组合根，行为零变更。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  Cpu,
  Document,
  DocumentChecked,
  Download,
  EditPen,
  Lightning,
  MagicStick,
  Plus,
  RefreshLeft,
  Share,
  Upload
} from '@element-plus/icons-vue'
import { useProjectStore } from '../../stores/project'
import { useUnifiedStore } from '../../stores/unified'
import { useModelerStore } from '../../stores/modeler'
import { useUiStore } from '../../stores/ui'
import PixelCanvas from '../../components/texture/PixelCanvas.vue'
import ModelPreview from '../modeler/preview/ModelPreview.vue'
import RepaintDialog from './RepaintDialog.vue'
import OpsPanel from './sections/OpsPanel.vue'
import RecipePane from './sections/RecipePane.vue'
import LootPane from './sections/LootPane.vue'
import DatapackPreview from './sections/DatapackPreview.vue'
import { unifiedDisplayName } from '../../../../shared/schemas/unified.schema'
import type { GalleryAssetKind } from '../../../../shared/types/ipc'
import type { EmbeddedCubeModel, ModelAsset } from '../../../../shared/types/content'
import { validateLootTable } from '../../../../shared/schemas/loot.schema'
import { validateRecipe } from '../../../../shared/schemas/recipe.schema'
import { useObjectNav } from './composables/useObjectNav'
import { useQuickCreate } from './composables/useQuickCreate'
import { useDatapackEditor } from './composables/useDatapackEditor'
import { useTextureEditing } from './composables/useTextureEditing'
import { useRepaint } from './composables/useRepaint'
import { useUnifiedActions } from './composables/useUnifiedActions'
import { t, te } from '../../i18n'
import type { QuickCreateTemplateMeta } from '../../../../shared/schemas/quickCreate'

const projectStore = useProjectStore()
const store = useUnifiedStore()
const modelerStore = useModelerStore()
const ui = useUiStore()

const ns = computed(() => projectStore.currentProject?.namespace || 'mymod')
const root = computed(() => projectStore.currentProject?.path || '')

/* ---- 左下数据面板分段：配方 / 战利品表 ---- */
const dataTab = ref<'recipes' | 'loot'>('recipes')

/* ---- 组合式逻辑（内聚块抽出，行为零变更） ---- */
const { objectGroups, onKindTab, onSwitchObject, onNewObject } = useObjectNav()

const { quickCreateEnabled, quickTemplates, canQuickRecipe, onQuickCreate } = useQuickCreate()

/** 模板文案走语言包，缺失时回落共享注册表里的中文原名（新增模板不受影响） */
function quickTemplateText(tpl: QuickCreateTemplateMeta, field: 'label' | 'hint'): string {
  const key = `unified.quickTemplate.${tpl.id}.${field}`
  return te(key) ? t(key) : tpl[field]
}

function quickTemplateLabel(tpl: QuickCreateTemplateMeta): string {
  return quickTemplateText(tpl, 'label')
}

function quickTemplateHint(tpl: QuickCreateTemplateMeta): string {
  return quickTemplateText(tpl, 'hint')
}
const dp = useDatapackEditor()
const { isDatapackContent, resetDpEditor, commitDpEditor } = dp
const {
  textureDialogOpen,
  textureModel,
  activeTextureRef,
  openTextureEditor,
  onTexturePainted,
  onTextureDialogClosed
} = useTextureEditing()
/** 当前对象是否支持立方体模型（方块/物品/实体） */
const canCubeModel = computed<boolean>(() => {
  const t = store.active?.type
  return t === 'block' || t === 'item' || t === 'entity'
})

/** 当前对象的嵌入式模型（方块/物品/实体） */
const cubeModel = computed<EmbeddedCubeModel | null>(() => {
  const a = store.active
  if (!a || (a.type !== 'block' && a.type !== 'item' && a.type !== 'entity')) return null
  return a.assets.model.cubeModel ?? null
})

/** 只读预览用的 ModelAsset 包装（引用嵌入式数据） */
const modelAsset = computed<ModelAsset | null>(() => {
  const cm = cubeModel.value
  const a = store.active
  if (!cm || !a) return null
  return {
    kind: 'model',
    id: a.id,
    displayName: unifiedDisplayName(a),
    description: a.description ?? '',
    textureSize: cm.textureSize,
    pixels: cm.pixels,
    textures: { all: `textures/model/${a.id}.png` },
    elements: cm.elements,
    ambientOcclusion: true,
    createdAt: a.meta.createdAt,
    updatedAt: a.meta.updatedAt
  }
})

const { activePixels, stageShape, repaintOpen, repaintTarget, openRepaint, onRepaintApplied } =
  useRepaint(cubeModel, activeTextureRef)
/** 无嵌入模型时整体贴图预览的画布边长（1024 像素 = 32×32） */
const stageTextureSize = computed(() => (activePixels.value.length >= 1024 ? 32 : 16))
// 出图入库画廊时标注目标资产：方块/物品可写回像素（实体扁平 schema 的 texture 只有 path，无可写回像素，不标注）
const repaintAssetKind = computed<GalleryAssetKind>(() =>
  store.active?.type === 'block' ? 'block' : store.active?.type === 'item' ? 'item' : 'free'
)
const repaintAssetId = computed<string>(() =>
  repaintAssetKind.value === 'free' ? '' : (store.active?.id ?? '')
)
const {
  doctorLoading,
  onGenerate,
  onReverseSync,
  onDoctor,
  onImportBbmodel,
  onExportBbmodel,
  onImportObj
} = useUnifiedActions()

/** 放弃：已存在对象恢复为磁盘版本，新建未保存对象直接关闭 */
function onDiscard(): void {
  const a = store.active
  if (!a) return
  const origin = store.objects.find((o) => o.type === a.type && o.id === a.id)
  store.select(origin ?? null)
  if (origin && (origin.type === 'biome' || origin.type === 'advancement')) {
    resetDpEditor()
  }
}

/* ---- 生命周期与信号 ---- */
onMounted(async () => {
  if (root.value) await store.load(root.value, ns.value)
  consumeOpenObjectSignal()
})

watch(
  () => projectStore.currentProjectId,
  async () => {
    if (root.value) {
      await store.load(root.value, ns.value)
      store.select(null)
    }
  }
)

watch(
  () => store.createSignal,
  (sig) => {
    if (sig) {
      store.beginNew(sig.type, ns.value)
      store.clearSignals()
    }
  }
)

watch(
  () => store.deleteSignal,
  async (sig) => {
    if (sig) {
      try {
        await ElMessageBox.confirm(
          t('unified.deleteConfirm', { id: sig.obj.id }),
          t('unified.deleteTitle'),
          { type: 'warning' }
        )
        await store.remove(root.value, sig.obj)
        ElMessage.success(t('unified.deleted'))
      } catch {
        /* 用户取消 */
      }
      store.clearSignals()
    }
  }
)

/** 消费模型工坊的「打开关联对象」信号：定位并选中对象（只选中，不灌模型） */
function consumeOpenObjectSignal(): void {
  const sig = store.openObjectSignal
  if (!sig) return
  store.clearSignals()
  const obj = store.objects.find((o) => o.type === sig.type && o.id === sig.id)
  if (!obj) {
    ElMessage.warning(t('unified.objectNotFound'))
    return
  }
  store.select(obj)
}

watch(
  () => store.openObjectSignal,
  () => consumeOpenObjectSignal()
)

/** 在模型工坊打开当前对象的模型：定位/导入/新建绑定文档后跳转模型工坊模块（P5-open） */
async function onOpenInModeler(): Promise<void> {
  const a = store.active
  if (!a || !canCubeModel.value || !root.value) return
  const err = await modelerStore.openForObject(
    a.type as 'block' | 'item' | 'entity',
    a.id,
    unifiedDisplayName(a)
  )
  if (err) {
    ElMessage.error(err)
    return
  }
  ui.setActiveModule('modeler')
}

async function onSave(): Promise<void> {
  if (!store.active) return
  // 生物群系/进度：先把双模式编辑器内容写回 doc
  if (isDatapackContent.value) {
    const dpErr = commitDpEditor()
    if (dpErr) {
      ElMessage.error(dpErr)
      return
    }
  } else {
    // 配方校验：任一配方非法即阻止保存
    for (const r of store.active.data.recipes ?? []) {
      const recipeErr = validateRecipe(r)
      if (recipeErr) {
        ElMessage.error(recipeErr)
        return
      }
    }
    // 战利品表校验：有非法配置时阻止保存
    const lt = store.active.data.lootTable
    if (lt) {
      const lootErr = validateLootTable(lt)
      if (lootErr) {
        ElMessage.error(lootErr)
        return
      }
    }
  }
  const err = await store.save(root.value)
  if (err) ElMessage.error(err)
  else ElMessage.success(t('unified.saved'))
}
</script>

<style scoped>
.uev {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

/* ============ 顶部 ============ */
.uev-head {
  display: flex;
  align-items: stretch;
  flex-shrink: 0;
  border-bottom: 1px solid var(--ky-border);
  background: var(--ky-bg-elev);
}
.uev-head-tabs {
  width: 320px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  padding: 8px 12px;
  border-right: 1px solid var(--ky-border);
}
.uev-head-main {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 16px;
}
.uev-head-title {
  display: flex;
  align-items: baseline;
  gap: 10px;
  min-width: 0;
}
.uev-title-name {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--ky-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.uev-title-id {
  font-size: 11px;
  color: var(--ky-text-dim);
  font-family: var(--ky-mono, monospace);
  white-space: nowrap;
}
.uev-head-placeholder {
  font-size: 12px;
  color: var(--ky-text-dim);
}
.uev-head-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  /* 窄窗口（AI 面板展开）时允许收缩换行，不再裁掉最右按钮 */
  flex-shrink: 1;
  min-width: 0;
  flex-wrap: wrap;
  row-gap: 4px;
}

/* ============ 空态 ============ */
.uev-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--ky-text-sub);
}
.uev-empty-hint {
  font-size: 12px;
  color: var(--ky-text-dim);
}

/* ============ 主体 ============ */
.uev-main {
  flex: 1;
  min-height: 0;
  display: flex;
}

/* 左栏 */
.uev-col-left {
  width: 320px;
  flex-shrink: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--ky-border);
}

/* 对应配方编辑 */
.uev-linked {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--ky-border);
  background: var(--ky-bg-sidebar);
}
.uev-data-tabs {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.uev-data-tabs :deep(.el-tabs__header) {
  margin: 0;
  padding: 0 10px;
  flex-shrink: 0;
}
.uev-data-tabs :deep(.el-tabs__content) {
  flex: 1;
  min-height: 0;
}
.uev-data-tabs :deep(.el-tab-pane) {
  height: 100%;
  overflow-y: auto;
}
.uev-btn-icon {
  margin-right: 3px;
}

/* 右栏 */
.uev-col-right {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  padding: 14px 16px;
  gap: 12px;
}
.uev-preview {
  /* 3D 预览撑满右栏剩余高度（原先固定 240px，下方留大片空白） */
  flex: 1 1 0;
  min-height: 200px;
  align-self: stretch;
}
.uev-side-panel {
  flex-shrink: 0;
  border: 1px solid var(--ky-border);
  border-radius: 8px;
  background: var(--ky-bg-sidebar);
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.uev-side-title {
  margin: 0 0 2px;
  font-size: 12px;
  font-weight: 600;
  color: var(--ky-accent);
}
.uev-summary-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11.5px;
  color: var(--ky-text-dim);
}
.uev-summary-line b {
  font-weight: 500;
  color: var(--ky-text);
  font-family: var(--ky-mono, monospace);
}
.uev-workshop-btn {
  margin-top: 4px;
  width: 100%;
}

/* 顶部对象切换下拉 */
.uev-object-select {
  width: 210px;
  flex-shrink: 0;
}

.uev-tools {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 14px;
  border-top: 1px solid var(--ky-border);
  background: var(--ky-bg-sidebar);
  flex-shrink: 0;
  flex-wrap: wrap;
}
.uev-tools-hint {
  margin-left: auto;
  font-size: 10.5px;
  color: var(--ky-text-dim);
}

/* 贴图弹窗 */
.uev-tex-body {
  display: flex;
  align-items: center;
  gap: 16px;
}
</style>

<!-- 体检通知挂在 body（Teleport 之外的全局样式），scoped 样式打不到 -->
<style>
.uev-doctor-notify {
  max-width: 420px;
}
.uev-doctor-notify .el-notification__content {
  white-space: pre-line;
  text-align: left;
  max-height: 40vh;
  overflow-y: auto;
}
</style>
