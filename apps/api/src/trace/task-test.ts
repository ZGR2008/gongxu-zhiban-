import type {EvidenceCase,EvidenceLink} from './domain.js';
export type TaskTestLink={id:string;itemId:string;taskId:string;caseId:string;caseRevision:number;status:string;reviewNote:string;reviewedAt:string};

/** A recorded manual result is evidence to inspect, never proof that the software works. */
export function taskTestEvidence(pair:TaskTestLink,links:EvidenceLink[],cases:EvidenceCase[]){
 const test=cases.find(row=>row.id===pair.caseId);
 if(pair.status==='rejected')return {state:'rejected',manualEvidence:false};
 if(!test||test.revision!==pair.caseRevision)return {state:'stale_case',manualEvidence:false};
 const taskLinked=links.some(row=>row.itemId===pair.itemId&&row.taskId===pair.taskId&&row.status==='confirmed');
 const caseLinked=links.some(row=>row.itemId===pair.itemId&&row.caseId===pair.caseId&&row.status==='confirmed'&&row.caseRevision===test.revision);
 if(!taskLinked||!caseLinked)return {state:'source_review_required',manualEvidence:false};
 if(test.result==='not_run'||!test.executedAt)return {state:'not_run',manualEvidence:false};
 if(!test.executionNote?.trim())return {state:'missing_evidence',manualEvidence:false};
 return {state:test.result==='passed'?'manual_pass_record':test.result==='failed'?'manual_fail_record':'manual_blocked_record',manualEvidence:test.result==='passed'};
}
