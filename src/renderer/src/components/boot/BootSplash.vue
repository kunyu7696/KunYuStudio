<template>
  <!-- 不用 <Transition> 做退场：其类名推进依赖 rAF，窗口隐藏时会卡住不移除；
       改为 phase-done 驱动 CSS 淡出，再由 useBootSplash 按 FADE_MS 直接卸载 -->
  <div
    v-if="visible"
    class="boot-splash"
    :class="`phase-${phase}`"
    role="dialog"
    aria-modal="true"
    :aria-label="t('boot.aria')"
    @click="skip"
  >
    <!-- 第一幕：品牌亮相 -->
    <section class="act act1">
      <div class="beam" />
      <img v-if="iconSrc" class="emblem" :src="iconSrc" alt="" draggable="false" />
      <div class="wordmark">KunYu Studio</div>
      <div class="tagline">{{ t('boot.tagline') }}</div>
      <div class="underline" />
    </section>

    <!-- 第二幕：方块世界 -->
    <section class="act act2">
      <div class="cyber-floor" />
      <div class="cyber-horizon" />
      <div class="cubes">
        <span v-for="(style, i) in cubes" :key="i" class="cube" :style="style" />
      </div>
      <div class="bigline"><span>{{ t('boot.slogan') }}</span></div>
      <div class="neon-line" />
      <div class="scanlines" />
      <div class="vignette" />
    </section>

    <!-- 启动日志：逐行对应 App.vue 里真实执行的初始化步骤 -->
    <div class="bootlog" role="log">
      <div v-for="id in BOOT_STEP_IDS" :key="id" class="logline" :class="steps[id].status">
        <span class="mark">{{ markOf(steps[id].status) }}</span>
        <span class="label">{{ t(`boot.steps.${id}`) }}</span>
        <span class="dots" />
        <span class="meta">
          <template v-if="steps[id].status === 'running'">{{ t('boot.running') }}</template>
          <template v-else-if="steps[id].status === 'done'">{{ steps[id].ms }}ms</template>
          <template v-else-if="steps[id].status === 'error'">{{ t('boot.error') }}</template>
          <template v-else>—</template>
        </span>
      </div>
    </div>

    <!-- 进度：只认已完成步骤，不造假 -->
    <div class="progress"><span :style="{ transform: `scaleX(${progress})` }" /></div>

    <button class="skip" type="button" @click.stop="skip">{{ t('boot.skip') }}</button>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import appIconUrl from '../../assets/app-icon.png'
import { t } from '../../i18n'
import { BOOT_STEP_IDS, useBootSplash, type BootStepStatus } from '../../composables/useBootSplash'

const { visible, phase, steps, progress, skip } = useBootSplash()

const iconSrc = ref('')

function markOf(status: BootStepStatus): string {
  if (status === 'done') return '✓'
  if (status === 'error') return '!'
  if (status === 'running') return '›'
  return '·'
}

/**
 * 方块雨：一次性生成静态随机参数，交给 CSS 关键帧循环。
 * 用负 animation-delay 打散相位，避免所有方块同步下落。
 */
const cubes = Array.from({ length: 32 }, () => {
  const size = 8 + Math.random() * 26
  const duration = 1.6 + Math.random() * 1.8
  return {
    '--s': `${size.toFixed(0)}px`,
    '--o': (0.38 + Math.random() * 0.48).toFixed(2),
    '--dx': `${(Math.random() * 22 - 11).toFixed(1)}vw`,
    '--rot': `${Math.random() * 360 - 180}deg`,
    '--dur': `${duration.toFixed(2)}s`,
    '--delay': `-${(Math.random() * duration).toFixed(2)}s`,
    left: `${Math.random() * 100}%`
  } as Record<string, string>
})

/**
 * 图标去白底：从边界做连通区泛洪，把真背景抠成透明，
 * 并对边缘按白度羽化 alpha——直接贴白色底图在深色启动层上会很突兀。
 */
