/**
 * jfxr / sfxr 风格参数合成器（纯 TS，零依赖，可单测）。
 *
 * 参数语义对齐 sfxr（https://www.drpetter.se/project_sfxr.html）与 jfxr：
 * 波形（方波含占空比扫掠 / 锯齿 / 正弦 / 噪声）、频率与滑音、
 * ADS 包络（attack/sustain/decay + sustainPunch）、颤音、低通/高通滤波。
 * 输出 44.1kHz 单声道 Float32Array（[-1,1]），由 wav.ts 编码为 WAV。
 *
 * 确定性：噪声表由 seed 经 mulberry32 生成，同参同 seed 输出逐样本一致。
 */

export type SfxrWaveForm = 'square' | 'sawtooth' | 'sine' | 'noise'

export interface SfxrParams {
  wave: SfxrWaveForm
  /** 基础频率 Hz（20–2000） */
  baseFreq: number
  /** 频率滑音（每采样相对增量，-1..1；jfxr 语义，小数值） */
  freqSlide: number
  /** 滑音加速度（-1..1） */
  freqDeltaSlide: number
  /** 方波占空比 0..1 */
  squareDuty: number
  /** 占空比扫掠速度（-1..1） */
  dutySweep: number
  /** 颤音深度 0..1（音分比例缩放） */
  vibratoDepth: number
  /** 颤音速度 Hz */
  vibratoSpeed: number
  /** 起音秒 */
  attackTime: number
  /** 持续秒 */
  sustainTime: number
  /** 衰减秒 */
  decayTime: number
  /** 持续期起始音量冲击 0..1（sustain 阶段从 1+punch 回落到 1） */
  sustainPunch: number
  /** 低通截止 Hz（>=22050 视为关闭） */
  lpFilterFreq: number
  /** 低通共振 0..1 */
  lpFilterResonance: number
  /** 高通截止 Hz（<=10 视为关闭） */
  hpFilterFreq: number
  /** 噪声/随机种子 */
  seed: number
  /** 总音量 0..1 */
  volume: number
}

export const DEFAULT_SFXR_PARAMS: SfxrParams = {
  wave: 'square',
  baseFreq: 440,
  freqSlide: 0,
  freqDeltaSlide: 0,
  squareDuty: 0.5,
  dutySweep: 0,
  vibratoDepth: 0,
  vibratoSpeed: 8,
  attackTime: 0,
  sustainTime: 0.12,
  decayTime: 0.25,
  sustainPunch: 0,
  lpFilterFreq: 22050,
  lpFilterResonance: 0,
  hpFilterFreq: 10,
  seed: 1,
  volume: 0.6
}

export const SFXR_SAMPLE_RATE = 44100

/** mulberry32 伪随机（确定性噪声表） */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/**
 * 按参数合成波形。输出长度 = (attack+sustain+decay) × 44100。
 * 实现参考 sfxr 的采样级状态机：相位按当前频率推进，滑音逐采样作用于频率，
 * 滤波用 sfxr 同款状态变量低通 + 一阶高通近似。
 */
