/**
 * 极简标准 MIDI 文件（SMF 0/1）解析与渲染（纯 TS，可单测）。
 *
 * 覆盖：MThd/MTrk 块、变长增量时间、running status、Note On/Off、
 * Set Tempo 元事件（多速度段按时间轴展开）。其余事件跳过。
 * 渲染：正弦基音 + 二次泛音、指数衰减包络的简易合成，混音为 44.1kHz 单声道。
 * 定位是「把旋律草稿变成游戏可用的垫底/提示音素材」，不追求音色真实。
 */

export interface MidiNote {
  /** 起始秒 */
  start: number
  /** 时长秒 */
  duration: number
  /** MIDI 音高 0-127 */
  pitch: number
  /** 力度 0-127 */
  velocity: number
}

export interface MidiSong {
  notes: MidiNote[]
  /** 总时长秒 */
  durationSec: number
  /** 曲目内含的音符数（解析期统计，含未配对 NoteOn 的兜底闭合） */
  trackCount: number
}

function readVarLen(view: DataView, pos: number): { value: number; next: number } {
  let value = 0
  let p = pos
  for (let i = 0; i < 4; i++) {
    const b = view.getUint8(p++)
    value = (value << 7) | (b & 0x7f)
    if ((b & 0x80) === 0) return { value, next: p }
  }
  return { value, next: p }
}

/** 解析 SMF 字节为音符列表；非法文件抛错 */
export function parseMidi(bytes: Uint8Array): MidiSong {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.byteLength < 14 || view.getUint32(0) !== 0x4d546864) {
    throw new Error('不是合法的 MIDI 文件（缺少 MThd 头）')
  }
  const headerLen = view.getUint32(4)
  const format = view.getUint16(8)
  const trackCount = view.getUint16(10)
  const division = view.getUint16(12)
  if (format > 1) throw new Error('仅支持 SMF format 0/1')
  if (division & 0x8000) throw new Error('暂不支持 SMPTE 时间基的 MIDI')
  const ticksPerQuarter = division

  // 第一遍：收集全局 tempo 事件（tick → us/quarter）
  interface TempoPoint {
    tick: number
    usPerQuarter: number
  }
  const tempos: TempoPoint[] = [{ tick: 0, usPerQuarter: 500000 }]
  const tracks: Array<{ start: number; end: number }> = []
  let pos = 8 + headerLen
  for (let t = 0; t < trackCount; t++) {
    if (pos + 8 > bytes.byteLength || view.getUint32(pos) !== 0x4d54726b) break
    const len = view.getUint32(pos + 4)
    tracks.push({ start: pos + 8, end: pos + 8 + len })
    pos += 8 + len
  }
  if (tracks.length === 0) throw new Error('MIDI 文件中没有音轨块（MTrk）')

  for (const tr of tracks) {
    let p = tr.start
    let tick = 0
    let status = 0
    while (p < tr.end) {
      const delta = readVarLen(view, p)
      tick += delta.value
      p = delta.next
      let ev = view.getUint8(p)
      if (ev < 0x80) {
        ev = status // running status
      } else {
        p++
        if (ev < 0xf0) status = ev
      }
      if (ev === 0xff) {
        const meta = view.getUint8(p++)
        const len = readVarLen(view, p)
        p = len.next
        if (meta === 0x51 && len.value >= 3) {
          const us = (view.getUint8(p) << 16) | (view.getUint8(p + 1) << 8) | view.getUint8(p + 2)
          tempos.push({ tick, usPerQuarter: us })
        }
        if (meta === 0x2f) break // end of track
        p += len.value
      } else if (ev === 0xf0 || ev === 0xf7) {
        const len = readVarLen(view, p)
        p = len.next + len.value
      } else {
        const kind = ev & 0xf0
        const dataBytes = kind === 0xc0 || kind === 0xd0 ? 1 : 2
        p += dataBytes
      }
    }
  }
  tempos.sort((a, b) => a.tick - b.tick)

  /** tick → 秒（按 tempo 分段线性积分） */
  const tickToSec = (tick: number): number => {
    let sec = 0
    let prevTick = 0
    let cur = 500000
    for (const tp of tempos) {
      if (tp.tick > tick) break
      sec += ((tp.tick - prevTick) * cur) / 1_000_000 / ticksPerQuarter
      prevTick = tp.tick
      cur = tp.usPerQuarter
    }
    sec += ((tick - prevTick) * cur) / 1_000_000 / ticksPerQuarter
    return sec
  }

  // 第二遍：配对 NoteOn/NoteOff
  const notes: MidiNote[] = []
  const active = new Map<number, { startTick: number; velocity: number }[]>()
  let maxTick = 0
  for (const tr of tracks) {
    let p = tr.start
    let tick = 0
    let status = 0
    while (p < tr.end) {
      const delta = readVarLen(view, p)
      tick += delta.value
      if (tick > maxTick) maxTick = tick
      p = delta.next
      let ev = view.getUint8(p)
      if (ev < 0x80) {
        ev = status
      } else {
        p++
        if (ev < 0xf0) status = ev
      }
      if (ev === 0xff) {
        const meta = view.getUint8(p++)
        const len = readVarLen(view, p)
        p = len.next + len.value
        if (meta === 0x2f) break
        continue
      }
      if (ev === 0xf0 || ev === 0xf7) {
        const len = readVarLen(view, p)
        p = len.next + len.value
        continue
      }
      const kind = ev & 0xf0
      if (kind === 0x90 || kind === 0x80) {
        const pitch = view.getUint8(p)
        const velocity = view.getUint8(p + 1)
        p += 2
        if (kind === 0x90 && velocity > 0) {
          const list = active.get(pitch) ?? []
          list.push({ startTick: tick, velocity })
          active.set(pitch, list)
        } else {
          const list = active.get(pitch)
          const on = list?.shift()
          if (on) {
            const start = tickToSec(on.startTick)
            notes.push({ start, duration: Math.max(0.03, tickToSec(tick) - start), pitch, velocity: on.velocity })
          }
        }
      } else {
        p += kind === 0xc0 || kind === 0xd0 ? 1 : 2
      }
    }
  }
  // 未闭合的 NoteOn 兜底给 0.25s
  for (const [pitch, list] of active) {
    for (const on of list) {
      const start = tickToSec(on.startTick)
      notes.push({ start, duration: 0.25, pitch, velocity: on.velocity })
    }
  }
  notes.sort((a, b) => a.start - b.start)
  const durationSec = Math.max(tickToSec(maxTick), notes.reduce((m, n) => Math.max(m, n.start + n.duration), 0))
  return { notes, durationSec, trackCount: tracks.length }
}

