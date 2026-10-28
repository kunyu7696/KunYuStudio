<template>
  <div class="spt">
    <div v-for="cat in categories" :key="cat.key" class="spt-group">
      <el-tooltip
        :content="buildCategoryTip(cat)"
        placement="right"
        :show-after="150"
        effect="dark"
      >
        <div class="spt-head">
          <span class="spt-label">{{ cat.label }}</span>
        <span v-if="byCategory(cat.key).length > 0" class="spt-count">
          {{ byCategory(cat.key).length }}
        </span>
        <el-icon
          v-if="cat.creatable"
          class="spt-add"
          title="新建文件"
          @click="onCreate(cat.key)"
        ><Plus /></el-icon>
        </div>
      </el-tooltip>
      <template v-if="byCategory(cat.key).length > 0">
        <div
          v-for="f in byCategory(cat.key)"
          :key="f.relPath"
          class="spt-item"
          :class="{ active: isActive(f) }"
          :title="f.relPath"
          @click="onSelect(f)"
        >
          <span class="spt-ext">{{ f.ext.slice(1) }}</span>
          <span class="spt-name">{{ f.id }}</span>
          <el-icon class="spt-del" title="删除" @click.stop="onDelete(f)"><Delete /></el-icon>
        </div>
      </template>
      <p v-else class="spt-empty">暂无</p>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * ShaderPackTree：光影包分类文件树（窄栏）。
 * 按管线阶段分组（gbuffers/shadow/prepare/composite/deferred/final）+ lib/lang/config；
 * config（shaders.properties）为固定文件不允许新建，仅可编辑。
 * 通过 shaderpack store 与主编辑区共享状态。
 */
import { computed } from 'vue'
import { Delete, Plus } from '@element-plus/icons-vue'
import type {
  ShaderCategoryInfo,
  ShaderFileCategory,
  ShaderPackFile
} from '../../../../shared/schemas/shaderpack.schema'
import { getShaderCategories } from '../../../../shared/schemas/shaderpack.schema'
import { useShaderPackStore } from '../../stores/shaderpack'
import { locale } from '../../i18n'

const store = useShaderPackStore()

/** 类别注册表随语言切换重建（冻结常量为 zh-CN） */
const categories = computed(() => getShaderCategories(locale.value))

const files = computed(() => store.files)
const active = computed(() => store.active)

function byCategory(cat: ShaderFileCategory): ShaderPackFile[] {
  return files.value.filter((f) => f.category === cat)
}

function isActive(f: ShaderPackFile): boolean {
  return active.value?.relPath === f.relPath
}

function onSelect(f: ShaderPackFile): void {
  store.select(f)
}

function onCreate(cat: ShaderFileCategory): void {
  store.requestCreate(cat)
}

/**
 * 生成分类节点的 tooltip 内容：hint + 子 pass 清单（含后备链箭头）。
 * 纯文本（el-tooltip effect="dark" 直接渲染）。
 */
function buildCategoryTip(cat: ShaderCategoryInfo): string {
  const lines: string[] = [cat.hint]
  if (cat.subpasses && cat.subpasses.length > 0) {
    lines.push('')
    lines.push('— 子 pass 清单 —')
    for (const sp of cat.subpasses) {
      const fallback = sp.fallbackTo ? `  → ${sp.fallbackTo}` : ''
      const fogTag = sp.fogAffected === false ? '（不受雾）' : ''
      lines.push(`  • ${sp.name}${fogTag}${fallback}`)
    }
  }
  return lines.join('\n')
}

function onDelete(f: ShaderPackFile): void {
  store.requestDelete(f)
}
</script>

<style scoped>
.spt {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px;
  min-height: 100%;
}
.spt-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.spt-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 4px;
}
.spt-label {
  flex: 1;
  min-width: 0;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--ky-text-sub);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.spt-count {
  font-size: 10px;
  color: var(--ky-text-dim);
}
.spt-add {
  flex-shrink: 0;
  font-size: 13px;
  color: var(--ky-text-dim);
  cursor: pointer;
  padding: 2px;
}
.spt-add:hover {
  color: var(--ky-accent);
}
.spt-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 6px;
  cursor: pointer;
  border: 1px solid transparent;
}
.spt-item:hover {
  background: var(--ky-bg-hover);
}
.spt-item.active {
  background: color-mix(in srgb, var(--ky-accent) 16%, transparent);
  border-color: color-mix(in srgb, var(--ky-accent) 45%, transparent);
}
.spt-ext {
  flex-shrink: 0;
  font-size: 9px;
  font-weight: 600;
  color: var(--ky-accent);
  opacity: 0.75;
  width: 26px;
  text-align: center;
}
.spt-name {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  color: var(--ky-text);
  font-family: var(--ky-mono, monospace);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.spt-del {
  flex-shrink: 0;
  font-size: 13px;
  color: var(--ky-text-dim);
  opacity: 0;
  cursor: pointer;
  padding: 2px;
}
.spt-item:hover .spt-del {
  opacity: 1;
}
.spt-del:hover {
  color: #f38ba8;
}
.spt-empty {
  margin: 0;
  padding: 2px 8px;
  font-size: 11px;
  color: var(--ky-text-dim);
  opacity: 0.7;
}
</style>
