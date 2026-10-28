<template>
  <div class="community-view">
    <!-- 顶部：平台 tabs + 浏览工具条 -->
    <header class="cv-bar">
      <el-tabs v-model="active" class="cv-tabs" @tab-change="switchPlatform">
        <el-tab-pane v-for="p in platforms" :key="p.id" :label="p.label" :name="p.id" />
      </el-tabs>

      <!-- 诚实标注——本页只是第三方站点的内嵌浏览入口，非应用内社区 -->
      <el-tooltip
        placement="bottom-start"
        :content="t('community.extTagTip')"
      >
        <span class="cv-ext-tag">
          <el-icon :size="12"><Link /></el-icon>
          {{ t('community.extTag') }}
        </span>
      </el-tooltip>

      <div class="cv-actions">
        <el-input
          v-if="active === 'mcmod'"
          v-model="mcmodQuery"
          size="small"
          :placeholder="t('community.searchPlaceholder')"
          class="cv-search"
          clearable
          @keyup.enter="searchMcmod"
        >
          <template #append>
            <el-button :icon="Search" @click="searchMcmod" />
          </template>
        </el-input>

        <el-button-group size="small">
          <el-button :icon="ArrowLeft" :title="t('community.back')" @click="webviewEl?.goBack()" />
          <el-button :icon="ArrowRight" :title="t('community.forward')" @click="webviewEl?.goForward()" />
          <el-button :icon="Refresh" :title="t('community.refresh')" @click="webviewEl?.reload()" />
        </el-button-group>
        <!-- 英文站点页内中文化：注入脚本收集可见文本 → 主进程翻译 → 回写 DOM -->
        <el-button
          v-if="!isZhSite"
          size="small"
          :loading="pageTranslating"
          :type="pageTranslated ? 'success' : 'default'"
          :title="pageTranslated ? t('community.restoreOriginalTip') : t('community.translateTip')"
          @click="togglePageTranslate"
        >
          {{ pageTranslated ? t('community.showOriginal') : t('community.toChinese') }}
        </el-button>
        <el-button size="small" :icon="Position" :title="t('community.openExternalTip')" @click="openInBrowser" />
      </div>
    </header>

    <!-- 内嵌浏览器舞台 -->
    <div class="cv-stage">
      <webview
        ref="webviewRef"
        class="cv-webview"
        :src="viewUrl"
        partition="persist:community"
        allowpopups
        @dom-ready="onReady"
        @did-start-loading="onStartLoading"
        @did-stop-loading="onStopLoading"
        @did-fail-load="onFailLoad"
        @did-navigate="onNavigate"
        @did-navigate-in-page="onNavigateInPage"
        @page-title-updated="onTitleUpdated"
      />

      <div v-if="loading && !failError && !challengeHint" class="cv-overlay">
        <el-icon class="is-loading" :size="22"><Loading /></el-icon>
        <span>{{ t('community.loading', { host: loadingHost ? ` ${loadingHost}` : '' }) }}</span>
      </div>

      <div v-else-if="failError" class="cv-overlay cv-overlay-error">
        <el-icon :size="34" class="cv-error-icon"><WarningFilled /></el-icon>
        <p>{{ failError }}</p>
        <el-button type="primary" size="small" @click="retry">{{ t('community.retry') }}</el-button>
      </div>

      <!-- 挑战信誉保护冷却：stuck 后 24h 内不再加载挑战页，避免反复刷失败挑战打穿指纹信誉 -->
      <div v-else-if="challengeCooldown" class="cv-overlay cv-overlay-error">
        <el-icon :size="34" class="cv-error-icon"><WarningFilled /></el-icon>
        <p>{{ t('community.cooldownP1', { host: challengeCooldown.host }) }}</p>
        <p>{{ t('community.cooldownP2', { remain: cooldownRemainText }) }}</p>
        <div class="cv-cooldown-actions">
          <el-button type="primary" size="small" @click="openInBrowser">{{ t('community.openExternal') }}</el-button>
          <el-button size="small" @click="retryDespiteCooldown">{{ t('community.retryAnyway') }}</el-button>
        </div>
      </div>

      <!-- 人机验证提示条：仅顶部悬浮提示、不遮挡页面——验证由开发者在下方页面里自己完成 -->
      <div v-if="challengeHint" class="cv-challenge-tip">
        <el-icon :size="14"><WarningFilled /></el-icon>
        <span class="cv-challenge-text">{{ challengeHint }}</span>
        <el-button size="small" text type="primary" @click="openInBrowser">{{ t('community.openExternal') }}</el-button>
        <el-button size="small" text @click="dismissChallenge">{{ t('community.dismiss') }}</el-button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import {
  ArrowLeft,
  ArrowRight,
  Link,
  Loading,
  Position,
  Refresh,
  Search,
  WarningFilled
} from '@element-plus/icons-vue'
import { useMarketStore } from '../../stores/market'
import { useI18n } from '../../i18n'

