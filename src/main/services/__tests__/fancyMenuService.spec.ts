import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, sep } from 'node:path'
import { emptyLayout, readFancyMenu, writeFancyMenu } from '../fancyMenuService'
import type { FmButton, FmImage, FmRect, FmText } from '../../../shared/types/fancymenu'

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
          elements: [BUTTON, TEXT, { type: 'slides', id: 'bg_slides' }], // slides 是不支持类型
          meta: { version: '2.0.0' }
        })
      )

      const res = readFancyMenu(root, 'fabric')
      expect('elements' in res).toBe(true)
      expect(res.filePath).toBe(fabricPath)
      // 只解析 button / image / text / rect，slides 被过滤掉
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

      const res = readFancyMenu(root, 'forge')
      expect(res.filePath).toBe(forgePath)
      expect(res.elements).toHaveLength(1)
      expect(res.elements[0].id).toBe('btn_play')
    })

    it('两边都没有时返回空数组 + 推测路径（不写磁盘）', () => {
      const root = tmpRoot()
      const res = readFancyMenu(root)
      expect('elements' in res).toBe(true)
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
      const res = readFancyMenu(root)
      expect('elements' in res && res.elements[0]?.action?.type).toBe('command') // 未知 action type 回退到 command
    })
  })

  describe('writeFancyMenu', () => {
    it('写入 Fabric 路径（默认 loader）', () => {
      const root = tmpRoot()
      const result = writeFancyMenu(root, [BUTTON, TEXT, IMAGE, RECT])
      expect(result.ok).toBe(true)
      const expectedPath = join(root, 'config', 'fancymenu', 'layout.json')
      expect(result.filePath).toBe(expectedPath)
      expect(existsSync(expectedPath)).toBe(true)

      const res = readFancyMenu(root)
      expect(res.elements).toHaveLength(4)
      expect(res.elements[0].id).toBe('btn_play')
    })

    it('Forge loader → 写 config/fancymenu_forge/layout.json', () => {
      const root = tmpRoot()
      const result = writeFancyMenu(root, [BUTTON], 'forge')
      expect(result.ok).toBe(true)
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

      const saveRes = writeFancyMenu(root, [BUTTON, TEXT])
      expect(saveRes.ok).toBe(true)

      const res = readFancyMenu(root)
      expect((res.raw as Record<string, unknown>).meta).toEqual({
        version: '2.0.0',
        customFlag: true
      })
      expect(res.elements).toHaveLength(2)
    })

    it('Fabric 路径不存在时自动创建目录', () => {
      const root = tmpRoot()
      // 整个 config 都不存在
      const result = writeFancyMenu(root, [TEXT])
      expect(result.ok).toBe(true)
      expect(existsSync(result.filePath)).toBe(true)
    })
  })

  describe('emptyLayout', () => {
    it('返回空 elements 数组', () => {
      expect(emptyLayout()).toEqual({ elements: [] })
    })
  })
})
