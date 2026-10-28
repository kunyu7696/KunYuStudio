/**
 * 资源包模型只读预览适配层单测。
 * 重点：parseJavaModel 容错、resolveMainTextureRef 优先级与一跳 '#var' 间接引用、
 * textureRefToPackPath 的命名空间换算与非法引用拒绝。
 */
import { describe, expect, it } from 'vitest'
import {
  parseJavaModel,
  resolveMainTextureRef,
  textureRefToPackPath
} from '../resourcepack/modelPreview'

describe('parseJavaModel', () => {
  it('合法模型：parent / textures / elements 全部解析', () => {
    const text = JSON.stringify({
      parent: 'block/cube_all',
      textures: { all: 'mymod:block/ruby_ore' },
      elements: [{ from: [0, 0, 0], to: [16, 16, 16], faces: {} }],
      display: { gui: {} },
      ignored_field: 1
    })
    const model = parseJavaModel(text)
    expect(model).not.toBeNull()
    expect(model?.parent).toBe('block/cube_all')
    expect(model?.textures?.all).toBe('mymod:block/ruby_ore')
    expect(model?.elements).toHaveLength(1)
  })

  it('textures 中非字符串值被丢弃', () => {
    const model = parseJavaModel(
      JSON.stringify({ textures: { all: 'a:b', bad: 42, worse: null } })
    )
    expect(model?.textures).toEqual({ all: 'a:b' })
  })

  it('非法 JSON / 数组 / 标量返回 null', () => {
    expect(parseJavaModel('{oops')).toBeNull()
    expect(parseJavaModel('[]')).toBeNull()
    expect(parseJavaModel('42')).toBeNull()
    expect(parseJavaModel('"str"')).toBeNull()
  })

  it('空对象解析为空模型（不报错）', () => {
    const model = parseJavaModel('{}')
    expect(model).toEqual({})
  })
})

describe('resolveMainTextureRef', () => {
  it('优先级：all > layer0 > texture > particle > side', () => {
    expect(
      resolveMainTextureRef({
        side: 'a:side',
        particle: 'a:particle',
        texture: 'a:texture',
        layer0: 'a:layer0',
        all: 'a:all'
      })
    ).toBe('a:all')
    expect(resolveMainTextureRef({ particle: 'a:p', layer0: 'a:l' })).toBe('a:l')
    expect(resolveMainTextureRef({ side: 'a:s' })).toBe('a:s')
  })

  it('一跳 #var 间接引用可解析', () => {
    expect(resolveMainTextureRef({ all: '#base', base: 'mymod:block/ruby' })).toBe(
      'mymod:block/ruby'
    )
  })

  it('#var 断链时跳过该键，继续按优先级找', () => {
    expect(resolveMainTextureRef({ all: '#missing', side: 'a:side' })).toBe('a:side')
  })

  it('两跳间接引用不再追踪（按 MC 惯例只解一跳）', () => {
    // all → #b → #c：lookup 只解一跳得到 '#c'，以 # 开头视为不可解析，回退到首个可解析键
    expect(resolveMainTextureRef({ all: '#b', b: '#c', c: 'a:c' })).toBe('a:c')
  })

  it('无优先键时取首个可解析值', () => {
    expect(resolveMainTextureRef({ custom: 'a:custom' })).toBe('a:custom')
  })

  it('undefined / 全断链返回 null', () => {
    expect(resolveMainTextureRef(undefined)).toBeNull()
    expect(resolveMainTextureRef({})).toBeNull()
    expect(resolveMainTextureRef({ all: '#gone' })).toBeNull()
  })
})

describe('textureRefToPackPath', () => {
  it('带命名空间引用换算为包内路径', () => {
    expect(textureRefToPackPath('mymod:block/ruby_ore')).toBe(
      'assets/mymod/textures/block/ruby_ore.png'
    )
  })

  it('缺命名空间按 minecraft 处理', () => {
    expect(textureRefToPackPath('block/stone')).toBe(
      'assets/minecraft/textures/block/stone.png'
    )
    expect(textureRefToPackPath('item/diamond')).toBe(
      'assets/minecraft/textures/item/diamond.png'
    )
  })

  it('非法引用返回 null', () => {
    expect(textureRefToPackPath('')).toBeNull()
    expect(textureRefToPackPath('UPPER:CASE')).toBeNull()
    expect(textureRefToPackPath('ns:bad path')).toBeNull()
    expect(textureRefToPackPath('#var')).toBeNull()
    expect(textureRefToPackPath('ns:')).toBeNull()
  })
})
