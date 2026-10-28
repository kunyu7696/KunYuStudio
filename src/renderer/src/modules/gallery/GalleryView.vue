<!--
  资产库（原项目画廊 GalleryView）
  - AI 产出的每张候选图都是资产：出图即入库 <项目>/.kunyu/gallery/，永不自动删除
  - 一站式零额度复用：直接写回资产（不必重新调用 AI 烧额度）/ 送进工坊二次编辑 / 查看大图
  - 未绑定资产的画（如工坊里的方块/实体贴图）可在写回时手动选择目标资产
  - 接替原「KunYu 社区」：跨项目汇总、.kyshare.json 分享包导入/导出、公开发布入口
-->
<template>
  <div class="gallery-view">
    <header class="gallery-header">
      <div>
        <h2>{{ t('gallery.title') }}</h2>
        <p v-if="aggregate">
          {{ t('gallery.headerAggregateLead') }}<code>.kunyu/gallery/</code
          >{{ t('gallery.headerAggregateTail') }}
        </p>
        <p v-else>
          {{ t('gallery.headerProjectLead') }}<code>.kunyu/gallery/</code
          >{{ t('gallery.headerProjectTail') }}
        </p>
      </div>
      <div class="gallery-header-actions">
        <el-button :icon="Upload" @click="openImportShare">{{ t('gallery.importShare') }}</el-button>
        <el-button :icon="Refresh" :loading="loading" @click="reload">{{ t('gallery.refresh') }}</el-button>
      </div>
    </header>

    <div class="gallery-toolbar">
      <el-input
        v-model="keyword"
        :prefix-icon="Search"
        :placeholder="t('gallery.searchPlaceholder')"
        clearable
        class="gallery-search"
      />
      <el-radio-group v-model="originFilter" size="small">
        <el-radio-button value="all">{{ t('gallery.origin.all') }}</el-radio-button>
        <el-radio-button value="agent">{{ t('gallery.origin.agent') }}</el-radio-button>
        <el-radio-button value="workshop">{{ t('gallery.origin.workshop') }}</el-radio-button>
        <el-radio-button value="project">{{ t('gallery.origin.project') }}</el-radio-button>
      </el-radio-group>
      <el-radio-group v-model="kindFilter" size="small">
        <el-radio-button value="all">{{ t('gallery.kindFilter.all') }}</el-radio-button>
        <el-radio-button value="texture">{{ t('gallery.kindFilter.texture') }}</el-radio-button>
        <el-radio-button value="model">{{ t('gallery.kindFilter.model') }}</el-radio-button>
        <el-radio-button value="free">{{ t('gallery.kindFilter.free') }}</el-radio-button>
      </el-radio-group>
      <span class="gallery-count">
        {{ t('gallery.count', { visible: visibleRows.length, total: rows.length }) }}<template
          v-if="aggregate"
        >
          {{ t('gallery.projectCount', { n: groups.length }) }}</template
        >
      </span>
    </div>

    <section v-if="rows.length === 0" class="gallery-card">
      <div class="gallery-empty">
        <template v-if="aggregate">
          {{ t('gallery.emptyAggregate') }}
        </template>
        <template v-else>
          {{ t('gallery.emptyProject') }}
        </template>
      </div>
    </section>

    <el-scrollbar v-else class="gallery-scroll">
      <section v-for="g in groups" :key="g.key" class="gallery-group">
        <h3 v-if="aggregate" class="gallery-group-title">
          {{ g.name || t('gallery.unnamedProject') }}
          <span class="gallery-group-count">{{ t('gallery.itemCount', { n: g.items.length }) }}</span>
        </h3>
        <div class="gallery-grid">
          <article v-for="item in g.items" :key="`${item.projectRoot}-${item.id}`" class="gallery-item">
            <button
              type="button"
              class="gallery-thumb"
              :class="{ 'gallery-thumb-model': item.entryKind === 'model' }"
              @click="openPreview(item)"
            >
              <PixelThumb
                v-if="item.entryKind !== 'model'"
                :pixels="item.pixels"
                :size="item.size"
              />
              <!-- 3D 模型不做每卡一个 WebGL 实例：有贴图就先用贴图当封面，点开才在弹窗里真渲染 -->
              <template v-else>
                <PixelThumb
                  v-if="item.pixels.length"
                  class="gallery-model-tex"
                  :pixels="item.pixels"
                  :size="item.size"
                />
                <span v-else class="gallery-model-poster">
                  <!-- 无贴图的模型：用几何线稿当作图标，避免只剩一行文字 -->
                  <svg class="gallery-model-glyph" viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      d="M12 2.6 21 7.4v9.2L12 21.4 3 16.6V7.4z M12 2.6v18.8 M3 7.4l9 4.6 9-4.6"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.2"
                      stroke-linejoin="round"
                    />
                  </svg>
                  <span class="gallery-model-badge">{{ modelBadge(item) }}</span>
                  <span class="gallery-model-count">{{ modelSummary(item) }}</span>
                </span>
                <span class="gallery-model-corner">{{ modelBadge(item) }}</span>
              </template>
              <span class="gallery-thumb-size">
                {{ item.entryKind === 'model' ? t('gallery.threeD') : `${item.size}×${item.size}` }}
              </span>
            </button>
            <p class="gallery-item-prompt" :title="item.prompt">
              {{ item.prompt || t('gallery.noPrompt') }}
            </p>
            <div class="gallery-item-meta">
              <span class="gallery-tag" :class="`gallery-tag-${item.assetKind}`">
                {{ assetLabel(item) }}
              </span>
              <span class="gallery-item-time">{{ formatTime(item.createdAt) }}</span>
            </div>
            <div v-if="item.entryKind === 'model'" class="gallery-item-actions">
              <el-button link type="primary" size="small" @click="openPreview(item)"
                >{{ t('gallery.preview3d') }}</el-button
              >
              <el-button
                link
                size="small"
                :disabled="!canSendToWorkshop(item)"
                :title="canSendToWorkshop(item) ? '' : t('gallery.sendToWorkshopDisabled')"
                @click="sendToWorkshop(item)"
                >{{ t('gallery.sendToWorkshop') }}</el-button
              >
              <el-button
                link
                size="small"
                :disabled="item.model?.ownerKind !== 'model'"
                :title="
                  item.model?.ownerKind === 'model'
                    ? ''
                    : t('gallery.exportBbmodelDisabled')
                "
                @click="exportModel(item)"
                >{{ t('gallery.exportBbmodel') }}</el-button
              >
              <el-button link size="small" @click="openModelTarget(item)">{{ t('gallery.writeBackTarget') }}</el-button>
              <el-button
                v-if="shareTargetOf(item)"
                link
                size="small"
                :icon="Download"
                @click="openExportShare(item)"
                >{{ t('gallery.exportShare') }}</el-button
              >
              <el-button
                v-if="item.origin !== 'project'"
                link
                type="danger"
                size="small"
                @click="onDelete(item)"
                >{{ t('gallery.delete') }}</el-button
              >
            </div>
            <div v-else class="gallery-item-actions">
              <!-- 项目资产已经是资产本身：不再「用于资产」（写回自身无意义）、也不提供删除（不是 AI 额度产物） -->
              <el-button
                v-if="item.origin !== 'project'"
                link
                type="primary"
                size="small"
                @click="onUse(item)"
                >{{ t('gallery.useAsset') }}</el-button
              >
              <el-button link size="small" @click="openWorkshop(item)">{{ t('gallery.workshopEdit') }}</el-button>
              <el-button
                v-if="shareTargetOf(item)"
                link
                size="small"
                :icon="Download"
                @click="openExportShare(item)"
                >{{ t('gallery.exportShare') }}</el-button
              >
              <el-button
                v-if="item.origin !== 'project'"
                link
                type="danger"
                size="small"
                @click="onDelete(item)"
                >{{ t('gallery.delete') }}</el-button
              >
            </div>
          </article>
        </div>
      </section>
    </el-scrollbar>

    <!-- 发布到公开平台（接替原 KunYu 社区入口） -->
    <section class="gallery-publish">
      <div class="gallery-publish-head">{{ t('gallery.publishTitle') }}</div>
      <div class="gallery-publish-row">
        <div v-for="s in PUBLISH_SITES" :key="s.url" class="gallery-publish-card" @click="openSite(s.url)">
          <div class="gallery-publish-name">{{ s.name }}</div>
          <div class="gallery-publish-desc">{{ s.desc }}</div>
          <el-icon class="gallery-publish-go"><Position /></el-icon>
        </div>
      </div>
    </section>

    <!-- 大图预览 + 元数据 -->
    <el-dialog v-model="previewOpen" :title="t('gallery.previewTitle')" width="620px" append-to-body>
      <div v-if="previewItem" class="gallery-preview">
        <div class="gallery-preview-stage">
          <PixelThumb :pixels="previewItem.pixels" :size="previewItem.size" />
        </div>
        <dl class="gallery-preview-meta">
          <dt>{{ t('gallery.metaPrompt') }}</dt>
          <dd>{{ previewItem.prompt || t('gallery.noPrompt') }}</dd>
          <dt v-if="aggregate">{{ t('gallery.metaProject') }}</dt>
          <dd v-if="aggregate">{{ previewItem.projectName || t('gallery.unnamedProject') }}</dd>
          <dt>{{ t('gallery.metaAsset') }}</dt>
          <dd>{{ assetLabel(previewItem) }}</dd>
          <dt>{{ t('gallery.metaSize') }}</dt>
          <dd>{{ previewItem.size }}×{{ previewItem.size }}</dd>
          <dt>{{ t('gallery.metaSource') }}</dt>
          <dd>{{ originLabel(previewItem.origin) }}</dd>
          <dt v-if="previewItem.provider">{{ t('gallery.metaProvider') }}</dt>
          <dd v-if="previewItem.provider">{{ previewItem.provider }}</dd>
          <dt>{{ t('gallery.metaCreated') }}</dt>
          <dd>{{ formatTime(previewItem.createdAt) }}</dd>
          <dt>{{ t('gallery.metaPalette') }}</dt>
          <dd class="gallery-preview-palette">
            <span
              v-for="(c, i) in previewItem.palette"
              :key="`${c}-${i}`"
              class="gallery-swatch"
              :style="{ background: c }"
            />
            <span v-if="previewItem.palette.length === 0" class="gallery-dim">{{ t('gallery.none') }}</span>
          </dd>
        </dl>
      </div>
      <template #footer>
        <el-button @click="previewOpen = false">{{ t('gallery.close') }}</el-button>
        <el-button
          v-if="previewItem && previewItem.origin !== 'project'"
          type="primary"
          @click="onUse(previewItem)"
        >
          {{ t('gallery.useAsset') }}
        </el-button>
      </template>
    </el-dialog>

    <!-- 未绑定资产的画：手动选目标资产后写回 -->
    <el-dialog v-model="pickOpen" :title="t('gallery.pickTitle')" width="480px" append-to-body>
      <div class="gallery-pick">
        <div class="gallery-pick-row">
          <span class="gallery-pick-label">{{ t('gallery.targetProject') }}</span>
          <span class="gallery-pick-project">{{ pickProjectName || t('gallery.unnamedProject') }}</span>
        </div>
        <div class="gallery-pick-row">
          <span class="gallery-pick-label">{{ t('gallery.assetType') }}</span>
          <el-radio-group v-model="pickKind" size="small" @change="onPickKindChange">
            <el-radio-button value="item">{{ t('gallery.pickItem') }}</el-radio-button>
            <el-radio-button value="block">{{ t('gallery.pickBlock') }}</el-radio-button>
            <el-radio-button value="model">{{ t('gallery.pickModel') }}</el-radio-button>
          </el-radio-group>
        </div>
        <div class="gallery-pick-row">
          <span class="gallery-pick-label">{{ t('gallery.targetAsset') }}</span>
          <el-select
            v-model="pickId"
            :placeholder="t('gallery.pickPlaceholder')"
            filterable
            class="gallery-pick-select"
          >
            <el-option
              v-for="c in pickCandidates"
              :key="c.id"
              :label="t('gallery.optionLabel', { name: c.displayName, id: c.id })"
              :value="c.id"
            />
          </el-select>
        </div>
        <p class="gallery-pick-tip">
          {{ pickKind === 'model' ? t('gallery.pickTipModel') : t('gallery.pickTipTexture') }}
          {{ t('gallery.pickTipTail') }}
        </p>
      </div>
      <template #footer>
        <el-button @click="pickOpen = false">{{ t('gallery.cancel') }}</el-button>
        <el-button type="primary" :disabled="!pickId" :loading="applying" @click="confirmPick">
          {{ t('gallery.writeBackAsset') }}
        </el-button>
      </template>
    </el-dialog>

    <!-- 3D 模型预览：单实例 WebGL 只在弹窗里创建（卡片不做每卡一个渲染器） -->
    <el-dialog
      v-model="modelPreviewOpen"
      :title="modelPreviewTitle"
      width="760px"
      append-to-body
      @closed="onModelPreviewClosed"
    >
      <div v-if="modelPreviewItem" class="gallery-model-preview">
        <div class="gallery-model-stage">
          <!-- 只读 3D 预览：轨道视角旋转，编辑动作全部禁用 -->
          <ModelPreview
            v-if="modelAsset"
            shape="elements"
            :elements="modelAsset.elements"
            :pixels="modelAsset.pixels"
            :texture-size="modelAsset.textureSize"
          />
          <div v-else-if="modelLoading" class="gallery-model-hint">{{ t('gallery.modelLoading') }}</div>
          <!-- 骨骼模型预览补齐（P5-gallery）：工坊文档/geoJson 装配的只读几何 -->
          <ModelPreview
            v-else-if="modelDocPreview"
            shape="elements"
            :elements="modelDocPreview.elements"
            :pixels="modelDocPreview.pixels"
            :texture-size="modelDocPreview.textureSize"
          />
          <div v-else class="gallery-model-fallback">
            <p class="gallery-model-hint">{{ modelFallbackHint }}</p>
            <dl class="gallery-preview-meta">
              <dt>{{ t('gallery.geometry') }}</dt>
              <dd>{{ previewGeometryLabel }}</dd>
              <dt>{{ t('gallery.owner') }}</dt>
              <dd>{{ assetLabel(modelPreviewItem) }}</dd>
              <dt v-if="modelPreviewItem.model?.geometry === 'blockbench'">{{ t('gallery.boneCount') }}</dt>
              <dd v-if="modelPreviewItem.model?.geometry === 'blockbench'">
                {{ modelPreviewItem.model?.boneCount ?? 0 }}
              </dd>
              <dt v-else>{{ t('gallery.elementCount') }}</dt>
              <dd>{{ modelPreviewItem.model?.elementCount ?? 0 }}</dd>
              <dt v-if="modelTexturePath">{{ t('gallery.texture') }}</dt>
              <dd v-if="modelTexturePath">{{ modelTexturePath }}</dd>
              <dt v-if="modelPathRef">{{ t('gallery.modelFile') }}</dt>
              <dd v-if="modelPathRef">{{ modelPathRef }}</dd>
            </dl>
          </div>
        </div>
        <p class="gallery-model-tip">
          {{ t('gallery.modelPreviewTip') }}
        </p>
      </div>
      <template #footer>
        <el-button @click="modelPreviewOpen = false">{{ t('gallery.close') }}</el-button>
        <el-button
          v-if="modelPreviewItem?.model?.ownerKind === 'model'"
          :loading="exporting"
          @click="exportModel(modelPreviewItem)"
          >{{ t('gallery.exportBbmodel') }}</el-button
        >
        <el-button v-if="canSendToWorkshop(modelPreviewItem)" @click="sendToWorkshop(modelPreviewItem)"
          >{{ t('gallery.sendToWorkshopEdit') }}</el-button
        >
        <el-button type="primary" @click="openModelTarget(modelPreviewItem)">{{ t('gallery.writeBackTarget') }}</el-button>
      </template>
    </el-dialog>

    <!-- 模型写回目标对象：落目标自己的模型资产 + 绑定 cubeModelId（实体现为骨骼模型需二次确认） -->
    <el-dialog v-model="modelTargetOpen" :title="t('gallery.targetDialogTitle')" width="540px" append-to-body>
      <div class="gallery-pick">
        <div class="gallery-pick-row">
          <span class="gallery-pick-label">{{ t('gallery.targetProject') }}</span>
          <span class="gallery-pick-project">{{ modelTargetProjectName || t('gallery.unnamedProject') }}</span>
        </div>
        <div class="gallery-pick-row">
          <span class="gallery-pick-label">{{ t('gallery.objectType') }}</span>
          <el-radio-group v-model="modelTargetKind" size="small" @change="modelTargetId = ''">
            <el-radio-button value="block">{{ t('unified.kind.block') }}</el-radio-button>
            <el-radio-button value="item">{{ t('unified.kind.item') }}</el-radio-button>
            <el-radio-button value="entity">{{ t('unified.kind.entity') }}</el-radio-button>
          </el-radio-group>
        </div>
        <div class="gallery-pick-row">
          <span class="gallery-pick-label">{{ t('gallery.targetObject') }}</span>
          <el-select
            v-model="modelTargetId"
            :placeholder="t('gallery.targetPlaceholder')"
            filterable
            class="gallery-pick-select"
          >
            <el-option
              v-for="c in modelTargetCandidates"
              :key="c.id"
              :label="t('gallery.optionLabel', { name: c.displayName, id: c.id })"
              :value="c.id"
            />
          </el-select>
        </div>
        <p class="gallery-pick-tip">
          {{ t('gallery.targetTipLead') }}<code>{{ t('gallery.modelPathTemplate') }}</code
          >{{ t('gallery.targetTipTail') }}
        </p>
      </div>
      <template #footer>
        <el-button @click="modelTargetOpen = false">{{ t('gallery.cancel') }}</el-button>
        <el-button
          type="primary"
          :disabled="!modelTargetId"
          :loading="modelApplying"
          @click="confirmModelTarget"
        >
          {{ t('gallery.writeBackObject') }}
        </el-button>
      </template>
    </el-dialog>

    <!-- 工坊编辑：用画廊里的像素当底稿（可局部重绘/改参数），写回时按绑定情况走同一套逻辑 -->
    <RepaintDialog
      v-model="workshopOpen"
      :size="workshopSize"
      :pixels="workshopPixels"
      :shape="workshopSize === 32 ? 'cube' : 'plane'"
      :root="workshopRoot"
      @applied="onWorkshopApplied"
    />

    <!-- 导入分享包（原 KunYu 社区功能）：选择目标项目 → 预览元数据 → 确认落盘 -->
    <el-dialog
      v-model="importShareOpen"
      :title="t('gallery.importTitle')"
      width="480px"
      append-to-body
      @closed="resetImportShare"
    >
      <template v-if="!importPreview">
        <p class="gallery-pick-tip">{{ t('gallery.importTip') }}</p>
        <el-select
          v-model="importTarget"
          :placeholder="t('gallery.selectProject')"
          class="gallery-pick-select"
          filterable
        >
          <el-option
            v-for="p in projectStore.projects"
            :key="p.path"
            :label="p.name"
            :value="p.path"
          />
        </el-select>
      </template>
      <template v-else>
        <el-alert
          v-if="importPreview.conflict"
          type="warning"
          :closable="false"
          class="gallery-share-alert"
          :title="
            t('gallery.conflictAlert', {
              kind: kindLabel(importPreview.kind),
              name: importPreview.existingDisplayName ?? importPreview.id
            })
          "
        />
        <el-descriptions :column="1" border size="small">
          <el-descriptions-item :label="t('gallery.fieldContent')">
            {{ t('gallery.contentSummary', { name: importPreview.displayName, kind: kindLabel(importPreview.kind), id: importPreview.id }) }}
          </el-descriptions-item>
          <el-descriptions-item :label="t('gallery.fieldLoader')">{{ importPreview.loader ?? t('gallery.unknown') }}</el-descriptions-item>
          <el-descriptions-item :label="t('gallery.fieldMcVersion')">{{ importPreview.mcVersion ?? t('gallery.unknown') }}</el-descriptions-item>
          <el-descriptions-item :label="t('gallery.fieldLicense')">{{ licenseLabel(importPreview.license) }}</el-descriptions-item>
          <el-descriptions-item :label="t('gallery.fieldDeps')">
            {{
              importPreview.dependencies?.length
                ? importPreview.dependencies.join(t('gallery.depSeparator'))
                : t('gallery.undeclared')
            }}
          </el-descriptions-item>
          <el-descriptions-item :label="t('gallery.fieldSource')">{{ importPreview.provenance ?? t('gallery.unknown') }}</el-descriptions-item>
          <el-descriptions-item :label="t('gallery.fieldExportedAt')">{{ importPreview.exportedAt ?? t('gallery.unknown') }}</el-descriptions-item>
        </el-descriptions>
      </template>
      <template #footer>
        <el-button @click="importShareOpen = false">{{ t('gallery.cancel') }}</el-button>
        <el-button
          v-if="!importPreview"
          type="primary"
          :disabled="!importTarget"
          :loading="importingShare"
          @click="pickSharePackage"
        >
          {{ t('gallery.selectPackage') }}
        </el-button>
        <template v-else>
          <el-button @click="importPreview = null">{{ t('gallery.reselectFile') }}</el-button>
          <el-button
            :type="importPreview.conflict ? 'danger' : 'primary'"
            :loading="importingShare"
            @click="confirmImportShare"
          >
            {{ importPreview.conflict ? t('gallery.overwriteImport') : t('gallery.confirmImport') }}
          </el-button>
        </template>
      </template>
    </el-dialog>

    <!-- 导出分享包（原 KunYu 社区功能）：选择许可证后弹系统保存框 -->
    <el-dialog v-model="exportShareOpen" :title="t('gallery.exportTitle')" width="440px" append-to-body>
      <p class="gallery-pick-tip">
        {{ t('gallery.exportTip', { name: exportShareItem?.prompt || exportShareItem?.assetId || '' }) }}
      </p>
      <el-select
        v-model="exportLicense"
        :placeholder="t('gallery.licensePlaceholder')"
        class="gallery-pick-select"
        clearable
      >
        <el-option
          v-for="l in KY_SHARE_LICENSES"
          :key="l.id"
          :label="licensePresetText(l.id, 'label', l.label)"
          :value="l.id"
        >
          <span>{{ licensePresetText(l.id, 'label', l.label) }}</span>
          <span class="gallery-share-license-desc">{{ licensePresetText(l.id, 'desc', l.desc) }}</span>
        </el-option>
      </el-select>
      <p class="gallery-pick-tip gallery-share-hint">
        {{ t('gallery.licenseHint') }}
      </p>
      <template #footer>
        <el-button @click="exportShareOpen = false">{{ t('gallery.cancel') }}</el-button>
        <el-button type="primary" :loading="exportingShare" @click="confirmExportShare">
          {{ t('gallery.exportAndSave') }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Download, Position, Refresh, Search, Upload } from '@element-plus/icons-vue'
