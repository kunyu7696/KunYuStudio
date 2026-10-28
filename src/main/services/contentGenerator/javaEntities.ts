import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CubeElement, ModelAsset } from '../../../shared/types/content'
import type { ModelAnimationController } from '../../../shared/modeler/types'
import { autoUvAllBox } from '../../../shared/utils/cubeModel'
import { parseGeoModelInfo } from '../../../shared/utils/bbmodel'
import type { EntitySchema } from '../../../shared/schemas/entity.schema'
import type { ModContext } from './context'
import type { GenSink } from './sink'
import { fmtFloat, toJavaConst } from './javaBlocks'
import { registryImports, registriesConst } from '../../templates/fabricTemplates'
import { GENERATED_BANNER, pascal } from './utils'

/* ============ 实体 Java 生成（Fabric / Yarn 1.20.1） ============ */

type EntityJavaBase = 'AnimalEntity' | 'PathAwareEntity' | 'HostileEntity' | 'MobEntity'

/** EntitySchema 基类语义 → Yarn Java 基类 */
function entityJavaBase(e: EntitySchema): EntityJavaBase {
  if (e.baseClass === 'Monster') return 'HostileEntity'
  if (e.baseClass === 'Entity') return 'MobEntity'
  // PathAwareEntity：被动生物用 Animal 获得繁殖基础设施
  return e.entityType === 'passive' ? 'AnimalEntity' : 'PathAwareEntity'
}

/* ============ B1-2 动画控制器状态机 → Java 谓词 ============ */

/** 状态名 → Java 枚举常量（与动画 JSON 命名同一 safeIdPart 规则：非安全字符→_） */
function javaEnumConst(name: string): string {
  const s = name.replace(/[^a-zA-Z0-9_]/g, '_').toUpperCase()
  return s.length > 0 ? s : 'STATE'
}

/** 动画名 → Java 动画键（与 bedrockAnim 导出 namespace 规则一致） */
function javaAnimKey(entityId: string, animName: string): string {
  const part = animName.replace(/[^a-zA-Z0-9_-]/g, '_')
  return `animation.${entityId}.${part}`
}

/** 状态机求值所需实体谓词（v2 子集：GeckoLib isMoving + MobEntity 攻击/受伤旗标） */
const CTRL_PREDICATE_IMPORTS = [
  'import java.util.HashMap;',
  'import java.util.Map;',
  'import java.util.function.Supplier;',
  'import net.minecraft.entity.damage.DamageSource;'
]

/**
 * 按控制器状态机生成 GeckoLib 谓词体（B1-2）。
 * 结构：Map<状态, Supplier<RawAnimation>> + currentState 字段 + hurtTime 快照；
 * 每 tick 按转移表求值（首个满足者切换，表序即优先级），无满足保持。
 * 动画名→JSON 键按状态名映射（与 bedrockAnim 导出的命名规则一致）。
 */
export function buildGeoPredicateFromController(
  cls: string,
  e: EntitySchema,
  ctrl: ModelAnimationController
): string {
  const loopType = (animLoop: string | undefined): string =>
    animLoop === 'loop' ? 'LOOP' : animLoop === 'hold' ? 'PLAY_ONCE'
    : 'PLAY_ONCE'
  // 状态 → 动画名映射（动画名按 states[i].name 与 doc.animations 名对齐——
  // resolveEntityController 已校验 animation id 存在，这里用状态名对应动画名）
  const stateAnims = ctrl.states.map((s) => ({
    state: s.name,
    animKey: javaAnimKey(e.id, s.name),
    // 循环类型与动画定义一致（生成器端无法读动画定义，v2 按状态名约定：
    // 一次性动画命名不强制——保守全用 LOOP 由转移表接管，once/hold 由用户
    // 在动画定义里标，GeckoLib RawAnimation 以 LOOP 播非循环动画会停在末帧）
    loop: loopType('loop')
  }))

  const enumStates = ctrl.states.map((s) => javaEnumConst(s.name)).join(', ')
  const mapEntries = stateAnims
    .map(
      (s) =>
        `        ANIMS.put(GeoAnimState.${javaEnumConst(s.state)}, () -> RawAnimation.begin().then("${s.animKey}", Animation.LoopType.${s.loop}));`
    )
    .join('\n')
  const transitionCases = ctrl.transitions
    .map((t) => {
      const cond =
        t.condition === 'always'
          ? 'true'
          : t.condition === 'is_moving'
            ? 'state.isMoving()'
            : t.condition === 'is_attacking'
              ? 'this.isAttacking()'
              : 'this.hurtTime > 0 || this.lastHurtTime > 0'
      return `            if (currentState == GeoAnimState.${javaEnumConst(t.from)} && ${cond}) {\n                next = GeoAnimState.${javaEnumConst(t.to)};\n            }`
    })
    .join('\n')

  return `
    private enum GeoAnimState { ${enumStates} }

    private static final Map<GeoAnimState, Supplier<RawAnimation>> ANIMS = new HashMap<>();
    static {
${mapEntries}
    }

    private final AnimatableInstanceCache geoCache = GeckoLibUtil.createInstanceCache(this);
    private GeoAnimState currentState = GeoAnimState.${javaEnumConst(ctrl.initialState)};
    private int lastHurtTime;

    @Override
    public void registerControllers(AnimatableManager.ControllerRegistrar controllers) {
        controllers.add(new AnimationController<>(this, "controller", 0, this::geoPredicate));
    }

    @Override
    public boolean damage(DamageSource source, float amount) {
        boolean result = super.damage(source, amount);
        if (result) this.lastHurtTime = 10;
        return result;
    }

    private PlayState geoPredicate(AnimationState<${cls}> state) {
        if (this.lastHurtTime > 0) this.lastHurtTime--;
        GeoAnimState next = currentState;
${transitionCases}
        if (next != currentState) {
            currentState = next;
        }
        state.getController().setAnimation(ANIMS.get(currentState).get());
        return PlayState.CONTINUE;
    }

    @Override
    public AnimatableInstanceCache getAnimatableInstanceCache() {
        return this.geoCache;
    }
`
}

