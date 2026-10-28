/**
 * 整合包 jar 归类纯函数测试：
 * 覆盖损坏 jar、EULA 排除（游戏本体/服务端/Forge 通用包）、无来源降级、
 * 本地文件被替换（size 不符）、双平台坐标与随包兜底开关。
 */
import { describe, expect, it } from 'vitest'
import type { ModSourceEntry } from '../../../../shared/types/modpack'
import { classifyJars, isGameVessel, type JarCandidate } from '../classify'

function candidate(fileName: string, size = 1024, validZip = true): JarCandidate {
  return {
    fileName,
    absPath: `/proj/run/mods/${fileName}`,
    sourceRel: `run/mods/${fileName}`,
    size,
    validZip
  }
}

function source(partial: Partial<ModSourceEntry> & { fileName: string }): ModSourceEntry {
  return {
    platform: 'modrinth',
    modId: 'proj-id',
    versionId: 'ver-id',
    slug: 'slug',
    name: 'name',
    versionNumber: '1.0.0',
    downloadUrl: 'https://cdn.example/a.jar',
    size: 1024,
    installedAt: '2026-09-21T00:00:00.000Z',
    ...partial
  }
}

function sourcesOf(...entries: ModSourceEntry[]): Map<string, ModSourceEntry> {
  return new Map(entries.map((e) => [e.fileName, e]))
}

describe('isGameVessel', () => {
  it('识别游戏本体、服务端与 Forge 通用包', () => {
    expect(isGameVessel('client.jar')).toBe(true)
    expect(isGameVessel('server.jar')).toBe(true)
    expect(isGameVessel('forge-1.20.1-47.2.0-universal.jar')).toBe(true)
    expect(isGameVessel('minecraft_server.1.20.1.jar')).toBe(true)
    expect(isGameVessel('sodium-fabric-0.5.0.jar')).toBe(false)
  })
})

describe('classifyJars', () => {
  it('损坏 jar（文件头非 zip）直接排除', () => {
    const r = classifyJars([candidate('broken.jar', 100, false)], new Map())
    expect(r.jars).toHaveLength(0)
    expect(r.exclusions[0]?.fileName).toBe('broken.jar')
    expect(r.exclusions[0]?.reason).toContain('损坏')
  })

  it('游戏本体被 EULA 排除并给出告警', () => {
    const r = classifyJars([candidate('server.jar')], new Map())
    expect(r.jars).toHaveLength(0)
    expect(r.exclusions[0]?.reason).toContain('EULA')
    expect(r.warnings.some((w) => w.includes('EULA'))).toBe(true)
  })

  it('无来源记录 → overrides 且随包', () => {
    const r = classifyJars([candidate('manual.jar')], new Map())
    expect(r.jars[0]?.disposition).toBe('overrides')
    expect(r.jars[0]?.bundledInOverrides).toBe(true)
  })

  it('本地手工放入（local）→ overrides', () => {
    const r = classifyJars(
      [candidate('manual.jar')],
      sourcesOf(source({ fileName: 'manual.jar', platform: 'local', modId: '', versionId: '', downloadUrl: null }))
    )
    expect(r.jars[0]?.disposition).toBe('overrides')
    expect(r.jars[0]?.reason).toContain('本地')
  })

  it('本地文件大小与安装记录不符 → 降级 overrides 并告警', () => {
    const r = classifyJars(
      [candidate('sodium.jar', 2048)],
      sourcesOf(source({ fileName: 'sodium.jar', size: 1024 }))
    )
    expect(r.jars[0]?.disposition).toBe('overrides')
    expect(r.warnings.some((w) => w.includes('不一致'))).toBe(true)
  })

  it('CurseForge 数值坐标 → curseforge-files', () => {
    const r = classifyJars(
      [candidate('jei.jar')],
      sourcesOf(
        source({
          fileName: 'jei.jar',
          platform: 'curseforge',
          modId: '238222',
          versionId: '4591234'
        })
      )
    )
    expect(r.jars[0]?.disposition).toBe('curseforge-files')
    expect(r.jars[0]?.reason).toContain('projectID=238222')
  })

  it('CurseForge 坐标非数值 → 无法写清单，降级 overrides', () => {
    const r = classifyJars(
      [candidate('jei.jar')],
      sourcesOf(source({ fileName: 'jei.jar', platform: 'curseforge', modId: 'abc', versionId: 'def' }))
    )
    expect(r.jars[0]?.disposition).toBe('overrides')
    expect(r.jars[0]?.reason).toContain('数值型')
  })

  it('Modrinth 含直链 → modrinth-files；无直链 → overrides', () => {
    const withUrl = classifyJars([candidate('a.jar')], sourcesOf(source({ fileName: 'a.jar' })))
    expect(withUrl.jars[0]?.disposition).toBe('modrinth-files')

    const noUrl = classifyJars(
      [candidate('b.jar')],
      sourcesOf(source({ fileName: 'b.jar', downloadUrl: null }))
    )
    expect(noUrl.jars[0]?.disposition).toBe('overrides')
    expect(noUrl.jars[0]?.reason).toContain('直链')
  })

  it('关闭随包兜底后，进清单的 jar 不再写入 overrides', () => {
    const [cf, mr] = classifyJars(
      [candidate('jei.jar'), candidate('sodium.jar')],
      sourcesOf(
        source({ fileName: 'jei.jar', platform: 'curseforge', modId: '1', versionId: '2' }),
        source({ fileName: 'sodium.jar' })
      ),
      { bundleUncoveredJars: false }
    ).jars
    expect(cf?.bundledInOverrides).toBe(false)
    expect(mr?.bundledInOverrides).toBe(false)
  })

  it('默认开启兜底时，进清单的 jar 也随包（另一平台启动器可装到内容）', () => {
    const jars = classifyJars(
      [candidate('sodium.jar')],
      sourcesOf(source({ fileName: 'sodium.jar' }))
    ).jars
    expect(jars[0]?.disposition).toBe('modrinth-files')
    expect(jars[0]?.bundledInOverrides).toBe(true)
  })

  it('无任何侧别信号时保守归为双端 required', () => {
    const jars = classifyJars([candidate('manual.jar')], new Map()).jars
    expect(jars[0]?.env).toEqual({ client: 'required', server: 'required' })
  })

  it('jar 内探测侧别在无来源记录时生效', () => {
    const jars = classifyJars(
      [{ ...candidate('client-tweak.jar'), env: { client: 'required', server: 'unsupported' } }],
      new Map()
    ).jars
    expect(jars[0]?.env).toEqual({ client: 'required', server: 'unsupported' })
  })

  it('来源记录的 Modrinth 项目侧别优先于 jar 内探测', () => {
    const jars = classifyJars(
      [{ ...candidate('sodium.jar'), env: { client: 'optional', server: 'optional' } }],
      sourcesOf(
        source({ fileName: 'sodium.jar', clientSide: 'required', serverSide: 'unsupported' })
      )
    ).jars
    expect(jars[0]?.env).toEqual({ client: 'required', server: 'unsupported' })
  })
})