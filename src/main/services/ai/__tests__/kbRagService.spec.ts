/**
 * kbRagService 单测：语料遍历/分块/中英分词用纯函数直接验证；
 * 向量检索走确定性的假 embedder（词袋投影），不加载 xenova、不触网。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  blendRerank,
  chunkText,
  collectCorpusFiles,
  createKbRag,
  parseCache,
  serializeCache,
  tokenize,
  type Embedder,
  type KbHit
} from '../kbRagService'

let tempRoot = ''

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), 'kunyu-kb-'))
})

afterEach(() => {
  rmSync(tempRoot, { recursive: true, force: true })
})

function write(rel: string, content: string): string {
  const abs = join(tempRoot, rel)
  mkdirSync(join(abs, '..'), { recursive: true })
  writeFileSync(abs, content, 'utf-8')
  return abs
}

/** 词袋向量：token → 固定维度位，L2 归一化。同词重合即 cosine 高。 */
function bagOfWordsEmbedder(): Embedder & { calls: number } {
  const vocab = new Map<string, number>()
  const dimFor = (t: string): number => {
    let d = vocab.get(t)
    if (d === undefined) {
      d = vocab.size
      vocab.set(t, d)
    }
    return d
  }
  const embedOne = (text: string): number[] => {
    const v = new Array<number>(256).fill(0)
    for (const t of tokenize(text)) v[dimFor(t) % 256]! += 1
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1
    return v.map((x) => x / norm)
  }
  const impl = {
    model: 'fake-bag',
    calls: 0,
    async embed(texts: string[]): Promise<number[][]> {
      impl.calls += texts.length
      return texts.map(embedOne)
    }
  }
  return impl
}

describe('collectCorpusFiles', () => {
  it('收集白名单文件并跳过黑名单目录', () => {
    write('docs/a.md', 'a')
    write('src/Main.java', 'class Main {}')
    write('data/recipe.json', '{}')
    write('notes.log', 'skip')
    mkdirSync(join(tempRoot, 'build', 'libs'), { recursive: true })
    writeFileSync(join(tempRoot, 'build', 'libs', 'x.md'), 'skip', 'utf-8')
    mkdirSync(join(tempRoot, '.kunyu'), { recursive: true })
    writeFileSync(join(tempRoot, '.kunyu', 'y.md'), 'skip', 'utf-8')

    const files = collectCorpusFiles([{ alias: 'ref', dir: tempRoot }]).map((f) =>
      f.file.replace(tempRoot, '').replace(/\\/g, '/')
    )
    expect(files).toContain('/docs/a.md')
    expect(files).toContain('/src/Main.java')
    expect(files).toContain('/data/recipe.json')
    expect(files).not.toContain('/notes.log')
    expect(files.some((f) => f.includes('build/'))).toBe(false)
    expect(files.some((f) => f.includes('.kunyu/'))).toBe(false)
  })

  it('超出上限时先排序再截断（确定性保留字典序前 N 个）', () => {
    write('d.md', 'd')
    write('b.md', 'b')
    write('a.md', 'a')
    write('c.md', 'c')
    const files = collectCorpusFiles([{ alias: 'ref', dir: tempRoot }], 2).map((f) => f.file)
    expect(files).toHaveLength(2)
    expect(files[0]!.endsWith('a.md')).toBe(true)
    expect(files[1]!.endsWith('b.md')).toBe(true)
    // 多次调用结果一致（不随枚举顺序抖动）
    const again = collectCorpusFiles([{ alias: 'ref', dir: tempRoot }], 2).map((f) => f.file)
    expect(again).toEqual(files)
  })
})

describe('createKbRag 精确清单（listFiles）', () => {
  it('提供清单时只索引清单内文件', async () => {
    const a = write('a.md', '# 方块\nRegistry.register 注册方块')
    write('b.md', '# 食物\nFoodComponent hunger')
    const rag = createKbRag({
      roots: [{ alias: 'ref', dir: tempRoot }],
      cachePath: join(tempRoot, 'c.bin'),
      embedder: bagOfWordsEmbedder(),
      listFiles: () => [{ alias: 'ref', file: a }]
    })
    await rag.ensureReady()
    expect(rag.status().files).toBe(1)
    expect(rag.chunks.every((c) => c.file === a)).toBe(true)
  })

  it('清单返回 null 时回退目录遍历', async () => {
    write('a.md', '# 方块\nRegistry.register')
    const rag = createKbRag({
      roots: [{ alias: 'ref', dir: tempRoot }],
      cachePath: join(tempRoot, 'c.bin'),
      embedder: bagOfWordsEmbedder(),
      listFiles: () => null
    })
    await rag.ensureReady()
    expect(rag.status().files).toBe(1)
  })
})