const ENTITY_BASE_IMPORT: Record<EntityJavaBase, string> = {
  AnimalEntity: 'net.minecraft.entity.passive.AnimalEntity',
  PathAwareEntity: 'net.minecraft.entity.mob.PathAwareEntity',
  HostileEntity: 'net.minecraft.entity.mob.HostileEntity',
  MobEntity: 'net.minecraft.entity.mob.MobEntity'
}

const ENTITY_ATTR_FACTORY: Record<EntityJavaBase, string> = {
  AnimalEntity: 'MobEntity.createMobAttributes',
  PathAwareEntity: 'MobEntity.createMobAttributes',
  HostileEntity: 'HostileEntity.createHostileAttributes',
  MobEntity: 'MobEntity.createMobAttributes'
}

export function entityClassName(e: EntitySchema): string {
  // AI 自由代码路径：优先使用自定义类的简写名（如 com.kunyu.x.ThiefEntity → ThiefEntity）
  if (e.customClass) return e.customClass.split('.').pop() ?? `${pascal(e.id)}Entity`
  return `${pascal(e.id)}Entity`
}

interface AiEntry {
  type: string
  priority?: number
  [k: string]: unknown
}

/** 翻译单个 goalSelector 目标；基类不兼容时返回 null */
function fabricGoalExpr(base: EntityJavaBase, g: AiEntry): string | null {
  const spd = (key: string, dflt: number): string => fmtFloat(Number(g[key] ?? dflt))
  switch (g.type) {
    case 'swim':
      return 'new SwimGoal(this)'
    case 'panic':
      return base === 'MobEntity' ? null : `new EscapeDangerGoal(this, ${spd('speed', 1.5)})`
    case 'wander':
      return base === 'MobEntity' ? null : `new WanderAroundGoal(this, ${spd('speed', 0.8)})`
    case 'look_at':
      return `new LookAtEntityGoal(this, PlayerEntity.class, ${Number(g.range ?? 8)}.0f)`
    case 'melee_attack':
      // MeleeAttackGoal 构造参数为 PathAwareEntity，MobEntity 基类不兼容
      return base === 'MobEntity'
        ? null
        : `new MeleeAttackGoal(this, ${spd('speed', 1.0)}, ${g.pauseWhenIdle === true})`
    case 'eat_grass':
      return 'new EatGrassGoal(this)'
    case 'mate':
      return base === 'AnimalEntity' ? `new AnimalMateGoal(this, ${spd('speed', 1.0)})` : null
    case 'follow_parent':
      return base === 'AnimalEntity' ? `new FollowParentGoal(this, ${spd('speed', 1.0)})` : null
    // follow_target 需 TameableEntity、avoid_water 仅语义：跳过
    default:
      return null
  }
}

/** 翻译单个 targetSelector 目标；不兼容时返回 null */
function fabricTargetExpr(t: AiEntry): string | null {
  if (t.type === 'attack_player') {
    return 'new ActiveTargetGoal<>(this, PlayerEntity.class, true)'
  }
  return null
}

