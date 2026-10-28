<template>
  <div class="mw">
    <!-- 顶部工具条 -->
    <header class="mw-toolbar">
      <!-- B3-2 多文档标签页 -->
      <div v-if="store.openDocIds.length > 1" class="mw-doc-tabs">
        <div
          v-for="id in store.openDocIds"
          :key="id"
          class="mw-doc-tab"
          :class="{ 'is-active': store.doc?.id === id }"
          @click="store.open(id)"
        >
          <span class="mw-doc-tab-label">{{ id }}</span>
          <el-icon class="mw-doc-tab-close" @click.stop="onCloseTab(id)"><Close /></el-icon>
        </div>
      </div>
      <el-select
        v-else
        class="mw-doc-select"
        :model-value="store.doc?.id ?? ''"
        :placeholder="t('modeler.workbench.openDoc')"
        size="small"
        filterable
        :loading="store.loading"
        @update:model-value="(v: string | number | boolean | undefined) => typeof v === 'string' && v && store.open(v)"
      >
        <el-option v-for="id in store.docIds" :key="id" :label="id" :value="id" />
      </el-select>

      <el-button size="small" @click="onCreate">{{ t('modeler.workbench.newDoc') }}</el-button>
      <el-button size="small" :disabled="!store.dirty" :title="t('modeler.workbench.saveTip')" @click="store.save()">{{ t('modeler.workbench.save') }}</el-button>
      <!-- bbmodel 互操作（P5-bbmodel）：导入整文档 / 导出当前文档 -->
      <el-button size="small" :title="t('modeler.workbench.importBbTip')" @click="store.importBbmodel()">{{ t('modeler.workbench.importBb') }}</el-button>
      <el-button size="small" :disabled="!store.doc" :title="t('modeler.workbench.exportBbTip')" @click="store.exportBbmodel()">{{ t('modeler.workbench.exportBb') }}</el-button>
      <!-- glTF 2.0 导出（B5-1）：.gltf + .bin + PNG 贴图 -->
      <el-button size="small" :disabled="!store.doc" :title="t('modeler.workbench.exportGltfTip')" @click="store.exportGltf()">{{ t('modeler.workbench.exportGltf') }}</el-button>
      <el-button size="small" :title="t('modeler.workbench.importObjTip')" @click="store.importObj()">{{ t('modeler.workbench.importObj') }}</el-button>
      <el-button size="small" :disabled="!store.doc" :title="t('modeler.workbench.exportObjTip')" @click="store.exportObj()">{{ t('modeler.workbench.exportObj') }}</el-button>
      <!-- Bedrock geo.json（C9）：Entity / Block / GeckoLib 共用 codec -->
      <el-button size="small" :title="t('modeler.workbench.importBedrockTip')" @click="store.importBedrockGeo()">{{ t('modeler.workbench.importBedrock') }}</el-button>
      <el-button size="small" :disabled="!store.doc" :title="t('modeler.workbench.exportBedrockTip')" @click="store.exportBedrockGeo()">{{ t('modeler.workbench.exportBedrock') }}</el-button>
      <!-- Collada / FBX 互操作（C5）：均导入为新模型文档 -->
      <el-button size="small" :title="t('modeler.workbench.importDaeTip')" @click="store.importDae()">{{ t('modeler.workbench.importDae') }}</el-button>
      <el-button size="small" :title="t('modeler.workbench.importFbxTip')" @click="store.importFbx()">{{ t('modeler.workbench.importFbx') }}</el-button>
      <!-- glTF 2.0 导入（C7）：嵌入式 base64 buffer .gltf → 新模型文档 -->
      <el-button size="small" :title="t('modeler.workbench.importGltfTip')" @click="store.importGltf()">{{ t('modeler.workbench.importGltf') }}</el-button>
      <!-- OptiFine CEM 互操作（B5-3）：.jem 整实体模型 / .jpm 部件 -->
      <el-button size="small" :title="t('modeler.workbench.importJemTip')" @click="store.importJem()">{{ t('modeler.workbench.importJem') }}</el-button>
      <el-button size="small" :disabled="!store.doc" :title="t('modeler.workbench.exportJemTip')" @click="store.exportJem()">{{ t('modeler.workbench.exportJem') }}</el-button>
      <el-button size="small" :title="t('modeler.workbench.importJpmTip')" @click="store.importJpm()">{{ t('modeler.workbench.importJpm') }}</el-button>
      <el-button size="small" :disabled="!store.doc" :title="t('modeler.workbench.exportJpmTip')" @click="store.exportJpm()">{{ t('modeler.workbench.exportJpm') }}</el-button>
      <!-- MC 皮肤互操作（B5-4）：64×64 / 64×32 皮肤 PNG 双向 -->
      <el-button size="small" :title="t('modeler.workbench.importSkinTip')" @click="store.importSkin()">{{ t('modeler.workbench.importSkin') }}</el-button>
      <el-button size="small" :disabled="!store.doc" :title="t('modeler.workbench.exportSkinTip')" @click="store.exportSkin()">{{ t('modeler.workbench.exportSkin') }}</el-button>
      <!-- 实体几何写回（P3-f）：仅实体几何格式文档显示 -->
      <el-button
        v-if="store.doc && (store.doc.format === 'bedrock_entity' || store.doc.format === 'geckolib')"
        size="small"
        @click="onApplyToEntityOpen"
      >{{ t('modeler.workbench.applyToEntity') }}</el-button>
      <!-- 对象模型写回（P5-open）：仅 Java 方块/物品格式文档显示 -->
      <el-button
        v-if="store.doc && store.doc.format === 'java_block'"
        size="small"
        @click="onApplyToObjectOpen"
      >{{ t('modeler.workbench.applyToObject') }}</el-button>
      <!-- 回跳关联对象（P5-open）：绑定文档（<type>__<id>）显示 -->
      <el-button
        v-if="boundObject"
        size="small"
        :title="t('modeler.workbench.openBoundTip')"
        @click="onOpenBoundObject"
      >{{ t('modeler.workbench.openBound') }}</el-button>

      <el-select
        class="mw-format-select"
        :model-value="store.doc?.format ?? ''"
        size="small"
        :disabled="!store.doc"
        :title="t('modeler.workbench.formatTip')"
        @update:model-value="
          (v: string | number | boolean | undefined) => {
            if (typeof v === 'string' && v) void onFormatSwitch(v as FormatId)
          }
        "
      >
        <el-option v-for="f in formatOptions" :key="f.id" :label="f.name" :value="f.id" />
      </el-select>

      <el-divider direction="vertical" />
      <el-button-group>
        <el-button size="small" :disabled="!store.canUndo" :title="t('modeler.workbench.undoTip')" @click="store.undo()">{{ t('modeler.workbench.undo') }}</el-button>
        <el-button size="small" :disabled="!store.canRedo" :title="t('modeler.workbench.redoTip')" @click="store.redo()">{{ t('modeler.workbench.redo') }}</el-button>
      </el-button-group>

      <el-divider direction="vertical" />
      <el-button-group>
        <el-button size="small" :disabled="!store.doc" @click="store.addCube()">{{ t('modeler.workbench.addCube') }}</el-button>
        <el-button size="small" :disabled="!store.doc" @click="store.addGroup()">{{ t('modeler.workbench.addGroup') }}</el-button>
        <el-button size="small" :disabled="!store.doc" @click="store.addLocator()">{{ t('modeler.workbench.addLocator') }}</el-button>
        <el-button size="small" :disabled="!store.doc" :title="t('modeler.workbench.addMeshTip')" @click="store.addMesh()">{{ t('modeler.workbench.addMesh') }}</el-button>
      </el-button-group>
      <el-button
        size="small"
        :disabled="!store.doc || store.selection.length === 0"
        :title="t('modeler.workbench.removeSelectedTip')"
        @click="store.removeSelected()"
      >
        {{ t('modeler.workbench.removeSelected') }}
      </el-button>

      <span class="mw-doc-name">{{ store.doc?.name ?? '' }}</span>
      <span v-if="store.dirty" class="mw-dirty">{{ t('modeler.workbench.unsaved') }}</span>
    </header>

    <!-- 空态 -->
    <div v-if="!store.doc" class="mw-empty">
      <p class="mw-empty-title">{{ t('modeler.workbench.emptyTitle') }}</p>
      <p class="mw-empty-hint">{{ t('modeler.workbench.emptyHint') }}</p>
      <el-button type="primary" size="small" @click="onCreate">{{ t('modeler.workbench.newModelDoc') }}</el-button>
      <el-button size="small" @click="store.importBbmodel()">{{ t('modeler.workbench.importBbShort') }}</el-button>
      <el-button size="small" @click="store.importObj()">{{ t('modeler.workbench.importObjShort') }}</el-button>
      <el-button size="small" @click="store.importDae()">{{ t('modeler.workbench.importDaeShort') }}</el-button>
      <el-button size="small" @click="store.importFbx()">{{ t('modeler.workbench.importFbxShort') }}</el-button>
      <el-button size="small" @click="store.importGltf()">{{ t('modeler.workbench.importGltfShort') }}</el-button>
    </div>

    <!-- 三栏工作台 -->
    <div v-else class="mw-body">
      <!-- 左：Outliner -->
      <aside class="mw-outliner">
        <p class="mw-col-title">{{ t('modeler.workbench.outliner') }}</p>
        <div
          v-for="item in outlinerItems"
          :key="item.id"
          class="mw-row"
          :class="{ 'is-selected': store.selection.includes(item.id) }"
          :style="{ paddingLeft: `${8 + item.depth * 14}px` }"
          @click="onSelect(item.id)"
        >
          <span class="mw-row-kind">{{ item.kindLabel }}</span>
          <span class="mw-row-name">{{ item.name }}</span>
          <el-icon class="mw-row-icon" @click.stop="onToggleLock(item.id)">
            <Lock v-if="item.locked" /><Unlock v-else />
          </el-icon>
          <el-icon class="mw-row-icon" @click.stop="onToggleVisible(item.id)">
            <View v-if="item.visible" /><Hide v-else />
          </el-icon>
        </div>
      </aside>

      <!-- 中：可编辑 3D 视口 -->
      <main class="mw-viewport">
        <ModelerViewport />
      </main>

      <!-- 右：属性 -->
      <aside class="mw-props">
        <p class="mw-col-title">{{ t('modeler.workbench.textures') }}</p>
        <div
          v-for="tex in textureList"
          :key="tex.id"
          class="mw-tex-row"
          :class="{ 'is-active': store.activeTextureId === tex.id }"
          :title="store.activeTextureId === tex.id ? t('modeler.workbench.activeTextureTip') : t('modeler.workbench.setActiveTextureTip')"
          @click="store.activeTextureId = tex.id"
        >
          <span class="mw-tex-name">{{ tex.name }}</span>
          <span class="mw-tex-size">{{ tex.width }}×{{ tex.height }}</span>
          <el-icon
            class="mw-row-icon"
            :class="{ 'is-disabled': !canRepaint(tex) }"
            :title="canRepaint(tex) ? t('modeler.workbench.repaintTip') : t('modeler.workbench.repaintDisabledTip')"
            @click.stop="onRepaintTexture(tex.id)"
          >
            <MagicStick />
          </el-icon>
          <el-icon class="mw-row-icon" :title="t('modeler.workbench.exportTextureTip')" @click.stop="onExportTexture(tex.id)">
            <Download />
          </el-icon>
          <el-icon class="mw-row-icon" :title="t('modeler.workbench.removeTextureTip')" @click.stop="onRemoveTexture(tex.id)">
            <Delete />
          </el-icon>
        </div>
        <div class="mw-tex-create">
          <el-input v-model="newTexName" size="small" :placeholder="t('modeler.workbench.textureName')" @keyup.enter="onAddTexture" />
          <el-select v-model="newTexSize" size="small" class="mw-tex-size-select">
            <el-option v-for="s in [16, 32, 64, 128, 256]" :key="s" :label="`${s}×${s}`" :value="s" />
          </el-select>
          <el-button size="small" :disabled="!store.doc" @click="onAddTexture">{{ t('modeler.workbench.create') }}</el-button>
        </div>
        <el-button
          size="small"
          class="mw-tex-import"
          :disabled="!store.doc"
          :icon="Upload"
          @click="onImportTexture"
          >{{ t('modeler.workbench.importPng') }}</el-button
        >

        <!-- B2-1 flipbook：活动贴图动画元数据（Java .png.mcmeta 子集，生成器落盘 mcmeta） -->
        <div v-if="activeTex" class="mw-tex-anim">
          <div class="mw-tex-anim-head">
            <span class="mw-field-label">{{ t('modeler.workbench.flipbook') }}</span>
            <el-switch
              :model-value="!!activeTex.animation"
              size="small"
              :title="t('modeler.workbench.flipbookTip')"
              @change="(v: string | number | boolean) => onToggleTexAnim(v === true)"
            />
          </div>
          <template v-if="activeTex.animation">
            <label class="mw-field mw-field-inline">
              <span>{{ t('modeler.workbench.frametime') }}</span>
              <el-input-number
                :model-value="activeTex.animation.frametime"
                :min="1"
                :max="100"
                size="small"
                @update:model-value="(v: number | undefined) => onTexFrametime(v)"
              />
            </label>
            <label class="mw-field mw-field-inline">
              <span>{{ t('modeler.workbench.interpolate') }}</span>
              <el-switch
                :model-value="!!activeTex.animation.interpolate"
                size="small"
                @change="(v: string | number | boolean) => onTexInterpolate(v === true)"
              />
            </label>
            <p v-if="texAnimFrameCount" class="mw-props-hint">
              {{ t('modeler.workbench.frameCount', { n: texAnimFrameCount, w: activeTex.width }) }}
            </p>
            <p v-for="issue in texAnimIssues" :key="issue.code" class="mw-tex-anim-issue">
              {{ issue.message }}
            </p>
          </template>
        </div>

        <!-- B2-2 纹理层：活动贴图的层栈编辑（多层模式时显示） -->
        <div v-if="activeTex && texLayers.length > 0" class="mw-tex-layers">
          <div class="mw-tex-layers-head">
            <span class="mw-field-label">{{ t('modeler.workbench.layers') }}</span>
            <el-button size="small" text @click="onAddLayer">
              <el-icon><Plus /></el-icon>
            </el-button>
          </div>
          <div
            v-for="(layer, idx) in texLayers"
            :key="layer.id"
            class="mw-tex-layer-row"
            :class="{ 'is-active': store.activeLayerId === layer.id }"
            @click="store.activeLayerId = layer.id"
          >
            <el-icon
              class="mw-row-icon"
              :title="layer.visible ? t('modeler.workbench.hideLayer') : t('modeler.workbench.showLayer')"
              @click.stop="onToggleLayerVisible(layer.id, layer.visible)"
            >
              <View v-if="layer.visible" />
              <Hide v-else />
            </el-icon>
            <span class="mw-tex-layer-name">{{ layer.name }}</span>
            <el-slider
              :model-value="Math.round(layer.opacity * 100)"
              :min="0"
              :max="100"
              size="small"
              class="mw-tex-layer-opacity"
              @update:model-value="(v: number | number[] | undefined) => onLayerOpacity(layer.id, Array.isArray(v) ? v[0] : v)"
            />
            <el-icon
              class="mw-row-icon"
              :class="{ 'is-disabled': idx === texLayers.length - 1 }"
              :title="t('modeler.workbench.moveUp')"
              @click.stop="onMoveLayer(layer.id, -1)"
            >
              <ArrowUp />
            </el-icon>
            <el-icon
              class="mw-row-icon"
              :class="{ 'is-disabled': idx === 0 }"
              :title="t('modeler.workbench.moveDown')"
              @click.stop="onMoveLayer(layer.id, 1)"
            >
              <ArrowDown />
            </el-icon>
            <el-icon class="mw-row-icon" :title="t('modeler.workbench.removeLayer')" @click.stop="onRemoveLayer(layer.id)">
              <Delete />
            </el-icon>
          </div>
        </div>
        <p class="mw-props-hint">{{ t('modeler.workbench.paintHint') }}</p>

        <!-- B3-1 参考图：管理面板 -->
        <p class="mw-col-title mw-col-gap">{{ t('modeler.workbench.refs') }}</p>
        <div class="mw-ref-panel">
          <div v-if="refImages.length === 0" class="mw-props-hint">{{ t('modeler.workbench.noRefs') }}</div>
          <div v-for="ref in refImages" :key="ref.id" class="mw-ref-row">
            <el-icon
              class="mw-row-icon"
              :title="ref.visible ? t('modeler.workbench.hide') : t('modeler.workbench.show')"
              @click="store.patchRefImage(ref.id, { visible: !ref.visible })"
            >
              <View v-if="ref.visible" />
              <Hide v-else />
            </el-icon>
            <span class="mw-ref-name">{{ ref.name }}</span>
            <el-slider
              :model-value="Math.round(ref.opacity * 100)"
              :min="0"
              :max="100"
              size="small"
              class="mw-ref-opacity"
              @update:model-value="(v: number | number[] | undefined) => onRefOpacity(ref.id, Array.isArray(v) ? v[0] : v)"
            />
            <el-icon class="mw-row-icon" :title="t('modeler.workbench.removeRef')" @click="onRemoveRef(ref.id)">
              <Delete />
            </el-icon>
          </div>
          <el-button size="small" @click="onAddRefImage">{{ t('modeler.workbench.addRef') }}</el-button>
        </div>

        <p class="mw-col-title mw-col-gap">{{ t('modeler.workbench.properties') }}</p>
        <template v-if="editingNode">
          <label class="mw-field">
            <span>{{ t('modeler.workbench.name') }}</span>
            <el-input
              size="small"
              :model-value="editingNode.name"
              @update:model-value="(v: string) => store.rename(editingNode!.id, v)"
            />
          </label>
          <label class="mw-field mw-field-inline">
            <span>{{ t('modeler.workbench.locked') }}</span>
            <el-switch v-model="editingNode.locked" size="small" @change="commitLocked()" />
          </label>

          <!-- 立方体：几何 + 旋转中心 + 旋转 -->
          <template v-if="editingNode.type === 'cube'">
            <span class="mw-field-label">{{ t('modeler.workbench.from') }}</span>
            <div class="mw-vec3">
              <el-input-number
                v-for="(axis, i) in ['X', 'Y', 'Z'] as const"
                :key="axis"
                v-model="editingNode.from[i]"
                size="small"
                :controls="false"
                @change="commitGeometry()"
              />
            </div>
            <span class="mw-field-label">{{ t('modeler.workbench.to') }}</span>
            <div class="mw-vec3">
              <el-input-number
                v-for="(axis, i) in ['X', 'Y', 'Z'] as const"
                :key="axis"
                v-model="editingNode.to[i]"
                size="small"
                :controls="false"
                @change="commitGeometry()"
              />
            </div>
            <span class="mw-field-label">{{ t('modeler.workbench.origin') }}</span>
            <div class="mw-vec3">
              <el-input-number
                v-for="(axis, i) in ['X', 'Y', 'Z'] as const"
                :key="axis"
                v-model="editingNode.origin[i]"
                size="small"
                :controls="false"
                @change="commitOrigin()"
              />
            </div>
            <span class="mw-field-label">{{ t('modeler.workbench.rotationDeg') }}</span>
            <div class="mw-vec3">
              <el-input-number
                v-for="(axis, i) in ['X', 'Y', 'Z'] as const"
                :key="axis"
                v-model="editingNode.rotation[i]"
                size="small"
                :controls="false"
                @change="commitRotation()"
              />
            </div>
          </template>

          <!-- 组/骨骼：pivot + 旋转 + 可选缩放 -->
          <template v-else-if="editingNode.type === 'group'">
            <span class="mw-field-label">{{ t('modeler.workbench.pivot') }}</span>
            <div class="mw-vec3">
              <el-input-number
                v-for="(axis, i) in ['X', 'Y', 'Z'] as const"
                :key="axis"
                v-model="editingNode.origin[i]"
                size="small"
                :controls="false"
                @change="commitOrigin()"
              />
            </div>
            <span class="mw-field-label">{{ t('modeler.workbench.rotationDeg') }}</span>
            <div class="mw-vec3">
              <el-input-number
                v-for="(axis, i) in ['X', 'Y', 'Z'] as const"
                :key="axis"
                v-model="editingNode.rotation[i]"
                size="small"
                :controls="false"
                @change="commitRotation()"
              />
            </div>
            <template v-if="editingNode.scale">
              <span class="mw-field-label mw-field-label-row">
                <span>{{ t('modeler.workbench.scale') }}</span>
                <el-button link size="small" @click="clearScale()">{{ t('modeler.workbench.clear') }}</el-button>
              </span>
              <div class="mw-vec3">
                <el-input-number
                  v-for="(axis, i) in ['X', 'Y', 'Z'] as const"
                  :key="axis"
                  v-model="editingNode.scale[i]"
                  size="small"
                  :controls="false"
                  @change="commitScale()"
                />
              </div>
            </template>
            <p class="mw-props-hint">{{ t('modeler.workbench.scaleHint') }}</p>
          </template>

          <!-- 定位点：位置 -->
          <template v-else-if="editingNode.type === 'locator'">
            <span class="mw-field-label">{{ t('modeler.workbench.position') }}</span>
            <div class="mw-vec3">
              <el-input-number
                v-for="(axis, i) in ['X', 'Y', 'Z'] as const"
                :key="axis"
                v-model="editingNode.position[i]"
                size="small"
                :controls="false"
                @change="commitPosition()"
              />
            </div>
          </template>

          <!-- 网格：顶点/面统计 + 旋转中心 + 旋转（顶点级编辑 B4-3 在视口进行） -->
          <template v-else-if="editingNode.type === 'mesh'">
            <p class="mw-props-hint">
              {{ t('modeler.workbench.meshStats', { vertices: editingNode.vertices.length, faces: editingNode.faces.length }) }}
            </p>
            <span class="mw-field-label">{{ t('modeler.workbench.origin') }}</span>
            <div class="mw-vec3">
              <el-input-number
                v-for="(axis, i) in ['X', 'Y', 'Z'] as const"
                :key="axis"
                v-model="editingNode.origin[i]"
                size="small"
                :controls="false"
                @change="commitOrigin()"
              />
            </div>
            <span class="mw-field-label">{{ t('modeler.workbench.rotationDeg') }}</span>
            <div class="mw-vec3">
              <el-input-number
                v-for="(axis, i) in ['X', 'Y', 'Z'] as const"
                :key="axis"
                v-model="editingNode.rotation[i]"
                size="small"
                :controls="false"
                @change="commitRotation()"
              />
            </div>
          </template>
        </template>
        <p v-else class="mw-props-hint">{{ t('modeler.workbench.selectNodeHint') }}</p>

        <!-- Display 槽位（P3-e）：Java 方块/物品八槽位变换（按能力矩阵显隐） -->
        <template v-if="displaySupported">
          <p class="mw-col-title mw-col-gap">{{ t('modeler.workbench.displaySlots') }}</p>
          <label class="mw-field">
            <span>{{ t('modeler.workbench.slot') }}</span>
            <el-select v-model="displaySlot" size="small">
              <el-option
                v-for="s in displaySlotOrder"
                :key="s"
                :label="displaySlotText(s)"
                :value="s"
              />
            </el-select>
          </label>
          <span class="mw-field-label">{{ t('modeler.workbench.rotationDeg') }}</span>
          <div class="mw-vec3">
            <el-input-number
              v-for="(axis, i) in ['X', 'Y', 'Z'] as const"
              :key="axis"
              v-model="displayForm.rotation[i]"
              size="small"
              :controls="false"
              @change="commitDisplay()"
            />
          </div>
          <span class="mw-field-label">{{ t('modeler.workbench.translation') }}</span>
          <div class="mw-vec3">
            <el-input-number
              v-for="(axis, i) in ['X', 'Y', 'Z'] as const"
              :key="axis"
              v-model="displayForm.translation[i]"
              size="small"
              :controls="false"
              @change="commitDisplay()"
            />
          </div>
          <span class="mw-field-label">{{ t('modeler.workbench.scale') }}</span>
          <div class="mw-vec3">
            <el-input-number
              v-for="(axis, i) in ['X', 'Y', 'Z'] as const"
              :key="axis"
              v-model="displayForm.scale[i]"
              size="small"
              :controls="false"
              @change="commitDisplay()"
            />
          </div>
          <div class="mw-display-actions">
            <el-select
              v-model="displayPreset"
              size="small"
              :placeholder="t('modeler.workbench.applyPreset')"
              class="mw-display-preset"
              @change="onDisplayPreset"
            >
              <el-option v-for="p in displayPresetOptions" :key="p" :label="presetText(p)" :value="p" />
            </el-select>
            <el-button size="small" @click="onDisplayReset">{{ t('modeler.workbench.reset') }}</el-button>
          </div>
          <p class="mw-props-hint">{{ t('modeler.workbench.displayHint') }}</p>
        </template>

        <!-- UV 编辑器（P2-d）：仅单选立方体或 mesh 时组件内部渲染（v3 C3b 起支持 mesh） -->
        <ModelerUvEditor />
      </aside>
    </div>

    <!-- 动画时间线（P4）：动画列表 CRUD + 关键帧轨道 + 播放控制 -->
    <ModelerTimeline v-if="store.doc" />

    <!-- 应用到实体（P3-f）：把当前骨骼文档导出 geo.json 写回实体渲染几何 -->
    <el-dialog v-model="applyOpen" :title="t('modeler.workbench.applyEntityTitle')" width="400px">
      <p class="mw-apply-hint">
        {{ t('modeler.workbench.applyEntityBody') }}
      </p>
      <el-select v-model="applyEntityId" filterable :placeholder="t('modeler.workbench.selectEntity')" class="mw-apply-select">
        <el-option
          v-for="e in entityOptions"
          :key="e.id"
          :label="e.displayName ? `${e.displayName}（${e.id}）` : e.id"
          :value="e.id"
        />
      </el-select>
      <template #footer>
        <el-button @click="applyOpen = false">{{ t('modeler.workbench.cancel') }}</el-button>
        <el-button type="primary" :disabled="!applyEntityId" @click="onApplyToEntity">{{ t('modeler.workbench.writeBack') }}</el-button>
      </template>
    </el-dialog>

    <!-- 应用到对象（P5-open）：把当前 java_block 文档导出 ModelAsset 写回方块/物品/实体 -->
    <el-dialog v-model="applyObjOpen" :title="t('modeler.workbench.applyObjTitle')" width="400px">
      <p class="mw-apply-hint">
        {{ t('modeler.workbench.applyObjBody') }}
      </p>
      <el-select v-model="applyObjTarget" filterable :placeholder="t('modeler.workbench.selectObject')" class="mw-apply-select">
        <el-option-group
          v-for="grp in objectOptions"
          :key="grp.label"
          :label="grp.label"
        >
          <el-option
            v-for="o in grp.items"
            :key="`${o.kind}:${o.id}`"
            :label="o.displayName ? `${o.displayName}（${o.id}）` : o.id"
            :value="`${o.kind}:${o.id}`"
          />
        </el-option-group>
      </el-select>
      <template #footer>
        <el-button @click="applyObjOpen = false">{{ t('modeler.workbench.cancel') }}</el-button>
        <el-button type="primary" :disabled="!applyObjTarget" @click="onApplyToObject">{{ t('modeler.workbench.writeBack') }}</el-button>
      </template>
    </el-dialog>

    <!-- AI 重绘候选画廊（P2-e）：复用贴图工坊链路，目标 = 文档贴图（assetKind=model） -->
    <RepaintDialog
      v-model="repaintOpen"
      :size="repaintTarget?.size ?? 16"
      :pixels="repaintTarget?.pixels ?? []"
      shape="cube"
      asset-kind="model"
      :asset-id="store.doc?.id ?? ''"
      @applied="onRepaintApplied"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * ModelerWorkbench：模型工坊工作台（建模器通用化重建方案 §4.1/§5.1）。
 *
 * - 文档层：useModelerStore（.kunyu/modeler/<id>.json + CommandStack 撤销）；
 * - 视口：ModelerViewport 可编辑 3D 视口（gizmo 变换/点选/框选/吸附/绘画，P1）；
 * - 右栏：贴图管理（新建/删除/活动贴图）+ 属性面板；隔离编辑副本（cloneForEdit），
 *   落定经 patchNode 走命令栈；覆盖立方体（from/to/origin/rotation）、
 *   组（pivot/rotation/scale）、定位点（position）、通用（名称/锁定）；
 * - 动画：底部 ModelerTimeline（动画列表 CRUD + 关键帧轨道 + 播放控制，P4），
 *   视口叠加由 animationPlayer 驱动、只改场景不写文档。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch, watchEffect, reactive } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Delete, Download, Hide, Lock, MagicStick, Plus, ArrowUp, ArrowDown, Close, Unlock, Upload, View } from '@element-plus/icons-vue'