/** Electron <webview> 元素在渲染层暴露的最小接口（独立 webContents 的浏览器视图） */
interface WebviewLike extends HTMLElement {
  src: string
  getURL(): string
  loadURL(url: string): Promise<void>
  goBack(): void
  goForward(): void
  reload(): void
  executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>
}

interface CommunityPlatform {
  id: string
  label: string
  home: string
}

const platforms: CommunityPlatform[] = [
  { id: 'mcmod', label: 'MC百科', home: 'https://www.mcmod.cn/' },
  { id: 'klpbbs', label: '苦力怕论坛', home: 'https://klpbbs.com/' },
  { id: 'minebbs', label: 'MineBBS', home: 'https://www.minebbs.com/' },
  { id: 'littleskin', label: 'LittleSkin', home: 'https://littleskin.cn/' },
  { id: 'namemc', label: 'NameMC', home: 'https://namemc.com/' },
  { id: 'bbsmc', label: 'BBSMC', home: 'https://bbsmc.net/' },
  { id: 'sodamc', label: 'SodaMC', home: 'https://sodamc.com/' },
  // 两大模组平台官网：webview 内嵌浏览，不走 API（CurseForge 无 Key 也可浏览）
  { id: 'modrinth', label: 'Modrinth', home: 'https://modrinth.com/mods' },
  { id: 'curseforge', label: 'CurseForge', home: 'https://www.curseforge.com/minecraft' },
  { id: 'github', label: 'GitHub', home: 'https://github.com/' }
]

/**
 * webview UA 由主进程在 persist:community 分区上统一注入（communitySession.ts）：
 * 用 process.versions.chrome 真实版本构造纯 Chrome UA，与 sec-ch-ua 客户端
 * 提示同源。渲染层不得再写死 UA——版本对不上会被 Cloudflare 判定伪造浏览器，
 * 挑战页陷入 __cf_chl_rt_tk 重载死循环，交互式人机验证渲染不出来。
 */

const market = useMarketStore()
const { t } = useI18n()
/** MC百科搜索词：进入时预填市场页当前查询，英文搜不到时直接转中文社区 */
const mcmodQuery = ref(market.query)

const active = ref<CommunityPlatform['id']>('mcmod')
const viewUrl = ref(platforms[0].home)
const loading = ref(true)
const failError = ref('')
const webviewRef = ref<WebviewLike | null>(null)

/** 中文站点无需页内翻译（MC百科/苦力怕论坛/MineBBS/LittleSkin/BBSMC/SodaMC 本身即中文） */
const isZhSite = computed(
  () =>
    active.value === 'mcmod' ||
    active.value === 'klpbbs' ||
    active.value === 'minebbs' ||
    active.value === 'littleskin' ||
    active.value === 'bbsmc' ||
    active.value === 'sodamc'
)
/** 页内翻译状态：翻译中 / 已中文化（再次点击=刷新恢复原文） */
const pageTranslating = ref(false)
const pageTranslated = ref(false)

/**
 * 人机验证（Cloudflare Turnstile / Under Attack）处理策略：
 * 应用不自动挑战、也不阻断页面——真实 Chrome UA + webview 完整 Chromium 栈
 * 可以渲染交互式验证控件，由开发者自己在页面里勾选通过；cf_clearance 存进
 * persist:community 分区后后续访问免挑战。检测到挑战标题时仅显示顶部提示条，
 * 标题恢复正常即自动消失。
 */
const challengeActive = ref(false)
const challengeDismissed = ref(false)
const CHALLENGE_STUCK_MS = 45_000

