<template>
  <div ref="containerRef" class="code-editor"></div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { monaco, currentMonacoTheme } from '../../monaco/setup'
import { registerPluginLanguages } from '../../monaco/pluginLanguages'
import { lintJava, toMonacoMarkers } from '../../monaco/javaLint'
import {
  buildImportEdit,
  collectUnresolvedTypeNames,
  isCoveredByWildcard,
  stripJavaCommentsAndStrings,
  unresolvedSignature,
  type UnresolvedTypeName
} from '../../monaco/javaImports'
import { useEditorStore } from '../../stores/editor'
import { useProjectStore } from '../../stores/project'
import { useSettingsStore } from '../../stores/settings'
import { t } from '../../i18n'
import type { LintMarker } from '../../monaco/javaLint'
import type { JavaClassCandidate } from '../../../../shared/types/java'
import {
  registerCue,
  createChangePointTracker,
  type CueHandle,
  type ChangePointTracker
} from '../../monaco/cue'
import type { CueSettings } from '../../../../shared/types/settings'

// 声明式语言着色插件：首次打开编辑器时注册进 Monaco（幂等，失败静默不阻塞编辑）
void registerPluginLanguages()

/** M4：import 诊断独立 marker owner（与 kunyu-java-lint 区分，不进 M2 修改点） */
const IMPORT_MARKER_OWNER = 'kunyu-java-import'
const IMPORT_MARKER_SOURCE = 'kunyu-import'

/** 有候选的符号数据（已过滤同包与通配 import） */
interface ResolvableImport {
  name: string
  lineNumber: number
  column: number
  candidates: JavaClassCandidate[]
}

/** 最近一次 import 解析快照，CodeActionProvider 据此生成灯泡动作 */
interface ImportResolution {
  /** 符号集签名（排序拼接），相同则不重复 IPC */
  sig: string
  packageName: string
  resolvable: Map<string, ResolvableImport>
  /** 本地索引 0 候选的符号（供 AI 兜底 action） */
  unresolved: Map<string, UnresolvedTypeName>
}

const props = defineProps<{
  path: string
  content: string
  language: string
}>()

const emit = defineEmits<{
  (e: 'change', content: string): void
  (e: 'diagnostics', markers: LintMarker[]): void
}>()

const containerRef = ref<HTMLDivElement>()
let editor: monaco.editor.IStandaloneCodeEditor | null = null
let model: monaco.editor.ITextModel | null = null
let changeTimer: ReturnType<typeof setTimeout> | null = null
/** 外部（磁盘重载/跳转）程序化写入内容时置位，避免把 setValue 误判为用户编辑而触发自动保存 */
let applyingExternal = false
/** T2.5：流式揭示动画定时器（agent file-written 按行铺开） */
let streamTimer: ReturnType<typeof setInterval> | null = null
/** CUE 代码补全句柄；settings.ai.cue 变化时重新注册 */
let cueHandle: CueHandle | null = null
/** M2：修改点（最近编辑 ∪ lint 错误行）跟踪器，生命周期跟随 cueHandle */
let cpTracker: ChangePointTracker | null = null
/** M4：最近一次 import 解析快照 + 请求序号（防过期响应覆盖） */
let importResolution: ImportResolution | null = null
let importSeq = 0
/** M4：Java import 灯泡 provider（随编辑器生命周期注册/销毁） */
let importActionProvider: monaco.IDisposable | null = null
let quickFixAction: monaco.IDisposable | null = null

const editorStore = useEditorStore()
const appSettings = useSettingsStore()
const projectStore = useProjectStore()

