import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { emptyLayout, readFancyMenu, writeFancyMenu } from '../fancyMenuService'
import type { FancyMenuReadResult } from '../../../shared/types/fancymenu'
import type { FmButton, FmElement, FmImage, FmRect, FmText } from '../../../shared/types/fancymenu'

const TMP_DIRS: string[] = []

function tmpRoot(): string {
  const d = mkdtempSync(join(process.cwd(), '.fm-test-'))
  TMP_DIRS.push(d)
  return d
}

afterEach(() => {
  for (const d of TMP_DIRS) if (existsSync(d)) rmSync(d, { recursive: true, force: true })
  TMP_DIRS.length = 0
})

/** 读取并断言成功（失败时直接抛错，收窄联合类型） */
function readOk(root: string, loader?: string): FancyMenuReadResult {
  const res = readFancyMenu(root, loader)
  if ('error' in res) throw new Error(`读取失败: ${res.error}`)
  return res
}

/** 写入并断言成功（收窄 ok 联合类型） */
function writeOk(
  root: string,
  elements: FmElement[],
  loader?: string
): { ok: true; filePath: string } {
  const res = writeFancyMenu(root, elements, loader)
  if (!res.ok) throw new Error(`写入失败: ${res.error}`)
  return res
}

const BUTTON: FmButton = {
  id: 'btn_play',
  type: 'button',
  name: 'Play',
  anchor: 'center',
  x: 0,
  y: 50,
  width: 160,
  height: 24,
  z: 0,
  text: '开始游戏',
  color: '#FFFFFF',
  action: { type: 'command', value: 'gamemode creative' }
}

const TEXT: FmText = {
  id: 'txt_title',
  type: 'text',
  name: 'Title',
  anchor: 'top_center',
  x: 0,
  y: 30,
  width: 400,
  height: 40,
  z: 1,
  text: 'KunYu Studio',
  size: 28
}

const IMAGE: FmImage = {
  id: 'bg_panorama',
  type: 'image',
  name: 'Background',
  anchor: 'top_left',
  x: 0,
  y: 0,
  width: 1280,
  height: 720,
  z: -10,
  url: 'minecraft:textures/gui/title/background/panorama_0.png'
}

const RECT: FmRect = {
  id: 'separator',
  type: 'rect',
  name: 'Separator',
  anchor: 'center',
  x: 0,
  y: 100,
  width: 200,
  height: 2,
  z: 5,
  color: '#4a9eff'
}

