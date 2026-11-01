import {createHash} from 'node:crypto';
import {taskTestEvidence} from '../trace/task-test.js';

export class TeachingError extends Error {
 constructor(readonly code:string,readonly status=409){super(code);}
}
export function assertTransition(state:string,action:'submit'|'return'|'accept'){
 if(action==='submit'?!['working','returned'].includes(state):state!=='submitted')throw new TeachingError('teaching_state_changed');
}
export function snapshotDigest(snapshot:unknown){return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');}
type Row=Record<string,any>;
export function teachingGaps(s:{tasks:Row[];cases:Row[];documents:Row[];items:Row[];links:Row[];chains:Row[];evidence?:Row|null}){
 const gaps:{code:string;count:number;message:string;next:string}[]=[];
 const add=(code:string,count:number,message:string,next:string)=>{if(count)gaps.push({code,count,message,next});};
 add('no_tasks',s.tasks.length?0:1,'尚无本版任务','前往 Agent 规划并人工审核');
 add('no_tests',s.cases.length?0:1,'尚无本版测试用例','到测试中心建立可执行的验收用例');
 add('unrun_tests',s.cases.filter(c=>c.result==='not_run').length,'用例尚未人工执行','执行后登记实际结果与说明，不把生成当执行');
 add('failed_tests',s.cases.filter(c=>['failed','blocked'].includes(c.result)).length,'存在失败或阻塞用例','修复或说明限制后重新执行');
 add('no_documents',s.documents.length?0:1,'没有本版交付文档','编写或审核项目文档');
 add('documents_need_review',s.documents.filter(d=>!d.source_snapshot||!s.evidence||['requirementVersionId','taskRevision','caseRevision','traceRevision'].some(k=>d.source_snapshot[k]!==s.evidence![k])).length,'文档来源已变化或缺少生成依据快照','核对任务、测试与人工关联变更，逐份审核文档；同一需求版本不代表依据仍有效');
 const cases=s.cases.map(c=>({id:c.id,revision:c.revision,result:c.result,executionNote:c.execution_note,executedAt:c.executed_at}));
 const links=s.links.map(l=>({itemId:l.item_id,taskId:l.task_id,caseId:l.case_id,caseRevision:l.case_revision,status:l.status}));
 const verified=new Set(s.chains.filter(p=>taskTestEvidence({id:p.id,itemId:p.item_id,taskId:p.task_id,caseId:p.case_id,caseRevision:p.case_revision,status:p.status,reviewNote:p.review_note,reviewedAt:p.reviewed_at},links,cases).manualEvidence).map(p=>p.item_id));
 add('unverified_requirements',s.items.filter(i=>!verified.has(i.id)).length,'需求条目缺少已复核的完整任务—测试证据链','在项目追踪中逐条核对关联和真实执行说明');
 return gaps;
}
