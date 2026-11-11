import {createHash} from 'node:crypto';
import {historicalCommit} from './historical-source.mjs';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** Match immutable REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3b inputs; this does not certify execution or quality. */
export function historicalInput(report,sample,input,datasetVersion){
 if(report.scope!=='historical_route_prompt_capture_with_current_local_libraries_and_REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3b_dependencies'||report.historicalSource?.commit!==historicalCommit||report.datasetVersion!==datasetVersion||report.realDatabase!==false||report.externalCalls!==0||report.paidCalls!==0||report.comparisonResults!=='not_executed'||report.fullHistoricalWorkflow!=='not_reproduced')throw Error('Unsupported historical preparation provenance');
 const rows=report.frames?.filter(frame=>frame.caseId===sample.id);
 if(rows?.length!==1)throw Error('Historical case missing or duplicated');
 const frame=rows[0];
 if(frame.pipeline!=='pre_optimization'||frame.commit!==historicalCommit||frame.datasetVersion!==datasetVersion||frame.realModel!==false||frame.rawModelOutput!==null||frame.inputHash!==hash(input)||frame.knowledgeHash!==hash(input.documents))throw Error('Historical input or execution scope mismatch');
 if(frame.status==='prepared_not_executed'){
  if(!Array.isArray(frame.messages)||frame.messages.length!==2||frame.messages[0].role!=='system'||frame.messages[1].role!=='user'||frame.messages.some(message=>typeof message.content!=='string')||frame.promptHash!==hash(frame.messages))throw Error('Historical prompt hash or shape mismatch');
 }else if(frame.status!=='model_not_invoked_by_policy'||sample.kind!=='empty'||frame.policy!=='no_source_no_answer'||frame.messages!==null||frame.promptHash!==null)throw Error('Historical policy record mismatch');
 return structuredClone(frame);
}
