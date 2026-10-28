import type { GeneratorBlock } from '../blockAdapter'
import { mojmapModBlocksJava } from '../mojmapCodegen'
import {
  blockClassImport,
  blockSettingsExpr,
  blockSettingsImport,
  blockSoundCall,
  blockSoundImport,
  luminanceCall,
  nonOpaqueCall,
  registryImports,
  registriesConst,
  requiresToolCall,
  resourceKeyImport,
  setIdCallExpr
} from '../../templates/fabricTemplates'
import type { ModContext } from './context'
import { GENERATED_BANNER, oneLine } from './utils'

export function toJavaConst(id: string): string {
  return id.toUpperCase()
}

export function fmtFloat(n: number): string {
  return `${Number(n.toFixed(2))}f`
}

/** 生成 ModBlocks.java（按加载器分发：Fabric/Yarn 或 Forge·NeoForge/Mojang） */
export function generateModBlocksJava(ctx: ModContext, blocks: GeneratorBlock[]): string {
  return ctx.loader === 'fabric' ? fabricModBlocksJava(ctx, blocks) : mojmapModBlocksJava(ctx, blocks)
}

function fabricModBlocksJava(ctx: ModContext, blocks: GeneratorBlock[]): string {
  const needNonOpaque = blocks.some((b) => b.preset === 'glass' || b.collisionType !== 'full')
  const needNoCollision = blocks.some((b) => b.collisionType === 'none')
  const customImports = blocks
    .filter((b) => b.customClass)
    .map((b) => `import ${b.customClass};\n`)
    .join('')

  const fields = blocks
    .map((b) => {
      const chain: string[] = []
      // 26.x Mojmap：属性对象必须挂 ResourceKey（Fabric API 26.3 实证），否则注册期抛异常；
      // Yarn 时代无该步骤，setIdCallExpr 返回空串被过滤，输出与改造前逐字节一致
      const setId = setIdCallExpr(ctx.mcVersion, 'BLOCK', ctx.modClassName, b.id)
      if (setId) chain.push(`        ${setId}`)
      chain.push(`        .strength(${fmtFloat(b.hardness)}, ${fmtFloat(b.resistance)})`)
      chain.push(`        ${blockSoundCall(ctx.mcVersion, b.soundGroup)}`)
      if (b.requiresTool) chain.push(`        ${requiresToolCall(ctx.mcVersion)}`)
      if (b.luminance > 0) chain.push(`        ${luminanceCall(ctx.mcVersion, b.luminance)}`)
      if (needNoCollision && b.collisionType === 'none') chain.push('        .noCollision()')
      else if (needNonOpaque && (b.preset === 'glass' || b.collisionType !== 'full')) {
        chain.push(`        ${nonOpaqueCall(ctx.mcVersion)}`)
      }
      const comment = b.description ? `/** ${b.displayName}：${oneLine(b.description)} */` : `/** ${b.displayName} */`
      // AI 自定义方块类：取简写名，构造器仅收 AbstractBlock.Settings
      const ctor = b.customClass ? b.customClass.split('.').pop() : 'Block'
      const ftype = b.customClass ? b.customClass.split('.').pop() : 'Block'
      return `    ${comment}
    public static final ${ftype} ${toJavaConst(b.id)} = new ${ctor}(${blockSettingsExpr(ctx.mcVersion)}
${chain.join('\n')});`
    })
    .join('\n\n')

  const registers = blocks
    .map((b) => `        Registry.register(${registriesConst(ctx.mcVersion, 'BLOCK')}, ${ctx.modClassName}.id("${b.id}"), ${toJavaConst(b.id)});`)
    .join('\n')

  return `package ${ctx.packageName}.registry;

import ${ctx.packageName}.${ctx.modClassName};
${blocks.length > 0 ? `${blockSettingsImport(ctx.mcVersion)}${blockClassImport(ctx.mcVersion)}
${registryImports(ctx.mcVersion)}${resourceKeyImport(ctx.mcVersion)}${blockSoundImport(ctx.mcVersion)}
${customImports}` : ''}
/**
 * ${GENERATED_BANNER}
 */
public class ModBlocks {
${fields || '    // 暂无由可视化编辑器管理的方块'}

    public static void register() {
${registers || '        // no managed blocks'}
    }
}
`
}
