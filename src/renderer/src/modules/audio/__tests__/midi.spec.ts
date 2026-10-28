/** 极简 SMF 解析与渲染测试：手工构造 format 0 文件验证音符配对、速度表与渲染输出 */
import { describe, expect, it } from 'vitest'
import { midiPitchToFreq, parseMidi, renderMidi } from '../midi'

/** 构造最小合法 SMF：division=480，tempo=120bpm（500000us/四分），一条 C4 四分音符 */
function makeMidi(opts?: { tempo?: number; noteOffTick?: number }): Uint8Array {
  const tempo = opts?.tempo ?? 500000
  const offTick = opts?.noteOffTick ?? 480
  const events: number[] = [
    // tempo meta：delta 0, FF 51 03 tt tt tt
    0x00, 0xff, 0x51, 0x03, (tempo >> 16) & 0xff, (tempo >> 8) & 0xff, tempo & 0xff,
    // note on C4 vel 100：delta 0, 90 3C 64
    0x00, 0x90, 60, 100
  ]
  // note off：变长 delta（480 = 0x83 0x60）
  if (offTick < 128) events.push(offTick)
  else events.push(0x80 | ((offTick >> 7) & 0x7f), offTick & 0x7f)
  events.push(0x80, 60, 0, 0x00, 0xff, 0x2f, 0x00)

  const track = new Uint8Array(events.length)
  track.set(events)
  const out = new Uint8Array(14 + 8 + track.length)
  const v = new DataView(out.buffer)
  v.setUint32(0, 0x4d546864) // MThd
  v.setUint32(4, 6)
  v.setUint16(8, 0) // format 0
  v.setUint16(10, 1) // ntracks
  v.setUint16(12, 480) // division
  v.setUint32(14, 0x4d54726b) // MTrk
  v.setUint32(18, track.length)
  out.set(track, 22)
  return out
}

describe('parseMidi', () => {
  it('解析单个四分音符：120bpm 下时长 0.5s', () => {
    const song = parseMidi(makeMidi())
    expect(song.trackCount).toBe(1)
    expect(song.notes).toHaveLength(1)
    expect(song.notes[0]!.pitch).toBe(60)
    expect(song.notes[0]!.start).toBeCloseTo(0, 6)
    expect(song.notes[0]!.duration).toBeCloseTo(0.5, 6)
  })

  it('慢速 tempo（60bpm）下音符时长翻倍', () => {
    const song = parseMidi(makeMidi({ tempo: 1000000 }))
    expect(song.notes[0]!.duration).toBeCloseTo(1.0, 6)
  })

  it('缺 MThd / SMPTE 时间基抛错', () => {
    expect(() => parseMidi(new Uint8Array(20))).toThrow('MThd')
    const smpte = makeMidi()
    new DataView(smpte.buffer).setUint16(12, 0x8000 | 96)
    expect(() => parseMidi(smpte)).toThrow('SMPTE')
  })
})

describe('renderMidi', () => {
  it('音高换算：A4=440Hz，C4≈261.63Hz', () => {
    expect(midiPitchToFreq(69)).toBeCloseTo(440, 6)
    expect(midiPitchToFreq(60)).toBeCloseTo(261.63, 1)
  })

  it('渲染长度覆盖歌曲时长 + 释音尾，无 NaN、软限幅在 ±1 附近', () => {
    const song = parseMidi(makeMidi())
    const out = renderMidi(song)
    expect(out.length).toBeGreaterThanOrEqual(Math.floor(0.7 * 44100))
    let peak = 0
    for (const s of out) {
      expect(Number.isNaN(s)).toBe(false)
      if (Math.abs(s) > peak) peak = Math.abs(s)
    }
    expect(peak).toBeGreaterThan(0.05)
    expect(peak).toBeLessThanOrEqual(1.01)
  })
})