/**
 * 挑战信誉保护冷却（信誉打穿事件）：
 * Cloudflare 按「IP+浏览器指纹」在服务端累计失败挑战次数——反复加载挑战页、
 * 反复点验证会持续扣分，最终进入 managed challenge loop（点多少次都不发
 * cf_clearance）。本地清分区无效（信誉记在 CF 服务端），唯一恢复途径是
 * 停止挑战等待衰减（实测同机干净指纹零挑战，本指纹需数天）。
 * 因此 stuck 判定后立即把挑战页导航到 about:blank（Turnstile 停在挑战页会
 * 自动重试=持续刷失败挑战），并把该 host 记入 24h 冷却；冷却期内再进该站
 * 不加载 webview，只展示系统浏览器引导，用户显式点「仍要尝试」才放行。
 */
const CHALLENGE_COOLDOWN_MS = 24 * 60 * 60 * 1000
const COOLDOWN_KEY = 'ky-community-challenge-cooldown'
/** 当前生效的冷却占位（非空时盖住 webview，不再加载挑战页） */
const challengeCooldown = ref<{ host: string; until: number } | null>(null)

let stuckTimer: ReturnType<typeof setTimeout> | null = null

function clearStuckTimer(): void {
  if (stuckTimer !== null) {
    clearTimeout(stuckTimer)
    stuckTimer = null
  }
}

/** 挑战状态归零（切站 / 挑战通过 / 手动重试时调用） */
function resetChallenge(): void {
  challengeActive.value = false
  challengeDismissed.value = false
  clearStuckTimer()
}

/** 提示条文案：手动关闭后隐藏；stuck 后由冷却占位接管（提示条同步撤下） */
const challengeHint = computed(() => {
  if (!challengeActive.value || challengeDismissed.value) return ''
  return t('community.challengeHint')
})

function dismissChallenge(): void {
  challengeDismissed.value = true
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}

function readCooldowns(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(COOLDOWN_KEY) ?? '{}') as Record<string, number>
  } catch {
    return {}
  }
}

function writeCooldown(host: string, until: number): void {
  const all = readCooldowns()
  all[host] = until
  localStorage.setItem(COOLDOWN_KEY, JSON.stringify(all))
}

function clearCooldownFor(host: string): void {
  const all = readCooldowns()
  if (!(host in all)) return
  delete all[host]
  localStorage.setItem(COOLDOWN_KEY, JSON.stringify(all))
}

/** 冷却剩余时长文案（占位用） */
const cooldownRemainText = computed(() => {
  if (!challengeCooldown.value) return ''
  const ms = challengeCooldown.value.until - Date.now()
  return ms <= 0 ? t('community.remainSoon') : t('community.remainHours', { n: Math.ceil(ms / 3_600_000) })
})

/** stuck 判定落地：停挑战 + 记冷却 + 冷却占位接管（提示条撤下） */
function enterChallengeProtection(): void {
  const host = hostOf(viewUrl.value)
  const until = Date.now() + CHALLENGE_COOLDOWN_MS
  if (host) writeCooldown(host, until)
  // Turnstile 停在挑战页会自动重试 = 持续刷失败挑战，必须导航离开真正停掉脚本
  try {
    void webviewRef.value?.loadURL('about:blank')
  } catch {
    /* webview 元素未就绪时忽略 */
  }
  challengeCooldown.value = host ? { host, until } : null
  challengeActive.value = false
}

/** 用户显式选择「仍要尝试」：清冷却放行（已知情，自担信誉风险） */
function retryDespiteCooldown(): void {
  const host = challengeCooldown.value?.host
  if (host) clearCooldownFor(host)
  challengeCooldown.value = null
  const p = platforms.find((x) => x.id === active.value)
  if (p) navigateTo(p.home)
}

/** 挑战页标题特征（Cloudflare managed challenge / Turnstile） */
function isChallengeTitle(title: string): boolean {
  return /just a moment|请稍候|attention required|verify you are/i.test(title)
}

/** webview page-title-updated 事件：title 挂在事件对象上；挑战页会反复触发该事件 */
function onTitleUpdated(event: { title?: string }): void {
  const title = event.title ?? ''
  if (!title) return
  if (isChallengeTitle(title)) {
    if (!challengeActive.value) {
      // 新一轮挑战：重置手动关闭并启动超时判定
      challengeActive.value = true
      challengeDismissed.value = false
      clearStuckTimer()
      stuckTimer = setTimeout(() => {
        stuckTimer = null
        enterChallengeProtection()
      }, CHALLENGE_STUCK_MS)
    }
  } else if (challengeActive.value) {
    // 挑战通过（或离开挑战页）→ 自动撤下提示并解除该站冷却
    const host = hostOf(viewUrl.value)
    if (host) clearCooldownFor(host)
    challengeCooldown.value = null
    resetChallenge()
  }
}

