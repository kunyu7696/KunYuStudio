/** jfxr 参数合成器测试：确定性、包络形状、限幅与预置合法性 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SFXR_PARAMS,
  SFXR_PRESETS,
  SFXR_SAMPLE_RATE,
  synthesize,
  type SfxrParams
} from '../sfxr'

const base = (over: Partial<SfxrParams> = {}): SfxrParams => ({ ...DEFAULT_SFXR_PARAMS, ...over })

describe('synthesize', () => {
  it('输出长度 = (attack+sustain+decay) × 44100', () => {
    const out = synthesize(base({ attackTime: 0.1, sustainTime: 0.2, decayTime: 0.3 }))
    expect(out.length).toBe(Math.round(0.6 * SFXR_SAMPLE_RATE))
  })

  it('同参同 seed 逐样本一致（确定性）', () => {
    const a = synthesize(base({ wave: 'noise', seed: 42 }))
    const b = synthesize(base({ wave: 'noise', seed: 42 }))
    expect(Array.from(a.slice(0, 500))).toEqual(Array.from(b.slice(0, 500)))
  })

  it('不同 seed 的噪声不同', () => {
    const a = synthesize(base({ wave: 'noise', seed: 1 }))
    const b = synthesize(base({ wave: 'noise', seed: 2 }))
    expect(Array.from(a.slice(0, 200))).not.toEqual(Array.from(b.slice(0, 200)))
  })

  it('样本始终在 [-1,1]（限幅）', () => {
    const out = synthesize(base({ volume: 1, sustainPunch: 1, wave: 'square' }))
    for (const s of out) {
      expect(Math.abs(s)).toBeLessThanOrEqual(1)
    }
  })

  it('attack 从 0 爬升，decay 末端归零', () => {
    const out = synthesize(base({ attackTime: 0.2, sustainTime: 0, decayTime: 0.2, wave: 'sine', baseFreq: 1000 }))
    expect(Math.abs(out[0]!)).toBeLessThan(0.05)
    expect(Math.abs(out[out.length - 1]!)).toBeLessThan(0.05)
  })

  it('静音参数不产出 NaN', () => {
    const out = synthesize(base({ baseFreq: 20, sustainTime: 0, decayTime: 0.005 }))
    for (const s of out) expect(Number.isNaN(s)).toBe(false)
  })

  it('全部预置参数均可合成且有声', () => {
    for (const p of SFXR_PRESETS) {
      const out = synthesize(base(p.params))
      expect(out.length).toBeGreaterThan(64)
      expect(Math.max(...Array.from(out).map(Math.abs))).toBeGreaterThan(0.01)
    }
  })
})
