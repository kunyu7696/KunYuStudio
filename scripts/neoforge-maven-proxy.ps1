# neoforge-maven-proxy.ps1 — 本地 Maven 反向代理（schannel 出口，v3）
#
# 背景：本机链路对 JVM(JSSE) 到 maven.neoforged.net（cdn77 节点）TLS 握手被丢弃，
# 到官方备用 CDN neoforged.forgecdn.net（CloudFront/cdn77）JSSE 同样 Read timed out，
# 而 Windows 自带 curl.exe（schannel 出口）稳定可用。
# ModDevGradle 会自动注入 maven.neoforged.net/releases 与 /mojang-meta 两个仓库，
# Gradle 对其每个 cdn 节点长超时反复重试（官方推荐 repositories.clear() 换 forgecdn，
# 见 NeoForge Discord/社区文章），但本机 JSSE 对 forgecdn 也不通，故仍需本地桥。
#
# 路由（<prefix>/<path> → 上游）：
#   /releases/<path>    → https://neoforged.forgecdn.net/releases/<path>
#   /snapshots/<path>   → https://neoforged.forgecdn.net/snapshots/<path>
#   /mojang-meta/<path> → https://neoforged.forgecdn.net/mojang-meta/<path>
#   /mojang-libs/<path> → https://libraries.minecraft.net/<path>
#
# 抓取走 curl.exe（schannel，二进制安全，--retry），磁盘缓存首次下载后零网络开销。
# 串行处理：PS5.1 线程池委托拿不到 $ctx（v2 已验证不可行）；curl 回源快 + 缓存滚雪球。
#
# 参数：-Port 18704 -CacheDir <dir>（默认 .dev-userdata/ai/neoforge-maven-cache）

param(
    [int]$Port = 18704,
    [string]$CacheDir = (Join-Path $PSScriptRoot '..\.dev-userdata\ai\neoforge-maven-cache')
)

$ErrorActionPreference = 'Stop'

function Write-Log([string]$msg) {
    [Console]::Out.WriteLine($msg)
}

# 前缀 → 上游根 URL
$UPSTREAM = @{
    'releases'    = 'https://neoforged.forgecdn.net/releases'
    'snapshots'   = 'https://neoforged.forgecdn.net/snapshots'
    'mojang-meta' = 'https://neoforged.forgecdn.net/mojang-meta'
    'mojang-libs' = 'https://libraries.minecraft.net'
}