describe('二进制向量缓存', () => {
  it('serializeCache/parseCache 往返一致（f32 精度内）', () => {
    const cache = {
      model: 'fake-bag',
      files: {
        '/x/a.md': { mtimeMs: 1234567890123, count: 2, vectors: [[0.5, -0.25, 1], [0, 0, 0.75]] }
      }
    }
    const parsed = parseCache(serializeCache(cache), 'fake-bag')!
    expect(parsed.model).toBe('fake-bag')
    expect(parsed.files['/x/a.md']!.mtimeMs).toBe(1234567890123)
    expect(parsed.files['/x/a.md']!.vectors[0]![0]).toBeCloseTo(0.5, 6)
    expect(parsed.files['/x/a.md']!.vectors[0]![1]).toBeCloseTo(-0.25, 6)
    // 模型不符 / 损坏一律 null
    expect(parseCache(serializeCache(cache), 'other-model')).toBeNull()
    expect(parseCache(Buffer.from('garbage'), 'fake-bag')).toBeNull()
  })

  it('缓存落盘为二进制（KYKB magic），二次启动零编码', async () => {
    write('a.md', '# 方块注册\nRegistry.register 注册方块')
    const cache = join(tempRoot, 'cache', 'embeddings.bin')
    const e1 = bagOfWordsEmbedder()
    await createKbRag({ roots: [{ alias: 'ref', dir: tempRoot }], cachePath: cache, embedder: e1 }).ensureReady()
    expect(e1.calls).toBeGreaterThan(0)
    expect(readFileSync(cache).subarray(0, 4).toString('latin1')).toBe('KYKB')

    const e2 = bagOfWordsEmbedder()
    const rag2 = createKbRag({ roots: [{ alias: 'ref', dir: tempRoot }], cachePath: cache, embedder: e2 })
    await rag2.ensureReady()
    expect(e2.calls).toBe(0)
    expect(rag2.status().ready).toBe(true)
  })

  it('旧 JSON 缓存一次性迁移：读取后重写为二进制并删除旧文件', async () => {
    write('a.md', '# 方块注册\nRegistry.register 注册方块')
    const dir = join(tempRoot, 'cache')
    const binCache = join(dir, 'embeddings.bin')
    const jsonCache = join(dir, 'embeddings.json')
    // 先生成真实向量，手工构造旧格式 JSON（model 显式注入，与缓存键一致）
    const e1 = bagOfWordsEmbedder()
    await createKbRag({
      roots: [{ alias: 'ref', dir: tempRoot }],
      cachePath: binCache,
      embedder: e1,
      model: 'fake-bag'
    }).ensureReady()
    const parsed = parseCache(readFileSync(binCache), 'fake-bag')!
    writeFileSync(jsonCache, JSON.stringify({ model: 'fake-bag', files: parsed.files }), 'utf-8')
    unlinkSync(binCache)

    const e2 = bagOfWordsEmbedder()
    const rag2 = createKbRag({
      roots: [{ alias: 'ref', dir: tempRoot }],
      cachePath: binCache,
      embedder: e2,
      model: 'fake-bag'
    })
    await rag2.ensureReady()
    expect(e2.calls).toBe(0) // 语料向量全部从旧 JSON 恢复
    expect(existsSync(binCache)).toBe(true) // 已重写为二进制
    expect(existsSync(jsonCache)).toBe(false) // 旧文件已删
    expect(rag2.status().ready).toBe(true)
  })
})

