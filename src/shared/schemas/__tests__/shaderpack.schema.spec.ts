/**
 * 光影包语义结构测试：元数据、类别、路径生成与文件模板。
 */
import { describe, expect, it } from 'vitest'
import {
  classifyShaderFile,
  createShaderFileTemplate,
  createShaderPackMeta,
  fallbackChain,
  isValidSubpassName,
  parseShaderFileName,
  shaderCategoryInfo,
  shaderFileRelPath,
  shaderPropertiesTemplate,
  SHADER_CATEGORIES,
  SHADER_STAGE_OPTIONS,
  stageExtension,
  subpassInfo,
  validateShaderPackMeta
} from '../shaderpack.schema'

const baseInput = {
  packId: 'my_shaders',
  name: 'My Shaders',
  loader: 'iris' as const,
  mcVersion: '1.20.1' as const,
  version: '1.0.0',
  description: ''
}

describe('createShaderPackMeta / validateShaderPackMeta', () => {
  it('合法元数据通过；版本默认 1.0.0', () => {
    const meta = createShaderPackMeta({ ...baseInput, version: '' })
    expect(meta.version).toBe('1.0.0')
    expect(validateShaderPackMeta(meta)).toBeNull()
  })

  it('name 缺省时回退 packId', () => {
    expect(createShaderPackMeta({ ...baseInput, name: '' }).name).toBe('my_shaders')
  })

  it('非法 packId / 空名称 / 非法 loader / 非法版本报错', () => {
    expect(validateShaderPackMeta(createShaderPackMeta({ ...baseInput, packId: 'Bad-ID' }))).toContain('包 ID')
    expect(validateShaderPackMeta(createShaderPackMeta({ ...baseInput, name: '   ' }))).toContain('名称')
    const badLoader = createShaderPackMeta({ ...baseInput })
    ;(badLoader as { loader: string }).loader = 'vulkan'
    expect(validateShaderPackMeta(badLoader)).toContain('加载器')
    const badVer = createShaderPackMeta({ ...baseInput })
    ;(badVer as { mcVersion: string }).mcVersion = '1.99.9'
    expect(validateShaderPackMeta(badVer)).toContain('MC 版本')
    // 矩阵登记的 legacy 版本（如 1.18.2）现在合法，仅供导入/迁移路径
    const legacyVer = createShaderPackMeta({ ...baseInput })
    ;(legacyVer as { mcVersion: string }).mcVersion = '1.18.2'
    expect(validateShaderPackMeta(legacyVer)).toBeNull()
  })
})

describe('SHADER_CATEGORIES', () => {
  it('12 个分组；config 不可新建，其余可新建', () => {
    expect(SHADER_CATEGORIES).toHaveLength(12)
    expect(shaderCategoryInfo('config')?.creatable).toBe(false)
    expect(shaderCategoryInfo('gbuffers')?.creatable).toBe(true)
    expect(shaderCategoryInfo('shadowcomp')?.creatable).toBe(true)
    expect(shaderCategoryInfo('begin')?.creatable).toBe(true)
    expect(shaderCategoryInfo('setup')?.creatable).toBe(true)
    expect(shaderCategoryInfo('unknown')).toBeUndefined()
  })
})

describe('stageExtension / SHADER_STAGE_OPTIONS', () => {
  it('vsh/fsh/gsh 映射', () => {
    expect(stageExtension('vertex')).toBe('.vsh')
    expect(stageExtension('fragment')).toBe('.fsh')
    expect(stageExtension('geometry')).toBe('.gsh')
    expect(SHADER_STAGE_OPTIONS).toHaveLength(3)
  })
})

describe('classifyShaderFile', () => {
  it('按文件名前缀分类管线阶段', () => {
    expect(classifyShaderFile('gbuffers_terrain')).toBe('gbuffers')
    expect(classifyShaderFile('gbuffers_water')).toBe('gbuffers')
    expect(classifyShaderFile('shadow')).toBe('shadow')
    expect(classifyShaderFile('prepare')).toBe('prepare')
    expect(classifyShaderFile('composite')).toBe('composite')
    expect(classifyShaderFile('composite1')).toBe('composite')
    expect(classifyShaderFile('deferred')).toBe('deferred')
    expect(classifyShaderFile('final')).toBe('final')
  })

  it('shadowcomp 在 shadow 之前判定（前缀重叠）', () => {
    expect(classifyShaderFile('shadowcomp')).toBe('shadowcomp')
    expect(classifyShaderFile('shadowcomp1')).toBe('shadowcomp')
    // shadow 前缀仍归 shadow
    expect(classifyShaderFile('shadow')).toBe('shadow')
    expect(classifyShaderFile('shadow_solid')).toBe('shadow')
  })

  it('begin / setup 前缀分类', () => {
    expect(classifyShaderFile('begin')).toBe('begin')
    expect(classifyShaderFile('begin1')).toBe('begin')
    expect(classifyShaderFile('setup')).toBe('setup')
    expect(classifyShaderFile('setup1')).toBe('setup')
  })

  it('无前缀文件兜底 composite', () => {
    expect(classifyShaderFile('weird_name')).toBe('composite')
  })
})

describe('shaderFileRelPath', () => {
  it('管线文件平铺 shaders/ 并带阶段扩展名', () => {
    expect(shaderFileRelPath('gbuffers', 'gbuffers_terrain', 'vertex')).toBe(
      'shaders/gbuffers_terrain.vsh'
    )
    expect(shaderFileRelPath('composite', 'composite', 'fragment')).toBe(
      'shaders/composite.fsh'
    )
  })

  it('lib/lang 进入子目录', () => {
    expect(shaderFileRelPath('lib', 'common', 'vertex')).toBe('shaders/lib/common.glsl')
    expect(shaderFileRelPath('lang', 'zh_cn', 'vertex')).toBe('shaders/lang/zh_cn.lang')
  })
})