describe('fancyMenuService', () => {
  describe('readFancyMenu', () => {
    it('Fabric 路径存在时读 layout.json', () => {
      const root = tmpRoot()
      const fabricPath = join(root, 'config', 'fancymenu', 'layout.json')
      mkdirSync(join(root, 'config', 'fancymenu'), { recursive: true })
      writeFileSync(
        fabricPath,
        JSON.stringify({
          elements: [BUTTON, TEXT, { type: 'unknown_element', id: 'unknown_1' }], // 未知类型
          meta: { version: '2.0.0' }
        })
      )

      const res = readOk(root, 'fabric')
      expect(res.filePath).toBe(fabricPath)
      // 未知类型被过滤掉
      expect(res.elements).toHaveLength(2)
      expect(res.elements[0].type).toBe('button')
      expect(res.elements[1].type).toBe('text')
      // raw 保留未知字段
      expect((res.raw as Record<string, unknown>).meta).toEqual({ version: '2.0.0' })
    })

    it('Forge 专用路径优先于 Fabric', () => {
      const root = tmpRoot()
      const forgePath = join(root, 'config', 'fancymenu_forge', 'layout.json')
      const fabricPath = join(root, 'config', 'fancymenu', 'layout.json')
      mkdirSync(join(root, 'config', 'fancymenu_forge'), { recursive: true })
      mkdirSync(join(root, 'config', 'fancymenu'), { recursive: true })
      writeFileSync(forgePath, JSON.stringify({ elements: [BUTTON] }))
      writeFileSync(fabricPath, JSON.stringify({ elements: [TEXT] }))

      const res = readOk(root, 'forge')
      expect(res.filePath).toBe(forgePath)
      expect(res.elements).toHaveLength(1)
      expect(res.elements[0].id).toBe('btn_play')
    })

    it('两边都没有时返回空数组 + 推测路径（不写磁盘）', () => {
      const root = tmpRoot()
      const res = readOk(root)
      expect(res.elements).toEqual([])
      // 默认按 Fabric 路径
      expect(res.filePath).toBe(join(root, 'config', 'fancymenu', 'layout.json'))
      expect(existsSync(res.filePath!)).toBe(false)
    })

    it('JSON 解析失败返回 error 结果', () => {
      const root = tmpRoot()
      const fabricPath = join(root, 'config', 'fancymenu', 'layout.json')
      mkdirSync(join(root, 'config', 'fancymenu'), { recursive: true })
      writeFileSync(fabricPath, '{not valid json')

      const res = readFancyMenu(root)
      expect('error' in res).toBe(true)
    })

    it('action.type === "url" 被正确识别', () => {
      const root = tmpRoot()
      const fabricPath = join(root, 'config', 'fancymenu', 'layout.json')
      mkdirSync(join(root, 'config', 'fancymenu'), { recursive: true })
      writeFileSync(
        fabricPath,
        JSON.stringify({
          elements: [
            {
              ...BUTTON,
              action: { type: 'open_url', value: 'https://example.com' } // FancyMenu 旧版写法
            }
          ]
        })
      )
      const res = readOk(root)
      const el = res.elements[0]
      expect(el.type).toBe('button')
      if (el.type === 'button') {
        expect(el.action?.type).toBe('command') // 未知 action type 回退到 command
      }
    })
  })

  describe('writeFancyMenu', () => {
    it('写入 Fabric 路径（默认 loader）', () => {
      const root = tmpRoot()
      const result = writeOk(root, [BUTTON, TEXT, IMAGE, RECT])
      const expectedPath = join(root, 'config', 'fancymenu', 'layout.json')
      expect(result.filePath).toBe(expectedPath)
      expect(existsSync(expectedPath)).toBe(true)

      const res = readOk(root)
      expect(res.elements).toHaveLength(4)
      expect(res.elements[0].id).toBe('btn_play')
    })

    it('Forge loader → 写 config/fancymenu_forge/layout.json', () => {
      const root = tmpRoot()
      const result = writeOk(root, [BUTTON], 'forge')
      const expectedPath = join(root, 'config', 'fancymenu_forge', 'layout.json')
      expect(result.filePath).toBe(expectedPath)
      expect(existsSync(expectedPath)).toBe(true)
    })

    it('保存保留 raw 里的未知字段', () => {
      const root = tmpRoot()
      const fabricPath = join(root, 'config', 'fancymenu', 'layout.json')
      mkdirSync(join(root, 'config', 'fancymenu'), { recursive: true })
      writeFileSync(
        fabricPath,
        JSON.stringify({
          elements: [BUTTON],
          meta: { version: '2.0.0', customFlag: true }
        })
      )

      writeOk(root, [BUTTON, TEXT])

      const res = readOk(root)
      expect((res.raw as Record<string, unknown>).meta).toEqual({
        version: '2.0.0',
        customFlag: true
      })
      expect(res.elements).toHaveLength(2)
    })

    it('Fabric 路径不存在时自动创建目录', () => {
      const root = tmpRoot()
      // 整个 config 都不存在
      const result = writeOk(root, [TEXT])
      expect(existsSync(result.filePath)).toBe(true)
    })
  })

  describe('P2 元素：slides / particles', () => {
    it('slides 元素解析：图片列表 + duration + fitType', () => {
      const root = tmpRoot()
      const fabricPath = join(root, 'config', 'fancymenu', 'layout.json')
      mkdirSync(join(root, 'config', 'fancymenu'), { recursive: true })
      writeFileSync(
        fabricPath,
        JSON.stringify({
          elements: [
            {
              id: 'bg_slides',
              type: 'slides',
              name: 'Slideshow',
              anchor: 'top_left',
              x: 0,
              y: 0,
              width: 1280,
              height: 720,
              z: -20,
              slides: [
                { type: 'image', path: 'minecraft:textures/gui/title/background/panorama_0.png' },
                { type: 'local', path: 'slides/custom.png' }
              ],
              duration: 6000,
              fadeTime: 500,
              fitType: 'crop'
            }
          ]
        })
      )

      const res = readOk(root)
      expect(res.elements).toHaveLength(1)
      const el = res.elements[0]
      expect(el.type).toBe('slides')
      if (el.type !== 'slides') return
      expect(el.slides).toHaveLength(2)
      expect(el.slides[0]).toEqual({
        type: 'image',
        path: 'minecraft:textures/gui/title/background/panorama_0.png'
      })
      expect(el.slides[1].type).toBe('local')
      expect(el.duration).toBe(6000)
      expect(el.fadeTime).toBe(500)
      expect(el.fitType).toBe('crop')
    })

    it('slides 缺字段时用默认值补齐（duration=5000, fadeTime=1000, fitType=stretch）', () => {
      const root = tmpRoot()
      const fabricPath = join(root, 'config', 'fancymenu', 'layout.json')
      mkdirSync(join(root, 'config', 'fancymenu'), { recursive: true })
      writeFileSync(
        fabricPath,
        JSON.stringify({
          elements: [
            { id: 'bg', type: 'slides', anchor: 'top_left', x: 0, y: 0, width: 1, height: 1 }
          ]
        })
      )
      const res = readOk(root)
      const el = res.elements[0]
      if (el.type !== 'slides') throw new Error('not slides')
      expect(el.slides).toEqual([])
      expect(el.duration).toBe(5000)
      expect(el.fadeTime).toBe(1000)
      expect(el.fitType).toBe('stretch')
    })

    it('particles 元素解析 + 默认值补齐', () => {
      const root = tmpRoot()
      const fabricPath = join(root, 'config', 'fancymenu', 'layout.json')
      mkdirSync(join(root, 'config', 'fancymenu'), { recursive: true })
      writeFileSync(
        fabricPath,
        JSON.stringify({
          elements: [
            {
              id: 'fx',
              type: 'particles',
              anchor: 'center',
              x: 100,
              y: 100,
              width: 400,
              height: 300,
              particleId: 'minecraft:end_rod',
              amount: 35,
              originX: 0.3,
              originY: 0.7
            }
          ]
        })
      )
      const res = readOk(root)
      const el = res.elements[0]
      if (el.type !== 'particles') throw new Error('not particles')
      expect(el.particleId).toBe('minecraft:end_rod')
      expect(el.amount).toBe(35)
      expect(el.originX).toBe(0.3)
      expect(el.originY).toBe(0.7)
      // 未给出的字段用默认值
      expect(el.spreadX).toBe(1)
      expect(el.speedX).toBe(0.1)
      expect(el.size).toBeUndefined()
    })

    it('slides + particles 序列化往返一致', () => {
      const root = tmpRoot()
      const elements: FmElement[] = [
        {
          id: 'bg',
          type: 'slides' as const,
          name: 'bg',
          anchor: 'top_left' as const,
          x: 0,
          y: 0,
          width: 1280,
          height: 720,
          z: -10,
          slides: [{ type: 'image' as const, path: 'a.png' }],
          duration: 4000,
          fadeTime: 800,
          fitType: 'fill' as const
        },
        {
          id: 'fx',
          type: 'particles' as const,
          name: 'fx',
          anchor: 'center' as const,
          x: 0,
          y: 0,
          width: 200,
          height: 200,
          z: 3,
          particleId: 'minecraft:flame',
          amount: 12,
          originX: 0.5,
          originY: 0.5,
          spreadX: 0.5,
          spreadY: 0.5,
          speedX: 0.05,
          speedY: 0.05,
          size: 1.5
        }
      ]
      writeOk(root, elements)
      const res = readOk(root)
      expect(res.elements).toHaveLength(2)
      expect(res.elements[0]).toMatchObject({
        type: 'slides',
        duration: 4000,
        fadeTime: 800,
        fitType: 'fill',
        slides: [{ type: 'image', path: 'a.png' }]
      })
      expect(res.elements[1]).toMatchObject({
        type: 'particles',
        particleId: 'minecraft:flame',
        amount: 12,
        size: 1.5
      })
    })
  })

  describe('emptyLayout', () => {
    it('返回空 elements 数组', () => {
      expect(emptyLayout()).toEqual({ elements: [] })
    })
  })
})
