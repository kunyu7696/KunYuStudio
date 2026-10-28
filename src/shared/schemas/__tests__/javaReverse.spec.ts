import { describe, expect, it } from 'vitest'
import {
  extractBlockSegment,
  parseBlockJava,
  parseBlockSegment
} from '../javaReverse'

/** 典型 Fabric ModBlocks.java */
const FABRIC_SRC = `public class ModBlocks {
    /** Ruby Ore */
    public static final Block RUBY_ORE = new Block(FabricBlockSettings.create()
        .strength(3.0f, 3.0f)
        .sounds(BlockSoundGroup.STONE)
        .requiresTool()
        .luminance(state -> 7)
        .nonOpaque());

    /** Plain Block */
    public static final Block PLAIN = new Block(FabricBlockSettings.create()
        .strength(1.5f, 6.0f)
        .sounds(BlockSoundGroup.METAL));
}
`

/** 典型 Forge（Mojmap）ModBlocks.java */
const MOJMAP_SRC = `public class ModBlocks {
    public static final RegistryObject<Block> RUBY = BLOCKS.register("ruby",
        () -> new Block(BlockBehaviour.Properties.of()
            .strength(2.0f, 3.0f)
            .sound(SoundType.METAL)
            .lightLevel(state -> 10)
            .noOcclusion()
            .noCollission()
            ));
}
`

describe('extractBlockSegment', () => {
  it('Fabric：切出从字段声明到 `});` 的段落', () => {
    const seg = extractBlockSegment(FABRIC_SRC, 'ruby_ore')
    expect(seg).toBeTruthy()
    expect(seg).toContain('Block RUBY_ORE = new Block')
    expect(seg).toContain('.luminance(state -> 7)')
    expect(seg!.endsWith('))')).toBe(true)
    // 不包含下一个方块
    expect(seg).not.toContain('PLAIN')
  })

  it('Mojmap：从 BLOCKS.register("id" 切到 `));`', () => {
    const seg = extractBlockSegment(MOJMAP_SRC, 'ruby')
    expect(seg).toBeTruthy()
    expect(seg).toContain('BLOCKS.register("ruby"')
    expect(seg!.endsWith('))')).toBe(true)
  })

  it('找不到声明返回 null', () => {
    expect(extractBlockSegment(FABRIC_SRC, 'missing')).toBeNull()
  })
})

describe('parseBlockSegment — Fabric', () => {
  it('解析 strength/sound/requiresTool/luminance/nonOpaque', () => {
    const patch = parseBlockJava(FABRIC_SRC, 'ruby_ore')
    expect(patch).toEqual({
      hardness: 3,
      resistance: 3,
      soundGroup: 'stone',
      requiresTool: true,
      lightLevel: 7,
      hasCollision: true,
      opaque: false
    })
  })

  it('未出现的方法按默认回落：不发光/有碰撞/不透明/无需工具', () => {
    const patch = parseBlockJava(FABRIC_SRC, 'plain')
    expect(patch).toEqual({
      hardness: 1.5,
      resistance: 6,
      soundGroup: 'metal',
      requiresTool: false,
      lightLevel: 0,
      hasCollision: true,
      opaque: true
    })
  })
})

describe('parseBlockSegment — Mojmap', () => {
  it('解析 .sound/.lightLevel/.noOcclusion/.noCollission', () => {
    const patch = parseBlockJava(MOJMAP_SRC, 'ruby')
    expect(patch).toEqual({
      hardness: 2,
      resistance: 3,
      soundGroup: 'metal',
      requiresTool: false,
      lightLevel: 10,
      hasCollision: false,
      opaque: false
    })
  })
})

describe('parseBlockSegment 容错', () => {
  it('数字可不带 f，保留两位小数', () => {
    const seg = `Block X = new Block(S.create()
        .strength(1.234, 9.999))`
    const patch = parseBlockSegment(seg)
    expect(patch.hardness).toBe(1.23)
    expect(patch.resistance).toBe(10)
  })

  it('光照钳制到 0-15', () => {
    const patch = parseBlockSegment('.lightLevel(state -> 99)')
    expect(patch.lightLevel).toBe(15)
  })

  it('无法识别的音效组忽略该字段', () => {
    const patch = parseBlockSegment('.sounds(BlockSoundGroup.WEIRD)')
    expect(patch.soundGroup).toBeUndefined()
  })

  it('无任何已知调用：仅默认字段', () => {
    const patch = parseBlockSegment('new Block(Settings.create())')
    expect(patch).toEqual({
      requiresTool: false,
      lightLevel: 0,
      hasCollision: true,
      opaque: true
    })
  })

  it('parseBlockJava 找不到声明返回 null', () => {
    expect(parseBlockJava(FABRIC_SRC, 'nope')).toBeNull()
  })
})