import { useModelerStore, parseBoundDocId } from '../../stores/modeler'
import { useProjectStore } from '../../stores/project'
import { useUnifiedStore } from '../../stores/unified'
import { useUiStore } from '../../stores/ui'
import { depthOf, patchNode, patchTexture } from '../../../../shared/modeler/document'
import type { NodePatch } from '../../../../shared/modeler/document'
import { getFormat, listFormats, previewFormatSwitch } from '../../../../shared/modeler/formats'
import {
  DISPLAY_PRESETS,
  DISPLAY_SLOT_ORDER,
  compactTransform,
  isIdentityTransform
} from '../../../../shared/modeler/display'
import { textureFrameCount, validateTextureAnimation } from '../../../../shared/modeler/flipbook'
import type { ModelNode, ModelTexture, NodeId, Vec3, FormatId, DisplaySlot } from '../../../../shared/modeler/types'
import { isCubeNode, isGroupNode, isLocatorNode, isMeshNode } from '../../../../shared/modeler/types'
import { formatPixel, parsePixel } from '../../../../shared/utils/pixelColor'
import ModelerViewport from './ModelerViewport.vue'
import ModelerUvEditor from './ModelerUvEditor.vue'
import ModelerTimeline from './ModelerTimeline.vue'
import RepaintDialog from '../unified/RepaintDialog.vue'
import { t, te } from '../../i18n'

