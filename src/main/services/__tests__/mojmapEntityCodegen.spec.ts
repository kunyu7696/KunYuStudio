/**
 * 实体代码生成（Mojmap：Forge 1.20.1 / NeoForge 1.21.1）测试。
 * 夹具模式沿用 contentGenerator.spec.ts 的 P2/P3 describe（临时目录 + 描述文件 + gradle.properties）。
 */
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
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { generateContent, planGeneration } from '../contentGenerator'
import { registerProjectRoot, unregisterProjectRoot } from '../fsService'
import { createDefaultCube } from '../../../shared/types/content'
import { createDefaultEntity } from '../../../shared/schemas/entity.schema'

/** 构造带内嵌 Cube 模型且启用刷怪蛋的被动实体（含属性与 AI goals 默认值） */
function passiveSprite() {
  const e = createDefaultEntity('sprite')
  e.displayName = { en_us: 'Sprite', zh_cn: '精灵' }
  e.spawnEgg.enabled = true
  e.renderer.cubeModel = {
    textureSize: 16,
    pixels: new Array(256).fill('#aabbcc'),
    elements: [createDefaultCube('body')]
  }
  return e
}

const EXPECTED_WRITE_RELS = [
  'src/main/java/com/kunyu/testmod/registry/ModEntities.java',
  'src/main/java/com/kunyu/testmod/entity/SpriteEntity.java',
  'src/main/java/com/kunyu/testmod/entity/SpriteModel.java',
  'src/main/java/com/kunyu/testmod/entity/SpriteRenderer.java',
  'src/main/java/com/kunyu/testmod/entity/ModEntitySetup.java',
  'src/main/java/com/kunyu/testmod/entity/ClientEntitySetup.java',
  'src/main/resources/assets/testmod/models/item/sprite_spawn_egg.json',
  'src/main/resources/assets/testmod/textures/entity/sprite.png'
]