if (-not (Test-Path $CacheDir)) { New-Item -ItemType Directory -Path $CacheDir -Force | Out-Null }
# 同路径并发下载互斥（串行循环下属于双保险）
$locks = @{}
$locksGuard = New-Object object
function Get-FileLock([string]$key) {
    :outer while ($true) {
        [System.Threading.Monitor]::Enter($locksGuard)
        try {
            if ($locks.ContainsKey($key)) { $l = $locks[$key] }
            else {
                $l = New-Object object
                $locks[$key] = $l
            }
            break outer
        } finally { [System.Threading.Monitor]::Exit($locksGuard) }
    }
    return $l
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://127.0.0.1:$Port/")
$listener.Start()
Write-Log "neoforge-maven-proxy v3 listening on http://127.0.0.1:$Port/ (forgecdn via schannel/curl; cache: $CacheDir)"

function Get-Mime([string]$path) {
    switch ([IO.Path]::GetExtension($path).ToLower()) {
        '.pom' { 'application/xml' }
        '.jar' { 'application/java-archive' }
        '.sha1' { 'text/plain' }
        '.sha256' { 'text/plain' }
        '.sha512' { 'text/plain' }
        '.md5' { 'text/plain' }
        '.module' { 'application/json' }
        '.json' { 'application/json' }
        '.xml' { 'application/xml' }
        '.zip' { 'application/zip' }
        default { 'application/octet-stream' }
    }
}

function Send-Bytes([System.Net.HttpListenerContext]$ctx, [int]$code, [byte[]]$bytes, [string]$mime) {
    # HEAD 请求只回响应头（HttpListener 强制 HEAD 无响应体，写体会抛 exceed Content-Length）。
    # 客户端也可能在响应完成前断连/切连接，写阶段异常吞掉并保证 Close，避免外层二次写入。
    $isHead = ($ctx.Request.HttpMethod -eq 'HEAD')
    try {
        $ctx.Response.StatusCode = $code
        $ctx.Response.ContentType = $mime
        $ctx.Response.ContentLength64 = $bytes.Length
        if (-not $isHead) {
            $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
        }
    } catch {
        if ($isHead) { Write-Log "HEAD_FAIL code=$code :: $($_.Exception.Message)" }
        else { Write-Log "WRITE_FAIL $($ctx.Request.HttpMethod) code=$code arraylen=$($bytes.Length) declared=$($ctx.Response.ContentLength64) :: $($_.Exception.Message)" }
    } finally {
        try { $ctx.Response.OutputStream.Close() } catch { }
        try { $ctx.Response.Close() } catch { }
    }
}

function Send-Text([System.Net.HttpListenerContext]$ctx, [int]$code, [string]$text) {
    # response 已开始/已关闭则不能再写（防止 Content-Length exceed 二次写入）
    if (-not $ctx.Response.OutputStream.CanWrite) { return }
    $b = [Text.Encoding]::UTF8.GetBytes($text)
    Send-Bytes $ctx $code $b 'text/plain; charset=utf-8'
}

# 用 curl.exe（schannel）抓取上游，二进制落地 tmp 文件。
# 返回 @{ ok=$bool; code=$int }；成功时 tmpPath 文件存在且非 0 字节（404 等小响应除外）。
function Fetch-Upstream([string]$url, [string]$tmpPath) {
    $errFile = [IO.Path]::GetTempFileName()
    # PS5.1 在 EAP=Stop 时会把原生命令(curl)的 4xx stderr 记录抛成终止异常，
    # 而 --fail-with-body 的 404 是正常分支，函数内局部降级为 Continue。
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    # 输出到 %TEMP% 短路径（避免深层缓存长路径在个别调用链下触发 curl 异常），成功后再 move
    $shortTmp = [IO.Path]::Combine($env:TEMP, "nb-$([guid]::NewGuid().ToString('N')).part")
    try {
        # 不用 -f/--fail-with-body：任何 HTTP 响应（含 4xx 响应体）curl 都 exit 0 并落盘，
        # 状态码由 -w 输出，由本函数按 code 分支，避免 exit 22/3 与 PS5.1 stderr 记录交互。
        $curlArgs = @(
            '-sS', '-L',
            '--retry', '3', '--retry-delay', '1',
            '--connect-timeout', '15', '--max-time', '600',
            '-A', 'KunYuProbe/1.0 (schannel bridge)',
            '-o', $shortTmp,
            '-w', '%{http_code}',
            $url
        )
        $codeText = (& curl.exe @curlArgs 2>$errFile | Out-String).Trim()
        $exit = $LASTEXITCODE
        $code = 0
        [void][int]::TryParse($codeText, [ref]$code)
        if ($code -ge 400 -and (Test-Path $shortTmp)) {
            # 4xx/5xx 响应体保留在 shortTmp 供调用方透传，绝不落缓存（避免 HIT 200 返回错误页）
            return @{ ok = $false; code = $code; bodyPath = $shortTmp }
        }
        if ($exit -eq 0 -and $code -gt 0 -and (Test-Path $shortTmp)) {
            return @{ ok = $true; code = $code; bodyPath = $shortTmp }
        }
        $errRaw = Get-Content $errFile -Raw -ErrorAction SilentlyContinue
        if (-not $errRaw) { $errRaw = '' }
        $err = $errRaw.Trim()
        Write-Log "FETCH_FAIL exit=$exit code=$code $url :: $($err.Substring(0, [Math]::Min(200, $err.Length)))"
        Remove-Item $shortTmp -Force -ErrorAction SilentlyContinue
        $failCode = if ($code -gt 0) { $code } else { 502 }
        return @{ ok = $false; code = $failCode; bodyPath = $null }
    } finally {
        $ErrorActionPreference = $prevEap
        Remove-Item $errFile -Force -ErrorAction SilentlyContinue
    }
}

function Invoke-Request([System.Net.HttpListenerContext]$ctx) {
    try {
        $rawPath = $ctx.Request.Url.AbsolutePath.TrimStart('/')
        Write-Log "REQ  $($ctx.Request.HttpMethod) /$rawPath http=$($ctx.Request.ProtocolVersion) keepalive=$($ctx.Request.KeepAlive)"
        $slash = $rawPath.IndexOf('/')
        $prefix = if ($slash -ge 0) { $rawPath.Substring(0, $slash) } else { $rawPath }
        $upstreamRoot = $UPSTREAM[$prefix]
        if (-not $upstreamRoot) {
            Send-Text $ctx 404 "unknown prefix: $prefix"
            return
        }
        $relUrl = if ($slash -ge 0) { $rawPath.Substring($slash + 1) } else { '' }
        $relPath = $relUrl -replace '/', '\'
        $cacheFile = Join-Path (Join-Path $CacheDir $prefix) $relPath

        if (Test-Path $cacheFile) {
            $bytes = [IO.File]::ReadAllBytes($cacheFile)
            Send-Bytes $ctx 200 $bytes (Get-Mime $relPath)
            Write-Log "HIT  /$rawPath ($($bytes.Length) bytes)"
            return
        }

        $l = Get-FileLock "$prefix/$relPath"
        [System.Threading.Monitor]::Enter($l)
        try {
            # 双检
            if (Test-Path $cacheFile) {
                $bytes = [IO.File]::ReadAllBytes($cacheFile)
                Send-Bytes $ctx 200 $bytes (Get-Mime $relPath)
                Write-Log "HIT* /$rawPath ($($bytes.Length) bytes)"
                return
            }

            $upstream = "$upstreamRoot/$relUrl"
            $cacheParent = Split-Path $cacheFile -Parent
            if (-not (Test-Path $cacheParent)) { New-Item -ItemType Directory -Path $cacheParent -Force | Out-Null }

            # tmpPath 仅作为 Fetch 语义参数保留（实际抓取落地 %TEMP% 短路径）
            $r = Fetch-Upstream $upstream $cacheFile
            if (-not $r.ok) {
                # 4xx/5xx 原样透传状态码（Gradle 据此跳过可选依赖），响应体透传后丢弃，不落缓存
                if ($r.bodyPath -and (Test-Path $r.bodyPath)) {
                    $bytes = [IO.File]::ReadAllBytes($r.bodyPath)
                    Send-Bytes $ctx $r.code $bytes (Get-Mime $relPath)
                    Remove-Item $r.bodyPath -Force -ErrorAction SilentlyContinue
                } else {
                    Send-Text $ctx $r.code "upstream fetch failed"
                }
                Write-Log "UP-$($r.code) /$rawPath"
                return
            }

            $bodyPath = $r.bodyPath
            $len = (Get-Item $bodyPath).Length
            if ($len -eq 0) {
                Remove-Item $bodyPath -Force -ErrorAction SilentlyContinue
                Send-Text $ctx 502 "upstream returned empty body"
                Write-Log "EMPTY /$rawPath"
                return
            }
            Move-Item -Force $bodyPath $cacheFile
            $bytes = [IO.File]::ReadAllBytes($cacheFile)
            Send-Bytes $ctx 200 $bytes (Get-Mime $relPath)
            Write-Log "MISS /$rawPath -> cached ($len bytes)"
        } finally {
            [System.Threading.Monitor]::Exit($l)
        }
    } catch {
        Write-Log "ERR  $($_.Exception.Message)"
        try { Send-Text $ctx 500 "proxy error" } catch { }
    }
}

while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    Invoke-Request $ctx
}
