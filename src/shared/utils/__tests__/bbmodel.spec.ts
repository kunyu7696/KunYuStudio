import { describe, expect, it } from 'vitest'
import {
  assetToBbmodel,
  bbmodelToAsset,
  bbmodelToGeckolibAnimations,
  buildTemplateAnimations,
  geckoAnimationFile,
  parseGeoModelInfo,
  type BbmodelDoc
} from '../bbmodel'
import type { ModelAsset } from '../../types/content'

function cubeDoc(over: Partial<BbmodelDoc> = {}): BbmodelDoc {
  return {
    meta: { format_version: '4.5', model_format: 'free' },
    resolution: { width: 16, height: 16 },
    textures: [{ name: 'tex.png', origin: 'data:image/png;base64,iVBOR=', id: 't0' }],
    elements: [
      {
        name: '刃',
        from: [0, 0, 0],
        to: [16, 16, 16],
        origin: [8, 8, 8],
        faces: {
          north: { uv: [0, 0, 16, 16], texture: 0 },
          south: { uv: [0, 0, 16, 16], texture: 0 },
          east: { uv: [0, 0, 16, 16], texture: 0 },
          west: { uv: [0, 0, 16, 16], texture: 0 },
          up: { uv: [0, 0, 16, 16], texture: 0 },
          down: { uv: [0, 0, 16, 16], texture: 0 }
        }
      }
    ],
    ...over
  }
}

describe('bbmodel 导入', () => {
  it('基础立方体六面映射到 #all', () => {
    const { model, embeddedTextures } = bbmodelToAsset(cubeDoc(), 'ruby_block')
    expect(model.id).toBe('ruby_block')
    expect(model.template).toBe('custom')
    expect(model.textureSize).toBe(16)
    expect(model.textures['all']).toBe('textures/model/ruby_block.png')
    expect(model.elements).toHaveLength(1)
    const faces = model.elements[0].faces
    expect(faces.north?.texture).toBe('all')
    expect(faces.up?.uv).toEqual([0, 0, 16, 16])
    expect(embeddedTextures[0]).toContain('data:image/png')
  })

  it('32 分辨率识别为 32 画布', () => {
    const { model } = bbmodelToAsset(cubeDoc({ resolution: { width: 32, height: 32 } }), 'x')
    expect(model.textureSize).toBe(32)
    expect(model.pixels).toHaveLength(1024)
  })

  it('单轴旋转正确映射，角度吸附 22.5', () => {
    const doc = cubeDoc()
    doc.elements![0].rotation = [-22.51, 0, 0]
    const { model, warnings } = bbmodelToAsset(doc, 'x')
    expect(model.elements[0].rotation).toMatchObject({ axis: 'x', angle: -22.5 })
    expect(warnings.some((w) => w.includes('多轴'))).toBe(false)
  })

  it('多轴旋转保留最大轴并告警', () => {
    const doc = cubeDoc()
    doc.elements![0].rotation = [10, 45, 0]
    const { model, warnings } = bbmodelToAsset(doc, 'x')
    expect(model.elements[0].rotation?.axis).toBe('y')
    expect(model.elements[0].rotation?.angle).toBe(45)
    expect(warnings.join('\n')).toContain('多轴')
  })

  it('角度被夹到 ±45', () => {
    const doc = cubeDoc()
    doc.elements![0].rotation = [0, 90, 0]
    const { model } = bbmodelToAsset(doc, 'x')
    expect(model.elements[0].rotation?.angle).toBe(45)
  })

  it('缺 UV 的面回退整图映射并告警', () => {
    const doc = cubeDoc()
     
    ;(doc.elements![0].faces!.north as any).uv = undefined
    const { model, warnings } = bbmodelToAsset(doc, 'x')
    expect(model.elements[0].faces.north?.uv).toEqual([0, 0, 16, 16])
    expect(warnings.some((w) => w.includes('UV'))).toBe(true)
  })

  it('第二张贴图映射为 layer1 变量', () => {
    const doc = cubeDoc({
      textures: [
        { name: 'a.png', origin: 'data:image/png;base64,AA', id: 'a' },
        { name: 'b.png', origin: 'data:image/png;base64,BB', id: 'b' }
      ]
    })
    doc.elements![0].faces!.north!.texture = 1
    const { model } = bbmodelToAsset(doc, 'x')
    expect(model.elements[0].faces.north?.texture).toBe('layer1')
    expect(model.textures['layer1']).toBeTruthy()
  })

  it('空文档与缺 from/to 抛错', () => {
    expect(() => bbmodelToAsset({}, 'x')).toThrow(/没有任何元素/)
    const bad = cubeDoc()
    bad.elements![0].from = [0, 0] as unknown as [number, number, number]
    expect(() => bbmodelToAsset(bad, 'x')).toThrow(/from\/to/)
  })
})

