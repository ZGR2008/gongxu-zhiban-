export type EvidenceSnapshot = {requirementVersionId:string;requirementVersion:number;taskRevision:number;caseRevision:number;traceRevision:number;documentRevision:number;capturedAt:string};
export type SourceDocument = {requirementVersionId:string;sourceSnapshot?:EvidenceSnapshot|null};
export function documentEvidence(doc:SourceDocument,current:EvidenceSnapshot|null|undefined) {
  if(!current)return {status:'unavailable' as const,changed:[] as string[],label:'来源状态待读取'};
  if(doc.requirementVersionId!==current.requirementVersionId)return {status:'historical' as const,changed:[],label:'历史需求，须重新核对'};
  const source=doc.sourceSnapshot;
  if(!source||source.requirementVersionId!==doc.requirementVersionId)return {status:'unknown' as const,changed:[],label:'无生成来源快照，须人工核对'};
  const changed=([['taskRevision','任务'],['caseRevision','测试记录'],['traceRevision','人工关联']] as const).filter(([key])=>source[key]!==current[key]).map(([,label])=>label);
  return changed.length?{status:'changed' as const,changed,label:changed.join('、')+'已变化，文档待复核'}:{status:'current' as const,changed,label:'生成来源未变，内容仍需核实'};
}

/** Local manual checklist stamps are comparison aids, never execution evidence. */
export function evidenceStamp(current:EvidenceSnapshot|null|undefined,kind:string) {
  if(!current)return null;
  const root=current.requirementVersionId;
  if(kind==='requirements')return root;
  if(kind==='plan')return [root,current.taskRevision,current.traceRevision].join(':');
  if(kind==='tests')return [root,current.caseRevision,current.traceRevision].join(':');
  if(kind==='documents')return [root,current.taskRevision,current.caseRevision,current.traceRevision,current.documentRevision].join(':');
  return null;
}
export function manualCheckFresh(status:string,savedStamp:string|null|undefined,currentStamp:string|null) {
  return status==='checked'&&Boolean(currentStamp)&&savedStamp===currentStamp;
}