export function synthesize(p: SfxrParams): Float32Array {
  const sr = SFXR_SAMPLE_RATE
  const attack = clamp(p.attackTime, 0, 4)
  const sustain = clamp(p.sustainTime, 0, 4)
  const decay = clamp(p.decayTime, 0.005, 4)
  const totalSamples = Math.max(64, Math.round((attack + sustain + decay) * sr))
  const out = new Float32Array(totalSamples)

  // 噪声表（sfxr 用 32 样本循环噪声）
  const rand = mulberry32(p.seed || 1)
  const noiseTable = new Float32Array(32)
  for (let i = 0; i < 32; i++) noiseTable[i] = rand() * 2 - 1

  let phase = 0
  let freq = clamp(p.baseFreq, 20, 20000)
  let slide = p.freqSlide
  let duty = clamp(p.squareDuty, 0, 1)

  // 低通滤波状态（sfxr fltp/fltdp/fltw 结构）
  let fltp = 0
  let fltdp = 0
  const lpOn = p.lpFilterFreq < 22050
  const fltw = lpOn ? Math.pow(clamp(p.lpFilterFreq, 10, 22050) / sr, 3) * 0.1 : 1
  const fltdmp = lpOn ? 1 - clamp(p.lpFilterResonance, 0, 1) * 0.15 : 1
  // 高通状态（一阶）
  const hpOn = p.hpFilterFreq > 10
  const hpRc = 1 / (2 * Math.PI * clamp(p.hpFilterFreq, 10, 20000))
  const hpAlpha = hpOn ? hpRc / (hpRc + 1 / sr) : 0
  let hpPrevY = 0
  let hpPrevX = 0

  const vibratoAmp = clamp(p.vibratoDepth, 0, 1) * 0.5
  const vibratoPhaseInc = (clamp(p.vibratoSpeed, 0.1, 40) * 2 * Math.PI) / sr
  let vibratoPhase = 0

  const attackN = Math.round(attack * sr)
  const sustainN = Math.round(sustain * sr)

  for (let i = 0; i < totalSamples; i++) {
    // ---- 包络 ----
    let env: number
    if (i < attackN) {
      env = attackN === 0 ? 1 : i / attackN
    } else if (i < attackN + sustainN) {
      // sustain punch：持续段从 1+punch 线性回落到 1
      const t = sustainN === 0 ? 1 : (i - attackN) / sustainN
      env = 1 + clamp(p.sustainPunch, 0, 1) * (1 - t)
    } else {
      const t = (i - attackN - sustainN) / Math.max(1, totalSamples - attackN - sustainN)
      env = 1 - t
    }

    // ---- 频率演化（滑音 + 加速度 + 颤音）----
    slide += p.freqDeltaSlide * 0.0001
    freq += slide * freq
    freq = clamp(freq, 20, 20000)
    vibratoPhase += vibratoPhaseInc
    const vib = vibratoAmp > 0 ? 1 + Math.sin(vibratoPhase) * vibratoAmp : 1

    duty = clamp(duty + p.dutySweep * 0.0005, 0, 1)

    // ---- 振荡 ----
    phase += (freq * vib) / sr
    if (phase > 1) phase -= Math.floor(phase)
    let sample: number
    switch (p.wave) {
      case 'square':
        sample = phase < duty ? 0.5 : -0.5
        break
      case 'sawtooth':
        sample = phase - 0.5
        break
      case 'sine':
        sample = Math.sin(phase * 2 * Math.PI) * 0.5
        break
      case 'noise':
        sample = noiseTable[Math.floor(phase * 32) % 32]!
        break
    }

    // ---- 滤波 ----
    if (lpOn) {
      fltdp += (sample - fltp) * fltw
      fltdp *= fltdmp
      fltp += fltdp
      sample = fltp
    }
    if (hpOn) {
      const y = hpAlpha * (hpPrevY + sample - hpPrevX)
      hpPrevY = y
      hpPrevX = sample
      sample = y
    }

    out[i] = clamp(sample * env * clamp(p.volume, 0, 1) * 2, -1, 1)
  }
  return out
}

/** 预置参数（jfxr 经典按钮） */
export const SFXR_PRESETS: Array<{ key: string; name: string; params: Partial<SfxrParams> }> = [
  {
    key: 'jump',
    name: '跳跃',
    params: { wave: 'square', baseFreq: 300, freqSlide: 0.35, sustainTime: 0.1, decayTime: 0.12, squareDuty: 0.4 }
  },
  {
    key: 'coin',
    name: '拾取/金币',
    params: { wave: 'square', baseFreq: 990, sustainTime: 0.06, decayTime: 0.3, attackTime: 0, squareDuty: 0.6 }
  },
  {
    key: 'laser',
    name: '激光/射击',
    params: { wave: 'sawtooth', baseFreq: 900, freqSlide: -0.6, sustainTime: 0.12, decayTime: 0.18, hpFilterFreq: 10 }
  },
  {
    key: 'hit',
    name: '受击',
    params: { wave: 'noise', baseFreq: 250, freqSlide: -0.3, sustainTime: 0.06, decayTime: 0.15, lpFilterFreq: 4000 }
  },
  {
    key: 'explosion',
    name: '爆炸',
    params: { wave: 'noise', baseFreq: 120, freqSlide: -0.15, sustainTime: 0.3, decayTime: 0.8, sustainPunch: 0.6, lpFilterFreq: 1200 }
  },
  {
    key: 'powerup',
    name: '升级',
    params: { wave: 'square', baseFreq: 220, freqSlide: 0.5, sustainTime: 0.15, decayTime: 0.3, vibratoDepth: 0.2, vibratoSpeed: 10 }
  },
  {
    key: 'blip',
    name: '按键/提示',
    params: { wave: 'sine', baseFreq: 660, sustainTime: 0.05, decayTime: 0.12 }
  },
  {
    key: 'ambient',
    name: '环境音垫底',
    params: { wave: 'sine', baseFreq: 180, attackTime: 0.4, sustainTime: 0.6, decayTime: 0.9, vibratoDepth: 0.15, vibratoSpeed: 3, lpFilterFreq: 2000 }
  }
]
