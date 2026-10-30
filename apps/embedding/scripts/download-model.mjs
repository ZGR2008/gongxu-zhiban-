import { readFile, mkdir, writeFile, rename, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(await readFile(join(root, 'model-manifest.json'), 'utf8'));
const target = join(root, '.models', manifest.id);
// The optional mirror must be explicitly selected. No application credentials are read.
const host = process.argv.includes('--mirror') ? 'https://hf-mirror.com' : 'https://huggingface.co';
const hash = (data) => createHash('sha256').update(data).digest('hex');

try {
  await mkdir(target, { recursive: true });
  for (const file of manifest.files) {
    const destination = resolve(target, file.path);
    if (!destination.startsWith(target + (process.platform === 'win32' ? '\\' : '/'))) throw new Error('invalid_manifest_path');
    try {
      const saved = await readFile(destination);
      if (saved.length === file.size && hash(saved) === file.sha256) {
        console.log(JSON.stringify({ file: file.path, status: 'verified_existing' })); continue;
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const response = await fetch(`${host}/${manifest.repository}/resolve/${manifest.revision}/${file.path}`, { signal: AbortSignal.timeout(180_000) });
    if (!response.ok || !response.body) throw new Error('model_download_failed');
    const pieces = []; let length = 0;
    for await (const piece of response.body) {
      length += piece.length;
      if (length > file.size) throw new Error('model_size_mismatch');
      pieces.push(piece);
    }
    const bytes = Buffer.concat(pieces);
    if (length !== file.size || hash(bytes) !== file.sha256) throw new Error('model_checksum_mismatch');
    await mkdir(dirname(destination), { recursive: true });
    // Keep an interrupted download separate from verified model files.
    const temporary = `${destination}.${process.pid}.part`;
    await writeFile(temporary, bytes, { flag: 'wx' });
    await rename(temporary, destination);
    console.log(JSON.stringify({ file: file.path, status: 'downloaded_verified', bytes: (await stat(destination)).size }));
  }
  await writeFile(join(target, 'download-source.json'), JSON.stringify({ host, repository: manifest.repository, revision: manifest.revision, downloadedAt: new Date().toISOString() }, null, 2));
  console.log(JSON.stringify({ model: manifest.id, status: 'ready_on_disk' }));
} catch (error) {
  // Never dump upstream response bodies, query strings or the process environment.
  const allowed = ['invalid_manifest_path', 'model_download_failed', 'model_size_mismatch', 'model_checksum_mismatch'];
  console.error(JSON.stringify({ error: allowed.includes(error.message) ? error.message : 'model_download_or_file_error' }));
  process.exitCode = 1;
}
