param([switch]$Remove)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$launcher = Join-Path $PSScriptRoot 'launch-local.ps1'
$powershellExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$startupFolder = [Environment]::GetFolderPath('Startup')
$desktopFolder = [Environment]::GetFolderPath('Desktop')
if (-not (Test-Path -LiteralPath $launcher)) { throw 'The local launcher was not found.' }
if (-not $startupFolder -or -not $desktopFolder) { throw 'Current-user Windows folders are unavailable.' }
$shell = New-Object -ComObject WScript.Shell
try {
    $entries = @(
        @{ Folder=$startupFolder; Name='工序智伴-自动启动.lnk'; Flags='-Quiet'; Description='登录 Windows 后启动工序智伴本地服务，不自动打开浏览器。' },
        @{ Folder=$desktopFolder; Name='打开工序智伴.lnk'; Flags='-OpenBrowser'; Description='启动或检查工序智伴，然后打开项目工作台。' }
    )
    foreach ($entry in $entries) {
        $targetPath = Join-Path $entry.Folder $entry.Name
        $expectedArguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcher`" $($entry.Flags)"
        $shortcut = $shell.CreateShortcut($targetPath)
        try {
            if ((Test-Path -LiteralPath $targetPath) -and ($shortcut.TargetPath -ine $powershellExe -or $shortcut.Arguments -cne $expectedArguments)) {
                throw 'An unrelated shortcut has this name; it was preserved.'
            }
            if ($Remove) {
                # Only the exact two shortcuts owned by this checkout may be removed.
                if (Test-Path -LiteralPath $targetPath) { Remove-Item -LiteralPath $targetPath }
                Write-Output "Removed owned shortcut: $($entry.Name)"
                continue
            }
            if (-not (Test-Path -LiteralPath $entry.Folder)) { New-Item -ItemType Directory -Path $entry.Folder -Force | Out-Null }
            $shortcut.TargetPath = $powershellExe
            $shortcut.Arguments = $expectedArguments
            $shortcut.WorkingDirectory = $projectRoot
            $shortcut.Description = $entry.Description
            $shortcut.WindowStyle = 7
            $shortcut.IconLocation = "$env:SystemRoot\System32\shell32.dll,13"
            $shortcut.Save()
            Write-Output "Installed current-user shortcut: $($entry.Name)"
        } finally { [Runtime.InteropServices.Marshal]::FinalReleaseComObject($shortcut) | Out-Null }
    }
} finally { [Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell) | Out-Null }
Write-Output 'No system service, administrator startup task, credentials, or remote connection was added.'