function createEditor(initialValue?: string): void {
  if (!containerRef.value) return
  const es = appSettings.editor
  editor = monaco.editor.create(containerRef.value, {
    theme: currentMonacoTheme(),
    language: props.language,
    value: initialValue ?? props.content,
    automaticLayout: true,
    fontSize: es.fontSize,
    fontFamily: es.fontFamily,
    minimap: { enabled: true },
    scrollBeyondLastLine: false,
    glyphMargin: true,
    lineNumbers: es.lineNumbers ? 'on' : 'off',
    roundedSelection: false,
    cursorBlinking: 'smooth',
    smoothScrolling: true,
    renderWhitespace: 'selection',
    tabSize: es.tabSize,
    insertSpaces: es.insertSpaces,
    wordWrap: es.wordWrap ? 'on' : 'off'
  })

  model = editor.getModel()

  // DEV-only：暴露编辑器实例供 CDP 验证脚本（M3/M4 真机验证）与调试使用
  if (import.meta.env.DEV) {
    ;(window as unknown as Record<string, unknown>).__kyCodeEditor = editor
  }

  editor.onDidChangeModelContent((e) => {
    if (!editor) return
    const value = editor.getValue()
    // 外部 setValue 同步触发的变更只刷新诊断，不作为用户编辑回写（防止与磁盘重载互相覆盖）
    if (!applyingExternal) emit('change', value)
    // M2：转发内容变更给修改点跟踪器（编辑行收集 + CUE 接受检测）
    cpTracker?.notifyContentChanged(e, applyingExternal)
    // 防抖诊断（300ms）
    if (changeTimer) clearTimeout(changeTimer)
    changeTimer = setTimeout(() => runDiagnostics(value), 300)
  })

  // T7.2/T7.3：把非空选区发布到 editor store，供 AI 上下文注入与「解释选中代码」
  editor.onDidChangeCursorSelection(() => {
    if (!editor || !model) return
    const sel = editor.getSelection()
    if (!sel || sel.isEmpty()) {
      editorStore.clearSelection(props.path)
      return
    }
    editorStore.setSelection({
      path: props.path,
      startLine: sel.startLineNumber,
      endLine: sel.endLineNumber,
      text: model.getValueInRange(sel)
    })
  })
}

function runDiagnostics(value: string): void {
  if (!model) return
  if (props.language === 'java') {
    const markers = lintJava(value)
    monaco.editor.setModelMarkers(model, 'kunyu-java-lint', toMonacoMarkers(markers))
    emit('diagnostics', markers)
  } else {
    monaco.editor.setModelMarkers(model, 'kunyu-java-lint', [])
    emit('diagnostics', [])
  }
  // M2：lint markers 更新后重新计算修改点装饰器
  cpTracker?.refresh()
  // M4：异步 Java 缺失 import 分析（独立 owner，不影响 M2 修改点）
  void updateImportDiagnostics(value)
}

/** 清空 M4 import 诊断与快照 */
function clearImportDiagnostics(): void {
  if (model) monaco.editor.setModelMarkers(model, IMPORT_MARKER_OWNER, [])
  importResolution = null
}

/**
 * M4：异步分析缺失 import。
 * 同步 lint 之后执行：strip 注释/字符串 → 收集未解析大写类型名 →
 * IPC 请求主进程项目源码索引 → 唯一候选 Warning、多候选 Hint、0 候选无 marker（AI 兜底）。
 */