describe('createShaderFileTemplate', () => {
  it('管线 vsh/fsh 模板非空且含 main 与版本声明', () => {
    const vsh = createShaderFileTemplate('gbuffers', 'gbuffers_terrain', 'vertex')
    expect(vsh).toContain('#version')
    expect(vsh).toContain('void main()')
    const fsh = createShaderFileTemplate('composite', 'composite', 'fragment')
    expect(fsh).toContain('texture2D')
    const gsh = createShaderFileTemplate('shadow', 'shadow', 'geometry')
    expect(gsh).toContain('#version')
  })

  it('lib 模板含 include 提示；lang 模板含 key=value 示例', () => {
    expect(createShaderFileTemplate('lib', 'common', 'vertex')).toContain('#include')
    expect(createShaderFileTemplate('lang', 'zh_cn', 'vertex')).toContain('option.')
  })
})

describe('shaderPropertiesTemplate', () => {
  it('含 name 行', () => {
    const text = shaderPropertiesTemplate(createShaderPackMeta(baseInput))
    expect(text).toContain('name=My Shaders')
  })
})

describe('SHADER_CATEGORIES.subpasses', () => {
  it('gbuffers 有 11 个子 pass，含 terrain/water/entities', () => {
    const gbuf = shaderCategoryInfo('gbuffers')
    expect(gbuf?.subpasses).toHaveLength(11)
    const names = gbuf!.subpasses!.map((s) => s.name)
    expect(names).toContain('gbuffers_terrain')
    expect(names).toContain('gbuffers_water')
    expect(names).toContain('gbuffers_textured')
    expect(names).toContain('gbuffers_entities')
  })

  it('gbuffers_textured_lit 的后备链是 textured → basic', () => {
    const lit = subpassInfo('gbuffers', 'gbuffers_textured_lit')
    expect(lit?.fallbackTo).toBe('gbuffers_textured')
    const basic = subpassInfo('gbuffers', 'gbuffers_basic')
    expect(basic?.fallbackTo).toBeNull() // 链尾
    expect(basic?.fogAffected).toBe(false)
  })

  it('composite 类有 composite~composite9 共 10 个 pass', () => {
    const comp = shaderCategoryInfo('composite')
    expect(comp?.subpasses).toHaveLength(10)
    const names = comp!.subpasses!.map((s) => s.name)
    expect(names).toContain('composite')
    expect(names).toContain('composite9')
    expect(names).not.toContain('composite10')
  })

  it('lib/lang/config 类无子 pass', () => {
    expect(shaderCategoryInfo('lib')?.subpasses).toBeUndefined()
    expect(shaderCategoryInfo('lang')?.subpasses).toBeUndefined()
    expect(shaderCategoryInfo('config')?.subpasses).toBeUndefined()
  })
})

describe('parseShaderFileName', () => {
  it('gbuffers_terrain 解析为 { gbuffers, gbuffers_terrain }', () => {
    expect(parseShaderFileName('gbuffers_terrain')).toEqual({
      category: 'gbuffers',
      subpass: 'gbuffers_terrain'
    })
  })

  it('shadow 解析为 { shadow, shadow }', () => {
    expect(parseShaderFileName('shadow')).toEqual({ category: 'shadow', subpass: 'shadow' })
  })

  it('composite5 解析为 { composite, composite5 }', () => {
    expect(parseShaderFileName('composite5')).toEqual({ category: 'composite', subpass: 'composite5' })
  })

  it('unknown_name 兜底 composite 但 subpass=null', () => {
    expect(parseShaderFileName('weird_name')).toEqual({ category: 'composite', subpass: null })
  })
})

describe('isValidSubpassName', () => {
  it('gbuffers_terrain 合法，gbuffers_fake 非法', () => {
    expect(isValidSubpassName('gbuffers', 'gbuffers_terrain')).toBe(true)
    expect(isValidSubpassName('gbuffers', 'gbuffers_fake')).toBe(false)
  })

  it('composite9 合法，composite10 非法', () => {
    expect(isValidSubpassName('composite', 'composite9')).toBe(true)
    expect(isValidSubpassName('composite', 'composite10')).toBe(false)
  })

  it('lib 类没有子 pass（总是 false）', () => {
    expect(isValidSubpassName('lib', 'common')).toBe(false)
  })
})

describe('fallbackChain', () => {
  it('entities → textured_lit → textured → basic 完整链', () => {
    const chain = fallbackChain('gbuffers', 'gbuffers_entities')
    expect(chain.map((s) => s.name)).toEqual([
      'gbuffers_entities',
      'gbuffers_textured_lit',
      'gbuffers_textured',
      'gbuffers_basic'
    ])
  })

  it('terrain 独立链（只有自己）', () => {
    const chain = fallbackChain('gbuffers', 'gbuffers_terrain')
    expect(chain).toHaveLength(1)
    expect(chain[0].name).toBe('gbuffers_terrain')
  })

  it('天空链 skytextured → skybasic → basic', () => {
    const chain = fallbackChain('gbuffers', 'gbuffers_skytextured')
    expect(chain.map((s) => s.name)).toEqual([
      'gbuffers_skytextured',
      'gbuffers_skybasic',
      'gbuffers_basic'
    ])
  })
})
