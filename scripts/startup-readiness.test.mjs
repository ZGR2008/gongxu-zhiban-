// Extract only the readiness function; never run startup, migrations, or service management.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(new URL('./start-local.ps1', import.meta.url));
const controlledWindows = { skip: process.platform !== 'win32' ? 'Windows PowerShell launcher regression; not run on this OS' : false, timeout: 14000 };
const listen = server => new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve(server.address().port)); });
const close = server => new Promise(resolve => { server.closeAllConnections(); if (!server.listening) return resolve(); server.close(resolve); });
async function availablePort() { const server = createServer(); const port = await listen(server); await close(server); return port; }

async function probe(port, { httpOnly = true, timeoutSeconds = 2, onStarted } = {}) {
  const harness = `$ErrorActionPreference='Stop'
$tokens=$null; $errors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile($env:GONGXU_READINESS_SCRIPT,[ref]$tokens,[ref]$errors)
if ($errors.Count -gt 0) { throw 'Startup script parse failed' }
$definition=$ast.FindAll({param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Wait-Service'},$true) | Select-Object -First 1
if (-not $definition) { throw 'Readiness function missing' }
Invoke-Expression $definition.Extent.Text
Write-Output 'GONGXU_READINESS_STARTED'
$watch=[System.Diagnostics.Stopwatch]::StartNew()
$ready=Wait-Service -Uri $env:GONGXU_READINESS_URI -Expected 'ready' ${httpOnly ? '-HttpOnly' : ''} -TimeoutSeconds ${timeoutSeconds} -RetryDelayMilliseconds 80
[ordered]@{ready=[bool]$ready;elapsedMs=$watch.ElapsedMilliseconds} | ConvertTo-Json -Compress
`;
  return await new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(harness, 'utf16le').toString('base64')], { windowsHide: true, env: { ...process.env, GONGXU_READINESS_SCRIPT: scriptPath, GONGXU_READINESS_URI: `http://127.0.0.1:${port}/ready` } });
    let stdout = '', stderr = '', notified = false;
    const deadline = setTimeout(() => { child.kill(); reject(new Error('Controlled readiness probe exceeded 12 seconds')); }, 12000);
    child.stdout.on('data', chunk => { stdout += chunk; if (!notified && stdout.includes('GONGXU_READINESS_STARTED')) { notified = true; onStarted?.(); } });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', error => { clearTimeout(deadline); reject(error); });
    child.once('exit', code => { clearTimeout(deadline); if (code !== 0) return reject(new Error(`Readiness probe exited ${code}: ${stderr}`)); try { resolve(JSON.parse(stdout.trim().split(/\r?\n/).at(-1))); } catch (error) { reject(error); } });
  });
}

test('web startup uses the bounded readiness helper instead of a one-shot request', async () => {
  const source = await readFile(scriptPath, 'utf8');
  assert.match(source, /Wait-Service\s+-Uri\s+'http:\/\/127\.0\.0\.1:5173'\s+-HttpOnly/);
  assert.doesNotMatch(source, /\$web\s*=\s*Invoke-WebRequest/);
});

test('HTTP readiness waits for a delayed listener without launching services', controlledWindows, async () => {
  const server = createServer((_, response) => { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end('<!doctype html><title>controlled ready</title>'); });
  const port = await availablePort(); let timer;
  try {
    const result = await probe(port, { timeoutSeconds: 3, onStarted: () => { timer = setTimeout(() => server.listen(port, '127.0.0.1'), 700); } });
    assert.equal(result.ready, true);
    assert.ok(result.elapsedMs >= 600);
    assert.ok(result.elapsedMs < 4000);
  } finally { clearTimeout(timer); await close(server); }
});

test('HTTP readiness retries a temporary non-200 response then succeeds', controlledWindows, async () => {
  let requests = 0;
  const server = createServer((_, response) => { response.writeHead(++requests < 3 ? 503 : 200); response.end('controlled'); });
  const port = await listen(server);
  try { assert.equal((await probe(port)).ready, true); assert.ok(requests >= 3); }
  finally { await close(server); }
});

test('JSON readiness waits for the expected application status', controlledWindows, async () => {
  let requests = 0;
  const server = createServer((_, response) => { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ status: ++requests < 3 ? 'starting' : 'ready' })); });
  const port = await listen(server);
  try { assert.equal((await probe(port, { httpOnly: false })).ready, true); assert.ok(requests >= 3); }
  finally { await close(server); }
});

for (const [name, handler, httpOnly] of [
  ['persistent non-200 HTTP', (_, response) => { response.writeHead(503); response.end('not ready'); }, true],
  ['persistent wrong JSON status', (_, response) => { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end('{"status":"starting"}'); }, false],
  ['a connection that never responds', () => {}, true],
]) {
  test(`${name} fails within the configured readiness deadline`, controlledWindows, async () => {
    const server = createServer(handler); const port = await listen(server);
    try { const result = await probe(port, { httpOnly }); assert.equal(result.ready, false); assert.ok(result.elapsedMs >= 1500); assert.ok(result.elapsedMs < 3500, `elapsed ${result.elapsedMs}ms exceeds deadline tolerance`); }
    finally { await close(server); }
  });
}

test('an unavailable listener fails within the configured readiness deadline', controlledWindows, async () => {
  const result = await probe(await availablePort());
  assert.equal(result.ready, false);
  assert.ok(result.elapsedMs >= 1500);
  assert.ok(result.elapsedMs < 3500, `elapsed ${result.elapsedMs}ms exceeds deadline tolerance`);
});
