import { beforeEach, describe, expect, it } from 'vitest'
import { nextTick, ref } from 'vue'
import { createDefaultModel } from '../../../../../shared/types/content'
import { usePixelCanvas } from '../usePixelCanvas'

describe('usePixelCanvas 像素画逻辑（M12）', () => {
  let strokes = 0
  beforeEach(() => {
    strokes = 0
  })

  function setup() {
    const model = ref(createDefaultModel('m'))
    const api = usePixelCanvas(model, { onStrokeEnd: () => strokes++ })
    return { model, api }
  }

  it('铅笔落笔写入当前颜色，整笔结束触发一次回调', () => {
    const { model, api } = setup()
    api.strokeStart(0, 0)
    api.strokeMove(1, 0)
    api.strokeMove(1, 0) // 同格重复不影响
    expect(model.value.pixels[0]).toBe('#c94f4f')
    expect(model.value.pixels[1]).toBe('#c94f4f')
    api.strokeEnd()
    expect(strokes).toBe(1)
    expect(api.canUndo.value).toBe(true)
  })

  it('未落笔时 move 不写入', () => {
    const { model, api } = setup()
    api.strokeMove(3, 3)
    expect(model.value.pixels[3 * 16 + 3]).toBe('')
  })

  it('橡皮写空串', () => {
    const { model, api } = setup()
    model.value.pixels[5] = '#ffffff'
    api.tool.value = 'eraser'
    api.strokeStart(5, 0)
    api.strokeEnd()
    expect(model.value.pixels[5]).toBe('')
  })

  it('吸管取到颜色后切回铅笔；空格无动作', () => {
    const { model, api } = setup()
    model.value.pixels[10] = '#00ff00'
    api.tool.value = 'picker'
    api.strokeStart(10, 0)
    expect(api.color.value).toBe('#00ff00')
    expect(api.tool.value).toBe('pencil')
    // 空格吸管不入笔画、不回调
    const before = strokes
    api.strokeStart(0, 1)
    expect(strokes).toBe(before)
  })

  it('撤销/重做往返', () => {
    const { model, api } = setup()
    api.strokeStart(0, 0)
    api.strokeEnd()
    expect(model.value.pixels[0]).toBe('#c94f4f')
    api.undo()
    expect(model.value.pixels[0]).toBe('')
    expect(api.canUndo.value).toBe(false)
    expect(api.canRedo.value).toBe(true)
    api.redo()
    expect(model.value.pixels[0]).toBe('#c94f4f')
  })

  it('清空压栈且可撤销；空白画布清空无效', () => {
    const { model, api } = setup()
    model.value.pixels[7] = '#123456'
    api.clear()
    expect(model.value.pixels.every((p) => p === '')).toBe(true)
    expect(strokes).toBe(1)
    api.undo()
    expect(model.value.pixels[7]).toBe('#123456')
  })

  it('空白画布清空不入栈、不回调', () => {
    const { api } = setup()
    api.clear()
    expect(api.canUndo.value).toBe(false)
    expect(strokes).toBe(0)
  })

  it('撤销栈上限 30：第 31 笔挤掉最早快照', () => {
    const { api } = setup()
    for (let i = 0; i < 31; i++) {
      api.strokeStart(i % 16, Math.floor(i / 16))
      api.strokeEnd()
    }
    // 连按 30 次撤销后停在第 1 笔之后（第 0 笔快照已丢）
    for (let i = 0; i < 30; i++) api.undo()
    expect(api.canUndo.value).toBe(false)
  })

  it('越界坐标忽略', () => {
    const { api } = setup()
    expect(() => {
      api.strokeStart(-1, 0)
      api.strokeStart(16, 0)
      api.strokeMove(0, 99)
      api.strokeEnd()
    }).not.toThrow()
    expect(strokes).toBe(0)
  })

  it('16⇄32 尺寸切换清空历史', async () => {
    const { model, api } = setup()
    api.strokeStart(0, 0)
    api.strokeEnd()
    expect(api.canUndo.value).toBe(true)
    model.value.textureSize = 32
    model.value.pixels = new Array(1024).fill('')
    await nextTick()
    expect(api.canUndo.value).toBe(false)
  })

  it('切换编辑对象（model 引用替换）清空历史', async () => {
    const model = ref(createDefaultModel('a'))
    const api = usePixelCanvas(model, { onStrokeEnd: () => strokes++ })
    api.strokeStart(0, 0)
    api.strokeEnd()
    expect(api.canUndo.value).toBe(true)
    model.value = createDefaultModel('b')
    await nextTick()
    expect(api.canUndo.value).toBe(false)
  })
})
