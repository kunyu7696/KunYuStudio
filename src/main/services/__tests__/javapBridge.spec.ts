/**
 * javap 桥接器测试：
 * - parseJavapOutput 固化样本解析
 * - javap 缺失的可识别错误
 * - TR-4.2 大 jar 端到端计时（环境不满足时 skip）
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
vi.mock('../settingsService', () => ({
  getSection: () => ({ globalJdkHome: null })
}))
import {
  classEntryToFqn,
  createJavapBridge,
  parseJavapOutput
} from '../performance/javapBridge'
import { openZip } from '../performance/jarReader'

const JAVAP_SAMPLE = `Classfile jar:mymod.jar!/com/example/Foo.class
  Last modified 2026-9-20; size 1234 bytes
  Compiled from "Foo.java"
public class com.example.Foo extends net.minecraft.block.Block implements net.minecraft.resource.SynchronousResourceCallback {
  private static final java.util.Map CACHE;
    descriptor: Ljava/util/Map;
    flags: (0x001a) ACC_PRIVATE, ACC_STATIC, ACC_FINAL

  private int counter;
    descriptor: I
    flags: (0x0002) ACC_PRIVATE

  public com.example.Foo();
    descriptor: ()V
    flags: (0x0001) ACC_PUBLIC
    Code:
      stack=2, locals=1, args_size=1
         0: aload_0
         1: invokespecial #15        // Method net/minecraft/block/Block."<init>":()V
         4: return
      LineNumberTable:
        line 12: 0

  public void tick(net.minecraft.world.World);
    descriptor: (Lnet/minecraft/world/World;)V
    flags: (0x0001) ACC_PUBLIC
    Code:
      stack=3, locals=2, args_size=2
         0: new           #20        // class java/io/File
         3: dup
         4: invokevirtual #26        // Method java/net/URL.openStream:()Ljava/io/InputStream;
         7: invokestatic  #30        // Method java/lang/Thread.sleep:(J)V
        10: return
      RuntimeVisibleAnnotations:
        0: #42(@org.spongepowered.asm.mixin.injection.Inject)
}
`

describe('classEntryToFqn', () => {
  it('路径转全限定名，非 class 返回 null', () => {
    expect(classEntryToFqn('com/example/Foo$1.class')).toBe('com.example.Foo$1')
    expect(classEntryToFqn('assets/x.json')).toBeNull()
    expect(classEntryToFqn('META-INF/versions/11/Foo.class')).toBeNull()
    expect(classEntryToFqn('org/x/META-INF/versions/11/Foo.class')).toBeNull()
  })
})

describe('parseJavapOutput', () => {
  const cls = parseJavapOutput(JAVAP_SAMPLE)

  it('类头/父类/接口', () => {
    expect(cls).toHaveLength(1)
    expect(cls[0]?.name).toBe('com.example.Foo')
    expect(cls[0]?.superClass).toBe('net.minecraft.block.Block')
    expect(cls[0]?.interfaces).toEqual(['net.minecraft.resource.SynchronousResourceCallback'])
  })

  it('字段：修饰符与类型', () => {
    const fields = cls[0]?.fields ?? []
    expect(fields[0]).toMatchObject({
      name: 'CACHE',
      type: 'java.util.Map',
      isStatic: true,
      isFinal: true
    })
    expect(fields[1]).toMatchObject({ name: 'counter', type: 'int', isStatic: false })
  })

  it('方法指令序列与解析引用', () => {
    const tick = cls[0]?.methods.find((m) => m.name === 'tick')
    expect(tick?.descriptor).toBe('(Lnet/minecraft/world/World;)V')
    expect(tick?.instructions.map((i) => i.opcode)).toEqual([
      'new', 'dup', 'invokevirtual', 'invokestatic', 'return'
    ])
    const newInstr = tick?.instructions[0]
    expect(newInstr?.rawArg).toBe('#20')
    expect(newInstr?.ref).toBe('class java/io/File')
    expect(tick?.instructions[3]?.ref).toContain('Thread.sleep')
  })

  it('注解归属方法级', () => {
    const tick = cls[0]?.methods.find((m) => m.name === 'tick')
    expect(tick?.annotations).toEqual([
      { type: 'org.spongepowered.asm.mixin.injection.Inject', params: '' }
    ])
  })

  it('空输出返回空数组', () => {
    expect(parseJavapOutput('')).toEqual([])
  })
})

describe('javap 缺失', () => {
  it('ENOENT 转为可识别错误', () => {
    const bridge = createJavapBridge('C:\\__no_such_jdk__')
    expect(() => bridge.analyze('x.jar', ['com.Foo'])).toThrow(/未找到 javap/)
  })
})

/** 递归浅层收集 ≥minSize 的 jar（限目录深度与数量） */
function collectLargeJars(
  rootDir: string,
  minSize: number,
  depth: number,
  out: string[],
  limit: number
): void {
  if (!existsSync(rootDir) || depth < 0 || out.length >= limit) return
  for (const entry of readdirSync(rootDir)) {
    if (out.length >= limit) return
    const full = join(rootDir, entry)
    let isDir = false
    let size = 0
    try {
      const st = statSync(full)
      isDir = st.isDirectory()
      size = st.size
    } catch {
      continue
    }
    if (isDir) {
      if (depth > 0) collectLargeJars(full, minSize, depth - 1, out, limit)
      continue
    }
    if (
      size >= minSize &&
      entry.endsWith('.jar') &&
      !entry.includes('sources') &&
      !entry.includes('javadoc')
    ) {
      out.push(full)
    }
  }
}

describe('TR-4.2 大 jar 计时', () => {
  it('≥500 class 端到端 ≤15s', () => {
    const javaHome = 'C:\\Program Files\\Java\\jdk-17'
    if (!existsSync(join(javaHome, 'bin', 'javap.exe'))) return
    const candidates = [
      join(process.cwd(), 'instances'),
      'C:\\Users\\Administrator\\.gradle'
    ]
    const jars: string[] = []
    for (const c of candidates) {
      collectLargeJars(c, 1_000_000, 9, jars, 40)
      if (jars.length > 0) break
    }

    // 选第一个 ≥500 class 的 jar；TR-4.2 只分析 500 类
    let jar: string | null = null
    for (const candidate of jars) {
      const count = openZip(candidate).entries()
        .map((e) => classEntryToFqn(e.path))
        .filter((x): x is string => x !== null).length
      if (count >= 500) {
        jar = candidate
        break
      }
    }
    if (!jar) return

    const fqns = openZip(jar).entries()
      .map((e) => classEntryToFqn(e.path))
      .filter((x): x is string => x !== null)
      .slice(0, 500)

    const bridge = createJavapBridge(javaHome)
    const start = Date.now()
    const parsed = bridge.analyze(jar, fqns)
    const elapsed = Date.now() - start
     
    console.log(`[TR-4.2] ${jar} classes=${fqns.length} parsed=${parsed.length} ${elapsed}ms`)
    expect(parsed.length).toBeGreaterThan(400)
    expect(elapsed).toBeLessThanOrEqual(15_000)
  }, 30_000)
})