const store = useModelerStore()
const project = useProjectStore()
const unifiedStore = useUnifiedStore()
const ui = useUiStore()

/** 绑定文档关联的内容对象（id 约定 <type>__<objectId>；P5-open 回跳入口） */
const boundObject = computed(() => (store.doc ? parseBoundDocId(store.doc.id) : null))

/** 回跳工坊并选中关联对象（经 unified 信号，模块挂载后由视图消费选中） */
function onOpenBoundObject(): void {
  const b = boundObject.value
  if (!b) return
  unifiedStore.requestOpenObject(b)
  ui.setActiveModule('unified')
}

/** 文档根变化：刷新文档列表；项目关闭时收起当前文档 */
watch(
  () => project.currentProject?.path,
  async () => {
    await store.refreshList()
    store.close()
  }
)
onMounted(() => {
  void store.refreshList()
  window.addEventListener('keydown', onGlobalKeydown)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onGlobalKeydown)
})

/**
 * 高频快捷键（P5-polish）：Ctrl+S 保存 / Ctrl+Z 撤销 / Ctrl+Y·Ctrl+Shift+Z 重做 / Delete 删除选中。
 * 输入框与弹层（对话框/下拉/取色器）聚焦时不劫持；Ctrl+A 全选与 Esc 清选由视口处理。
 */