/** 实体属性 → Java .add 链（零值属性省略，交由原版默认） */
function fabricEntityAttrLines(e: EntitySchema): string[] {
  const a = e.attributes
  const lines = [
    `        .add(EntityAttributes.GENERIC_MAX_HEALTH, ${fmtFloat(a.maxHealth)})`,
    `        .add(EntityAttributes.GENERIC_MOVEMENT_SPEED, ${fmtFloat(a.movementSpeed)})`,
    `        .add(EntityAttributes.GENERIC_FOLLOW_RANGE, ${fmtFloat(a.followRange)})`
  ]
  if (a.attackDamage > 0)
    lines.push(`        .add(EntityAttributes.GENERIC_ATTACK_DAMAGE, ${fmtFloat(a.attackDamage)})`)
  if (a.armor > 0) lines.push(`        .add(EntityAttributes.GENERIC_ARMOR, ${fmtFloat(a.armor)})`)
  if (a.knockbackResistance > 0)
    lines.push(
      `        .add(EntityAttributes.GENERIC_KNOCKBACK_RESISTANCE, ${fmtFloat(a.knockbackResistance)})`
    )
  return lines
}

/** 实体主类 Java；geo=true 时实现 GeckoLib GeoEntity（动画控制器 + 实例缓存） */
export function fabricEntityJava(ctx: ModContext, e: EntitySchema, geo = false): string {
  return fabricEntityJavaWithController(ctx, e, geo, null)
}

/**
 * B1-2：带控制器状态机的实体主类。
 * controller 非空时按状态机生成谓词（创作者定义的「什么时候播什么」），
 * 空时回退既有 idle/walk 二态硬编码（无控制器实体的行为不变）。
 */
export function fabricEntityJavaWithController(
  ctx: ModContext,
  e: EntitySchema,
  geo: boolean,
  controller: ModelAnimationController | null
): string {
  const base = entityJavaBase(e)
  const cls = entityClassName(e)

  const goalLines: string[] = []
  for (const g of e.ai.goals) {
    const expr = fabricGoalExpr(base, g as unknown as AiEntry)
    if (expr) goalLines.push(`        this.goalSelector.add(${g.priority ?? 0}, ${expr});`)
  }
  for (const t of e.ai.targets) {
    const expr = fabricTargetExpr(t as unknown as AiEntry)
    if (expr) goalLines.push(`        this.targetSelector.add(${t.priority ?? 0}, ${expr});`)
  }

  const isAnimal = base === 'AnimalEntity'
  const imports = [
    `import ${ENTITY_BASE_IMPORT[base]};`,
    'import net.minecraft.entity.EntityType;',
    'import net.minecraft.entity.ai.goal.*;',
    'import net.minecraft.entity.attribute.DefaultAttributeContainer;',
    'import net.minecraft.entity.attribute.EntityAttributes;',
    'import net.minecraft.entity.player.PlayerEntity;',
    'import net.minecraft.world.World;'
  ]
  if (isAnimal) {
    imports.push(
      'import net.minecraft.entity.mob.MobEntity;',
      'import net.minecraft.entity.passive.PassiveEntity;',
      'import net.minecraft.item.ItemStack;',
      'import net.minecraft.server.world.ServerWorld;',
      'import org.jetbrains.annotations.Nullable;'
    )
  }
  if (geo) {
    imports.push(
      'import software.bernie.geckolib.animatable.GeoEntity;',
      'import software.bernie.geckolib.core.animatable.instance.AnimatableInstanceCache;',
      'import software.bernie.geckolib.core.animation.AnimatableManager;',
      'import software.bernie.geckolib.core.animation.Animation;',
      'import software.bernie.geckolib.core.animation.AnimationController;',
      'import software.bernie.geckolib.core.animation.AnimationState;',
      'import software.bernie.geckolib.core.animation.RawAnimation;',
      'import software.bernie.geckolib.core.object.PlayState;',
      'import software.bernie.geckolib.util.GeckoLibUtil;'
    )
    if (controller) {
      for (const imp of CTRL_PREDICATE_IMPORTS) {
        if (!imports.includes(imp)) imports.push(imp)
      }
    }
  }

  /** GeckoLib 动画钩子：有控制器状态机按状态机求值；无则 idle/walk 二态 */
  const geoBlocks =
    geo && controller
      ? buildGeoPredicateFromController(cls, e, controller)
      : `
    private final AnimatableInstanceCache geoCache = GeckoLibUtil.createInstanceCache(this);

    @Override
    public void registerControllers(AnimatableManager.ControllerRegistrar controllers) {
        controllers.add(new AnimationController<>(this, "controller", 0, this::geoPredicate));
    }

    private PlayState geoPredicate(AnimationState<${cls}> state) {
        if (state.isMoving()) {
            state.getController().setAnimation(
                RawAnimation.begin().then("animation.${e.id}.walk", Animation.LoopType.LOOP));
        } else {
            state.getController().setAnimation(
                RawAnimation.begin().then("animation.${e.id}.idle", Animation.LoopType.LOOP));
        }
        return PlayState.CONTINUE;
    }

    @Override
    public AnimatableInstanceCache getAnimatableInstanceCache() {
        return this.geoCache;
    }
`

  const animalMethods = `
    @Override
    public boolean isBreedingItem(ItemStack stack) {
        return false;
    }

    @Nullable
    @Override
    public PassiveEntity createChild(ServerWorld world, PassiveEntity entity) {
        return null;
    }
`

  return `package ${ctx.packageName}.entity;

${imports.join('\n')}

/**
 * ${GENERATED_BANNER}
 */
public class ${cls} extends ${base}${geo ? ' implements GeoEntity' : ''} {
    public ${cls}(EntityType<? extends ${base}> type, World world) {
        super(type, world);
    }

    @Override
    protected void initGoals() {
${goalLines.join('\n') || '        // 无 AI 目标'}
    }

    public static DefaultAttributeContainer.Builder createAttributes() {
        return ${ENTITY_ATTR_FACTORY[base]}()
${fabricEntityAttrLines(e).join('\n')};
    }
${isAnimal ? animalMethods : ''}${geo ? geoBlocks : ''}}
`
}

