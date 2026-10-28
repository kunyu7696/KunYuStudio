/**
 * KubeJS 脚本主进程服务。
 *
 * 直读直写 kubejs/{startup,server,client}_scripts/*.js：
 * - listScripts：扫描三目录，目录不存在记入 missingDirs（不视为错误），文件 stat 失败进 warnings；
 * - readScript/writeScript/deleteScript：单文件读写删，写入时自动创建目录；
 * - listTemplates/applyTemplate：内置常用骨架（物品/方块注册、配方、服务端与客户端事件），
 *   applyTemplate 落盘为新脚本，目标已存在时拒绝（防覆盖用户代码）。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  KubejsListResult,
  KubejsScriptDir,
  KubejsScriptFile,
  KubejsTemplate
} from '../../shared/types/kubejs'
import { validateContentId } from '../../shared/types/content'
import { assertWithinRoot } from './fsService'

const DIR_MAP: Record<KubejsScriptDir, string> = {
  startup: 'startup_scripts',
  server: 'server_scripts',
  client: 'client_scripts'
}

const DIR_ORDER: KubejsScriptDir[] = ['startup', 'server', 'client']

/** 脚本目录绝对路径（带项目根守卫） */
function scriptDirPath(root: string, dir: KubejsScriptDir): string {
  assertWithinRoot(root)
  return join(root, 'kubejs', DIR_MAP[dir])
}

function assertDir(dir: string): asserts dir is KubejsScriptDir {
  if (!(dir in DIR_MAP)) throw new Error(`脚本目录不合法：${dir}`)
}

function assertStem(stem: string): void {
  if (!validateContentId(stem)) throw new Error(`脚本文件名不合法：${stem}`)
}

function scriptRelPath(dir: KubejsScriptDir, stem: string): string {
  return `kubejs/${DIR_MAP[dir]}/${stem}.js`
}

/* ------------------------------ 读写删 ------------------------------ */

/** 扫描三目录脚本列表；目录不存在记 missingDirs，stat 失败记 warnings */
export function listScripts(root: string): KubejsListResult {
  assertWithinRoot(root)
  const result: KubejsListResult = { scripts: [], missingDirs: [], warnings: [] }
  for (const dir of DIR_ORDER) {
    const dirPath = scriptDirPath(root, dir)
    if (!existsSync(dirPath)) {
      result.missingDirs.push(dir)
      continue
    }
    for (const name of readdirSync(dirPath)) {
      if (!name.endsWith('.js')) continue
      const stem = name.slice(0, -'.js'.length)
      try {
        const st = statSync(join(dirPath, name))
        if (!st.isFile()) continue
        result.scripts.push({
          dir,
          stem,
          relPath: scriptRelPath(dir, stem),
          sizeBytes: st.size,
          modifiedAt: Math.round(st.mtimeMs)
        })
      } catch (err) {
        result.warnings.push(`${scriptRelPath(dir, stem)}：${(err as Error).message}`)
      }
    }
  }
  result.scripts.sort(
    (a, b) =>
      DIR_ORDER.indexOf(a.dir) - DIR_ORDER.indexOf(b.dir) || a.stem.localeCompare(b.stem)
  )
  return result
}

/** 读脚本全文（BOM 容忍）；不存在抛错 */
export function readScript(root: string, dir: KubejsScriptDir, stem: string): string {
  assertDir(dir)
  assertStem(stem)
  const path = join(scriptDirPath(root, dir), `${stem}.js`)
  if (!existsSync(path)) throw new Error(`脚本不存在：${scriptRelPath(dir, stem)}`)
  return readFileSync(path, 'utf-8').replace(/^﻿/, '') // BOM 剥离（等价 \uFEFF）
}

/** 写脚本（自动创建目录） */
export function writeScript(root: string, dir: KubejsScriptDir, stem: string, content: string): void {
  assertDir(dir)
  assertStem(stem)
  const dirPath = scriptDirPath(root, dir)
  mkdirSync(dirPath, { recursive: true })
  writeFileSync(join(dirPath, `${stem}.js`), content)
}

