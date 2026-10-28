/**
 * 集成监测：freeform 实体自由代码流水线（盗贼样板，fabric/1.20.1）。
 *
 * 背景：实体/生物域存在能力缺口——内置 AI Goal 目录（近战/闲逛/注视/跟随等）
 * 无法表达「与容器交互/多阶段状态机/条件触发特殊行为」等目录外自定义行为，
 * 需允许 agent 直写实体类/自定义 Goal/渲染器（对标 AutoMods 的自由代码路线，
 * 与 schema 确定性生成双轨并存）。盗贼仅作样板与验收参照，核心是补域能力。
 *
 * 验证点：
 * 1. understand 提示词含 entityMode 条件路由规则；PLAN 带 entityMode:'freeform' 时
 *    generate 系统提示词注入「实体自由代码模式」放行文案
 * 2. 5 个目录外 Java 文件（实体类/自定义 Goal×2/渲染器/客户端入口注册）全部 accepted
 * 3. build/test 阶段 running→done，流水线不自动导出
 * 4. .java 花括号校验：截断文件被安全闸门拒收（不落盘），拒收原因并入缺口清单并随
 *    补救轮定向回灌给模型（根治「自定义类不落盘 → 注册链断裂 → 进游戏内容缺失」）；
 *    补救耗尽仍不闭合则判定失败、不进入构建（不产假绿灯）
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

vi.mock('../../settingsService', () => ({
  getSection: (section: string) => {
    if (section !== 'ai') return { globalJdkHome: null }
    const ov = { providerId: null, model: null }
    return {
      providers: [
        {
          id: 'p1', name: 'p1', kind: 'openai-compatible', baseUrl: 'http://x',
          apiKey: '', apiKeyUrl: '', model: 'm1', maxTokens: 4096,
          temperature: 0.7, enabled: true
        }
      ],
      defaultProviderId: 'p1',
      tierModels: { sprinter: ov, artisan: ov, master: ov, bridge: ov, weaver: ov },
      manualLock: { tier: null, source: null, lockedAt: null },
      visualReviewEnabled: false,
      entityFreeformEnabled: true, // 本测试专验实体级 freeform 流水线，显式开启
      globalFreeformEnabled: false // 全局开关关闭，验证实体级独立生效
    }
  }
}))
vi.mock('../../projectService', () => ({ openProject: () => null }))
// kunyu-observer 探针在线桩：test 阶段走真机探针通道到 connected-ok
vi.mock('../../observer/observerClient', () => ({
  probeObserver: () =>
    Promise.resolve({
      port: 9876,
      health: { ok: true, mod: 'kunyu-observer-agent', version: '2.1.0-agent', minecraft: '1.20.1', protocol: 3, inGame: true }
    }),
  fetchPlayerState: () =>
    Promise.resolve({ name: 'Steve', x: 0, y: 64, z: 0, gameMode: 'creative', dimension: 'minecraft:overworld' }),
  fetchScreenshot: () =>
    Promise.resolve({ dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' })
}))

import { createOrchestrator } from '../orchestrator'
import type { AgentEvent } from '../../../../shared/types/agent'
import type { AiChatRequest, AiChatResponse } from '../../../../shared/types/ai'
import type { McpClient } from '../mcpClient'
import type { ReferenceService } from '../referencePackageService'
import type { ContextBuilder } from '../contextBuilder'
import type { GradleEvent, GradleRunInput } from '../../../../shared/types/build'

const PLAN = JSON.stringify({
  intent: 'code',
  contentTypes: ['entity'],
  entityMode: 'freeform',
  stages: ['generate', 'build', 'test'],
  goal: '新增会开箱取物并携赃逃跑的自定义行为实体'
})

/* ------------------------------------------------------------------ */
/* 盗贼样板 5 文件（目录外自定义行为：实体类/Goal×2/渲染器/入口注册）   */
/* ------------------------------------------------------------------ */

