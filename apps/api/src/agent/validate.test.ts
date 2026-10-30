import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePlan } from './validate.js';

const source='11111111-1111-4111-8111-111111111111';
const task=(key:string, dependsOn:string[]=[], citations:string[]=[]) => ({key,stage:'开发',title:key,description:'完成任务',deliverable:'代码',dependsOn,citations});
test('accepts a grounded, acyclic plan', () => {
  const result=validatePlan(JSON.stringify({tasks:[task('a',[],[source]),task('b',['a'])]}),[source]);
  assert.equal(result.errors.length,0); assert.equal(result.plan?.tasks.length,2);
});
test('rejects invalid JSON, malformed schema, duplicate IDs and unknown citations', () => {
  assert.ok(validatePlan('no',[]).errors.length);
  assert.ok(validatePlan(JSON.stringify({tasks:[{}]}),[]).errors.length);
  assert.ok(validatePlan(JSON.stringify({tasks:[task('a'),task('a')]}),[]).errors.length);
  assert.ok(validatePlan(JSON.stringify({tasks:[task('a',[],[source])]}),[]).errors.length);
});
test('rejects missing, self, repeated and cyclic dependencies', () => {
  for (const tasks of [[task('a',['missing'])],[task('a',['a'])],[task('a'),task('b',['a','a'])],[task('a',['b']),task('b',['a'])]]) {
    assert.ok(validatePlan(JSON.stringify({tasks}),[]).errors.length);
  }
});
