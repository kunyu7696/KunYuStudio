import { ipcMain } from 'electron'
import { IpcChannels } from '../../../shared/types/ipc'
import type { AudioConvertInput, AudioEvent, SoundEventEntry } from '../../../shared/types/audio'
import {
  convertToOgg,
  ensureFfmpeg,
  ffmpegStatus,
  listAudioLibrary,
  readSoundDataUrl,
  readSourceBytes,
  registerSoundEvent,
  removeSound,
  unregisterSoundEvent
} from '../../services/audioService'
import type { IpcContext } from '../context'

let jobSeq = 0

/** 音效工坊：FFmpeg 按需下载 + 转码进度推送 + sounds.json 事件注册 */
export function registerAudioHandlers(ctx: IpcContext): void {
  ipcMain.handle(IpcChannels.AUDIO_FFMPEG_STATUS, () => ffmpegStatus())

  ipcMain.handle(IpcChannels.AUDIO_ENSURE_FFMPEG, () => {
    const jobId = `au-${Date.now()}-${++jobSeq}`
    return ensureFfmpeg((loadedBytes, totalBytes) => {
      if (!ctx.win.isDestroyed()) {
        const payload: AudioEvent = {
          jobId,
          phase: 'tool-download',
          loadedBytes,
          totalBytes
        }
        ctx.win.webContents.send(IpcChannels.AUDIO_EVENT, payload)
      }
    })
  })

  ipcMain.handle(IpcChannels.AUDIO_CONVERT, async (_event, input: AudioConvertInput) => {
    const jobId = `au-${Date.now()}-${++jobSeq}`
    const send = (payload: AudioEvent): void => {
      if (!ctx.win.isDestroyed()) ctx.win.webContents.send(IpcChannels.AUDIO_EVENT, payload)
    }
    try {
      const result = await convertToOgg(input, (phase, message) => {
        send({ jobId, phase, message, file: input.stem })
      })
      send({ jobId, phase: 'done', file: input.stem })
      return result
    } catch (err) {
      send({ jobId, phase: 'error', file: input.stem, error: (err as Error).message })
      throw err
    }
  })

  ipcMain.handle(IpcChannels.AUDIO_LIST, (_event, root: string) => listAudioLibrary(root))
  ipcMain.handle(IpcChannels.AUDIO_REGISTER_EVENT, (_event, root: string, entry: SoundEventEntry) =>
    registerSoundEvent(root, entry)
  )
  ipcMain.handle(IpcChannels.AUDIO_UNREGISTER_EVENT, (_event, root: string, name: string) =>
    unregisterSoundEvent(root, name)
  )
  ipcMain.handle(IpcChannels.AUDIO_REMOVE_SOUND, (_event, root: string, stem: string) =>
    removeSound(root, stem)
  )
  ipcMain.handle(IpcChannels.AUDIO_READ_SOUND, (_event, root: string, stem: string) =>
    readSoundDataUrl(root, stem)
  )
  ipcMain.handle(IpcChannels.AUDIO_READ_SOURCE, (_event, path: string) => readSourceBytes(path))
}