/** 删脚本（不存在时静默成功） */
export function deleteScript(root: string, dir: KubejsScriptDir, stem: string): void {
  assertDir(dir)
  assertStem(stem)
  rmSync(join(scriptDirPath(root, dir), `${stem}.js`), { force: true })
}

/* ------------------------------ 模板库 ------------------------------ */

const TEMPLATES: KubejsTemplate[] = [
  {
    id: 'startup-item',
    name: '注册自定义物品',
    description: '启动期注册一个基础物品（displayName/材质走 assets 资源）',
    dir: 'startup',
    stem: 'my_items',
    content: [
      '// 启动期脚本：注册自定义物品',
      "onEvent('item.registry', event => {",
      "  event.create('my_item').displayName('我的物品')",
      '})',
      ''
    ].join('\n')
  },
  {
    id: 'startup-block',
    name: '注册自定义方块',
    description: '启动期注册一个基础方块（硬度/抗性/材质按需要补充）',
    dir: 'startup',
    stem: 'my_blocks',
    content: [
      '// 启动期脚本：注册自定义方块',
      "onEvent('block.registry', event => {",
      "  event.create('my_block')",
      "    .displayName('我的方块')",
      "    .material('stone')",
      '    .hardness(1.5)',
      '    .resistance(6.0)',
      '})',
      ''
    ].join('\n')
  },
  {
    id: 'server-recipes',
    name: '配方添加',
    description: '服务端 recipes 事件：有序/无序配方示例',
    dir: 'server',
    stem: 'my_recipes',
    content: [
      '// 服务端脚本：配方事件',
      "onEvent('recipes', event => {",
      '  // 有序合成：下界之星 × 1',
      "  event.shaped('minecraft:nether_star', [",
      "    'SSS',",
      "    'SWS',",
      "    'SSS'",
      '  ], {',
      "    S: 'minecraft:soul_sand',",
      "    W: 'minecraft:wither_skeleton_skull'",
      '  })',
      '',
      '  // 无序合成：泥土 + 种子 → 草方块',
      "  event.shapeless('minecraft:grass_block', ['minecraft:dirt', 'minecraft:wheat_seeds'])",
      '})',
      ''
    ].join('\n')
  },
  {
    id: 'server-events',
    name: '服务端事件监听',
    description: '服务器启动/玩家登录等常用服务端事件骨架',
    dir: 'server',
    stem: 'my_events',
    content: [
      '// 服务端脚本：生命周期与玩家事件',
      "onEvent('server.load', event => {",
      "  event.server.runCommandSilent('say 服务端脚本已加载')",
      '})',
      '',
      "onEvent('player.logged_in', event => {",
      "  event.player.tell('欢迎回来！')",
      '})',
      ''
    ].join('\n')
  },
  {
    id: 'client-ui',
    name: '客户端事件监听',
    description: '客户端事件骨架（界面提示/客户端 tick）',
    dir: 'client',
    stem: 'my_client',
    content: [
      '// 客户端脚本：客户端事件',
      "onEvent('client.logged_in', event => {",
      "  event.player.tell('客户端脚本已就绪')",
      '})',
      ''
    ].join('\n')
  }
]

/** 内置模板列表 */
export function listTemplates(): KubejsTemplate[] {
  return TEMPLATES
}

/** 应用模板落盘为新脚本；目标已存在时拒绝（防覆盖用户代码） */
export function applyTemplate(root: string, templateId: string): KubejsScriptFile {
  assertWithinRoot(root)
  const template = TEMPLATES.find((t) => t.id === templateId)
  if (!template) throw new Error(`模板不存在：${templateId}`)
  const dirPath = scriptDirPath(root, template.dir)
  const path = join(dirPath, `${template.stem}.js`)
  if (existsSync(path)) throw new Error(`目标脚本已存在：${scriptRelPath(template.dir, template.stem)}`)
  mkdirSync(dirPath, { recursive: true })
  writeFileSync(path, template.content)
  const st = statSync(path)
  return {
    dir: template.dir,
    stem: template.stem,
    relPath: scriptRelPath(template.dir, template.stem),
    sizeBytes: st.size,
    modifiedAt: Math.round(st.mtimeMs)
  }
}