describe('bbmodel 导出与往返', () => {
  function sampleAsset(): ModelAsset {
    const { model } = bbmodelToAsset(cubeDoc(), 'round_trip')
    const now = Date.now()
    return {
      kind: 'model',
      id: model.id,
      displayName: model.displayName,
      description: '',
      textureSize: model.textureSize,
      pixels: model.pixels,
      textures: model.textures,
      elements: model.elements,
      createdAt: now,
      updatedAt: now
    }
  }

  it('导出文档含 4.5 meta、resolution 与内嵌贴图', () => {
    const doc = assetToBbmodel(sampleAsset(), 'data:image/png;base64,ZZ')
    expect(doc.meta?.format_version).toBe('4.5')
    expect(doc.resolution).toEqual({ width: 16, height: 16 })
    expect(doc.elements).toHaveLength(1)
    expect(doc.textures?.[0].origin).toBe('data:image/png;base64,ZZ')
    expect(doc.elements?.[0].faces?.north?.texture).toBe(0)
  })

  it('往返几何一致（from/to/uv）', () => {
    const doc = assetToBbmodel(sampleAsset())
    const back = bbmodelToAsset(doc, 'round_trip')
    const a = back.model.elements[0]
    expect(a.from).toEqual([0, 0, 0])
    expect(a.to).toEqual([16, 16, 16])
    expect(a.faces.south?.uv).toEqual([0, 0, 16, 16])
  })

  it('旋转往返：z 轴 -45', () => {
    const asset = sampleAsset()
    asset.elements[0].rotation = { origin: [4, 5, 6], axis: 'z', angle: -45, rescale: true }
    const doc = assetToBbmodel(asset)
    expect(doc.elements?.[0].rotation).toEqual([0, 0, -45])
    const back = bbmodelToAsset(doc, 'x')
    expect(back.model.elements[0].rotation).toMatchObject({ axis: 'z', angle: -45, rescale: true })
    expect(back.model.elements[0].rotation?.origin).toEqual([4, 5, 6])
  })
})

/* ------------------------------------------------------------------ */
/* GeckoLib 骨骼动画（P2）                                               */
/* ------------------------------------------------------------------ */

/** 合法的人形 geo.json（骨骼名对齐内置模板） */
const HUMANOID_GEO = JSON.stringify({
  format_version: '1.12.0',
  'minecraft:geometry': [
    {
      description: { identifier: 'geometry.goblin', texture_width: 64, texture_height: 64 },
      bones: [
        { name: 'body', pivot: [0, 12, 0], cubes: [] },
        { name: 'head', parent: 'body', pivot: [0, 24, 0], cubes: [] },
        { name: 'arm_left', parent: 'body', pivot: [5, 22, 0], cubes: [] },
        { name: 'arm_right', parent: 'body', pivot: [-5, 22, 0], cubes: [] },
        { name: 'leg_left', pivot: [2, 12, 0], cubes: [] },
        { name: 'leg_right', pivot: [-2, 12, 0], cubes: [] }
      ]
    }
  ]
})

describe('parseGeoModelInfo', () => {
  it('解析骨骼名与贴图尺寸', () => {
    const info = parseGeoModelInfo(HUMANOID_GEO)
    expect(info.textureWidth).toBe(64)
    expect(info.boneNames).toEqual(
      expect.arrayContaining(['body', 'head', 'arm_left', 'arm_right', 'leg_left', 'leg_right'])
    )
  })

  it('非 geo JSON / 缺 minecraft:geometry 抛中文错误', () => {
    expect(() => parseGeoModelInfo('not json')).toThrow('geoJson 不是合法 JSON')
    expect(() => parseGeoModelInfo('{}')).toThrow('minecraft:geometry')
  })
})