function onGlobalKeydown(e: KeyboardEvent): void {
  const el = e.target as HTMLElement | null
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
  if (el?.closest('.el-overlay, .el-popper')) return
  if (!store.doc) return
  const mod = e.ctrlKey || e.metaKey
  const key = e.key.toLowerCase()
  if (mod && key === 's') {
    e.preventDefault()
    if (store.dirty) void store.save()
  } else if (mod && !e.shiftKey && key === 'z') {
    e.preventDefault()
    store.undo()
  } else if ((mod && key === 'y') || (mod && e.shiftKey && key === 'z')) {
    e.preventDefault()
    store.redo()
  } else if (e.key === 'Delete' && !mod) {
    // 面模式（B4-3）：优先删除选中网格面；否则删除选中节点
    if (store.editMode === 'face' && store.faceSelection.length > 0) {
      e.preventDefault()
      store.deleteSelectedMeshFaces()
    } else if (store.selection.length > 0) {
      e.preventDefault()
      store.removeSelected()
    }
  }
}

/* ---- Outliner ---- */
interface OutlinerItem {
  id: NodeId
  name: string
  kindLabel: string
  visible: boolean
  locked: boolean
  depth: number
}

function kindText(kind: string): string {
  return t(`modeler.kind.${kind}`)
}

