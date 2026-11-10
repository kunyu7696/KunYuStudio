/**
 * Fabric 实体模型/渲染器的版本断档回归。
 *
 * 事故来源：Stage 1 全量跑（run 42735225665）在 fabric 1.21.1 上 javac 失败 5 处，
 * 而 1.20.1 / 1.21.11 / 26.3 都通过——说明这两处是 1.21.0~1.21.1 独有的断档：
 *  1) ModelPart.render 的浮点颜色重载（r,g,b,a）在这两版不存在（只剩 4 参 / int 颜色）；
 *  2) Identifier 构造器自 1.21 起私有化，必须走 Identifier.of（1.21.6+ 官方映射走 fromNamespaceAndPath）。
 */
import { describe, expect, it } from 'vitest'
import { createDefaultEntity } from '../../../shared/schemas/entity.schema'
import { createDefaultCube } from '../../../shared/types/content'
import type { ModContext } from '../contentGenerator/context'
import {
  fabricEntityModelJava,
  fabricEntityRendererJava
} from '../contentGenerator/javaEntities'

function ctx(mcVersion: string): ModContext {
  return {
    packageName: 'com.kunyu.testmod',
    modId: 'testmod',
    modClassName: 'TestmodMod',
    mcVersion
  } as unknown as ModContext
}

const cube = { textureSize: 16, elements: [createDefaultCube('body')] }
const entity = createDefaultEntity('sprite')

describe('Fabric 实体代码的版本断档', () => {
  it('1.21.1：ModelPart.render 用 4 参（无浮点颜色）', () => {
    const java = fabricEntityModelJava(ctx('1.21.1'), entity, cube)
    expect(java).toContain('public void render(MatrixStack matrices, VertexConsumer vertices, int light, int overlay) {')
    expect(java).toContain('this.root.render(matrices, vertices, light, overlay);')
    expect(java).not.toContain('float red, float green, float blue, float alpha')
  })

  it('1.20.1：保留 8 参颜色重载', () => {
    const java = fabricEntityModelJava(ctx('1.20.1'), entity, cube)
    expect(java).toContain('float red, float green, float blue, float alpha')
    expect(java).toContain('this.root.render(matrices, vertices, light, overlay, red, green, blue, alpha);')
  })

  it('1.21.2+（RenderState 体系）：仍用 8 参颜色重载', () => {
    const java = fabricEntityModelJava(ctx('1.21.11'), entity, cube)
    expect(java).toContain('float red, float green, float blue, float alpha')
  })

  it('1.21.1：资源位置走 Identifier.of，不再 new Identifier', () => {
    const java = fabricEntityRendererJava(ctx('1.21.1'), entity)
    expect(java).toContain('Identifier.of("testmod", "textures/entity/sprite.png")')
    expect(java).not.toContain('new Identifier(')
  })

  it('1.20.1：资源位置仍用 new Identifier', () => {
    const java = fabricEntityRendererJava(ctx('1.20.1'), entity)
    expect(java).toContain('new Identifier("testmod", "textures/entity/sprite.png")')
  })
})
