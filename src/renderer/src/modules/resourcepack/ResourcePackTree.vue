<template>
  <div class="rpt">
    <!-- 包根文件：pack.mcmeta / pack.png -->
    <div v-if="rootFiles.length > 0" class="rpt-group">
      <div class="rpt-head" :title="t('resourcepack.tree.rootTitle')">
        <span class="rpt-label">{{ t('resourcepack.tree.root') }}</span>
      </div>
      <div
        v-for="f in rootFiles"
        :key="f.relPath"
        class="rpt-item"
        :class="{ active: isActive(f) }"
        :title="f.relPath"
        @click="onSelect(f)"
      >
        <span class="rpt-ext">{{ f.ext.slice(1) || 'file' }}</span>
        <span class="rpt-name">{{ f.relPath }}</span>
      </div>
    </div>

    <div v-for="cat in categories" :key="cat.key" class="rpt-group">
      <div class="rpt-head" :title="catHint(cat)">
        <span class="rpt-label">{{ catLabel(cat) }}</span>
        <span v-if="byCategory(cat.key).length > 0" class="rpt-count">
          {{ byCategory(cat.key).length }}
        </span>
        <el-icon
          v-if="cat.creatable"
          class="rpt-add"
          :title="cat.defaultExt === '.png' ? t('resourcepack.tree.createTexture') : t('resourcepack.tree.createText')"
          @click="onCreate(cat.key)"
        ><Plus /></el-icon>
        <el-icon
          v-if="cat.key === 'sound'"
          class="rpt-add"
          :title="t('resourcepack.tree.importSound')"
          @click="onImport(cat.key)"
        ><Upload /></el-icon>
      </div>
      <template v-if="byCategory(cat.key).length > 0">
        <div
          v-for="f in byCategory(cat.key)"
          :key="f.relPath"
          class="rpt-item"
          :class="{ active: isActive(f), readonly: !isOpenable(f) }"
          :title="isOpenable(f) ? f.relPath : t('resourcepack.tree.binaryReadonly', { path: f.relPath })"
          @click="onSelect(f)"
        >
          <img
            v-if="f.category === 'texture' && f.ext === '.png' && thumbOf(f)"
            class="rpt-thumb"
            :src="thumbOf(f)"
            alt=""
          />
          <span v-else class="rpt-ext">{{ f.ext.slice(1) }}</span>
          <span class="rpt-name">{{ f.id }}</span>
          <el-icon class="rpt-del" :title="t('resourcepack.tree.delete')" @click.stop="onDelete(f)"><Delete /></el-icon>
        </div>
      </template>
      <p v-else class="rpt-empty">{{ t('resourcepack.tree.empty') }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * ResourcePackTree：资源包分类文件树（窄栏）。
 * 包根固定文件单独分组；文本与 texture 类别的 .png 可编辑，其余二进制标记只读。
 * 通过 resourcepack store 与主编辑区共享状态（文件列表、选中、新建/删除信号）。
 */
import { computed } from 'vue'
import { Delete, Plus, Upload } from '@element-plus/icons-vue'
import type {
  ResourceCategoryInfo,
  ResourceFileCategory,
  ResourcePackFile
} from '../../../../shared/schemas/resourcepack.schema'
import { getResourceCategories } from '../../../../shared/schemas/resourcepack.schema'
import { useResourcePackStore } from '../../stores/resourcepack'
import { t, te, locale } from '../../i18n'

const store = useResourcePackStore()

/** 类别注册表随语言切换重建（冻结常量为 zh-CN） */
const categories = computed(() => getResourceCategories(locale.value))

const files = computed(() => store.files)
const active = computed(() => store.active)

/** 类别文案走语言包，缺失时回落共享注册表里的中文原名（第三方/新增类别不受影响） */
function catText(cat: ResourceCategoryInfo, field: 'label' | 'hint'): string {
  const key = `resourcepack.category.${cat.key}.${field}`
  return te(key) ? t(key) : cat[field]
}

function catLabel(cat: ResourceCategoryInfo): string {
  return catText(cat, 'label')
}

function catHint(cat: ResourceCategoryInfo): string {
  return catText(cat, 'hint')
}

const rootFiles = computed(() => files.value.filter((f) => f.category === 'root'))

function byCategory(cat: ResourceFileCategory): ResourcePackFile[] {
  return files.value.filter((f) => f.category === cat)
}

function isActive(f: ResourcePackFile): boolean {
  return active.value?.relPath === f.relPath
}

/** 可编辑：文本走源码编辑；texture 类别的 .png 走像素画编辑器；其余二进制只读 */
function isOpenable(f: ResourcePackFile): boolean {
  return f.editable || (f.category === 'texture' && f.ext === '.png')
}

function onSelect(f: ResourcePackFile): void {
  store.select(f)
}

function onCreate(cat: ResourceFileCategory): void {
  store.requestCreate(cat)
}

function onDelete(f: ResourcePackFile): void {
  store.requestDelete(f)
}

function onImport(cat: ResourceFileCategory): void {
  store.requestImport(cat)
}

/** 贴图缩略图（懒加载：未缓存时触发一次 IPC，失败/加载中回落到扩展名徽章） */
function thumbOf(f: ResourcePackFile): string {
  const hit = store.thumbs[f.relPath]
  if (hit === undefined) {
    void store.ensureThumb(f.relPath)
    return ''
  }
  return hit
}
</script>

<style scoped>
.rpt {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px;
  min-height: 100%;
}
.rpt-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.rpt-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 4px;
}
.rpt-label {
  flex: 1;
  min-width: 0;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--ky-text-sub);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.rpt-count {
  font-size: 10px;
  color: var(--ky-text-dim);
}
.rpt-add {
  flex-shrink: 0;
  font-size: 13px;
  color: var(--ky-text-dim);
  cursor: pointer;
  padding: 2px;
}
.rpt-add:hover {
  color: var(--ky-accent);
}
.rpt-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 6px;
  cursor: pointer;
  border: 1px solid transparent;
}
.rpt-item:hover {
  background: var(--ky-bg-hover);
}
.rpt-item.active {
  background: color-mix(in srgb, var(--ky-accent) 16%, transparent);
  border-color: color-mix(in srgb, var(--ky-accent) 45%, transparent);
}
.rpt-item.readonly {
  opacity: 0.72;
}
.rpt-ext {
  flex-shrink: 0;
  font-size: 9px;
  font-weight: 600;
  color: var(--ky-accent);
  opacity: 0.75;
  min-width: 30px;
  text-align: center;
}
.rpt-thumb {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  border-radius: 4px;
  image-rendering: pixelated;
  background: repeating-conic-gradient(rgba(255, 255, 255, 0.08) 0% 25%, transparent 0% 50%) 0 0 / 8px 8px;
  border: 1px solid var(--ky-border);
  object-fit: contain;
}
.rpt-name {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  color: var(--ky-text);
  font-family: var(--ky-mono, monospace);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.rpt-del {
  flex-shrink: 0;
  font-size: 13px;
  color: var(--ky-text-dim);
  opacity: 0;
  cursor: pointer;
  padding: 2px;
}
.rpt-item:hover .rpt-del {
  opacity: 1;
}
.rpt-del:hover {
  color: #f38ba8;
}
.rpt-empty {
  margin: 0;
  padding: 2px 8px;
  font-size: 11px;
  color: var(--ky-text-dim);
  opacity: 0.7;
}
</style>