import { useProjectStore } from '../../stores/project'
import { useModelerStore } from '../../stores/modeler'
import { useUiStore } from '../../stores/ui'
import RepaintDialog from '../unified/RepaintDialog.vue'
import ModelPreview from '../modeler/preview/ModelPreview.vue'
import PixelThumb from './PixelThumb.vue'
import { documentToElements, isMeshElement } from '../modeler/preview/documentToElements'
import type { PreviewElement } from '../modeler/preview/documentToElements'
import type { ContentKind, ContentSummary, ModelAsset } from '../../../../shared/types/content'
import {
  KY_SHARE_LICENSES,
  type SharePackagePreview
} from '../../../../shared/types/community'
import type { GalleryItemDto, GalleryModelInfo, GalleryOrigin } from '../../../../shared/types/ipc'
import type { ModelDocument } from '../../../../shared/modeler/types'
import { deserializeDocument } from '../../../../shared/modeler/document'
import { geoToDocument } from '../../../../shared/modeler/formats/bedrock'
import { readonlyModelAsset } from '../../../../shared/utils/cubeModelAsset'
import { dataUrlToSquarePixels } from '../../utils/pixels'
import { t, te } from '../../i18n'

const projectStore = useProjectStore()
/** 当前打开的项目路径；为空即「跨项目汇总」模式（主页活动栏直接进出画廊） */
const currentRoot = computed(() => projectStore.currentProject?.path ?? null)

