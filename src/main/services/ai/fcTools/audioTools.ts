/**
 * 音效工坊 FC 工具（audioService 的 AI 封装）。
 *
 * - audio_list_library：只读列出 sounds 目录 .ogg 文件与 sounds.json 事件引用关系；
 * - audio_register_event / audio_unregister_event：写 assets/<ns>/sounds.json（原版资源包格式）。
 * WAV 合成与 FFmpeg 转码在渲染层链路完成，不在工具层暴露。
 * 目标解析（模组项目 modId / 独立资源包 namespace）由 audioService.resolveAudioTarget 负责，
 * 无法识别项目结构时软失败并返回中文说明。
 */
import type { SoundEventEntry } from '../../../../shared/types/audio'
import type { RegisteredTool, ToolRegistryDeps } from '../toolRegistry'
import { listAudioLibrary, registerSoundEvent, unregisterSoundEvent } from '../../audioService'

const CLIP = 8000
function clip(text: string): string {
  return text.length <= CLIP ? text : `${text.slice(0, CLIP)}…（已截断）`
}
function asString(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

export function builtinAudioTools(deps: ToolRegistryDeps): RegisteredTool[] {
  const tools: RegisteredTool[] = []

  /* audio_list_library */
  tools.push({
    kind: 'chat',
    def: {
      type: 'function',
      function: {
        name: 'audio_list_library',
        description:
          '列出当前项目声音库：sounds 目录下全部 .ogg（大小/被哪些事件引用）与 sounds.json 中的音效事件。' +
          '注册或注销事件前先调用，确认文件与命名空间。',
        parameters: { type: 'object', properties: {}, required: [] }
      }
    },
    visibility: 'project',
    execute: () => {
      const root = deps.projectRoot?.()
      if (!root) return { ok: false, text: '', error: '当前没有打开的项目' }
      try {
        const lib = listAudioLibrary(root)
        const fileLines = lib.files.map(
          (f) =>
            `- ${f.stem}.ogg（${Math.round(f.sizeBytes / 1024)} KB` +
            `${f.events.length ? `，被 ${f.events.join('、')} 引用` : '，未被引用'}）`
        )
        const eventLines = lib.events.map((e) => `- ${e.name} → ${e.sounds.join('、')}`)
        const text =
          `命名空间 ${lib.namespace}：音效文件 ${lib.files.length} 个，事件 ${lib.events.length} 个` +
          (fileLines.length ? `\n文件：\n${fileLines.join('\n')}` : '') +
          (eventLines.length ? `\n事件：\n${eventLines.join('\n')}` : '')
        return { ok: true, text: clip(text), data: lib }
      } catch (err) {
        return { ok: false, text: '', error: (err as Error).message }
      }
    }
  })

  /* audio_register_event */
  tools.push({
    kind: 'chat',
    def: {
      type: 'function',
      function: {
        name: 'audio_register_event',
        description:
          '注册/更新 sounds.json 中的一个音效事件：sounds 引用写 stem 自动补项目命名空间，' +
          '同名事件覆盖。事件名仅允许小写字母、数字、_ . - /。',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: '事件名，如 mymod.ambient_chime' },
            sounds: {
              type: 'array',
              items: { type: 'string' },
              description: '音效引用列表（stem 或 <ns>:<stem>）'
            },
            subtitle: { type: 'string', description: '字幕翻译键（可选）' }
          },
          required: ['name', 'sounds']
        }
      }
    },
    visibility: 'project',
    execute: (args) => {
      const root = deps.projectRoot?.()
      if (!root) return { ok: false, text: '', error: '当前没有打开的项目' }
      const name = asString(args['name']).trim()
      const rawSounds = args['sounds']
      const sounds = Array.isArray(rawSounds)
        ? rawSounds.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
        : []
      const subtitle = asString(args['subtitle']).trim()
      if (!name) return { ok: false, text: '', error: '缺少 name 参数（事件名）' }
      if (sounds.length === 0) {
        return { ok: false, text: '', error: 'sounds 至少引用一个音效（stem 或 <ns>:<stem>）' }
      }
      try {
        const entry: SoundEventEntry = { name, sounds, ...(subtitle ? { subtitle } : {}) }
        registerSoundEvent(root, entry)
        return { ok: true, text: `已注册音效事件 ${name}（${sounds.length} 个音效）`, data: entry }
      } catch (err) {
        return { ok: false, text: '', error: (err as Error).message }
      }
    }
  })

  /* audio_unregister_event */
  tools.push({
    kind: 'chat',
    def: {
      type: 'function',
      function: {
        name: 'audio_unregister_event',
        description: '从 sounds.json 注销一个音效事件（不存在时静默成功；.ogg 文件保留）。',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: '事件名' }
          },
          required: ['name']
        }
      }
    },
    visibility: 'project',
    execute: (args) => {
      const root = deps.projectRoot?.()
      if (!root) return { ok: false, text: '', error: '当前没有打开的项目' }
      const name = asString(args['name']).trim()
      if (!name) return { ok: false, text: '', error: '缺少 name 参数（事件名）' }
      try {
        unregisterSoundEvent(root, name)
        return { ok: true, text: `已注销音效事件 ${name}`, data: { name } }
      } catch (err) {
        return { ok: false, text: '', error: (err as Error).message }
      }
    }
  })

  return tools
}
