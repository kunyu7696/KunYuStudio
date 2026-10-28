<template>
  <div v-if="loot" class="uev-loot">
    <div v-for="(pool, pi) in loot.pools" :key="pi" class="uev-pool">
      <div class="uev-pool-head">
        <span class="uev-pool-title">{{ t('unified.loot.pool', { n: pi + 1 }) }}</span>
        <el-radio-group
          :model-value="pool.rolls.kind"
          size="small"
          @change="(k) => setRollsKind(pool, k as 'fixed' | 'range')"
        >
          <el-radio-button value="fixed">{{ t('unified.loot.fixed') }}</el-radio-button>
          <el-radio-button value="range">{{ t('unified.loot.range') }}</el-radio-button>
        </el-radio-group>
        <el-input-number
          v-if="pool.rolls.kind === 'fixed'"
          v-model="pool.rolls.value"
          :min="0"
          size="small"
        />
        <template v-else>
          <el-input-number v-model="pool.rolls.min" :min="0" size="small" />
          <span class="uev-tilde">~</span>
          <el-input-number v-model="pool.rolls.max" :min="0" size="small" />
        </template>
        <el-button class="uev-pool-del" size="small" text @click="removePool(pi)">
          <el-icon><Delete /></el-icon>
        </el-button>
      </div>

      <table class="uev-entries">
        <thead>
          <tr>
            <th>{{ t('unified.loot.headItem') }}</th><th>{{ t('unified.loot.headCount') }}</th><th>{{ t('unified.loot.headWeight') }}</th><th>{{ t('unified.loot.headChance') }}</th><th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(e, ei) in pool.entries" :key="ei">
            <td>
              <el-input v-model="e.item" size="small" placeholder="minecraft:diamond" />
            </td>
            <td class="uev-entry-count">
              <el-select
                :model-value="e.count.kind"
                size="small"
                class="uev-count-kind"
                @change="(k) => setCountKind(e, k as 'fixed' | 'range')"
              >
                <el-option :label="t('unified.loot.fixed')" value="fixed" />
                <el-option :label="t('unified.loot.range')" value="range" />
              </el-select>
              <el-input-number
                v-if="e.count.kind === 'fixed'"
                v-model="e.count.value"
                :min="0"
                size="small"
                class="uev-count-num"
              />
              <template v-else>
                <el-input-number v-model="e.count.min" :min="0" size="small" />
                <span class="uev-tilde">~</span>
                <el-input-number v-model="e.count.max" :min="0" size="small" />
              </template>
            </td>
            <td>
              <el-input-number v-model="e.weight" :min="1" size="small" />
            </td>
            <td>
              <el-slider v-model="e.chance" :min="0" :max="1" :step="0.05" />
            </td>
            <td>
              <el-button size="small" text @click="removeEntry(pi, ei)">
                <el-icon><Delete /></el-icon>
              </el-button>
            </td>
          </tr>
          <tr v-if="!pool.entries.length">
            <td colspan="5" class="uev-entries-empty">{{ t('unified.loot.emptyPool') }}</td>
          </tr>
        </tbody>
      </table>

      <el-button size="small" @click="addEntry(pi)">
        <el-icon class="uev-btn-icon"><Plus /></el-icon>{{ t('unified.loot.addEntry') }}
      </el-button>
    </div>

    <el-button size="small" @click="addPool">
      <el-icon class="uev-btn-icon"><Plus /></el-icon>{{ t('unified.loot.addPool') }}
    </el-button>
  </div>

  <div v-else class="uev-data-empty">
    <el-icon :size="24" color="var(--ky-text-dim)"><Files /></el-icon>
    <p>{{ lootEmptyHint }}</p>
    <el-button type="primary" size="small" @click="enableLoot">
      {{ store.active?.type === 'block' ? t('unified.loot.enableBlock') : t('unified.loot.enable') }}
    </el-button>
  </div>
</template>

<script setup lang="ts">
/**
 * LootPane：战利品表编辑分段（从 UnifiedEditorView 抽出，逻辑零改动）。
 * 通过 useLoot 直接读写 unified store，无 props/emits。
 */
import { Delete, Files, Plus } from '@element-plus/icons-vue'
import { useUnifiedStore } from '../../../stores/unified'
import { useLoot } from '../composables/useLoot'
import { t } from '../../../i18n'

const store = useUnifiedStore()

const {
  loot,
  lootEmptyHint,
  enableLoot,
  addPool,
  removePool,
  addEntry,
  removeEntry,
  setRollsKind,
  setCountKind
} = useLoot()
</script>

<style scoped>
/* 战利品表 */
.uev-loot {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px;
}
.uev-pool {
  border: 1px solid var(--ky-border);
  border-radius: 8px;
  padding: 8px 10px;
  background: var(--ky-bg);
}
.uev-pool-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
  flex-wrap: wrap;
}
.uev-pool-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--ky-text);
}
.uev-pool-del {
  margin-left: auto;
  color: var(--ky-danger, #f56c6c);
}
.uev-tilde {
  color: var(--ky-text-sub);
}
.uev-entries {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 6px;
}
.uev-entries th {
  text-align: left;
  font-size: 10px;
  font-weight: 500;
  color: var(--ky-text-sub);
  padding: 3px 4px;
  border-bottom: 1px solid var(--ky-border);
}
.uev-entries td {
  padding: 3px 4px;
  vertical-align: middle;
}
.uev-entry-count {
  white-space: nowrap;
}
.uev-count-kind {
  width: 64px;
}
.uev-count-num {
  width: 90px;
}
.uev-entries-empty {
  text-align: center;
  font-size: 11px;
  color: var(--ky-text-dim);
  padding: 10px !important;
}
.uev-data-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 20px 12px;
  color: var(--ky-text-sub);
  text-align: center;
}
.uev-btn-icon {
  margin-right: 3px;
}
</style>