async function updateImportDiagnostics(value: string): Promise<void> {
  if (!model) return
  if (props.language !== 'java' || !appSettings.ai.cue.javaAutoImport) {
    clearImportDiagnostics()
    return
  }
  const projectId = projectStore.currentProjectId
  if (!projectId) {
    clearImportDiagnostics()
    return
  }

  const info = collectUnresolvedTypeNames(stripJavaCommentsAndStrings(value))
  const seq = ++importSeq

  if (info.unresolved.length === 0) {
    monaco.editor.setModelMarkers(model, IMPORT_MARKER_OWNER, [])
    importResolution = {
      sig: '',
      packageName: info.packageName,
      resolvable: new Map(),
      unresolved: new Map()
    }
    return
  }

  const names = [...new Set(info.unresolved.map((u) => u.name))]
  const sig = unresolvedSignature(names)
  if (importResolution && importResolution.sig === sig) return

  let result: Awaited<ReturnType<typeof window.api.java.resolveSymbols>>
  try {
    result = await window.api.java.resolveSymbols({
      projectId,
      packageName: info.packageName,
      symbols: names
    })
  } catch {
    return
  }
  // 过期响应丢弃（期间又有新编辑/组件卸载）
  if (seq !== importSeq || !model) return
  if (!result.ok) return

  const resolvable = new Map<string, ResolvableImport>()
  const unresolved = new Map<string, UnresolvedTypeName>()
  const markers: monaco.editor.IMarkerData[] = []

  for (const u of info.unresolved) {
    const resolved = result.data[u.name]
    const candidates =
      resolved && !resolved.samePackage
        ? resolved.candidates.filter((c) => !isCoveredByWildcard(c.fqcn, info.wildcardPackages))
        : []
    if (candidates.length === 0) {
      unresolved.set(u.name, u)
      continue
    }
    resolvable.set(u.name, { ...u, candidates })
    markers.push({
      startLineNumber: u.lineNumber,
      startColumn: u.column,
      endLineNumber: u.lineNumber,
      endColumn: u.column + u.name.length,
      severity:
        candidates.length === 1 ? monaco.MarkerSeverity.Warning : monaco.MarkerSeverity.Hint,
      message:
        candidates.length === 1
          ? t('codeEditor.missingImport', { fqcn: candidates[0].fqcn })
          : t('codeEditor.ambiguousImport', {
              name: u.name,
              n: candidates.length
            }),
      source: IMPORT_MARKER_SOURCE,
      code: u.name
    })
  }

  importResolution = { sig, packageName: info.packageName, resolvable, unresolved }
  monaco.editor.setModelMarkers(model, IMPORT_MARKER_OWNER, markers)
}

/** M4：AI 兜底只接受这些前缀的 FQCN（防幻觉硬校验） */
const AI_FQCN_ALLOWED_PREFIXES = ['net.minecraft.', 'net.fabricmc.fabric.api.', 'com.mojang.']
const FQCN_FORMAT_RE = /^[A-Za-z_]\w*(\.[A-Za-z_]\w*)+$/

/** 硬校验：格式合法 + 简单名匹配 + 前缀在 Minecraft/Fabric/项目包白名单内 */
function validateAiFqcn(name: string, fqcn: unknown, filePackage: string): fqcn is string {
  if (typeof fqcn !== 'string' || !FQCN_FORMAT_RE.test(fqcn)) return false
  if (!fqcn.endsWith(`.${name}`)) return false
  const prefixes = [...AI_FQCN_ALLOWED_PREFIXES]
  const segs = filePackage.split('.').filter(Boolean)
  if (segs.length >= 2) prefixes.push(`${segs.slice(0, -1).join('.')}.`)
  return prefixes.some((p) => fqcn.startsWith(p))
}

/** 从模型输出里抠出首个 JSON 对象（容忍 ```json 包裹与解释文字） */
function extractJsonObject(text: string): Record<string, unknown> | null {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1))
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** 构造 import 的 Monaco WorkspaceEdit；无法插入返回 null */
function buildImportWorkspaceEdit(
  targetModel: monaco.editor.ITextModel,
  fqcn: string
): monaco.languages.WorkspaceEdit | null {
  const edit = buildImportEdit(targetModel.getValue(), fqcn)
  if (!edit) return null
  const r = edit.range
  return {
    edits: [
      {
        resource: targetModel.uri,
        versionId: undefined,
        textEdit: {
          range: new monaco.Range(
            r.startLineNumber,
            r.startColumn,
            r.endLineNumber,
            r.endColumn
          ),
          text: edit.text
        }
      }
    ]
  }
}

/** 带 AI 兜底标记的 CodeAction（resolveCodeAction 阶段才真正请求 AI 并回填 edit） */
interface AiImportCodeAction extends monaco.languages.CodeAction {
  __aiSymbol?: string
  __aiPackage?: string
}

/**
 * M4：注册 Java import 快速修复（灯泡/Alt+Enter）。
 * - 唯一候选：一条 action；多候选：每个 FQCN 一条；
 * - 本地索引 0 候选：仅在用户手动触发（Alt+Enter）时提供 AI 兜底 action，
 *   resolveCodeAction 阶段发普通 chat，硬校验通过后才回填 edit，绝不自动应用。
 */
