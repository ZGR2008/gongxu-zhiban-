import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultScheme, inspectScheme, conditionKey, parseSegmentOutput, buildMerge, inspectMerge, type Scheme} from './domain.js';
const project='11111111-1111-4111-8111-111111111111';
const accept=(source:string):Scheme=>{const s=defaultScheme(project,source);s.conditions=s.conditions.map(c=>({...c,kind:'acceptance',crossNote:'必须结合所有涉及片段核对完整原文',statement:'本条完整原文中的行为及边界必须满足'}));return s;};
test('lossless scheme preserves Chinese, emoji, tail and cross-segment single conditions',()=>{
 const source='权限😀与库存'.repeat(3500)+'末尾不得自行审批。';const scheme=accept(source);
 const audit=inspectScheme(project,source,scheme);assert.deepEqual(audit.errors,[]);
 assert.equal(audit.segments.map(s=>s.content).join(''),source);
 assert.ok(audit.segments.at(-1)!.content.endsWith('不得自行审批。'));
 for(const s of audit.segments)assert.equal(source.slice(s.start,s.end),s.content);
 const noNote=structuredClone(scheme);noNote.conditions[0].crossNote='';assert.ok(inspectScheme(project,source,noNote).errors.some(e=>e.code==='cross_boundary_note_required'));
});
test('missing/duplicate ranges, split surrogate and unclassified conditions block review',()=>{
 const source='必须😀回滚。\n必须保留原因。';const scheme=accept(source);
 for(const cuts of [[3,source.length],[source.length-1],[5,5,source.length],[source.length,source.length+1]])assert.ok(inspectScheme(project,source,{...scheme,boundaries:cuts}).errors.length);
 assert.ok(inspectScheme(project,source,defaultScheme(project,source)).errors.some(e=>e.code==='unclassified_condition'));
 const missing={...scheme,conditions:scheme.conditions.slice(0,1)};assert.ok(inspectScheme(project,source,missing).errors.some(e=>e.code==='unclassified_source_range'));
 const duplicate={...scheme,conditions:[...scheme.conditions,{...scheme.conditions[0]}]};assert.ok(inspectScheme(project,source,duplicate).errors.some(e=>e.code==='duplicate_condition_key'));
});
test('stable source keys survive boundary edits; dependencies and duplicate text need explanation',()=>{
 const source='必须审批。\n必须审批。\n失败不得扣库存。';const scheme=accept(source),keys=scheme.conditions.map(c=>c.key);
 assert.ok(inspectScheme(project,source,scheme).errors.some(e=>e.code==='repeated_condition_note_required'));
 scheme.conditions.forEach(c=>c.overlapNote='原文重复用于两个使用场景，合并时核对');scheme.boundaries=[6,source.length];
 assert.deepEqual(scheme.conditions.map(c=>c.key),keys);assert.deepEqual(inspectScheme(project,source,scheme).errors,[]);
 scheme.conditions[0].dependsOn=[scheme.conditions[2].key];scheme.conditions[2].dependsOn=[scheme.conditions[0].key];
 assert.ok(inspectScheme(project,source,scheme).errors.some(e=>e.code==='condition_dependency_cycle'));
 assert.equal(conditionKey(project,source,0,5),keys[0]);
});
test('ID-only output, lost fragment, unknown citation and unknown task references are rejected',()=>{
 const source='审批失败必须回滚。',scheme=accept(source),segment=inspectScheme(project,source,scheme).segments[0];
 assert.throws(()=>parseSegmentOutput('{"coveredItemKeys":[]}',segment,scheme,[]));
 const output={tasks:[{key:'t1',stage:'开发',title:'审批失败回滚',description:'失败后恢复事务并保留可追溯原因',deliverable:'模拟事务失败，库存不改变且原因存在',dependsOn:[],conditionIds:[scheme.conditions[0].key],citations:[]}],fragments:[{conditionId:scheme.conditions[0].key,taskKeys:['t1'],note:'本段原文失败时的回滚要求由任务覆盖'}],unresolved:[]};
 assert.equal(parseSegmentOutput(JSON.stringify(output),segment,scheme,[]).tasks.length,1);
 for(const bad of [{...output,fragments:[]},{...output,tasks:[{...output.tasks[0],citations:['00000000-0000-4000-8000-000000000001']}]},{...output,fragments:[{...output.fragments[0],taskKeys:['unknown']}]}])assert.throws(()=>parseSegmentOutput(JSON.stringify(bad),segment,scheme,[]));
});
test('global merge retains coverage, cross dependencies and warnings; never claims semantic verification',()=>{
 const source='学生不得审批自己的申请。\n管理员可以审批库存充足的申请。';const scheme=accept(source);scheme.boundaries=[17,source.length];
 scheme.conditions[1].dependsOn=[scheme.conditions[0].key];
 const segments=inspectScheme(project,source,scheme).segments;
 const rows=segments.map((s,i)=>({segmentKey:s.key,output:{tasks:[{key:'t1',stage:'开发',title:'实现审批',description:'按当前片段原文实现权限与库存规则',deliverable:'对照条件逐项执行正向与失败用例',dependsOn:[],conditionIds:s.conditionIds,citations:[]}],fragments:s.conditionIds.map(k=>({conditionId:k,taskKeys:['t1'],note:'当前片段原文已转换为候选实现与验收方法'})),unresolved:[]}}));
 const draft=buildMerge(rows);const audit=inspectMerge(scheme,draft,[]);
 assert.ok(audit.warnings.some(w=>w.code==='duplicate_task_title'));
 assert.ok(audit.warnings.some(w=>w.code==='cross_dependency_review'));
 assert.equal(audit.semanticCompleteness,'unverified');assert.equal(audit.readyForAutomaticAdoption,false);
 const missing={...draft,tasks:[]};assert.ok(inspectMerge(scheme,missing,[]).errors.length);
});
test('whitespace-only range can be retained without a fabricated task; duplicate dependency fails before adoption',()=>{
 const source='必须审查。\n   ',scheme=accept(source);scheme.boundaries=[6,source.length];const empty=inspectScheme(project,source,scheme).segments[1];
 assert.equal(parseSegmentOutput('{"tasks":[],"fragments":[],"unresolved":[]}',empty,scheme,[]).tasks.length,0);
 const k=scheme.conditions[0].key,task={key:'a',title:'实现审查',stage:'开发',description:'具体实现审查权限与记录',deliverable:'对照角色执行允许和拒绝输入',conditionIds:[k],citations:[],dependsOn:[]};
 const draft={tasks:[task,{...task,key:'b',dependsOn:['a','a']}]};assert.ok(inspectMerge(scheme,draft,[]).errors.some(e=>e.code==='merge_reference_invalid'));
});
