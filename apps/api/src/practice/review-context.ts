import type {ProjectStore} from '../project-store.js';
import type {KnowledgeHit} from '../rag/search.js';
import {requirementGenerationIssue,requirementSegments} from '../requirement-content.js';

export class ReviewContextError extends Error {
  constructor(public status:number,public body:{error:string;[key:string]:unknown}){super(body.error);}
}
type Source={id:string;documentId:string;documentName:string;page:number|null;content:string;distance:number};
export type ReviewContext={schemaVersion:1;scope:'project'|'code_only';capturedAt:string;
  requirement:{id:string;version:number;content:string}|null;
  retrieval:{status:'not_requested'|'no_confirmed_requirement'|'not_configured'|'retrieved'|'no_matches';
    strategy:'confirmed_requirement_segments';segments:{part:number;start:number;end:number;sourceIds:string[]}[];sources:Source[]}};

/** Snapshots what was supplied, not which sources semantically support advice. */
export async function buildReviewContext(store:ProjectStore,ownerId:string,projectId:string,input:{context:'project'|'code_only';requirementId?:string|null},retrieve?: (query:string)=>Promise<KnowledgeHit[]>):Promise<ReviewContext>{
  const context:ReviewContext={schemaVersion:1,scope:input.context,capturedAt:new Date().toISOString(),requirement:null,
    retrieval:{status:'not_requested',strategy:'confirmed_requirement_segments',segments:[],sources:[]}};
  if(input.context==='code_only')return context;
  const requirements=await store.listRequirements(ownerId,projectId);
  const current=requirements?.filter(item=>item.status==='confirmed').sort((a,b)=>b.version-a.version)[0];
  if(input.requirementId!==undefined&&input.requirementId!==(current?.id??null))throw new ReviewContextError(409,{error:'requirement_version_outdated'});
  if(!current){context.retrieval.status='no_confirmed_requirement';return context;}
  const boundary=requirementGenerationIssue(current.content);if(boundary)throw new ReviewContextError(413,boundary);
  context.requirement={id:current.id,version:current.version,content:current.content};
  if(!retrieve){context.retrieval.status='not_configured';return context;}
  const found=new Map<string,Source>();
  for(const segment of requirementSegments(current.content)){
    const hits=await retrieve(segment.content);
    context.retrieval.segments.push({part:segment.part,start:segment.start,end:segment.end,sourceIds:hits.map(hit=>hit.id)});
    for(const hit of hits)if(!found.has(hit.id))found.set(hit.id,{id:hit.id,documentId:hit.document_id,documentName:hit.document_name,page:hit.page,content:hit.content,distance:hit.distance});
  }
  context.retrieval.sources=[...found.values()];context.retrieval.status=found.size?'retrieved':'no_matches';
  return context;
}
