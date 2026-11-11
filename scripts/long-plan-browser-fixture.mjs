import {defaultScheme,inspectScheme,hash} from '../apps/api/dist/long-plan/domain.js';
export function longPlanningFixture(state,project,version,{job=false}={}){
 const source='学生提交设备借用申请😀。\n教师核对库存。\n末尾禁止学生审批自己的申请。';
 state.makeDetail=id=>({project:{id,name:'分段规划合成项目',description:'受控浏览器夹具',status:'active'},requirements:[{id:version,projectId:id,version:1,status:'confirmed',content:source}]});
 const scheme=defaultScheme(project,source);const pack={id:version,project_id:project,requirement_version_id:version,source_content:source,source_hash:hash(source),scheme,revision:1,reviewed_revision:null,current:true,audit:inspectScheme(project,source,scheme)};
 if(job){scheme.conditions.forEach(c=>{c.kind='acceptance';});pack.revision=3;pack.reviewed_revision=3;pack.audit=inspectScheme(project,source,scheme);}
 const jobId='33333333-3333-4333-8333-333333333333';
 const summary={id:jobId,requirement_version_id:version,scheme_revision:3,status:'paused',revision:4,error_code:'ai_timeout',created_at:'2026-11-01T00:00:00Z'};
 const detail={job:{...summary,merge_draft:null,merge_review:null,model_snapshot:{model:'browser-fixture'},scheme_snapshot:scheme},current:true,schemeCurrent:true,parts:[{segment_key:'s1',position:1,status:'uncertain',attempts:1,result:null,result_origin:null,error_code:'ai_timeout'},{segment_key:'s2',position:2,status:'pending',attempts:0,result:null,result_origin:null,error_code:null}],attempts:[{id:jobId,segment_key:'s1',attempt_no:1,status:'uncertain',raw_output:null,usage:null,error_code:'ai_timeout',request_snapshot:{sources:[]}}],events:[],audit:null};
 state.longPlanning=async(path,method,input)=>{
  if(method!=='GET')state.writes.push({path,body:input});
  if(path.endsWith('/planning-scheme')&&method==='GET')return {body:structuredClone(pack)};
  if(path.endsWith('/planning-scheme')&&method==='PUT'){
   if(state.longSaveGate)await state.longSaveGate;
   if(state.longConflict)return {status:409,body:{error:'scheme_revision_changed'}};
   pack.scheme=structuredClone(input.scheme);pack.revision++;pack.reviewed_revision=null;pack.audit=inspectScheme(project,source,pack.scheme);return {body:structuredClone(pack)};
  }
  if(path.endsWith('/planning-scheme/review')){pack.revision++;pack.reviewed_revision=pack.revision;return {body:structuredClone(pack)};}
  if(path.endsWith('/long-plans')&&method==='GET')return {body:{jobs:job?[summary]:[],model:'browser-fixture'}};
  if(path.endsWith('/long-plans')&&method==='POST'){job=true;detail.job.status='queued';summary.status='queued';return {status:202,body:{job:summary,created:true}};}
  if(path.endsWith('/retry-part')){detail.parts[0].status='pending';detail.job.revision++;return {body:structuredClone(detail)};}
  if(path.endsWith('/correct-part')&&state.longCorrectionError)return {status:422,body:{error:state.longCorrectionError}};
  if(path.endsWith('/resume')){detail.job.status='running';detail.job.revision++;return {body:structuredClone(detail)};}
  return {body:structuredClone(detail)};
 };
 return {pack,detail};
}
