import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IpcChannels, type IpcApi } from '../shared/types/ipc'
import type { AiStreamEvent } from '../shared/types/ai'

/**
 * preload 是渲染进程与主进程之间唯一的白名单桥：
 * - 只暴露显式声明的 API，不转发任意 channel
 * - invoke 用于请求-响应，on 用于主进程事件推送
 */
/** 主进程 → 渲染层推送通道白名单（与主进程全部 webContents.send 通道一致，
 *  契约测试见 src/main/ipc/__tests__/contract.spec.ts 的 PUSH_CHANNELS） */
const PUSH_CHANNEL_WHITELIST: ReadonlySet<string> = new Set<string>([
  IpcChannels.FS_EVENT,
  IpcChannels.GRADLE_EVENT,
  IpcChannels.AI_STREAM_EVENT,
  IpcChannels.AGENT_EVENT,
  IpcChannels.MONITOR_EVENT,
  IpcChannels.MODEL_EVENT,
  IpcChannels.SANDBOX_EVENT,
  IpcChannels.WIN_MAXIMIZED_CHANGED,
  IpcChannels.UPDATE_STATE_CHANGED,
  IpcChannels.INTEGRATION_AUTH_REQUEST,
  IpcChannels.LAUNCHER_EVENT,
  IpcChannels.JDK_PROVISION_EVENT,
  IpcChannels.MC_PROVISION_EVENT,
  IpcChannels.DECOMPILE_EVENT,
  IpcChannels.AUDIO_EVENT
])

