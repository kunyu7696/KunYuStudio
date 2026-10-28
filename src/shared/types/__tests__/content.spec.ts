import { describe, expect, it } from 'vitest'
import {
  CUBE_FACES,
  createDefaultCube,
  createDefaultModel,
  validateContentId
} from '../content'

describe('createDefaultModel / createDefaultCube（M12）', () => {
  it('默认模型：16² 空像素 + all 贴图路径 + 单个占满 16³ 的立方体', () => {
    const m = createDefaultModel('ruby_crate')
    expect(m.kind).toBe('model')
    expect(m.id).toBe('ruby_crate')
    expect(m.textureSize).toBe(16)
    expect(m.pixels).toHaveLength(256)
    expect(m.pixels.every((p) => p === '')).toBe(true)
    expect(m.textures.all).toBe('textures/model/ruby_crate.png')
    expect(m.elements).toHaveLength(1)
    expect(m.ambientOcclusion).toBe(true)
    expect(m.display?.gui?.rotation).toEqual([30, 225, 0])
  })

  it('默认立方体六面齐全、UV 覆盖整张贴图、绑定 all 变量', () => {
    const el = createDefaultCube('c1')
    expect(el.from).toEqual([0, 0, 0])
    expect(el.to).toEqual([16, 16, 16])
    for (const face of CUBE_FACES) {
      expect(el.faces[face]?.uv).toEqual([0, 0, 16, 16])
      expect(el.faces[face]?.texture).toBe('all')
    }
  })

  it('默认模型可通过 ID 校验', () => {
    expect(validateContentId(createDefaultModel('crate_x').id)).toBe(true)
  })
})
