import { mkdtempSync, mkdirSync, writeFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createObserverService,
  observerAgentDir,
  OBSERVER_AGENT_VERSION,
  resolveObserverAgentJar
} from '../observerService'
import { OBSERVER_AGENT_JAR_NAME } from '../observerInstaller'

/** 在临时目录里构造 resources/observer-agent/dist 结构（dev 布局） */
function setupEnv(withJar: boolean): { root: string; resourcesPath: string; appPath: string; distDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'observer-svc-'))
  const appPath = root
  const distDir = join(root, 'resources', 'observer-agent', 'dist')
  mkdirSync(distDir, { recursive: true })
  if (withJar) {
    writeFileSync(join(distDir, OBSERVER_AGENT_JAR_NAME), Buffer.from('PK\x03\x04fake-agent'))
  }
  return { root, resourcesPath: join(root, 'packed-res'), appPath, distDir }
}

describe('observerAgentDir / resolveObserverAgentJar', () => {
  it('dev 布局解析到 appPath/resources/observer-agent/dist', () => {
    const env = setupEnv(true)
    expect(observerAgentDir(env.resourcesPath, env.appPath, false)).toBe(env.distDir)
    expect(resolveObserverAgentJar(env.resourcesPath, env.appPath, false)).toBe(
      join(env.distDir, OBSERVER_AGENT_JAR_NAME)
    )
  })

  it('打包布局解析到 resourcesPath/observer-agent', () => {
    const env = setupEnv(false)
    const packedDir = join(env.resourcesPath, 'observer-agent')
    mkdirSync(packedDir, { recursive: true })
    writeFileSync(join(packedDir, OBSERVER_AGENT_JAR_NAME), 'x')
    expect(observerAgentDir(env.resourcesPath, env.appPath, true)).toBe(packedDir)
    expect(resolveObserverAgentJar(env.resourcesPath, env.appPath, true)).toBe(
      join(packedDir, OBSERVER_AGENT_JAR_NAME)
    )
  })

  it('产物缺失时返回 null', () => {
    const env = setupEnv(false)
    expect(resolveObserverAgentJar(env.resourcesPath, env.appPath, false)).toBeNull()
  })
})

describe('createObserverService（javaagent 形态）', () => {
  it('builtInInfo：上报 agent 文件信息与内置版本号', () => {
    const env = setupEnv(true)
    const svc = createObserverService({ resourcesPath: env.resourcesPath, appPath: env.appPath, isPackaged: false })
    const info = svc.builtInInfo()
    expect(info.available).toBe(true)
    expect(info.fileName).toBe(OBSERVER_AGENT_JAR_NAME)
    expect(info.version).toBe(OBSERVER_AGENT_VERSION)
    expect(info.size).toBe(statSync(join(env.distDir, OBSERVER_AGENT_JAR_NAME)).size)
  })

  it('builtInInfo：产物缺失时 unavailable', () => {
    const env = setupEnv(false)
    const svc = createObserverService({ resourcesPath: env.resourcesPath, appPath: env.appPath, isPackaged: false })
    expect(svc.builtInInfo().available).toBe(false)
  })

  it('projectStatus：javaagent 形态下可用即就绪（injected=available，无 modsDir）', () => {
    const env = setupEnv(true)
    const svc = createObserverService({ resourcesPath: env.resourcesPath, appPath: env.appPath, isPackaged: false })
    const st = svc.projectStatus(null)
    expect(st.injected).toBe(true)
    expect(st.modsDir).toBeNull()
    const proj = mkdtempSync(join(tmpdir(), 'obs-proj-'))
    expect(svc.projectStatus(proj).injected).toBe(true)

    const envMissing = setupEnv(false)
    const svcMissing = createObserverService({
      resourcesPath: envMissing.resourcesPath,
      appPath: envMissing.appPath,
      isPackaged: false
    })
    expect(svcMissing.projectStatus(proj).injected).toBe(false)
  })

  it('injectProject：无注入动作，可用时返回 ok + javaagent 说明', () => {
    const env = setupEnv(true)
    const svc = createObserverService({ resourcesPath: env.resourcesPath, appPath: env.appPath, isPackaged: false })
    const proj = mkdtempSync(join(tmpdir(), 'obs-proj-'))
    const r = svc.injectProject(proj)
    expect(r.ok).toBe(true)
    expect(r.warning).toContain('javaagent')
    // 不再产生 mods 复制
    expect(r.modsDir).toBeNull()
    expect(r.sourcePath).toBe(join(env.distDir, OBSERVER_AGENT_JAR_NAME))
  })

  it('injectProject：产物缺失时返回构建指引', () => {
    const env = setupEnv(false)
    const svc = createObserverService({ resourcesPath: env.resourcesPath, appPath: env.appPath, isPackaged: false })
    const r = svc.injectProject(mkdtempSync(join(tmpdir(), 'obs-proj-')))
    expect(r.ok).toBe(false)
    expect(r.error).toContain('build-observer-agent')
  })

  it('injectDir：javaagent 形态与 mods 目录无关（同 injectProject 语义）', () => {
    const env = setupEnv(true)
    const svc = createObserverService({ resourcesPath: env.resourcesPath, appPath: env.appPath, isPackaged: false })
    const r = svc.injectDir('')
    expect(r.ok).toBe(true)
    expect(r.warning).toContain('javaagent')
  })
})