const THIEF_ENTITY = `package com.example.thief;

import net.minecraft.entity.EntityType;
import net.minecraft.entity.SpawnGroup;
import net.minecraft.entity.mob.PathAwareEntity;
import net.minecraft.world.World;
import com.example.thief.ai.ContainerInteractionGoal;
import com.example.thief.ai.StatefulFleeGoal;

public class ThiefEntity extends PathAwareEntity {
    public static EntityType<ThiefEntity> THIEF;

    public ThiefEntity(EntityType<? extends PathAwareEntity> type, World world) {
        super(type, world);
    }

    @Override
    protected void initGoals() {
        super.initGoals();
        this.goalSelector.add(1, new ContainerInteractionGoal(this));
        this.goalSelector.add(2, new StatefulFleeGoal(this));
    }
}
`

const CONTAINER_GOAL = `package com.example.thief.ai;

import com.example.thief.ThiefEntity;
import net.minecraft.block.entity.BlockEntity;
import net.minecraft.block.entity.LockableContainerBlockEntity;
import net.minecraft.entity.ai.goal.Goal;
import net.minecraft.inventory.Inventory;
import net.minecraft.item.ItemStack;
import net.minecraft.util.math.BlockPos;
import net.minecraft.world.World;

import java.util.EnumSet;

public class ContainerInteractionGoal extends Goal {
    private final ThiefEntity entity;
    private BlockPos targetPos;
    private int cooldown;

    public ContainerInteractionGoal(ThiefEntity entity) {
        this.entity = entity;
        this.setControls(EnumSet.of(Goal.Control.MOVE));
    }

    @Override
    public boolean canStart() {
        if (this.cooldown > 0) {
            this.cooldown--;
            return false;
        }
        this.targetPos = this.findContainer();
        return this.targetPos != null;
    }

    @Override
    public boolean shouldContinue() {
        return this.targetPos != null;
    }

    @Override
    public void start() {
        this.entity.getNavigation().startMovingTo(
            this.targetPos.getX(), this.targetPos.getY(), this.targetPos.getZ(), 1.0);
    }

    @Override
    public void tick() {
        if (this.targetPos == null) return;
        if (this.entity.getBlockPos().isWithinDistance(this.targetPos, 2.0)) {
            this.takeOneStack();
            this.targetPos = null;
            this.cooldown = 200;
        }
    }

    private BlockPos findContainer() {
        World world = this.entity.getWorld();
        BlockPos origin = this.entity.getBlockPos();
        for (BlockPos pos : BlockPos.iterate(origin.add(-8, -2, -8), origin.add(8, 2, 8))) {
            BlockEntity be = world.getBlockEntity(pos);
            if (be instanceof LockableContainerBlockEntity) {
                return pos.toImmutable();
            }
        }
        return null;
    }

    private void takeOneStack() {
        BlockEntity be = this.entity.getWorld().getBlockEntity(this.targetPos);
        if (be instanceof Inventory inventory) {
            for (int slot = 0; slot < inventory.size(); slot++) {
                ItemStack stack = inventory.getStack(slot);
                if (!stack.isEmpty()) {
                    inventory.removeStack(slot, Math.min(stack.getCount(), 4));
                    inventory.markDirty();
                    return;
                }
            }
        }
    }
}
`

const FLEE_GOAL = `package com.example.thief.ai;

import com.example.thief.ThiefEntity;
import net.minecraft.entity.ai.goal.Goal;
import net.minecraft.entity.player.PlayerEntity;

import java.util.EnumSet;

public class StatefulFleeGoal extends Goal {
    private enum Stage { IDLE, ALERTED, FLEEING }

    private final ThiefEntity entity;
    private Stage stage = Stage.IDLE;
    private int fleeTicks;

    public StatefulFleeGoal(ThiefEntity entity) {
        this.entity = entity;
        this.setControls(EnumSet.of(Goal.Control.MOVE));
    }

    @Override
    public boolean canStart() {
        PlayerEntity nearest = this.entity.getWorld().getClosestPlayer(this.entity, 6.0);
        if (nearest != null && this.stage == Stage.IDLE) {
            this.stage = Stage.ALERTED;
            return true;
        }
        return false;
    }

    @Override
    public boolean shouldContinue() {
        return this.stage != Stage.IDLE && this.fleeTicks < 100;
    }

    @Override
    public void start() {
        this.stage = Stage.FLEEING;
        this.fleeTicks = 0;
    }

    @Override
    public void tick() {
        this.fleeTicks++;
        PlayerEntity nearest = this.entity.getWorld().getClosestPlayer(this.entity, 16.0);
        if (nearest != null) {
            double dx = this.entity.getX() - nearest.getX();
            double dz = this.entity.getZ() - nearest.getZ();
            this.entity.getNavigation().startMovingTo(
                this.entity.getX() + dx * 4, this.entity.getY(), this.entity.getZ() + dz * 4, 1.4);
        }
    }

    @Override
    public void stop() {
        this.stage = Stage.IDLE;
    }
}
`

