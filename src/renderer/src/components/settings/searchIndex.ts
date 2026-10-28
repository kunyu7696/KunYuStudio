/** 设置项搜索索引：与各 Pane 中 data-setting-id 一一对应 */
export interface SettingIndexEntry {
  /** 对应模板中的 data-setting-id */
  id: string
  /** 所属分类（components/settings/category.ts 的 id） */
  category: string
  /** 所在分组小标题的 i18n 键（如 settings.appearance） */
  sectionKey: string
  /** 设置项名称的 i18n 键（与各 Pane 行 label 同源） */
  labelKey: string
  /** 额外检索词：中英文别名、常见叫法（不含 label 本身；展示时走 labelKey） */
  keywords: string[]
}

export const SETTINGS_INDEX: SettingIndexEntry[] = [
  // ---------- 通用 ----------
  {
    id: 'general-theme-mode',
    category: 'general',
    sectionKey: 'settings.appearance',
    labelKey: 'settings.themeMode',
    keywords: ['theme', 'dark', 'light', '深色', '浅色', '跟随系统', '外观', 'system']
  },
  {
    id: 'general-zoom-level',
    category: 'general',
    sectionKey: 'settings.common',
    labelKey: 'settings.zoom',
    keywords: ['zoom', 'scale', '缩放', '放大', '缩小', 'dpi']
  },
  {
    id: 'general-restore-last-project',
    category: 'general',
    sectionKey: 'settings.common',
    labelKey: 'settings.restoreLast',
    keywords: ['restore', 'reopen', '启动', '恢复', '上次项目', '最近项目', 'startup']
  },
  {
    id: 'general-autosave',
    category: 'general',
    sectionKey: 'settings.common',
    labelKey: 'settings.autosave',
    keywords: ['autosave', 'auto save', '保存', '写盘']
  },
  {
    id: 'general-activity-modules',
    category: 'general',
    sectionKey: 'settings.activityModules',
    labelKey: 'settings.activityModules',
    keywords: ['activity bar', 'sidebar', 'hide module', '活动栏', '侧栏', '隐藏模块', '恢复模块']
  },

  // ---------- 编辑器 ----------
  {
    id: 'editor-font-family',
    category: 'editor',
    sectionKey: 'settings.appearance',
    labelKey: 'settings.editor.fontFamily',
    keywords: ['font', 'font family', '字体', '等宽', 'monospace']
  },
  {
    id: 'editor-font-size',
    category: 'editor',
    sectionKey: 'settings.appearance',
    labelKey: 'settings.editor.fontSize',
    keywords: ['font', 'font size', '字号', '大小', '像素']
  },
  {
    id: 'editor-tab-size',
    category: 'editor',
    sectionKey: 'settings.editor.indent',
    labelKey: 'settings.editor.tabSize',
    keywords: ['tab', 'tabSize', '缩进', '制表符', 'indent']
  },
  {
    id: 'editor-insert-spaces',
    category: 'editor',
    sectionKey: 'settings.editor.indent',
    labelKey: 'settings.editor.insertSpaces',
    keywords: ['spaces', 'insertSpaces', '空格', '制表符', '缩进', 'indent']
  },
  {
    id: 'editor-word-wrap',
    category: 'editor',
    sectionKey: 'settings.editor.display',
    labelKey: 'settings.editor.wordWrap',
    keywords: ['wrap', 'wordWrap', '换行', '折行', '软换行']
  },
  {
    id: 'editor-line-numbers',
    category: 'editor',
    sectionKey: 'settings.editor.display',
    labelKey: 'settings.editor.lineNumbers',
    keywords: ['line number', '行号', 'gutter']
  },

  // ---------- 运行环境 ----------
  {
    id: 'runtime-target-version',
    category: 'runtime',
    sectionKey: 'settings.runtime.prepare',
    labelKey: 'settings.runtime.targetVersion',
    keywords: ['minecraft', 'mc', '版本', 'version', '目标版本', '运行环境', 'target version']
  },
  {
    id: 'runtime-jdk-status',
    category: 'runtime',
    sectionKey: 'settings.runtime.prepare',
    labelKey: 'settings.runtime.jdkLabel',
    keywords: ['jdk', 'java', '运行环境', '版本', '检测', '全局', '选择', '切换', '设为当前', 'java 路径', 'global']
  },
  {
    id: 'runtime-prepare',
    category: 'runtime',
    sectionKey: 'settings.runtime.prepare',
    labelKey: 'settings.runtime.prepareBtn',
    keywords: ['prepare', '一键准备', '下载', '安装', '首启', '联网下载', '向导', '引导器', 'setup']
  },
  {
    id: 'runtime-instances',
    category: 'runtime',
    sectionKey: 'settings.runtime.instances',
    labelKey: 'settings.runtime.instances',
    keywords: ['instance', '实例', '托管', '启动', '删除', '运行环境', 'launch', 'runtime']
  },
  {
    id: 'java-gradle-memory',
    category: 'runtime',
    sectionKey: 'settings.runtime.gradleMemory',
    labelKey: 'settings.runtime.maxHeap',
    keywords: ['gradle', 'memory', 'xmx', '内存', '堆', 'jvm', 'heap']
  },

  // ---------- 网络 ----------
  {
    id: 'network-mirror',
    category: 'network',
    sectionKey: 'settings.network.mirror',
    labelKey: 'settings.network.mirrorSource',
    keywords: ['mirror', '镜像', 'maven', 'gradle', '国内镜像', '官方源', '阿里云', '腾讯云']
  },
  {
    id: 'network-proxy-mode',
    category: 'network',
    sectionKey: 'settings.network.proxy',
    labelKey: 'settings.network.httpProxy',
    keywords: ['proxy', '代理', 'http', '系统代理', '自定义代理', 'system proxy']
  },
  {
    id: 'network-proxy-host',
    category: 'network',
    sectionKey: 'settings.network.proxy',
    labelKey: 'settings.network.host',
    keywords: ['proxy host', '代理主机', '主机地址', '127.0.0.1', 'host']
  },
  {
    id: 'network-proxy-port',
    category: 'network',
    sectionKey: 'settings.network.proxy',
    labelKey: 'settings.network.port',
    keywords: ['proxy port', '代理端口', 'port']
  },
  {
    id: 'network-timeout',
    category: 'network',
    sectionKey: 'settings.network.timeout',
    labelKey: 'settings.network.reqTimeout',
    keywords: ['timeout', '超时', '请求中断']
  },

  // ---------- 模组市场 ----------
  {
    id: 'marketplace-curseforge-api-key',
    category: 'marketplace',
    sectionKey: 'settings.marketplace.credentials',
    labelKey: 'settings.search.cfApiKey',
    keywords: ['curseforge', 'api key', '密钥', '凭证', 'cf key', 'token']
  },
  {
    id: 'marketplace-allow-cf-mirror',
    category: 'marketplace',
    sectionKey: 'settings.marketplace.mirror',
    labelKey: 'settings.marketplace.allowMcim',
    keywords: ['mcim', '镜像', 'mirror', 'curseforge 镜像', '第三方镜像']
  },
  {
    id: 'marketplace-modrinth',
    category: 'marketplace',
    sectionKey: 'settings.search.modrinth',
    labelKey: 'settings.search.modrinth',
    keywords: ['modrinth', '模组平台', '开放 api']
  },

  // ---------- 发布 ----------
  {
    id: 'publish-modrinth-token',
    category: 'publish',
    sectionKey: 'settings.search.modrinth',
    labelKey: 'settings.publish.mrToken',
    keywords: ['modrinth', 'token', 'pat', '令牌', '发布', 'personal access token']
  },
  {
    id: 'publish-modrinth-project-id',
    category: 'publish',
    sectionKey: 'settings.search.modrinth',
    labelKey: 'settings.publish.mrProjectId',
    keywords: ['modrinth', 'project', 'slug', '项目', 'id']
  },
  {
    id: 'publish-curseforge-token',
    category: 'publish',
    sectionKey: 'settings.search.curseforge',
    labelKey: 'settings.publish.cfToken',
    keywords: ['curseforge', 'token', 'api', '令牌', '发布']
  },
  {
    id: 'publish-curseforge-project-id',
    category: 'publish',
    sectionKey: 'settings.search.curseforge',
    labelKey: 'settings.publish.cfProjectId',
    keywords: ['curseforge', 'project', '项目', 'id']
  },
  {
    id: 'publish-default-release-type',
    category: 'publish',
    sectionKey: 'settings.common',
    labelKey: 'settings.publish.defaultReleaseType',
    keywords: ['release', 'beta', 'alpha', '发布类型', '正式版', '测试版', '内测版', 'release type']
  },

  // ---------- 集成 ----------
  {
    id: 'integration-agent-codex',
    category: 'integration',
    sectionKey: 'settings.integration.agentSection',
    labelKey: 'settings.search.codexCli',
    keywords: ['codex', 'cli', 'agent', '外部工具', '路径', 'external']
  },
  {
    id: 'integration-agent-claude-code',
    category: 'integration',
    sectionKey: 'settings.integration.agentSection',
    labelKey: 'settings.search.claudeCode',
    keywords: ['claude', 'claude code', 'cli', 'agent', '外部工具', '路径', 'external']
  },
  {
    id: 'integration-mcp-bridge-enabled',
    category: 'integration',
    sectionKey: 'settings.integration.bridgeSection',
    labelKey: 'settings.integration.bridgeSection',
    keywords: ['mcp', 'bridge', '桥接', 'server', '启用桥接']
  },
  {
    id: 'integration-mcp-bridge-port',
    category: 'integration',
    sectionKey: 'settings.integration.bridgeSection',
    labelKey: 'settings.integration.port',
    keywords: ['mcp', 'port', '端口', '随机端口']
  },
  {
    id: 'integration-mcp-auth-mode',
    category: 'integration',
    sectionKey: 'settings.integration.bridgeSection',
    labelKey: 'settings.integration.authMode',
    keywords: ['auth', '授权', '权限', '每次都询问', 'session', 'ask every time']
  },

  // ---------- AI 助手 ----------
  {
    id: 'ai-default-provider',
    category: 'ai',
    sectionKey: 'settings.ai.providerSection',
    labelKey: 'settings.ai.defaultProvider',
    keywords: ['provider', '默认', '厂商', 'openai', 'ollama', 'api key', '模型', 'model']
  },
  {
    id: 'ai-tier-models',
    category: 'ai',
    sectionKey: 'settings.ai.tierSection',
    labelKey: 'settings.ai.tierSection',
    keywords: ['tier', '档位', '模型覆盖', 'model', 'override']
  },
  {
    id: 'ai-mcp-enabled',
    category: 'ai',
    sectionKey: 'settings.ai.mcp.section',
    labelKey: 'settings.ai.mcp.section',
    keywords: ['mcp', 'mcdev', '静态检索', '源码索引', '映射', 'static index']
  },
  {
    id: 'ai-cue-enabled',
    category: 'ai',
    sectionKey: 'settings.ai.cue.section',
    labelKey: 'settings.ai.cue.section',
    keywords: ['cue', '补全', 'inline', 'fim', 'tab', '代码提示', 'completion']
  },
  {
    id: 'ai-cue-change-points',
    category: 'ai',
    sectionKey: 'settings.ai.cue.section',
    labelKey: 'settings.ai.cue.changePoints',
    keywords: ['change points', '修改点', '导航', '跳转']
  },
  {
    id: 'ai-cue-jump-after-accept',
    category: 'ai',
    sectionKey: 'settings.ai.cue.section',
    labelKey: 'settings.ai.cue.jumpAfterAccept',
    keywords: ['jump', '自动跳转', '补全']
  },
  {
    id: 'ai-cue-java-auto-import',
    category: 'ai',
    sectionKey: 'settings.ai.cue.section',
    labelKey: 'settings.ai.cue.javaImport',
    keywords: ['import', 'java', '导入', '灯泡']
  },
  {
    id: 'ai-cue-java-import-ai-fallback',
    category: 'ai',
    sectionKey: 'settings.ai.cue.section',
    labelKey: 'settings.ai.cue.importAiFallback',
    keywords: ['import', 'ai 兜底', '全限定名', 'ai fallback']
  },
  {
    id: 'ai-cue-repo-context',
    category: 'ai',
    sectionKey: 'settings.ai.cue.section',
    labelKey: 'settings.ai.cue.repoContext',
    keywords: ['repo context', '仓库上下文', '检索', 'rag']
  },
  {
    id: 'ai-cue-chain-after-jump',
    category: 'ai',
    sectionKey: 'settings.ai.cue.section',
    labelKey: 'settings.ai.cue.chain',
    keywords: ['chain', '链式补全', '连续补全']
  },
  {
    id: 'ai-observer-agent',
    category: 'ai',
    sectionKey: 'settings.ai.observer.section',
    labelKey: 'settings.ai.observer.statusLabel',
    keywords: ['observer', 'javaagent', '探针', '真机', '截图', 'probe']
  },
  {
    id: 'ai-visual-review',
    category: 'ai',
    sectionKey: 'settings.ai.visualReviewSection',
    labelKey: 'settings.ai.visualReviewSection',
    keywords: ['visual', '视觉', '自审', '截图', '评分', 'review']
  },
  {
    id: 'ai-custom-mcp-servers',
    category: 'ai',
    sectionKey: 'settings.ai.customMcp.section',
    labelKey: 'settings.ai.customMcp.section',
    keywords: ['mcp', 'server', 'stdio', '自定义', '工具', 'custom']
  }
]
