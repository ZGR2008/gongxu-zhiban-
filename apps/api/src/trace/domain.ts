import { createHash } from 'node:crypto';
import type { Plan } from '../agent/validate.js';

export type RequirementItem = {id:string; key:string; position:number; start:number; end:number; text:string; acceptanceCandidate:boolean};
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
function uuid(text:string){const h=hash(text);return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;}

/** Deterministic source-line extraction, not semantic understanding. Keeps UTF-16 offsets.
 * Unchanged text keeps its logical key across versions; changed wording requires human review.
 * Pathological many-line input is grouped, never dropped, to bound storage and UI work.
 */
export function requirementItems(projectId:string,versionId:string,content:string):RequirementItem[]{
  let ranges:{start:number;end:number}[]=[];
  for(const match of content.matchAll(/[^\r\n]+/g)){
    if(match[0].trim())ranges.push({start:match.index!,end:match.index!+match[0].length});
  }
  if(ranges.length>200){const grouped=[];const size=Math.ceil(ranges.length/200);for(let i=0;i<ranges.length;i+=size)grouped.push({start:ranges[i].start,end:ranges[Math.min(i+size-1,ranges.length-1)].end});ranges=grouped;}
  const counts=new Map<string,number>();
  return ranges.map(({start,end},position)=>{
    const text=content.slice(start,end),normalized=text.trim().replace(/\s+/g,' ');
    const occurrence=counts.get(normalized)??0;counts.set(normalized,occurrence+1);
    const key=`REQ-${hash(`${projectId}\0${normalized}\0${occurrence}`).slice(0,16)}`;
    return {id:uuid(`${versionId}\0${key}`),key,position:position+1,start,end,text,acceptanceCandidate:/必须|应当|不得|禁止|至少|至多|验收|成功|失败|超时|不超过|shall|must/i.test(text)};
  });
}
export type PlanWarning={code:string;message:string;itemKeys:string[];taskKey?:string};
export function assessPlan(plan:Plan,items:RequirementItem[]):{warnings:PlanWarning[];scope:string}{
  const warnings:PlanWarning[]=[],known=new Set(items.map(i=>i.key)),covered=new Set<string>();
  for(const task of plan.tasks){
    for(const key of task.requirementIds??[])if(known.has(key))covered.add(key);
    const unknown=(task.requirementIds??[]).filter(key=>!known.has(key));
    if(unknown.length)warnings.push({code:'unknown_requirement',taskKey:task.key,itemKeys:unknown,message:'关联了当前版本不存在的条目，不能作为覆盖依据。'});
    if(!task.requirementIds?.length)warnings.push({code:'unmapped_task',taskKey:task.key,itemKeys:[],message:'此任务尚未关联具体需求，请人工检查用途。'});
    warnings.push({code:task.citations.length?'citation_support_unreviewed':'no_source',taskKey:task.key,itemKeys:[],message:task.citations.length?'引用ID有效，但引用是否支持任务结论尚未人工核对。':'此任务没有知识来源；可能合理，请人工判断是否需要依据。'});
    if(task.deliverable.trim().length<6)warnings.push({code:'acceptance_needs_detail',taskKey:task.key,itemKeys:task.requirementIds??[],message:'产物描述较短，请检查是否包含可执行的验收方法（启发式提示）。'});
  }
  const missing=items.filter(i=>!covered.has(i.key));
  if(missing.length)warnings.push({code:'unmapped_requirements',itemKeys:missing.map(i=>i.key),message:`${missing.length} 个原文条目未被计划关联，包含的验收条件可能遗漏。`});
  if(!items.some(i=>i.acceptanceCandidate))warnings.push({code:'acceptance_unspecified',itemKeys:[],message:'未识别到明确的验收词，请人工核对预期行为和边界条件；这不是语义完整性判定。'});
  return {warnings,scope:'结构校验与启发式缺项提示；关联和引用支持性均待人工审核，不代表需求完整或测试通过。'};
}
export type EvidenceCase={id:string;revision:number;result:string;executionNote:string;executedAt:string|null};
export type EvidenceLink={itemId:string;caseId:string|null;taskId:string|null;caseRevision:number|null;status:string};
export function itemEvidence(itemId:string,links:EvidenceLink[],cases:EvidenceCase[]){
  const related=links.filter(link=>link.itemId===itemId&&link.status!=='rejected');
  const confirmed=related.filter(link=>link.status==='confirmed');
  const stale=related.filter(link=>link.caseId&&cases.find(c=>c.id===link.caseId)?.revision!==link.caseRevision);
  const manualEvidence=confirmed.filter(link=>{
    const c=cases.find(c=>c.id===link.caseId);
    return c&&c.revision===link.caseRevision&&c.result==='passed'&&!!c.executedAt&&!!c.executionNote.trim();
  });
  return {suggested:related.filter(link=>link.status==='suggested').length,confirmedTasks:confirmed.filter(link=>link.taskId).length,confirmedCases:confirmed.filter(link=>link.caseId&&!stale.includes(link)).length,stale:stale.length,manualEvidence:manualEvidence.length};
}