interface CuboidSpec {
  uv0: number
  uv1: number
  x: number
  y: number
  z: number
  sx: number
  sy: number
  sz: number
}

/** cube elements（贴图像素单位）→ 实体 cuboid（16 像素单位，根部件 pivot 8,24,8） */
function elementsToCuboids(elements: CubeElement[], canvasSize: number): CuboidSpec[] {
  // 强制 box-uv 布局，保证 cuboid(u,v) 与贴图像素精确对应
  const laid = autoUvAllBox(elements, canvasSize)
  const k = 16 / canvasSize
  return laid.map((el) => {
    const [fx, fy, fz] = el.from
    const [tx, ty, tz] = el.to
    const dz = Math.max(0, tz - fz)
    const north = el.faces.north?.uv
    // box 布局中 north = [x+dz, y+dz, ...]，cuboid 原点回退 dz
    const uv0 = north ? north[0] - dz : 0
    const uv1 = north ? north[1] - dz : 0
    return {
      uv0,
      uv1,
      x: fx * k - 8,
      y: 24 - ty * k,
      z: fz * k - 8,
      sx: (tx - fx) * k,
      sy: (ty - fy) * k,
      sz: dz * k
    }
  })
}

/** 实体模型类 Java：cube elements → ModelPartBuilder cuboid 链 */
export function fabricEntityModelJava(
  ctx: ModContext,
  e: EntitySchema,
  cube: { textureSize: number; elements: CubeElement[] }
): string {
  const cls = `${pascal(e.id)}Model`
  const entCls = entityClassName(e)
  const cuboids = elementsToCuboids(cube.elements, cube.textureSize)
  const childLines = cuboids
    .map(
      (c, i) =>
        `        partData.addChild("part${i}",
            ModelPartBuilder.create()
                .uv(${c.uv0}, ${c.uv1})
                .cuboid(${[c.x, c.y, c.z, c.sx, c.sy, c.sz].map(fmtFloat).join(', ')}),
            ModelTransform.pivot(8.0f, 24.0f, 8.0f));`
    )
    .join('\n')

  return `package ${ctx.packageName}.entity;

import net.minecraft.client.model.ModelData;
import net.minecraft.client.model.ModelPart;
import net.minecraft.client.model.ModelPartBuilder;
import net.minecraft.client.model.ModelPartData;
import net.minecraft.client.model.ModelTransform;
import net.minecraft.client.model.TexturedModelData;
import net.minecraft.client.render.VertexConsumer;
import net.minecraft.client.render.entity.model.EntityModel;
import net.minecraft.client.util.math.MatrixStack;

/**
 * ${GENERATED_BANNER}
 */
public class ${cls} extends EntityModel<${entCls}> {
    private final ModelPart root;

    public ${cls}(ModelPart root) {
        this.root = root;
    }

    public static TexturedModelData getTexturedModelData() {
        ModelData modelData = new ModelData();
        ModelPartData partData = modelData.getRoot();
${childLines}
        return TexturedModelData.of(modelData, ${cube.textureSize}, ${cube.textureSize});
    }

    @Override
    public void setAngles(${entCls} entity, float limbAngle, float limbDistance,
                           float animationProgress, float yaw, float pitch) {
    }

    @Override
    public void render(MatrixStack matrices, VertexConsumer vertices, int light, int overlay,
                       float red, float green, float blue, float alpha) {
        this.root.render(matrices, vertices, light, overlay, red, green, blue, alpha);
    }
}
`
}

