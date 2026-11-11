import {createHash} from 'node:crypto';
export const policy=Object.freeze({provider:'DeepSeek',endpoint:'https://api.deepseek.com/chat/completions',model:'deepseek-flash',temperature:0.3,thinking:'disabled',maxOutputTokens:4096,maxCalls:15,maxCostUSD:0.50,timeoutMs:90000,maxRetries:0,inputUSDPerMillion:0.30,outputUSDPerMillion:1.20,priceCheckedAt:'2026-11-01',priceSource:'https://api-docs.deepseek.com/quick_start/pricing/'});
export const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function prepareLive(manifest){
 if(manifest.datasetVersion!=='1.0.0'||manifest.paidCalls!==0||manifest.externalCalls!==0||manifest.scope!=='production_route_prompt_capture_with_fixed_REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3b_retrieval')throw Error('Only reviewed REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3b preparation is accepted');
 const known=new Set(['normal','tail-condition','conflicting-material','no-answer','malicious-material']);
 const frames=manifest.frames.filter(frame=>frame.pipeline),seen=new Set();
 const calls=[];
 for(const frame of frames){
  if(!known.has(frame.caseId)||!['plain_chat','pre_optimization','current_workflow'].includes(frame.pipeline))throw Error('Unknown REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3b frame');
  const key=frame.caseId+':'+frame.pipeline;if(seen.has(key))throw Error('Duplicate frame');seen.add(key);
  if(!frame.messages)continue;
  if(frame.status!=='prepared_not_executed'||!Array.isArray(frame.messages)||!frame.messages.length||frame.messages.some(m=>!['system','user'].includes(m.role)||typeof m.content!=='string'))throw Error('Invalid prepared messages');
  const inputBytes=Buffer.byteLength(JSON.stringify(frame.messages),'utf8');
  if(inputBytes>80000)throw Error('Synthetic input exceeds approved data range; not truncated');
  // UTF-8 bytes plus framing allowance is a deliberately conservative estimate,
  // not provider billing. Failed/time-out calls retain their full reservation.
  const reservedUSD=((inputBytes+2048)*policy.inputUSDPerMillion+policy.maxOutputTokens*policy.outputUSDPerMillion)/1e6;
  calls.push({caseId:frame.caseId,pipeline:frame.pipeline,messages:frame.messages,inputHash:frame.inputHash,knowledgeHash:frame.knowledgeHash,promptHash:digest(frame.messages),reservedUSD,inputBytes});
 }
 if(!calls.length||calls.length>policy.maxCalls||calls.reduce((sum,x)=>sum+x.reservedUSD,0)>policy.maxCostUSD)throw Error('Prepared run exceeds approved count or conservative budget');
 return {policy,manifestHash:digest(manifest),calls,omitted:frames.filter(f=>!f.messages).map(f=>({caseId:f.caseId,pipeline:f.pipeline,status:f.status,reason:f.policy??f.reason})),reservedUSD:calls.reduce((sum,x)=>sum+x.reservedUSD,0)};
}
export async function executeLive(prepared,{apiKey,fetchImpl,onRecord=async()=>{}}){
 if(typeof apiKey!=='string'||!apiKey.trim())throw Error('Local provider credential is missing');
 const results=[];let reserved=0;
 for(const call of prepared.calls){
  if(results.length>=policy.maxCalls||reserved+call.reservedUSD>policy.maxCostUSD)break;
  reserved+=call.reservedUSD;const started=Date.now();
  const record={caseId:call.caseId,pipeline:call.pipeline,promptHash:call.promptHash,inputHash:call.inputHash,knowledgeHash:call.knowledgeHash,model:policy.model,settings:{temperature:policy.temperature,maxOutputTokens:policy.maxOutputTokens,thinking:policy.thinking},status:'failed',provenance:'real_model',reservedUSD:call.reservedUSD,usage:null,costEstimateUSD:null,semanticJudgment:'unjudged',output:null};
  try{
   const response=await fetchImpl(policy.endpoint,{method:'POST',redirect:'error',headers:{authorization:'Bearer '+apiKey,'content-type':'application/json'},body:JSON.stringify({model:policy.model,messages:call.messages,temperature:policy.temperature,thinking:{type:policy.thinking},max_tokens:policy.maxOutputTokens,stream:false}),signal:AbortSignal.timeout(policy.timeoutMs)});
   record.httpStatus=response.status;
   if(!response.ok){record.reason='provider_http_error';await response.body?.cancel();}
   else{
    const body=await response.json();const choice=body?.choices?.[0];
    record.finishReason=choice?.finish_reason??null;
    if(typeof choice?.message?.content==='string'){
     record.output=choice.message.content;record.outputHash=digest(record.output);record.modelVersion=typeof body.model==='string'?body.model:null;
     record.status=choice.finish_reason==='stop'&&record.output.trim()?'executed':'incomplete';
     const input=body.usage?.prompt_tokens,output=body.usage?.completion_tokens;
     if(Number.isSafeInteger(input)&&input>=0&&Number.isSafeInteger(output)&&output>=0){record.usage={inputTokens:input,outputTokens:output,totalTokens:input+output};record.costEstimateUSD=(input*policy.inputUSDPerMillion+output*policy.outputUSDPerMillion)/1e6;}
    }else record.reason='invalid_provider_response';
   }
  }catch{record.reason='transport_or_response_error';}
  record.elapsedMs=Date.now()-started;results.push(record);await onRecord(record,results);
  if(record.status==='failed')break; // No retries, probe calls, fallback providers or silent failures.
 }
 return {results,attemptedCalls:results.length,reservedUSD:reserved,remainingCalls:prepared.calls.length-results.length};
}