function displaySlotText(slot: DisplaySlot): string {
  return t(`modeler.display.slot.${slot}`)
}

/** 预设名来自共享表的键（中文），按固定顺序映射到 i18n 键 */
const PRESET_KEYS: Record<string, string> = {
  '原版方块·界面': 'blockGui',
  '原版方块·地面': 'blockGround',
  '原版方块·展示框': 'blockFixed',
  '手持·斜握 45°': 'hand45',
  '头部·举高佩戴': 'headHigh'
}

function presetText(label: string): string {
  const key = PRESET_KEYS[label]
  return key ? t(`modeler.display.preset.${key}`) : label
}

const outlinerItems = computed<OutlinerItem[]>(() => {
  const d = store.doc
  if (!d) return []
  return Object.values(d.nodes).map((n) => ({
    id: n.id,
    name: n.name,
    kindLabel: kindText(n.type),
    visible: n.visible,
    locked: n.locked,
    depth: depthOf(d, n.id)
  }))
})

const selectedNode = computed(() => {
  if (store.selection.length !== 1) return null
  return store.doc?.nodes[store.selection[0]!] ?? null
})

function onSelect(id: NodeId): void {
  store.selection = [id]
}

function onToggleVisible(id: NodeId): void {
  store.execute(t('modeler.workbench.cmdToggleVisible'), (d) => {
    const node = d.nodes[id]
    if (!node) return d
    return patchNode(d, id, { visible: !node.visible })
  })
}

function onToggleLock(id: NodeId): void {
  const node = store.doc?.nodes[id]
  if (!node) return
  store.execute(t('modeler.workbench.cmdToggleLocked'), (d) => patchNode(d, id, { locked: !node.locked }))
}

/* ---- 格式切换（P3-c）：能力差预检 + 失损提示弹窗 ---- */
function formatName(id: FormatId, fallback: string): string {
  const key = `modeler.format.${id}`
  return te(key) ? t(key) : fallback
}

const formatOptions = computed(() =>
  listFormats().map((f) => ({ id: f.id as FormatId, name: formatName(f.id as FormatId, f.name) }))
)
/** HTML 转义（MessageBox 用 dangerouslyUseHTMLString 渲染换行） */
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

async function onFormatSwitch(target: FormatId): Promise<void> {
  const doc = store.doc
  if (!doc || target === doc.format) return
  const targetName = formatName(target, getFormat(target).name)
  const downgrades = previewFormatSwitch(doc, target)
  if (downgrades.length > 0) {
    const shown = downgrades.slice(0, 8).map((d) => `• ${escapeHtml(d.message)}`)
    if (downgrades.length > 8) shown.push(t('modeler.workbench.formatSwitchMore', { n: downgrades.length }))
    try {
      await ElMessageBox.confirm(
        t('modeler.workbench.formatSwitchBody', { name: targetName, items: shown.join('<br>') }),
        t('modeler.workbench.formatSwitchTitle'),
        {
          type: 'warning',
          confirmButtonText: t('modeler.workbench.formatSwitchConfirm'),
          cancelButtonText: t('modeler.workbench.cancel'),
          dangerouslyUseHTMLString: true
        }
      )
    } catch {
      return // 用户取消：选择器随 store 原值回弹
    }
  }
  store.execute(t('modeler.workbench.cmdFormatSwitch', { name: targetName }), (d) => ({
    ...d,
    format: target
  }))
}

/* ---- 应用到实体（P3-f）：选实体 → 写回 geoJson（覆盖已有骨骼几何需二次确认） ---- */
const applyOpen = ref(false)
const applyEntityId = ref('')
const entityOptions = ref<{ id: string; displayName: string }[]>([])

async function onApplyToEntityOpen(): Promise<void> {
  if (!store.doc) return
  // 主进程写回读取的是已保存版本：有未保存修改时先引导保存
  if (store.dirty) {
    try {
      await ElMessageBox.confirm(
        t('modeler.workbench.unsavedWriteBackBody'),
        t('modeler.workbench.unsavedTitle'),
        {
          type: 'warning',
          confirmButtonText: t('modeler.workbench.saveAndContinue'),
          cancelButtonText: t('modeler.workbench.cancel')
        }
      )
    } catch {
      return
    }
    await store.save()
  }
  applyEntityId.value = ''
  entityOptions.value = []
  const rootPath = project.currentProject?.path ?? ''
  if (rootPath) {
    try {
      const list = await window.api.content.list(rootPath)
      entityOptions.value = list
        .filter((c) => c.kind === 'entity')
        .map((c) => ({ id: c.id, displayName: c.displayName }))
    } catch {
      // 列表失败保持空选项，提示走错误分支
    }
  }
  applyOpen.value = true
}

async function onApplyToEntity(): Promise<void> {
  if (!store.doc || !applyEntityId.value) return
  const res = await store.applyGeoToEntity(applyEntityId.value)
  if (res.ok) {
    applyOpen.value = false
    ElMessage.success(
      res.replacedGeo
        ? t('modeler.workbench.appliedEntityGeo')
        : t('modeler.workbench.appliedEntityGeoNew')
    )
    return
  }
  if (!res.needsConfirm) {
    ElMessage.error(res.errorMessage)
    return
  }
  try {
    await ElMessageBox.confirm(
      t('modeler.workbench.confirmOverwriteBody', { reason: res.errorMessage }),
      t('modeler.workbench.confirmOverwriteTitle'),
      {
        type: 'warning',
        confirmButtonText: t('modeler.workbench.overwrite'),
        cancelButtonText: t('modeler.workbench.cancel')
      }
    )
  } catch {
    return
  }
  const second = await store.applyGeoToEntity(applyEntityId.value, true)
  if (second.ok) {
    applyOpen.value = false
    ElMessage.success(t('modeler.workbench.appliedOverride'))
  } else {
    ElMessage.error(second.errorMessage)
  }
}

/* ---- 应用到对象（P5-open）：java_block 文档 → ModelAsset 写回方块/物品/实体 ---- */
const applyObjOpen = ref(false)
const applyObjTarget = ref('')
interface ObjectOption {
  kind: 'block' | 'item' | 'entity'
  id: string
  displayName: string
}
const objectOptions = ref<{ label: string; items: ObjectOption[] }[]>([])