/** 实体渲染器类 Java */
export function fabricEntityRendererJava(ctx: ModContext, e: EntitySchema): string {
  const cls = `${pascal(e.id)}Renderer`
  const entCls = entityClassName(e)
  const modelCls = `${pascal(e.id)}Model`
  const layerConst = `${toJavaConst(e.id)}_LAYER`
  return `package ${ctx.packageName}.entity;

import ${ctx.packageName}.${ctx.modClassName}Client;
import net.minecraft.client.render.entity.EntityRendererFactory;
import net.minecraft.client.render.entity.MobEntityRenderer;
import net.minecraft.util.Identifier;

/**
 * ${GENERATED_BANNER}
 */
public class ${cls} extends MobEntityRenderer<${entCls}, ${modelCls}> {
    private static final Identifier TEXTURE =
        new Identifier("${ctx.modId}", "textures/entity/${e.id}.png");

    public ${cls}(EntityRendererFactory.Context context) {
        super(context, new ${modelCls}(context.getPart(${ctx.modClassName}Client.${layerConst})), 0.5f);
    }

    @Override
    public Identifier getTexture(${entCls} entity) {
        return TEXTURE;
    }
}
`
}

/** GeckoLib 实体模型类 Java：GeoModel 三资源定位（geo / 贴图 / 动画） */
export function fabricGeoModelJava(ctx: ModContext, e: EntitySchema): string {
  const cls = `${pascal(e.id)}GeoModel`
  const entCls = entityClassName(e)
  return `package ${ctx.packageName}.entity;

import net.minecraft.util.Identifier;
import software.bernie.geckolib.model.GeoModel;

/**
 * ${GENERATED_BANNER}
 */
public class ${cls} extends GeoModel<${entCls}> {
    private static final Identifier MODEL =
        new Identifier("${ctx.modId}", "geo/entity/${e.id}.geo.json");
    private static final Identifier TEXTURE =
        new Identifier("${ctx.modId}", "textures/entity/${e.id}.png");
    private static final Identifier ANIMATION =
        new Identifier("${ctx.modId}", "animations/entity/${e.id}.animation.json");

    @Override
    public Identifier getModelResource(${entCls} animatable) {
        return MODEL;
    }

    @Override
    public Identifier getTextureResource(${entCls} animatable) {
        return TEXTURE;
    }

    @Override
    public Identifier getAnimationResource(${entCls} animatable) {
        return ANIMATION;
    }
}
`
}

/** GeckoLib 实体渲染器类 Java（无 EntityModelLayer，直接装配 GeoModel） */
export function fabricGeoRendererJava(ctx: ModContext, e: EntitySchema): string {
  const cls = `${pascal(e.id)}Renderer`
  const entCls = entityClassName(e)
  const modelCls = `${pascal(e.id)}GeoModel`
  return `package ${ctx.packageName}.entity;

import net.minecraft.client.render.entity.EntityRendererFactory;
import software.bernie.geckolib.renderer.GeoEntityRenderer;

/**
 * ${GENERATED_BANNER}
 */
public class ${cls} extends GeoEntityRenderer<${entCls}> {
    public ${cls}(EntityRendererFactory.Context context) {
        super(context, new ${modelCls}());
    }
}
`
}