function registerImportCodeActionProvider(): void {
  /** AI FQCN 内存缓存：key = 包名::简单名 */
  const aiFqcnCache = new Map<string, string>()

  const resolveAiFqcn = async (
    name: string,
    filePackage: string,
    token: monaco.CancellationToken
  ): Promise<string | null> => {
    const cacheKey = `${filePackage}::${name}`
    const hit = aiFqcnCache.get(cacheKey)
    if (hit) return hit
    const providerId = appSettings.ai.defaultProviderId
    if (!providerId) return null

    const result = await window.api.ai.chat({
      providerId,
      temperature: 0,
      maxTokens: 200,
      messages: [
        {
          role: 'system',
          content: t('codeEditor.aiPromptSystem')
        },
        {
          role: 'user',
          content: t('codeEditor.aiPromptUser', {
            name,
            package: filePackage || t('codeEditor.defaultPackage')
          })
        }
      ]
    })
    if (token.isCancellationRequested) return null
    if (!result.ok) return null
    const json = extractJsonObject(result.data.content)
    const fqcn = json ? json['fqcn'] : null
    if (!validateAiFqcn(name, fqcn, filePackage)) return null
    aiFqcnCache.set(cacheKey, fqcn)
    return fqcn
  }

  importActionProvider = monaco.languages.registerCodeActionProvider('java', {
    provideCodeActions(targetModel, range, context) {
      if (targetModel !== model || !importResolution) {
        return { actions: [], dispose: () => {} }
      }
      const resolution = importResolution
      const actions: AiImportCodeAction[] = []
      const seen = new Set<string>()

      const pushImportActions = (name: string): void => {
        if (seen.has(name)) return
        const data = resolution.resolvable.get(name)
        if (!data) return
        seen.add(name)
        data.candidates.forEach((c, i) => {
          const edit = buildImportWorkspaceEdit(targetModel, c.fqcn)
          if (!edit) return
          actions.push({
            title:
              data.candidates.length === 1
                ? t('codeEditor.importAction', { fqcn: c.fqcn })
                : t('codeEditor.importActionCandidate', {
                    fqcn: c.fqcn,
                    index: i + 1,
                    total: data.candidates.length
                  }),
            kind: 'quickfix',
            isPreferred: data.candidates.length === 1 && i === 0,
            edit
          })
        })
      }

      const pushAiFallback = (name: string): void => {
        if (seen.has(name)) return
        if (!resolution.unresolved.has(name)) return
        if (!appSettings.ai.cue.javaImportAiFallback || !appSettings.ai.defaultProviderId) return
        seen.add(name)
        actions.push({
          title: t('codeEditor.aiResolveAction', { name }),
          kind: 'quickfix',
          isAI: true,
          __aiSymbol: name,
          __aiPackage: resolution.packageName
        })
      }

      // 灯泡由 marker 自动触发：marker.code 存了符号名（0 候选符号无 marker，不会自动弹）
      for (const marker of context.markers) {
        if (marker.source !== IMPORT_MARKER_SOURCE) continue
        const code =
          typeof marker.code === 'string'
            ? marker.code
            : marker.code && typeof marker.code === 'object' && 'value' in marker.code
              ? String((marker.code as { value: unknown }).value)
              : ''
        if (code) pushImportActions(code)
      }

      // Alt+Enter 手动触发（无 marker 场景）：取光标所在词，本地候选优先，0 候选再走 AI 兜底
      if (
        context.trigger === monaco.languages.CodeActionTriggerType.Invoke &&
        actions.length === 0
      ) {
        const word = targetModel.getWordAtPosition(range.getStartPosition())
        if (word) {
          pushImportActions(word.word)
          pushAiFallback(word.word)
        }
      }

      return { actions, dispose: () => {} }
    },

    async resolveCodeAction(codeAction: AiImportCodeAction, token) {
      const name = codeAction.__aiSymbol
      const filePackage = codeAction.__aiPackage ?? ''
      if (!name || !model) return codeAction
      try {
        const fqcn = await resolveAiFqcn(name, filePackage, token)
        if (!fqcn || !model) {
          return {
            ...codeAction,
            disabled: t('codeEditor.aiUnresolved')
          }
        }
        const edit = buildImportWorkspaceEdit(model, fqcn)
        if (!edit) return { ...codeAction, disabled: t('codeEditor.cannotInsertImport') }
        return {
          ...codeAction,
          title: t('codeEditor.aiResolvedAction', { fqcn }),
          edit
        }
      } catch (e) {
        return {
          ...codeAction,
          disabled: t('codeEditor.aiResolveFailed', {
            message: e instanceof Error ? e.message : String(e)
          })
        }
      }
    }
  })
}