async function onApplyToObjectOpen(): Promise<void> {
  if (!store.doc) return
  // 主进程写回读取的是已保存版本：有未保存修改时先引导保存
  if (store.dirty) {
    try {
      await ElMessageBox.confirm(
        t('modeler.workbench.unsavedWriteBackBodyObj'),
        t('modeler.workbench.unsavedTitle'),
        {
          type: 'warning',
          confirmButtonText: t('modeler.workbench.saveAndContinue'),
          cancelButtonText: t('modeler.workbench.cancel')
        }
      )
    } catch {
      return
    }
    await store.save()
  }
  // 绑定文档默认选中关联对象
  const b = boundObject.value
  applyObjTarget.value = b ? `${b.type}:${b.id}` : ''
  objectOptions.value = []
  const rootPath = project.currentProject?.path ?? ''
  if (rootPath) {
    try {
      const list = await window.api.content.list(rootPath)
      const pick = (kind: ObjectOption['kind'], label: string) => ({
        label,
        items: list
          .filter((c) => c.kind === kind)
          .map((c) => ({ kind, id: c.id, displayName: c.displayName }))
      })
      objectOptions.value = [
        pick('block', t('unified.kind.block')),
        pick('item', t('unified.kind.item')),
        pick('entity', t('unified.kind.entity'))
      ].filter((g) => g.items.length > 0)
    } catch {
      // 列表失败保持空选项，提示走错误分支
    }
  }
  applyObjOpen.value = true
}

async function onApplyToObject(): Promise<void> {
  if (!store.doc || !applyObjTarget.value) return
  const [kind, id] = applyObjTarget.value.split(':') as [ObjectOption['kind'], string]
  if (!kind || !id) return
  const res = await store.applyModelToObject(kind, id)
  if (res.ok) {
    applyObjOpen.value = false
    ElMessage.success(
      res.replacedGeo
        ? t('modeler.workbench.appliedObjectReplaced')
        : t('modeler.workbench.appliedObject')
    )
    return
  }
  if (!res.needsConfirm) {
    ElMessage.error(res.errorMessage)
    return
  }
  try {
    await ElMessageBox.confirm(
      t('modeler.workbench.confirmOverwriteBody', { reason: res.errorMessage }),
      t('modeler.workbench.confirmOverwriteTitle'),
      {
        type: 'warning',
        confirmButtonText: t('modeler.workbench.overwrite'),
        cancelButtonText: t('modeler.workbench.cancel')
      }
    )
  } catch {
    return
  }
  const second = await store.applyModelToObject(kind, id, true)
  if (second.ok) {
    applyObjOpen.value = false
    ElMessage.success(t('modeler.workbench.appliedObjectOverride'))
  } else {
    ElMessage.error(second.errorMessage)
  }
}

/* ---- Display 槽位（P3-e）：八槽位 rotation/translation/scale + 原版预设 ---- */
const displaySlotOrder = DISPLAY_SLOT_ORDER
const displaySupported = computed(() => {
  const d = store.doc
  return d ? getFormat(d.format).capabilities.display : false
})
const displaySlot = ref<DisplaySlot>('gui')
const displayForm = reactive<{ rotation: Vec3; translation: Vec3; scale: Vec3 }>({
  rotation: [0, 0, 0],
  translation: [0, 0, 0],
  scale: [1, 1, 1]
})

// 文档/槽位变化时把已存变换镜像进表单（缩放缺省 1，旋转/平移缺省 0）
watchEffect(() => {
  const entry = store.doc?.display?.[displaySlot.value]
  displayForm.rotation = [...(entry?.rotation ?? [0, 0, 0])] as Vec3
  displayForm.translation = [...(entry?.translation ?? [0, 0, 0])] as Vec3
  displayForm.scale = [...(entry?.scale ?? [1, 1, 1])] as Vec3
})

function commitDisplay(): void {
  const entry = compactTransform({
    rotation: [...displayForm.rotation],
    translation: [...displayForm.translation],
    scale: [...displayForm.scale]
  })
  store.execute(t('modeler.workbench.cmdDisplaySlot'), (d) => {
    const display = { ...(d.display ?? {}) }
    if (isIdentityTransform(entry)) delete display[displaySlot.value]
    else display[displaySlot.value] = entry
    return { ...d, display }
  })
}

const displayPreset = ref('')
const displayPresetOptions = Object.keys(DISPLAY_PRESETS)
function onDisplayPreset(label: string): void {
  const preset = DISPLAY_PRESETS[label]
  displayPreset.value = ''
  if (!preset) return
  store.execute(t('modeler.workbench.cmdDisplayPreset', { label: presetText(label) }), (d) => ({
    ...d,
    display: { ...(d.display ?? {}), [displaySlot.value]: compactTransform(preset) }
  }))
}

function onDisplayReset(): void {
  store.execute(t('modeler.workbench.cmdDisplayReset'), (d) => {
    const display = { ...(d.display ?? {}) }
    delete display[displaySlot.value]
    return { ...d, display }
  })
}

/* ---- 属性编辑 ---- */
const editingNode = ref<ModelNode | null>(null)

/**
 * 编辑副本：克隆位置数组。v-model 只改副本，落定才经 patchNode 走命令栈——
 * 若直接 v-model 到 store 文档节点会绕过命令栈，导致撤销缺路径。
 */
function cloneForEdit(node: ModelNode): ModelNode {
  if (isCubeNode(node)) {
    return {
      ...node,
      from: [...node.from] as Vec3,
      to: [...node.to] as Vec3,
      origin: [...node.origin] as Vec3,
      rotation: [...node.rotation] as Vec3
    }
  }
  if (isGroupNode(node)) {
    return {
      ...node,
      origin: [...node.origin] as Vec3,
      rotation: [...node.rotation] as Vec3,
      ...(node.scale ? { scale: [...node.scale] as Vec3 } : {})
    }
  }
  if (isMeshNode(node)) {
    return {
      ...node,
      origin: [...node.origin] as Vec3,
      rotation: [...node.rotation] as Vec3
    }
  }
  return { ...node, position: [...node.position] as Vec3 }
}

watch(selectedNode, (node) => {
  editingNode.value = node ? cloneForEdit(node) : null
})

/** 字段组落定：patchNode 走命令栈（mergeKey 合并连续步进） */
function commitPatch(mergeKey: string, patch: NodePatch): void {
  const node = editingNode.value
  if (!node) return
  store.execute(t('modeler.workbench.cmdEditProps'), (d) => patchNode(d, node.id, patch), {
    mergeKey: `${mergeKey}:${node.id}`
  })
}

function commitGeometry(): void {
  const n = editingNode.value
  if (n && isCubeNode(n)) {
    commitPatch('geometry', { from: [...n.from] as Vec3, to: [...n.to] as Vec3 })
  }
}

function commitOrigin(): void {
  const n = editingNode.value
  if (n && (isCubeNode(n) || isGroupNode(n) || isMeshNode(n))) {
    commitPatch('origin', { origin: [...n.origin] as Vec3 })
  }
}

function commitRotation(): void {
  const n = editingNode.value
  if (n && (isCubeNode(n) || isGroupNode(n) || isMeshNode(n))) {
    commitPatch('rotation', { rotation: [...n.rotation] as Vec3 })
  }
}

function commitScale(): void {
  const n = editingNode.value
  if (n && isGroupNode(n) && n.scale) commitPatch('scale', { scale: [...n.scale] as Vec3 })
}

/** 清除组缩放（scale 回到未定义 = 单位缩放） */
function clearScale(): void {
  const n = editingNode.value
  if (n && isGroupNode(n)) commitPatch('scale', { scale: undefined })
}

function commitPosition(): void {
  const n = editingNode.value
  if (n && isLocatorNode(n)) commitPatch('position', { position: [...n.position] as Vec3 })
}