/** ModEntities 注册类 Java（EntityType + 默认属性） */
export function fabricModEntitiesJava(ctx: ModContext, entities: EntitySchema[]): string {
  const entityRegConst = registriesConst(ctx.mcVersion, 'ENTITY_TYPE')
  const fields = entities
    .map((e) => {
      const entCls = entityClassName(e)
      const group = e.properties.spawnGroup || 'MISC'
      const extras = [`            .trackRangeBlocks(${e.properties.trackingRange ?? 8})`]
      if (e.properties.fireImmune) extras.push('            .fireImmune()')
      // Identifier 统一走主类 id() 助手（P0-1：直写 new Identifier 在 1.21+ 编译失败——构造器已私有化）
      return `    public static final EntityType<${entCls}> ${toJavaConst(e.id)} = Registry.register(
        ${entityRegConst},
        ${ctx.modClassName}.id("${e.id}"),
        FabricEntityTypeBuilder.create(SpawnGroup.${group}, ${entCls}::new)
            .dimensions(EntityDimensions.fixed(${fmtFloat(e.properties.width)}, ${fmtFloat(e.properties.height)}))
${extras.join('\n')}
            .build()
    );`
    })
    .join('\n\n')

  const regs = entities
    .map(
      (e) =>
        `        FabricDefaultAttributeRegistry.register(${toJavaConst(e.id)}, ${entityClassName(e)}.createAttributes());`
    )
    .join('\n')

  return `package ${ctx.packageName}.registry;

import ${ctx.packageName}.${ctx.modClassName};
import ${ctx.packageName}.entity.*;
import net.fabricmc.fabric.api.object.builder.v1.entity.FabricDefaultAttributeRegistry;
import net.fabricmc.fabric.api.object.builder.v1.entity.FabricEntityTypeBuilder;
import net.minecraft.entity.EntityDimensions;
import net.minecraft.entity.EntityType;
import net.minecraft.entity.SpawnGroup;
${registryImports(ctx.mcVersion)}import net.minecraft.util.Identifier;

/**
 * ${GENERATED_BANNER}
 */
public class ModEntities {
${fields}

    public static void register() {
${regs}
    }
}
`
}

/** 客户端入口 Java：实体渲染器注册；仅 custom 实体需要模型层，geo 实体直接装配 */
export function fabricClientJava(
  ctx: ModContext,
  entities: EntitySchema[],
  geoEntities: EntitySchema[] = [],
  customClassEntities: EntitySchema[] = []
): string {
  const cls = `${ctx.modClassName}Client`
  // customClass 实体（无 cube 资产）与 cube 实体共用「模型层 + 渲染器」链路：前者用内置占位模型，
  // 后者用 cube 元素模型；两者都必须注册模型层，否则渲染器取不到 part（运行期崩/实体不可见）。
  const modelEntities = [...entities, ...customClassEntities]
  const entityImports = [
    ...modelEntities.map(
      (e) =>
        `import ${ctx.packageName}.entity.${pascal(e.id)}Model;\nimport ${ctx.packageName}.entity.${pascal(e.id)}Renderer;`
    ),
    ...geoEntities.map(
      (e) =>
        `import ${ctx.packageName}.entity.${pascal(e.id)}GeoModel;\nimport ${ctx.packageName}.entity.${pascal(e.id)}Renderer;`
    )
  ].join('\n')
  const layerFields = modelEntities
    .map(
      (e) =>
        `    public static final EntityModelLayer ${toJavaConst(e.id)}_LAYER =
        new EntityModelLayer(new Identifier("${ctx.modId}", "${e.id}"), "main");`
    )
    .join('\n')
  const rendererRegs = [...modelEntities, ...geoEntities]
    .map(
      (e) =>
        `        EntityRendererRegistry.register(ModEntities.${toJavaConst(e.id)}, ${pascal(e.id)}Renderer::new);`
    )
    .join('\n')
  const layerRegs = modelEntities
    .map(
      (e) =>
        `        EntityModelLayerRegistry.registerModelLayer(${toJavaConst(e.id)}_LAYER, ${pascal(e.id)}Model::getTexturedModelData);`
    )
    .join('\n')

  // geo 实体无模型层：仅在存在模型实体时引入模型层相关 import
  const layerImports =
    modelEntities.length > 0
      ? `import net.fabricmc.fabric.api.client.rendering.v1.EntityModelLayerRegistry;
import net.minecraft.client.render.entity.model.EntityModelLayer;
import net.minecraft.util.Identifier;`
      : ''

  return `package ${ctx.packageName};

${entityImports}
import ${ctx.packageName}.registry.ModEntities;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.rendering.v1.EntityRendererRegistry;
${layerImports}

/**
 * ${GENERATED_BANNER}
 */
public class ${cls} implements ClientModInitializer {
${layerFields}

    @Override
    public void onInitializeClient() {
${rendererRegs}
${layerRegs}
    }
}
`
}

