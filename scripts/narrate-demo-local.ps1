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
    Write-Output ('Narrated: ' + $scene.id)
  }
} finally { $speaker.Dispose() }