function commitLocked(): void {
  const n = editingNode.value
  if (n) commitPatch('locked', { locked: n.locked })
}

/* ---- 贴图管理 ---- */
interface TexRow {
  id: string
  name: string
  width: number
  height: number
}

const textureList = computed<TexRow[]>(() => {
  const d = store.doc
  if (!d) return []
  return Object.values(d.textures).map((tx) => ({
    id: tx.id,
    name: tx.name,
    width: tx.width,
    height: tx.height
  }))
})

const newTexName = ref('')
const newTexSize = ref(16)

function onAddTexture(): void {
  if (!store.doc) return
  store.addTextureToDoc(newTexName.value || t('modeler.workbench.defaultTextureName'), newTexSize.value)
  newTexName.value = ''
}

/** 导入 PNG 为文档贴图（主进程弹框，结果落命令栈可撤销） */
async function onImportTexture(): Promise<void> {
  await store.importTexturePng()
}

/** 导出贴图为 PNG 文件（主进程弹保存框） */
async function onExportTexture(id: string): Promise<void> {
  await store.exportTexturePng(id)
}

async function onRemoveTexture(id: string): Promise<void> {
  const tex = store.doc?.textures[id]
  if (!tex) return
  try {
    await ElMessageBox.confirm(
      t('modeler.workbench.removeTextureBody', { name: tex.name }),
      t('modeler.workbench.removeTextureTitle'),
      {
        type: 'warning',
        confirmButtonText: t('modeler.workbench.delete'),
        cancelButtonText: t('modeler.workbench.cancel')
      }
    )
  } catch {
    return
  }
  store.removeTextureById(id)
  ElMessage.success(t('modeler.workbench.textureDeleted'))
}

/* ---- 贴图 flipbook 动画（B2-1）：元数据走命令栈，生成器落盘 .png.mcmeta ---- */
/** 活动贴图（动画编辑目标 = 当前活动贴图） */
const activeTex = computed<ModelTexture | null>(() => {
  const d = store.doc
  const id = store.activeTextureId
  return d && id ? (d.textures[id] ?? null) : null
})

const texAnimFrameCount = computed(() => (activeTex.value ? textureFrameCount(activeTex.value) : null))
const texAnimIssues = computed(() => (activeTex.value ? validateTextureAnimation(activeTex.value) : []))

function onToggleTexAnim(on: boolean): void {
  const tex = activeTex.value
  if (!tex) return
  if (on) store.setTexAnimation(tex.id, { frametime: 2 })
  else store.setTexAnimation(tex.id, null)
}

function onTexFrametime(v: number | undefined): void {
  const tex = activeTex.value
  const anim = tex?.animation
  if (!tex || !anim || typeof v !== 'number' || !Number.isInteger(v) || v < 1) return
  store.setTexAnimation(tex.id, { ...anim, frametime: v }, `texanim:${tex.id}`)
}

function onTexInterpolate(v: boolean): void {
  const tex = activeTex.value
  const anim = tex?.animation
  if (!tex || !anim) return
  store.setTexAnimation(tex.id, { ...anim, interpolate: v })
}

/* ---- AI 重绘（P2-e）：复用贴图工坊 RepaintDialog 链路（仅 16/32 方形贴图） ---- */
const repaintOpen = ref(false)
const repaintTarget = ref<{ id: string; size: 16 | 32; pixels: string[] } | null>(null)

/** AI 重绘链路（pixelize + 图像供应商）面向 16/32 方形 MC 贴图，其余尺寸禁用 */
function canRepaint(tex: Pick<ModelTexture, 'width' | 'height'>): boolean {
  return tex.width === tex.height && (tex.width === 16 || tex.width === 32)
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(t('modeler.workbench.textureDecodeFailed')))
    img.src = src
  })
}

/** PNG data URL → 语义像素（size*size 项；canvas 解码后逐像素 formatPixel） */
async function dataUrlToPixels(dataUrl: string, size: number): Promise<string[]> {
  const img = await loadImage(dataUrl)
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error(t('modeler.workbench.canvasUnavailable'))
  ctx.drawImage(img, 0, 0, size, size)
  const d = ctx.getImageData(0, 0, size, size).data
  const out: string[] = []
  for (let i = 0; i < size * size; i++) {
    const o = i * 4
    out.push(formatPixel({ r: d[o]!, g: d[o + 1]!, b: d[o + 2]!, a: d[o + 3]! }))
  }
  return out
}

/** 语义像素 → PNG data URL（写回文档贴图用） */
function pixelsToDataUrl(pixels: string[], size: number): string {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error(t('modeler.workbench.canvasUnavailable'))
  const img = ctx.createImageData(size, size)
  for (let i = 0; i < size * size; i++) {
    const c = parsePixel(pixels[i] ?? '')
    if (!c) continue
    const o = i * 4
    img.data[o] = c.r
    img.data[o + 1] = c.g
    img.data[o + 2] = c.b
    img.data[o + 3] = c.a
  }
  ctx.putImageData(img, 0, 0)
  return canvas.toDataURL('image/png')
}

async function onRepaintTexture(id: string): Promise<void> {
  const tex = store.doc?.textures[id]
  if (!tex) return
  if (!canRepaint(tex)) {
    ElMessage.info(t('modeler.workbench.repaintUnsupported'))
    return
  }
  try {
    const pixels = await dataUrlToPixels(tex.data, tex.width)
    repaintTarget.value = { id, size: tex.width as 16 | 32, pixels }
    repaintOpen.value = true
  } catch {
    ElMessage.error(t('modeler.workbench.repaintDecodeFailed'))
  }
}

/* ---- 纹理层（B2-2） ---- */
const texLayers = computed(() => {
  const tex = activeTex.value
  if (!tex) return []
  return store.getTextureLayers(tex.id)
})

function onAddLayer(): void {
  const tex = activeTex.value
  if (!tex) return
  void store.addLayerToDoc(tex.id)
}

function onToggleLayerVisible(layerId: string, visible: boolean): void {
  const tex = activeTex.value
  if (!tex) return
  void store.patchLayerInDoc(tex.id, layerId, { visible: !visible })
}

function onLayerOpacity(layerId: string, v: number | undefined): void {
  const tex = activeTex.value
  if (!tex || typeof v !== 'number') return
  void store.patchLayerInDoc(tex.id, layerId, { opacity: v / 100 })
}

function onMoveLayer(layerId: string, delta: number): void {
  const tex = activeTex.value
  if (!tex) return
  void store.moveLayerInDoc(tex.id, layerId, delta)
}

async function onRemoveLayer(layerId: string): Promise<void> {
  const tex = activeTex.value
  if (!tex) return
  try {
    await ElMessageBox.confirm(
      t('modeler.workbench.removeLayerBody'),
      t('modeler.workbench.removeLayerTitle'),
      {
        type: 'warning',
        confirmButtonText: t('modeler.workbench.delete'),
        cancelButtonText: t('modeler.workbench.cancel')
      }
    )
  } catch {
    return
  }
  await store.removeLayerFromDoc(tex.id, layerId)
}

/* ---- 参考图（B3-1） ---- */
const refImages = computed(() => store.doc?.referenceImages ?? [])

function onRefOpacity(refId: string, v: number | undefined): void {
  if (typeof v !== 'number') return
  store.patchRefImage(refId, { opacity: v / 100 })
}

async function onRemoveRef(refId: string): Promise<void> {
  try {
    await ElMessageBox.confirm(
      t('modeler.workbench.removeRefBody'),
      t('modeler.workbench.removeRefTitle'),
      {
        type: 'warning',
        confirmButtonText: t('modeler.workbench.delete'),
        cancelButtonText: t('modeler.workbench.cancel')
      }
    )
  } catch {
    return
  }
  store.removeRefImage(refId)
}