/** codeActionController 未暴露在 monaco 公共 d.ts 中，按需取最小结构 */
interface CodeActionControllerLike {
  manualTriggerAtCurrentPosition(
    notAvailableMessage: string,
    triggerAction: string,
    filter: unknown,
    autoApply: unknown
  ): void
}

/**
 * M4：Alt+Enter 手动唤起快速修复（marker 文案中承诺的快捷键）。
 * Monaco 内置 QuickFix 只绑 Ctrl+.，这里补 Alt+Enter 走同一 controller。
 */
function registerQuickFixAction(): void {
  if (!editor) return
  quickFixAction = editor.addAction({
    id: 'kunyu.action.quickFix',
    label: t('codeEditor.quickFix'),
    keybindings: [monaco.KeyMod.Alt | monaco.KeyCode.Enter],
    run(ed) {
      const controller = ed.getContribution(
        'editor.contrib.codeActionController'
      ) as unknown as CodeActionControllerLike | null
      controller?.manualTriggerAtCurrentPosition(
        t('codeEditor.noQuickFix'),
        'quickFix',
        undefined,
        undefined
      )
    }
  })
}

/**
 * 注册 CUE 代码补全（M1）。settings.ai.cue 或默认提供商变化时调用：
 * 先 dispose 旧 handle（取消进行中请求 + 反注册旧语言），再按最新设置注册。
 * languages 变化也走这条路径（registerInlineCompletionsProvider 按语言注册）。
 */
/** M3：由绝对路径与项目根计算正斜杠相对路径（供 cueContext 排除当前文件）；不在项目内返回 null */
function toProjectRelPath(absPath: string, rootPath: string | undefined): string | null {
  if (!rootPath) return null
  const normAbs = absPath.replace(/\\/g, '/')
  const normRoot = rootPath.replace(/\\/g, '/').replace(/\/+$/, '')
  if (!normAbs.toLowerCase().startsWith(normRoot.toLowerCase() + '/')) return null
  return normAbs.slice(normRoot.length + 1)
}

function setupCue(): void {
  if (cueHandle) {
    cueHandle.dispose()
    cueHandle = null
  }
  disposeChangePoints()
  const cue = appSettings.ai.cue
  if (!cue.enabled) return
  cueHandle = registerCue({
    settings: cue,
    defaultProviderId: appSettings.ai.defaultProviderId,
    modelOverride: cue.model,
    projectId: projectStore.currentProject?.id ?? null,
    relPath: toProjectRelPath(props.path, projectStore.currentProject?.path)
  })
  setupChangePoints(cue)
}

/**
 * M2：创建修改点跟踪器。仅 Java 接 lint marker owner（'kunyu-java-lint'），
 * 其他语言仍跟踪最近编辑行。
 */
function setupChangePoints(cue: CueSettings): void {
  if (!editor || !cueHandle || !cue.changePointsEnabled) return
  cpTracker = createChangePointTracker(editor, {
    markerOwners: props.language === 'java' ? ['kunyu-java-lint'] : [],
    jumpAfterAccept: cue.jumpAfterAccept,
    getLastSuggestion: () => cueHandle?.getLastSuggestion() ?? null,
    consumeSuggestion: () => cueHandle?.consumeSuggestion(),
    // M3b：链式补全——跳点后自动唤起下一补全
    onAfterJump: cue.chainAfterJump
      ? () => {
          if (!editor) return
          editor.trigger('cue-chain', 'editor.action.inlineSuggest.trigger', null)
        }
      : undefined
  })
  cpTracker.refresh()
  // DEV-only：暴露修改点跟踪器供 CDP 验证脚本（M3b 链式补全真机验证）
  if (import.meta.env.DEV) {
    ;(window as unknown as Record<string, unknown>).__kyCpTracker = cpTracker
  }
}