onBeforeUnmount(clearStuckTimer)

/**
 * 收集 guest 页面可见英文文本节点（去重、限量 500 条）。
 * 在 webview 上下文执行；跳过脚本/样式/代码块与已含中文的文本。
 */
const COLLECT_JS = `(() => {
  const skip = new Set(['SCRIPT','STYLE','NOSCRIPT','TEXTAREA','CODE','PRE','SVG','SELECT'])
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  const set = new Set()
  let n
  while ((n = walker.nextNode())) {
    if (!n.parentElement || skip.has(n.parentElement.tagName)) continue
    const t = (n.nodeValue || '').trim()
    if (t.length < 2 || t.length > 180) continue
    if (!/[a-zA-Z]/.test(t)) continue
    if (/[\\u4e00-\\u9fff]/.test(t)) continue
    set.add(t)
    if (set.size >= 500) break
  }
  return [...set]
})()`

/**
 * 把 { 原文: 译文 } 字典回写到 guest 页面文本节点（保留首尾空白）。
 * 返回替换条数。
 */
function buildApplyJs(dict: Record<string, string>): string {
  return `((dict) => {
    const skip = new Set(['SCRIPT','STYLE','NOSCRIPT','TEXTAREA','CODE','PRE','SVG','SELECT'])
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    const nodes = []
    let n
    while ((n = walker.nextNode())) nodes.push(n)
    let count = 0
    for (const node of nodes) {
      if (!node.parentElement || skip.has(node.parentElement.tagName)) continue
      const raw = node.nodeValue || ''
      const zh = dict[raw.trim()]
      if (!zh || zh === raw.trim()) continue
      const lead = (raw.match(/^\\s*/) || [''])[0]
      const tail = (raw.match(/\\s*$/) || [''])[0]
      node.nodeValue = lead + zh + tail
      count++
    }
    return count
  })(${JSON.stringify(dict)})`
}

/**
 * 中文化开关：
 * - 未翻译 → 收集页面文本，分批（200 条/批）走主进程翻译（AI 优先、免费接口兜底），回写 DOM；
 * - 已翻译 → 刷新页面恢复原文。
 * 翻译失败/无 AI Key 时保留原文并提示，不阻断浏览。
 */
async function togglePageTranslate(): Promise<void> {
  const wv = webviewRef.value
  if (!wv) return
  if (pageTranslated.value) {
    pageTranslated.value = false
    wv.reload()
    return
  }
  pageTranslating.value = true
  try {
    const texts = (await wv.executeJavaScript(COLLECT_JS, true)) as string[]
    if (!Array.isArray(texts) || texts.length === 0) {
      ElMessage.info(t('community.noTranslatable'))
      return
    }
    const dict: Record<string, string> = {}
    let provider = ''
    for (let i = 0; i < texts.length; i += 200) {
      const batch = texts.slice(i, i + 200)
      const res = await window.api.translate.toZh(batch)
      provider = res.provider
      batch.forEach((txt, j) => {
        const zh = res.translations[j]
        if (zh) dict[txt] = zh
      })
    }
    const hits = Object.keys(dict).length
    if (hits === 0) {
      ElMessage.warning(
        provider === 'none'
          ? t('community.translateUnavailable')
          : t('community.translateEmpty')
      )
      return
    }
    const replaced = (await wv.executeJavaScript(buildApplyJs(dict), true)) as number
    pageTranslated.value = true
    const via = provider === 'ai' ? 'AI' : provider === 'free' ? t('community.viaFree') : t('community.viaCache')
    ElMessage.success(t('community.translateDone', { n: replaced ?? hits, via }))
  } catch (err) {
    ElMessage.error(t('community.translateFailed', { error: (err as Error).message }))
  } finally {
    pageTranslating.value = false
  }
}

/** 模板里可选链调用用：webviewEl?.goBack() */
const webviewEl = computed(() => webviewRef.value)

const loadingHost = computed(() => {
  try {
    return new URL(viewUrl.value).hostname
  } catch {
    return ''
  }
})

