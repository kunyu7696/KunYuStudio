<template>
  <!-- 赞助鸣谢：顶栏「赞助鸣谢」入口打开，展示鸣谢名单并提供爱发电赞助跳转 -->
  <el-dialog v-model="visible" :title="t('sponsor.title')" width="580px" append-to-body>
    <p class="sp-intro">{{ t('sponsor.intro') }}</p>

    <section class="sp-section">
      <div class="sp-heading">{{ t('sponsor.sponsorsTitle') }}</div>
      <div v-if="SPONSORS.length" class="sp-names">
        <span v-for="name in SPONSORS" :key="name" class="sp-name">{{ name }}</span>
      </div>
      <div v-else class="sp-empty">{{ t('sponsor.sponsorsEmpty') }}</div>
      <el-button type="primary" size="small" class="sp-cta" @click="openLink(AFDIAN_URL)">
        {{ t('sponsor.cta') }}
      </el-button>
    </section>

    <section class="sp-section">
      <div class="sp-heading">{{ t('sponsor.upstreamTitle') }}</div>
      <div class="sp-desc">{{ t('sponsor.upstreamDesc') }}</div>
      <div class="sp-chips">
        <span v-for="project in UPSTREAM" :key="project" class="sp-chip">{{ project }}</span>
      </div>
    </section>

    <section class="sp-section">
      <div class="sp-heading">{{ t('sponsor.communityTitle') }}</div>
      <div class="sp-desc">{{ t('sponsor.communityDesc') }}</div>
      <div class="sp-links">
        <el-button text size="small" @click="openLink(QQ_GROUP_URL)">{{ t('sponsor.qqGroup') }}</el-button>
        <el-button text size="small" @click="openLink(REPO_URL)">{{ t('sponsor.repo') }}</el-button>
      </div>
    </section>

    <template #footer>
      <el-button size="small" @click="visible = false">{{ t('sponsor.close') }}</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useUiStore } from '../../stores/ui'
import { t } from '../../i18n'

/** 赞助页：与 .github/FUNDING.yml 保持一致 */
const AFDIAN_URL = 'https://afdian.com/a/KunYuStudio'
const QQ_GROUP_URL = 'https://qm.qq.com/q/fTdLJLLgVU'
const REPO_URL = 'https://github.com/kunyu7696/KunYuStudio'

/** 赞助者名单（按送达顺序排列，留空时展示空态引导） */
const SPONSORS: string[] = []

/** 上游开源生态：这个工具直接建立在它们之上 */
const UPSTREAM: string[] = [
  'NeoForge',
  'Minecraft Forge',
  'Fabric',
  'ModDevGradle',
  'Fabric Loom',
  'Parchment',
  'Electron',
  'Vue',
  'Element Plus',
  'Monaco Editor',
  'Three.js',
  'better-sqlite3',
  'Vite'
]

const ui = useUiStore()

const visible = computed({
  get: () => ui.sponsorOpen,
  set: (v: boolean) => {
    ui.sponsorOpen = v
  }
})

/** 外部链接交给主进程用系统浏览器打开，避免在应用内导航 */
function openLink(url: string): void {
  void window.api.shell.openExternal(url)
}
</script>

<style scoped>
.sp-intro {
  margin: 0 0 14px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--ky-text-sub);
}

.sp-section + .sp-section {
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid var(--ky-border);
}

.sp-heading {
  font-size: 13px;
  font-weight: 600;
  color: var(--ky-text);
  margin-bottom: 6px;
}

.sp-desc {
  font-size: 12px;
  line-height: 1.6;
  color: var(--ky-text-sub);
  margin-bottom: 8px;
}

.sp-empty {
  font-size: 12px;
  line-height: 1.6;
  color: var(--ky-text-dim);
  padding: 10px 12px;
  border: 1px dashed var(--ky-border);
  border-radius: 8px;
}

.sp-names {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.sp-name {
  font-size: 12px;
  color: var(--ky-text);
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--ky-bg-hover);
}

.sp-cta {
  margin-top: 10px;
}

.sp-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.sp-chip {
  font-size: 11px;
  color: var(--ky-text-sub);
  padding: 2px 8px;
  border: 1px solid var(--ky-border);
  border-radius: 999px;
}

.sp-links {
  display: flex;
  gap: 4px;
  margin-left: -8px;
}
</style>
