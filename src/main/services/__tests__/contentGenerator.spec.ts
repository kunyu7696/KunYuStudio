import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateContent, planGeneration } from '../contentGenerator'
import { registerProjectRoot, unregisterProjectRoot } from '../fsService'
import { createSolidPng } from '../../../main/templates/pngGenerator'
import {
  createDefaultBlock,
  createDefaultCube,
  createDefaultModel,
  hexToRgb,
  type ModelAsset
} from '../../../shared/types/content'
import type { BlockSchema } from '../../../shared/schemas/block.schema'
import { createDefaultItem, type ItemSchema } from '../../../shared/schemas/item.schema'
import { createDefaultEntity } from '../../../shared/schemas/entity.schema'
import {
  addAnimation,
  addNode,
  addTexture,
  createAnimation,
  createDocument,
  createGroupNode,
  upsertAnimationKeyframe
} from '../../../shared/modeler/document'
import { upsertController } from '../../../shared/modeler/controller'

/** 测试夹具：带双语名的默认方块 */
function namedBlock(id: string, zh: string, en = zh): BlockSchema {
  const b = createDefaultBlock(id)
  b.displayName = { en_us: en, zh_cn: zh }
  return b
}

/* ------------------------------------------------------------------ */
/* M12：Cube 模型生成 + 手改漂移检测                                      */
/* ------------------------------------------------------------------ */
describe('M12 Cube 模型生成与漂移检测', () => {
  let root: string

  function scaffold(): void {
    const resources = join(root, 'src', 'main', 'resources')
    const javaBase = join(root, 'src', 'main', 'java', 'com', 'kunyu', 'testmod')
    mkdirSync(javaBase, { recursive: true })
    mkdirSync(resources, { recursive: true })
    writeFileSync(
      join(resources, 'fabric.mod.json'),
      JSON.stringify({ schemaVersion: 1, id: 'testmod', entrypoints: {} }, null, 2)
    )
    writeFileSync(join(root, 'gradle.properties'), 'maven_group=com.kunyu.testmod\n')
  }

  function readRel(relPath: string): string {
    return readFileSync(join(root, relPath), 'utf-8')
  }
  function readJsonRel(relPath: string): any {
    return JSON.parse(readRel(relPath))
  }
  function appendRel(relPath: string, suffix: string): void {
    writeFileSync(join(root, relPath), readRel(relPath) + suffix)
  }

  function twoCubeModel(id: string): ModelAsset {
    const m = createDefaultModel(id)
    m.displayName = '木箱'
    const lid = createDefaultCube('盖子')
    lid.from = [0, 12, 0]
    lid.to = [16, 16, 16]
    m.elements.push(lid)
    m.pixels[0] = '#b3804d'
    return m
  }

  const blockJavaRel = 'src/main/java/com/kunyu/testmod/registry/ModBlocks.java'

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ky-m12-gen-'))
    registerProjectRoot(root)
    scaffold()
  })
  afterEach(() => {
    unregisterProjectRoot(root)
    rmSync(root, { recursive: true, force: true })
  })

  it('方块绑定 Cube 模型：输出含 elements 的模型 JSON、模型 PNG，跳过纯色贴图', () => {
    const model = twoCubeModel('crate')
    const block = { ...namedBlock('ruby_crate', '红宝石箱', 'Ruby Crate'), cubeModelId: 'crate' }
    generateContent(root, [block, model])

    const blockModel = readJsonRel('src/main/resources/assets/testmod/models/block/ruby_crate.json')
    expect(blockModel.parent).toBeUndefined()
    expect(blockModel.elements).toHaveLength(2)
    expect(blockModel.elements[1].from).toEqual([0, 12, 0])
    expect(blockModel.textures.all).toBe('testmod:model/crate')
    expect(blockModel.display.gui.scale).toEqual([0.625, 0.625, 0.625])

    // 方块物品模型仍 parent 到方块模型
    const itemModel = readJsonRel('src/main/resources/assets/testmod/models/item/ruby_crate.json')
    expect(itemModel.parent).toBe('testmod:block/ruby_crate')

    // 模型像素画 PNG（签名 89 50 4E 47），纯色 block PNG 不再生成
    const png = readFileSync(join(root, 'src/main/resources/assets/testmod/textures/model/crate.png'))
    expect([...png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
    expect(
      existsSync(join(root, 'src/main/resources/assets/testmod/textures/block/ruby_crate.png'))
    ).toBe(false)

    const manifest = readJsonRel('.kunyu/content/generated.json')
    expect(manifest.version).toBe(2)
    expect(manifest.modelIds).toEqual(['crate'])
    expect(
      manifest.fileHashes[
        'src/main/resources/assets/testmod/models/block/ruby_crate.json'
      ]
    ).toEqual(expect.any(String))
  })

  it('物品绑定 Cube 模型：item 模型直出 elements，物品占位 PNG 跳过', () => {
    const model = twoCubeModel('crate')
    const item: ItemSchema = {
      ...createDefaultItem('crate_item'),
      displayName: { en_us: 'Crate Item', zh_cn: '箱形物品' },
      cubeModelId: 'crate'
    }
    generateContent(root, [item, model])

    const itemModel = readJsonRel('src/main/resources/assets/testmod/models/item/crate_item.json')
    expect(itemModel.elements).toHaveLength(2)
    // 不挂 parent（链顶 builtin/generated 会丢弃 elements 致隐形），display 内联手持朝向
    expect(itemModel.parent).toBeUndefined()
    expect(itemModel.display.thirdperson_righthand).toEqual({
      rotation: [0, -90, 55],
      translation: [0, 4, 0.5],
      scale: [0.85, 0.85, 0.85]
    })
    expect(itemModel.display.firstperson_righthand.scale).toEqual([0.68, 0.68, 0.68])
    expect(itemModel.textures.all).toBe('testmod:model/crate')
    expect(itemModel.textures.particle).toBe('testmod:model/crate')
    // textures/model/ 不在原版 blocks 图集 source 内，必须输出 assets/minecraft/atlases/blocks.json 并入
    const atlases = readJsonRel('src/main/resources/assets/minecraft/atlases/blocks.json')
    expect(atlases.sources).toEqual([{ type: 'directory', source: 'model', prefix: 'model/' }])
    expect(
      existsSync(join(root, 'src/main/resources/assets/testmod/textures/item/crate_item.png'))
    ).toBe(false)
  })

  it('物品内嵌 cubeModel（无 cubeModelId）：直出 elements + 内联手持 display + 模型 PNG 落盘', () => {
    const blade = createDefaultCube('blade')
    blade.from = [7.4, 5, 7.4]
    blade.to = [8.6, 15.5, 8.6]
    const grip = createDefaultCube('grip')
    grip.from = [7.3, 0.5, 7.3]
    grip.to = [8.7, 4.6, 8.7]
    const pixels = Array(256).fill('#c01818')
    const item: ItemSchema = {
      ...createDefaultItem('devil_blade'),
      displayName: { en_us: 'Devil Blade', zh_cn: '鬼泣之刃' },
      itemType: 'tool'
    }
    item.texture.pixels = pixels
    item.model.cubeModel = {
      textureSize: 16,
      pixels: [],
      elements: [blade, grip],
      display: { thirdperson_righthand: { scale: [1.3, 1.3, 1.3] } }
    }
    generateContent(root, [item])

    const itemModel = readJsonRel('src/main/resources/assets/testmod/models/item/devil_blade.json')
    expect(itemModel.parent).toBeUndefined()
    expect(itemModel.elements).toHaveLength(2)
    expect(itemModel.elements[0].from).toEqual([7.4, 5, 7.4])
    // 用户 display 槽位级覆盖默认值：scale 放大，rotation/translation 继承内联手持默认
    expect(itemModel.display.thirdperson_righthand).toEqual({
      rotation: [0, -90, 55],
      translation: [0, 4, 0.5],
      scale: [1.3, 1.3, 1.3]
    })
    expect(itemModel.display.firstperson_righthand.scale).toEqual([0.68, 0.68, 0.68])
    expect(itemModel.textures.all).toBe('testmod:model/devil_blade')
    expect(itemModel.textures.particle).toBe('testmod:model/devil_blade')

    // 贴图落 model 路径（复用物品像素画），item 占位贴图不再生成
    const png = readFileSync(join(root, 'src/main/resources/assets/testmod/textures/model/devil_blade.png'))
    expect([...png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
    expect(
      existsSync(join(root, 'src/main/resources/assets/testmod/textures/item/devil_blade.png'))
    ).toBe(false)
  })

  it('悬空 modelId（模型已删除）回退为 cube_all 纯色贴图路径', () => {
    const block: BlockSchema = {
      ...namedBlock('ghost_block', '幽灵方块', 'Ghost Block'),
      cubeModelId: 'missing_model'
    }
    generateContent(root, [block])
    const blockModel = readJsonRel('src/main/resources/assets/testmod/models/block/ghost_block.json')
    expect(blockModel.parent).toBe('block/cube_all')
    expect(existsSync(join(root, 'src/main/resources/assets/testmod/textures/block/ghost_block.png'))).toBe(true)
  })

  it('漂移检测：注册类手改经符号级合并处理（P0-A 后注册类由生成器接管）；资源文件仍跳过+确认覆盖', () => {
    const block = namedBlock('ruby_crate', '红宝石箱', 'Ruby Crate')
    generateContent(root, [block])

    appendRel(blockJavaRel, '\n// 用户手改痕迹\n')

    // dry-run 预检：零副作用；注册类漂移走增量合并（将落盘），不再列为待决冲突
    const plan = planGeneration(root, [block])
    const planned = plan.writes.find((f) => f.path === blockJavaRel)
    expect(planned?.drifted).toBe(true)
    expect(planned?.willWrite).toBe(true)
    expect(plan.conflicts.some((f) => f.path === blockJavaRel)).toBe(false)
    // 预检不得落盘
    expect(readRel(blockJavaRel)).toContain('用户手改痕迹')

    // 默认生成：注册类以语义集合为准重写（无法解析为注册段的手改痕迹不保留）
    const rewritten = generateContent(root, [block])
    expect(readRel(blockJavaRel)).not.toContain('用户手改痕迹')
    expect(rewritten.diverged).not.toContain(blockJavaRel)
    expect(rewritten.files.some((f) => f.path === blockJavaRel)).toBe(true)

    // 对照组：不可按段合并的资源文件（blockstate）手改后仍整份跳过，确认后才覆盖
    const stateRel = 'src/main/resources/assets/testmod/blockstates/ruby_crate.json'
    appendRel(stateRel, '\n// 手改 blockstate\n')
    const skipped = generateContent(root, [block])
    expect(readRel(stateRel)).toContain('手改 blockstate')
    expect(skipped.diverged).toContain(stateRel)
    const forced = generateContent(root, [block], { overwritePaths: [stateRel] })
    expect(readRel(stateRel)).not.toContain('手改 blockstate')
    expect(forced.diverged).not.toContain(stateRel)
  })

  it('删除对象时若旧资源被手改：删除受保护，文件保留并继续登记', () => {
    const block = namedBlock('ruby_crate', '红宝石箱', 'Ruby Crate')
    generateContent(root, [block])
    const stateRel = 'src/main/resources/assets/testmod/blockstates/ruby_crate.json'
    appendRel(stateRel, '\n// 手改 blockstate\n')

    const result = generateContent(root, [])
    expect(existsSync(join(root, stateRel))).toBe(true)
    expect(result.diverged).toContain(stateRel)
    expect(result.files.find((f) => f.path === stateRel)).toBeUndefined()

    // 清单仍登记该文件，下一轮继续受追踪
    const manifest = readJsonRel('.kunyu/content/generated.json')
    expect(manifest.files).toContain(stateRel)
    expect(manifest.diverged).toContain(stateRel)
  })

  it('自定义战利品表：编译多池/区间数量/概率，覆盖 dropsSelf 自动产物', () => {
    const block: BlockSchema = {
      ...namedBlock('ruby_ore', '红宝石矿', 'Ruby Ore'),
      lootTable: {
        type: 'block',
        pools: [
          {
            rolls: { kind: 'fixed', value: 1 },
            entries: [
              { item: 'ruby_ore', count: { kind: 'fixed', value: 1 }, weight: 1, chance: 1 },
              {
                item: 'minecraft:diamond',
                count: { kind: 'range', min: 1, max: 3 },
                weight: 1,
                chance: 0.25
              }
            ]
          },
          {
            rolls: { kind: 'range', min: 1, max: 2 },
            entries: [
              { item: 'minecraft:experience_orb', count: { kind: 'fixed', value: 1 }, weight: 1, chance: 1 }
            ]
          }
        ]
      }
    }
    generateContent(root, [block])

    const loot = readJsonRel(
      'src/main/resources/data/testmod/loot_tables/blocks/ruby_ore.json'
    ) as any
    expect(loot.type).toBe('minecraft:block')
    expect(loot.pools).toHaveLength(2)

    // 池1：自身（无 set_count）+ 钻石（区间 set_count + random_chance）
    const p0 = loot.pools[0]
    expect(p0.conditions).toEqual([{ condition: 'minecraft:survives_explosion' }])
    expect(p0.entries[0].name).toBe('testmod:ruby_ore')
    expect(p0.entries[0].functions).toBeUndefined()
    expect(p0.entries[1].name).toBe('minecraft:diamond')
    expect(p0.entries[1].functions).toEqual([
      { function: 'minecraft:set_count', count: { min: 1, max: 3 } }
    ])
    expect(p0.entries[1].conditions).toEqual([
      { condition: 'minecraft:random_chance', chance: 0.25 }
    ])

    // 池2：抽取次数区间
    expect(loot.pools[1].rolls).toEqual({ min: 1, max: 2 })
  })

  it('像素画贴图：block PNG 由像素生成，与纯色占位 PNG 不同', () => {
    const block = namedBlock('ruby_block', '红宝石块', 'Ruby Block')
    block.texture.pixels = Array(256).fill('')
    block.texture.pixels[0] = '#ff0000'
    block.texture.pixels[255] = '#00ff00'
    generateContent(root, [block])

    const png = readFileSync(
      join(root, 'src/main/resources/assets/testmod/textures/block/ruby_block.png')
    )
    // PNG 头
    expect([...png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
    // 与默认颜色的纯色占位 PNG 字节不同（证明走了像素分支）
    const rgb = hexToRgb(block.texture.color)
    expect(png.equals(createSolidPng(rgb.r, rgb.g, rgb.b))).toBe(false)
  })

  it('v1 清单（无 hash）首轮按基线处理：只建档，不误报漂移', () => {
    const block = namedBlock('ruby_crate', '红宝石箱', 'Ruby Crate')
    generateContent(root, [block])

    // 模拟旧版本（M12 前）留下的 v1 清单
    const manifestRel = '.kunyu/content/generated.json'
    const v1 = readJsonRel(manifestRel)
    delete v1.fileHashes
    delete v1.diverged
    delete v1.modelIds
    v1.version = 1
    writeFileSync(join(root, manifestRel), JSON.stringify(v1, null, 2))
    appendRel(blockJavaRel, '\n// 老项目里的手改\n')

    const result = generateContent(root, [block])
    // 基线轮不判冲突，按工具产物正常重写
    expect(readRel(blockJavaRel)).not.toContain('老项目里的手改')
    expect(result.diverged).toEqual([])
    // 新清单升级 v2 并带 hash，下一轮起漂移检测生效
    const upgraded = readJsonRel(manifestRel)
    expect(upgraded.version).toBe(2)
    expect(upgraded.fileHashes[blockJavaRel]).toEqual(expect.any(String))

    appendRel(blockJavaRel, '\n// 再次手改\n')
    const plan = planGeneration(root, [block])
    // P0-A：注册类漂移走符号级合并（将落盘），标记 drifted 但不再是待决冲突
    const planned = plan.writes.find((f) => f.path === blockJavaRel)
    expect(planned?.drifted).toBe(true)
    expect(plan.conflicts.some((f) => f.path === blockJavaRel)).toBe(false)
  })

  it('实体刷怪蛋：enabled 时落盘 template_spawn_egg 模型 JSON，禁用时清理（M5 资源校验回归）', () => {
    // 构造带内嵌 Cube 模型且启用刷怪蛋的实体
    const entity = createDefaultEntity('sprite')
    entity.displayName = { en_us: 'Sprite', zh_cn: '精灵' }
    entity.spawnEgg.enabled = true
    const cube = createDefaultCube('body')
    entity.renderer.cubeModel = {
      textureSize: 16,
      pixels: new Array(256).fill('#aabbcc'),
      elements: [cube]
    }
    generateContent(root, [entity])

    const eggModelRel = 'src/main/resources/assets/testmod/models/item/sprite_spawn_egg.json'
    // 刷怪蛋模型引用原版模板（双层染色），无需贴图文件
    const eggModel = readJsonRel(eggModelRel)
    expect(eggModel).toEqual({ parent: 'minecraft:item/template_spawn_egg' })
    // lang 也应有刷怪蛋条目
    expect(readRel('src/main/resources/assets/testmod/lang/zh_cn.json')).toContain(
      'sprite_spawn_egg'
    )

    // 禁用刷怪蛋后重新生成：旧模型文件应被 manifest 漂移保护清理
    entity.spawnEgg.enabled = false
    generateContent(root, [entity])
    expect(existsSync(join(root, eggModelRel))).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/* P2：GeckoLib 骨骼动画实体（blockbench_geo）                            */
/* ------------------------------------------------------------------ */
describe('P2 GeckoLib 骨骼动画实体生成', () => {
  let root: string

  const HUMANOID_GEO = JSON.stringify({
    format_version: '1.12.0',
    'minecraft:geometry': [
      {
        description: { identifier: 'geometry.goblin', texture_width: 64, texture_height: 64 },
        bones: [
          { name: 'body', pivot: [0, 12, 0], cubes: [{ origin: [-4, 12, -2], size: [8, 12, 4], uv: [16, 16] }] },
          { name: 'head', parent: 'body', pivot: [0, 24, 0], cubes: [{ origin: [-4, 24, -4], size: [8, 8, 8], uv: [0, 0] }] },
          { name: 'arm_left', parent: 'body', pivot: [5, 22, 0], cubes: [{ origin: [4, 12, -2], size: [4, 12, 4], uv: [32, 48] }] },
          { name: 'arm_right', parent: 'body', pivot: [-5, 22, 0], cubes: [{ origin: [-8, 12, -2], size: [4, 12, 4], uv: [40, 16] }] },
          { name: 'leg_left', pivot: [2, 12, 0], cubes: [{ origin: [0, 0, -2], size: [4, 12, 4], uv: [16, 48] }] },
          { name: 'leg_right', pivot: [-2, 12, 0], cubes: [{ origin: [-4, 0, -2], size: [4, 12, 4], uv: [0, 16] }] }
        ]
      }
    ]
  })

  function scaffold(): void {
    const resources = join(root, 'src', 'main', 'resources')
    const javaBase = join(root, 'src', 'main', 'java', 'com', 'kunyu', 'testmod')
    mkdirSync(javaBase, { recursive: true })
    mkdirSync(resources, { recursive: true })
    writeFileSync(
      join(resources, 'fabric.mod.json'),
      JSON.stringify({ schemaVersion: 1, id: 'testmod', entrypoints: {} }, null, 2)
    )
    writeFileSync(join(root, 'gradle.properties'), 'maven_group=com.kunyu.testmod\n')
    writeFileSync(
      join(root, 'build.gradle'),
      // 形状对齐真实模板：块内含内联 `}`（maven url 行 / ${...} 占位），
      // 覆盖织入正则错认首个内联 `}` 为块尾的回归
      `plugins { id 'fabric-loom' }\n\nrepositories {\n    maven { url 'https://maven.aliyun.com/repository/public' }\n    mavenCentral()\n}\n\ndependencies {\n    minecraft "com.mojang:minecraft:\${project.minecraft_version}"\n}\n`
    )
  }

  function readRel(relPath: string): string {
    return readFileSync(join(root, relPath), 'utf-8')
  }
  function readJsonRel(relPath: string): any {
    return JSON.parse(readRel(relPath))
  }

  function geoGoblin(): ReturnType<typeof createDefaultEntity> {
    const e = createDefaultEntity('goblin', 'hostile')
    e.displayName = { en_us: 'Goblin', zh_cn: '哥布林' }
    e.spawnEgg.enabled = true
    e.renderer.modelType = 'blockbench_geo'
    e.renderer.geoJson = HUMANOID_GEO
    return e
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ky-p2-gecko-'))
    registerProjectRoot(root)
    scaffold()
  })
  afterEach(() => {
    unregisterProjectRoot(root)
    rmSync(root, { recursive: true, force: true })
  })

  it('blockbench_geo 实体：geo/动画资产 + GeoEntity 三件套 Java + GeckoLib 依赖织入', () => {
    generateContent(root, [geoGoblin()])

    // geo.json 原样落盘
    const geo = readJsonRel('src/main/resources/assets/testmod/geo/entity/goblin.geo.json')
    expect(geo['minecraft:geometry'][0].description.identifier).toBe('geometry.goblin')

    // 参数化动画三件套
    const anim = readJsonRel('src/main/resources/assets/testmod/animations/entity/goblin.animation.json')
    expect(anim.format_version).toBe('1.8.0')
    expect(Object.keys(anim.animations)).toEqual(
      expect.arrayContaining([
        'animation.goblin.idle',
        'animation.goblin.walk',
        'animation.goblin.attack'
      ])
    )

    // 贴图：无 cube 像素画时按主色铺底（PNG 签名）
    const png = readFileSync(join(root, 'src/main/resources/assets/testmod/textures/entity/goblin.png'))
    expect(png[0]).toBe(0x89)
    expect(png[1]).toBe(0x50)
    // 实体类实现 GeoEntity（含动画控制器与实例缓存）
    const entityJava = readRel('src/main/java/com/kunyu/testmod/entity/GoblinEntity.java')
    expect(entityJava).toContain('implements GeoEntity')
    expect(entityJava).toContain('registerControllers')
    expect(entityJava).toContain('animation.goblin.walk')
    expect(entityJava).toContain('AnimatableInstanceCache')

    // GeoModel 三资源定位
    const modelJava = readRel('src/main/java/com/kunyu/testmod/entity/GoblinGeoModel.java')
    expect(modelJava).toContain('extends GeoModel<GoblinEntity>')
    expect(modelJava).toContain('geo/entity/goblin.geo.json')
    expect(modelJava).toContain('animations/entity/goblin.animation.json')

    // 渲染器：GeoEntityRenderer（无 EntityModelLayer）
    const rendererJava = readRel('src/main/java/com/kunyu/testmod/entity/GoblinRenderer.java')
    expect(rendererJava).toContain('extends GeoEntityRenderer<GoblinEntity>')
    expect(rendererJava).not.toContain('EntityModelLayer')
    expect(existsSync(join(root, 'src/main/java/com/kunyu/testmod/entity/GoblinModel.java'))).toBe(false)

    // 客户端入口：注册渲染器但不注册模型层
    const clientJava = readRel('src/main/java/com/kunyu/testmod/TestmodModClient.java')
    expect(clientJava).toContain('GoblinRenderer::new')
    expect(clientJava).toContain('import com.kunyu.testmod.entity.GoblinGeoModel;')
    expect(clientJava).not.toContain('GOBLIN_LAYER')

    // ModEntities 注册（geo 实体同样参与）
    expect(readRel('src/main/java/com/kunyu/testmod/registry/ModEntities.java')).toContain(
      'GoblinEntity'
    )

    // 依赖织入：build.gradle + gradle.properties + fabric.mod.json depends
    const gradle = readRel('build.gradle')
    expect(gradle).toContain('https://dl.cloudsmith.io/public/geckolib3/geckolib/maven/')
    expect(gradle).toContain('software.bernie.geckolib:geckolib-fabric-1.20.1')
    // 回归（m_fab1201 实测构建炸点）：织入必须落在块尾独立行，
    // 不得截断内联 `}` 行（aliyun maven / minecraft 依赖的 ${...} 占位）
    expect(gradle).toMatch(/^\s+maven \{ url = 'https:\/\/dl\.cloudsmith\.io\/public\/geckolib3\/geckolib\/maven\/' \} \/\/ kunyu:geckolib$/m)
    expect(gradle).toContain("maven { url 'https://maven.aliyun.com/repository/public' }")
    expect(gradle).toContain('minecraft "com.mojang:minecraft:${project.minecraft_version}"')
    expect(readRel('gradle.properties')).toContain('geckolib_version=4.4.9')
    const modJson = readJsonRel('src/main/resources/fabric.mod.json')
    expect(modJson.depends.geckolib).toBe('>=4.4.9')
    expect(modJson.entrypoints.client).toContain('com.kunyu.testmod.TestmodModClient')

    // 刷怪蛋模型照常落盘
    expect(
      readJsonRel('src/main/resources/assets/testmod/models/item/goblin_spawn_egg.json')
    ).toEqual({ parent: 'minecraft:item/template_spawn_egg' })
  })

  it('geo 实体贴图：renderer.texturePng（工坊「应用到实体」直出）优先于 cube/铺底链原样落盘', () => {
    const e = geoGoblin()
    const pngB64 = createSolidPng(0x12, 0xab, 0x34).toString('base64')
    e.renderer.texturePng = pngB64
    generateContent(root, [e])

    const png = readFileSync(join(root, 'src/main/resources/assets/testmod/textures/entity/goblin.png'))
    expect(png.equals(Buffer.from(pngB64, 'base64'))).toBe(true)
  })

  /** 落盘一份带已创作动画的工坊文档（body/head 两骨骼：walk 覆盖模板 + roar 新增） */
  function writeAnimatedDoc(docId = 'goblin_doc'): void {
    let doc = createDocument({ id: docId, name: docId, format: 'bedrock_entity', now: 1000 })
    const body = createGroupNode('body')
    doc = addNode(doc, body, null)
    const head = createGroupNode('head')
    doc = addNode(doc, head, body.id)
    const walk = createAnimation('walk', { length: 1, loop: 'loop' })
    doc = addAnimation(doc, walk)
    doc = upsertAnimationKeyframe(doc, walk.id, body.id, 'rotation', {
      time: 0,
      value: [45, 0, 0],
      interpolation: 'linear'
    })
    const roar = createAnimation('roar', { length: 0.5, loop: 'once' })
    doc = addAnimation(doc, roar)
    doc = upsertAnimationKeyframe(doc, roar.id, head.id, 'rotation', {
      time: 0,
      value: [0, 0, 30],
      interpolation: 'linear'
    })
    mkdirSync(join(root, '.kunyu', 'modeler'), { recursive: true })
    writeFileSync(join(root, '.kunyu', 'modeler', `${docId}.json`), JSON.stringify(doc))
  }

  it('P4-gen：登记工坊文档的实体优先消费已创作动画，模板补全控制器缺项', () => {
    writeAnimatedDoc()
    const e = geoGoblin()
    e.renderer.modelerDocId = 'goblin_doc'
    generateContent(root, [e])

    const anim = readJsonRel('src/main/resources/assets/testmod/animations/entity/goblin.animation.json')
    expect(anim.format_version).toBe('1.8.0')
    // 已创作 walk 覆盖模板（导出 X 取反：45 → -45；单帧数组简写；-0 归一为 0）
    const walkRot = anim.animations['animation.goblin.walk'].bones.body.rotation['0'] as number[]
    expect(walkRot.map((v) => v + 0)).toEqual([-45, 0, 0])
    // 已创作 roar 直接导出（Z 不取反，loop='once' 不写 loop 字段）
    const roar = anim.animations['animation.goblin.roar']
    expect(roar.loop).toBeUndefined()
    const roarRot = roar.bones.head.rotation['0'] as number[]
    expect(roarRot.map((v) => v + 0)).toEqual([0, 0, 30])
    // 模板 idle 补全（实体类控制器引用 animation.goblin.idle）
    expect(anim.animations['animation.goblin.idle']).toBeDefined()
  })

  it('P4-gen：文档缺失 / 非法 docId / 无动画文档均回退纯模板动画', () => {
    const e = geoGoblin()
    e.renderer.modelerDocId = 'ghost_doc'
    generateContent(root, [e])
    const anim = readJsonRel('src/main/resources/assets/testmod/animations/entity/goblin.animation.json')
    expect(Object.keys(anim.animations)).toHaveLength(3)
    expect(Object.keys(anim.animations)).toEqual(
      expect.arrayContaining([
        'animation.goblin.idle',
        'animation.goblin.walk',
        'animation.goblin.attack'
      ])
    )

    // 非法 docId（路径穿越）：拒绝读取，回退模板
    const evil = geoGoblin()
    evil.renderer.modelerDocId = '../evil'
    generateContent(root, [evil])
    expect(
      Object.keys(
        readJsonRel('src/main/resources/assets/testmod/animations/entity/goblin.animation.json')
          .animations
      )
    ).toHaveLength(3)

    // 无动画文档：回退模板
    const emptyDoc = createDocument({ id: 'empty_doc', name: 'empty_doc', format: 'bedrock_entity', now: 1000 })
    mkdirSync(join(root, '.kunyu', 'modeler'), { recursive: true })
    writeFileSync(join(root, '.kunyu', 'modeler', 'empty_doc.json'), JSON.stringify(emptyDoc))
    const plain = geoGoblin()
    plain.renderer.modelerDocId = 'empty_doc'
    generateContent(root, [plain])
    expect(
      Object.keys(
        readJsonRel('src/main/resources/assets/testmod/animations/entity/goblin.animation.json')
          .animations
      )
    ).toHaveLength(3)
    // 无控制器：实体 Java 回退 idle/walk 二态硬编码（无状态机结构）
    const plainJava = readRel('src/main/java/com/kunyu/testmod/entity/GoblinEntity.java')
    expect(plainJava).not.toContain('GeoAnimState')
    expect(plainJava).toContain('animation.goblin.idle')
  })

  /* ------------------------------------------------------------------ */
  /* B1-2 动画控制器状态机 → Java 谓词生成                                 */
  /* ------------------------------------------------------------------ */

  /** 落盘带控制器状态机的工坊文档（idle 常态；移动→walk；攻击→attack；walk 静止→idle） */
  function writeControllerDoc(docId = 'goblin_ctrl_doc'): void {
    let doc = createDocument({ id: docId, name: docId, format: 'geckolib', now: 1000 })
    const body = createGroupNode('body')
    doc = addNode(doc, body, null)
    const idle = createAnimation('idle')
    const walk = createAnimation('walk')
    const attack = createAnimation('attack')
    doc = addAnimation(doc, idle)
    doc = addAnimation(doc, walk)
    doc = addAnimation(doc, attack)
    doc = upsertController(doc, {
      name: 'controller',
      initialState: 'idle',
      states: [
        { name: 'idle', animation: idle.id },
        { name: 'walk', animation: walk.id },
        { name: 'attack', animation: attack.id }
      ],
      transitions: [
        { from: 'idle', to: 'walk', condition: 'is_moving' },
        { from: 'idle', to: 'attack', condition: 'is_attacking' },
        { from: 'walk', to: 'idle', condition: 'always' },
        { from: 'attack', to: 'idle', condition: 'always' },
        { from: 'attack', to: 'walk', condition: 'is_hurt' }
      ]
    })
    mkdirSync(join(root, '.kunyu', 'modeler'), { recursive: true })
    writeFileSync(join(root, '.kunyu', 'modeler', `${docId}.json`), JSON.stringify(doc))
  }

  it('B1-2：控制器状态机实体 Java 按状态机生成谓词（枚举/Map/转移表/受伤旗标）', () => {
    writeControllerDoc()
    const e = geoGoblin()
    e.renderer.modelerDocId = 'goblin_ctrl_doc'
    generateContent(root, [e])

    const java = readRel('src/main/java/com/kunyu/testmod/entity/GoblinEntity.java')
    // 状态枚举与初始态
    expect(java).toContain('private enum GeoAnimState { IDLE, WALK, ATTACK }')
    expect(java).toContain('currentState = GeoAnimState.IDLE')
    // 状态→动画映射（键与 bedrockAnim 导出命名规则一致）
    expect(java).toContain('animation.goblin.idle')
    expect(java).toContain('animation.goblin.walk')
    expect(java).toContain('animation.goblin.attack')
    // 转移表：条件谓词逐一落 Java
    expect(java).toContain('currentState == GeoAnimState.IDLE && state.isMoving()')
    expect(java).toContain('currentState == GeoAnimState.IDLE && this.isAttacking()')
    expect(java).toContain('currentState == GeoAnimState.WALK && true')
    expect(java).toContain('currentState == GeoAnimState.ATTACK && this.hurtTime > 0 || this.lastHurtTime > 0')
    // 受伤快照 damage 覆写与所需 import
    expect(java).toContain('public boolean damage(DamageSource source, float amount)')
    expect(java).toContain('import net.minecraft.entity.damage.DamageSource;')
    expect(java).toContain('import java.util.function.Supplier;')
    // 回退硬编码不再出现（状态机接管）
    expect(java).not.toContain('if (state.isMoving()) {')
  })

  it('B1-2：非法控制器（初始状态缺失）回退 idle/walk 二态，不阻断生成', () => {
    let doc = createDocument({ id: 'bad_ctrl_doc', name: 'bad_ctrl_doc', format: 'geckolib', now: 1000 })
    const idle = createAnimation('idle')
    doc = addAnimation(doc, idle)
    doc = upsertController(doc, {
      name: 'controller',
      initialState: 'ghost',
      states: [{ name: 'idle', animation: idle.id }],
      transitions: []
    })
    mkdirSync(join(root, '.kunyu', 'modeler'), { recursive: true })
    writeFileSync(join(root, '.kunyu', 'modeler', 'bad_ctrl_doc.json'), JSON.stringify(doc))

    const e = geoGoblin()
    e.renderer.modelerDocId = 'bad_ctrl_doc'
    generateContent(root, [e])
    const java = readRel('src/main/java/com/kunyu/testmod/entity/GoblinEntity.java')
    expect(java).not.toContain('GeoAnimState')
    expect(java).toContain('animation.goblin.idle')
    expect(java).toContain('animation.goblin.walk')
  })

  it('geo 实体移除后：GeckoLib 织入全部撤销，custom 实体回归不受影响', () => {
    generateContent(root, [geoGoblin()])
    expect(readRel('build.gradle')).toContain('kunyu:geckolib')

    generateContent(root, [])
    expect(readRel('build.gradle')).not.toContain('kunyu:geckolib')
    expect(readRel('build.gradle')).not.toContain('geckolib')
    expect(readRel('gradle.properties')).not.toContain('geckolib_version')
    expect(readJsonRel('src/main/resources/fabric.mod.json').depends?.geckolib).toBeUndefined()

    // custom cube 实体回归：走旧 EntityModelLayer 路径
    const sprite = createDefaultEntity('sprite')
    sprite.renderer.cubeModel = {
      textureSize: 16,
      pixels: new Array(256).fill('#aabbcc'),
      elements: [createDefaultCube('body')]
    }
    generateContent(root, [sprite])
    const clientJava = readRel('src/main/java/com/kunyu/testmod/TestmodModClient.java')
    expect(clientJava).toContain('SPRITE_LAYER')
    expect(readRel('build.gradle')).not.toContain('geckolib')
    expect(
      readRel('src/main/java/com/kunyu/testmod/entity/SpriteEntity.java')
    ).not.toContain('GeoEntity')
  })

  it('非法 geoJson 抛中文错误（防呆）', () => {
    const e = geoGoblin()
    e.renderer.geoJson = '{"hello":1}'
    expect(() => generateContent(root, [e])).toThrow('minecraft:geometry')
  })
})

/* ------------------------------------------------------------------ */
/* P1：Fabric 四类物品生成                                              */
/* ------------------------------------------------------------------ */
describe('P1 Fabric 四类物品生成', () => {
  let root: string

  function scaffold(): void {
    const resources = join(root, 'src', 'main', 'resources')
    const javaBase = join(root, 'src', 'main', 'java', 'com', 'kunyu', 'testmod')
    mkdirSync(javaBase, { recursive: true })
    mkdirSync(resources, { recursive: true })
    writeFileSync(
      join(resources, 'fabric.mod.json'),
      JSON.stringify({ schemaVersion: 1, id: 'testmod', entrypoints: {} }, null, 2)
    )
    writeFileSync(join(root, 'gradle.properties'), 'maven_group=com.kunyu.testmod\n')
  }

  function readRel(relPath: string): string {
    return readFileSync(join(root, relPath), 'utf-8')
  }
  function readJsonRel<T>(relPath: string): T {
    return JSON.parse(readRel(relPath)) as T
  }
  function modItemsJava(): string {
    return readRel('src/main/java/com/kunyu/testmod/registry/ModItems.java')
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ky-p1-item-'))
    registerProjectRoot(root)
    scaffold()
  })
  afterEach(() => {
    unregisterProjectRoot(root)
    rmSync(root, { recursive: true, force: true })
  })

  it('simple：Settings 链 + Registry.register + 模型/占位贴图/双语名', () => {
    const item = createDefaultItem('ruby_ingot')
    item.displayName = { en_us: 'Ruby Ingot', zh_cn: '红宝石锭' }
    item.properties.rarity = 'rare'
    generateContent(root, [item])

    const java = modItemsJava()
    expect(java).toContain('public static final Item RUBY_INGOT = new Item(new Item.Settings()')
    expect(java).toContain('.maxCount(64)')
    expect(java).toContain('.rarity(Rarity.RARE)')
    expect(java).toContain(
      'Registry.register(Registries.ITEM, TestmodMod.id("ruby_ingot"), RUBY_INGOT);'
    )
    expect(java).toContain('import net.minecraft.util.Rarity;')

    const model = readJsonRel<{ parent: string; textures: { layer0: string } }>(
      'src/main/resources/assets/testmod/models/item/ruby_ingot.json'
    )
    expect(model.parent).toBe('item/generated')
    expect(model.textures.layer0).toBe('testmod:item/ruby_ingot')
    expect(
      existsSync(join(root, 'src/main/resources/assets/testmod/textures/item/ruby_ingot.png'))
    ).toBe(true)

    const en = readJsonRel<Record<string, string>>(
      'src/main/resources/assets/testmod/lang/en_us.json'
    )
    const zh = readJsonRel<Record<string, string>>(
      'src/main/resources/assets/testmod/lang/zh_cn.json'
    )
    expect(en['item.testmod.ruby_ingot']).toBe('Ruby Ingot')
    expect(zh['item.testmod.ruby_ingot']).toBe('红宝石锭')
  })

  it('sword：ToolMaterials 构造 + 材质耐久兜底（未显式设耐久时）', () => {
    const item = createDefaultItem('ruby_sword', 'tool')
    generateContent(root, [item])

    const java = modItemsJava()
    expect(java).toContain('new SwordItem(ToolMaterials.IRON, 3, -2.4f, new Item.Settings()')
    expect(java).toContain('.maxDamage(ToolMaterials.IRON.getDurability())')
    expect(java).not.toContain('.maxCount(')
    expect(java).toContain('import net.minecraft.item.ToolMaterials;')
    expect(java).toContain('import net.minecraft.item.SwordItem;')
  })

  it('axe：攻击力参数为 float（Yarn 构造器差异）', () => {
    const item = createDefaultItem('ruby_axe', 'tool')
    item.tool!.toolKind = 'axe'
    item.tool!.attackDamage = 6.5
    item.tool!.attackSpeed = -3.1
    generateContent(root, [item])

    expect(modItemsJava()).toContain(
      'new AxeItem(ToolMaterials.IRON, 6.5f, -3.1f, new Item.Settings()'
    )
  })

  it('占位贴图：按物品类型程序化合成（非纯色），不同工具形状 PNG 不同', () => {
    const sword = createDefaultItem('ruby_sword', 'tool')
    const pick = createDefaultItem('ruby_pickaxe', 'tool')
    pick.tool!.toolKind = 'pickaxe'
    const gem = createDefaultItem('ruby')
    for (const it of [sword, pick, gem]) it.texture.color = '#d0203c'
    generateContent(root, [sword, pick, gem])

    const texDir = 'src/main/resources/assets/testmod/textures/item'
    const swordPng = readFileSync(join(root, texDir, 'ruby_sword.png'))
    const pickPng = readFileSync(join(root, texDir, 'ruby_pickaxe.png'))
    const gemPng = readFileSync(join(root, texDir, 'ruby.png'))
    const solid = createSolidPng(0xd0, 0x20, 0x3c)

    expect(swordPng.equals(solid)).toBe(false)
    expect(pickPng.equals(solid)).toBe(false)
    expect(gemPng.equals(solid)).toBe(false)
    expect(swordPng.equals(pickPng)).toBe(false)
  })

  it('armor：ArmorItem.Type 构造 + 材质耐久兜底 + 显式耐久覆盖', () => {
    const armor = createDefaultItem('ruby_chestplate', 'armor')
    const armorCustom = createDefaultItem('legacy_chestplate', 'armor')
    armorCustom.properties.maxDamage = 500
    generateContent(root, [armor, armorCustom])

    const java = modItemsJava()
    expect(java).toContain(
      'new ArmorItem(ArmorMaterials.IRON, ArmorItem.Type.CHESTPLATE, new Item.Settings()'
    )
    expect(java).toContain(
      '.maxDamage(ArmorMaterials.IRON.getDurability(ArmorItem.Type.CHESTPLATE))'
    )
    expect(java).toContain('.maxDamage(500)')
    expect(java).toContain('import net.minecraft.item.ArmorItem;')
    expect(java).toContain('import net.minecraft.item.ArmorMaterials;')
  })

  it('food：FoodComponent.Builder + 状态效果链', () => {
    const item = createDefaultItem('ruby_steak', 'food')
    item.food!.hunger = 8
    item.food!.saturation = 0.8
    item.food!.meat = true
    item.food!.effects.push({ effect: 'minecraft:speed', duration: 200, amplifier: 0, chance: 1 })
    generateContent(root, [item])

    const java = modItemsJava()
    expect(java).toContain('.food(new FoodComponent.Builder()')
    expect(java).toContain('.hunger(8)')
    expect(java).toContain('.saturationModifier(0.8f)')
    // Yarn FoodComponent.Builder.meat 为无参方法（.meat(true) 无法编译）
    expect(java).toContain('.meat()')
    expect(java).toContain(
      '.statusEffect(new StatusEffectInstance(StatusEffects.SPEED, 200, 0), 1f)'
    )
    expect(java).toContain('.build()')
    expect(java).toContain('import net.minecraft.item.FoodComponent;')
    expect(java).toContain('import net.minecraft.entity.effect.StatusEffectInstance;')
    expect(java).toContain('import net.minecraft.entity.effect.StatusEffects;')
  })

  it('block_item：生成为基础 Item 并注明引用来源', () => {
    const item = createDefaultItem('stone_form', 'block_item')
    item.blockRef = 'minecraft:stone'
    generateContent(root, [item])

    const java = modItemsJava()
    expect(java).toContain('public static final Item STONE_FORM = new Item(new Item.Settings()')
    expect(java).toContain('（方块物品，引用 minecraft:stone')
  })

  it('创造物品栏：按类型分发到 ItemGroups，白名单可覆盖，非法 creativeTab 回退且不可注入', () => {
    const material = createDefaultItem('ruby')
    const sword = createDefaultItem('ruby_sword', 'tool')
    const pickaxe = createDefaultItem('ruby_pickaxe', 'tool')
    pickaxe.tool!.toolKind = 'pickaxe'
    const helmet = createDefaultItem('ruby_helmet', 'armor')
    const candy = createDefaultItem('ruby_candy', 'food')
    const forced = createDefaultItem('ruby_note')
    forced.properties.creativeTab = 'REDSTONE'
    const evil = createDefaultItem('ruby_evil')
    evil.properties.creativeTab = 'INGREDIENTS); Runtime.getRuntime(); //'
    const block = createDefaultBlock('ruby_block')
    generateContent(root, [material, sword, pickaxe, helmet, candy, forced, evil, block])

    const java = modItemsJava()
    expect(java).toContain('import net.minecraft.item.ItemGroups;')
    expect(java).toContain('import net.fabricmc.fabric.api.itemgroup.v1.ItemGroupEvents;')
    // 类型默认映射：材料→配料；剑/盔甲→战斗；镐→工具；食物→食物饮品
    expect(java).toContain('modifyEntriesEvent(ItemGroups.INGREDIENTS)')
    expect(java).toContain('entries.add(RUBY);')
    expect(java).toContain('modifyEntriesEvent(ItemGroups.COMBAT)')
    expect(java).toContain('entries.add(RUBY_SWORD);')
    expect(java).toContain('entries.add(RUBY_HELMET);')
    expect(java).toContain('modifyEntriesEvent(ItemGroups.TOOLS)')
    expect(java).toContain('entries.add(RUBY_PICKAXE);')
    expect(java).toContain('modifyEntriesEvent(ItemGroups.FOOD_AND_DRINK)')
    expect(java).toContain('entries.add(RUBY_CANDY);')
    // 方块物品→建筑方块
    expect(java).toContain('modifyEntriesEvent(ItemGroups.BUILDING_BLOCKS)')
    expect(java).toContain('entries.add(RUBY_BLOCK);')
    // 白名单显式覆盖
    expect(java).toContain('modifyEntriesEvent(ItemGroups.REDSTONE)')
    expect(java).toContain('entries.add(RUBY_NOTE);')
    // 非法 creativeTab 回退默认组，且不能注入 Java 代码
    expect(java).not.toContain('Runtime.getRuntime')
  })

  it('创造物品栏：无任何托管物品时不输出 ItemGroup 事件与 import', () => {
    generateContent(root, [])
    const java = modItemsJava()
    expect(java).not.toContain('ItemGroupEvents')
    expect(java).not.toContain('ItemGroups')
  })

  it('语言文件：托管键更新、非托管键保留', () => {
    // 首轮生成前预置语言文件（基线轮不判漂移，验证合并而非覆盖）
    const langDir = join(root, 'src', 'main', 'resources', 'assets', 'testmod', 'lang')
    mkdirSync(langDir, { recursive: true })
    const enRel = 'src/main/resources/assets/testmod/lang/en_us.json'
    writeFileSync(
      join(root, enRel),
      JSON.stringify({ 'item.testmod.ruby_ingot': '旧名', 'preset.custom_key': '保留' }, null, 2)
    )

    const item = createDefaultItem('ruby_ingot')
    item.displayName = { en_us: 'Ruby Ingot', zh_cn: '红宝石锭' }
    generateContent(root, [item])

    const en = readJsonRel<Record<string, string>>(enRel)
    expect(en['item.testmod.ruby_ingot']).toBe('Ruby Ingot')
    expect(en['preset.custom_key']).toBe('保留')
  })
})

/* ------------------------------------------------------------------ */
/* Fabric 26.x（Mojmap）动态内容生成                                    */
/* ------------------------------------------------------------------ */
describe('Fabric 26.3（Mojmap）动态内容生成', () => {
  function scaffold(root: string, mcVersion: string): void {
    const resources = join(root, 'src', 'main', 'resources')
    mkdirSync(join(root, 'src', 'main', 'java', 'com', 'kunyu', 'testmod'), { recursive: true })
    mkdirSync(resources, { recursive: true })
    writeFileSync(
      join(resources, 'fabric.mod.json'),
      JSON.stringify({ schemaVersion: 1, id: 'testmod', entrypoints: {} }, null, 2)
    )
    writeFileSync(
      join(root, 'gradle.properties'),
      `maven_group=com.kunyu.testmod\nminecraft_version=${mcVersion}\n`
    )
  }

  /** 在临时工程里按指定 mcVersion 生成一轮内容，返回注册类源码（临时目录在返回前清理） */
  function generateInTemp(mcVersion: string): { blocksJava: string; itemsJava: string } {
    const root = mkdtempSync(join(tmpdir(), `ky-fabric-${mcVersion}-`))
    registerProjectRoot(root)
    try {
      scaffold(root, mcVersion)
      generateContent(root, defs())
      return {
        blocksJava: readFileSync(
          join(root, 'src/main/java/com/kunyu/testmod/registry/ModBlocks.java'),
          'utf-8'
        ),
        itemsJava: readFileSync(
          join(root, 'src/main/java/com/kunyu/testmod/registry/ModItems.java'),
          'utf-8'
        )
      }
    } finally {
      unregisterProjectRoot(root)
      rmSync(root, { recursive: true, force: true })
    }
  }

  function defs(): (BlockSchema | ItemSchema)[] {
    const block = namedBlock('ruby_block', '红宝石块')
    block.properties.requiresTool = true
    block.properties.lightLevel = 7
    const simple = createDefaultItem('ruby')
    simple.properties.rarity = 'rare'
    const sword = createDefaultItem('ruby_sword', 'tool')
    const chestplate = createDefaultItem('ruby_chestplate', 'armor')
    const steak = createDefaultItem('ruby_steak', 'food')
    steak.food!.hunger = 8
    steak.food!.saturation = 0.8
    return [block, simple, sword, chestplate, steak]
  }

  it('26.3：ModBlocks 用 world.level.block.Block + setId(ResourceKey) + SoundType 体系', () => {
    const { blocksJava: java } = generateInTemp('26.3')

    expect(java).toContain('import net.minecraft.world.level.block.Block;')
    expect(java).toContain('import net.minecraft.world.level.block.state.BlockBehaviour;')
    expect(java).toContain('import net.minecraft.world.level.block.SoundType;')
    expect(java).toContain('import net.minecraft.resources.ResourceKey;')
    expect(java).toContain(
      'public static final Block RUBY_BLOCK = new Block(BlockBehaviour.Properties.of()'
    )
    expect(java).toContain(
      '.setId(ResourceKey.create(Registries.BLOCK, TestmodMod.id("ruby_block")))'
    )
    expect(java).toContain('.sound(SoundType.STONE)')
    expect(java).toContain('.requiresCorrectToolForDrops()')
    expect(java).toContain('.lightLevel(state -> 7)')
    expect(java).toContain(
      'Registry.register(BuiltInRegistries.BLOCK, TestmodMod.id("ruby_block"), RUBY_BLOCK);'
    )
    // Yarn 名称必须彻底消失，否则 26.3 Gradle 编译报 package net.minecraft.block 不存在
    expect(java).not.toContain('net.minecraft.block.Block;')
    expect(java).not.toContain('BlockSoundGroup')
    expect(java).not.toContain('.requiresTool()')
    expect(java).not.toContain('.luminance(')
  })

  it('26.3：ModItems 用 world.item 包 + 数据组件式工具/盔甲/食物，跳过 ItemGroups 入组', () => {
    const { itemsJava: java } = generateInTemp('26.3')

    expect(java).toContain('import net.minecraft.world.item.BlockItem;')
    expect(java).toContain('import net.minecraft.world.item.Item;')
    expect(java).toContain('import net.minecraft.world.item.Rarity;')
    expect(java).toContain('import net.minecraft.world.item.ToolMaterial;')
    expect(java).toContain('import net.minecraft.world.item.equipment.ArmorMaterials;')
    expect(java).toContain('import net.minecraft.world.item.equipment.ArmorType;')
    expect(java).toContain('import net.minecraft.world.food.FoodProperties;')
    expect(java).toContain('public static final BlockItem RUBY_BLOCK = new BlockItem(')
    expect(java).toContain(
      '.setId(ResourceKey.create(Registries.ITEM, TestmodMod.id("ruby_block")))'
    )
    expect(java).toContain('.setId(ResourceKey.create(Registries.ITEM, TestmodMod.id("ruby")))')
    expect(java).toContain('new Item(new Item.Properties()')
    expect(java).toContain('.stacksTo(64)')
    expect(java).toContain('.rarity(Rarity.RARE)')
    expect(java).toContain('.sword(ToolMaterial.IRON, 3f, -2.4f)')
    expect(java).toContain('.humanoidArmor(ArmorMaterials.IRON, ArmorType.CHESTPLATE)')
    expect(java).toContain('.food(new FoodProperties.Builder()')
    expect(java).toContain('.nutrition(8)')
    expect(java).toContain('.saturationModifier(0.8f)')
    expect(java).toContain(
      'Registry.register(BuiltInRegistries.ITEM, TestmodMod.id("ruby_sword"), RUBY_SWORD);'
    )

    // 26.x Fabric 入组写法未确证：跳过 ItemGroupEvents/ItemGroups（物品仍注册成功）
    expect(java).not.toContain('ItemGroups')
    expect(java).not.toContain('ItemGroupEvents')
    // 旧 Yarn 名称/属性对象不得残留
    expect(java).not.toContain('Item.Settings')
    expect(java).not.toContain('import net.minecraft.item.Item;')
    expect(java).not.toContain('net.minecraft.block.Block;')
    expect(java).not.toContain('SwordItem')
    expect(java).not.toContain('ArmorItem')
  })

  it('Yarn 时代（1.20.1 / 1.21.1）输出保持原有 Yarn 命名，未被 Mojmap 分支改写', () => {
    for (const mcVersion of ['1.20.1', '1.21.1']) {
      const { blocksJava, itemsJava } = generateInTemp(mcVersion)

      expect(blocksJava).toContain('import net.minecraft.block.Block;')
      expect(blocksJava).toContain('import net.minecraft.sound.BlockSoundGroup;')
      expect(blocksJava).toContain('.sounds(BlockSoundGroup.STONE)')
      expect(blocksJava).toContain('.requiresTool()')
      expect(blocksJava).not.toContain('net.minecraft.world.level.block.Block;')
      expect(blocksJava).not.toContain('ResourceKey')

      expect(itemsJava).toContain('import net.minecraft.item.BlockItem;')
      expect(itemsJava).toContain('new Item.Settings()')
      expect(itemsJava).toContain('import net.minecraft.item.ItemGroups;')
      expect(itemsJava).toContain('ItemGroupEvents')
      expect(itemsJava).not.toContain('net.minecraft.world.item.BlockItem;')
      expect(itemsJava).not.toContain('setId(ResourceKey.create(')
    }
  })
})

/* ------------------------------------------------------------------ */
/* P2：Forge 1.20.1 四类物品生成（Mojmap 映射，同一份语义 JSON）          */
/* ------------------------------------------------------------------ */
describe('P2 Forge 四类物品生成', () => {
  let root: string

  function scaffold(mcVersion = '1.20.1'): void {
    const resources = join(root, 'src', 'main', 'resources')
    const javaBase = join(root, 'src', 'main', 'java', 'com', 'kunyu', 'testmod')
    mkdirSync(javaBase, { recursive: true })
    mkdirSync(join(resources, 'META-INF'), { recursive: true })
    writeFileSync(
      join(resources, 'META-INF', 'mods.toml'),
      'modLoader="javafml"\nloaderVersion="[46,)"\n\n[[mods]]\nmodId="testmod"\n'
    )
    writeFileSync(
      join(root, 'gradle.properties'),
      `maven_group=com.kunyu.testmod\nminecraft_version=${mcVersion}\n`
    )
  }

  function readRel(relPath: string): string {
    return readFileSync(join(root, relPath), 'utf-8')
  }
  function modItemsJava(): string {
    return readRel('src/main/java/com/kunyu/testmod/registry/ModItems.java')
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ky-p2-forge-'))
    registerProjectRoot(root)
    scaffold()
  })
  afterEach(() => {
    unregisterProjectRoot(root)
    rmSync(root, { recursive: true, force: true })
  })

  it('simple：RegistryObject 持有 + ForgeRegistries.ITEMS 注册 + stacksTo/rarity', () => {
    const item = createDefaultItem('ruby_ingot')
    item.properties.rarity = 'rare'
    generateContent(root, [item])

    const java = modItemsJava()
    expect(java).toContain(
      'public static final RegistryObject<Item> RUBY_INGOT = ITEMS.register("ruby_ingot",'
    )
    expect(java).toContain('.stacksTo(64)')
    expect(java).toContain('.rarity(Rarity.RARE)')
    expect(java).toContain('DeferredRegister.create(ForgeRegistries.ITEMS, TestmodMod.MOD_ID);')
    expect(java).toContain('import net.minecraftforge.registries.DeferredRegister;')
    expect(java).toContain('import net.minecraftforge.registries.RegistryObject;')
    expect(java).not.toContain('net.minecraft.registry')
  })

  it('sword：Tiers 构造 + getUses 耐久兜底（Mojmap 方法名与 Yarn 不同）', () => {
    const item = createDefaultItem('ruby_sword', 'tool')
    generateContent(root, [item])

    const java = modItemsJava()
    expect(java).toContain('new SwordItem(Tiers.IRON, 3, -2.4f, new Item.Properties()')
    expect(java).toContain('.durability(Tiers.IRON.getUses())')
    expect(java).toContain('import net.minecraft.world.item.Tiers;')
    expect(java).not.toContain('ToolMaterials')
    expect(java).not.toContain('.maxCount(')
  })

  it('armor：ArmorItem.Type 构造 + getDurability(Type) 兜底', () => {
    const item = createDefaultItem('ruby_chestplate', 'armor')
    generateContent(root, [item])

    const java = modItemsJava()
    expect(java).toContain(
      'new ArmorItem(ArmorMaterials.IRON, ArmorItem.Type.CHESTPLATE, new Item.Properties()'
    )
    // ≤1.20.4 Mojmap：ArmorMaterials 枚举自带 getDurabilityForType(Type)（javap 实证）
    expect(java).toContain(
      '.durability(ArmorMaterials.IRON.getDurabilityForType(ArmorItem.Type.CHESTPLATE))'
    )
  })

  it('food：FoodProperties.Builder + Forge 1.20.1 saturationMod 方法名', () => {
    const item = createDefaultItem('ruby_steak', 'food')
    item.food!.hunger = 8
    item.food!.saturation = 0.8
    item.food!.meat = true
    item.food!.effects.push({ effect: 'minecraft:speed', duration: 200, amplifier: 0, chance: 1 })
    generateContent(root, [item])

    const java = modItemsJava()
    expect(java).toContain('.food(new FoodProperties.Builder()')
    expect(java).toContain('.nutrition(8)')
    expect(java).toContain('.saturationMod(0.8f)')
    expect(java).toContain('.meat()')
    expect(java).toContain(
      '.effect(new MobEffectInstance(MobEffects.MOVEMENT_SPEED, 200, 0), 1f)'
    )
    expect(java).toContain('import net.minecraft.world.food.FoodProperties;')
    expect(java).toContain('import net.minecraft.world.effect.MobEffects;')
  })

  it('food：mcVersion 非 1.20 时改用 saturationModifier（方法名跟随版本）', () => {
    scaffold('1.21.1')
    const item = createDefaultItem('ruby_steak', 'food')
    generateContent(root, [item])

    expect(modItemsJava()).toContain('.saturationModifier(0.6f)')
  })
})

/* ------------------------------------------------------------------ */
/* P3 NeoForge 1.21.1 四类物品生成                                       */
/* ------------------------------------------------------------------ */
describe('P3 NeoForge 四类物品生成', () => {
  let root: string

  function scaffold(mcVersion = '1.21.1'): void {
    const resources = join(root, 'src', 'main', 'resources')
    const javaBase = join(root, 'src', 'main', 'java', 'com', 'kunyu', 'testmod')
    mkdirSync(javaBase, { recursive: true })
    mkdirSync(join(resources, 'META-INF'), { recursive: true })
    writeFileSync(
      join(resources, 'META-INF', 'neoforge.mods.toml'),
      'modLoader="javafml"\nloaderVersion="[2,)"\n\n[[mods]]\nmodId="testmod"\n'
    )
    writeFileSync(
      join(root, 'gradle.properties'),
      `maven_group=com.kunyu.testmod\nminecraft_version=${mcVersion}\n`
    )
  }

  function readRel(relPath: string): string {
    return readFileSync(join(root, relPath), 'utf-8')
  }
  function modItemsJava(): string {
    return readRel('src/main/java/com/kunyu/testmod/registry/ModItems.java')
  }
  function modBlocksJava(): string {
    return readRel('src/main/java/com/kunyu/testmod/registry/ModBlocks.java')
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ky-p3-neoforge-'))
    registerProjectRoot(root)
    scaffold()
  })
  afterEach(() => {
    unregisterProjectRoot(root)
    rmSync(root, { recursive: true, force: true })
  })

  it('simple：DeferredItem 持有 + createItems 注册 + stacksTo/rarity', () => {
    const item = createDefaultItem('ruby_ingot')
    item.properties.rarity = 'rare'
    generateContent(root, [item])

    const java = modItemsJava()
    expect(java).toContain(
      'public static final DeferredItem<Item> RUBY_INGOT = ITEMS.register("ruby_ingot",'
    )
    expect(java).toContain('public static final DeferredRegister.Items ITEMS =')
    expect(java).toContain('DeferredRegister.createItems(TestmodMod.MOD_ID);')
    expect(java).toContain('.stacksTo(64)')
    expect(java).toContain('.rarity(Rarity.RARE)')
    expect(java).toContain('import net.neoforged.neoforge.registries.DeferredItem;')
    expect(java).toContain('import net.minecraft.core.registries.Registries;')
    expect(java).not.toContain('net.minecraftforge')
    expect(java).not.toContain('RegistryObject')
  })

  it('sword：1.20.5+ attributeModifiers 组件 + getUses 耐久兜底', () => {
    const item = createDefaultItem('ruby_sword', 'tool')
    generateContent(root, [item])

    const java = modItemsJava()
    expect(java).toContain('new SwordItem(Tiers.IRON, new Item.Properties()')
    expect(java).toContain('.attributes(ItemAttributeModifiers.builder()')
    expect(java).toContain(
      '.add(Attributes.ATTACK_DAMAGE, new AttributeModifier(ResourceLocation.withDefaultNamespace("attack_damage"), 3, AttributeModifier.Operation.ADD_VALUE), EquipmentSlotGroup.MAINHAND)'
    )
    expect(java).toContain('.durability(Tiers.IRON.getUses())')
    // attributes 链先于 .durability，保证耐久覆盖语义正确
    expect(java.indexOf('.attributes(')).toBeLessThan(java.indexOf('.durability('))
    expect(java).not.toContain('ToolMaterials')
    expect(java).not.toContain('new SwordItem(Tiers.IRON, 3,')
  })

  it('axe：attributeModifiers 链（float 攻击力字面量）', () => {
    const item = createDefaultItem('ruby_axe', 'tool')
    item.tool!.toolKind = 'axe'
    item.tool!.attackDamage = 6.5
    item.tool!.attackSpeed = -3.1
    generateContent(root, [item])

    const java = modItemsJava()
    expect(java).toContain('new AxeItem(Tiers.IRON, new Item.Properties()')
    expect(java).toContain(
      '.add(Attributes.ATTACK_DAMAGE, new AttributeModifier(ResourceLocation.withDefaultNamespace("attack_damage"), 6.5f, AttributeModifier.Operation.ADD_VALUE), EquipmentSlotGroup.MAINHAND)'
    )
  })

  it('armor：Type.getDurability(multiplier) 数值表兜底（Holder 间接引用规避）', () => {
    const item = createDefaultItem('ruby_chestplate', 'armor')
    generateContent(root, [item])

    const java = modItemsJava()
    expect(java).toContain(
      'new ArmorItem(ArmorMaterials.IRON, ArmorItem.Type.CHESTPLATE, new Item.Properties()'
    )
    expect(java).toContain('.durability(ArmorItem.Type.CHESTPLATE.getDurability(15))')
    // iron 的 multiplier 是 15，不是 netherite 的 37
    expect(java).not.toContain('getDurability(37)')
  })

  it('food：saturationModifier 方法名（1.21 Data Components 侧 Builder 同构）', () => {
    const item = createDefaultItem('ruby_steak', 'food')
    item.food!.hunger = 8
    item.food!.saturation = 0.8
    item.food!.meat = true
    item.food!.effects.push({ effect: 'minecraft:speed', duration: 200, amplifier: 0, chance: 1 })
    generateContent(root, [item])

    const java = modItemsJava()
    expect(java).toContain('.food(new FoodProperties.Builder()')
    expect(java).toContain('.nutrition(8)')
    expect(java).toContain('.saturationModifier(0.8f)')
    expect(java).toContain('.meat()')
    expect(java).toContain('.effect(new MobEffectInstance(MobEffects.MOVEMENT_SPEED, 200, 0), 1f)')
  })

  it('ModBlocks/ModItems：DeferredHolder<Block, Block> 双泛型 + DeferredItem 方块物品', () => {
    const block = createDefaultBlock('ruby_crate')
    const item = createDefaultItem('ruby_ingot')
    generateContent(root, [block, item])

    expect(modBlocksJava()).toContain(
      'public static final DeferredHolder<Block, Block> RUBY_CRATE = BLOCKS.register("ruby_crate",'
    )
    expect(modBlocksJava()).toContain(
      'DeferredRegister.create(Registries.BLOCK, TestmodMod.MOD_ID);'
    )
    expect(modBlocksJava()).toContain(
      'import net.neoforged.neoforge.registries.DeferredHolder;'
    )
    const items = modItemsJava()
    expect(items).toContain(
      'public static final DeferredItem<Item> RUBY_CRATE = ITEMS.register("ruby_crate",'
    )
  })
})

/* ------------------------------------------------------------------ */
/* B2-1 flipbook 贴图动画 → PNG 帧条 + .png.mcmeta 落盘                   */
/* ------------------------------------------------------------------ */
describe('B2-1 flipbook 贴图动画生成', () => {
  let root: string

  function scaffold(): void {
    const resources = join(root, 'src', 'main', 'resources')
    const javaBase = join(root, 'src', 'main', 'java', 'com', 'kunyu', 'testmod')
    mkdirSync(javaBase, { recursive: true })
    mkdirSync(resources, { recursive: true })
    writeFileSync(
      join(resources, 'fabric.mod.json'),
      JSON.stringify({ schemaVersion: 1, id: 'testmod', entrypoints: {} }, null, 2)
    )
    writeFileSync(join(root, 'gradle.properties'), 'maven_group=com.kunyu.testmod\n')
    writeFileSync(join(root, 'build.gradle'), 'plugins { id "fabric-loom" }\n')
  }

  /** PNG IHDR 尺寸（8 字节签名 + 4 长度 + 4 "IHDR" 后：宽@16 高@20） */
  function pngSize(rel: string): { width: number; height: number } {
    const buf = readFileSync(join(root, rel))
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
  }

  /** 16×64 四帧帧条模型资产 */
  function flipModel(id: string): ModelAsset {
    const m = createDefaultModel(id)
    m.pixels = new Array(16 * 64).fill('#336699')
    m.textureAnimation = { frametime: 2, interpolate: true }
    return m
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ky-b21-flip-'))
    registerProjectRoot(root)
    scaffold()
  })
  afterEach(() => {
    unregisterProjectRoot(root)
    rmSync(root, { recursive: true, force: true })
  })

  it('模型资产 flipbook：贴图按帧条高度落盘 PNG + 旁写 mcmeta', () => {
    const block = { ...namedBlock('fire_block', '火焰方块'), cubeModelId: 'fire' }
    generateContent(root, [block, flipModel('fire')])

    expect(pngSize('src/main/resources/assets/testmod/textures/model/fire.png')).toEqual({
      width: 16,
      height: 64
    })
    const mcmeta = readJsonRel2('src/main/resources/assets/testmod/textures/model/fire.png.mcmeta')
    expect(mcmeta).toEqual({ animation: { frametime: 2, interpolate: true } })
  })

  it('cube 实体绑定 flipbook 模型资产：实体贴图帧条 + mcmeta', () => {
    const e = createDefaultEntity('fire_sprite')
    e.cubeModelId = 'fire'
    generateContent(root, [e, flipModel('fire')])

    expect(pngSize('src/main/resources/assets/testmod/textures/entity/fire_sprite.png')).toEqual({
      width: 16,
      height: 64
    })
    const mcmeta = readJsonRel2('src/main/resources/assets/testmod/textures/entity/fire_sprite.png.mcmeta')
    expect(mcmeta.animation).toEqual({ frametime: 2, interpolate: true })
  })

  it('geo 实体绑定带动画贴图的工坊文档：mcmeta 落盘（元数据来自文档）', () => {
    let doc = createDocument({ id: 'flame_doc', name: 'flame_doc', format: 'geckolib', now: 1000 })
    doc = addTexture(doc, {
      id: 'tex-1',
      name: 'all',
      width: 16,
      height: 64,
      data: 'data:image/png;base64,AAAA',
      visible: true,
      animation: { frametime: 1, frames: [0, 2, 1, 3] }
    })
    mkdirSync(join(root, '.kunyu', 'modeler'), { recursive: true })
    writeFileSync(join(root, '.kunyu', 'modeler', 'flame_doc.json'), JSON.stringify(doc))

    const e = createDefaultEntity('flame', 'hostile')
    e.renderer.modelType = 'blockbench_geo'
    e.renderer.geoJson = JSON.stringify({
      format_version: '1.12.0',
      'minecraft:geometry': [
        {
          description: { identifier: 'geometry.flame', texture_width: 16, texture_height: 16 },
          bones: [{ name: 'body', pivot: [0, 0, 0], cubes: [{ origin: [-4, 0, -4], size: [8, 8, 8], uv: [0, 0] }] }]
        }
      ]
    })
    e.renderer.modelerDocId = 'flame_doc'
    generateContent(root, [e])

    const mcmeta = readJsonRel2('src/main/resources/assets/testmod/textures/entity/flame.png.mcmeta')
    expect(mcmeta).toEqual({ animation: { frametime: 1, frames: [0, 2, 1, 3] } })
  })

  it('无动画元数据回归：不写 mcmeta', () => {
    const m = createDefaultModel('plain')
    const block = { ...namedBlock('plain_block', '普通方块'), cubeModelId: 'plain' }
    generateContent(root, [block, m])
    expect(existsSync(join(root, 'src/main/resources/assets/testmod/textures/model/plain.png.mcmeta'))).toBe(false)
  })

  function readJsonRel2(relPath: string): any {
    return JSON.parse(readFileSync(join(root, relPath), 'utf-8'))
  }
})
