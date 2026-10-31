import {test} from 'node:test';
import assert from 'node:assert/strict';
import {requirementItems,assessPlan,itemEvidence} from './domain.js';

test('stable source keys preserve unchanged items across versions without treating changed wording as equal',()=>{
  const old=requirementItems('p','v1','审批必须留档\n交付必须确认'),next=requirementItems('p','v2','新增要求\n审批必须留档\n交付必须双人确认');
  assert.equal(old[0].key,next[1].key);assert.notEqual(old[0].id,next[1].id);assert.notEqual(old[1].key,next[2].key);
  assert.notEqual(old[0].key,requirementItems('other','v1','审批必须留档')[0].key);
});
test('source extraction is bounded and retains final acceptance condition and original offsets',()=>{
  const source=Array.from({length:600},(_,i)=>`第${i}项`).join('\n')+'\n末尾验收：必须拒绝越权';const items=requirementItems('p','v',source);
  assert.ok(items.length<=200);assert.ok(items.at(-1)?.text.endsWith('必须拒绝越权'));
  for(const item of items)assert.equal(source.slice(item.start,item.end),item.text);
  assert.equal(items.map(i=>i.text).join('\n').replace(/\s/g,''),source.replace(/\s/g,''));
});
test('a one-task zero-citation plan stays valid but receives missing coverage and evidence warnings',()=>{
  const items=requirementItems('p','v','必须留存审批\n失败必须回滚');
  const review=assessPlan({tasks:[{key:'t',stage:'开发',title:'审批',description:'审批',deliverable:'代码',dependsOn:[],citations:[],requirementIds:[items[0].key]}]},items);
  assert.ok(review.warnings.some(w=>w.code==='unmapped_requirements'&&w.itemKeys.includes(items[1].key)));
  assert.ok(review.warnings.some(w=>w.code==='no_source'));assert.ok(review.warnings.some(w=>w.code==='acceptance_needs_detail'));
});
test('model suggestion, missing execution note or revised test never becomes confirmed manual evidence',()=>{
  const c={id:'c',revision:2,result:'passed',executedAt:'2026-10-31',executionNote:'人工记录'};
  const link={itemId:'i',caseId:'c',taskId:null,caseRevision:2,status:'suggested'};
  assert.equal(itemEvidence('i',[link],[c]).manualEvidence,0);
  assert.equal(itemEvidence('i',[{...link,status:'confirmed'}],[c]).manualEvidence,1);
  assert.equal(itemEvidence('i',[{...link,status:'confirmed',caseRevision:1}],[c]).stale,1);
  assert.equal(itemEvidence('i',[{...link,status:'confirmed'}],[{...c,executionNote:''}]).manualEvidence,0);
  assert.equal(itemEvidence('different-version-item',[{...link,status:'confirmed'}],[c]).manualEvidence,0);
});
