import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

// Scan only templates; never read real .env files or print offending values.
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' }).split('\0').filter(name => name.endsWith('.env.example'));
let errors = 0;
for (const file of new Set(files)) {
  const lines = (await readFile(file, 'utf8')).split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const match = lines[index].match(/^\s*(?:export\s+)?([A-Z_]*(?:API_KEY|TOKEN|SECRET))\s*=\s*(.*)$/);
    if (!match) continue;
    const value = match[2].trim();
    if (value && value !== '""' && value !== "''" && !value.startsWith('#')) {
      console.error(`${file}:${index + 1}: credential fields must be empty in tracked templates`);
      errors++;
    }
  }
}
if (errors) process.exitCode = 1;
else console.log(`Environment templates checked: ${new Set(files).size}; credential fields are empty.`);