/**
 * 用户发起、尚未完成的导航目标。
 * 期间忽略 did-navigate(-in-page) 回写：旧页面（如 Cloudflare 挑战页每秒
 * replaceState 刷新 tk）会在 src 切换的异步间隙里持续上报自身 URL，
 * 不回挡会把刚设置的目标地址覆盖掉，还会因 src 属性变化形成循环重载。
 */
let pendingNavUrl = ''

/**
 * 统一导航入口：
 * * 目标 URL 与 guest 当前 URL 不同 → 更新 :src 绑定触发导航；
 * * 相同（如对同一关键词再次搜索）→ 直接 reload，避免 Vue 判定绑定值未变而不更新 src。
 */
function navigateTo(url: string): void {
  failError.value = ''
  resetChallenge()
  pageTranslated.value = false
  // 信誉保护冷却：该站挑战连续未通过后的 24h 内不再加载挑战页，
  // 避免用户反复进入触发失败挑战、进一步打穿指纹信誉
  const host = hostOf(url)
  const until = host ? (readCooldowns()[host] ?? 0) : 0
  if (host && until > Date.now()) {
    challengeCooldown.value = { host, until }
    loading.value = false
    return
  }
  challengeCooldown.value = null
  let current = ''
  try {
    current = webviewRef.value?.getURL() ?? ''
  } catch {
    current = ''
  }
  loading.value = true
  pendingNavUrl = url
  if (current === url) {
    webviewRef.value?.reload()
  } else {
    viewUrl.value = url
  }
}

/**
 * 切换平台：tab-change 触发时 v-model(active) 已同步为新值，
 * 不能用 p.id === active.value 防重复（恒真导致永不导航）；
 * 同 URL 重复导航由 navigateTo 内部按 guest 实际地址处理。
 */
function switchPlatform(name: string | number): void {
  const p = platforms.find((x) => x.id === name)
  if (!p) return
  navigateTo(p.home)
}

/** 模组市场「去 MC百科中文搜索」→ 应用内切到 MC百科 tab 并执行搜索（nonce 触发） */
watch(
  () => market.communityNonce,
  (nonce) => {
    if (!nonce) return
    active.value = 'mcmod'
    mcmodQuery.value = market.communityQuery
    searchMcmod()
  }
)

/** MC百科中文搜索：结果页同样在应用内打开 */
function searchMcmod(): void {
  const key = mcmodQuery.value.trim()
  navigateTo(
    key
      ? `https://search.mcmod.cn/s?key=${encodeURIComponent(key)}`
      : 'https://www.mcmod.cn/'
  )
}

function onReady(): void {
  loading.value = false
  failError.value = ''
}

function onStartLoading(): void {
  loading.value = true
}

function onStopLoading(): void {
  loading.value = false
  // 加载结束 = 导航已落定（成功或失败），清除 pending 以免永久屏蔽后续回写
  pendingNavUrl = ''
}

/** Electron webview did-navigate 事件：url 同样挂在事件对象上 */
interface WebviewNavigateEvent {
  url?: string
}

/** Cloudflare 挑战重定向参数（__cf_chl_rt_tk 等）：这类 URL 只在 guest 内部流转 */
const CF_CHL_RE = /[?&]__cf_chl/

/**
 * guest 实际导航后回写绑定状态：
 * 弹窗内部 loadURL、站内链接、前进/后退都会改变 guest URL，
 * 不回写会让 :src 与真实地址脱节，导致相同 URL 的再次导航被 Vue 跳过。
 * 在 pendingNavUrl 存在期间，只接受匹配目标 URL 的导航事件——旧页面
 * 的 did-navigate-in-page（如 Cloudflare 挑战页每秒 replaceState）会被忽略。
 *
 * 关键约束：Cloudflare 挑战重定向 URL（带 __cf_chl_* 参数）绝不回写 :src。
 * 挑战页会在 guest 内连续 replaceState 刷新 tk，若回写会让 Vue 重新设置 src
 * 属性 → 强制 loadURL 一个已过期 token → 打断挑战脚本自身的导航 →
 * 页面陷入重载死循环、交互式人机验证永远渲染不出来。tk URL 只活在 guest 里，
 * 挑战通过后落到干净地址，再正常回写。
 */
function onNavigate(event: WebviewNavigateEvent): void {
  loading.value = false
  failError.value = ''
  pageTranslated.value = false
  if (pendingNavUrl && event.url !== pendingNavUrl) return
  if (event.url && CF_CHL_RE.test(event.url)) {
    pendingNavUrl = ''
    return
  }
  if (event.url && event.url !== viewUrl.value) {
    viewUrl.value = event.url
  }
  pendingNavUrl = ''
}