/* ------------------------------------------------------------------ */
/* Forge 1.20.1                                                        */
/* ------------------------------------------------------------------ */
describe('Mojmap 实体生成（Forge 1.20.1）', () => {
  let root: string

  function scaffold(): void {
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
      'maven_group=com.kunyu.testmod\nminecraft_version=1.20.1\n'
    )
  }

  function readRel(relPath: string): string {
    return readFileSync(join(root, relPath), 'utf-8')
  }
  function readJsonRel(relPath: string): any {
    return JSON.parse(readRel(relPath))
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ky-mojmap-entity-forge-'))
    registerProjectRoot(root)
    scaffold()
  })
  afterEach(() => {
    unregisterProjectRoot(root)
    rmSync(root, { recursive: true, force: true })
  })

  it('planGeneration：实体全套产物列入 writes（Java 五件 + 刷怪蛋模型 + 贴图）', () => {
    const plan = planGeneration(root, [passiveSprite()])
    const paths = plan.writes.map((w) => w.path)
    for (const rel of EXPECTED_WRITE_RELS) {
      expect(paths).toContain(rel)
    }
  })

  it('实体类：Animal 基类 + createAttributes + goals 映射（Mojmap 类名）', () => {
    generateContent(root, [passiveSprite()])
    const java = readRel('src/main/java/com/kunyu/testmod/entity/SpriteEntity.java')
    expect(java).toContain('import net.minecraft.world.entity.animal.Animal;')
    expect(java).toContain('extends Animal')
    expect(java).toContain('public SpriteEntity(EntityType<? extends Animal> type, Level level)')
    // 被动默认 goals：swim/panic/mate/follow_parent/wander/look_at
    expect(java).toContain('this.goalSelector.addGoal(1, new FloatGoal(this));')
    expect(java).toContain('new PanicGoal(this, 1.5f)')
    expect(java).toContain('new BreedGoal(this, 1f)')
    expect(java).toContain('new FollowParentGoal(this, 1f)')
    expect(java).toContain('new RandomStrollGoal(this, 0.8f)')
    expect(java).toContain('new LookAtPlayerGoal(this, Player.class, 8.0f)')
    // 属性（Animal → Mob.createMobAttributes）
    expect(java).toContain('public static AttributeSupplier.Builder createAttributes()')
    expect(java).toContain('Mob.createMobAttributes()')
    expect(java).toContain('.add(Attributes.MAX_HEALTH, 20f)')
    // 繁殖语义对齐 fabric 版
    expect(java).toContain('public AgeableMob getBreedOffspring(ServerLevel level, AgeableMob partner)')
    expect(java).not.toContain('net.minecraftforge.fml.common.Mod')
  })

  it('ModEntities：DeferredRegister + RegistryObject + EntityType.Builder', () => {
    generateContent(root, [passiveSprite()])
    const java = readRel('src/main/java/com/kunyu/testmod/registry/ModEntities.java')
    expect(java).toContain(
      'DeferredRegister.create(ForgeRegistries.ENTITY_TYPES, TestmodMod.MOD_ID)'
    )
    expect(java).toContain(
      'public static final RegistryObject<EntityType<SpriteEntity>> SPRITE = ENTITIES.register("sprite",'
    )
    expect(java).toContain('EntityType.Builder.of(SpriteEntity::new, MobCategory.CREATURE)')
    expect(java).toContain('.sized(0.9f, 1.4f)')
    expect(java).toContain('.build("sprite")')
  })

  it('ModItems：ForgeSpawnEggItem 刷怪蛋字段（颜色十进制字面量）', () => {
    const e = passiveSprite()
    e.properties.primaryColor = '#a8c98f'
    e.properties.secondaryColor = '#6f8f5a'
    generateContent(root, [e])
    const java = readRel('src/main/java/com/kunyu/testmod/registry/ModItems.java')
    expect(java).toContain('import net.minecraftforge.common.ForgeSpawnEggItem;')
    expect(java).toContain('public static final RegistryObject<Item> SPRITE_SPAWN_EGG = ITEMS.register("sprite_spawn_egg",')
    // 0xa8c98f = 11059647，0x6f8f5a = 7315290
    expect(java).toContain(
      `new ForgeSpawnEggItem(ModEntities.SPRITE, ${0xa8c98f}, ${0x6f8f5a}, new Item.Properties())`
    )
  })

  it('模型/渲染器：CubeListBuilder + PartPose 镜像 fabric 坐标数学', () => {
    generateContent(root, [passiveSprite()])
    const model = readRel('src/main/java/com/kunyu/testmod/entity/SpriteModel.java')
    expect(model).toContain('extends EntityModel<SpriteEntity>')
    expect(model).toContain('public static LayerDefinition createBodyLayer()')
    expect(model).toContain('CubeListBuilder.create()')
    expect(model).toContain('.addBox(')
    expect(model).toContain('PartPose.offset(8.0f, 24.0f, 8.0f)')
    expect(model).toContain('LayerDefinition.create(mesh, 16, 16)')

    const renderer = readRel('src/main/java/com/kunyu/testmod/entity/SpriteRenderer.java')
    expect(renderer).toContain('extends MobRenderer<SpriteEntity, SpriteModel>')
    expect(renderer).toContain(
      'new ModelLayerLocation(new ResourceLocation("testmod", "sprite"), "main")'
    )
    expect(renderer).toContain('new ResourceLocation("testmod", "textures/entity/sprite.png")')
    expect(renderer).toContain('context.bakeLayer(MODEL_LAYER)')
  })

  it('Setup 织入：EntityAttributeCreationEvent + EntityRenderersEvent（注解驱动）', () => {
    generateContent(root, [passiveSprite()])
    const setup = readRel('src/main/java/com/kunyu/testmod/entity/ModEntitySetup.java')
    expect(setup).toContain('import net.minecraftforge.event.entity.EntityAttributeCreationEvent;')
    expect(setup).toContain(
      '@Mod.EventBusSubscriber(modid = TestmodMod.MOD_ID, bus = Mod.EventBusSubscriber.Bus.MOD)'
    )
    expect(setup).toContain(
      'event.put(ModEntities.SPRITE.get(), SpriteEntity.createAttributes().build());'
    )

    const client = readRel('src/main/java/com/kunyu/testmod/entity/ClientEntitySetup.java')
    expect(client).toContain('import net.minecraftforge.client.event.EntityRenderersEvent;')
    expect(client).toContain('value = Dist.CLIENT')
    expect(client).toContain(
      'event.registerEntityRenderer(ModEntities.SPRITE.get(), SpriteRenderer::new);'
    )
    expect(client).toContain(
      'event.registerLayerDefinition(SpriteRenderer.MODEL_LAYER, SpriteModel::createBodyLayer);'
    )
  })

  it('刷怪蛋模型 JSON 与贴图落盘', () => {
    generateContent(root, [passiveSprite()])
    expect(
      readJsonRel('src/main/resources/assets/testmod/models/item/sprite_spawn_egg.json')
    ).toEqual({ parent: 'minecraft:item/template_spawn_egg' })
    const png = readFileSync(
      join(root, 'src/main/resources/assets/testmod/textures/entity/sprite.png')
    )
    expect(png[0]).toBe(0x89)
    expect(png[1]).toBe(0x50)
  })
})

