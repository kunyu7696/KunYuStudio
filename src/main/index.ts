import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { registerIpcHandlers } from './ipc'
import { getAllSettings, initSettings } from './services/settingsService'
import { getDb } from './services/db'
import { createAgentRunStore } from './services/agentRunStore'
import { initAiRuntime } from './services/ai/bootstrap'
import { getAllProjects } from './services/projectService'
import { registerProjectRoot } from './services/fsService'
import { setupCommunitySession, COMMUNITY_PARTITION, isAllowedCommunityUrl } from './services/communitySession'
import { initUpdater } from './services/updaterService'
import { migrateLegacyUserDataIfNeeded } from './services/userDataMigration'
import { isPackagedRuntime } from './runtimeEnv'

// 品牌改名（KunYuEcosystem → KunYu Studio）：打包版 userData 跟随 productName 换目录，
// 若新目录不存在而旧目录在，整体 rename 接管旧用户数据；仅打包版执行，失败不阻断启动。
// 必须在 app ready 之前、settings/db 等任何 userData 读写之前执行。
migrateLegacyUserDataIfNeeded()

// 开发环境下将 userData 重定向到工作区内，避免沙箱对 AppData 的写入限制
if (process.env['ELECTRON_RENDERER_URL']) {
  app.setPath('userData', join(process.cwd(), '.dev-userdata'))
  // CDP 调试端口：命令行已显式传入（--remote-debugging-port）时不重复追加，
  // 否则同一 switch 出现两次会导致 DevTools bind 冲突、HTTP 服务起不来。
  // KY_NO_CDP=1 显式关闭：Cloudflare Turnstile 会探测本机调试端口并判定
  // 嵌入式浏览器不可信，社区桥接人机验证排查期间用该开关做干净环境对照。
  if (process.env['KY_NO_CDP'] !== '1' && !app.commandLine.hasSwitch('remote-debugging-port')) {
    app.commandLine.appendSwitch('remote-debugging-port', process.env['KY_CDP_PORT'] || '19222')
  }
}

// 主进程未捕获异常兜底：记录并保持运行，不让 Electron 弹「A JavaScript error occurred
// in the main process」崩溃框。已知场景：undici TLS 连接中途对端关闭时内部断言
// assert(this.paused) 抛错（Node 已知 bug），该错误不中断业务，由请求方按超时/重试兜底。
process.on('uncaughtException', (err) => {
  console.error('[main] 未捕获异常（已兜底，应用继续运行）:', err)
})
process.on('unhandledRejection', (reason) => {
  console.error('[main] 未处理的 Promise 拒绝（已兜底）:', reason)
})

// 无 GPU 会话（RDP/服务型会话/CI 代理启动）下 Chromium GPU 进程会 FATAL 退出；
// 仅当显式设置 KY_DISABLE_GPU=1 时软件渲染（须在 app ready 前调用）
if (process.env['KY_DISABLE_GPU'] === '1') {
  app.disableHardwareAcceleration()
  // 受限会话中 Chromium sandbox/GPU 子进程无法初始化（STATUS_BREAKPOINT），
  // 彻底关闭 GPU 进程；仅本机驱动探针等自动化场景使用。
  app.commandLine.appendSwitch('disable-gpu')
  app.commandLine.appendSwitch('disable-gpu-process')
  // --no-sandbox 只允许在未打包（开发/自动化）环境追加；
  // 打包产物即便设置了 KY_DISABLE_GPU 也不得关闭沙箱。
  if (!isPackagedRuntime(app)) {
    app.commandLine.appendSwitch('no-sandbox')
  }
}

let mainWindow: BrowserWindow | null = null

// 单实例锁：重复启动时不新建实例，而是聚焦已有窗口
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) void win.restore()
      win.show()
      win.focus()
    }
  })
}

// 窗口图标：dev 读工作区资源，打包后读 extraResources 拷贝的 icon.png
function windowIconPath(): string {
  return isPackagedRuntime(app)
    ? join(process.resourcesPath, 'icon.png')
    : join(process.cwd(), 'resources', 'build', 'icon.png')
}

