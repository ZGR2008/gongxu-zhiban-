import test from 'node:test';
import assert from 'node:assert/strict';
import {options,plan} from './verification-plan.mjs';
test('default verification is offline and includes every discovered root regression and Python',()=>{
 assert.equal(options([]).suite,'offline');const all=plan('offline',['new-regression.test.mjs','verify.test.mjs']);
 assert.deepEqual(all.find(x=>x.id==='root-script-unit').args,['--test','scripts/new-regression.test.mjs','scripts/verify.test.mjs']);
 assert.ok(all.some(x=>x.engine==='python'));assert.ok(all.some(x=>x.id==='web-build'));assert.ok(all.some(x=>x.id==='evaluation-preparation'));
 assert.ok(all.every(x=>!JSON.stringify(x).match(/dotenv|live-smoke|local\.mjs|ai:check|model-run|reliability-browser/)));
});
test('local/browser suites require explicit choice; model flags cannot expand authority',()=>{
 for(const arg of ['--suite=model','--live','--with-ai','--suite=unknown'])assert.throws(()=>options([arg]));
 assert.throws(()=>options(['--suite=offline','--suite=database']));
 assert.equal(options(['--suite=database','--list']).list,true);
 const db=plan('database',[]);assert.ok(db.some(x=>x.id==='execution-concurrency'));assert.ok(db.every(x=>!x.args.includes('--with-ai')));
});
test('build-dependent tests declare prerequisites rather than using stale output after build failure',()=>{
 const steps=plan('offline',[]),ids=new Set(steps.map(x=>x.id));
 assert.equal(ids.size,steps.length);for(const x of steps)for(const need of x.needs)assert.ok(ids.has(need));
 assert.deepEqual(steps.find(x=>x.id==='api-unit').needs,['api-test-build']);
 assert.deepEqual(steps.find(x=>x.id==='offline-evaluation').needs,['api-build']);
});