/** 画廊行：画廊条目 + 归属项目（跨项目汇总模式下用于分组、写回、删除） */
interface GalleryRow extends GalleryItemDto {
  projectRoot: string
  projectName: string
}

const aggregate = computed(() => currentRoot.value === null)

const rows = ref<GalleryRow[]>([])
const loading = ref(false)
const keyword = ref('')
const originFilter = ref<'all' | GalleryOrigin>('all')
/** 类型分类筛选：贴图（绑定资产的 2D 画）/ 模型（3D 骨骼与立方体）/ 自由画（未绑定） */
const kindFilter = ref<'all' | 'texture' | 'model' | 'free'>('all')

/* 预览 / 选择目标资产 / 工坊编辑 三处弹窗状态 */
const previewOpen = ref(false)
const previewItem = ref<GalleryRow | null>(null)
const pickOpen = ref(false)
const pickKind = ref<'item' | 'model'>('item')
const pickId = ref('')
const pickCandidates = ref<ContentSummary[]>([])
/** 目标项目根：写回/读取资产列表都要落在画所属的那个项目上 */
const pickRoot = ref<string>('')
/** 待写回的像素与尺寸（来自画廊条目或工坊编辑结果） */
const pendingPixels = ref<string[]>([])
const pendingSize = ref<16 | 32>(16)
const applying = ref(false)
const workshopOpen = ref(false)
const workshopPixels = ref<string[]>([])
const workshopSize = ref<16 | 32>(16)
const workshopRoot = ref<string>('')
/** 工坊编辑的源条目：已绑定资产时「采用」直接写回，未绑定则弹目标选择 */
const workshopSource = ref<GalleryRow | null>(null)

