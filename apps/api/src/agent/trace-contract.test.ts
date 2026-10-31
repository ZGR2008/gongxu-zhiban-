import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePlan } from './validate.js';
import { parseGeneratedCases } from '../practice/validation.js';

test('plan retains explicit requirement item associations for human review', () => {
  const task={key:'t1',stage:'开发',title:'审批',description:'实现审批',deliverable:'审计记录',dependsOn:[],citations:[],requirementIds:['REQ-0123456789abcdef']};
  const result=validatePlan(JSON.stringify({tasks:[task]}),[]);
  assert.ok(result.plan, 'valid item references must not be discarded by the plan schema');
  assert.deepEqual((result.plan.tasks[0] as unknown as {requirementIds:string[]}).requirementIds,task.requirementIds);
});
test('test design retains requirement item suggestions separately from execution', () => {
  const cases=['normal','boundary','exception'].map(category=>({category,title:'审批',preconditions:'',steps:'审批',expected:'记录操作',requirementIds:['REQ-0123456789abcdef']}));
  const parsed=parseGeneratedCases(JSON.stringify({cases}));
  assert.ok(parsed);
  assert.deepEqual((parsed[0] as unknown as {requirementIds:string[]}).requirementIds,cases[0].requirementIds);
});
