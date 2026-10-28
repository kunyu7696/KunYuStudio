/**
 * M4 Java 智能 import 跨进程 DTO。
 * 主进程扫描项目源码建立 简单类名 → 全限定名 索引，渲染层据此生成缺失 import 诊断与灯泡修复。
 */

/** 索引中的一个 Java 类型候选 */
export interface JavaClassCandidate {
  /** 全限定名，如 net.minecraft.util.Identifier */
  fqcn: string
  /** 相对项目根的源码路径（正斜杠），如 src/main/java/com/demo/Foo.java */
  relPath: string
}

/** 单个未解析简单名的解析结果 */
export interface JavaResolvedSymbol {
  /** 是否存在于当前文件所在包（同包类型无需 import） */
  samePackage: boolean
  /** 全限定名候选（同名类可能有多个） */
  candidates: JavaClassCandidate[]
}

/** 渲染层 → 主进程的批量解析请求 */
export interface JavaResolveSymbolsRequest {
  /** 当前打开的项目 id（主进程据此解析项目根） */
  projectId: string
  /** 当前文件的 package 声明（无包声明传空串） */
  packageName: string
  /** 待解析的简单类名列表（已去重） */
  symbols: string[]
}

/** key = 简单类名 */
export type JavaResolveSymbolsResponse = Record<string, JavaResolvedSymbol>

export type JavaResolveSymbolsResult =
  | { ok: true; data: JavaResolveSymbolsResponse }
  | { ok: false; error: string }
