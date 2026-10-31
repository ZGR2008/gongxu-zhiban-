import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const check=fileURLToPath(new URL('./check-env-templates.mjs',import.meta.url));
test('template check works in an extracted ZIP without Git and never reports credential values',async()=>{
  const root=await mkdtemp(join(tmpdir(),'gongxu-review-template-'));const resolved=await realpath(root);
  try{
    await mkdir(join(root,'apps','api'),{recursive:true});await mkdir(join(root,'node_modules'),{recursive:true});
    await writeFile(join(root,'apps','api','.env.example'),'AI_API_KEY=\n');
    await writeFile(join(root,'apps','api','.env'),'AI_API_KEY=synthetic-not-to-read\n');
    await writeFile(join(root,'node_modules','.env.example'),'AI_API_KEY=dependency-fixture\n');
    let result=spawnSync(process.execPath,[check],{cwd:root,encoding:'utf8'});assert.equal(result.status,0);assert.match(result.stdout,/checked: 1/);assert.ok(!result.stdout.includes('synthetic-not-to-read'));
    await writeFile(join(root,'apps','api','.env.example'),'AI_API_KEY=synthetic-violation\n');
    result=spawnSync(process.execPath,[check],{cwd:root,encoding:'utf8'});assert.equal(result.status,1);assert.ok(!result.stderr.includes('synthetic-violation'));assert.match(result.stderr,/credential fields must be empty/);
  }finally{
    // Remove only the fresh, resolved test directory underneath the OS temp directory.
    const base=await realpath(tmpdir());if(resolved.startsWith(base+sep)&&resolve(root)===resolved)await rm(resolved,{recursive:true,force:true});
  }
});
