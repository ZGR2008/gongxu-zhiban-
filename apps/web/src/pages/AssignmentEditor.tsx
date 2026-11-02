import {useEffect,useRef,useState} from 'react';
import {useUnsavedEdit} from '../components/EditGuard';
type Api=<T>(path:string,options?:RequestInit)=>Promise<T>;
type Fields={title:string;brief:string;rubric:string;changeNote:string;applicability:'new_claims_only'|'offer_existing'};
type RecordData={assignment:{id:string;revision:number;state:string};draft:null|{number:number;title:string;brief:string;rubric:string;change_note:string;applicability:Fields['applicability']};versions:{number:number;title:string;brief:string;rubric:string;change_note:string;applicability:string}[]};
const empty:Fields={title:'',brief:'',rubric:'',changeNote:'',applicability:'new_claims_only'};
const values=(d:RecordData):Fields=>{const v=d.draft??d.versions[0];return v?{title:v.title,brief:v.brief,rubric:v.rubric,changeNote:v.change_note,applicability:v.applicability as Fields['applicability']}:empty;};
export function AssignmentEditor({request,classId,assignmentId,onSaved}:{request:Api;classId:string;assignmentId:string|null;onSaved:()=>Promise<void>}){
 const [record,setRecord]=useState<RecordData|null>(null),[value,setValue]=useState<Fields>(empty),[saved,setSaved]=useState<Fields>(empty),[compare,setCompare]=useState<RecordData|null>(null);
 const [busy,setBusy]=useState(false),[loading,setLoading]=useState(!!assignmentId),[error,setError]=useState(''),[notice,setNotice]=useState(''),[readAttempt,setReadAttempt]=useState(0);
 const mounted=useRef(true),pending=useRef<Promise<boolean>|null>(null),key=useRef(crypto.randomUUID()),createdId=useRef<string|null>(null),current=useRef(value),recordRef=useRef(record);current.current=value;recordRef.current=record;
 // A recovered creation belongs to the returned server ID even if its detail read fails.
 // Reloading it must preserve input entered after the original uncertain POST.
 useEffect(()=>{mounted.current=true;const controller=new AbortController(),target=assignmentId??createdId.current;if(target){setLoading(true);setError('');void request<RecordData>(`/teaching/assignments/${target}`,{signal:controller.signal}).then(d=>{if(!mounted.current||controller.signal.aborted)return;recordRef.current=d;setRecord(d);setSaved(values(d));if(!createdId.current)setValue(values(d));else setNotice(JSON.stringify(current.current)===JSON.stringify(values(d))?'已找回服务端任务，输入与已保存内容一致。':'已找回服务端任务；当前输入尚未保存，请比较后再次保存。');}).catch(()=>{if(mounted.current&&!controller.signal.aborted)setError('任务暂时读取失败，未覆盖你的输入。请重新读取，读取成功前不能保存或另建任务。');}).finally(()=>{if(mounted.current&&!controller.signal.aborted)setLoading(false);});}return()=>{mounted.current=false;controller.abort();};},[request,assignmentId,readAttempt]);
 function save(){if(pending.current)return pending.current;const snapshot={...current.current},before=recordRef.current;
  if(!snapshot.title.trim()||snapshot.brief.trim().length<10||snapshot.rubric.trim().length<3){setError('请填写任务名称、至少10字的要求与验收依据。');return Promise.resolve(false);}
  if(!before&&(assignmentId||createdId.current)){setError('请先重新读取原任务，不能将读取失败的任务另存为新任务。');return Promise.resolve(false);}
  if(before&&!before.draft){setError('已发布版本不能覆盖，请先创建修订草稿。');return Promise.resolve(false);}
  setBusy(true);setError('');setNotice('');const operation=(async()=>{try{
   const reply=await request<{assignment:RecordData['assignment'];reused?:boolean}>(before?`/teaching/assignments/${before.assignment.id}`:`/teaching/classes/${classId}/assignments`,{method:before?'PATCH':'POST',body:JSON.stringify(before?{...snapshot,expectedRevision:before.assignment.revision}:{title:snapshot.title,brief:snapshot.brief,rubric:snapshot.rubric,requestKey:key.current})});
   if(!mounted.current)return true;
   if(!before){createdId.current=reply.assignment.id;if(reply.reused){
    // Idempotency recovers the first request, not necessarily the current input.
    // Read its actual revision/content and require an explicit later PATCH for changes.
    const recovered=await request<RecordData>(`/teaching/assignments/${createdId.current}`);if(!mounted.current)return false;
    recordRef.current=recovered;setRecord(recovered);setSaved(values(recovered));setCompare(recovered);
    const unchanged=JSON.stringify(current.current)===JSON.stringify(values(recovered));setNotice(unchanged?'已找回服务端任务，输入与已保存内容一致。':'已找回首次创建的服务端任务；当前输入尚未保存，请比较后再次保存。');
    try{await onSaved();}catch{if(mounted.current)setError('任务已找回，但目录刷新失败；请保留输入后重试。');}return unchanged;
   }}
   const next:RecordData={assignment:reply.assignment,draft:{number:before?.draft?.number??1,title:snapshot.title,brief:snapshot.brief,rubric:snapshot.rubric,change_note:snapshot.changeNote,applicability:snapshot.applicability},versions:before?.versions??[]};recordRef.current=next;setRecord(next);setSaved(snapshot);setCompare(null);setNotice('同一任务草稿已保存，尚未发布。');
   try{await onSaved();}catch{if(mounted.current)setNotice('草稿已保存；目录刷新失败，请稍后刷新核对。');}return true;
  }catch{if(mounted.current)setError('保存未完成或修订已变化；输入保留。请读取服务端版本比较，结果不确定时用同一请求键核对。');return false;}finally{pending.current=null;if(mounted.current)setBusy(false);}})();pending.current=operation;return operation;
 }
 useUnsavedEdit(`assignment-editor-${classId}-${assignmentId??'new'}`,{label:'任务要求与验收依据草稿',dirty:JSON.stringify(value)!==JSON.stringify(saved),save});
 async function readCompare(){const target=recordRef.current?.assignment.id??assignmentId;if(!target)return;setBusy(true);try{const d=await request<RecordData>(`/teaching/assignments/${target}`);if(mounted.current)setCompare(d);}catch{if(mounted.current)setError('服务端版本读取失败，输入仍保留。');}finally{if(mounted.current)setBusy(false);}}
 async function revise(){if(!record)return;setBusy(true);setError('');try{await request(`/teaching/assignments/${record.assignment.id}/revisions`,{method:'POST',body:JSON.stringify({expectedRevision:record.assignment.revision})});const next=await request<RecordData>(`/teaching/assignments/${record.assignment.id}`);if(mounted.current){setRecord(next);setValue(values(next));setSaved(values(next));setNotice('修订草稿已创建。发布前，学生仍按已领取版本进行。');await onSaved();}}catch{if(mounted.current)setError('创建修订未完成，请读取版本核对；不会自动重复创建。');}finally{if(mounted.current)setBusy(false);}}
 const unreadExisting=!record&&!!(assignmentId||createdId.current),locked=busy||loading||unreadExisting||!!record&&!record.draft;
 return <form className="teaching-form" aria-label="实训任务编辑器" onSubmit={e=>{e.preventDefault();void save();}}>
  <h3>{record?`任务版本 v${record.draft?.number??record.versions[0]?.number} · ${record.draft?'草稿':'已发布，仅查看'}`:'实训任务草稿'}</h3>
  {loading&&<p role="status">正在读取任务版本…</p>}
  {(['title','brief','rubric'] as const).map((field,i)=><label key={field}>{['任务名称','任务要求','人工验收依据'][i]}{field==='title'?<input aria-label="任务名称" disabled={locked} maxLength={120} value={value.title} onChange={e=>setValue(v=>({...v,title:e.target.value}))}/>:<textarea aria-label={field==='brief'?'任务要求':'人工验收依据'} disabled={locked} rows={5} maxLength={field==='brief'?50000:5000} value={value[field]} onChange={e=>setValue(v=>({...v,[field]:e.target.value}))}/>}</label>)}
  {record&&((record.draft?.number??0)>1||record.versions.length>0)&&<><label>变更说明（发布修订至少10字）<textarea aria-label="变更说明" disabled={locked} value={value.changeNote} maxLength={5000} onChange={e=>setValue(v=>({...v,changeNote:e.target.value}))}/></label><label>适用范围<select aria-label="适用范围" disabled={locked} value={value.applicability} onChange={e=>setValue(v=>({...v,applicability:e.target.value as Fields['applicability']}))}><option value="new_claims_only">仅之后新领取的学生适用</option><option value="offer_existing">通知已有领取者，由学生明确选择</option></select></label><p>发布不会重写已领取要求、学生个人项目或历史提交。已提交者需先退回，才能处理新要求。</p></>}
  {error&&<p role="alert" className="alert error">{error}</p>}{notice&&<p role="status" className="teaching-saved">{notice}</p>}
  <div className="teaching-actions">{(!record||record.draft)&&<button className="button primary" disabled={busy||loading||unreadExisting}>保存草稿</button>}{unreadExisting&&<button type="button" className="button secondary" disabled={busy||loading} onClick={()=>setReadAttempt(v=>v+1)}>重新读取任务</button>}{record&&!record.draft&&<button type="button" className="button primary" disabled={busy} onClick={()=>void revise()}>创建修订草稿</button>}{record&&<button type="button" className="button secondary" disabled={busy} onClick={()=>void readCompare()}>读取服务端版本比较</button>}</div>
  {compare&&<section className="assignment-compare" aria-label="任务冲突比较"><h4>服务端修订 {compare.assignment.revision} · 当前输入保留</h4><p className="teaching-pre">{values(compare).title}{'\n'}{values(compare).brief}{'\n'}验收依据：{values(compare).rubric}</p>{compare.draft?<button type="button" className="button secondary" onClick={()=>{setRecord(compare);setCompare(null);setError('');setNotice('已选择以当前输入更新这一修订，仍需点击保存。');}}>已比较，以当前输入更新草稿</button>:<p>服务端已发布，当前编辑不能覆盖。请保留或复制输入，再从目录打开任务创建新修订。</p>}</section>}
  {record&&record.versions.length>0&&<details><summary>已发布版本记录</summary>{record.versions.map(v=><article key={v.number}><h4>v{v.number} · {v.title}</h4><p className="teaching-pre">{v.brief}</p><p>验收依据：{v.rubric}</p><p>变更：{v.change_note||'初始发布'} · {v.applicability==='offer_existing'?'通知已有领取者':'仅新领取适用'}</p></article>)}</details>}
 </form>;
}
