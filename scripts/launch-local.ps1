param(
    [switch]$OpenBrowser,
    [switch]$Quiet
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$projectRoot = Split-Path $PSScriptRoot -Parent
$runtimeRoot = Join-Path $projectRoot '.runtime\services'
$address = 'http://127.0.0.1:5173/dashboard'
$startupFile = Join-Path $PSScriptRoot 'start-local.ps1'
$powershellExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$mutex = $null
$lockTaken = $false
$exitCode = 0

function Write-LaunchEvent([string]$EventName) {
    # Fixed event names only: never copy environment variables or child output into this log.
    $stamp = [DateTime]::UtcNow.ToString('o')
    Add-Content -LiteralPath (Join-Path $runtimeRoot 'launcher.log') -Value "$stamp $EventName" -Encoding UTF8
}

function Test-CoreReady {
    try {
        $api = Invoke-RestMethod -Uri 'http://127.0.0.1:3001/ready' -TimeoutSec 3
        if ($api.status -ne 'ready') { return $false }
        $web = Invoke-WebRequest -Uri $address -UseBasicParsing -TimeoutSec 3
        # Windows PowerShell may decode a charset-less HTML response using a
        # legacy code page. Match stable ASCII entry points, not the Chinese title.
        return $web.StatusCode -eq 200 -and $web.Content -match '<div id="root"></div>' -and $web.Content -match '/src/main\.tsx|/assets/index-'
    } catch { return $false }
}

function Test-EmbeddingReady {
    try { return (Invoke-RestMethod -Uri 'http://127.0.0.1:3010/ready' -TimeoutSec 3).status -eq 'ready' }
    catch { return $false }
}

try {
    New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
    Write-LaunchEvent 'launch_requested'
    # Serialize simultaneous login / double-click launches without stopping existing services.
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { $workspaceHash = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($projectRoot.ToLowerInvariant()))).Replace('-', '').Substring(0, 20) }
    finally { $sha.Dispose() }
    $mutex = New-Object System.Threading.Mutex($false, "Local\GongxuLaunch-$workspaceHash")
    try { $lockTaken = $mutex.WaitOne(120000) }
    catch [System.Threading.AbandonedMutexException] { $lockTaken = $true }
    if (-not $lockTaken) { throw 'startup_busy' }

    if (-not (Test-CoreReady) -or -not (Test-EmbeddingReady)) {
        Write-LaunchEvent 'starting_services'
        # Use the existing startup script. It reads local configuration, preserves the
        # database, checks applied migrations, and starts only missing listeners.
        & $powershellExe -NoProfile -ExecutionPolicy Bypass -File $startupFile *> $null
        if ($LASTEXITCODE -ne 0) { throw 'service_start_failed' }
    }
    if (-not (Test-CoreReady)) { throw 'service_not_ready' }
    if (Test-EmbeddingReady) { Write-LaunchEvent 'ready_with_embedding' }
    else { Write-LaunchEvent 'core_ready_embedding_unavailable' }
    Write-Output 'Gongxu is ready: http://127.0.0.1:5173/dashboard'
    # Login startup is silent. A browser is opened only by the desktop shortcut.
    if ($OpenBrowser) { Start-Process -FilePath $address }
} catch {
    $exitCode = 1
    try { Write-LaunchEvent 'startup_failed' } catch { }
    if (-not $Quiet) {
        Add-Type -AssemblyName System.Windows.Forms
        [System.Windows.Forms.MessageBox]::Show(
            "工序智伴暂时未能启动。请稍后再次双击桌面入口。`n`n如仍打不开，请保留项目目录并查看：`n$runtimeRoot`n`n项目数据不会因启动失败被删除。",
            '工序智伴 · 启动提示', 'OK', 'Warning'
        ) | Out-Null
    }
    Write-Output 'Gongxu startup failed. See the local service status and logs; no credentials were printed.'
} finally {
    if ($lockTaken -and $mutex) { $mutex.ReleaseMutex() }
    if ($mutex) { $mutex.Dispose() }
}
exit $exitCode