async function cutWhiteBackground(src: string): Promise<string> {
  const img = new Image()
  img.src = src
  await img.decode()
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) return src
  ctx.drawImage(img, 0, 0)
  const { width: w, height: h } = canvas
  const image = ctx.getImageData(0, 0, w, h)
  const data = image.data
  const removed = new Uint8Array(w * h)

  const isWhite = (idx: number): boolean => {
    const o = idx * 4
    if (data[o + 3] === 0) return false
    const r = data[o]
    const g = data[o + 1]
    const b = data[o + 2]
    return Math.min(r, g, b) >= 232 && Math.max(r, g, b) - Math.min(r, g, b) <= 20
  }

  const stack: number[] = []
  const seed = (x: number, y: number): void => {
    const idx = y * w + x
    if (!removed[idx] && isWhite(idx)) {
      removed[idx] = 1
      stack.push(idx)
    }
  }
  for (let x = 0; x < w; x++) {
    seed(x, 0)
    seed(x, h - 1)
  }
  for (let y = 0; y < h; y++) {
    seed(0, y)
    seed(w - 1, y)
  }
  while (stack.length) {
    const idx = stack.pop() as number
    const x = idx % w
    const y = (idx - x) / w
    if (x > 0) seed(x - 1, y)
    if (x < w - 1) seed(x + 1, y)
    if (y > 0) seed(x, y - 1)
    if (y < h - 1) seed(x, y + 1)
  }

  for (let idx = 0; idx < removed.length; idx++) {
    const o = idx * 4
    if (removed[idx]) {
      data[o + 3] = 0
      continue
    }
    // 紧邻被抠除区域的浅色像素按白度降低不透明度，消除锯齿白边
    const x = idx % w
    const y = (idx - x) / w
    const neighborRemoved =
      (x > 0 && removed[idx - 1]) ||
      (x < w - 1 && removed[idx + 1]) ||
      (y > 0 && removed[idx - w]) ||
      (y < h - 1 && removed[idx + w])
    if (neighborRemoved) {
      const mn = Math.min(data[o], data[o + 1], data[o + 2])
      if (mn >= 200) {
        const whiteness = Math.min(1, (mn - 200) / 55)
        data[o + 3] = Math.round(data[o + 3] * (1 - whiteness))
      }
    }
  }

  ctx.putImageData(image, 0, 0)
  return canvas.toDataURL('image/png')
}

onMounted(() => {
  void cutWhiteBackground(appIconUrl)
    .then((src) => {
      iconSrc.value = src
    })
    .catch(() => {
      iconSrc.value = appIconUrl
    })
})

onBeforeUnmount(() => {
  iconSrc.value = ''
})
</script>

<style scoped>
.boot-splash {
  position: fixed;
  inset: 0;
  z-index: 9999;
  overflow: hidden;
  background: #070a12;
  color: #eaf2ff;
  font-family: 'Inter', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif;
  cursor: pointer;
  user-select: none;
  /* 退场：整层（画面 + 日志 + 进度）一起淡出，时长与 useBootSplash 的 FADE_MS 对齐 */
  transition: opacity 1s ease;
}

/* 第二幕演完后由 phase-done 触发整层淡出，避免画面与日志先后消失 */
.phase-done {
  opacity: 0;
}

/* ---------------- 第一幕 ---------------- */
.act {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  transition: opacity 1.2s ease, transform 1.2s ease, filter 1.2s ease;
}

.act1 {
  gap: 0;
  opacity: 1;
  transform: scale(1);
  filter: blur(0);
}

.phase-scene .act1,
.phase-done .act1 {
  opacity: 0;
  transform: scale(1.06);
  filter: blur(6px);
}

.beam {
  position: absolute;
  top: -12%;
  width: 46vh;
  height: 46vh;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(41, 121, 255, 0.34), rgba(41, 121, 255, 0) 68%);
  filter: blur(14px);
  animation: beamPulse 3.4s ease-in-out infinite;
}

.emblem {
  width: clamp(96px, 22vh, 210px);
  height: auto;
  filter: drop-shadow(0 12px 40px rgba(41, 121, 255, 0.45));
  animation: emblemIn 0.9s cubic-bezier(0.2, 0.9, 0.2, 1) both;
}

.wordmark {
  margin-top: 18px;
  font-size: clamp(22px, 3.6vw, 44px);
  font-weight: 700;
  letter-spacing: 0.06em;
  text-shadow: 0 0 26px rgba(41, 121, 255, 0.45);
  animation: riseIn 0.8s cubic-bezier(0.2, 0.9, 0.2, 1) 0.18s both;
}

