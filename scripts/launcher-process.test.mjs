// Controlled Windows processes only: no application startup, database, or credentials.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const sourcePath = fileURLToPath(new URL('./launch-local.ps1', import.meta.url));
const windows = { skip: process.platform !== 'win32', timeout: 25000 };
async function harness(childSource, commands) {
  const root = await mkdtemp(join(tmpdir(), 'gongxu-launcher-test-'));
  const childFile = join(root, 'REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3b startup.ps1');
  await writeFile(childFile, childSource);
  await writeFile(join(root, 'inherited-output.cjs'), `
const p=require('node:child_process').spawn(process.execPath,['-e','setTimeout(()=>{},30000)'],{windowsHide:true,detached:true,stdio:'inherit'});
require('node:fs').writeFileSync(require('node:path').join(process.env.GONGXU_TEST_ROOT,'REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3b-descendant.json'),JSON.stringify({processId:p.pid,startedAt:new Date().toISOString()}));
p.unref();
`);
  const script = String.raw`$ErrorActionPreference='Stop'
$tokens=$null; $errors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile($env:GONGXU_TEST_SOURCE,[ref]$tokens,[ref]$errors)
if ($errors.Count -gt 0) { throw 'Launcher parse failed' }
$definition=$ast.FindAll({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Invoke-LocalStartup'},$true) | Select-Object -First 1
if (-not $definition) { throw 'Bounded startup worker missing' }
Invoke-Expression $definition.Extent.Text
$projectRoot=$env:GONGXU_TEST_ROOT; $runtimeRoot=$projectRoot
$startupFile=Join-Path $projectRoot 'REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3b startup.ps1'
$powershellExe=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
function Write-LaunchEvent([string]$EventName) { Add-Content -LiteralPath (Join-Path $runtimeRoot 'events.log') -Value $EventName }
try {
${commands}
} finally {
  # Only terminate REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3b processes whose PID/start time was recorded in this fresh directory.
  foreach($name in @('startup-process.json','REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3b-descendant.json')) {
    $path=Join-Path $runtimeRoot $name
    if(Test-Path -LiteralPath $path) {
      $saved=Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
      $p=Get-Process -Id $saved.processId -ErrorAction SilentlyContinue
      if($p -and [math]::Abs(($p.StartTime-[datetime]$saved.startedAt).TotalSeconds) -lt 1) { Stop-Process -Id $p.Id -ErrorAction SilentlyContinue }
    }
  }
}
`;
  const result = await new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
      windowsHide: true,
      env: { ...process.env, GONGXU_TEST_SOURCE: sourcePath, GONGXU_TEST_ROOT: root, GONGXU_TEST_NODE: process.execPath },
    });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('Synthetic launcher exceeded 20 seconds')); }, 20000);
    child.stdout.on('data', data => { stdout += data; });
    child.stderr.on('data', data => { stderr += data; });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
  assert.equal(result.code, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /GONGXU_SYNTHETIC_PRIVATE_VALUE/);
  return { root, result: JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1)) };
}

test('launcher follows worker exit, not the lifetime or output of a background descendant', windows, async () => {
  const child = `& $env:GONGXU_TEST_NODE (Join-Path $PSScriptRoot 'inherited-output.cjs')
Write-Output 'GONGXU_SYNTHETIC_PRIVATE_VALUE'
exit 0`;
  const { result } = await harness(child, `$watch=[Diagnostics.Stopwatch]::StartNew()
Invoke-LocalStartup -TimeoutMilliseconds 8000
$saved=Get-Content (Join-Path $runtimeRoot 'REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3b-descendant.json') -Raw | ConvertFrom-Json
@{elapsedMs=$watch.ElapsedMilliseconds;descendantAlive=[bool](Get-Process -Id $saved.processId -ErrorAction SilentlyContinue)} | ConvertTo-Json -Compress`);
  assert.equal(result.descendantAlive, true);
  assert.ok(result.elapsedMs < 6500, 'Must not wait for the 30-second background service');
});

test('bounded wait preserves active work and a repeated click reuses the same worker', windows, async () => {
  const { root, result } = await harness(`Add-Content -LiteralPath (Join-Path $PSScriptRoot 'invocations.txt') -Value 'started'
Start-Sleep -Seconds 4
exit 0`, `$firstError=''; $secondError=''
try { Invoke-LocalStartup -TimeoutMilliseconds 1400 } catch { $firstError=$_.Exception.Message }
$first=Get-Content (Join-Path $runtimeRoot 'startup-process.json') -Raw | ConvertFrom-Json
$alive=[bool](Get-Process -Id $first.processId -ErrorAction SilentlyContinue)
try { Invoke-LocalStartup -TimeoutMilliseconds 800 } catch { $secondError=$_.Exception.Message }
$second=Get-Content (Join-Path $runtimeRoot 'startup-process.json') -Raw | ConvertFrom-Json
Invoke-LocalStartup -TimeoutMilliseconds 8000
@{firstError=$firstError;secondError=$secondError;alive=$alive;sameWorker=($first.processId -eq $second.processId)} | ConvertTo-Json -Compress`);
  assert.equal(result.firstError, 'startup_worker_still_running');
  assert.equal(result.secondError, 'startup_worker_still_running');
  assert.equal(result.alive, true);
  assert.equal(result.sameWorker, true);
  assert.deepEqual((await readFile(join(root, 'invocations.txt'), 'utf8')).trim().split(/\r?\n/), ['started']);
});

test('worker failure is reported without printing child output as success', windows, async () => {
  const { result } = await harness("Write-Output 'GONGXU_SYNTHETIC_PRIVATE_VALUE'\nexit 7", `$failure=''
try { Invoke-LocalStartup -TimeoutMilliseconds 8000 } catch { $failure=$_.Exception.Message }
@{failure=$failure} | ConvertTo-Json -Compress`);
  assert.equal(result.failure, 'service_start_failed');
});

test('legacy pipeline capture is removed and notification cannot keep the launch lock', async () => {
  const source = await readFile(sourcePath, 'utf8');
  assert.doesNotMatch(source, /&\s*\$powershellExe[^\r\n]+\*>\s*\$null/);
  assert.ok(source.indexOf('$mutex.ReleaseMutex()') < source.indexOf('[System.Windows.Forms.MessageBox]::Show'), 'Release the launch lock before a user notification waits for input');
  assert.match(source, /-NonInteractive/);
});