/* 3D 模型条目：预览弹窗 / 写回目标对象 两处状态 */
const modelPreviewOpen = ref(false)
const modelPreviewItem = ref<GalleryRow | null>(null)
const modelAsset = ref<ModelAsset | null>(null)
/** 骨骼模型预览补齐（P5-gallery）：由模型工坊文档 / geoJson 装配的只读元素预览 */
const modelDocPreview = ref<{ elements: PreviewElement[]; pixels: string[]; textureSize: number } | null>(null)
const modelLoading = ref(false)
const exporting = ref(false)
/** 骨骼模型无法用 Cube 渲染器预览时，回显的贴图 / 模型文件引用 */
const modelTexturePath = ref('')
const modelPathRef = ref('')
const modelFallbackHint = ref('')
const modelTargetOpen = ref(false)
const modelTargetItem = ref<GalleryRow | null>(null)
const modelTargetKind = ref<'block' | 'item' | 'entity'>('block')
const modelTargetId = ref('')
const modelTargetCandidates = ref<ContentSummary[]>([])
const modelApplying = ref(false)

/* 分享包（原 KunYu 社区功能）：导入 / 导出状态 */
const PUBLISH_SITES = computed(() => [
  {
    name: t('gallery.publishSites.mcmod.name'),
    desc: t('gallery.publishSites.mcmod.desc'),
    url: 'https://www.mcmod.cn/'
  },
  {
    name: t('gallery.publishSites.modrinth.name'),
    desc: t('gallery.publishSites.modrinth.desc'),
    url: 'https://modrinth.com/dashboard'
  },
  {
    name: t('gallery.publishSites.curseforge.name'),
    desc: t('gallery.publishSites.curseforge.desc'),
    url: 'https://authors.curseforge.com/'
  }
])

const importShareOpen = ref(false)
const importTarget = ref('')
const importingShare = ref(false)
const importPreview = ref<SharePackagePreview | null>(null)
const exportShareOpen = ref(false)
const exportShareItem = ref<GalleryRow | null>(null)
const exportLicense = ref('')
const exportingShare = ref(false)

/** 目标选择弹窗里显示的目标项目名（回显写回会落到哪个项目） */
const pickProjectName = computed(() => {
  const r = pickRoot.value
  if (!r) return ''
  if (r === currentRoot.value) return projectStore.currentProject?.name ?? ''
  return projectStore.projects.find((p) => p.path === r)?.name ?? ''
})

/** 类型分类：模型（3D）/ 自由画（未绑定）/ 贴图（绑定到物品/方块/模型资产的 2D 画） */
function kindOf(it: GalleryRow): 'texture' | 'model' | 'free' {
  if (it.entryKind === 'model') return 'model'
  if (it.assetKind === 'free') return 'free'
  return 'texture'
}

/** 搜索 + 来源筛选 + 类型分类后的行 */
const visibleRows = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  return rows.value.filter((it) => {
    if (originFilter.value !== 'all' && it.origin !== originFilter.value) return false
    if (kindFilter.value !== 'all' && kindOf(it) !== kindFilter.value) return false
    if (!kw) return true
    return `${it.prompt} ${it.assetId} ${it.projectName}`.toLowerCase().includes(kw)
  })
})