.tagline {
  margin-top: 10px;
  font-size: clamp(10px, 1.1vw, 13px);
  letter-spacing: 0.42em;
  color: rgba(190, 214, 255, 0.62);
  animation: riseIn 0.8s cubic-bezier(0.2, 0.9, 0.2, 1) 0.34s both;
}

.underline {
  margin-top: 20px;
  width: clamp(140px, 26vw, 260px);
  height: 2px;
  border-radius: 2px;
  background: linear-gradient(90deg, transparent, #2979ff, transparent);
  transform-origin: 50% 50%;
  animation: lineIn 0.9s cubic-bezier(0.2, 0.9, 0.2, 1) 0.5s both;
}

/* ---------------- 第二幕 ---------------- */
.act2 {
  opacity: 0;
  transform: scale(1.04);
  background:
    radial-gradient(60% 46% at 50% 58%, rgba(41, 121, 255, 0.2), transparent 72%),
    radial-gradient(42% 34% at 78% 22%, rgba(94, 62, 189, 0.2), transparent 76%),
    linear-gradient(180deg, #06080f, #0a0f1d);
}

.phase-scene .act2 {
  opacity: 1;
  transform: scale(1);
}

.phase-done .act2 {
  opacity: 1;
}

/* 透视地面网格：近大远小，持续向前滚动 */
.cyber-floor {
  position: absolute;
  left: -60%;
  right: -60%;
  bottom: 0;
  height: 140%;
  transform: perspective(600px) rotateX(60deg);
  transform-origin: 50% 100%;
  background-color: rgba(41, 121, 255, 0.16);
  background-image:
    linear-gradient(rgba(96, 164, 255, 0.8) 2px, transparent 2px),
    linear-gradient(90deg, rgba(96, 164, 255, 0.8) 2px, transparent 2px);
  background-size: 64px 64px, 64px 64px;
  -webkit-mask-image: linear-gradient(
    180deg,
    transparent 0%,
    rgba(0, 0, 0, 0.5) 10%,
    #000 38%
  );
  mask-image: linear-gradient(180deg, transparent 0%, rgba(0, 0, 0, 0.5) 10%, #000 38%);
  animation: floorScroll 1.8s linear infinite;
  pointer-events: none;
}

.cyber-horizon {
  position: absolute;
  left: 8%;
  right: 8%;
  top: 55%;
  height: 120px;
  background: radial-gradient(60% 100% at 50% 100%, rgba(41, 121, 255, 0.42), transparent 72%);
  filter: blur(12px);
}

.cubes {
  position: absolute;
  inset: 0;
  overflow: hidden;
}

.cube {
  position: absolute;
  top: -12%;
  width: var(--s);
  height: var(--s);
  border-radius: 2px;
  /* 亮边 + 外发光：深色底和地面网格上都能看出方块轮廓 */
  border: 1px solid rgba(168, 210, 255, 0.55);
  background: linear-gradient(145deg, rgba(150, 200, 255, 0.92), rgba(41, 121, 255, 0.45));
  box-shadow: 0 0 14px rgba(41, 121, 255, 0.5);
  opacity: var(--o);
  animation: cubeFall var(--dur) linear var(--delay) infinite;
}

.bigline {
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  justify-content: center;
  padding: 0 24px;
}

.bigline span {
  font-size: clamp(28px, 7.4vw, 128px);
  font-weight: 800;
  letter-spacing: 0.05em;
  line-height: 1.1;
  color: #f4f8ff;
  text-shadow: 0 0 34px rgba(41, 121, 255, 0.5), 0 2px 0 rgba(9, 15, 30, 0.6);
  clip-path: inset(0 100% 0 0);
  transition: clip-path 1s cubic-bezier(0.16, 1, 0.3, 1) 0.2s;
}

.phase-scene .bigline span {
  clip-path: inset(0 0 0 0);
}

.neon-line {
  position: absolute;
  left: 50%;
  top: calc(50% + clamp(42px, 8vw, 96px));
  width: min(72vw, 560px);
  height: 2px;
  transform: translateX(-50%) scaleX(0);
  background: linear-gradient(90deg, transparent, rgba(120, 176, 255, 0.9), transparent);
  box-shadow: 0 0 18px rgba(41, 121, 255, 0.55);
  transition: transform 0.95s cubic-bezier(0.16, 1, 0.3, 1) 0.6s;
}

.phase-scene .neon-line {
  transform: translateX(-50%) scaleX(1);
}

.scanlines {
  position: absolute;
  inset: 0;
  background: repeating-linear-gradient(
    180deg,
    rgba(255, 255, 255, 0.045) 0 1px,
    transparent 1px 3px
  );
  mix-blend-mode: screen;
  opacity: 0.55;
}

.vignette {
  position: absolute;
  inset: 0;
  background: radial-gradient(120% 96% at 50% 48%, transparent 52%, rgba(0, 0, 0, 0.72) 100%);
}

/* ---------------- 启动日志（真实事件） ---------------- */
.bootlog {
  position: absolute;
  left: clamp(16px, 3vw, 40px);
  bottom: clamp(44px, 7vh, 76px);
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-family: 'JetBrains Mono', 'Cascadia Mono', Consolas, monospace;
  font-size: clamp(10px, 1.02vw, 12.5px);
  letter-spacing: 0.04em;
  z-index: 5;
  max-width: min(52vw, 460px);
}

.logline {
  display: flex;
  align-items: baseline;
  gap: 8px;
  color: rgba(176, 198, 232, 0.5);
  transition: color 0.3s ease;
}

.logline.running {
  color: #cfe2ff;
}

.logline.done {
  color: rgba(196, 219, 255, 0.9);
}

.logline.error {
  color: #ff8a8a;
}

.mark {
  width: 12px;
  flex: none;
  text-align: center;
}

.label {
  flex: none;
}

.dots {
  flex: 1;
  min-width: 18px;
  transform: translateY(-2px);
  border-bottom: 1px dotted rgba(150, 180, 220, 0.28);
}

.meta {
  flex: none;
  font-variant-numeric: tabular-nums;
  opacity: 0.85;
}

.progress {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 2px;
  background: rgba(80, 120, 200, 0.18);
  z-index: 6;
}

.progress span {
  display: block;
  height: 100%;
  transform-origin: 0 50%;
  transform: scaleX(0);
  background: linear-gradient(90deg, #1d5bd6, #74b4ff);
  box-shadow: 0 0 14px rgba(41, 121, 255, 0.7);
  transition: transform 0.42s cubic-bezier(0.3, 0.9, 0.3, 1);
}

.skip {
  position: absolute;
  right: clamp(14px, 2.4vw, 28px);
  bottom: clamp(16px, 2.6vh, 26px);
  padding: 6px 12px;
  border: 1px solid rgba(140, 175, 230, 0.28);
  border-radius: 999px;
  background: rgba(10, 16, 30, 0.55);
  color: rgba(190, 210, 240, 0.75);
  font-size: 12px;
  letter-spacing: 0.08em;
  cursor: pointer;
  transition: border-color 0.2s ease, color 0.2s ease;
  z-index: 7;
}

.skip:hover {
  border-color: rgba(160, 196, 255, 0.6);
  color: #eaf2ff;
}

/* ---------------- 动效 ---------------- */
@keyframes emblemIn {
  from {
    opacity: 0;
    transform: translateY(14px) scale(0.9);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@keyframes riseIn {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes lineIn {
  from {
    opacity: 0;
    transform: scaleX(0);
  }
  to {
    opacity: 1;
    transform: scaleX(1);
  }
}

@keyframes beamPulse {
  0%,
  100% {
    opacity: 0.55;
    transform: scale(1);
  }
  50% {
    opacity: 0.9;
    transform: scale(1.08);
  }
}

@keyframes floorScroll {
  from {
    background-position: 0 0, 0 0;
  }
  to {
    background-position: 0 64px, 0 0;
  }
}

@keyframes cubeFall {
  0% {
    transform: translate3d(0, 0, 0) rotate(0deg);
    opacity: 0;
  }
  12% {
    opacity: var(--o);
  }
  88% {
    opacity: var(--o);
  }
  100% {
    transform: translate3d(var(--dx), 124vh, 0) rotate(var(--rot));
    opacity: 0;
  }
}
</style>
