/**
 * 注册类符号级增量合并。
 *
 * 背景：P1-4 的漂移保护把「聚合文件整份跳过」，导致用户在编辑器新增方块后
 * ModBlocks.java / lang 静默不生效。改为：磁盘上漂移的注册类解析出
 * 「不在本轮语义集合内」的外来注册段（字段声明 / Registry.register 调用 / import），
 * splice 进生成内容；AI 手写的自定义类引用（如 SolarFurnaceBlock）随之保留。
 *
 * retiredContentIds：上轮清单登记、本轮语义已删除的内容 id——
 * 用户在编辑器里删除内容后，其旧注册语句不视为外来（否则会永远并回来）。
 *
 * @returns 合并结果：content 为最终文件文本，mergedForeign 标记是否并入了外来段；
 *          磁盘文件不像注册类（无 class 声明）时返回 null（调用方回落到跳过策略）。
 *          无外来段时返回 { content: generated, mergedForeign: false }——
 *          语义集合已覆盖磁盘全部注册，直接以生成内容为准（这正是 P0-A 要修的核心：
 *          新增语义内容必须落进注册类，不能整份跳过）。
 */
export function mergeRegistryClass(
  disk: string,
  generated: string,
  retiredContentIds: ReadonlySet<string>
): { content: string; mergedForeign: boolean } | null {
  if (!/\bclass\s+\w+/.test(disk)) return null
  const IMPORT_RE = /^import\s+[\w.]+;$/
  const FIELD_START_RE = /^\s*public\s+static\s+final\s+[\w.]+(?:<[^>]*>)?\s+(\w+)\s*=/
  const REGISTER_RE = /Registry\.register\(|\.register\(/

  // --- 解析生成侧已有的字段常量名，外来判定以它为准 ---
  const generatedConsts = new Set<string>()
  for (const line of generated.split('\n')) {
    const m = FIELD_START_RE.exec(line)
    if (m) generatedConsts.add(m[1]!)
  }

  /** 字段常量名 → 内容 id（snake_case）：用于「已删除语义」识别 */
  const constToId = (c: string): string => c.toLowerCase()

  // --- 解析磁盘侧 ---
  const diskLines = disk.split('\n')
  const foreignImports: string[] = []
  const foreignFields: string[] = [] // 含前导注释行的完整字段块
  const foreignRegisters: string[] = []
  const mergedConsts = new Set<string>() // 已并入的字段常量（register 行引用校验用）

  for (let i = 0; i < diskLines.length; i++) {
    const line = diskLines[i]!
    if (IMPORT_RE.test(line.trim()) && !generated.includes(line.trim())) {
      foreignImports.push(line.trim())
      continue
    }
    const fm = FIELD_START_RE.exec(line)
    if (fm) {
      const constName = fm[1]!
      // 字段块：连同前一行 /** 注释 */ 一起抽取，直到分号收尾（括号深度归零）
      const block: string[] = []
      const prev = diskLines[i - 1]
      if (prev && /^\s*\/\*\*.*\*\/\s*$/.test(prev)) block.push(prev)
      let depth = 0
      let j = i
      for (; j < diskLines.length; j++) {
        const l = diskLines[j]!
        block.push(l)
        for (const ch of l) {
          if (ch === '(') depth++
          else if (ch === ')') depth--
        }
        if (depth <= 0 && l.includes(';')) break
      }
      i = j
      if (generatedConsts.has(constName)) continue // 语义侧已管理，生成内容为准
      if (retiredContentIds.has(constToId(constName))) continue // 用户已在编辑器删除
      // Mojmap 形态可从 register("<id>") 直接取 id 复核
      const idm = /register\("([a-z][a-z0-9_]*)"/.exec(block.join('\n'))
      if (idm && retiredContentIds.has(idm[1]!)) continue
      foreignFields.push(block.join('\n'))
      mergedConsts.add(constName)
      continue
    }
    if (REGISTER_RE.test(line) && !generated.includes(line.trim())) {
      // Fabric 形态 register(..., "id", CONST)：id 已删除则不并入；
      // 引用的常量若既不在生成侧也不在外来字段里，跳过（悬空引用）
      const idm = /"([a-z][a-z0-9_]*)"/.exec(line)
      if (idm && retiredContentIds.has(idm[1]!)) continue
      const constRefs = /,\s*(\w+)\s*\);?\s*$/.exec(line)
      if (constRefs && !generatedConsts.has(constRefs[1]!) && !mergedConsts.has(constRefs[1]!)) {
        continue
      }
      foreignRegisters.push(line.trimEnd())
    }
  }

  const mergedForeign =
    foreignImports.length > 0 || foreignFields.length > 0 || foreignRegisters.length > 0

  // --- splice 进生成内容 ---
  const out = generated.split('\n')

  // 1) import：插到最后一条 import 之后
  if (foreignImports.length > 0) {
    let lastImport = -1
    for (let i = 0; i < out.length; i++) {
      if (IMPORT_RE.test(out[i]!.trim())) lastImport = i
    }
    const pkg = out.findIndex((l) => /^package\s/.test(l))
    const at = lastImport >= 0 ? lastImport + 1 : pkg >= 0 ? pkg + 1 : 0
    out.splice(at, 0, ...foreignImports)
  }

  // 2) register 语句：插到 register()/registerIEventBus 方法体的收尾大括号前
  if (foreignRegisters.length > 0) {
    const methodStart = out.findIndex((l) => /public\s+static\s+void\s+register\w*\s*\(/.test(l))
    if (methodStart >= 0) {
      // 模板方法体缩进 4 空格，收尾行为 `    }`
      let closeIdx = -1
      for (let i = methodStart + 1; i < out.length; i++) {
        if (/^ {4}\}/.test(out[i]!)) {
          closeIdx = i
          break
        }
      }
      if (closeIdx >= 0) {
        const indent = '        '
        out.splice(
          closeIdx,
          0,
          ...foreignRegisters.map((l) => indent + l.trim())
        )
      }
    }
  }

  // 3) 字段块：插到 register 方法声明前；无 register 方法（Mojmap）时插到类收尾大括号前
  if (foreignFields.length > 0) {
    const methodIdx = out.findIndex((l) => /public\s+static\s+void\s+register\w*\s*\(/.test(l))
    let at = methodIdx
    if (at < 0) {
      for (let i = out.length - 1; i >= 0; i--) {
        if (/^}\s*$/.test(out[i]!)) {
          at = i
          break
        }
      }
    }
    if (at >= 0) {
      // 与前文空行分隔
      out.splice(at, 0, ...foreignFields.flatMap((f) => [f, '']))
    }
  }

  return { content: out.join('\n'), mergedForeign }
}
