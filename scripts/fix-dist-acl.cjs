#!/usr/bin/env node
/*
 * 打包前修复 dist 目录 ACL。
 *
 * 背景：仓库 ACL 修复在仓库根留下了两类病理项，并随继承传播：
 *   1. Everyone: Deny DeleteSubdirectoriesAndFiles 显式 ACE
 *      该拒绝项对删除操作实际无效（普通 Remove-Item 仍可删），但会导致
 *      从 dist 内执行的进程行为异常。
 *   2. Low Mandatory Level 完整性标签（(OI)(CI) 传播到文件）
 *      dist 内生成的 exe 被打上 Low 标签后以低完整性级别启动，无法写入
 *      Medium 完整性位置（如 $LOCALAPPDATA），NSIS 卸载器预生成的 stub
 *      安装包因此在 .onInit 阶段以 exit code 2 失败（已实证：同一 exe
 *      复制到 %TEMP% 后 exit 0 且正常写出卸载器）。
 *
 * 对策：确保 dist 根目录存在、ACL 断开继承并剔除 Everyone 拒绝项、
 * 完整性级别恢复为 Medium。只要 dist 根不被删除（electron-builder 默认
 * 只清理子内容），修复即可持续生效；若根目录被重建则重新自愈。
 * 仅在 Windows 上执行；其他平台直接跳过。
 */
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

if (process.platform !== 'win32') {
  process.exit(0)
}

const dist = path.join(__dirname, '..', 'dist')
fs.mkdirSync(dist, { recursive: true })

function denyEveryonePresent(dir) {
  try {
    const out = execFileSync('icacls', [dir], { encoding: 'utf8' })
    // icacls 输出形如 "Everyone:(OI)(CI)(DENY)(Dc)" 或英文 "(DENY)"
    return /Everyone:\([^)]*DENY/i.test(out)
  } catch {
    return false
  }
}

if (denyEveryonePresent(dist)) {
  // 断开继承（保留现有 Allow 拷贝）→ 删除 Everyone 拒绝项
  execFileSync('icacls', [dist, '/inheritance:d'], { stdio: 'ignore' })
  execFileSync('icacls', [dist, '/remove:d', 'Everyone'], { stdio: 'ignore' })
  console.log('[fix-dist-acl] 已剔除 dist 的 Everyone 拒绝 ACE（断开继承）')
} else {
  console.log('[fix-dist-acl] dist ACL 正常，无需处理')
}

// Low Mandatory Level 标签会让 dist 内 exe 以低完整性运行，导致 NSIS stub 失败
function lowIntegrityPresent(dir) {
  try {
    const out = execFileSync('icacls', [dir], { encoding: 'utf8' })
    return /Low Mandatory Level/i.test(out)
  } catch {
    return false
  }
}

if (lowIntegrityPresent(dist)) {
  execFileSync('icacls', [dist, '/setintegritylevel', 'M'], { stdio: 'ignore' })
  console.log('[fix-dist-acl] 已将 dist 完整性级别从 Low 恢复为 Medium')
} else {
  console.log('[fix-dist-acl] dist 完整性级别正常，无需处理')
}