describe('createKbRag 热重载与重建', () => {
  it('reload：新增文件入索引并可检索', async () => {
    write('a.md', '# 方块注册\nRegistry.register 注册方块')
    const rag = createKbRag({
      roots: [{ alias: 'ref', dir: tempRoot }],
      cachePath: join(tempRoot, 'c.bin'),
      embedder: bagOfWordsEmbedder()
    })
    await rag.ensureReady()
    expect(rag.status().files).toBe(1)

    write('b.md', '# 食物\nFoodComponent hunger 饱食度')
    await rag.reload()
    expect(rag.status().files).toBe(2)
    const res = await rag.search('食物 hunger', 2)
    expect(res.hits[0]!.chunk.relPath).toContain('b.md')
  })

  it('reload：未初始化实例只重扫 chunk，不触发模型加载（懒语义保持）', async () => {
    write('a.md', '# 方块\nRegistry.register')
    const e = bagOfWordsEmbedder()
    const rag = createKbRag({
      roots: [{ alias: 'ref', dir: tempRoot }],
      cachePath: join(tempRoot, 'c.bin'),
      embedder: e
    })
    write('b.md', '# 食物\nFoodComponent')
    await rag.reload()
    expect(rag.status().files).toBe(2)
    expect(rag.status().ready).toBe(false)
    expect(e.calls).toBe(0)
  })

  it('rebuild：清缓存后全量重编码', async () => {
    write('a.md', '# 方块注册\nRegistry.register 注册方块')
    const cache = join(tempRoot, 'c.bin')
    const e = bagOfWordsEmbedder()
    const rag = createKbRag({ roots: [{ alias: 'ref', dir: tempRoot }], cachePath: cache, embedder: e })
    await rag.ensureReady()
    const before = e.calls
    expect(existsSync(cache)).toBe(true)

    await rag.rebuild()
    expect(e.calls).toBeGreaterThan(before)
    expect(rag.status().ready).toBe(true)
    expect(existsSync(cache)).toBe(true)
  })
})

describe('chunkText', () => {
  it('按 markdown 标题切段', () => {
    const chunks = chunkText('ref/a.md', 'abs', '# 标题一\n内容甲\n## 标题二\n内容乙')
    expect(chunks).toHaveLength(2)
    expect(chunks[0]!.text).toContain('标题一')
    expect(chunks[1]!.text).toContain('标题二')
    expect(chunks[1]!.id).toBe('ref/a.md#1')
  })

  it('超长段按行切块并保留重叠尾巴', () => {
    const long = '# 大段\n' + Array.from({ length: 80 }, (_, i) => `第${i}行内容内容内容内容内容内容内容内容`).join('\n')
    const chunks = chunkText('ref/long.md', 'abs', long)
    expect(chunks.length).toBeGreaterThan(1)
    // 每块控制在目标长度 + 单行冗余内
    for (const c of chunks) expect(c.text.length).toBeLessThan(760)
    // 后续块头部应能看到前一块末尾的重叠
    expect(chunks[1]!.text).toContain('内容')
  })
})

describe('tokenize', () => {
  it('英文按词、中文切单字与二元组', () => {
    const t = tokenize('注册 Block 方块')
    expect(t).toContain('block')
    expect(t).toContain('注册')
    expect(t).toContain('注')
  })
})