/**
 * AI 自定义类实体的占位模型：单个方形柱体（X/Z 对称，不依赖 yaw 旋转即可正常显示，
 * 且只用各版本通用 API，跨 MC 版本稳定）。AI 可用 write_project_file 覆盖为正式模型。
 */
export function fabricFallbackModelJava(ctx: ModContext, e: EntitySchema): string {
  const cls = `${pascal(e.id)}Model`
  const entCls = entityClassName(e)
  return `package ${ctx.packageName}.entity;

import net.minecraft.client.model.ModelData;
import net.minecraft.client.model.ModelPart;
import net.minecraft.client.model.ModelPartBuilder;
import net.minecraft.client.model.ModelPartData;
import net.minecraft.client.model.ModelTransform;
import net.minecraft.client.model.TexturedModelData;
import net.minecraft.client.render.VertexConsumer;
import net.minecraft.client.render.entity.model.EntityModel;
import net.minecraft.client.util.math.MatrixStack;

/**
 * ${GENERATED_BANNER}
 */
public class ${cls} extends EntityModel<${entCls}> {
    private final ModelPart root;

    public ${cls}(ModelPart root) {
        this.root = root;
    }

    public static TexturedModelData getTexturedModelData() {
        ModelData modelData = new ModelData();
        ModelPartData partData = modelData.getRoot();
        partData.addChild("body",
            ModelPartBuilder.create().uv(0, 0).cuboid(-7.0f, 0.0f, -7.0f, 14.0f, 26.0f, 14.0f),
            ModelTransform.pivot(0.0f, 0.0f, 0.0f));
        return TexturedModelData.of(modelData, 64, 64);
    }

    @Override
    public void setAngles(${entCls} entity, float limbAngle, float limbDistance,
                           float animationProgress, float yaw, float pitch) {
    }

    @Override
    public void render(MatrixStack matrices, VertexConsumer vertices, int light, int overlay,
                       float red, float green, float blue, float alpha) {
        this.root.render(matrices, vertices, light, overlay, red, green, blue, alpha);
    }
}
`
}

/**
 * AI 自定义类实体的占位渲染器：无 cube 模型时生成，渲染上面的占位模型（实体可见，可召唤）。
 * 之前版本仅继承 EntityRenderer 且不绘制任何几何体，导致实体「已注册但看不见」。
 */
export function fabricFallbackRendererJava(ctx: ModContext, e: EntitySchema): string {
  const entCls = entityClassName(e)
  const rdrCls = `${pascal(e.id)}Renderer`
  const modelCls = `${pascal(e.id)}Model`
  const layerConst = `${toJavaConst(e.id)}_LAYER`
  return `package ${ctx.packageName}.entity;

import ${ctx.packageName}.${ctx.modClassName}Client;
import net.fabricmc.api.EnvType;
import net.fabricmc.api.Environment;
import net.minecraft.client.render.OverlayTexture;
import net.minecraft.client.render.RenderLayer;
import net.minecraft.client.render.VertexConsumer;
import net.minecraft.client.render.VertexConsumerProvider;
import net.minecraft.client.render.entity.EntityRenderer;
import net.minecraft.client.render.entity.EntityRendererFactory;
import net.minecraft.client.util.math.MatrixStack;
import net.minecraft.util.Identifier;

/**
 * ${GENERATED_BANNER}
 */
@Environment(EnvType.CLIENT)
public class ${rdrCls} extends EntityRenderer<${entCls}> {
    private static final Identifier TEXTURE = new Identifier("${ctx.modId}", "textures/entity/${e.id}.png");
    private final ${modelCls} model;

    public ${rdrCls}(EntityRendererFactory.Context context) {
        super(context);
        this.model = new ${modelCls}(context.getPart(${ctx.modClassName}Client.${layerConst}));
    }

    @Override
    public Identifier getTexture(${entCls} entity) {
        return TEXTURE;
    }

    @Override
    public void render(${entCls} entity, float yaw, float tickDelta, MatrixStack matrices,
                       VertexConsumerProvider vertexConsumers, int light) {
        matrices.push();
        matrices.scale(-1.0f, -1.0f, 1.0f);
        matrices.translate(0.0f, -1.501f, 0.0f);
        VertexConsumer vertices = vertexConsumers.getBuffer(RenderLayer.getEntityCutoutNoCull(TEXTURE));
        this.model.render(matrices, vertices, light, OverlayTexture.DEFAULT_UV, 1.0f, 1.0f, 1.0f, 1.0f);
        matrices.pop();
        super.render(entity, yaw, tickDelta, matrices, vertexConsumers, light);
    }
}
`
}