const RENDERER = `package com.example.thief.client;

import com.example.thief.ThiefEntity;
import net.minecraft.client.render.entity.EntityRendererFactory;
import net.minecraft.client.render.entity.MobEntityRenderer;
import net.minecraft.client.render.entity.model.BipedEntityModel;
import net.minecraft.util.Identifier;

public class ThiefEntityRenderer extends MobEntityRenderer<ThiefEntity, BipedEntityModel<ThiefEntity>> {
    public ThiefEntityRenderer(EntityRendererFactory.Context context, BipedEntityModel<ThiefEntity> model, float shadowRadius) {
        super(context, model, shadowRadius);
    }

    @Override
    public Identifier getTexture(ThiefEntity entity) {
        return new Identifier("kunyu", "textures/entity/thief.png");
    }
}
`

const CLIENT_ENTRY = `package com.example.thief.client;

import com.example.thief.ThiefEntity;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.rendering.v1.EntityRendererRegistry;
import net.fabricmc.fabric.api.client.rendering.v1.EntityModelLayerRegistry;
import net.minecraft.client.render.entity.model.BipedEntityModel;
import net.minecraft.client.render.entity.model.EntityModelLayer;
import net.minecraft.client.model.TexturedModelData;
import net.minecraft.util.Identifier;

public class ThiefClientModInitializer implements ClientModInitializer {
    public static final EntityModelLayer THIEF_LAYER =
        new EntityModelLayer(new Identifier("kunyu", "thief"), "main");

    @Override
    public void onInitializeClient() {
        EntityModelLayerRegistry.registerModelLayer(THIEF_LAYER,
            () -> TexturedModelData.of(BipedEntityModel.getModelData(0.0f, 0.0f), 64, 64));
        EntityRendererRegistry.register(ThiefEntity.THIEF,
            context -> new ThiefEntityRenderer(context, new BipedEntityModel<>(context.getPart(THIEF_LAYER)), 0.5f));
    }
}
`

const CODER = JSON.stringify({
  files: [
    {
      path: 'src/main/java/com/example/thief/ThiefEntity.java',
      action: 'create',
      content: THIEF_ENTITY
    },
    {
      path: 'src/main/java/com/example/thief/ai/ContainerInteractionGoal.java',
      action: 'create',
      content: CONTAINER_GOAL
    },
    {
      path: 'src/main/java/com/example/thief/ai/StatefulFleeGoal.java',
      action: 'create',
      content: FLEE_GOAL
    },
    {
      path: 'src/main/java/com/example/thief/client/ThiefEntityRenderer.java',
      action: 'create',
      content: RENDERER
    },
    {
      path: 'src/main/java/com/example/thief/client/ThiefClientModInitializer.java',
      action: 'modify',
      content: CLIENT_ENTRY
    }
  ],
  notes: '盗贼样板：实体类 + 容器交互 Goal + 状态机逃跑 Goal + 渲染器 + 客户端入口注册'
})

function makeChat(requests: AiChatRequest[]) {
  let n = 0
  const chat = (req: AiChatRequest): Promise<AiChatResponse> => {
    requests.push(req)
    n += 1
    const content = n === 1 ? PLAN : CODER
    return Promise.resolve({ content } as AiChatResponse)
  }
  return chat
}

function makeReference(): ReferenceService {
  return {
    getSystemPromptBase: () => '',
    listMatrixCells: () => [
      {
        id: 'fabric-1.20.1',
        loader: 'fabric',
        mcVersion: '1.20.1',
        loaderVersion: '0.15.11',
        mapping: 'yarn',
        jdk: '17',
        health: 'ok',
        driftRisk: 'low',
        active: true,
        templateCount: 0,
        verifiedAt: null,
        note: ''
      }
    ],
    getFingerprint: () => null,
    findTemplates: () => [],
    findErrorPatterns: () => [],
    getApiIndex: () => null
  } as unknown as ReferenceService
}

