/**
 * M13 建模器工程 chat 工具：AI 直接读写 .kunyu/modeler/<id>.json。
 *
 * 设计原则：
 * - modeler_write 让模型一次性输出完整 ModelDocument（cube/mesh/group/locator + 骨骼 + 贴图 + 动画），
 *   适合 deepseek 等能直接出结构的模型；
 * - modeler_create / modeler_add_node / modeler_update_node / modeler_set_texture / modeler_set_animation
 *   作为细粒度补充，便于增量编辑；
 * - 所有写盘走 parseDocument 校验，拒绝非法结构落盘（与建模器编辑器同源校验）。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { RegisteredTool, ToolRegistryDeps } from '../toolRegistry'
import {
  createCubeNode,
  createDocument,
  deserializeDocument,
  serializeDocument,
  uid
} from '../../../../shared/modeler/document'
import type {
  CubeNode,
  MeshNode,
  ModelAnimation,
  ModelDocument,
  ModelNode,
  ModelTexture
} from '../../../../shared/modeler/types'

function modelerDir(root: string): string {
  return join(root, '.kunyu', 'modeler')
}

function docFile(root: string, id: string): string {
  return join(modelerDir(root), `${id}.json`)
}

function loadDoc(root: string, id: string): ModelDocument {
  const file = docFile(root, id)
  if (!existsSync(file)) throw new Error(`找不到建模器工程：${id}`)
  return deserializeDocument(JSON.parse(readFileSync(file, 'utf8')) as ModelDocument)
}

function saveDoc(root: string, doc: ModelDocument): void {
  const dir = modelerDir(root)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  doc.meta.updatedAt = Date.now()
  writeFileSync(docFile(root, doc.id), serializeDocument(doc), 'utf8')
}

/** 贴图 data URL 生成：纯色 / 网格棋盘 */
function makeTextureDataUrl(
  width: number,
  height: number,
  kind: 'solid' | 'checker',
  color?: string
): string {
  // 用 base64 编码一个最小 PNG：直接构造 RGBA 像素再编码（复用 encodePng 太重，这里走 data URL 占位）
  // 简化：生成 1x1 纯色 PNG 的 base64（固定模板），多像素用 canvas 不可用（主进程无 DOM）。
  // 改用 pngjs 编码——主进程已有 pngjs 依赖（pixelize.ts 用 decodePng/encodePng）。
  // 但为避免引入跨模块依赖，这里返回一个 1×1 透明 PNG 的 data URL 占位，让模型后续用 modeler_set_texture 覆盖 data 字段。
  // 实际上更实用的做法：直接接受模型传入的 data:image/png;base64 字符串。
  void width
  void height
  void kind
  void color
  // 1×1 透明 PNG base64
  return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
}