async function onAddRefImage(): Promise<void> {
  const res = await window.api.modeler.importTexturePng('')
  if (res.canceled || !res.dataUrl) return
  store.addRefImage({
    name: res.name ?? t('modeler.workbench.defaultRefName'),
    data: res.dataUrl
  })
}

/** 采用候选：语义像素 → PNG data URL 写回文档贴图（走命令栈，可撤销） */
function onRepaintApplied(pixels: string[]): void {
  const target = repaintTarget.value
  if (!target) return
  const dataUrl = pixelsToDataUrl(pixels, target.size)
  store.execute(t('modeler.workbench.cmdRepaint'), (d) =>
    patchTexture(d, target.id, { data: dataUrl })
  )
  ElMessage.success(t('modeler.workbench.repaintApplied'))
}

/* ---- 新建 ---- */
async function onCreate(): Promise<void> {
  try {
    const { value } = await ElMessageBox.prompt(
      t('modeler.workbench.newDocPrompt'),
      t('modeler.workbench.newDocTitle'),
      {
        inputValue: t('modeler.workbench.defaultDocName'),
        inputValidator: (v: string) => (v.trim() ? true : t('modeler.workbench.nameRequired'))
      }
    )
    store.create(value.trim(), 'free')
  } catch {
    // 用户取消
  }
}

/** 关闭标签页（B3-2）：有未保存修改时确认 */
async function onCloseTab(id: string): Promise<void> {
  if (store.doc?.id === id && store.dirty) {
    try {
      await ElMessageBox.confirm(
        t('modeler.workbench.closeDirtyBody'),
        t('modeler.workbench.closeDocTitle'),
        {
          type: 'warning',
          confirmButtonText: t('modeler.workbench.close'),
          cancelButtonText: t('modeler.workbench.cancel')
        }
      )
    } catch {
      return
    }
  }
  // 关闭当前标签 = store.close()；关闭其他标签 = 先切换再关闭
  if (store.doc?.id === id) {
    store.close()
  } else {
    // 切换过去再关闭（保持关闭逻辑一致）
    await store.open(id)
    store.close()
  }
}
</script>

<style scoped>
.mw {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.mw-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--ky-border);
  flex-wrap: wrap;
}
.mw-doc-select {
  width: 180px;
}

/* B3-2 多文档标签页 */
.mw-doc-tabs {
  display: flex;
  align-items: center;
  gap: 2px;
  overflow-x: auto;
  max-width: 400px;
}
.mw-doc-tab {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border: 1px solid var(--ky-border);
  border-radius: 4px 4px 0 0;
  font-size: 11px;
  cursor: pointer;
  white-space: nowrap;
  background: var(--ky-bg);
}
.mw-doc-tab:hover {
  background: var(--ky-bg-hover);
}
.mw-doc-tab.is-active {
  background: var(--ky-bg-active, color-mix(in srgb, var(--ky-accent) 10%, transparent));
  border-bottom-color: transparent;
  font-weight: 500;
}
.mw-doc-tab-label {
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 120px;
}
.mw-doc-tab-close {
  font-size: 12px;
  color: var(--ky-text-dim);
  border-radius: 2px;
}
.mw-doc-tab-close:hover {
  color: var(--el-color-danger);
  background: rgba(255, 0, 0, 0.1);
}
.mw-doc-name {
  margin-left: auto;
  font-size: 12px;
  color: var(--ky-text-dim);
}
.mw-format-select {
  width: 158px;
}
.mw-apply-hint {
  margin: 0 0 10px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--ky-text-dim);
}
.mw-apply-select {
  width: 100%;
}
.mw-display-actions {
  display: flex;
  gap: 6px;
  margin-top: 6px;
}
.mw-display-preset {
  flex: 1;
}
.mw-dirty {
  font-size: 10.5px;
  color: var(--ky-accent);
}

.mw-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
}
.mw-empty-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--ky-text);
}
.mw-empty-hint {
  margin: 0 0 6px;
  font-size: 11.5px;
  color: var(--ky-text-dim);
}

.mw-body {
  flex: 1;
  min-height: 0;
  display: flex;
}
.mw-outliner,
.mw-props {
  width: 220px;
  flex-shrink: 0;
  border-right: 1px solid var(--ky-border);
  padding: 10px 8px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.mw-props {
  border-right: none;
  border-left: 1px solid var(--ky-border);
}
.mw-col-title {
  margin: 0 0 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--ky-accent);
}

.mw-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 11.5px;
  color: var(--ky-text);
}
.mw-row:hover {
  background: var(--ky-bg-sidebar);
}
.mw-row.is-selected {
  background: var(--ky-bg-sidebar);
  color: var(--ky-accent);
}
.mw-row-kind {
  flex-shrink: 0;
  font-size: 10px;
  color: var(--ky-text-dim);
  border: 1px solid var(--ky-border);
  border-radius: 4px;
  padding: 0 3px;
}
.mw-row-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mw-row-icon {
  flex-shrink: 0;
  color: var(--ky-text-dim);
}
.mw-row-icon.is-disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.mw-viewport {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.mw-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 8px;
  font-size: 11px;
  color: var(--ky-text-dim);
}
.mw-field-inline {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}
.mw-field-label {
  display: block;
  font-size: 10.5px;
  color: var(--ky-text-dim);
  margin-bottom: 4px;
}
.mw-field-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.mw-col-gap {
  margin-top: 14px;
}
.mw-tex-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 11px;
}
.mw-tex-row:hover {
  background: var(--ky-bg-hover);
}
.mw-tex-row.is-active {
  background: color-mix(in srgb, var(--ky-accent) 14%, transparent);
}
.mw-tex-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mw-tex-size {
  font-size: 10px;
  color: var(--ky-text-dim);
  flex-shrink: 0;
}
.mw-tex-create {
  display: flex;
  gap: 4px;
  margin: 6px 0 4px;
}
.mw-tex-import {
  width: 100%;
  margin: 2px 0 4px;
}
.mw-tex-size-select {
  width: 84px;
  flex-shrink: 0;
}
.mw-vec3 {
  display: flex;
  gap: 4px;
}
.mw-vec3 .el-input-number {
  width: 100%;
}
.mw-props-hint {
  font-size: 11px;
  color: var(--ky-text-dim);
  line-height: 1.6;
}
.mw-tex-anim {
  border: 1px solid var(--ky-border, rgba(128, 128, 128, 0.25));
  border-radius: 6px;
  padding: 6px 8px;
  margin: 2px 0 4px;
}
.mw-tex-anim-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}
.mw-tex-anim-head .mw-field-label {
  margin-bottom: 0;
}
.mw-tex-anim-issue {
  font-size: 11px;
  color: var(--el-color-warning, #e6a23c);
  line-height: 1.5;
}
.mw-tex-layers {
  border: 1px solid var(--ky-border, rgba(128, 128, 128, 0.25));
  border-radius: 6px;
  padding: 6px 8px;
  margin: 2px 0 4px;
}
.mw-tex-layers-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}
.mw-tex-layers-head .mw-field-label {
  margin-bottom: 0;
}
.mw-tex-layer-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 4px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
}
.mw-tex-layer-row:hover {
  background: var(--ky-bg-hover);
}
.mw-tex-layer-row.is-active {
  background: color-mix(in srgb, var(--ky-accent) 14%, transparent);
}
.mw-tex-layer-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mw-tex-layer-opacity {
  flex: 1;
  min-width: 40px;
}

/* B3-1 参考图面板 */
.mw-ref-panel {
  border: 1px solid var(--ky-border, rgba(128, 128, 128, 0.25));
  border-radius: 6px;
  padding: 6px 8px;
  margin: 2px 0 4px;
}
.mw-ref-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 4px;
  border-radius: 4px;
  font-size: 11px;
}
.mw-ref-row:hover {
  background: var(--ky-bg-hover);
}
.mw-ref-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mw-ref-opacity {
  flex: 1;
  min-width: 40px;
}
</style>