function makeContextBuilder(): ContextBuilder {
  return {
    detectContentTypes: () => [],
    getTemplateContents: () => [],
    matchErrorPatterns: () => [],
    getErrorFixContext: () => ({ templates: [], patterns: [] }),
    getVersionFingerprint: () => '',
    getHealthStatus: () => 'ok',
    buildDriftWarning: () => '',
    buildMappingDeclaration: () => '',
    buildSystemPrompt: () => ''
  } as unknown as ContextBuilder
}

describe('orchestrator freeform 实体自由代码（盗贼样板，fabric/1.20.1）', () => {
  it('entityMode=freeform 放行直写：5 个目录外 Java 全 accepted，build/test 全阶段亮起', async () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'kunyu-thief-'))
    writeFileSync(join(projectDir, 'gradlew.bat'), '@echo off\r\n')
    mkdirSync(join(projectDir, 'build', 'libs'), { recursive: true })
    writeFileSync(join(projectDir, 'build', 'libs', 'thief-1.0.0.jar'), 'fake-jar')

    const events: AgentEvent[] = []
    const requests: AiChatRequest[] = []
    const gradleCalls: GradleRunInput[] = []

    const runGradle = (input: GradleRunInput, sink: (e: GradleEvent) => void): string => {
      gradleCalls.push(input)
      const runId = `gradle-${gradleCalls.length}`
      setTimeout(() => {
        sink({ type: 'phase', phase: 'done', runId, exitCode: 0, cancelled: false, timedOut: false } as GradleEvent)
      }, 5)
      return runId
    }

    const orchestrator = createOrchestrator({
      chat: makeChat(requests),
      mcp: {
        isEnabled: () => false,
        getStatus: () => ({ kind: 'disabled' }),
        callStaticTool: () => Promise.reject(new Error('disabled'))
      } as unknown as McpClient,
      reference: makeReference(),
      contextBuilder: makeContextBuilder(),
      runGradle,
      gradleBusy: () => false,
      resolveProject: (id) =>
        id === 'p1'
          ? {
              id: 'p1',
              name: 'thief',
              path: projectDir,
              type: 'mod',
              mcVersion: '1.20.1',
              loader: 'fabric',
              loaderVersion: '0.15.11'
            }
          : null,
      writeFile: () => undefined,
      idFactory: () => 'run-thief'
    })

    const result = await orchestrator.run(
      {
        message: '做一个会开箱偷东西、被玩家发现就逃跑的盗贼生物',
        projectId: 'p1',
        loader: 'fabric',
        mcVersion: '1.20.1'
      },
      (e) => events.push(e)
    )

    // ===== 1. 条件路由：understand 提示词含 entityMode 判定规则 =====
    expect(requests.length).toBeGreaterThanOrEqual(2)
    expect(JSON.stringify(requests[0])).toContain('entityMode')
    expect(JSON.stringify(requests[0])).toContain('freeform')

    // ===== 2. freeform 放行文案注入 generate 系统提示词 =====
    expect(JSON.stringify(requests[1])).toContain('【实体自由代码模式】')

    // ===== 3. 5 个目录外 Java 文件全部 accepted，且无 lint 警告 =====
    expect(result.files).toHaveLength(5)
    for (const f of result.files) {
      expect(f.accepted).toBe(true)
      expect(f.reason).toBeUndefined()
      expect(f.path).toMatch(/^src\/main\/java\/.+\.java$/)
    }
    // 动作透传：客户端入口为 modify，其余 create
    const entry = result.files.find((f) => f.path.endsWith('ThiefClientModInitializer.java'))
    expect(entry?.action).toBe('modify')

    // ===== 4. build/test 全阶段亮起，流水线不自动导出 =====
    expect(gradleCalls.length).toBeGreaterThan(0)
    expect(result.build?.status).toBe('pass')

    const buildPhases = events.filter((e) => e.stage === 'build' && e.type === 'phase')
    expect(buildPhases.some((e) => e.phase === 'running')).toBe(true)
    expect(buildPhases.some((e) => e.phase === 'done')).toBe(true)
    expect(buildPhases.some((e) => e.phase === 'skipped')).toBe(false)

    const testPhases = events.filter((e) => e.stage === 'test' && e.type === 'phase')
    expect(testPhases.some((e) => e.phase === 'running')).toBe(true)
    expect(testPhases.some((e) => e.phase === 'done')).toBe(true)

    expect(result.export).toBeNull()
    expect(events.filter((e) => e.stage === 'export')).toHaveLength(0)

    // ===== 5. 时序：build.done 先于最终回复 =====
    const seqOf = (pred: (e: AgentEvent) => boolean) =>
      events.find(pred)?.seq ?? Number.POSITIVE_INFINITY
    const buildDoneSeq = seqOf((e) => e.stage === 'build' && e.phase === 'done')
    const replySeq = seqOf((e) => e.type === 'reply')
    expect(buildDoneSeq).toBeLessThan(replySeq)
  }, 15000)

  it('.java 截断：花括号不平衡被拒收，原因随补救轮定向回灌，判定失败不进构建', async () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'kunyu-thief-lint-'))
    writeFileSync(join(projectDir, 'gradlew.bat'), '@echo off\r\n')

    const events: AgentEvent[] = []
    const gradleCalls: GradleRunInput[] = []

    const runGradle = (input: GradleRunInput, sink: (e: GradleEvent) => void): string => {
      gradleCalls.push(input)
      const runId = `gradle-${gradleCalls.length}`
      setTimeout(() => {
        sink({ type: 'phase', phase: 'done', runId, exitCode: 0, cancelled: false, timedOut: false } as GradleEvent)
      }, 5)
      return runId
    }

    // CODER 返一个花括号不平衡的 .java（缺 1 个 }）——lint 应警告但不拒收
    const brokenCoder = JSON.stringify({
      files: [
        {
          path: 'src/main/java/com/example/thief/Broken.java',
          action: 'create',
          content: 'package com.example.thief;\npublic class Broken {\n    void tick() {\n'
        }
      ],
      notes: '故意输出截断文件验证 lint 非阻塞'
    })
    const requests: AiChatRequest[] = []
    let n = 0
    const chat = (req: AiChatRequest): Promise<AiChatResponse> => {
      requests.push(req)
      n += 1
      return Promise.resolve({ content: n === 1 ? PLAN : brokenCoder } as AiChatResponse)
    }

    const orchestrator = createOrchestrator({
      chat,
      mcp: {
        isEnabled: () => false,
        getStatus: () => ({ kind: 'disabled' }),
        callStaticTool: () => Promise.reject(new Error('disabled'))
      } as unknown as McpClient,
      reference: makeReference(),
      contextBuilder: makeContextBuilder(),
      runGradle,
      gradleBusy: () => false,
      resolveProject: () => ({
        id: 'p1',
        name: 'thief',
        path: projectDir,
        type: 'mod',
        mcVersion: '1.20.1',
        loader: 'fabric',
        loaderVersion: '0.15.11'
      }),
      writeFile: () => undefined,
      idFactory: () => 'run-thief-lint'
    })

    const result = await orchestrator.run(
      {
        message: '做一个盗贼生物',
        projectId: 'p1',
        loader: 'fabric',
        mcVersion: '1.20.1'
      },
      (e) => events.push(e)
    )

    // 契约：截断 .java 被安全闸门拒收（不落盘），且拒收原因必须随补救轮定向回灌给模型
    // —— 这正是「自定义类不落盘 → 注册链断裂 → 进游戏内容缺失」的根治点。
    expect(requests.some((r) => JSON.stringify(r).includes('花括号不平衡'))).toBe(true)
    // 拒收事实如实回报调用方（含原因），供 UI / 排查使用
    expect(result.files[0]?.accepted).toBe(false)
    expect(result.files[0]?.reason).toContain('花括号不平衡')
    // 补救耗尽仍不闭合 → 判定失败：不进入构建（不产假绿灯）
    expect(gradleCalls.length).toBe(0)
    expect(result.build).toBeNull()
  }, 15000)
})
