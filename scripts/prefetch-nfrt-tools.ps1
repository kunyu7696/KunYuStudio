# prefetch-nfrt-tools.ps1 — 预置 NeoForge 构建所需的 NFRT 工具（schannel 出口）
#
# 背景：NFRT（NeoForm Runtime）对「不在 artifact manifest 里」的工具（如 binarypatcher）
# 会硬编码从 https://maven.neoforged.net/releases/ 下载。该域名在部分国内网络被污染/
# 丢包（JVM 直连超时），而 Gradle 仓库可以走 neoforged.forgecdn.net，于是构建会卡在
# :createMinecraftArtifacts 并报 NodeExecutionException: Node action for binaryPatch failed。
#
# 本脚本用 Windows 自带 curl.exe（schannel，二进制安全）从 forgecdn 拉取这些工具，
# 校验远端 .sha1 后写入 NFRT 工件缓存（~/.gradle/caches/neoformruntime/artifacts）。
# 之后 Gradle 构建直接 REUSE 缓存，不再触网。
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File scripts/prefetch-nfrt-tools.ps1
#   powershell -File scripts/prefetch-nfrt-tools.ps1 -Coordinates 'net.neoforged.installertools:binarypatcher:2.1.2:fatjar'
#
# 何时用：neoforge 组合构建日志出现以下两行且随后连接失败时——
#   WARNING: <坐标> is not present in the artifact manifest
#   DL    https://maven.neoforged.net/releases/...
# 把日志里的坐标传给 -Coordinates 重跑本脚本，再重新构建。
#
# 坐标格式：groupId:artifactId:version[:classifier]
#   classifier 省略时取主 jar；NeoForge 工具多为 fatjar / all。

param(
    [string[]]$Coordinates = @(
        'net.neoforged.installertools:binarypatcher:2.1.2:fatjar',
        'net.minecraftforge:binarypatcher:1.1.1:fatjar'
    ),
    [string]$CacheDir = (Join-Path $env:USERPROFILE '.gradle\caches\neoformruntime\artifacts'),
    [string[]]$BaseUrls = @(
        'https://neoforged.forgecdn.net/releases',
        'https://maven.neoforged.net/releases'
    )
)

$ErrorActionPreference = 'Stop'

$curl = Join-Path $env:SystemRoot 'System32\curl.exe'
if (-not (Test-Path $curl)) {
    throw "未找到 curl.exe（$curl），无法使用 schannel 出口下载"
}

if (-not (Test-Path $CacheDir)) {
    New-Item -ItemType Directory -Path $CacheDir -Force | Out-Null
}

function Get-RemoteSha1([string]$url) {
    # .sha1 内容通常是「哈希」或「哈希  文件名」，取第一段
    $text = & $curl -sSL --fail --max-time 60 "$url.sha1"
    if ($LASTEXITCODE -ne 0 -or -not $text) { return $null }
    $hash = ($text -split '\s+')[0].Trim().ToLower()
    if ($hash -match '^[0-9a-f]{40}$') { return $hash }
    return $null
}

function Get-LocalSha1([string]$path) {
    return (Get-FileHash -Algorithm SHA1 -Path $path).Hash.ToLower()
}

$ok = 0
$failed = 0
$skipped = 0

# -File 调用时逗号不会拆成数组（整体作为一个字符串），这里补一次拆分
$Coordinates = $Coordinates | ForEach-Object { $_ -split ',' } | Where-Object { $_.Trim() } | ForEach-Object { $_.Trim() }

foreach ($coord in $Coordinates) {
    $parts = $coord.Split(':')
    if ($parts.Count -lt 3) {
        Write-Host "[skip] 坐标格式错误：$coord（应为 groupId:artifactId:version[:classifier]）"
        $failed++
        continue
    }
    $group = $parts[0]
    $artifact = $parts[1]
    $version = $parts[2]
    $classifier = if ($parts.Count -ge 4) { $parts[3] } else { '' }

    $fileName = if ($classifier) { "$artifact-$version-$classifier.jar" } else { "$artifact-$version.jar" }
    $relative = ($group.Replace('.', '\') + "\$artifact\$version")
    $destDir = Join-Path $CacheDir $relative
    $dest = Join-Path $destDir $fileName

    Write-Host "[tool] $coord"
    Write-Host "       -> $dest"

    $downloaded = $false
    foreach ($base in $BaseUrls) {
        $url = ($base.TrimEnd('/') + '/' + ($relative.Replace('\', '/')) + "/$fileName")
        $remote = Get-RemoteSha1 $url
        if (-not $remote) {
            Write-Host "       [miss] $base 无 .sha1 或不可达"
            continue
        }
        if (Test-Path $dest) {
            $local = Get-LocalSha1 $dest
            if ($local -eq $remote) {
                Write-Host "       [cached] sha1 一致，跳过"
                $skipped++
                $downloaded = $true
                break
            }
            Write-Host "       [stale] 本地 sha1 不符（$local），重新下载"
        }
        New-Item -ItemType Directory -Path $destDir -Force | Out-Null
        $tmp = "$dest.tmp"
        & $curl -sSL --fail --retry 3 --max-time 600 -o $tmp $url
        if ($LASTEXITCODE -ne 0 -or -not (Test-Path $tmp)) {
            Write-Host "       [fail] 下载失败：$url"
            if (Test-Path $tmp) { Remove-Item $tmp -Force -ErrorAction SilentlyContinue }
            continue
        }
        $local = Get-LocalSha1 $tmp
        if ($local -ne $remote) {
            Write-Host "       [fail] sha1 校验不符（local=$local remote=$remote）"
            Remove-Item $tmp -Force -ErrorAction SilentlyContinue
            continue
        }
        Move-Item -Path $tmp -Destination $dest -Force
        Write-Host "       [ok] 已落盘并校验"
        $ok++
        $downloaded = $true
        break
    }
    if (-not $downloaded) {
        Write-Host "       [fail] 所有上游均不可用"
        $failed++
    }
}

Write-Host ""
Write-Host "完成：新增 $ok，已缓存 $skipped，失败 $failed"
if ($failed -gt 0) { exit 1 }
