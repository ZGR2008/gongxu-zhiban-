param(
  [Parameter(Mandatory=$true)][string]$Storyboard,
  [Parameter(Mandatory=$true)][string]$OutputDirectory,
  [string]$VoiceName='Microsoft Huihui Desktop',
  [ValidateRange(-2,0)][int]$Rate=-2
)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$rootPrefix = $projectRoot + [IO.Path]::DirectorySeparatorChar
$source = [IO.Path]::GetFullPath($Storyboard)
$destination = [IO.Path]::GetFullPath($OutputDirectory)
$runtimePrefix = [IO.Path]::GetFullPath((Join-Path $projectRoot '.runtime')) + [IO.Path]::DirectorySeparatorChar
if (-not $source.StartsWith($rootPrefix,[StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetExtension($source) -ne '.json') { throw 'Storyboard must be a project JSON file.' }
if (-not $destination.StartsWith($runtimePrefix,[StringComparison]::OrdinalIgnoreCase)) { throw 'Narration must stay in project .runtime.' }
if (Test-Path -LiteralPath $destination) { throw 'Use a new narration directory; existing files are protected.' }
$story = Get-Content -LiteralPath $source -Raw -Encoding UTF8 | ConvertFrom-Json
if (-not $story.scenes -or $story.scenes.Count -gt 64) { throw 'Expected between 1 and 64 narration cues.' }
$identifiers = @{}
foreach ($scene in $story.scenes) {
  if ($scene.id -notmatch '^[a-z][a-z0-9-]{0,50}$' -or $identifiers.ContainsKey($scene.id)) { throw 'Scene identifiers must be unique and safe.' }
  $identifiers[$scene.id] = $true
  if ([string]::IsNullOrWhiteSpace($scene.spoken) -or $scene.spoken.Length -gt 5000 -or $scene.durationSec -le 0) { throw 'A scene has no valid narration or duration.' }
}
Add-Type -AssemblyName System.Speech
$speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer
$hasher = [Security.Cryptography.SHA256]::Create()
function Get-WaveSeconds([string]$Path) {
  $stream = [IO.File]::OpenRead($Path)
  $reader = New-Object IO.BinaryReader($stream)
  try {
    if ([Text.Encoding]::ASCII.GetString($reader.ReadBytes(4)) -ne 'RIFF') { throw 'Invalid local audio format.' }
    [void]$reader.ReadUInt32()
    if ([Text.Encoding]::ASCII.GetString($reader.ReadBytes(4)) -ne 'WAVE') { throw 'Invalid WAVE header.' }
    $byteRate = 0; $dataBytes = 0
    while ($stream.Position + 8 -le $stream.Length) {
      $name = [Text.Encoding]::ASCII.GetString($reader.ReadBytes(4))
      $size = $reader.ReadUInt32(); $next = $stream.Position + $size + ($size % 2)
      if ($name -eq 'fmt ') { [void]$reader.ReadUInt16(); [void]$reader.ReadUInt16(); [void]$reader.ReadUInt32(); $byteRate=$reader.ReadUInt32() }
      if ($name -eq 'data') { $dataBytes = $size }
      $stream.Position = $next
    }
    if ($byteRate -le 0 -or $dataBytes -le 0) { throw 'Local audio is empty.' }
    return [Math]::Round($dataBytes / $byteRate, 3)
  } finally { $reader.Dispose(); $stream.Dispose() }
}
try {
  $voice = $speaker.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -eq 'zh-CN' -and $_.VoiceInfo.Name -eq $VoiceName } | Select-Object -First 1
  if (-not $voice) { throw 'The requested installed Mandarin voice is unavailable. No cloud fallback is used.' }
  $speaker.SelectVoice($voice.VoiceInfo.Name); $speaker.Rate = $Rate
  $audioFormat = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(22050, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
  New-Item -ItemType Directory -Path $destination | Out-Null
  $entries = @()
  foreach ($scene in $story.scenes) {
    $path = Join-Path $destination ($scene.id + '.wav')
    $speaker.SetOutputToWaveFile($path,$audioFormat)
    $speaker.Speak([string]$scene.spoken)
    $speaker.SetOutputToNull()
    $textHash = [BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes([string]$scene.spoken))).Replace('-','').ToLowerInvariant()
    $entries += [pscustomobject]@{
      id=$scene.id; title=$scene.title; durationSec=[double]$scene.durationSec; spoken=$scene.spoken
      audio=$path; audioSeconds=(Get-WaveSeconds $path); textSha256=$textHash
      audioSha256=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
    }
    Write-Output ('Narrated local scene: ' + $scene.id)
  }
  [pscustomobject]@{
    schema='recording-local-narration-v1'; scope='installed_local_mandarin_voice_no_cloud'
    voice=$voice.VoiceInfo.Name; rate=$Rate; impersonation=$false; paidModelCalls=0
    createdAt=[DateTimeOffset]::Now.ToString('o'); scenes=$entries
  } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $destination 'manifest.json') -Encoding UTF8
} finally { $speaker.Dispose(); $hasher.Dispose() }