/* ------------------------------------------------------------------ */
/* NeoForge（参数化：1.20.4 FML 2.x + 1.21.1 FML 3.x）                  */
/* ------------------------------------------------------------------ */
for (const mcVersion of ['1.20.4', '1.21.1'] as const) {
  describe(`Mojmap 实体生成（NeoForge ${mcVersion}）`, () => {
    let root: string

    function scaffold(): void {
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

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'ky-mojmap-entity-neoforge-'))
    registerProjectRoot(root)
    scaffold()
  })
  afterEach(() => {
    unregisterProjectRoot(root)
    rmSync(root, { recursive: true, force: true })
  })

  it('planGeneration：实体全套产物列入 writes', () => {
    const plan = planGeneration(root, [passiveSprite()])
    const paths = plan.writes.map((w) => w.path)
    for (const rel of EXPECTED_WRITE_RELS) {
      expect(paths).toContain(rel)
    }
  })

  it('ModEntities：Registries.ENTITY_TYPE + DeferredHolder 双泛型', () => {
    generateContent(root, [passiveSprite()])
    const java = readRel('src/main/java/com/kunyu/testmod/registry/ModEntities.java')
    expect(java).toContain('DeferredRegister.create(Registries.ENTITY_TYPE, TestmodMod.MOD_ID)')
    expect(java).toContain(
      'public static final DeferredHolder<EntityType<?>, EntityType<SpriteEntity>> SPRITE = ENTITIES.register("sprite",'
    )
    expect(java).toContain('import net.neoforged.neoforge.registries.DeferredHolder;')
    expect(java).not.toContain('net.minecraftforge')
  })

  it('ModItems：DeferredSpawnEggItem 刷怪蛋字段', () => {
    generateContent(root, [passiveSprite()])
    const java = readRel('src/main/java/com/kunyu/testmod/registry/ModItems.java')
    expect(java).toContain('import net.neoforged.neoforge.common.DeferredSpawnEggItem;')
    expect(java).toContain('new DeferredSpawnEggItem(ModEntities.SPRITE,')
    expect(java).not.toContain('net.minecraftforge')
  })

  it('Setup 织入：neoforge 事件包名 + @EventBusSubscriber 注解', () => {
    generateContent(root, [passiveSprite()])
    const setup = readRel('src/main/java/com/kunyu/testmod/entity/ModEntitySetup.java')
    expect(setup).toContain(
      'import net.neoforged.neoforge.event.entity.EntityAttributeCreationEvent;'
    )
    if (mcVersion === '1.20.4') {
      // FML 2.x：只有嵌套类 Mod.EventBusSubscriber
      expect(setup).toContain('import net.neoforged.fml.common.Mod;')
      expect(setup).toContain(
        '@Mod.EventBusSubscriber(modid = TestmodMod.MOD_ID, bus = Mod.EventBusSubscriber.Bus.MOD)'
      )
      expect(setup).not.toContain('import net.neoforged.fml.common.EventBusSubscriber;')
      expect(setup).not.toMatch(/@EventBusSubscriber\(/)
    } else {
      // FML 3.x+：顶层 EventBusSubscriber
      expect(setup).toContain('import net.neoforged.fml.common.EventBusSubscriber;')
      expect(setup).toContain(
        '@EventBusSubscriber(modid = TestmodMod.MOD_ID, bus = EventBusSubscriber.Bus.MOD)'
      )
    }
    expect(setup).not.toContain('net.minecraftforge')

    const client = readRel('src/main/java/com/kunyu/testmod/entity/ClientEntitySetup.java')
    expect(client).toContain(
      'import net.neoforged.neoforge.client.event.EntityRenderersEvent;'
    )
    expect(client).toContain('import net.neoforged.api.distmarker.Dist;')
    expect(client).toContain(
      'event.registerEntityRenderer(ModEntities.SPRITE.get(), SpriteRenderer::new);'
    )
    expect(client).not.toContain('net.minecraftforge')
  })

  it('敌对实体：Monster 基类 + createMonsterAttributes + 攻击属性/目标', () => {
    const e = createDefaultEntity('goblin', 'hostile')
    e.displayName = { en_us: 'Goblin', zh_cn: '哥布林' }
    e.renderer.cubeModel = {
      textureSize: 16,
      pixels: new Array(256).fill('#aabbcc'),
      elements: [createDefaultCube('body')]
    }
    generateContent(root, [e])
    const java = readRel('src/main/java/com/kunyu/testmod/entity/GoblinEntity.java')
    expect(java).toContain('import net.minecraft.world.entity.monster.Monster;')
    expect(java).toContain('extends Monster')
    expect(java).toContain('Monster.createMonsterAttributes()')
    expect(java).toContain('.add(Attributes.ATTACK_DAMAGE, 3f)')
    expect(java).toContain('new MeleeAttackGoal(this, 1f, false)')
    expect(java).toContain('new NearestAttackableTargetGoal<>(this, Player.class, true)')
    const entities = readRel('src/main/java/com/kunyu/testmod/registry/ModEntities.java')
    expect(entities).toContain('MobCategory.MONSTER')
  })

  it('主类织入：ModEntities.ENTITIES 挂载 mod 事件总线；实体移除后撤销', () => {
    const mainRel = 'src/main/java/com/kunyu/testmod/TestmodMod.java'
    writeFileSync(
      join(root, mainRel),
      `package com.kunyu.testmod;

import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.common.Mod;
import com.kunyu.testmod.registry.ModBlocks;
import com.kunyu.testmod.registry.ModItems;

@Mod(TestmodMod.MOD_ID)
public class TestmodMod {
    public static final String MOD_ID = "testmod";

    public TestmodMod(IEventBus modEventBus) {
        ModBlocks.BLOCKS.register(modEventBus);
        ModItems.ITEMS.register(modEventBus);
    }
}
`
    )
    generateContent(root, [passiveSprite()])
    let main = readRel(mainRel)
    expect(main).toContain('import com.kunyu.testmod.registry.ModEntities;')
    expect(main).toContain('ModEntities.ENTITIES.register(modEventBus);')

    // 实体移除后：产物文件清理 + 主类织入撤销（避免悬空引用）
    generateContent(root, [])
    main = readRel(mainRel)
    expect(main).not.toContain('ModEntities')
    expect(
      existsSync(join(root, 'src/main/java/com/kunyu/testmod/registry/ModEntities.java'))
    ).toBe(false)
    expect(existsSync(join(root, 'src/main/java/com/kunyu/testmod/entity/SpriteEntity.java'))).toBe(
      false
    )
  })
  })
}