describe('buildTemplateAnimations', () => {
  it('人形骨骼：idle/walk/attack 三件套，walk 四肢对摆、attack 右臂挥击', () => {
    const anims = buildTemplateAnimations(
      ['body', 'head', 'arm_left', 'arm_right', 'leg_left', 'leg_right'],
      'goblin'
    )
    const idle = anims['animation.goblin.idle']
    const walk = anims['animation.goblin.walk']
    const attack = anims['animation.goblin.attack']
    expect(idle.loop).toBe(true)
    expect(idle.animation_length).toBe(2)
    expect(idle.bones?.head?.lerp_mode).toBe('catmullrom')
    // walk：双腿反相（1/4 周期处异号；0 与半周期处正弦均为 0）
    expect(walk.loop).toBe(true)
    const llMid = walk.bones?.leg_left?.rotation?.['0.25']
    const lrMid = walk.bones?.leg_right?.rotation?.['0.25']
    expect(llMid?.[0]).toBeCloseTo(25, 5)
    expect(lrMid?.[0]).toBeCloseTo(-25, 5)
    // attack：单次播放，右臂 -90° 挥击
    expect(attack.loop).toBeUndefined()
    expect(attack.animation_length).toBe(0.5)
    expect(attack.bones?.arm_right?.rotation?.['0.2']).toEqual([-90, 0, 0])
  })

  it('speed/amplitude 参数化：speed=2 周期减半，amplitude=2 摆幅翻倍', () => {
    const anims = buildTemplateAnimations(
      ['head', 'arm_left', 'arm_right', 'leg_left', 'leg_right'],
      'goblin',
      { amplitude: 2, speed: 2 }
    )
    expect(anims['animation.goblin.idle'].animation_length).toBe(1)
    const keys = anims['animation.goblin.walk'].bones?.leg_left?.rotation ?? {}
    const peak = Math.max(...Object.values(keys).map((v) => Math.abs(v[0])))
    expect(peak).toBeCloseTo(50, 5)
  })

  it('四足骨骼：对角步态 + 头部撕咬', () => {
    const anims = buildTemplateAnimations(
      ['body', 'head', 'leg_front_left', 'leg_front_right', 'leg_hind_left', 'leg_hind_right'],
      'boar'
    )
    const walk = anims['animation.boar.walk']
    expect(Object.keys(walk.bones ?? {})).toHaveLength(4)
    // 对角：front_left 与 hind_right 同相（1/4 周期处同为 +25）
    expect(walk.bones?.leg_front_left?.rotation?.['0.25']?.[0]).toBeCloseTo(
      walk.bones?.leg_hind_right?.rotation?.['0.25']?.[0] ?? NaN,
      5
    )
    expect(anims['animation.boar.attack'].bones?.head).toBeDefined()
  })

  it('兜底骨骼：仅 idle，不生成 walk/attack', () => {
    const anims = buildTemplateAnimations(['root', 'shell'], 'blob')
    expect(anims['animation.blob.idle']).toBeDefined()
    expect(anims['animation.blob.walk']).toBeUndefined()
    expect(anims['animation.blob.attack']).toBeUndefined()
  })

  it('geckoAnimationFile 组装 format_version 1.8.0', () => {
    const file = geckoAnimationFile(buildTemplateAnimations(['head'], 'x'))
    expect(file.format_version).toBe('1.8.0')
    expect(Object.keys(file.animations)).toEqual(['animation.x.idle'])
  })
})

describe('bbmodelToGeckolibAnimations', () => {
  it('骨骼 uuid→名称映射、loop 映射、关键帧落位', () => {
    const doc = {
      animations: [
        {
          name: 'walk',
          loop: 'loop' as const,
          length: 1,
          animators: {
            'uuid-leg': {
              keyframes: [
                { channel: 'rotation', time: 0, interpolation: 'linear', data_points: [{ x: 25, y: 0, z: 0 }] },
                { channel: 'rotation', time: 0.5, interpolation: 'catmullrom', data_points: [{ x: -25, y: 0, z: 0 }] }
              ]
            }
          }
        }
      ],
      outliner: [{ uuid: 'uuid-leg', name: 'leg_left', children: [] }]
    }
    const { animations, warnings } = bbmodelToGeckolibAnimations(doc, 'goblin')
    expect(warnings).toEqual([])
    const walk = animations['animation.goblin.walk']
    expect(walk.loop).toBe(true)
    expect(walk.animation_length).toBe(1)
    expect(walk.bones?.leg_left?.rotation?.['0']).toEqual([25, 0, 0])
    expect(walk.bones?.leg_left?.rotation?.['0.5']).toEqual([-25, 0, 0])
    expect(walk.bones?.leg_left?.lerp_mode).toBe('catmullrom')
  })

  it('已带前缀的动画名不重复补全；molang 关键帧跳过并告警', () => {
    const doc = {
      animations: [
        {
          name: 'animation.goblin.idle',
          loop: 'once' as const,
          animators: {
            'uuid-head': {
              name: 'head',
              keyframes: [
                { channel: 'rotation', time: 0, data_points: [{ x: 'math.sin(1)', y: 0, z: 0 }] },
                { channel: 'position', time: 1, interpolation: 'step', data_points: [{ x: 0, y: 2, z: 0 }] }
              ]
            }
          }
        }
      ]
    }
    const { animations, warnings } = bbmodelToGeckolibAnimations(doc, 'goblin')
    const idle = animations['animation.goblin.idle']
    expect(idle).toBeDefined()
    expect(idle.loop).toBeUndefined()
    // molang rotation 被跳过，position step 降级保留
    expect(idle.bones?.head?.rotation).toBeUndefined()
    expect(idle.bones?.head?.position?.['1']).toEqual([0, 2, 0])
    expect(warnings.some((w) => w.includes('molang'))).toBe(true)
    expect(warnings.some((w) => w.includes('step'))).toBe(true)
  })

  it('空 animations 返回空表', () => {
    expect(bbmodelToGeckolibAnimations({}, 'x').animations).toEqual({})
  })
})
