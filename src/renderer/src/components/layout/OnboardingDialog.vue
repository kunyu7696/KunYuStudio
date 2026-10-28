<template>
  <!-- 首次启动引导：3 张卡片说明「活动栏按项目类型显隐」这一核心交互；
       仅首次启动显示，之后可从 帮助菜单 再次打开 -->
  <el-dialog
    v-model="visible"
    :title="t('onboarding.title')"
    width="560px"
    :close-on-click-modal="true"
    append-to-body
    custom-class="onboarding-dialog"
  >
    <div class="ob-cards">
      <div class="ob-card">
        <div class="ob-card-title">{{ t('onboarding.card1Title') }}</div>
        <div class="ob-card-body">{{ t('onboarding.card1Body') }}</div>
      </div>
      <div class="ob-card">
        <div class="ob-card-title">{{ t('onboarding.card2Title') }}</div>
        <div class="ob-card-body">{{ t('onboarding.card2Body') }}</div>
      </div>
      <div class="ob-card">
        <div class="ob-card-title">{{ t('onboarding.card3Title') }}</div>
        <div class="ob-card-body">{{ t('onboarding.card3Body') }}</div>
      </div>
    </div>
    <template #footer>
      <el-checkbox v-model="neverShow">{{ t('onboarding.neverShow') }}</el-checkbox>
      <el-button type="primary" class="ob-start" @click="close">{{ t('onboarding.start') }}</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useUiStore } from '../../stores/ui'
import { t } from '../../i18n'

const ONBOARDED_KEY = 'kunyu:onboarded'

const ui = useUiStore()
const neverShow = ref(true)

const visible = computed({
  get: () => ui.onboardingOpen,
  set: (v: boolean) => {
    if (!v) close()
  }
})

onMounted(() => {
  if (!localStorage.getItem(ONBOARDED_KEY)) ui.onboardingOpen = true
})

function close(): void {
  if (neverShow.value) localStorage.setItem(ONBOARDED_KEY, '1')
  ui.onboardingOpen = false
}
</script>

<style scoped>
.ob-cards {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.ob-card {
  padding: 10px 12px;
  border: 1px solid var(--ky-border);
  border-radius: 8px;
  background: var(--ky-bg-hover);
}

.ob-card-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--ky-text);
  margin-bottom: 4px;
}

.ob-card-body {
  font-size: 12px;
  line-height: 1.6;
  color: var(--ky-text-sub);
}

.ob-start {
  margin-left: 12px;
}
</style>
