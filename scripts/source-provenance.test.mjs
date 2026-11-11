import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {sourceProvenance} from '../evaluation/source-provenance.mjs';
import {prepareHistoricalSource} from '../evaluation/historical-source.mjs';

async function fixture(t){
 const parent=await realpath(tmpdir());
 const root=await mkdtemp(path.join(parent,'gongxu-provenance-'));
 t.after(async()=>{
  const resolved=await realpath(root);
  assert.equal(path.dirname(resolved),parent);
  assert.ok(path.basename(resolved).startsWith('gongxu-provenance-'));
  await rm(resolved,{recursive:true,force:true});
 });
 return root;
}
const git=(cwd,args,input)=>execFileSync('git',args,{cwd,input,encoding:'utf8',stdio:['pipe','pipe','pipe'],timeout:5000}).trim();
async function repository(root){
 git(root,['init','--quiet']);
 await writeFile(path.join(root,'sample.txt'),'REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3b source\n');
 git(root,['add','sample.txt']);
 const tree=git(root,['write-tree']);
 // Plumbing creates a disposable REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3b commit without hooks, user identity
 // configuration or signing-agent access. No existing repository is modified.
 const commit=git(root,['-c','user.name=Synthetic review','-c','user.email=review@example.test','commit-tree','--no-gpg-sign',tree], 'Synthetic provenance fixture\n');
 git(root,['update-ref','HEAD',commit]);
 return commit;
}
test('a standalone source directory has unknown Git identity instead of failing preparation',async t=>{
 const root=await fixture(t);
 assert.deepEqual(sourceProvenance(root),{commit:null,workingTreeClean:null,gitStatus:'unavailable'});
});
test('a source package inside another Git repository never inherits its commit',async t=>{
 const root=await fixture(t);await repository(root);
 const unpacked=path.join(root,'unpacked');await mkdir(unpacked);
 assert.deepEqual(sourceProvenance(unpacked),{commit:null,workingTreeClean:null,gitStatus:'parent_repository_ignored'});
});
test('an own repository records its actual commit and detects working tree changes',async t=>{
 const root=await fixture(t),commit=await repository(root);
 assert.deepEqual(sourceProvenance(root),{commit,workingTreeClean:true,gitStatus:'verified_project_repository'});
 await writeFile(path.join(root,'sample.txt'),'REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3b changed source\n');
 assert.deepEqual(sourceProvenance(root),{commit,workingTreeClean:false,gitStatus:'verified_project_repository'});
});
test('a new repository without a commit is not labeled as a verified version',async t=>{
 const root=await fixture(t);git(root,['init','--quiet']);
 assert.deepEqual(sourceProvenance(root),{commit:null,workingTreeClean:null,gitStatus:'head_unavailable'});
});
test('historical preparation refuses source ZIPs before attempting dependency or source extraction',async t=>{
 const root=await fixture(t);
 await assert.rejects(prepareHistoricalSource(root,path.join(root,'capture')),/Historical Git commit is unavailable for this project/);
 await repository(root);const unpacked=path.join(root,'unpacked');await mkdir(unpacked);
 await assert.rejects(prepareHistoricalSource(unpacked,path.join(unpacked,'capture')),/Historical Git commit is unavailable for this project/);
});