/** 页内锚点导航：pendingNavUrl 期间忽略（排除旧页面 replaceState 干扰）；挑战 tk URL 同 onNavigate 不回写 */
function onNavigateInPage(event: WebviewNavigateEvent): void {
  if (pendingNavUrl) return
  if (event.url && CF_CHL_RE.test(event.url)) return
  if (event.url && event.url !== viewUrl.value) {
    viewUrl.value = event.url
  }
}

/** Electron <webview> did-fail-load 事件：字段挂在事件对象上（不是多参数回调） */
interface WebviewFailEvent {
  errorCode?: number
  errorDescription?: string
  validatedURL?: string
  isMainFrame?: boolean
}

/**
 * did-fail-load 处理：
 * - errorCode -3 = ERR_ABORTED：一次导航被下一次导航取代（快速切换时常见），不是真失败；
 * - 子框架/子资源失败（isMainFrame === false，如被墙的广告、统计 iframe）不遮挡已加载的主页面。
 */
function onFailLoad(event: WebviewFailEvent): void {
  const errorCode = event?.errorCode
  if (errorCode === -3) return
  if (event?.isMainFrame === false) return
  loading.value = false
  failError.value = t('community.loadFailed', {
    code: errorCode ?? '?',
    desc: event?.errorDescription ?? t('community.networkError')
  })
}

/** 剥离 Cloudflare 挑战参数（__cf_chl_*），回到干净地址 */
function cleanCfUrl(url: string): string {
  try {
    const u = new URL(url)
    for (const k of [...u.searchParams.keys()]) {
      if (k.startsWith('__cf_chl')) u.searchParams.delete(k)
    }
    return u.toString()
  } catch {
    return url
  }
}

function retry(): void {
  navigateTo(cleanCfUrl(viewUrl.value))
}

/** 显式外部打开仅允许 https（安全约束）；剥离挑战参数回到干净地址 */
function openInBrowser(): void {
  // 冷却占位期间 viewUrl 可能已被 about:blank 回写，回退到当前平台首页
  const fallback = platforms.find((x) => x.id === active.value)?.home ?? ''
  const cleaned = cleanCfUrl(viewUrl.value)
  const target = /^https:\/\//i.test(cleaned) ? cleaned : fallback
  if (/^https:\/\//i.test(target)) {
    void window.api.shell.openExternal(target)
  }
}
</script>

<style scoped>
.community-view {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--ky-bg-panel);
  overflow: hidden;
}

.cv-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 14px;
  border-bottom: 1px solid var(--ky-border);
  flex-wrap: wrap;
}

.cv-tabs {
  flex: 1;
  min-width: 240px;
}
.cv-tabs :deep(.el-tabs__header) {
  margin: 0;
}

.cv-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-bottom: 1px;
}

.cv-search {
  width: 220px;
}

/* 外部社区入口常驻标注 */
.cv-ext-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  line-height: 1;
  color: var(--ky-text-dim);
  border: 1px solid var(--ky-border);
  border-radius: 4px;
  padding: 4px 8px;
  white-space: nowrap;
  cursor: default;
  user-select: none;
}

.cv-stage {
  position: relative;
  flex: 1;
  min-height: 0;
}

.cv-webview {
  width: 100%;
  height: 100%;
  border: none;
  display: inline-flex;
}

.cv-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  background: var(--ky-bg-panel);
  color: var(--ky-text-dim);
  font-size: 13px;
}

.cv-overlay-error {
  pointer-events: auto;
}
.cv-overlay-error p {
  max-width: 420px;
  text-align: center;
  margin: 0;
  line-height: 1.6;
}
.cv-cooldown-actions {
  display: flex;
  gap: 10px;
}

/* 人机验证提示条：顶部居中悬浮，不遮挡 webview 页面交互 */
.cv-challenge-tip {
  position: absolute;
  top: 10px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: min(640px, calc(100% - 32px));
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid var(--ky-border);
  background: var(--ky-bg-panel);
  color: var(--ky-text-dim);
  font-size: 12px;
  box-shadow: var(--el-box-shadow-light);
}
.cv-challenge-text {
  line-height: 1.5;
}
.cv-error-icon {
  color: #fbbf24;
}
</style>