/** 按项目分组：汇总模式才显示分组标题；单项目模式就是一组、不带标题 */
const groups = computed(() => {
  if (!aggregate.value) {
    return [{ key: currentRoot.value ?? '', name: '', items: visibleRows.value }]
  }
  const map = new Map<string, GalleryRow[]>()
  for (const row of visibleRows.value) {
    const list = map.get(row.projectRoot)
    if (list) list.push(row)
    else map.set(row.projectRoot, [row])
  }
  return [...map.entries()].map(([key, items]) => ({ key, name: items[0].projectName, items }))
})

function assetLabel(item: GalleryItemDto): string {
  if (item.assetKind === 'free' || !item.assetId) return t('gallery.assetUnbound')
  const kind = t(`gallery.assetKind.${item.assetKind}`)
  return `${kind} · ${item.assetId}`
}

/** 模型归属的对象类型标签 */
function ownerLabel(kind: GalleryModelInfo['ownerKind']): string {
  if (kind === 'model') return t('gallery.ownerModel')
  return t(`gallery.assetKind.${kind}`)
}

/** 卡片徽标：立方体模型 / 骨骼模型 */
function modelBadge(item: GalleryItemDto): string {
  return item.model?.geometry === 'blockbench' ? t('gallery.badgeBone') : t('gallery.badgeCube')
}

/** 卡片摘要：几何量 + 归属对象（几何在预览/导出时按需从磁盘读，不塞进列表） */
function modelSummary(item: GalleryItemDto): string {
  const m = item.model
  if (!m) return ''
  const count =
    m.geometry === 'blockbench'
      ? t('gallery.summaryBones', { n: m.boneCount ?? 0 })
      : t('gallery.summaryElements', { n: m.elementCount })
  return `${ownerLabel(m.ownerKind)} · ${m.ownerId}｜${count}`
}

const modelPreviewTitle = computed(() =>
  modelPreviewItem.value
    ? t('gallery.preview3dNamed', {
        name: modelPreviewItem.value.prompt || modelPreviewItem.value.id
      })
    : t('gallery.preview3d')
)
/** 预览弹窗里回显的几何类型 */
const previewGeometryLabel = computed(() =>
  modelPreviewItem.value?.model?.geometry === 'blockbench'
    ? t('gallery.geometryBone')
    : t('gallery.geometryCube')
)
/** 目标选择弹窗里回显的目标项目名 */
const modelTargetProjectName = computed(() => {
  const r = modelTargetItem.value?.projectRoot ?? ''
  if (!r) return ''
  return projectStore.projects.find((p) => p.path === r)?.name ?? ''
})

/** 「送进模型工坊」只对绑定了方块 / 物品 / 实体的模型开放；汇总模式（未打开项目）没有可编辑的项目上下文 */
function canSendToWorkshop(item: GalleryItemDto | null): boolean {
  return !!item && item.entryKind === 'model' && item.model?.ownerKind !== 'model' && !aggregate.value
}

