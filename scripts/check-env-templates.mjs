import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

// Scan only templates; never read real .env files or print offending values.
const excluded=new Set(['node_modules','.git','.venv','dist','build','.runtime','.setup','.cache','coverage']);
async function templates(directory='.'){
  const found=[];
  for(const entry of await readdir(directory,{withFileTypes:true})){
    if(entry.isSymbolicLink()||excluded.has(entry.name))continue;
    const path=join(directory,entry.name);
    if(entry.isDirectory())found.push(...await templates(path));
    else if(entry.isFile()&&entry.name.endsWith('.env.example'))found.push(path);
  }
  return found;
}
// Source review ZIPs intentionally have no .git directory.
const files=await templates();
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