describe('createKbRag 向量检索', () => {
  it('语义命中排到首位', async () => {
    write('docs/block.md', '# 方块注册\n使用 Registry.register(Registries.BLOCK, new Identifier(modid, name), block) 注册自定义方块')
    write('docs/food.md', '# 食物\nFoodComponent.Builder 设置 hunger 与 saturationModifier')
    const cache = join(tempRoot, 'cache', 'emb.json')
    const embedder = bagOfWordsEmbedder()
    const rag = createKbRag({ roots: [{ alias: 'ref', dir: tempRoot }], cachePath: cache, embedder })

    expect(rag.status().ready).toBe(false)
    const res = await rag.search('如何注册一个自定义方块 Identifier', 3)
    expect(res.degraded).toBe(false)
    expect(res.hits[0]!.chunk.relPath).toContain('block.md')
    expect(rag.status().ready).toBe(true)
    expect(embedder.calls).toBeGreaterThan(0)
  })

  it('语料未变更时第二次启动走缓存，不再编码语料', async () => {
    write('a.md', '# 方块注册\nRegistry.register 注册方块')
    const cache = join(tempRoot, 'cache', 'emb.json')
    const first = bagOfWordsEmbedder()
    const rag1 = createKbRag({ roots: [{ alias: 'ref', dir: tempRoot }], cachePath: cache, embedder: first })
    await rag1.ensureReady()
    const corpusCalls = first.calls

    const second = bagOfWordsEmbedder()
    const rag2 = createKbRag({ roots: [{ alias: 'ref', dir: tempRoot }], cachePath: cache, embedder: second })
    await rag2.ensureReady()
    // 第二个 embedder 不应被用于编码语料（query 未发起）
    expect(second.calls).toBe(0)
    expect(corpusCalls).toBeGreaterThan(0)
    expect(rag2.status().ready).toBe(true)
  })

  it('文件变化后缓存失效并重新编码', async () => {
    const file = join(tempRoot, 'a.md')
    writeFileSync(file, '# 旧\n方块注册', 'utf-8')
    const cache = join(tempRoot, 'cache', 'emb.json')
    const e1 = bagOfWordsEmbedder()
    const rag1 = createKbRag({ roots: [{ alias: 'ref', dir: tempRoot }], cachePath: cache, embedder: e1 })
    await rag1.ensureReady()
    expect(e1.calls).toBeGreaterThan(0)

    // mtime 秒级精度，强制写新时间
    const future = Date.now() + 5000
    writeFileSync(file, '# 新\n食物 FoodComponent hunger', 'utf-8')
    utimesSync(file, new Date(future), new Date(future))

    const e2 = bagOfWordsEmbedder()
    const rag2 = createKbRag({ roots: [{ alias: 'ref', dir: tempRoot }], cachePath: cache, embedder: e2 })
    await rag2.ensureReady()
    expect(e2.calls).toBeGreaterThan(0)
    const res = await rag2.search('食物 hunger', 1)
    expect(res.hits[0]!.chunk.text).toContain('食物')
  })

  it('embedding 抛错时降级为关键词检索并标记 degraded', async () => {
    write('a.md', '# 方块注册\nRegistry.register(Registries.BLOCK, ...)')
    const failing: Embedder = {
      model: 'broken',
      async embed() {
        throw new Error('model download failed')
      }
    }
    const rag = createKbRag({
      roots: [{ alias: 'ref', dir: tempRoot }],
      cachePath: join(tempRoot, 'c.json'),
      embedder: failing
    })
    const res = await rag.search('注册 BLOCK', 3)
    expect(res.degraded).toBe(true)
    expect(res.reason).toContain('关键词')
    expect(res.hits.length).toBeGreaterThan(0)
    expect(res.hits[0]!.chunk.text).toContain('Registry')
  })

  it('P1-12：初始化失败后冷却窗口内不再重试，多次检索只编码一次', async () => {
    vi.useFakeTimers()
    try {
      write('a.md', '# 方块注册\nRegistry.register(Registries.BLOCK, ...)')
      let embedCalls = 0
      const failing: Embedder = {
        model: 'broken',
        async embed() {
          embedCalls += 1
          throw new Error('model download failed')
        }
      }
      const rag = createKbRag({
        roots: [{ alias: 'ref', dir: tempRoot }],
        cachePath: join(tempRoot, 'c.json'),
        embedder: failing
      })
      // 实测：模型不可达时每次检索都重新走下载流程（~10.7s/次），成本被反复支付
      const first = await rag.search('注册 BLOCK', 3)
      expect(first.degraded).toBe(true)
      expect(embedCalls).toBe(1)
      // 冷却窗口内的后续检索直接降级，不再重试
      const second = await rag.search('注册 BLOCK', 3)
      const third = await rag.search('注册 BLOCK', 3)
      expect(embedCalls).toBe(1)
      expect(second.degraded).toBe(true)
      expect(second.reason).toContain('不再重试')
      expect(third.degraded).toBe(true)
      expect(third.hits.length).toBeGreaterThan(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('P1-12：冷却窗口过后允许重试（网络/缓存恢复后自愈）', async () => {
    vi.useFakeTimers()
    try {
      write('a.md', '# 方块注册\nRegistry.register(Registries.BLOCK, ...)')
      let embedCalls = 0
      let shouldFail = true
      const flaky: Embedder = {
        model: 'flaky',
        async embed(texts) {
          embedCalls += 1
          if (shouldFail) throw new Error('network down')
          return texts.map(() => new Array(8).fill(0.5))
        }
      }
      const rag = createKbRag({
        roots: [{ alias: 'ref', dir: tempRoot }],
        cachePath: join(tempRoot, 'c.json'),
        embedder: flaky
      })
      await rag.search('注册 BLOCK', 3)
      expect(embedCalls).toBe(1)
      // 冷却窗口（5 分钟）内不重试
      await vi.advanceTimersByTime(4 * 60 * 1000)
      await rag.search('注册 BLOCK', 3)
      expect(embedCalls).toBe(1)
      // 窗口过后重试且成功 → 向量就绪（本次含语料编码 + 查询编码共 2 次调用，累计 3）
      shouldFail = false
      await vi.advanceTimersByTime(2 * 60 * 1000)
      const res = await rag.search('注册 BLOCK', 3)
      expect(embedCalls).toBe(3)
      expect(res.degraded).toBe(false)
      expect(rag.status().ready).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('空查询直接返回空结果', async () => {
    write('a.md', '内容')
    const rag = createKbRag({
      roots: [{ alias: 'ref', dir: tempRoot }],
      cachePath: join(tempRoot, 'c.json'),
      embedder: bagOfWordsEmbedder()
    })
    const res = await rag.search('   ', 3)
    expect(res.hits).toEqual([])
  })
})

/** 构造测试用 KbHit：file 仅作区分标识，score 为余弦分 */
function hitOf(file: string, text: string, score: number): KbHit {
  return { chunk: { id: `${file}#0`, file, relPath: file, index: 0, text }, score }
}

describe('blendRerank：词面融合重排', () => {
  it('词面强重合可在小分差内翻盘向量顶分', () => {
    // A 余弦 1.0 但零词面重合；B 余弦 0.6 且完整含查询标识符
    // 混合：A=0.7，B=0.7×0.6+0.3×1=0.72 → B 翻盘
    const hits = blendRerank(
      'FabricLootTableProvider 注册',
      [
        hitOf('a.md', '语义相关但词面完全不同的片段 内容内容', 1.0),
        hitOf('b.md', '使用 FabricLootTableProvider 完成 注册', 0.6)
      ],
      2
    )
    expect(hits[0]!.chunk.file).toBe('b.md')
    expect(hits[0]!.score).toBeCloseTo(0.72, 5)
  })

  it('余弦分差过大时词面重合翻不动（语义主导）', () => {
    // B 余弦 0.3：0.7×0.3+0.3=0.51 < A 的 0.7 → 维持原序
    const hits = blendRerank('foo bar', [hitOf('a.md', 'zero overlap zz', 1.0), hitOf('b.md', 'foo bar 全中', 0.3)], 2)
    expect(hits[0]!.chunk.file).toBe('a.md')
  })

  it('无词面信号时退化为余弦原序', () => {
    const hits = blendRerank('foo', [hitOf('a.md', '甲乙丙丁', 0.9), hitOf('b.md', '戊己庚辛', 0.8)], 2)
    expect(hits.map((h) => h.chunk.file)).toEqual(['a.md', 'b.md'])
  })

  it('截断到 k，单候选如实返回', () => {
    const hits = blendRerank('foo', [hitOf('a.md', 'foo', 0.5), hitOf('b.md', 'foo foo', 0.4), hitOf('c.md', 'foo', 0.3)], 2)
    expect(hits).toHaveLength(2)
    expect(blendRerank('foo', [hitOf('only.md', 'foo', 0.5)], 6)).toHaveLength(1)
  })
})

describe('createKbRag 重排接入', () => {
  it('向量顶分与词面冲突时，search 输出经混合重排', async () => {
    // 定向向量 embedder：按文本内标记分派向量——查询与 A 同向（余弦 1.0），B 夹角余弦 0.6，其余正交。
    // 标记词互不相同，保证 A 与查询零词面重合（混合重排的翻盘前提）。
    const directed: Embedder = {
      model: 'directed',
      async embed(texts) {
        return texts.map((t) => {
          if (t.includes('MARKQ')) return [1, 0, 0]
          if (t.includes('MARKA')) return [1, 0, 0]
          if (t.includes('MARKB')) return [0.6, 0.8, 0]
          return [0, 0, 1]
        })
      }
    }
    write('a.md', '# MARKA\n与查询语义同向但词面零重合 alpha beta')
    write('b.md', '# MARKB\n使用 FabricLootTableProvider 完成战利品表注册')
    write('c.md', '# MARKC\n完全无关的内容 gamma delta')
    const rag = createKbRag({
      roots: [{ alias: 'ref', dir: tempRoot }],
      cachePath: join(tempRoot, 'c.json'),
      embedder: directed
    })
    const res = await rag.search('MARKQ FabricLootTableProvider', 2)
    expect(res.degraded).toBe(false)
    // 查询含 FabricLootTableProvider：b.md 词面全中，0.7×0.6+0.3=0.72 > a.md 的 0.7 → 翻盘
    expect(res.hits[0]!.chunk.relPath).toContain('b.md')
    expect(res.hits[1]!.chunk.relPath).toContain('a.md')
  })

  it('查询与语料无词面重合时保持向量原序', async () => {
    write('a.md', '# 方块\nRegistry.register 注册自定义方块')
    write('b.md', '# 食物\nFoodComponent hunger 饱食度')
    const rag = createKbRag({
      roots: [{ alias: 'ref', dir: tempRoot }],
      cachePath: join(tempRoot, 'c.json'),
      embedder: bagOfWordsEmbedder()
    })
    const res = await rag.search('如何注册自定义方块', 2)
    expect(res.degraded).toBe(false)
    expect(res.hits[0]!.chunk.relPath).toContain('a.md')
  })
})
