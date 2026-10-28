/** WAV 编码测试：RIFF 头字段与 PCM 量化 */
import { describe, expect, it } from 'vitest'
import { encodeWavPcm16 } from '../wav'

describe('encodeWavPcm16', () => {
  it('RIFF/WAVE 头与 fmt 字段正确', () => {
    const wav = encodeWavPcm16(new Float32Array([0, 0.5, -0.5, 1, -1]))
    const v = new DataView(wav.buffer, wav.byteOffset, wav.byteLength)
    const str = (off: number, len: number): string =>
      String.fromCharCode(...Array.from(wav.slice(off, off + len)))
    expect(str(0, 4)).toBe('RIFF')
    expect(str(8, 4)).toBe('WAVE')
    expect(v.getUint32(4, true)).toBe(36 + 10) // 总长 = 36 + 数据
    expect(v.getUint16(20, true)).toBe(1) // PCM
    expect(v.getUint16(22, true)).toBe(1) // 单声道
    expect(v.getUint32(24, true)).toBe(44100)
    expect(v.getUint16(34, true)).toBe(16)
    expect(str(36, 4)).toBe('data')
    expect(v.getUint32(40, true)).toBe(10)
  })

  it('PCM 量化：1→32767，-1→-32768，超界裁剪', () => {
    const wav = encodeWavPcm16(new Float32Array([1, -1, 2, -2]))
    const v = new DataView(wav.buffer, wav.byteOffset, wav.byteLength)
    expect(v.getInt16(44, true)).toBe(32767)
    expect(v.getInt16(46, true)).toBe(-32768)
    expect(v.getInt16(48, true)).toBe(32767)
    expect(v.getInt16(50, true)).toBe(-32768)
  })
})
