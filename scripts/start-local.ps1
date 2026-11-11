param(
    [ValidateSet('auto', 'docker', 'native', 'external')][string]$Database = 'auto',
    [switch]$Build,
    [switch]$RestartApi
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$projectRoot = Split-Path $PSScriptRoot -Parent
$workspaceRoot = Split-Path $projectRoot -Parent
$runtimeRoot = Join-Path $projectRoot '.runtime\services'
New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null

function Write-StartupStage([string]$Stage) {
    # Stage names are fixed by this script; no child output or configuration is copied.
    Add-Content -LiteralPath (Join-Path $runtimeRoot 'startup-status.log') -Value "$([DateTime]::UtcNow.ToString('o')) $Stage" -Encoding UTF8
}

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$pnpmCommand = Get-Command pnpm -ErrorAction SilentlyContinue
if (-not $nodeCommand -or -not $pnpmCommand) {
    $runtimeDependencies = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies'
    $runtimeNode = Join-Path $runtimeDependencies 'node\bin'
    if (Test-Path -LiteralPath (Join-Path $runtimeNode 'node.exe')) {
        $env:PATH = "$runtimeNode;$(Join-Path $runtimeDependencies 'bin\fallback');$env:PATH"
    }
    $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
    if (-not $nodeCommand) { throw 'Node.js 22+ is required.' }
}
$pnpmCommand = Get-Command pnpm -ErrorAction Stop
$nativeBootstrap = Join-Path $workspaceRoot '.setup\postgresql\start-local-postgres.mjs'
if ($Database -eq 'auto') { $Database = if (Test-Path -LiteralPath $nativeBootstrap) { 'native' } else { 'docker' } }

Push-Location $projectRoot
try {
    Write-StartupStage 'checking_database'
    if ($Database -eq 'native') {
        if (-not (Test-Path -LiteralPath $nativeBootstrap)) { throw 'Native PostgreSQL bootstrap is not installed in this workspace. Use Docker or an external PostgreSQL server.' }
        & $nodeCommand.Source $nativeBootstrap
        if ($LASTEXITCODE -ne 0) { throw 'Local PostgreSQL is not ready.' }
    } elseif ($Database -eq 'docker') {
        $dockerCommand = Get-Command docker -ErrorAction SilentlyContinue
        $dockerExe = if ($dockerCommand) { $dockerCommand.Source } else { Join-Path $env:LOCALAPPDATA 'Programs\DockerDesktop\resources\bin\docker.exe' }
        if (-not (Test-Path -LiteralPath $dockerExe)) { throw 'Docker Desktop is required for Docker mode.' }
        & $dockerExe compose up -d
        if ($LASTEXITCODE -ne 0) { throw 'Docker database startup failed. Existing data was preserved.' }
    }
    Write-StartupStage 'checking_migrations'
    & $pnpmCommand.Source --filter '@gongxu/api' db:migrate
    if ($LASTEXITCODE -ne 0) { throw 'Database migrations failed; application startup stopped.' }
    if ($Build -or -not (Test-Path -LiteralPath (Join-Path $projectRoot 'apps\embedding\dist\server.js')) -or -not (Test-Path -LiteralPath (Join-Path $projectRoot 'apps\api\dist\server.js'))) {
        Write-StartupStage 'building'
        & $pnpmCommand.Source build
        if ($LASTEXITCODE -ne 0) { throw 'Build failed; application startup stopped.' }
    }

    function Start-ProjectService([string]$Name, [int]$Port, [string]$Directory, [string]$Arguments) {
        $metadataPath = Join-Path $runtimeRoot "$Name-process.json"
        # A permission/provider failure is not evidence that a port is unused.
        try { $listener = Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object { $_.LocalPort -eq $Port } | Select-Object -First 1 }
        catch { throw 'Local listener ownership could not be inspected. Start from a normal Windows user session; no service metadata was replaced.' }
        if (-not $listener) {
            $probe = New-Object System.Net.Sockets.TcpClient
            $portOpen = $false
            try { $portOpen = $probe.ConnectAsync('127.0.0.1', $Port).Wait(500) -and $probe.Connected } catch { $portOpen = $false } finally { $probe.Dispose() }
            if ($portOpen) { throw 'The service port is reachable but its owner is not visible. Startup stopped without replacing service metadata.' }
        }
        if ($listener -and $Name -eq 'api' -and $RestartApi) {
            $owned = $false
            foreach ($candidate in @($metadataPath, (Join-Path $workspaceRoot ".setup\runtime\$Name-process.json"))) {
                if (-not (Test-Path -LiteralPath $candidate)) { continue }
                $saved = Get-Content -LiteralPath $candidate -Raw | ConvertFrom-Json
                if ($listener.OwningProcess -ne $saved.processId) { continue }
                $running = Get-Process -Id $saved.processId
                if ([math]::Abs(($running.StartTime - [datetime]$saved.startedAt).TotalSeconds) -le 20) {
                    Stop-Process -Id $saved.processId
                    $owned = $true
                    break
                }
            }
            if (-not $owned) { throw 'The API port belongs to an unrecognized process; restart was cancelled.' }
            $listener = $null
        }
        if ($listener) { Write-Output "$Name already has a listener; checking readiness separately."; return }
        $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
        $service = Start-Process -FilePath $nodeCommand.Source -ArgumentList $Arguments -WorkingDirectory $Directory -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtimeRoot "$Name-$stamp.stdout.log") -RedirectStandardError (Join-Path $runtimeRoot "$Name-$stamp.stderr.log")
        Start-Sleep -Milliseconds 500
        $service.Refresh()
        if ($service.HasExited) { throw 'A service exited during startup. Existing process metadata was preserved; inspect the local service log.' }
        if (Test-Path -LiteralPath $metadataPath) { Copy-Item -LiteralPath $metadataPath -Destination (Join-Path $runtimeRoot "$Name-process-$stamp.backup.json") }
        [ordered]@{ processId=$service.Id; startedAt=$service.StartTime.ToString('o'); workingDirectory=$Directory } | ConvertTo-Json | Set-Content -LiteralPath $metadataPath -Encoding UTF8
        Write-Output "$Name started; readiness has not yet been confirmed."
    }

    Write-StartupStage 'starting_services'
    Start-ProjectService 'embedding' 3010 (Join-Path $projectRoot 'apps\embedding') 'dist/server.js'
    Start-ProjectService 'api' 3001 (Join-Path $projectRoot 'apps\api') 'dist/server.js'
    Start-ProjectService 'web' 5173 (Join-Path $projectRoot 'apps\web') 'node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5173 --strictPort'

    function Wait-Service([string]$Uri, [string]$Expected = 'ready', [switch]$HttpOnly, [int]$TimeoutSeconds = 60, [int]$RetryDelayMilliseconds = 300) {
        if ($TimeoutSeconds -le 0 -or $RetryDelayMilliseconds -le 0) { throw 'Readiness timeout and retry delay must be positive.' }
        $watch = [System.Diagnostics.Stopwatch]::StartNew()
        $budgetMilliseconds = $TimeoutSeconds * 1000
        while ($watch.ElapsedMilliseconds -lt $budgetMilliseconds) {
            try {
                # Bound each read by the remaining deadline (PowerShell uses whole seconds).
                # This helper only observes readiness; it never starts or restarts a service.
                $remainingSeconds = ($budgetMilliseconds - $watch.ElapsedMilliseconds) / 1000.0
                $requestTimeout = [int][math]::Max(1, [math]::Min(3, [math]::Ceiling($remainingSeconds)))
                $response = Invoke-WebRequest -Uri $Uri -UseBasicParsing -TimeoutSec $requestTimeout
                if ($response.StatusCode -eq 200 -and $watch.ElapsedMilliseconds -lt $budgetMilliseconds) {
                    if ($HttpOnly) { return $true }
                    $body = $response.Content | ConvertFrom-Json
                    if ($body.status -eq $Expected) { return $true }
                }
            } catch { }
            $remainingMilliseconds = $budgetMilliseconds - $watch.ElapsedMilliseconds
            if ($remainingMilliseconds -gt 0) { Start-Sleep -Milliseconds ([int][math]::Min($RetryDelayMilliseconds, $remainingMilliseconds)) }
        }
        return $false
    }
    Write-StartupStage 'waiting_readiness'
    if (-not (Wait-Service 'http://127.0.0.1:3001/ready' 'ready')) { throw 'API/database readiness failed. Check the local service logs.' }
    if (-not (Wait-Service 'http://127.0.0.1:3010/ready' 'ready')) { Write-Warning 'Embedding is not ready. Other project features remain available; knowledge indexing needs the local model.' }
    if (-not (Wait-Service -Uri 'http://127.0.0.1:5173' -HttpOnly -TimeoutSeconds 20)) { throw 'Frontend readiness failed after waiting up to 20 seconds. Check the local service logs.' }
    Write-StartupStage 'ready'
    Write-Output 'Ready: http://127.0.0.1:5173'
    Write-Output 'Model credentials are read only by the API. This startup check does not make a paid AI request.'
} catch {
    Write-StartupStage 'failed'
    throw
} finally { Pop-Location }
