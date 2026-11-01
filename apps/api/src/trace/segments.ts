import {createHash} from 'node:crypto';
import {requirementItems} from './domain.js';
import {requirementSegments} from '../requirement-content.js';
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
export function segmentPack(projectId:string,versionId:string,content:string){
 const items=requirementItems(projectId,versionId,content),counts=new Map<string,number>();
 const segments=requirementSegments(content).map(part=>{
  const sourceHash=hash(part.content),occurrence=counts.get(sourceHash)??0;counts.set(sourceHash,occurrence+1);
  const related=items.filter(i=>i.start<part.end&&i.end>part.start);
  return {...part,key:'SEG-'+hash(`${projectId}\0${sourceHash}\0${occurrence}`).slice(0,20),sourceHash,itemKeys:related.map(i=>i.key),crossBoundaryKeys:related.filter(i=>i.start<part.start||i.end>part.end).map(i=>i.key)};
 });
 return {projectId,versionId,sourceHash:hash(content),sourceLength:content.length,offsetEncoding:'UTF-16' as const,algorithm:'lossless-4000-v1' as const,items,segments};
}
export type SegmentPack=ReturnType<typeof segmentPack>;
export type SegmentReview={segmentKey:string;decision:'accepted'|'needs_changes';note:string};
export type SegmentResult={segmentKey:string;sourceHash:string;coveredItemKeys:string[];unresolved:string[]};
export function auditSegmentMerge(pack:SegmentPack,results:SegmentResult[],reviews:SegmentReview[]){
 const expected=new Map(pack.segments.map(s=>[s.key,s]));
 const missingSegments=pack.segments.filter(s=>!results.some(r=>r.segmentKey===s.key)).map(s=>s.key);
 const unreviewedSegments=pack.segments.filter(s=>!reviews.some(r=>r.segmentKey===s.key&&r.decision==='accepted'&&r.note.trim().length>=3)).map(s=>s.key);
 const invalidResults:string[]=[],uncoveredFragments:{segmentKey:string;itemKey:string}[]=[],unresolved:{segmentKey:string;note:string}[]=[];
 const seen=new Set<string>();
 for(const r of results){const s=expected.get(r.segmentKey);
  if(!s||s.sourceHash!==r.sourceHash||seen.has(r.segmentKey)||r.coveredItemKeys.some(k=>!s.itemKeys.includes(k))){invalidResults.push(r.segmentKey);continue;}seen.add(r.segmentKey);
  for(const key of s.itemKeys)if(!r.coveredItemKeys.includes(key))uncoveredFragments.push({segmentKey:s.key,itemKey:key});
  unresolved.push(...r.unresolved.map(note=>({segmentKey:s.key,note})));
 }
 return {missingSegments,unreviewedSegments,invalidResults,uncoveredFragments,unresolved,structurallyComplete:![missingSegments,unreviewedSegments,invalidResults,uncoveredFragments,unresolved].some(rows=>rows.length),semanticCompleteness:'unverified' as const,readyForAutomaticAdoption:false as const,scope:'仅检查分段及声明的条目覆盖；不能证明结果理解了原文，跨段语义冲突仍需人工审核。'};
}
/** Adapter contract for a future authorized model worker. Not wired into plan
 * adoption: no automatic generation is enabled by reviewing the source pack. */
export async function processReviewedSegments(pack:SegmentPack,reviews:SegmentReview[],processor:(segment:SegmentPack['segments'][number],signal?:AbortSignal)=>Promise<Pick<SegmentResult,'coveredItemKeys'|'unresolved'>>,signal?:AbortSignal){
 if(auditSegmentMerge(pack,[],reviews).unreviewedSegments.length)throw Error('segment_review_required');
 const completed:SegmentResult[]=[];
 for(const segment of pack.segments){
  if(signal?.aborted)return {status:'cancelled' as const,completed,failedSegment:segment.key};
  try{const result=await processor(segment,signal);if(signal?.aborted)return {status:'cancelled' as const,completed,failedSegment:segment.key};completed.push({...result,segmentKey:segment.key,sourceHash:segment.sourceHash});}
  catch{return {status:signal?.aborted?'cancelled' as const:'failed' as const,completed,failedSegment:segment.key};}
 }
 return {status:'processed_pending_merge_review' as const,completed,audit:auditSegmentMerge(pack,completed,reviews),failedSegment:null};
}