/** 来源标签：agent=AI 助手产出，workshop=工坊产出，project=项目里已有的像素资产 */
function originLabel(origin: GalleryOrigin): string {
  return t(`gallery.origin.${origin}`)
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * 读取画廊：
 * - 已打开项目：只读该项目的 .kunyu/gallery/
 * - 未打开项目（主页进出）：汇总全部已登记项目的画作——AI 产出的画是资产，跨项目也拿来复用
 */
async function reload(): Promise<void> {
  loading.value = true
  try {
    const cur = currentRoot.value
    if (cur) {
      const name = projectStore.currentProject?.name ?? ''
      rows.value = (await window.api.content.galleryList(cur)).map((it) => ({
        ...it,
        projectRoot: cur,
        projectName: name
      }))
      return
    }
    if (projectStore.projects.length === 0) await projectStore.refresh()
    const projects = [...projectStore.projects].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
    const lists = await Promise.all(
      projects.map(async (p) => {
        try {
          const list = await window.api.content.galleryList(p.path)
          return list.map((it) => ({ ...it, projectRoot: p.path, projectName: p.name }))
        } catch {
          // 单个项目读取失败（路径失效等）不影响其余项目的画作
          return []
        }
      })
    )
    rows.value = lists.flat()
  } catch (err) {
    ElMessage.warning(t('gallery.msg.readGalleryFailed', { message: (err as Error).message }))
  } finally {
    loading.value = false
  }
}

onMounted(() => void reload())
watch(currentRoot, () => void reload())
// 汇总模式下新建/导入项目后，项目列表变化也要跟着刷新
watch(() => projectStore.projects.length, () => void reload())

function openPreview(item: GalleryRow): void {
  if (item.entryKind === 'model') {
    void openModelPreview(item)
    return
  }
  previewItem.value = item
  previewOpen.value = true
}

/** 打开 3D 预览：几何按需从磁盘读（列表里只有摘要），骨骼模型由工坊文档/geoJson 装配预览 */
async function openModelPreview(item: GalleryRow): Promise<void> {
  modelPreviewItem.value = item
  modelPreviewOpen.value = true
  modelAsset.value = null
  modelDocPreview.value = null
  modelLoading.value = true
  modelTexturePath.value = ''
  modelPathRef.value = ''
  modelFallbackHint.value = ''
  try {
    const m = item.model
    if (!m) return
    const content = await window.api.content.load(item.projectRoot, m.ownerKind, m.ownerId)
    modelAsset.value = readonlyModelAsset({ ownerKind: m.ownerKind, ownerId: m.ownerId }, content)
    if (!modelAsset.value) {
      const o = content as unknown as Record<string, unknown>
      const r =
        o.renderer && typeof o.renderer === 'object'
          ? (o.renderer as Record<string, unknown>)
          : null
      /* 预览补齐（P5-gallery）：骨骼模型不再只给文字清单——
         优先模型工坊文档（内嵌贴图，最接近创作态），退化 geoJson 导入（几何灰模） */
      modelDocPreview.value = await buildDocPreview(item.projectRoot, r)
      if (!modelDocPreview.value) {
        modelTexturePath.value =
          typeof r?.modelPath === 'string' && r.modelPath ? r.modelPath : ''
        modelPathRef.value =
          typeof r?.animationPath === 'string' && r.animationPath ? r.animationPath : ''
        modelFallbackHint.value =
          m.geometry === 'blockbench'
            ? t('gallery.msg.boneUnparsable')
            : t('gallery.msg.entryUnparsable')
      }
    }
  } catch (err) {
    modelFallbackHint.value = t('gallery.msg.readModelFailed', {
      message: (err as Error).message
    })
  } finally {
    modelLoading.value = false
  }
}

/** 贴图 data URL → 语义像素：复用 utils/pixels 的 dataUrlToSquarePixels（UV 已同步重缩放） */

/**
 * 骨骼条目 → ModelPreview 装配：ModelDocument 几何 → 预览元素[]（cube / mesh，v3 C4）。
 * 多贴图折叠到第一张（ModelPreview 单贴图约束）；UV 按主贴图 uvSize 重缩放到 S×S 画布；
 * 无贴图时 pixels 为空，ModelPreview 以中性灰占位（几何仍可辨）。
 */
async function buildDocPreview(
  projectRoot: string,
  renderer: Record<string, unknown> | null
): Promise<{ elements: PreviewElement[]; pixels: string[]; textureSize: number } | null> {
  let doc: ModelDocument | null = null
  const docId = typeof renderer?.modelerDocId === 'string' && renderer.modelerDocId ? renderer.modelerDocId : null
  if (docId) {
    try {
      const file = await window.api.fs.readFile(`${projectRoot}/.kunyu/modeler/${docId}.json`)
      doc = deserializeDocument(JSON.parse(file.content))
    } catch {
      doc = null // 文档丢失/损坏：退化 geoJson
    }
  }
  if (!doc) {
    const geoJson = typeof renderer?.geoJson === 'string' ? renderer.geoJson.trim() : ''
    if (!geoJson) return null
    try {
      doc = geoToDocument(geoJson).doc
    } catch {
      return null
    }
  }
  const elements = documentToElements(doc)
  if (elements.length === 0) return null
  const tex = Object.values(doc.textures)[0]
  if (!tex) return { elements, pixels: [], textureSize: 16 }
  const size = Math.min(64, Math.max(16, tex.width, tex.height))
  const [uw, uh] = tex.uvSize ?? [tex.width, tex.height]
  const ku = size / uw
  const kv = size / uh
  if (ku !== 1 || kv !== 1) {
    for (const el of elements) {
      if (isMeshElement(el)) {
        // mesh 逐顶点 UV（v3 C4）：按同一比例缩放，保持与贴图尺寸换算一致
        for (const face of el.faces) face.uv = face.uv.map(([u, v]) => [u * ku, v * kv])
        continue
      }
      for (const face of Object.values(el.faces)) {
        if (!face?.uv) continue
        face.uv = [face.uv[0] * ku, face.uv[1] * kv, face.uv[2] * ku, face.uv[3] * kv]
      }
    }
  }
  try {
    const pixels = await dataUrlToSquarePixels(tex.data, size)
    return { elements, pixels, textureSize: size }
  } catch {
    return { elements, pixels: [], textureSize: 16 } // 贴图解码失败不阻塞几何预览
  }
}

/** 关闭预览即释放 WebGL（ModelPreview 卸载时销毁渲染器），避免弹窗反复开关堆积实例 */
function onModelPreviewClosed(): void {
  modelPreviewItem.value = null
  modelAsset.value = null
  modelDocPreview.value = null
}

/** 导出 .bbmodel：仅独立模型资产有可导出的几何（内嵌模型没有独立文件） */
async function exportModel(item: GalleryRow): Promise<void> {
  const m = item.model
  if (m?.ownerKind !== 'model') return
  exporting.value = true
  try {
    const model = (await window.api.content.load(item.projectRoot, 'model', m.ownerId)) as ModelAsset
    if (model.kind !== 'model') {
      ElMessage.error(t('gallery.msg.notModelAsset'))
      return
    }
    const res = await window.api.content.exportBbmodel(item.projectRoot, model)
    if (res.canceled) return
    if (res.error) {
      ElMessage.error(res.error)
      return
    }
    ElMessage.success(
      res.path
        ? t('gallery.msg.exportedBbmodelPath', { path: res.path })
        : t('gallery.msg.exportedBbmodel')
    )
  } catch (err) {
    ElMessage.error(t('gallery.msg.exportFailed', { message: (err as Error).message }))
  } finally {
    exporting.value = false
  }
}

/** 送进模型工坊（P5-gallery）：定位/导入对象绑定的模型文档后跳模型工坊（保存才落盘） */
async function sendToWorkshop(item: GalleryRow | null): Promise<void> {
  const m = item?.model
  if (!item || !canSendToWorkshop(item) || !m) return
  const err = await useModelerStore().openForObject(
    m.ownerKind as 'block' | 'item' | 'entity',
    m.ownerId,
    m.ownerId
  )
  if (err) {
    ElMessage.error(err)
    return
  }
  modelPreviewOpen.value = false
  useUiStore().setActiveModule('modeler')
}

/** 打开「写回目标对象」：列目标项目的方块 / 物品 / 实体 */
async function openModelTarget(item: GalleryRow | null): Promise<void> {
  if (!item?.model) return
  modelTargetItem.value = item
  modelTargetKind.value =
    item.model.ownerKind === 'item' || item.model.ownerKind === 'block'
      ? item.model.ownerKind
      : 'block'
  modelTargetId.value = ''
  modelPreviewOpen.value = false
  modelTargetOpen.value = true
  try {
    const all = await window.api.content.list(item.projectRoot)
    modelTargetCandidates.value = all.filter(
      (c) => c.kind === 'block' || c.kind === 'item' || c.kind === 'entity'
    )
  } catch (err) {
    modelTargetCandidates.value = []
    ElMessage.warning(t('gallery.msg.readObjectsFailed', { message: (err as Error).message }))
  }
}

async function confirmModelTarget(): Promise<void> {
  const item = modelTargetItem.value
  if (!item?.model || !modelTargetId.value) return
  modelApplying.value = true
  try {
    const src = { ownerKind: item.model.ownerKind, ownerId: item.model.ownerId }
    const target = { kind: modelTargetKind.value, id: modelTargetId.value }
    let res = await window.api.content.modelApplyCandidate(item.projectRoot, src, item.projectRoot, target)
    if (!res.ok && res.needsConfirm) {
      try {
        await ElMessageBox.confirm(
          res.errorMessage,
          t('gallery.msg.replaceTitle'),
          {
            type: 'warning',
            confirmButtonText: t('gallery.msg.stillWrite'),
            cancelButtonText: t('gallery.cancel')
          }
        )
      } catch {
        return
      }
      res = await window.api.content.modelApplyCandidate(
        item.projectRoot,
        src,
        item.projectRoot,
        target,
        true
      )
    }
    if (!res.ok) {
      ElMessage.error(res.errorMessage)
      return
    }
    ElMessage.success(
      t('gallery.msg.applied', {
        kind: modelTargetKind.value,
        id: modelTargetId.value
      }) + (res.replacedGeo ? t('gallery.msg.appliedCleared') : '')
    )
    modelTargetOpen.value = false
    void reload()
  } catch (err) {
    ElMessage.error(t('gallery.msg.writeBackFailed', { message: (err as Error).message }))
  } finally {
    modelApplying.value = false
  }
}

/** 写回资产：结果提示 + 不刷新画廊（画廊内容不受影响） */
async function applyPixels(
  root: string,
  kind: 'item' | 'block' | 'model',
  id: string,
  pixels: string[],
  size: 16 | 32
): Promise<boolean> {
  if (!root) return false
  applying.value = true
  try {
    const res = await window.api.content.applyTextureCandidate(root, kind, id, pixels, size)
    if (!res.ok) {
      ElMessage.error(res.errorMessage)
      return false
    }
    ElMessage.success(
      res.pngWritten
        ? t('gallery.msg.pngWritten', { kind, id, path: res.relPath ?? '' })
        : t('gallery.msg.pixelWrittenNoPng', { kind, id, path: res.relPath ?? '' })
    )
    return true
  } catch (err) {
    ElMessage.error(t('gallery.msg.writeBackFailed', { message: (err as Error).message }))
    return false
  } finally {
    applying.value = false
  }
}

/** 「用于资产」：已绑定资产直接写回；未绑定的画先选目标资产 */
async function onUse(item: GalleryRow): Promise<void> {
  if (item.assetKind !== 'free' && item.assetId) {
    const ok = await applyPixels(
      item.projectRoot,
      item.assetKind,
      item.assetId,
      item.pixels,
      item.size
    )
    if (ok) previewOpen.value = false
    return
  }
  previewOpen.value = false
  pendingPixels.value = [...item.pixels]
  pendingSize.value = item.size
  pickKind.value = item.size === 32 ? 'model' : 'item'
  pickId.value = ''
  await loadPickCandidates(item.projectRoot)
  pickOpen.value = true
}

async function loadPickCandidates(root: string): Promise<void> {
  pickRoot.value = root
  if (!root) return
  try {
    const all = await window.api.content.list(root)
    pickCandidates.value = all.filter((c) => c.kind === 'item' || c.kind === 'model')
  } catch (err) {
    pickCandidates.value = []
    ElMessage.warning(t('gallery.msg.readAssetsFailed', { message: (err as Error).message }))
  }
}

function onPickKindChange(): void {
  pickId.value = ''
}

async function confirmPick(): Promise<void> {
  if (!pickId.value) return
  const ok = await applyPixels(
    pickRoot.value,
    pickKind.value,
    pickId.value,
    pendingPixels.value,
    pendingSize.value
  )
  if (ok) pickOpen.value = false
}

/** 工坊编辑：用画廊条目当底稿打开重绘弹窗（首次出图已存档，这里不新增 AI 额度消耗） */
function openWorkshop(item: GalleryRow): void {
  previewOpen.value = false
  workshopSource.value = item
  workshopRoot.value = item.projectRoot
  workshopSize.value = item.size
  workshopPixels.value = [...item.pixels]
  workshopOpen.value = true
}

/** 工坊里点「采用候选」：按源条目的绑定情况写回 */
async function onWorkshopApplied(pixels: string[]): Promise<void> {
  const src = workshopSource.value
  if (src && src.assetKind !== 'free' && src.assetId) {
    await applyPixels(src.projectRoot, src.assetKind, src.assetId, pixels, src.size)
    void reload()
    return
  }
  pendingPixels.value = [...pixels]
  pendingSize.value = workshopSize.value
  pickKind.value = workshopSize.value === 32 ? 'model' : 'item'
  pickId.value = ''
  await loadPickCandidates(src?.projectRoot ?? workshopRoot.value)
  pickOpen.value = true
}

async function onDelete(item: GalleryRow): Promise<void> {
  const owner =
    aggregate.value && item.projectName
      ? t('gallery.msg.deleteOwner', { name: item.projectName })
      : ''
  try {
    await ElMessageBox.confirm(t('gallery.msg.deleteBody', { owner }), t('gallery.msg.deleteTitle'), {
      type: 'warning',
      confirmButtonText: t('gallery.delete'),
      cancelButtonText: t('gallery.cancel')
    })
  } catch {
    return
  }
  const ok = await window.api.content.galleryDelete(item.projectRoot, item.id)
  if (ok) {
    rows.value = rows.value.filter((it) => !(it.id === item.id && it.projectRoot === item.projectRoot))
    if (previewItem.value?.id === item.id) previewOpen.value = false
    ElMessage.success(t('gallery.msg.deleted'))
  } else {
    ElMessage.warning(t('gallery.msg.deleteFailed'))
    void reload()
  }
}

/* ───────── 分享包（原 KunYu 社区：导入 / 导出 / 发布入口） ───────── */

/**
 * 分享包导出目标：把资产行映射回它所属的内容对象。
 * - 独立模型资产 → model；内嵌模型 → 其归属对象（方块/物品/实体）
 * - 绑定对象的画 → 该对象；自由画没有内容对象，不可导出
 */
function shareTargetOf(item: GalleryItemDto | null): { kind: ContentKind; id: string } | null {
  if (!item) return null
  if (item.entryKind === 'model' && item.model) {
    return { kind: item.model.ownerKind, id: item.model.ownerId }
  }
  if (item.assetKind !== 'free' && item.assetId) {
    return { kind: item.assetKind, id: item.assetId }
  }
  return null
}

function kindLabel(kind: ContentKind): string {
  const key = `gallery.contentKind.${kind}`
  return te(key) ? t(key) : kind
}

/** 许可证预设 id → 语言包键（点分键不能含 '.'，故映射为短名） */
const LICENSE_KEYS: Record<string, string> = {
  MIT: 'mit',
  'CC-BY-4.0': 'ccBy',
  'CC-BY-NC-4.0': 'ccByNc',
  'LEARNING-ONLY': 'learningOnly',
  ARR: 'arr'
}

function licensePresetText(
  id: string,
  field: 'label' | 'desc',
  fallback: string
): string {
  const short = LICENSE_KEYS[id]
  if (!short) return fallback
  const key = `gallery.license.${short}.${field}`
  return te(key) ? t(key) : fallback
}

function licenseLabel(id?: string): string {
  if (!id) return t('gallery.undeclared')
  const preset = KY_SHARE_LICENSES.find((l) => l.id === id)
  return preset ? licensePresetText(preset.id, 'label', preset.label) : id
}

/** 打开导入：默认落到当前打开的项目；汇总模式下让用户从全部已登记项目里选 */
async function openImportShare(): Promise<void> {
  if (projectStore.projects.length === 0) await projectStore.refresh()
  importTarget.value = currentRoot.value ?? ''
  importPreview.value = null
  importShareOpen.value = true
}

function resetImportShare(): void {
  importPreview.value = null
}

/** 第一阶段：读包生成预览（不落盘），展示 loader / 版本 / 许可证等元数据 */
async function pickSharePackage(): Promise<void> {
  if (!importTarget.value) return
  importingShare.value = true
  try {
    const r = await window.api.kunyu.importCreation(importTarget.value, false, { preview: true })
    if (!r) return // 用户取消文件选择
    if (r.status !== 'preview') return
    importPreview.value = r
  } catch (err) {
    ElMessage.error(t('gallery.msg.readShareFailed', { message: (err as Error).message }))
  } finally {
    importingShare.value = false
  }
}

/** 第二阶段：回传文件路径执行真实导入；冲突时按预览结果直接覆盖 */
async function confirmImportShare(): Promise<void> {
  const preview = importPreview.value
  if (!preview) return
  importingShare.value = true
  try {
    const r = await window.api.kunyu.importCreation(importTarget.value, preview.conflict, {
      filePath: preview.filePath
    })
    if (!r || r.status !== 'imported') return
    ElMessage.success(
      t('gallery.msg.imported', {
        kind: r.kind ? kindLabel(r.kind) : t('gallery.fieldContent'),
        name: r.displayName ?? r.id ?? ''
      })
    )
    importShareOpen.value = false
    await reload()
  } catch (err) {
    ElMessage.error(t('gallery.msg.importFailed', { message: (err as Error).message }))
  } finally {
    importingShare.value = false
  }
}

function openExportShare(item: GalleryRow): void {
  if (!shareTargetOf(item)) return
  exportShareItem.value = item
  exportLicense.value = ''
  exportShareOpen.value = true
}

async function confirmExportShare(): Promise<void> {
  const item = exportShareItem.value
  const target = shareTargetOf(item)
  if (!item || !target) return
  exportingShare.value = true
  try {
    const r = await window.api.kunyu.exportCreation({
      projectPath: item.projectRoot,
      kind: target.kind,
      id: target.id,
      license: exportLicense.value || undefined
    })
    if (r) {
      ElMessage.success(t('gallery.msg.exportedShare', { path: r.filePath }))
      exportShareOpen.value = false
    }
  } catch (err) {
    ElMessage.error(t('gallery.msg.exportFailed', { message: (err as Error).message }))
  } finally {
    exportingShare.value = false
  }
}

/** 显式外部打开仅允许 https（安全约束） */
function openSite(url: string): void {
  if (/^https:\/\//i.test(url)) void window.api.shell.openExternal(url)
}
</script>

<style scoped>
.gallery-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 16px 20px;
  gap: 14px;
  overflow: hidden;
}

.gallery-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.gallery-header h2 {
  margin: 0 0 4px;
  font-size: 18px;
}

.gallery-header p {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: 13px;
  max-width: 760px;
}

.gallery-header code {
  font-family: var(--ky-mono, monospace);
  font-size: 12px;
  background: var(--el-fill-color-light);
  border-radius: 3px;
  padding: 0 4px;
}

.gallery-header-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.gallery-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
}