function disposeChangePoints(): void {
  cpTracker?.dispose()
  cpTracker = null
}

/** 外部跳转：定位到指定行列 */
function revealPosition(line: number, column: number): void {
  editor?.revealPositionInCenter({ lineNumber: line, column })
  editor?.setPosition({ lineNumber: line, column })
  editor?.focus()
}

/** T2.5：停止流式揭示动画（新内容到来/组件卸载/再次写入时调用） */
function stopStream(): void {
  if (streamTimer) {
    clearInterval(streamTimer)
    streamTimer = null
  }
}

/**
 * 伪流式：把 fullContent 按行渐进铺开（约 1.4s 播完），呈现
 * 「AI 正在写代码」的观感。全程视为外部写入（applyingExternal），不触发自动保存/change 回写；
 * tab.content 已是完整内容，动画只是呈现层效果。
 */
function startStreamReveal(fullContent: string): void {
  if (!editor || !model) return
  stopStream()
  applyingExternal = true
  const lines = fullContent.split('\n')
  editor.setValue('')
  // 总时长约 1.4s：40ms 一拍共 35 拍，每拍行数按总量均摊（至少 1 行）
  const perTick = Math.max(1, Math.ceil(lines.length / 35))
  let shown = 0
  streamTimer = setInterval(() => {
    if (!editor || !model) {
      stopStream()
      applyingExternal = false
      return
    }
    shown = Math.min(lines.length, shown + perTick)
    editor.setValue(lines.slice(0, shown).join('\n'))
    editor.revealLine(model.getLineCount())
    if (shown >= lines.length) {
      stopStream()
      applyingExternal = false
      runDiagnostics(fullContent)
    }
  }, 40)
}

defineExpose({ revealPosition })

/** 保存时的快捷键（Ctrl+S） */
function onKeyDown(e: monaco.IKeyboardEvent): void {
  if ((e.ctrlKey || e.metaKey) && e.keyCode === monaco.KeyCode.KeyS) {
    e.preventDefault()
    void editorStore.saveActive()
  }
}

onMounted(() => {
  // T2.5：agent file-written 打开的新 tab 先空挂（初始值 ''），挂载后消费标记播按行铺开动画
  const streamPending = editorStore.peekStreamReveal(props.path)
  createEditor(streamPending ? '' : undefined)
  editor?.onKeyDown(onKeyDown)
  // M2：修改点跳转 Alt+]（下一处）/ Alt+[（上一处）；tracker 不存在时 no-op
  editor?.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.BracketRight, () => cpTracker?.next())
  editor?.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.BracketLeft, () => cpTracker?.prev())
  // M4：Java import 灯泡（Alt+Enter）
  registerImportCodeActionProvider()
  registerQuickFixAction()
  runDiagnostics(props.content)
  // 挂载后立即消费外部跳转（问题列表点击时编辑器可能尚未创建）
  const pending = editorStore.consumePendingReveal(props.path)
  if (pending) revealPosition(pending.line, pending.column)
  // 注册 CUE 代码补全（settings.ai.cue 已通过 store hydrate 就绪）
  setupCue()
  // T2.5：消费流式揭示标记——有效则播动画；已过期（>4s）直接呈现完整内容
  if (streamPending && editorStore.consumeStreamReveal(props.path)) {
    startStreamReveal(props.content)
  } else if (streamPending) {
    applyingExternal = true
    try {
      editor?.setValue(props.content)
    } finally {
      applyingExternal = false
    }
  }
})

// 已挂载状态下收到新的跳转请求
watch(
  () => editorStore.pendingReveal,
  (pending) => {
    if (!pending || pending.path !== props.path) return
    const target = editorStore.consumePendingReveal(props.path)
    if (target) revealPosition(target.line, target.column)
  }
)