/** MIDI 音高 → 频率 Hz */
export function midiPitchToFreq(pitch: number): number {
  return 440 * Math.pow(2, (pitch - 69) / 12)
}

/**
 * 渲染为 44.1kHz 单声道采样。简易音色：正弦基音 + 0.3 二次泛音 + 0.12 三次泛音，
 * 每音指数衰减（尾部截断在 note 结束 + 0.2s 释音）。
 */
export function renderMidi(song: MidiSong, sampleRate = 44100): Float32Array {
  const tail = 0.2
  const total = Math.max(1, Math.ceil((song.durationSec + tail) * sampleRate))
  const out = new Float32Array(total)
  for (const n of song.notes) {
    const freq = midiPitchToFreq(n.pitch)
    const vel = (n.velocity / 127) * 0.35
    const start = Math.floor(n.start * sampleRate)
    const len = Math.min(total - start, Math.ceil((n.duration + tail) * sampleRate))
    const sustainEnd = n.duration
    for (let i = 0; i < len; i++) {
      const t = i / sampleRate
      // 起音 5ms 线性，随后按是否在键上选择缓/急衰减
      const attack = Math.min(1, t / 0.005)
      const decay = t <= sustainEnd ? Math.exp(-1.2 * t) : Math.exp(-1.2 * sustainEnd - 12 * (t - sustainEnd))
      const w = 2 * Math.PI * freq * t
      const s = (Math.sin(w) + 0.3 * Math.sin(2 * w) + 0.12 * Math.sin(3 * w)) * vel * attack * decay
      out[start + i] = out[start + i]! + s
    }
  }
  // 软限幅：超过 ±1 用 tanh 压缩，避免多音混音削波
  for (let i = 0; i < total; i++) {
    const s = out[i]!
    out[i] = Math.abs(s) > 1 ? Math.tanh(s) : s
  }
  return out
}