/** 取实体的 cube 模型数据（优先 cubeModelId 绑定资产，其次内嵌 renderer.cubeModel） */
export function resolveEntityCube(
  e: EntitySchema,
  modelMap: Map<string, ModelAsset>
): { textureSize: number; pixels: string[]; elements: CubeElement[] } | null {
  const bound = e.cubeModelId ? modelMap.get(e.cubeModelId) : undefined
  if (bound) {
    return { textureSize: bound.textureSize, pixels: bound.pixels, elements: bound.elements }
  }
  const embedded = e.renderer.cubeModel
  if (embedded) {
    return {
      textureSize: embedded.textureSize,
      pixels: embedded.pixels,
      elements: embedded.elements
    }
  }
  return null
}

/** 取实体的 GeckoLib 几何（modelType=blockbench_geo 且内嵌 geoJson 可解析）；非法 geoJson 抛错 */
export function resolveEntityGeo(e: EntitySchema): ReturnType<typeof parseGeoModelInfo> | null {
  if (e.renderer.modelType !== 'blockbench_geo') return null
  const raw = e.renderer.geoJson
  if (typeof raw !== 'string' || !raw.trim()) return null
  return parseGeoModelInfo(raw)
}

/** GeckoLib 版本（fabric-1.20.1 通道；注入 gradle.properties 的 geckolib_version） */
export const GECKOLIB_VERSION = '4.4.9'

/** GeckoLib 织入标记（build.gradle / gradle.properties 幂等增删识别用） */
const GECKO_MARK = '// kunyu:geckolib'

/**
 * GeckoLib 依赖织入（P2）：项目含 blockbench_geo 实体时，
 * 幂等向 build.gradle 注入 cloudsmith maven + modImplementation，
 * 向 gradle.properties 注入 geckolib_version；
 * 无 geo 实体时按标记移除全部织入痕迹。（fabric.mod.json depends 由 syncFabricModJson 一并织入）
 */
export function syncFabricGeckolib(
  root: string,
  geoEntities: EntitySchema[],
  sink: GenSink
): void {
  const want = geoEntities.length > 0
  const mavenLine = `    maven { url = 'https://dl.cloudsmith.io/public/geckolib3/geckolib/maven/' } ${GECKO_MARK}`
  const depLine = `    modImplementation "software.bernie.geckolib:geckolib-fabric-1.20.1:\${project.geckolib_version}" ${GECKO_MARK}`

  // build.gradle
  const gradlePath = join(root, 'build.gradle')
  let gradle = existsSync(gradlePath) ? readFileSync(gradlePath, 'utf-8') : ''
  if (gradle.trim()) {
    const had = gradle.includes(GECKO_MARK)
    if (want && !had) {
      // repositories/dependencies 块尾插入。块内行可能含内联 `}`（maven { url '...' }
      // 或 ${project.xxx} 占位），`[^}]*` 会错把首个内联 `}` 当块尾截断插入点
      // （m_fab1201 实测：cloudsmith 织进 aliyun maven 行内、geckolib 织进 minecraft
      // 依赖行内，构建直接报 "Cannot invoke method maven() on null object"）。
      // 模板约定块尾 `}` 恒在行首，故用非贪婪匹配 + ^\} 锚定真块尾。
      gradle = gradle.replace(/(repositories\s*\{[\s\S]*?)(^\})/m, `$1${mavenLine}\n$2`)
      gradle = gradle.replace(/(dependencies\s*\{[\s\S]*?)(^\})/m, `$1${depLine}\n$2`)
    } else if (!want && had) {
      gradle = gradle
        .split('\n')
        .filter((l) => !l.includes(GECKO_MARK))
        .join('\n')
    }
    sink.text(gradlePath, gradle)
  }

  // gradle.properties
  const propsPath = join(root, 'gradle.properties')
  let props = existsSync(propsPath) ? readFileSync(propsPath, 'utf-8') : ''
  if (props.trim()) {
    const propLine = `\n# GeckoLib（骨骼动画实体依赖，kunyu:geckolib）\ngeckolib_version=${GECKOLIB_VERSION}\n`
    const had = /^geckolib_version\s*=/m.test(props)
    if (want && !had) props = props.endsWith('\n') ? props + propLine.slice(1) : props + propLine
    else if (!want && had) {
      props = props
        .split('\n')
        .filter((l) => !l.startsWith('geckolib_version=') && !l.includes('kunyu:geckolib'))
        .join('\n')
    }
    sink.text(propsPath, props)
  }
}