// 标签内容变化（含磁盘外部重载）时更新模型；标记为外部写入避免触发自动保存
watch(
  () => props.content,
  (newContent) => {
    if (!editor) return
    stopStream()
    // T2.5：agent file-written 驱动的刷新带标记 → 播按行铺开动画（末尾自跑诊断）
    if (editorStore.consumeStreamReveal(props.path)) {
      startStreamReveal(newContent)
      runDiagnostics(newContent)
      return
    }
    if (editor.getValue() !== newContent) {
      applyingExternal = true
      try {
        editor.setValue(newContent)
      } finally {
        applyingExternal = false
      }
    }
    runDiagnostics(newContent)
  }
)

watch(
  () => props.language,
  (lang) => {
    if (model) monaco.editor.setModelLanguage(model, lang)
    // M2：markerOwners 按语言变化（仅 java 接 kunyu-java-lint），重建 tracker
    if (cueHandle && appSettings.ai.cue.changePointsEnabled) {
      disposeChangePoints()
      setupChangePoints(appSettings.ai.cue)
    }
  }
)

// 编辑器设置变化即时生效（M6）
watch(
  () => appSettings.editor,
  (es) => {
    if (editor) {
      editor.updateOptions({
        fontFamily: es.fontFamily,
        fontSize: es.fontSize,
        wordWrap: es.wordWrap ? 'on' : 'off',
        lineNumbers: es.lineNumbers ? 'on' : 'off'
      })
    }
    if (model) model.updateOptions({ tabSize: es.tabSize, insertSpaces: es.insertSpaces })
  },
  { deep: true }
)

// AI 设置（cue 子节 + 默认提供商）变化时重注册 CUE
watch(
  () => appSettings.ai,
  () => setupCue(),
  { deep: true }
)

// M4：Java 智能 import 开关切换即时清理/重算
watch(
  () => appSettings.ai.cue.javaAutoImport,
  (on) => {
    if (!on) {
      clearImportDiagnostics()
    } else if (model) {
      void updateImportDiagnostics(model.getValue())
    }
  }
)

onBeforeUnmount(() => {
  if (changeTimer) clearTimeout(changeTimer)
  stopStream()
  // 使尚在途中的 M4 IPC 响应失效
  importSeq += 1
  importActionProvider?.dispose()
  importActionProvider = null
  quickFixAction?.dispose()
  quickFixAction = null
  importResolution = null
  disposeChangePoints()
  cueHandle?.dispose()
  cueHandle = null
  editor?.dispose()
  editor = null
  model = null
})
</script>

<style scoped>
.code-editor {
  width: 100%;
  height: 100%;
}
</style>

<style>
/* M2：CUE 修改点装饰器必须全局生效（Monaco glyph margin / 行槽在组件 DOM 之外的层级渲染），不能加 scoped */
/* glyphMarginClassName 挂在 .cgmr（codicon glyph row），容器是 .glyph-margin-widgets */
.monaco-editor .cgmr.cue-cp-glyph {
  cursor: pointer;
  z-index: 5;
  text-align: center;
}
.monaco-editor .cgmr.cue-cp-glyph::before {
  content: '⇥';
  font-size: 12px;
  font-weight: 700;
  line-height: 18px;
  color: var(--ky-accent);
  opacity: 0.55;
  text-shadow: 0 0 4px rgba(var(--ky-accent-rgb), 0.35);
}
.monaco-editor .cgmr.cue-cp-glyph.is-active::before {
  opacity: 1;
  color: var(--ky-accent-hover);
  text-shadow: 0 0 8px rgba(var(--ky-accent-rgb), 0.9);
  transform: scale(1.15);
}
/* 当前修改点行首竖条：linesDecorationsClassName 挂在 .cldr 上 */
.monaco-editor .cldr.cue-cp-line-deco {
  background: linear-gradient(to bottom, rgba(var(--ky-accent-rgb), 0), var(--ky-accent), rgba(var(--ky-accent-rgb), 0));
  width: 3px !important;
  margin-left: 2px;
  border-radius: 2px;
  box-shadow: 0 0 6px rgba(var(--ky-accent-rgb), 0.8);
}
/* 当前修改点行背景：isWholeLine 的 className 实际落在 .view-overlays 内的 .cdr 覆盖层（非 .view-line） */
.monaco-editor .view-overlays .cdr.cue-cp-active-line {
  background-color: rgba(var(--ky-accent-rgb), 0.12) !important;
}
</style>