const api: IpcApi = {
  app: {
    getVersion: () => ipcRenderer.invoke(IpcChannels.APP_GET_VERSION),
    getPlatform: () => ipcRenderer.invoke(IpcChannels.APP_GET_PLATFORM),
    writeProbe: () => ipcRenderer.invoke(IpcChannels.APP_WRITE_PROBE)
  },
  update: {
    getState: () => ipcRenderer.invoke(IpcChannels.UPDATE_GET_STATE),
    check: () => ipcRenderer.invoke(IpcChannels.UPDATE_CHECK),
    download: () => ipcRenderer.invoke(IpcChannels.UPDATE_DOWNLOAD),
    install: () => ipcRenderer.invoke(IpcChannels.UPDATE_INSTALL),
    onStateChanged: (listener) => {
      const handler = (
        _e: IpcRendererEvent,
        state: import('../shared/types/update').UpdateState
      ): void => listener(state)
      ipcRenderer.on(IpcChannels.UPDATE_STATE_CHANGED, handler)
      return () => ipcRenderer.removeListener(IpcChannels.UPDATE_STATE_CHANGED, handler)
    }
  },
  win: {
    minimize: () => ipcRenderer.invoke(IpcChannels.WIN_MINIMIZE),
    toggleMaximize: () => ipcRenderer.invoke(IpcChannels.WIN_TOGGLE_MAXIMIZE),
    close: () => ipcRenderer.invoke(IpcChannels.WIN_CLOSE),
    isMaximized: () => ipcRenderer.invoke(IpcChannels.WIN_IS_MAXIMIZED)
  },
  project: {
    list: () => ipcRenderer.invoke(IpcChannels.PROJECT_LIST),
    create: (input) => ipcRenderer.invoke(IpcChannels.PROJECT_CREATE, input),
    open: (id) => ipcRenderer.invoke(IpcChannels.PROJECT_OPEN, id),
    delete: (id, deleteFiles) => ipcRenderer.invoke(IpcChannels.PROJECT_DELETE, id, deleteFiles),
    import: (path) => ipcRenderer.invoke(IpcChannels.PROJECT_IMPORT, path),
    relocate: (id) => ipcRenderer.invoke(IpcChannels.PROJECT_RELOCATE, id),
    deriveModId: (name) => ipcRenderer.invoke(IpcChannels.PROJECT_DERIVE_MOD_ID, name)
  },
  dialog: {
    selectDirectory: () => ipcRenderer.invoke(IpcChannels.DIALOG_SELECT_DIRECTORY),
    selectImage: () => ipcRenderer.invoke(IpcChannels.DIALOG_SELECT_IMAGE),
    selectFile: (input) => ipcRenderer.invoke(IpcChannels.DIALOG_SELECT_FILE, input)
  },
  fs: {
    readDir: (path) => ipcRenderer.invoke(IpcChannels.FS_READ_DIR, path),
    readFile: (path) => ipcRenderer.invoke(IpcChannels.FS_READ_FILE, path),
    readBinary: (path) => ipcRenderer.invoke(IpcChannels.FS_READ_BINARY, path),
    writeFile: (path, content) => ipcRenderer.invoke(IpcChannels.FS_WRITE_FILE, path, content),
    create: (input) => ipcRenderer.invoke(IpcChannels.FS_CREATE, input),
    rename: (input) => ipcRenderer.invoke(IpcChannels.FS_RENAME, input),
    delete: (path) => ipcRenderer.invoke(IpcChannels.FS_DELETE, path),
    copy: (input) => ipcRenderer.invoke(IpcChannels.FS_COPY, input),
    move: (src, destDir) => ipcRenderer.invoke(IpcChannels.FS_MOVE, src, destDir),
    search: (root, query) => ipcRenderer.invoke(IpcChannels.FS_SEARCH, root, query),
    stat: (path) => ipcRenderer.invoke(IpcChannels.FS_STAT, path),
    watchStart: (root) => ipcRenderer.invoke(IpcChannels.FS_WATCH_START, root),
    watchStop: () => ipcRenderer.invoke(IpcChannels.FS_WATCH_STOP)
  },
  java: {
    resolveSymbols: (input) => ipcRenderer.invoke(IpcChannels.JAVA_RESOLVE_SYMBOLS, input)
  },
  decompile: {
    status: () => ipcRenderer.invoke(IpcChannels.DECOMPILE_STATUS),
    ensureTool: () => ipcRenderer.invoke(IpcChannels.DECOMPILE_ENSURE_TOOL),
    start: (jarPath) => ipcRenderer.invoke(IpcChannels.DECOMPILE_START, jarPath),
    listWorkspaces: () => ipcRenderer.invoke(IpcChannels.DECOMPILE_LIST_WORKSPACES),
    readDir: (root, relDir) => ipcRenderer.invoke(IpcChannels.DECOMPILE_READ_DIR, root, relDir),
    readFile: (root, relPath) =>
      ipcRenderer.invoke(IpcChannels.DECOMPILE_READ_FILE, root, relPath),
    search: (root, query) => ipcRenderer.invoke(IpcChannels.DECOMPILE_SEARCH, root, query),
    deleteWorkspace: (root) => ipcRenderer.invoke(IpcChannels.DECOMPILE_DELETE_WORKSPACE, root)
  },
  audio: {
    ffmpegStatus: () => ipcRenderer.invoke(IpcChannels.AUDIO_FFMPEG_STATUS),
    ensureFfmpeg: () => ipcRenderer.invoke(IpcChannels.AUDIO_ENSURE_FFMPEG),
    convert: (input) => ipcRenderer.invoke(IpcChannels.AUDIO_CONVERT, input),
    list: (root) => ipcRenderer.invoke(IpcChannels.AUDIO_LIST, root),
    registerEvent: (root, entry) => ipcRenderer.invoke(IpcChannels.AUDIO_REGISTER_EVENT, root, entry),
    unregisterEvent: (root, name) =>
      ipcRenderer.invoke(IpcChannels.AUDIO_UNREGISTER_EVENT, root, name),
    removeSound: (root, stem) => ipcRenderer.invoke(IpcChannels.AUDIO_REMOVE_SOUND, root, stem),
    readSound: (root, stem) => ipcRenderer.invoke(IpcChannels.AUDIO_READ_SOUND, root, stem),
    readSource: (path) => ipcRenderer.invoke(IpcChannels.AUDIO_READ_SOURCE, path)
  },
  ftbQuest: {
    list: (root) => ipcRenderer.invoke(IpcChannels.FTBQUEST_LIST, root),
    read: (root, id) => ipcRenderer.invoke(IpcChannels.FTBQUEST_READ, root, id),
    save: (root, chapter, prevId) =>
      ipcRenderer.invoke(IpcChannels.FTBQUEST_SAVE, root, chapter, prevId),
    remove: (root, id) => ipcRenderer.invoke(IpcChannels.FTBQUEST_DELETE, root, id)
  },
  patchouli: {
    list: (root) => ipcRenderer.invoke(IpcChannels.PATCHOULI_LIST, root),
    read: (root, namespace, bookId) =>
      ipcRenderer.invoke(IpcChannels.PATCHOULI_READ, root, namespace, bookId),
    save: (root, book, prev) => ipcRenderer.invoke(IpcChannels.PATCHOULI_SAVE, root, book, prev),
    remove: (root, namespace, bookId) =>
      ipcRenderer.invoke(IpcChannels.PATCHOULI_DELETE, root, namespace, bookId)
  },
  kubejs: {
    list: (root) => ipcRenderer.invoke(IpcChannels.KUBEJS_LIST, root),
    read: (root, dir, stem) => ipcRenderer.invoke(IpcChannels.KUBEJS_READ, root, dir, stem),
    save: (root, dir, stem, content) =>
      ipcRenderer.invoke(IpcChannels.KUBEJS_SAVE, root, dir, stem, content),
    remove: (root, dir, stem) => ipcRenderer.invoke(IpcChannels.KUBEJS_DELETE, root, dir, stem),
    templates: () => ipcRenderer.invoke(IpcChannels.KUBEJS_TEMPLATES),
    applyTemplate: (root, templateId) =>
      ipcRenderer.invoke(IpcChannels.KUBEJS_APPLY_TEMPLATE, root, templateId)
  },
  content: {
    list: (root) => ipcRenderer.invoke(IpcChannels.CONTENT_LIST, root),
    load: (root, kind, id) => ipcRenderer.invoke(IpcChannels.CONTENT_LOAD, root, kind, id),
    save: (root, def, prevId) => ipcRenderer.invoke(IpcChannels.CONTENT_SAVE, root, def, prevId),
    remove: (root, kind, id) => ipcRenderer.invoke(IpcChannels.CONTENT_DELETE, root, kind, id),
    saveTexture: (root, modelId, pixels, size) =>
      ipcRenderer.invoke(IpcChannels.CONTENT_SAVE_TEXTURE, root, modelId, pixels, size),
    saveTextureAsset: (root, textureId, category, pixels, width, height) =>
      ipcRenderer.invoke(
        IpcChannels.CONTENT_SAVE_TEXTURE_ASSET,
        root,
        textureId,
        category,
        pixels,
        width,
        height
      ),
    generate: (root, options) =>
      ipcRenderer.invoke(IpcChannels.CONTENT_GENERATE, root, options),
    reverseSync: (root, id) =>
      ipcRenderer.invoke(IpcChannels.CONTENT_REVERSE_SYNC, root, id),
    importBbmodel: (root, explicitId?) =>
      ipcRenderer.invoke(IpcChannels.CONTENT_BBMODEL_IMPORT, root, explicitId),
    exportBbmodel: (root, model) =>
      ipcRenderer.invoke(IpcChannels.CONTENT_BBMODEL_EXPORT, root, model),
    importObj: (root, id, resolution?) =>
      ipcRenderer.invoke(IpcChannels.CONTENT_OBJ_IMPORT, root, id, resolution),
    textureRepaint: (request) =>
      ipcRenderer.invoke(IpcChannels.CONTENT_TEXTURE_REPAINT, request),
    texturePixelize: (request) =>
      ipcRenderer.invoke(IpcChannels.CONTENT_TEXTURE_PIXELIZE, request),
    texturePaletteGet: (root) =>
      ipcRenderer.invoke(IpcChannels.CONTENT_TEXTURE_PALETTE_GET, root),
    texturePaletteSet: (root, patch) =>
      ipcRenderer.invoke(IpcChannels.CONTENT_TEXTURE_PALETTE_SET, root, patch),
    applyTextureCandidate: (root, kind, id, pixels, size) =>
      ipcRenderer.invoke(IpcChannels.CONTENT_TEXTURE_APPLY_CANDIDATE, root, kind, id, pixels, size),
    modelApplyCandidate: (sourceRoot, source, targetRoot, target, confirm) =>
      ipcRenderer.invoke(
        IpcChannels.CONTENT_MODEL_APPLY_CANDIDATE,
        sourceRoot,
        source,
        targetRoot,
        target,
        confirm
      ),
    galleryList: (root) => ipcRenderer.invoke(IpcChannels.CONTENT_GALLERY_LIST, root),
    gallerySave: (root, items) => ipcRenderer.invoke(IpcChannels.CONTENT_GALLERY_SAVE, root, items),
    galleryDelete: (root, id) => ipcRenderer.invoke(IpcChannels.CONTENT_GALLERY_DELETE, root, id),
    doctor: (root) =>
      ipcRenderer.invoke(IpcChannels.CONTENT_DOCTOR, root)
  },
  modeler: {
    importTexturePng: (root) => ipcRenderer.invoke(IpcChannels.MODELER_TEXTURE_IMPORT, root),
    exportTexturePng: (root, input) =>
      ipcRenderer.invoke(IpcChannels.MODELER_TEXTURE_EXPORT, root, input),
    saveDoc: (root, id, content, expectedRevision) =>
      ipcRenderer.invoke(IpcChannels.MODELER_DOC_SAVE, root, id, content, expectedRevision),
    autosaveDoc: (root, id, content) =>
      ipcRenderer.invoke(IpcChannels.MODELER_DOC_AUTOSAVE, root, id, content),
    checkDocRecovery: (root, id) => ipcRenderer.invoke(IpcChannels.MODELER_DOC_RECOVERY, root, id),
    applyGeoToEntity: (root, docId, entityId, confirm) =>
      ipcRenderer.invoke(
        IpcChannels.MODELER_APPLY_GEO_TO_ENTITY,
        root,
        docId,
        entityId,
        confirm
      ),
    importAnimations: (root) => ipcRenderer.invoke(IpcChannels.MODELER_ANIM_IMPORT, root),
    exportAnimations: (root, input) =>
      ipcRenderer.invoke(IpcChannels.MODELER_ANIM_EXPORT, root, input),
    importBbmodel: (root) => ipcRenderer.invoke(IpcChannels.MODELER_BBMODEL_IMPORT, root),
    exportBbmodel: (root, input) =>
      ipcRenderer.invoke(IpcChannels.MODELER_BBMODEL_EXPORT, root, input),
    exportGltf: (root, input) =>
      ipcRenderer.invoke(IpcChannels.MODELER_GLTF_EXPORT, root, input),
    exportObj: (root, input) =>
      ipcRenderer.invoke(IpcChannels.MODELER_OBJ_EXPORT, root, input),
    importBedrockGeo: (root) => ipcRenderer.invoke(IpcChannels.MODELER_BEDROCK_GEO_IMPORT, root),
    exportBedrockGeo: (root, input) =>
      ipcRenderer.invoke(IpcChannels.MODELER_BEDROCK_GEO_EXPORT, root, input),
    importController: (root) => ipcRenderer.invoke(IpcChannels.MODELER_CTRL_IMPORT, root),
    exportController: (root, input) =>
      ipcRenderer.invoke(IpcChannels.MODELER_CTRL_EXPORT, root, input),
    importJem: (root) => ipcRenderer.invoke(IpcChannels.MODELER_JEM_IMPORT, root),
    exportJem: (root, input) => ipcRenderer.invoke(IpcChannels.MODELER_JEM_EXPORT, root, input),
    importJpm: (root) => ipcRenderer.invoke(IpcChannels.MODELER_JPM_IMPORT, root),
    exportJpm: (root, input) => ipcRenderer.invoke(IpcChannels.MODELER_JPM_EXPORT, root, input),
    importObj: (root) => ipcRenderer.invoke(IpcChannels.MODELER_OBJ_IMPORT, root),
    importDae: (root) => ipcRenderer.invoke(IpcChannels.MODELER_DAE_IMPORT, root),
    importFbx: (root) => ipcRenderer.invoke(IpcChannels.MODELER_FBX_IMPORT, root),
    importGltf: (root) => ipcRenderer.invoke(IpcChannels.MODELER_GLTF_IMPORT, root),
    importSkin: (root) => ipcRenderer.invoke(IpcChannels.MODELER_SKIN_IMPORT, root),
    exportSkin: (root, input) => ipcRenderer.invoke(IpcChannels.MODELER_SKIN_EXPORT, root, input),
    applyModelToObject: (root, docId, targetKind, targetId, confirm) =>
      ipcRenderer.invoke(
        IpcChannels.MODELER_APPLY_MODEL_TO_OBJECT,
        root,
        docId,
        targetKind,
        targetId,
        confirm
      ),
    /** （D1）把已保存工坊文档直接编译落盘到资源包（产物落 assets/<modId>/） */
    compileResource: (root, docId) => ipcRenderer.invoke(IpcChannels.MODELER_COMPILE_RESOURCE, root, docId)
  },
  datapack: {
    getMeta: (root) => ipcRenderer.invoke(IpcChannels.DATAPACK_GET_META, root),
    init: (root, input, mode) => ipcRenderer.invoke(IpcChannels.DATAPACK_INIT, root, input, mode),
    listEntries: (root, mode) =>
      ipcRenderer.invoke(IpcChannels.DATAPACK_LIST_ENTRIES, root, mode),
    readEntry: (root, category, id, mode) =>
      ipcRenderer.invoke(IpcChannels.DATAPACK_READ_ENTRY, root, category, id, mode),
    writeEntry: (root, category, id, content, mode) =>
      ipcRenderer.invoke(IpcChannels.DATAPACK_WRITE_ENTRY, root, category, id, content, mode),
    deleteEntry: (root, category, id, mode) =>
      ipcRenderer.invoke(IpcChannels.DATAPACK_DELETE_ENTRY, root, category, id, mode)
  },
  shaderpack: {
    getMeta: (root) => ipcRenderer.invoke(IpcChannels.SHADERPACK_GET_META, root),
    init: (root, input, mode) =>
      ipcRenderer.invoke(IpcChannels.SHADERPACK_INIT, root, input, mode),
    listFiles: (root, mode) =>
      ipcRenderer.invoke(IpcChannels.SHADERPACK_LIST_FILES, root, mode),
    readFile: (root, relPath, mode) =>
      ipcRenderer.invoke(IpcChannels.SHADERPACK_READ_FILE, root, relPath, mode),
    writeFile: (root, relPath, content, mode) =>
      ipcRenderer.invoke(IpcChannels.SHADERPACK_WRITE_FILE, root, relPath, content, mode),
    deleteFile: (root, relPath, mode) =>
      ipcRenderer.invoke(IpcChannels.SHADERPACK_DELETE_FILE, root, relPath, mode),
    exportZip: (root, mode) =>
      ipcRenderer.invoke(IpcChannels.SHADERPACK_EXPORT_ZIP, root, mode)
  },
  resourcepack: {
    getMeta: (root) => ipcRenderer.invoke(IpcChannels.RESOURCEPACK_GET_META, root),
    init: (root, input, mode) =>
      ipcRenderer.invoke(IpcChannels.RESOURCEPACK_INIT, root, input, mode),
    listFiles: (root, mode) =>
      ipcRenderer.invoke(IpcChannels.RESOURCEPACK_LIST_FILES, root, mode),
    readFile: (root, relPath, mode) =>
      ipcRenderer.invoke(IpcChannels.RESOURCEPACK_READ_FILE, root, relPath, mode),
    writeFile: (root, relPath, content, mode) =>
      ipcRenderer.invoke(IpcChannels.RESOURCEPACK_WRITE_FILE, root, relPath, content, mode),
    deleteFile: (root, relPath, mode) =>
      ipcRenderer.invoke(IpcChannels.RESOURCEPACK_DELETE_FILE, root, relPath, mode),
    importIcon: (root, srcPath, mode) =>
      ipcRenderer.invoke(IpcChannels.RESOURCEPACK_IMPORT_ICON, root, srcPath, mode),
    writeTexture: (root, relPath, pixels, width, height, mode) =>
      ipcRenderer.invoke(
        IpcChannels.RESOURCEPACK_WRITE_TEXTURE,
        root,
        relPath,
        pixels,
        width,
        height,
        mode
      ),
    readTexture: (root, relPath, mode) =>
      ipcRenderer.invoke(IpcChannels.RESOURCEPACK_READ_TEXTURE, root, relPath, mode),
    exportZip: (root, mode) =>
      ipcRenderer.invoke(IpcChannels.RESOURCEPACK_EXPORT_ZIP, root, mode),
    importSound: (root, srcPath, mode) =>
      ipcRenderer.invoke(IpcChannels.RESOURCEPACK_IMPORT_SOUND, root, srcPath, mode),
    readSound: (root, relPath, mode) =>
      ipcRenderer.invoke(IpcChannels.RESOURCEPACK_READ_SOUND, root, relPath, mode)
  },
  modpack: {
    preview: (projectPath) => ipcRenderer.invoke(IpcChannels.MODPACK_PREVIEW, projectPath),
    assemble: (projectPath) => ipcRenderer.invoke(IpcChannels.MODPACK_ASSEMBLE, projectPath),
    listSources: (projectPath) =>
      ipcRenderer.invoke(IpcChannels.MODPACK_LIST_SOURCES, projectPath),
    crossLink: (projectPath) =>
      ipcRenderer.invoke(IpcChannels.MODPACK_CROSS_LINK, projectPath),
    launchTest: (input) => ipcRenderer.invoke(IpcChannels.MODPACK_LAUNCH_TEST, input),
    listPacks: (projectPath) => ipcRenderer.invoke(IpcChannels.MODPACK_LIST_PACKS, projectPath),
    setPackEnabled: (projectPath, packId, enabled) =>
      ipcRenderer.invoke(IpcChannels.MODPACK_SET_PACK_ENABLED, projectPath, packId, enabled),
    createPack: (projectPath, input) =>
      ipcRenderer.invoke(IpcChannels.MODPACK_CREATE_PACK, projectPath, input),
    publish: (projectPath, input, platforms) =>
      ipcRenderer.invoke(IpcChannels.MODPACK_PUBLISH, projectPath, input, platforms),
    publishPreflight: (projectPath) =>
      ipcRenderer.invoke(IpcChannels.MODPACK_PUBLISH_PREFLIGHT, projectPath)
  },
  ci: {
    getConfig: (projectPath) => ipcRenderer.invoke(IpcChannels.CI_GET_CONFIG, projectPath),
    setConfig: (projectPath, config) => ipcRenderer.invoke(IpcChannels.CI_SET_CONFIG, projectPath, config),
    preview: (projectPath, config) => ipcRenderer.invoke(IpcChannels.CI_PREVIEW, projectPath, config),
    export: (projectPath, config) => ipcRenderer.invoke(IpcChannels.CI_EXPORT, projectPath, config),
    regenerate: (projectPath) => ipcRenderer.invoke(IpcChannels.CI_REGENERATE, projectPath)
  },
  gradle: {
    run: (input) => ipcRenderer.invoke(IpcChannels.GRADLE_RUN, input),
    cancel: (runId) => ipcRenderer.invoke(IpcChannels.GRADLE_CANCEL, runId)
  },
  jdk: {
    detect: (configuredPath, context) =>
      ipcRenderer.invoke(IpcChannels.JDK_DETECT, configuredPath, context),
    provision: (input) => ipcRenderer.invoke(IpcChannels.JDK_PROVISION, input)
  },
  mc: {
    listVersions: (mirror) => ipcRenderer.invoke(IpcChannels.MC_LIST_VERSIONS, mirror),
    provision: (input) => ipcRenderer.invoke(IpcChannels.MC_PROVISION, input),
    listInstances: () => ipcRenderer.invoke(IpcChannels.MC_LIST_INSTANCES),
    deleteInstance: (id) => ipcRenderer.invoke(IpcChannels.MC_DELETE_INSTANCE, id),
    launchInstance: (input) => ipcRenderer.invoke(IpcChannels.MC_LAUNCH_INSTANCE, input)
  },
  settings: {
    getAll: () => ipcRenderer.invoke(IpcChannels.SETTINGS_GET_ALL),
    set: (patch) => ipcRenderer.invoke(IpcChannels.SETTINGS_SET, patch),
    cryptoStatus: () => ipcRenderer.invoke(IpcChannels.SETTINGS_CRYPTO_STATUS)
  },
  shell: {
    openExternal: (url) => ipcRenderer.invoke(IpcChannels.SHELL_OPEN_EXTERNAL, url),
    showItemInFolder: (path) =>
      ipcRenderer.invoke(IpcChannels.SHELL_SHOW_ITEM_IN_FOLDER, path)
  },
  knowledge: {
    packStatus: () => ipcRenderer.invoke(IpcChannels.KNOWLEDGE_PACK_STATUS),
    ragStatus: () => ipcRenderer.invoke(IpcChannels.KB_RAG_STATUS),
    ragRebuild: () => ipcRenderer.invoke(IpcChannels.KB_RAG_REBUILD)
  },
  ai: {
    listModels: (providerId, force) =>
      ipcRenderer.invoke(IpcChannels.AI_LIST_MODELS, providerId, force),
    test: (providerId) => ipcRenderer.invoke(IpcChannels.AI_TEST, providerId),
    chat: (req) => ipcRenderer.invoke(IpcChannels.AI_CHAT, req),
    chatStream: (streamId, req, onDelta, onReasoning, onToolStart, onToolEnd) => {
      const listener = (_e: IpcRendererEvent, ev: AiStreamEvent): void => {
        if (ev.streamId !== streamId) return
        if (ev.type === 'delta') onDelta(ev.delta)
        if (ev.type === 'reasoning') onReasoning?.(ev.delta)
        if (ev.type === 'tool-start') onToolStart?.(ev.name, ev.args)
        if (ev.type === 'tool-end') onToolEnd?.(ev.name, ev.ok, ev.summary)
        if (ev.type === 'done' || ev.type === 'error') {
          ipcRenderer.removeListener(IpcChannels.AI_STREAM_EVENT, listener)
        }
      }
      ipcRenderer.on(IpcChannels.AI_STREAM_EVENT, listener)
      return ipcRenderer
        .invoke(IpcChannels.AI_CHAT_STREAM, streamId, req)
        .finally(() => ipcRenderer.removeListener(IpcChannels.AI_STREAM_EVENT, listener))
    },
    chatStop: (streamId) => ipcRenderer.invoke(IpcChannels.AI_CHAT_STOP, streamId),
    cueContext: (input) => ipcRenderer.invoke(IpcChannels.AI_CUE_CONTEXT, input),
    /** KunYuStudio 应用能力清单（自我认知语料）；参考包缺失时返回 null */
    kunyuCapabilities: () => ipcRenderer.invoke(IpcChannels.AI_KUNYU_CAPABILITIES)
  },
  aiRef: {
    getManifest: () => ipcRenderer.invoke(IpcChannels.REF_GET_MANIFEST),
    getTemplate: (id) => ipcRenderer.invoke(IpcChannels.REF_GET_TEMPLATE, id)
  },
  agent: {
    run: (req) => ipcRenderer.invoke(IpcChannels.AGENT_RUN, req),
    plan: (message, projectType) =>
      ipcRenderer.invoke(IpcChannels.AGENT_PLAN, message, projectType),
    cancel: (runId) => ipcRenderer.invoke(IpcChannels.AGENT_CANCEL, runId),
    pause: (runId) => ipcRenderer.invoke(IpcChannels.AGENT_PAUSE, runId),
    resume: (runId) => ipcRenderer.invoke(IpcChannels.AGENT_RESUME, runId),
    active: () => ipcRenderer.invoke(IpcChannels.AGENT_ACTIVE),
    history: (opts) => ipcRenderer.invoke(IpcChannels.AGENT_HISTORY, opts),
    historyDetail: (runId) => ipcRenderer.invoke(IpcChannels.AGENT_HISTORY_DETAIL, runId),
    resumeRun: (runId) => ipcRenderer.invoke(IpcChannels.AGENT_RESUME_RUN, runId),
    deleteRun: (runId) => ipcRenderer.invoke(IpcChannels.AGENT_RUN_DELETE, runId),
    recheckAssertion: (runId, artifactId, assertion) =>
      ipcRenderer.invoke(IpcChannels.AGENT_RECHECK_ASSERTION, runId, artifactId, assertion),
    exportNow: (input) => ipcRenderer.invoke(IpcChannels.AGENT_EXPORT_NOW, input),
    regenerateAsset: (input) => ipcRenderer.invoke(IpcChannels.AGENT_REGENERATE_ASSET, input),
    // T2：run 前原文快照读取（对比视图）/ 单文件回滚
    getFileSnapshot: (runId, relPath) =>
      ipcRenderer.invoke(IpcChannels.AGENT_GET_FILE_SNAPSHOT, runId, relPath),
    rollbackFile: (runId, relPath) =>
      ipcRenderer.invoke(IpcChannels.AGENT_ROLLBACK_FILE, runId, relPath)
  },
  models: {
    list: () => ipcRenderer.invoke(IpcChannels.MODELS_LIST),
    prefetch: () => ipcRenderer.invoke(IpcChannels.MODELS_PREFETCH)
  },
  monitor: {
    getState: () => ipcRenderer.invoke(IpcChannels.MONITOR_GET_STATE),
    check: () => ipcRenderer.invoke(IpcChannels.MONITOR_CHECK),
    runProbe: (comboId) => ipcRenderer.invoke(IpcChannels.PROBE_RUN, comboId)
  },
  mcp: {
    getStatus: () => ipcRenderer.invoke(IpcChannels.MCP_GET_STATUS),
    setEnabled: (enabled) => ipcRenderer.invoke(IpcChannels.MCP_SET_ENABLED, enabled),
    refresh: () => ipcRenderer.invoke(IpcChannels.MCP_REFRESH),
    testServer: (cfg) => ipcRenderer.invoke(IpcChannels.MCP_TEST_SERVER, cfg),
    listCustomTools: () => ipcRenderer.invoke(IpcChannels.MCP_LIST_CUSTOM_TOOLS),
    syncCustom: (servers) => ipcRenderer.invoke(IpcChannels.MCP_SYNC_CUSTOM, servers),
    callCustomTool: (serverId, toolName, args) =>
      ipcRenderer.invoke(IpcChannels.MCP_CALL_CUSTOM_TOOL, serverId, toolName, args)
  },
  observer: {
    getStatus: () => ipcRenderer.invoke(IpcChannels.OBSERVER_GET_STATUS),
    injectProject: () => ipcRenderer.invoke(IpcChannels.OBSERVER_INJECT_PROJECT),
    injectDir: (dir) => ipcRenderer.invoke(IpcChannels.OBSERVER_INJECT_DIR, dir),
    pickDir: () => ipcRenderer.invoke(IpcChannels.OBSERVER_PICK_DIR)
  },
  market: {
    search: (query) => ipcRenderer.invoke(IpcChannels.MARKET_SEARCH, query),
    getDetail: (platform, modId, projectType) => ipcRenderer.invoke(IpcChannels.MARKET_GET_DETAIL, platform, modId, projectType),
    getVersions: (platform, modId, projectType) => ipcRenderer.invoke(IpcChannels.MARKET_GET_VERSIONS, platform, modId, projectType),
    install: (input) => ipcRenderer.invoke(IpcChannels.MARKET_INSTALL, input),
    testCf: (apiKey) => ipcRenderer.invoke(IpcChannels.MARKET_TEST_CF, apiKey)
  },
  modlib: {
    list: (filter) => ipcRenderer.invoke(IpcChannels.MODLIB_LIST, filter),
    download: (input) => ipcRenderer.invoke(IpcChannels.MODLIB_DOWNLOAD, input),
    cancelDownload: () => ipcRenderer.invoke(IpcChannels.MODLIB_CANCEL_DOWNLOAD),
    pickAndImport: () => ipcRenderer.invoke(IpcChannels.MODLIB_PICK_AND_IMPORT),
    remove: (fileName) => ipcRenderer.invoke(IpcChannels.MODLIB_REMOVE, fileName),
    addToProject: (projectPath, fileName, overwrite, worldName) =>
      ipcRenderer.invoke(IpcChannels.MODLIB_ADD_TO_PROJECT, projectPath, fileName, overwrite, worldName),
    listWorlds: (projectPath) => ipcRenderer.invoke(IpcChannels.MODLIB_LIST_WORLDS, projectPath),
    root: () => ipcRenderer.invoke(IpcChannels.MODLIB_ROOT),
    reveal: (fileName) => ipcRenderer.invoke(IpcChannels.MODLIB_REVEAL, fileName),
    enrichIcons: () => ipcRenderer.invoke(IpcChannels.MODLIB_ENRICH_ICONS)
  },
  translate: {
    toZh: (texts) => ipcRenderer.invoke(IpcChannels.TRANSLATE_BATCH, texts)
  },
  kunyu: {
    listCreations: () => ipcRenderer.invoke(IpcChannels.KUNYU_LIST_CREATIONS),
    exportCreation: (input) => ipcRenderer.invoke(IpcChannels.KUNYU_EXPORT_CREATION, input),
    importCreation: (targetProjectPath, overwrite, options) =>
      ipcRenderer.invoke(IpcChannels.KUNYU_IMPORT_CREATION, targetProjectPath, overwrite, options)
  },
  vcs: {
    getGitLog: (root, limit) => ipcRenderer.invoke(IpcChannels.VCS_GET_GIT_LOG, root, limit),
    getGitStatus: (root) => ipcRenderer.invoke(IpcChannels.VCS_GET_GIT_STATUS, root),
    listArtifacts: (root) => ipcRenderer.invoke(IpcChannels.VCS_LIST_ARTIFACTS, root),
    getStatusDetail: (root) => ipcRenderer.invoke(IpcChannels.VCS_GET_STATUS_DETAIL, root),
    stageFile: (root, path) => ipcRenderer.invoke(IpcChannels.VCS_STAGE_FILE, root, path),
    unstageFile: (root, path) => ipcRenderer.invoke(IpcChannels.VCS_UNSTAGE_FILE, root, path),
    stageAll: (root) => ipcRenderer.invoke(IpcChannels.VCS_STAGE_ALL, root),
    commit: (root, message) => ipcRenderer.invoke(IpcChannels.VCS_COMMIT, root, message),
    getDiff: (root, path, staged) => ipcRenderer.invoke(IpcChannels.VCS_GET_DIFF, root, path, staged),
    branchList: (root) => ipcRenderer.invoke(IpcChannels.VCS_BRANCH_LIST, root),
    branchCheckout: (root, name) => ipcRenderer.invoke(IpcChannels.VCS_BRANCH_CHECKOUT, root, name),
    branchCreate: (root, name, base) => ipcRenderer.invoke(IpcChannels.VCS_BRANCH_CREATE, root, name, base),
    branchDelete: (root, name) => ipcRenderer.invoke(IpcChannels.VCS_BRANCH_DELETE, root, name),
    remoteList: (root) => ipcRenderer.invoke(IpcChannels.VCS_REMOTE_LIST, root),
    initRepo: (root) => ipcRenderer.invoke(IpcChannels.VCS_INIT, root),
    remoteAdd: (root, name, url) => ipcRenderer.invoke(IpcChannels.VCS_REMOTE_ADD, root, name, url),
    remoteRemove: (root, name) => ipcRenderer.invoke(IpcChannels.VCS_REMOTE_REMOVE, root, name),
    push: (root, remote, branch, setUpstream) =>
      ipcRenderer.invoke(IpcChannels.VCS_PUSH, root, remote, branch, setUpstream),
    pull: (root) => ipcRenderer.invoke(IpcChannels.VCS_PULL, root),
    fetch: (root) => ipcRenderer.invoke(IpcChannels.VCS_FETCH, root),
    commitDetail: (root, hash) => ipcRenderer.invoke(IpcChannels.VCS_COMMIT_DETAIL, root, hash),
    tagList: (root) => ipcRenderer.invoke(IpcChannels.VCS_TAG_LIST, root),
    tagCreate: (root, name, message) => ipcRenderer.invoke(IpcChannels.VCS_TAG_CREATE, root, name, message)
  },
  plugin: {
    listMcpServers: () => ipcRenderer.invoke(IpcChannels.PLUGIN_LIST_MCP_SERVERS),
    toggleMcp: (id, enabled) => ipcRenderer.invoke(IpcChannels.PLUGIN_TOGGLE_MCP, id, enabled),
    testMcp: (cfg) => ipcRenderer.invoke(IpcChannels.PLUGIN_TEST_MCP, cfg),
    listMarket: (query) => ipcRenderer.invoke(IpcChannels.PLUGIN_LIST_MARKET, query),
    installMarket: (req) => ipcRenderer.invoke(IpcChannels.PLUGIN_INSTALL_MARKET, req),
    listRendererPlugins: () => ipcRenderer.invoke(IpcChannels.PLUGIN_LIST_RENDERER)
  },
  dsh: {
    getState: () => ipcRenderer.invoke(IpcChannels.DSH_GET_STATE),
    install: (npmName, source) => ipcRenderer.invoke(IpcChannels.DSH_INSTALL_PLUGIN, npmName, source),
    remove: (npmName) => ipcRenderer.invoke(IpcChannels.DSH_REMOVE_PLUGIN, npmName),
    reload: () => ipcRenderer.invoke(IpcChannels.DSH_RELOAD),
    setTrust: (npmName, approve) => ipcRenderer.invoke(IpcChannels.DSH_SET_TRUST, npmName, approve),
    petStart: () => ipcRenderer.invoke(IpcChannels.DSH_PET_START),
    petStop: () => ipcRenderer.invoke(IpcChannels.DSH_PET_STOP),
    petStatus: () => ipcRenderer.invoke(IpcChannels.DSH_PET_STATUS)
  },
  integration: {
    detectAgents: () => ipcRenderer.invoke(IpcChannels.INTEGRATION_DETECT_AGENTS),
    startBridge: () => ipcRenderer.invoke(IpcChannels.INTEGRATION_START_BRIDGE),
    stopBridge: () => ipcRenderer.invoke(IpcChannels.INTEGRATION_STOP_BRIDGE),
    getBridgeStatus: () => ipcRenderer.invoke(IpcChannels.INTEGRATION_GET_BRIDGE_STATUS),
    respondAuth: (decision) => ipcRenderer.invoke(IpcChannels.INTEGRATION_AUTH_RESPOND, decision),
    onAuthRequest: (listener) => {
      const handler = (_e: IpcRendererEvent, req: import('../shared/types/integration').McpAuthRequest): void =>
        listener(req)
      ipcRenderer.on(IpcChannels.INTEGRATION_AUTH_REQUEST, handler)
      return () => ipcRenderer.removeListener(IpcChannels.INTEGRATION_AUTH_REQUEST, handler)
    },
    runAgent: (req) => ipcRenderer.invoke(IpcChannels.INTEGRATION_RUN_AGENT, req),
    stopAgent: (runId) => ipcRenderer.invoke(IpcChannels.INTEGRATION_STOP_AGENT, runId),
    onAgentChunk: (listener) => {
      const handler = (
        _e: IpcRendererEvent,
        chunk: import('../shared/types/integration').ExternalAgentChunk
      ): void => listener(chunk)
      ipcRenderer.on(IpcChannels.INTEGRATION_AGENT_CHUNK, handler)
      return () => ipcRenderer.removeListener(IpcChannels.INTEGRATION_AGENT_CHUNK, handler)
    },
    onAgentExit: (listener) => {
      const handler = (
        _e: IpcRendererEvent,
        exit: import('../shared/types/integration').ExternalAgentExit
      ): void => listener(exit)
      ipcRenderer.on(IpcChannels.INTEGRATION_AGENT_EXIT, handler)
      return () => ipcRenderer.removeListener(IpcChannels.INTEGRATION_AGENT_EXIT, handler)
    }
  },
  profile: {
    leaderboard: (query) => ipcRenderer.invoke(IpcChannels.PROFILE_LEADERBOARD, query),
    get: (key) => ipcRenderer.invoke(IpcChannels.PROFILE_GET, key),
    applyActions: (input) => ipcRenderer.invoke(IpcChannels.PROFILE_APPLY_ACTIONS, input),
    analyzeDirectory: (input) =>
      ipcRenderer.invoke(IpcChannels.PROFILE_ANALYZE_DIRECTORY, input),
    importJar: (input) => ipcRenderer.invoke(IpcChannels.PROFILE_IMPORT_JAR, input),
    importJfr: (input) => ipcRenderer.invoke(IpcChannels.PROFILE_IMPORT_JFR, input),
    importSpark: (input) => ipcRenderer.invoke(IpcChannels.PROFILE_IMPORT_SPARK, input)
  },
  sandbox: {
    run: (config) => ipcRenderer.invoke(IpcChannels.SANDBOX_RUN, config),
    cancel: (runId) => ipcRenderer.invoke(IpcChannels.SANDBOX_CANCEL, runId)
  },
  launcher: {
    detect: () => ipcRenderer.invoke(IpcChannels.LAUNCHER_DETECT),
    listInstances: (launcherId) =>
      ipcRenderer.invoke(IpcChannels.LAUNCHER_LIST_INSTANCES, launcherId),
    import: (input) => ipcRenderer.invoke(IpcChannels.LAUNCHER_IMPORT, input),
    setActive: (instanceId) => ipcRenderer.invoke(IpcChannels.LAUNCHER_SET_ACTIVE, instanceId),
    launch: (instanceId) => ipcRenderer.invoke(IpcChannels.LAUNCHER_LAUNCH, instanceId),
    add: (input) => ipcRenderer.invoke(IpcChannels.LAUNCHER_ADD, input),
    importBatch: (input) => ipcRenderer.invoke(IpcChannels.LAUNCHER_IMPORT_BATCH, input),
    autoIntegrate: (input) => ipcRenderer.invoke(IpcChannels.LAUNCHER_AUTO_INTEGRATE, input),
    getState: () => ipcRenderer.invoke(IpcChannels.LAUNCHER_GET_STATE)
  },
  on: (channel, listener) => {
    // api.on 收紧为主进程推送通道白名单，不再是无白名单通用转发
    if (!PUSH_CHANNEL_WHITELIST.has(channel)) {
      throw new Error(`api.on 不支持通道：${channel}（仅允许主进程推送通道白名单）`)
    }
    const handler = (_event: IpcRendererEvent, ...args: unknown[]): void => {
      listener(...args)
    }
    ipcRenderer.on(channel, handler)
    return () => {
      ipcRenderer.removeListener(channel, handler)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)
