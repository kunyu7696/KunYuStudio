import * as monaco from 'monaco-editor'

// 通过 Vite 的 new URL(..., import.meta.url) 机制将 Monaco worker 打包为独立资源。
// 在 Electron 渲染进程中以 module worker 形式加载，避免 ?worker 查询在
// electron-vite 构建中无法解析的问题。
self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string): Worker {
    const workerPath =
      label === 'json'
        ? 'monaco-editor/esm/vs/language/json/json.worker.js'
        : 'monaco-editor/esm/vs/editor/editor.worker.js'
    return new Worker(new URL(workerPath, import.meta.url), { type: 'module' })
  }
}

/** 自定义主题（适配深色灰调背景） */
monaco.editor.defineTheme('kunyu-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '8b909a', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'cba6f7' },
    { token: 'string', foreground: 'a6e3a1' },
    { token: 'number', foreground: 'fab387' },
    { token: 'type', foreground: '89b4fa' },
    { token: 'class', foreground: '89b4fa' },
    { token: 'function', foreground: '89dceb' },
    { token: 'variable', foreground: 'e8eaed' },
    { token: 'annotation', foreground: 'f9e2af' }
  ],
  colors: {
    'editor.background': '#27292e',
    'editor.foreground': '#e8eaed',
    'editor.lineHighlightBackground': '#2f3238',
    'editorLineNumber.foreground': '#6b7078',
    'editorLineNumber.activeForeground': '#e8eaed',
    'editorCursor.foreground': '#ffffff',
    'editor.selectionBackground': '#3f444c',
    'editor.inactiveSelectionBackground': '#34383e',
    'editorIndentGuide.background': '#383b41',
    'editorIndentGuide.activeBackground': '#52565d',
    'editorGutter.background': '#27292e',
    'editorWidget.background': '#212327',
    'editorWidget.border': '#45494f',
    'editorError.foreground': '#f87171',
    'editorWarning.foreground': '#fbbf24'
  }
})

/** 浅色主题（经典浅白：白底 + 高对比语法色） */
monaco.editor.defineTheme('kunyu-light', {
  base: 'vs',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '888e98', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'a626a4' },
    { token: 'string', foreground: '50a14f' },
    { token: 'number', foreground: '986801' },
    { token: 'type', foreground: '4078f2' },
    { token: 'class', foreground: '4078f2' },
    { token: 'function', foreground: 'c18401' },
    { token: 'variable', foreground: '383a42' },
    { token: 'annotation', foreground: 'b76b01' }
  ],
  colors: {
    'editor.background': '#ffffff',
    'editor.foreground': '#1f2329',
    'editor.lineHighlightBackground': '#f0f1f3',
    'editorLineNumber.foreground': '#9aa0a8',
    'editorLineNumber.activeForeground': '#1f2329',
    'editorCursor.foreground': '#2979ff',
    'editor.selectionBackground': '#c7dbff',
    'editor.inactiveSelectionBackground': '#e3eaff',
    'editorIndentGuide.background': '#e3e5e8',
    'editorIndentGuide.activeBackground': '#c9ccd1',
    'editorGutter.background': '#ffffff',
    'editorWidget.background': '#ffffff',
    'editorWidget.border': '#d8dade',
    'editorError.foreground': '#e0564f',
    'editorWarning.foreground': '#c07f00'
  }
})

/** 按应用当前主题（html.light / html.dark）返回对应 Monaco 主题名 */
export function currentMonacoTheme(): 'kunyu-dark' | 'kunyu-light' {
  return document.documentElement.classList.contains('light') ? 'kunyu-light' : 'kunyu-dark'
}

// 主题联动：theme.ts 通过切换 html 的 light/dark class 应用主题，
// 这里监听 class 变化全局同步 Monaco 主题，所有编辑器实例即时生效。
new MutationObserver(() => {
  monaco.editor.setTheme(currentMonacoTheme())
}).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })

export { monaco }
