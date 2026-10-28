/**
 * JFR 命令执行：调用 JDK 自带 `jfr print` 输出录制内容（TR-13）。
 * 三种来源（织星 JFR 启动参数产出 / 对运行游戏附加记录 / 手动导入 .jfr）
 * 最终都落为一个 .jfr 文件，由本模块统一打印为文本，再交 jfrParser 解析。
 */
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/** 定位 jfr 可执行（JDK_HOME/bin/jfr[.exe]），不存在返回 null */
export function resolveJfrBin(jdkHome: string): string | null {
  const bin = join(jdkHome, 'bin', process.platform === 'win32' ? 'jfr.exe' : 'jfr')
  return existsSync(bin) ? bin : null
}

/** 执行 `jfr print <file>`，resolve 文本输出 */
export function runJfrPrint(
  jdkHome: string,
  jfrFile: string,
  timeoutMs = 120_000
): Promise<string> {
  const bin = resolveJfrBin(jdkHome)
  if (!bin) {
    return Promise.reject(new Error(`在 ${jdkHome} 下未找到 jfr，请先配置 JDK 17+`))
  }
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      ['print', jfrFile],
      { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 },
      (err, stdout) => {
        if (err) reject(err)
        else resolve(stdout)
      }
    )
  })
}