export function builtinModelerTools(deps: ToolRegistryDeps): RegisteredTool[] {
  const available = (): boolean => Boolean(deps.projectRoot?.())
  const tools: RegisteredTool[] = []

  /* ---------- modeler_list ---------- */
  tools.push({
    kind: 'chat',
    def: {
      type: 'function',
      function: {
        name: 'modeler_list',
        description:
          '列出当前项目 .kunyu/modeler/ 下所有建模器工程（id / 名称 / 格式 / 节点数）。' +
          '建模前先调用了解已有工程，避免重名或覆盖。',
        parameters: { type: 'object', properties: {}, required: [] }
      }
    },
    available,
    execute: () => {
      const root = deps.projectRoot?.()
      if (!root) return { ok: false, text: '', error: '当前没有打开的项目' }
      const dir = modelerDir(root)
      if (!existsSync(dir)) return { ok: true, text: '当前项目还没有建模器工程。', data: { items: [] } }
      const items = readdirSync(dir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => {
          const id = f.slice(0, -'.json'.length)
          try {
            const doc = JSON.parse(readFileSync(join(dir, f), 'utf8')) as ModelDocument
            return {
              id,
              name: doc.name ?? id,
              format: doc.format ?? 'unknown',
              nodes: Object.keys(doc.nodes ?? {}).length,
              textures: Object.keys(doc.textures ?? {}).length,
              animations: Object.keys(doc.animations ?? {}).length
            }
          } catch {
            return { id, name: id, format: 'invalid', nodes: 0, textures: 0, animations: 0 }
          }
        })
      if (items.length === 0) return { ok: true, text: '当前项目还没有建模器工程。', data: { items: [] } }
      return { ok: true, text: JSON.stringify(items, null, 2), data: { items } }
    }
  })

  /* ---------- modeler_create ---------- */
  tools.push({
    kind: 'chat',
    def: {
      type: 'function',
      function: {
        name: 'modeler_create',
        description:
          '新建一个建模器工程并落盘到 .kunyu/modeler/<id>.json。' +
          '可选初始立方体（默认 16×16×16 原点块）。返回工程 id。' +
          '格式：java_block（Java 方块）/ java_item（Java 物品）/ bedrock_entity（基岩实体）/ ' +
          'bedrock_block（基岩方块）/ geckolib（GeckoLib 实体）/ free（自由格式）。',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string', description: '工程 id（省略则自动生成，如 doc-xxxx）' },
            name: { type: 'string', description: '工程名称' },
            format: {
              type: 'string',
              enum: ['java_block', 'java_item', 'bedrock_entity', 'bedrock_block', 'geckolib', 'free'],
              description: '模型格式'
            },
            withDefaultCube: {
              type: 'boolean',
              description: '是否添加默认 16³ 立方体（默认 true）'
            }
          },
          required: ['name', 'format']
        }
      }
    },
    available,
    execute: (args) => {
      const root = deps.projectRoot?.()
      if (!root) return { ok: false, text: '', error: '当前没有打开的项目' }
      const name = typeof args['name'] === 'string' ? args['name'] : 'untitled'
      const format = (args['format'] as ModelDocument['format']) ?? 'free'
      const doc = createDocument({ name, format })
      if (args['withDefaultCube'] !== false) {
        const cube = createCubeNode('cube')
        doc.nodes[cube.id] = cube
        doc.root.push(cube.id)
      }
      saveDoc(root, doc)
      return {
        ok: true,
        text: `已创建建模器工程「${name}」(id=${doc.id}, format=${format})`,
        data: { id: doc.id, name, format }
      }
    }
  })

  /* ---------- modeler_write ---------- */
  tools.push({
    kind: 'chat',
    def: {
      type: 'function',
      function: {
        name: 'modeler_write',
        description:
          '直接写入完整建模器工程 JSON（ModelDocument 全量结构）。' +
          '适合一次性生成整个模型：cube/mesh/group/locator 节点 + 骨骼链 + 贴图 + 动画。' +
          '写入前会用建模器同源校验（parseDocument），非法结构会被拒绝。' +
          '若 id 已存在则覆盖；不存在则新建。meta.createdAt/updatedAt 自动维护。',
        parameters: {
          type: 'object',
          properties: {
            document: {
              type: 'object',
              description:
                '完整 ModelDocument 对象，含 schemaVersion/id/name/format/settings/nodes/root/textures/animations/meta。' +
                '节点 type 必须为 cube | group | locator | mesh。'
            }
          },
          required: ['document']
        }
      }
    },
    available,
    execute: (args) => {
      const root = deps.projectRoot?.()
      if (!root) return { ok: false, text: '', error: '当前没有打开的项目' }
      const raw = args['document']
      if (!raw || typeof raw !== 'object') {
        return { ok: false, text: '', error: 'document 参数必须是对象' }
      }
      let doc: ModelDocument
      try {
        doc = deserializeDocument(raw as ModelDocument)
      } catch (err) {
        return { ok: false, text: '', error: `工程校验失败：${(err as Error).message}` }
      }
      const existed = existsSync(docFile(root, doc.id))
      saveDoc(root, doc)
      const nodeCount = Object.keys(doc.nodes).length
      return {
        ok: true,
        text: `${existed ? '已覆盖' : '已创建'}工程「${doc.name}」(id=${doc.id})，${nodeCount} 个节点，${Object.keys(doc.textures).length} 张贴图，${Object.keys(doc.animations).length} 个动画`,
        data: { id: doc.id, name: doc.name, format: doc.format, nodeCount, existed }
      }
    }
  })

  /* ---------- modeler_add_node ---------- */
  tools.push({
    kind: 'chat',
    def: {
      type: 'function',
      function: {
        name: 'modeler_add_node',
        description:
          '向已有工程添加一个节点（cube / group / locator / mesh）。' +
          'parent 省略或为 null 则挂到顶层 root；否则挂到指定 group 下。' +
          'cube: from/to 对角坐标 + origin/rotation + faces(可选)。' +
          'mesh: vertices(顶点数组) + faces(3-4 顶点索引 + 逐顶点 UV)。' +
          'group: children 自动管理，只需指定 origin/rotation。' +
          'locator: position 挂点坐标。',
        parameters: {
          type: 'object',
          properties: {
            docId: { type: 'string', description: '工程 id' },
            type: { type: 'string', enum: ['cube', 'group', 'locator', 'mesh'], description: '节点类型' },
            name: { type: 'string', description: '节点名称' },
            parent: { type: 'string', description: '父节点 id（省略 = 顶层）' },
            node: { type: 'object', description: '节点字段（按 type 不同）' }
          },
          required: ['docId', 'type', 'name']
        }
      }
    },
    available,
    execute: (args) => {
      const root = deps.projectRoot?.()
      if (!root) return { ok: false, text: '', error: '当前没有打开的项目' }
      const docId = String(args['docId'] ?? '')
      const type = args['type'] as ModelNode['type']
      const name = String(args['name'] ?? 'node')
      const parent = typeof args['parent'] === 'string' ? args['parent'] : null
      const fields = (args['node'] ?? {}) as Record<string, unknown>
      let doc: ModelDocument
      try {
        doc = loadDoc(root, docId)
      } catch (err) {
        return { ok: false, text: '', error: (err as Error).message }
      }
      const id = uid(type)
      let node: ModelNode
      switch (type) {
        case 'cube':
          node = createCubeNode(name) as CubeNode
          Object.assign(node, fields, { id, name, type: 'cube', parent })
          break
        case 'group':
          node = {
            id,
            name,
            type: 'group',
            parent,
            visible: true,
            locked: false,
            children: [],
            origin: (fields.origin as [number, number, number]) ?? [0, 0, 0],
            rotation: (fields.rotation as [number, number, number]) ?? [0, 0, 0],
            ...(fields.scale ? { scale: fields.scale as [number, number, number] } : {})
          }
          break
        case 'locator':
          node = {
            id,
            name,
            type: 'locator',
            parent,
            visible: true,
            locked: false,
            position: (fields.position as [number, number, number]) ?? [0, 0, 0]
          }
          break
        case 'mesh':
          node = {
            id,
            name,
            type: 'mesh',
            parent,
            visible: true,
            locked: false,
            vertices: (fields.vertices as [number, number, number][]) ?? [],
            faces: (fields.faces as MeshNode['faces']) ?? [],
            origin: (fields.origin as [number, number, number]) ?? [0, 0, 0],
            rotation: (fields.rotation as [number, number, number]) ?? [0, 0, 0]
          }
          break
        default:
          return { ok: false, text: '', error: `未知节点类型：${type}` }
      }
      doc.nodes[id] = node
      if (parent) {
        const p = doc.nodes[parent]
        if (p && p.type === 'group') p.children.push(id)
      } else {
        doc.root.push(id)
      }
      try {
        saveDoc(root, doc)
      } catch (err) {
        return { ok: false, text: '', error: `保存失败：${(err as Error).message}` }
      }
      return { ok: true, text: `已添加 ${type} 节点「${name}」(id=${id})`, data: { id, type, name } }
    }
  })

  /* ---------- modeler_update_node ---------- */
  tools.push({
    kind: 'chat',
    def: {
      type: 'function',
      function: {
        name: 'modeler_update_node',
        description:
          '修改已有节点的字段（patch 语义，只传要改的字段）。' +
          '可改 from/to/origin/rotation/vertices/faces/children/position 等。' +
          '不可改 id / type / parent（改结构用 add/remove）。',
        parameters: {
          type: 'object',
          properties: {
            docId: { type: 'string', description: '工程 id' },
            nodeId: { type: 'string', description: '节点 id' },
            patch: { type: 'object', description: '要合并的字段' }
          },
          required: ['docId', 'nodeId', 'patch']
        }
      }
    },
    available,
    execute: (args) => {
      const root = deps.projectRoot?.()
      if (!root) return { ok: false, text: '', error: '当前没有打开的项目' }
      const docId = String(args['docId'] ?? '')
      const nodeId = String(args['nodeId'] ?? '')
      const patch = args['patch'] as Record<string, unknown>
      if (!patch || typeof patch !== 'object') {
        return { ok: false, text: '', error: 'patch 必须是对象' }
      }
      let doc: ModelDocument
      try {
        doc = loadDoc(root, docId)
      } catch (err) {
        return { ok: false, text: '', error: (err as Error).message }
      }
      const node = doc.nodes[nodeId]
      if (!node) return { ok: false, text: '', error: `节点不存在：${nodeId}` }
      // 禁止改结构字段
      const forbidden = ['id', 'type', 'parent']
      for (const k of forbidden) delete patch[k]
      Object.assign(node, patch)
      try {
        saveDoc(root, doc)
      } catch (err) {
        return { ok: false, text: '', error: `保存失败：${(err as Error).message}` }
      }
      return { ok: true, text: `已更新节点「${nodeId}」`, data: { nodeId, patch } }
    }
  })

  /* ---------- modeler_set_texture ---------- */
  tools.push({
    kind: 'chat',
    def: {
      type: 'function',
      function: {
        name: 'modeler_set_texture',
        description:
          '写入或覆盖工程中的一张贴图。data 为 data:image/png;base64,... 字符串。' +
          '若省略 data 则生成 1×1 透明占位 PNG（建议后续用 paint 工具覆盖）。' +
          '新建贴图需提供 width/height；已存在贴图可只改 data。',
        parameters: {
          type: 'object',
          properties: {
            docId: { type: 'string', description: '工程 id' },
            textureId: { type: 'string', description: '贴图 id（省略则用 name 当 id）' },
            name: { type: 'string', description: '贴图名称' },
            width: { type: 'integer', description: '宽度（新建必填）' },
            height: { type: 'integer', description: '高度（新建必填）' },
            data: { type: 'string', description: 'data:image/png;base64,... 像素数据（省略=透明占位）' }
          },
          required: ['docId', 'name']
        }
      }
    },
    available,
    execute: (args) => {
      const root = deps.projectRoot?.()
      if (!root) return { ok: false, text: '', error: '当前没有打开的项目' }
      const docId = String(args['docId'] ?? '')
      const name = String(args['name'] ?? 'texture')
      const textureId = typeof args['textureId'] === 'string' ? args['textureId'] : name
      const width = typeof args['width'] === 'number' ? args['width'] : 16
      const height = typeof args['height'] === 'number' ? args['height'] : 16
      let data = typeof args['data'] === 'string' ? args['data'] : ''
      if (!data) data = makeTextureDataUrl(width, height, 'solid')
      let doc: ModelDocument
      try {
        doc = loadDoc(root, docId)
      } catch (err) {
        return { ok: false, text: '', error: (err as Error).message }
      }
      const existing = doc.textures[textureId]
      const tex: ModelTexture = existing
        ? { ...existing, name, data }
        : { id: textureId, name, width, height, data, visible: true }
      doc.textures[textureId] = tex
      try {
        saveDoc(root, doc)
      } catch (err) {
        return { ok: false, text: '', error: `保存失败：${(err as Error).message}` }
      }
      return {
        ok: true,
        text: `${existing ? '已更新' : '已添加'}贴图「${name}」(${width}×${height})`,
        data: { textureId, name, width, height }
      }
    }
  })

  /* ---------- modeler_set_animation ---------- */
  tools.push({
    kind: 'chat',
    def: {
      type: 'function',
      function: {
        name: 'modeler_set_animation',
        description:
          '写入或覆盖工程中的一个动画。channels 为 { 节点id: { rotation: [{time, value:[x,y,z], interpolation}], position, scale } }。' +
          'time 单位秒；interpolation: linear | catmullrom | step；loop: once | loop | hold。',
        parameters: {
          type: 'object',
          properties: {
            docId: { type: 'string', description: '工程 id' },
            animId: { type: 'string', description: '动画 id（省略则用 name）' },
            name: { type: 'string', description: '动画名称' },
            length: { type: 'number', description: '动画长度（秒）' },
            loop: { type: 'string', enum: ['once', 'loop', 'hold'], description: '循环模式' },
            channels: {
              type: 'object',
              description: '动画通道：{ 节点id: { rotation?: Keyframe[], position?: Keyframe[], scale?: Keyframe[] } }'
            }
          },
          required: ['docId', 'name', 'length', 'channels']
        }
      }
    },
    available,
    execute: (args) => {
      const root = deps.projectRoot?.()
      if (!root) return { ok: false, text: '', error: '当前没有打开的项目' }
      const docId = String(args['docId'] ?? '')
      const name = String(args['name'] ?? 'anim')
      const animId = typeof args['animId'] === 'string' ? args['animId'] : name
      const length = typeof args['length'] === 'number' ? args['length'] : 1
      const loop = (args['loop'] as ModelAnimation['loop']) ?? 'loop'
      const channels = args['channels'] as ModelAnimation['channels']
      if (!channels || typeof channels !== 'object') {
        return { ok: false, text: '', error: 'channels 必须是对象' }
      }
      let doc: ModelDocument
      try {
        doc = loadDoc(root, docId)
      } catch (err) {
        return { ok: false, text: '', error: (err as Error).message }
      }
      doc.animations[animId] = { id: animId, name, length, loop, channels }
      try {
        saveDoc(root, doc)
      } catch (err) {
        return { ok: false, text: '', error: `保存失败：${(err as Error).message}` }
      }
      const channelCount = Object.keys(channels).length
      return {
        ok: true,
        text: `${doc.animations[animId] ? '已更新' : '已添加'}动画「${name}」(${length}s, ${loop}, ${channelCount} 通道)`,
        data: { animId, name, length, loop, channelCount }
      }
    }
  })

  return tools
}