function createWindow(): void {
  // 安全收紧：webSecurity 仅在开发模式放宽（Vite dev server 跨域资源），
  // 生产打包后必须启用同源策略；CSP 由 renderer/index.html 的 meta 标签统一声明
  const isDev = Boolean(process.env['ELECTRON_RENDERER_URL'])
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    backgroundColor: '#11111b',
    autoHideMenuBar: true,
    // 无边框窗口：去除系统白色标题栏，最小化/最大化/关闭由渲染层 TopBar 提供。
    // macOS 改用 hiddenInset：frame:false 会把红绿灯按钮一并去掉（mac 用户习惯左上加关闭），
    // hiddenInset 保留红绿灯并内嵌进 TopBar，渲染层 darwin 下左侧留出安全区
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const }
      : { frame: false as const }),
    title: 'KunYu Studio',
    icon: windowIconPath(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // 安全收紧：preload 已是纯 contextBridge + ipcRenderer 白名单桥（无 Node API），
      // 渲染进程开启 Chromium 沙箱；preload 构建输出同步固定为 CJS（沙箱不支持 ESM preload）
      sandbox: true,
      webSecurity: !isDev,
      // 社区桥接使用 <webview> 内嵌浏览（独立 webContents，不共享主应用权限）
      webviewTag: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.webContents.setZoomFactor(getAllSettings().general.zoomLevel)
    mainWindow?.show()
  })

  // 外部链接交给系统浏览器，不在应用内打开新窗口。
  // 与 SHELL_OPEN_EXTERNAL 一致做协议白名单，拒绝 file://、smb://、自定义协议等
  // 离开浏览器沙盒的 URL（setWindowOpenHandler 无法分辨 window.open 的调用来源）。
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  // 主窗口是 Vue SPA，正常运行不发生整页导航（路由全在渲染层 history API 内）。
  // 禁止顶层导航可阻止渲染层被诱导跳转到外部页面后，preload 重新注入到不可信内容。
  // 开发环境仅放行 Vite dev server 同源（HMR/错误覆盖层可能触发），其余一律阻止。
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (devUrl) {
      if (!url.startsWith(devUrl)) event.preventDefault()
    } else {
      event.preventDefault()
    }
  })

  // 社区桥接 <webview> 挂载闸门（在 attach 发生前强制收敛 webPreferences）：
  // 1) src 仅允许 https + 平台白名单主机，防止渲染层被诱导挂载任意页面；
  // 2) 剥离 preload（否则渲染层可向访客页注入任意脚本桥），强制沙箱 + 上下文隔离；
  // 3) 分区强制锁定为 persist:community，避免访客页落进默认分区的持久会话。
  mainWindow.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    const src = String(params['src'] ?? '')
    if (src && !isAllowedCommunityUrl(src)) {
      event.preventDefault()
      console.warn('[security] 拒绝挂载 webview：地址不在社区白名单内', src)
      return
    }
    delete webPreferences.preload
    webPreferences.nodeIntegration = false
    webPreferences.nodeIntegrationInSubFrames = false
    webPreferences.contextIsolation = true
    webPreferences.sandbox = true
    webPreferences.webSecurity = true
    webPreferences.allowRunningInsecureContent = false
    webPreferences.experimentalFeatures = false
    params['partition'] = COMMUNITY_PARTITION
  })

  // 社区桥接 <webview> 安全策略（对所有 webview 类型 webContents 生效）：
  // 1) 站内/第三方 window.open、target=_blank 不弹新窗口，改为在当前 webview 内导航；
  // 2) 仅允许 http(s)，拒绝 file://、smb://、自定义协议等离开浏览器沙盒的尝试。
  app.on('web-contents-created', (_event, contents) => {
    if (contents.getType() !== 'webview') return
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) {
        void contents.loadURL(url)
      }
      return { action: 'deny' }
    })
    contents.on('will-navigate', (event, url) => {
      if (!/^https?:\/\//i.test(url)) event.preventDefault()
    })
  })

  // 开发环境：将渲染进程控制台消息转发到主进程日志，便于排查
  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
      const tag = ['log', 'info', 'warn', 'error'][level] ?? 'log'
      console.log(`[renderer:${tag}] ${message} (${sourceId}:${line})`)
    })
  }

  // 开发环境加载 Vite dev server，生产环境加载打包文件
  const rendererUrl = process.env['ELECTRON_RENDERER_URL']
  if (rendererUrl) {
    void mainWindow.loadURL(rendererUrl)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

void app.whenReady().then(async () => {
  await initSettings()
  // 社区桥接分区 UA 须在首个 webview 创建前装好（UA 与 sec-ch-ua 同源，否则
  // Cloudflare 判定伪造浏览器，挑战页死循环渲染不出交互式人机验证）
  setupCommunitySession()
  // 启动时预登记 DB 内全部项目根到 allowedRoots。
  // 此前 allowedRoots 仅在打开/导入项目时登记，全新会话下未打开的项目
  // 触发 fs 操作会因 assertWithinRoot 失败而静默拒绝。预登记消除该缺口。
  try {
    const projects = await getAllProjects()
    for (const p of projects) registerProjectRoot(p.path)
  } catch {
    /* 持久化层异常不阻断启动 */
  }
  // 任务图启动自愈：上次进程退出遗留的 running 一律标记为 interrupted（历史任务面板可据此续跑）
  // 同处执行事件流水保留策略：清理已结束超 30 天的 agent_run_events（主记录保留）
  try {
    const runStore = createAgentRunStore(getDb())
    runStore.markInterruptedOnBoot()
    runStore.pruneEventRetention()
  } catch {
    /* 持久化层异常不阻断启动 */
  }
  createWindow()
  if (mainWindow) registerIpcHandlers(mainWindow)
  // 自更新：事件桥接 + 启动后延迟自动检查（仅打包版，updaterService 内自判）
  if (mainWindow) initUpdater(mainWindow)

  // 离线模型后台静默预取（默认开，设置 ai.offlineModelPrefetch 可关）：
  // 延迟 5s 让窗口先出来，单模型失败在 service 内消化，不阻断启动
  if (getAllSettings().ai.offlineModelPrefetch !== false && mainWindow) {
    const win = mainWindow
    setTimeout(() => {
      try {
        void initAiRuntime().models.prefetchAll(win).catch(() => {
          /* 失败已通过 model_assets + 事件呈现 */
        })
      } catch {
        /* 持久化层异常不阻断启动 */
      }
    }, 5000)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