.gallery-search {
  width: 280px;
}

.gallery-count {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.gallery-card {
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
}

.gallery-empty {
  color: var(--el-text-color-secondary);
  font-size: 13px;
  padding: 28px 16px;
  text-align: center;
  line-height: 1.7;
}

.gallery-scroll {
  flex: 1;
  min-height: 0;
}

/* 汇总模式：按项目分组，组标题带项目名与张数 */
.gallery-group-title {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 4px 0 10px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.gallery-group + .gallery-group {
  margin-top: 22px;
}

.gallery-group-count {
  font-size: 11px;
  font-weight: 400;
  color: var(--el-text-color-secondary);
}

.gallery-pick-project {
  font-size: 12px;
  color: var(--el-text-color-primary);
  word-break: break-all;
}

.gallery-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 12px;
  padding: 2px 2px 16px;
}

.gallery-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
  padding: 10px;
}

.gallery-thumb {
  position: relative;
  padding: 0;
  border: 1px solid var(--el-border-color-light);
  border-radius: 6px;
  background-color: var(--el-fill-color-light);
  cursor: zoom-in;
  overflow: hidden;
  aspect-ratio: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.gallery-thumb-size {
  position: absolute;
  left: 4px;
  bottom: 4px;
  font-size: 10px;
  font-family: var(--ky-mono, monospace);
  color: #fff;
  background: rgba(0, 0, 0, 0.55);
  border-radius: 3px;
  padding: 0 4px;
}

.gallery-item-prompt {
  margin: 0;
  font-size: 12px;
  line-height: 1.4;
  min-height: 34px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.gallery-item-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  font-size: 11px;
  color: var(--el-text-color-secondary);
}

.gallery-tag {
  border-radius: 3px;
  padding: 0 5px;
  background: var(--el-fill-color);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 68%;
}

.gallery-tag-item {
  color: var(--el-color-primary);
}

.gallery-tag-model {
  color: var(--el-color-success);
}

.gallery-tag-block {
  color: var(--el-color-warning);
}

.gallery-item-time {
  white-space: nowrap;
}

.gallery-item-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  border-top: 1px solid var(--el-border-color-lighter);
  padding-top: 4px;
  margin-top: 2px;
}

