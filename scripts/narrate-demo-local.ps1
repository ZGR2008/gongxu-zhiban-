param([Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$resolvedOutput = [System.IO.Path]::GetFullPath($OutputDirectory)
$allowedRoot = [System.IO.Path]::GetFullPath((Join-Path $projectRoot '.runtime')) + [System.IO.Path]::DirectorySeparatorChar
if (-not $resolvedOutput.StartsWith($allowedRoot,[System.StringComparison]::OrdinalIgnoreCase)) { throw 'Narration output must be inside project .runtime.' }
New-Item -ItemType Directory -Path $resolvedOutput -Force | Out-Null
$story = Get-Content -LiteralPath (Join-Path $projectRoot 'docs/demo-v3/storyboard.json') -Raw -Encoding UTF8 | ConvertFrom-Json
Add-Type -AssemblyName System.Speech
$speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer
$entries = @()
$hasher = [System.Security.Cryptography.SHA256]::Create()
try {
  $voice = $speaker.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -eq 'zh-CN' } | Select-Object -First 1
  if (-not $voice) { throw 'No installed local Chinese voice. No cloud fallback is allowed.' }
  $speaker.SelectVoice($voice.VoiceInfo.Name)
  $speaker.Rate = 0
  foreach ($scene in $story.scenes) {
    if ($scene.id -notmatch '^[a-z]+$') { throw 'Invalid scene id.' }
    $path = Join-Path $resolvedOutput ($scene.id + '.wav')
    if (Test-Path -LiteralPath $path) { throw 'Existing narration will not be overwritten.' }
    $speaker.SetOutputToWaveFile($path)
    $speaker.Speak([string]$scene.narration)
    $speaker.SetOutputToNull()
    $textHash = [BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes([string]$scene.narration))).Replace('-','').ToLowerInvariant()
    $entries += [pscustomobject]@{ id=$scene.id; textSha256=$textHash; audioSha256=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() }
    Write-Output ('Narrated: ' + $scene.id)
  }
  [pscustomobject]@{ scope='local_synthetic_voice_no_cloud'; scenes=$entries } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $resolvedOutput 'manifest.json') -Encoding UTF8
} finally { $speaker.Dispose(); $hasher.Dispose() }
