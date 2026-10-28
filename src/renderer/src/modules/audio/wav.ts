/**
 * WAV 编码（纯 TS，可单测）：Float32 单声道 → 16bit PCM RIFF/WAVE 字节。
 * 渲染层合成结果经此编码后交主进程 FFmpeg 转码。
 */

/** Float32 [-1,1] → 16bit PCM WAV（44.1kHz 单声道） */
export function encodeWavPcm16(samples: Float32Array, sampleRate = 44100): Uint8Array {
  const dataLen = samples.length * 2
  const buf = new ArrayBuffer(44 + dataLen)
  const v = new DataView(buf)
  const writeStr = (off: number, s: string): void => {
    for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i))
  }
  writeStr(0, 'RIFF')
  v.setUint32(4, 36 + dataLen, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  v.setUint32(16, 16, true) // fmt 块大小
  v.setUint16(20, 1, true) // PCM
  v.setUint16(22, 1, true) // 单声道
  v.setUint32(24, sampleRate, true)
  v.setUint32(28, sampleRate * 2, true) // 字节率
  v.setUint16(32, 2, true) // 块对齐
  v.setUint16(34, 16, true) // 位深
  writeStr(36, 'data')
  v.setUint32(40, dataLen, true)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!))
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return new Uint8Array(buf)
}