.gallery-preview {
  display: flex;
  gap: 18px;
}

/* 3D 模型卡片：不渲染 WebGL，只给几何摘要（点开才在弹窗里真渲染） */
.gallery-thumb-model {
  cursor: pointer;
  background: linear-gradient(135deg, var(--el-fill-color-light), var(--el-fill-color));
}

.gallery-model-poster {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 0 8px;
  text-align: center;
}

/* 模型贴图封面：与普通贴图同样铺满，保持像素硬边 */
.gallery-model-tex {
  width: 100%;
  height: 100%;
}

/* 右上角几何类型角标：贴图封面也能一眼区分立方体 / 骨骼 */
.gallery-model-corner {
  position: absolute;
  top: 4px;
  right: 4px;
  font-size: 10px;
  line-height: 14px;
  padding: 0 4px;
  border-radius: 3px;
  background: rgb(0 0 0 / 55%);
  color: #fff;
  pointer-events: none;
}

.gallery-model-glyph {
  width: 34px;
  height: 34px;
  color: var(--el-text-color-placeholder);
}

.gallery-model-badge {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 3px;
  color: var(--el-color-success);
  background: color-mix(in srgb, var(--el-color-success) 12%, transparent);
}

.gallery-model-count {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  line-height: 1.4;
  word-break: break-all;
}

/* 3D 预览：单实例 WebGL，弹窗关闭即卸载 */
.gallery-model-preview {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.gallery-model-stage {
  height: 420px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 6px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: var(--el-fill-color-light);
}

.gallery-model-hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  padding: 0 16px;
  text-align: center;
}

.gallery-model-fallback {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  width: 100%;
  align-self: stretch;
}

.gallery-model-tip {
  margin: 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.gallery-preview-stage {
  width: 220px;
  height: 220px;
  flex-shrink: 0;
  border: 1px solid var(--el-border-color-light);
  border-radius: 6px;
  background-color: var(--el-fill-color-light);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.gallery-preview-meta {
  flex: 1;
  min-width: 0;
  margin: 0;
  display: grid;
  grid-template-columns: 68px 1fr;
  gap: 6px 10px;
  font-size: 12px;
  align-content: start;
}

.gallery-preview-meta dt {
  color: var(--el-text-color-secondary);
}

.gallery-preview-meta dd {
  margin: 0;
  word-break: break-all;
}

.gallery-preview-palette {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  align-items: center;
}

.gallery-swatch {
  width: 14px;
  height: 14px;
  border-radius: 3px;
  border: 1px solid var(--el-border-color-light);
}

.gallery-dim {
  color: var(--el-text-color-placeholder);
}

.gallery-pick {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.gallery-pick-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.gallery-pick-label {
  width: 68px;
  flex-shrink: 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.gallery-pick-select {
  flex: 1;
}

.gallery-pick-tip {
  margin: 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.6;
}

/* 发布到公开平台（原 KunYu 社区入口） */
.gallery-publish {
  flex: none;
  padding-top: 10px;
  border-top: 1px solid var(--el-border-color-lighter);
}
.gallery-publish-head {
  font-size: 12px;
  font-weight: 600;
  color: var(--el-text-color-secondary);
  margin-bottom: 6px;
}
.gallery-publish-row {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 8px;
}
.gallery-publish-card {
  position: relative;
  padding: 8px 10px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 6px;
  cursor: pointer;
  transition: border-color 0.15s;
}
.gallery-publish-card:hover {
  border-color: var(--el-color-primary);
}
.gallery-publish-name {
  font-size: 12px;
  font-weight: 600;
}
.gallery-publish-desc {
  margin-top: 2px;
  font-size: 11px;
  line-height: 1.4;
  color: var(--el-text-color-secondary);
  padding-right: 14px;
}
.gallery-publish-go {
  position: absolute;
  top: 8px;
  right: 8px;
  color: var(--el-text-color-secondary);
}

/* 分享包对话框 */
.gallery-share-alert {
  margin-bottom: 10px;
}
.gallery-share-license-desc {
  float: right;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.gallery-share-hint {
  margin-top: 8px;
}
</style>
