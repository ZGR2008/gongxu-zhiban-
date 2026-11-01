import {createHash} from 'node:crypto';
import {z} from 'zod';
import {requirementItems} from '../trace/domain.js';
import {requirementSegments,REQUIREMENT_STORAGE_LIMIT} from '../requirement-content.js';
export const PROMPT_VERSION='long-plan-fragment-v1';
export const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
const id=z.string().regex(/^CND-[a-f0-9]{20}$/);
export const schemeSchema=z.object({boundaries:z.array(z.number().int().min(1).max(50000)).min(1).max(20),conditions:z.array(z.object({
 key:id,start:z.number().int().nonnegative(),end:z.number().int().positive(),statement:z.string().max(800),
 kind:z.enum(['unclassified','acceptance','context']),dependsOn:z.array(id).max(20),crossNote:z.string().max(2000),overlapNote:z.string().max(1000),
}).strict()).min(1).max(200)}).strict();
export type Scheme=z.infer<typeof schemeSchema>;
export type Issue={key:string;code:string;message:string;conditionIds:string[];taskKeys:string[]};
export function issue(code:string,message:string,conditionIds:string[]=[],taskKeys:string[]=[]):Issue{
 return {key:'CHK-'+hash(JSON.stringify([code,conditionIds,taskKeys])).slice(0,20),code,message,conditionIds,taskKeys};
}
export const conditionKey=(project:string,source:string,start:number,end:number)=>'CND-'+hash(`${project}\0${start}\0${end}\0${source.slice(start,end)}`).slice(0,20);
function splitsPair(source:string,at:number){return at>0&&at<source.length&&/[\uD800-\uDBFF]/.test(source[at-1])&&/[\uDC00-\uDFFF]/.test(source[at]);}
function cyclic(rows:{key:string;dependsOn:string[]}[]){const done=new Set<string>(),active=new Set<string>(),map=new Map(rows.map(r=>[r.key,r]));function visit(k:string):boolean{if(active.has(k))return true;if(done.has(k))return false;active.add(k);for(const dep of map.get(k)?.dependsOn??[])if(map.has(dep)&&visit(dep))return true;active.delete(k);done.add(k);return false;}return rows.some(r=>visit(r.key));}
export function defaultScheme(project:string,source:string):Scheme{
 return {boundaries:requirementSegments(source).map(p=>p.end),conditions:requirementItems(project,'00000000-0000-4000-8000-000000000000',source).map(i=>({
  key:conditionKey(project,source,i.start,i.end),start:i.start,end:i.end,statement:i.text.length<=800?i.text:'请从此原文范围提炼原子验收条件，或明确标为背景上下文',kind:'unclassified',dependsOn:[],crossNote:'',overlapNote:'',
 }))};
}
export function inspectScheme(project:string,source:string,input:Scheme){
 const scheme=schemeSchema.parse(input),errors:Issue[]=[];
 if(!source.trim()||source.length>REQUIREMENT_STORAGE_LIMIT)errors.push(issue('source_length','原文超出既有存储边界。'));
 let start=0;
 const segments=scheme.boundaries.map((end,index)=>{const part={key:`S${index+1}-${hash(source.slice(start,end)).slice(0,12)}`,part:index+1,start,end,content:source.slice(start,end),sourceHash:hash(source.slice(start,end)),conditionIds:scheme.conditions.filter(c=>c.start<end&&c.end>start).map(c=>c.key)};
  if(end<=start||end>source.length||end-start>6000||splitsPair(source,end))errors.push(issue('invalid_segment_boundary','分段须连续、每段1–6000字符，不能拆开emoji代理对。'));
  start=end;return part;});
 if(start!==source.length)errors.push(issue('source_tail_missing','最后一个分段必须覆盖原文末尾。'));
 const keys=new Set<string>(),covered=new Uint8Array(source.length),textSeen=new Map<string,Scheme['conditions'][number]>();
 for(const c of scheme.conditions){
  if(keys.has(c.key))errors.push(issue('duplicate_condition_key','条件标识重复。',[c.key]));keys.add(c.key);
  if(c.start>=c.end||c.end>source.length||splitsPair(source,c.start)||splitsPair(source,c.end)||c.key!==conditionKey(project,source,c.start,c.end)){errors.push(issue('invalid_condition_range','条件范围、标识或原文不匹配。',[c.key]));continue;}
  if(c.kind==='unclassified'||c.statement.trim().length<3)errors.push(issue('unclassified_condition','请明确本条是验收条件还是上下文，并检查条件表述。',[c.key]));
  if(segments.filter(s=>c.start<s.end&&c.end>s.start).length>1&&c.crossNote.trim().length<3)errors.push(issue('cross_boundary_note_required','此条原文跨段，需要说明必须一起核对的含义。',[c.key]));
  let overlap=false;for(let i=c.start;i<c.end;i++){if(covered[i]&&!/\s/.test(source[i]))overlap=true;covered[i]=1;}
  if(overlap&&c.overlapNote.trim().length<3)errors.push(issue('overlapping_condition_note_required','重叠原文范围须记录重复的理由。',[c.key]));
  const normalized=source.slice(c.start,c.end).trim().replace(/\s+/g,' '),prior=textSeen.get(normalized);
  if(prior&&(c.overlapNote.trim().length<3||prior.overlapNote.trim().length<3))errors.push(issue('repeated_condition_note_required','重复原文条件需说明重复意图，不能静默重复计数。',[prior.key,c.key]));textSeen.set(normalized,c);
 }
 if([...source].length&&source.split('').some((c,i)=>!covered[i]&&!/\s/.test(c)))errors.push(issue('unclassified_source_range','存在未归入验收条件或上下文的非空原文；请补充范围，原文没有删除。'));
 for(const c of scheme.conditions)if(new Set(c.dependsOn).size!==c.dependsOn.length||c.dependsOn.some(k=>k===c.key||!keys.has(k)))errors.push(issue('invalid_condition_dependency','条件依赖须引用其他真实条件，不得重复。',[c.key]));
 if(cyclic(scheme.conditions))errors.push(issue('condition_dependency_cycle','条件前置依赖存在环，请人工澄清顺序。'));
 if(!scheme.conditions.some(c=>c.kind==='acceptance'))errors.push(issue('acceptance_required','规划前至少明确一个验收条件；背景分类不证明需求完整。'));
 return {errors,segments,sourceHash:hash(source),offsetEncoding:'UTF-16' as const};
}
const taskSchema=z.object({key:z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/),stage:z.string().trim().min(1).max(100),title:z.string().trim().min(3).max(200),description:z.string().trim().min(6).max(2000),deliverable:z.string().trim().min(6).max(1000),dependsOn:z.array(z.string()).max(80),conditionIds:z.array(id).min(1).max(200),citations:z.array(z.string().uuid()).max(10)}).strict();
export const mergeSchema=z.object({tasks:z.array(taskSchema).min(1).max(80)}).strict();
export type Merge=z.infer<typeof mergeSchema>;
const segmentOutputSchema=z.object({tasks:z.array(taskSchema).max(8),fragments:z.array(z.object({conditionId:id,taskKeys:z.array(z.string()).max(8),note:z.string().trim().min(6).max(1000)}).strict()).max(200),unresolved:z.array(z.object({conditionIds:z.array(id).max(200),message:z.string().trim().min(3).max(1000)}).strict()).max(30)}).strict();
export type SegmentOutput=z.infer<typeof segmentOutputSchema>;
export function parseSegmentOutput(raw:string,segment:ReturnType<typeof inspectScheme>['segments'][number],scheme:Scheme,citationIds:string[]):SegmentOutput{
 const data=segmentOutputSchema.parse(JSON.parse(raw)),known=new Set(segment.conditionIds),taskKeys=new Set(data.tasks.map(t=>t.key));
 if(taskKeys.size!==data.tasks.length||cyclic(data.tasks))throw Error('invalid_segment_tasks');
 const seen=new Set<string>();
 for(const f of data.fragments){if(!known.has(f.conditionId)||seen.has(f.conditionId)||f.taskKeys.some(k=>!taskKeys.has(k)))throw Error('invalid_fragment_reference');seen.add(f.conditionId);const c=scheme.conditions.find(c=>c.key===f.conditionId)!;if(c.kind==='acceptance'&&!f.taskKeys.length&&!data.unresolved.some(u=>u.conditionIds.includes(c.key)))throw Error('acceptance_without_task_or_issue');}
 if(segment.conditionIds.some(k=>!seen.has(k)))throw Error('fragment_omitted');
 for(const t of data.tasks)if(new Set(t.conditionIds).size!==t.conditionIds.length||new Set(t.dependsOn).size!==t.dependsOn.length||new Set(t.citations).size!==t.citations.length||t.conditionIds.some(k=>!known.has(k))||t.dependsOn.some(k=>!taskKeys.has(k)||k===t.key)||t.citations.some(k=>!citationIds.includes(k)))throw Error('invalid_task_reference');
 for(const u of data.unresolved)if(u.conditionIds.some(k=>!known.has(k)))throw Error('invalid_unresolved_reference');
 for(const f of data.fragments)if(f.taskKeys.some(key=>!data.tasks.find(t=>t.key===key)!.conditionIds.includes(f.conditionId)))throw Error('fragment_task_condition_mismatch');
 return data;
}
export function buildMerge(results:{segmentKey:string;output:SegmentOutput}[]):Merge{
 return {tasks:results.flatMap((r,index)=>r.output.tasks.map(t=>({...t,key:`s${index+1}_${t.key}`,dependsOn:t.dependsOn.map(k=>`s${index+1}_${k}`)})))};
}
export function inspectMerge(scheme:Scheme,draft:Merge,citations:string[],unresolved:{conditionIds:string[];message:string}[]=[]){
 const errors:Issue[]=[],warnings:Issue[]=[];const parsed=mergeSchema.safeParse(draft);
 if(!parsed.success)return {errors:[issue('merge_schema','合并计划需包含1–80个具有实际描述和验收方法的任务。')],warnings,semanticCompleteness:'unverified' as const,readyForAutomaticAdoption:false as const};
 const tasks=parsed.data.tasks,keys=new Set(tasks.map(t=>t.key)),known=new Set(scheme.conditions.map(c=>c.key)),titles=new Map<string,string>();
 if(keys.size!==tasks.length||cyclic(tasks))errors.push(issue('merge_dependency_invalid','任务标识重复或任务依赖存在环。'));
 for(const t of tasks){
  if(new Set(t.conditionIds).size!==t.conditionIds.length||new Set(t.dependsOn).size!==t.dependsOn.length||new Set(t.citations).size!==t.citations.length||t.conditionIds.some(k=>!known.has(k))||t.dependsOn.some(k=>!keys.has(k)||k===t.key)||t.citations.some(k=>!citations.includes(k)))errors.push(issue('merge_reference_invalid','任务包含重复或不存在的条件、依赖或来源。',t.conditionIds,[t.key]));
  const title=t.title.trim().toLowerCase(),prior=titles.get(title);if(prior)warnings.push(issue('duplicate_task_title','任务标题相同，请合并或说明不同适用范围。',t.conditionIds,[prior,t.key]));titles.set(title,t.key);
  warnings.push(issue(t.citations.length?'citation_support_review':'no_source',t.citations.length?'来源ID存在，请对照原文确认能否支持此任务。':'该任务没有知识来源，请说明是否能仅依据需求成立。',t.conditionIds,[t.key]));
 }
 for(const c of scheme.conditions){
  const mapped=tasks.filter(t=>t.conditionIds.includes(c.key));
  if(c.kind==='acceptance'&&!mapped.length)errors.push(issue('condition_omitted','验收条件未关联任何合并任务。',[c.key]));
  if(c.dependsOn.length)warnings.push(issue('cross_dependency_review','核对条件前置关系是否反映在任务依赖或验收方法中。',[c.key,...c.dependsOn],mapped.map(t=>t.key)));
 }
 // This flags only obvious lexical/quantity candidates, never proves consistency.
 for(let i=0;i<scheme.conditions.length;i++)for(let j=i+1;j<scheme.conditions.length;j++){
  const a=scheme.conditions[i],b=scheme.conditions[j],tokens=(s:string)=>new Set(s.replace(/不得|禁止|不允许|允许|必须|可以|应当|\d+/g,'').match(/[\u4e00-\u9fff]{2,}/g)??[]);
  const left=tokens(a.statement),right=tokens(b.statement),same=[...left].some(t=>right.has(t));
  if(same&&a.statement!==b.statement&&((/不得|禁止|不允许/.test(a.statement)!==/不得|禁止|不允许/.test(b.statement))||String(a.statement.match(/\d+/g))!==String(b.statement.match(/\d+/g))))warnings.push(issue('possible_requirement_conflict','原文存在相似主题但否定或数量不同，需人工澄清，不能由程序判定已消除矛盾。',[a.key,b.key]));
 }
 unresolved.forEach((u,i)=>warnings.push(issue('model_unresolved_'+i,u.message,u.conditionIds)));
 warnings.push(issue('global_semantic_review','请逐项核对全文末尾、跨段含义、条件是否原子、任务重复、互相矛盾的要求及引用依据；结构检查不能证明语义完整。',scheme.conditions.filter(c=>c.kind==='acceptance').map(c=>c.key)));
 return {errors,warnings,semanticCompleteness:'unverified' as const,readyForAutomaticAdoption:false as const};
}
