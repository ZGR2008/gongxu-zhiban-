import { RequirementTrace } from './components/RequirementTrace';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { TestCaseCollection } from './components/ContentView';
import { useEditGuard, useUnsavedEdit } from './components/EditGuard';
import {totalsForVersion,type TestCasePage} from './components/test-case-page';
import './components/test-pagination.css';

type Api = <T>(path:string, options?:RequestInit)=>Promise<T>;
type Props = {request:Api;projectId:string;requirements:{id:string;version:number;status:string}[]};
const errorText = (e:unknown) => e instanceof Error ? e.message : '操作失败，请重试。';
const fmt = (s:string) => new Date(s).toLocaleString('zh-CN');
export {CodeReviewWorkspace as CodeReview} from './components/CodeReviewWorkspace';

type Case={id:string;revision?:number;category:'normal'|'boundary'|'exception';title:string;preconditions:string;steps:string;expected:string;result:'not_run'|'passed'|'failed'|'blocked';executionNote:string;executedAt:string|null;requirementVersionId:string};
const category:Record<string,string>={normal:'正常',boundary:'边界',exception:'异常'}; const outcomes:Record<string,string>={not_run:'未执行',passed:'通过',failed:'失败',blocked:'阻塞'};
function CaseEditor({item,base,request,onSaved}:{item:Case;base:string;request:Api;onSaved:(item:Case)=>void}){
 const [edit,setEdit]=useState(false);const [form,setForm]=useState(item);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 const previous=useRef(item),pending=useRef<Promise<boolean>|null>(null);
 const [history,setHistory]=useState<{id:string;kind:string;recordedAt:string;snapshot:{revision:number;title:string;result:string;execution_note:string}}[]|null>(null);
 const editable=(value:Case)=>JSON.stringify([value.category,value.title,value.preconditions,value.steps,value.expected,value.result,value.executionNote||'']);
 useEffect(()=>{const before=previous.current;previous.current=item;setForm(value=>editable(value)===editable(before)?item:value);},[item]);
 function persist(definition:boolean):Promise<boolean>{
  if(pending.current)return pending.current;
  if(!definition&&form.result!=='not_run'&&!form.executionNote?.trim()){setError('请填写执行说明或证据后再登记结果。记录应说明实际做了什么；未执行请选择“未执行”。');return Promise.resolve(false);}
  setBusy(true);setError('');const snapshot=form;
  const {category,title,preconditions,steps,expected}=snapshot;
  const body=definition?{category,title,preconditions,steps,expected,expectedRevision:snapshot.revision??1}:{result:snapshot.result,note:snapshot.executionNote,expectedRevision:snapshot.revision??1};
  const promise=(async()=>{try{const response=await request<{case:Case}>(`${base}/${item.id}${definition?'':'/execution'}`,{method:'PATCH',body:JSON.stringify(body)});onSaved(response.case);setForm(value=>editable(value)===editable(snapshot)?response.case:value);if(definition)setEdit(false);setHistory(null);return true;}catch(error){setError(errorText(error));return false;}finally{setBusy(false);pending.current=null;}})();pending.current=promise;return promise;
 }
 async function save(event:FormEvent){event.preventDefault();await persist(true);}
 async function execution(){return persist(false);}
 useUnsavedEdit(`case:${item.id}`,{label:`测试用例：${item.title}`,dirty:editable(form)!==editable(item),save:()=>persist(edit)});
 async function loadHistory(){try{const response=await request<{history:NonNullable<typeof history>}>(`${base}/${item.id}/history`);setHistory(response.history);}catch(error){setError(errorText(error));}}
 return <article className="case-item"><fieldset className="case-editor-fields" disabled={busy} aria-busy={busy}><div className="case-head"><strong>{item.title}</strong><span className="small-tag">{category[item.category]} · {outcomes[item.result]} · v{item.revision??1}</span></div>{error&&<div className="alert error">{error}</div>}{edit?<form onSubmit={save}><label htmlFor={`${item.id}-title`}>标题</label><input id={`${item.id}-title`} value={form.title} maxLength={200} required onChange={e=>setForm({...form,title:e.target.value})}/><label htmlFor={`${item.id}-category`}>类别</label><select id={`${item.id}-category`} value={form.category} onChange={e=>setForm({...form,category:e.target.value as Case['category']})}><option value="normal">正常</option><option value="boundary">边界</option><option value="exception">异常</option></select><label htmlFor={`${item.id}-preconditions`}>前置条件</label><textarea id={`${item.id}-preconditions`} value={form.preconditions} maxLength={2000} onChange={e=>setForm({...form,preconditions:e.target.value})}/><label htmlFor={`${item.id}-steps`}>步骤和输入</label><textarea id={`${item.id}-steps`} value={form.steps} maxLength={4000} required onChange={e=>setForm({...form,steps:e.target.value})}/><label htmlFor={`${item.id}-expected`}>预期结果</label><textarea id={`${item.id}-expected`} value={form.expected} maxLength={3000} required onChange={e=>setForm({...form,expected:e.target.value})}/><p className="muted-text">修改用例会将已有执行结果重置为未执行。</p><div className="form-actions"><button className="button secondary" type="button" onClick={()=>{setForm(item);setEdit(false)}}>取消</button><button className="button primary" disabled={busy}>保存用例</button></div></form>:<><p>前置条件：{item.preconditions||'无'}</p><p>步骤：{item.steps}</p><p>预期：{item.expected}</p><button className="text-link" type="button" onClick={()=>setEdit(true)}>编辑用例 →</button><div className="execution-box"><label htmlFor={`${item.id}-result`}>人工执行结果</label><select id={`${item.id}-result`} value={form.result} onChange={e=>setForm({...form,result:e.target.value as Case['result']})}>{Object.entries(outcomes).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select><label htmlFor={`${item.id}-note`}>执行说明 / 证据</label><textarea id={`${item.id}-note`} rows={2} maxLength={4000} value={form.executionNote||''} onChange={e=>setForm({...form,executionNote:e.target.value})} placeholder="填写人工执行记录"/><div className="form-actions"><span className="muted-text">{item.executedAt?`记录时间：${fmt(item.executedAt)}`:'尚无执行记录'}</span><button type="button" className="button secondary" onClick={()=>void execution()} disabled={busy}>保存执行结果</button></div></div></>}<details className="case-history"><summary onClick={()=>void loadHistory()}>查看用例变更与人工记录历史</summary>{history===null?<p role="status">展开后读取历史…</p>:history.length?<ul>{history.map(row=><li key={row.id}><strong>{row.kind==='definition_changed'?'定义修改前':'登记结果前'} · 修订 v{row.snapshot.revision}</strong><p>{fmt(row.recordedAt)} · {outcomes[row.snapshot.result]||row.snapshot.result}</p><p>{row.snapshot.execution_note||'当时没有执行说明'}</p></li>)}</ul>:<p>暂无历史快照。当前人工记录仍显示在上方。</p>}</details></fieldset></article>;
}
export function Tests({request,projectId,requirements}:Props){
 const base=`/projects/${encodeURIComponent(projectId)}/test-cases`;
 const [data,setData]=useState<TestCasePage<Case>|null>(null),[error,setError]=useState('');
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[dirtySummary,setDirtySummary]=useState(false);
 const [view,setView]=useState('current'),[pageIndex,setPageIndex]=useState(0),[pageKey,setPageKey]=useState(0),[traceRevision,setTraceRevision]=useState(0);
 const cursors=useRef<(string|null)[]>([null]),read=useRef<AbortController|null>(null),generation=useRef(0),generating=useRef(false);
 const {protect}=useEditGuard();
 const versions=requirements.filter(r=>r.status==='confirmed').sort((a,b)=>b.version-a.version),req=versions[0];
 const source=view==='current'?req:versions.find(row=>row.id===view),sourceId=source?.id;
 const scope=`${projectId}:${sourceId??''}`,latestScope=useRef(scope);latestScope.current=scope;
 const load=useCallback(async(cursor:string|null=null,index=0)=>{
  read.current?.abort();const controller=new AbortController();read.current=controller;const sequence=++generation.current;
  setLoading(true);setError('');
  try{
   if(!sourceId){setData(null);return;}
   const response=await request<TestCasePage<Case>>(`${base}?requirementVersionId=${encodeURIComponent(sourceId)}&limit=50${cursor?`&cursor=${encodeURIComponent(cursor)}`:''}`,{signal:controller.signal});
   if(controller.signal.aborted||latestScope.current!==scope||sequence!==generation.current)return;
   if(!totalsForVersion(response.summary,sourceId)||!response.page||!Array.isArray(response.cases)||response.cases.some(item=>item.requirementVersionId!==sourceId))throw new Error('完整版本统计暂不可用，已保留当前页面；请刷新后核对。');
   setData(response);setDirtySummary(false);setPageIndex(index);setPageKey(sequence);
   cursors.current=index===0?[null]:[...cursors.current.slice(0,index),cursor];
  }catch(e){if(!controller.signal.aborted&&latestScope.current===scope)setError(errorText(e));}
  finally{if(!controller.signal.aborted&&latestScope.current===scope&&sequence===generation.current)setLoading(false);}
 },[base,request,sourceId,scope]);
 useEffect(()=>{void load();return()=>read.current?.abort();},[load]);
 async function generate(){
  if(!req||generating.current||loading)return;generating.current=true;setBusy(true);setError('');
  try{await request<{cases:Case[]}>(base,{method:'POST',body:JSON.stringify({requirementId:req.id})});if(latestScope.current===scope)await load();}
  catch(e){if(latestScope.current===scope)setError(errorText(e));}
  finally{generating.current=false;setBusy(false);}
 }
 const visible=sourceId?data?.cases.filter(item=>item.requirementVersionId===sourceId)??[]:[];
 const counts=loading||dirtySummary||error?null:totalsForVersion(data?.summary,sourceId);
 function saved(updated:Case){
  if(latestScope.current!==scope||updated.requirementVersionId!==sourceId)return;
  setData(previous=>previous?{...previous,cases:previous.cases.map(c=>c.id===updated.id?updated:c)}:previous);
  setDirtySummary(true); // Do not infer a new global revision from one saved row.
  setTraceRevision(value=>value+1);
 }
 const refresh=()=>protect(()=>void load());
 return <section className="module-page">
  <div className="section-heading compact"><div><div className="eyebrow">TEST DESIGN</div><h2>从需求出发设计测试</h2><p>AI 用例需人工审核。结果为人工登记，平台不会自动执行代码；单次生成需求最多 20000 字符。</p></div><button type="button" className="button primary" onClick={()=>protect(()=>void generate())} disabled={loading||busy||!req||sourceId!==req.id}>{busy?'生成中…':'生成测试用例'} <span>↗</span></button></div>
  {!req&&<div className="alert error">请先确认需求版本。</div>}
  {error&&<div className="alert error" role="alert">{error}<button type="button" disabled={loading||busy} onClick={refresh}>刷新</button></div>}
  <section className="editor-panel">
   <label htmlFor="test-requirement-version">测试来源需求版本</label><select id="test-requirement-version" value={view} disabled={loading||busy} onChange={event=>{const value=event.target.value;protect(()=>setView(value));}}><option value="current">当前已确认{req?` · v${req.version}`:'（暂无）'}</option>{versions.map(row=><option key={row.id} value={row.id}>查看历史快照 · v{row.version}</option>)}</select>
   <p className="muted-text">当前统计仅包含{source?`需求 v${source.version}`:'选定版本'}的完整用例。{sourceId!==req?.id?'这是历史需求，旧结果不能证明当前需求已验证。':'旧版本的通过记录不计入本页、项目概览和交付检查。'}</p>
   <div className="test-page-toolbar" role="group" aria-label="测试用例分页">
    <span role="status">{counts?`完整版本共 ${counts.total} 条 · 第 ${pageIndex+1} 页 · 本页 ${visible.length} 条`:'完整统计待刷新'}</span>
    <div><button className="button secondary" type="button" disabled={loading||busy||dirtySummary||!!error||pageIndex===0} onClick={()=>protect(()=>void load(cursors.current[pageIndex-1],pageIndex-1))}>上一页用例</button><button className="button secondary" type="button" disabled={loading||busy||dirtySummary||!!error||!data?.page.nextCursor} onClick={()=>protect(()=>void load(data!.page.nextCursor,pageIndex+1))}>下一页用例</button><button className="button secondary" type="button" disabled={loading||busy||!sourceId} onClick={refresh}>刷新用例与统计</button></div>
   </div>
   {dirtySummary&&<p className="alert" role="status">用例已保存，完整统计待刷新。当前页的其他编辑已保留；刷新后继续分页。</p>}
   {loading&&<p className="muted-text" role="status">正在读取选定版本与完整统计，当前页暂不可编辑…</p>}
   {counts&&<p className="muted-text">统计读取于 {fmt(counts.capturedAt)} · {counts.failed} 条失败，{counts.blocked} 条阻塞。记录完整不代表需求覆盖完整或已验收。</p>}
   <fieldset className="test-page-fields" disabled={loading||busy} aria-busy={loading||busy}>
    <legend className="sr-only">当前页测试用例</legend>
    {sourceId&&data?.summary.requirementVersionId===sourceId&&<TestCaseCollection key={pageKey} items={visible} summary={counts} renderItem={item=><div key={item.id}><p className="muted-text">来源：需求 v{source?.version} · 模型生成用例 · 人工登记结果</p><CaseEditor item={item} base={base} request={request} onSaved={saved}/></div>}/>}
    {!loading&&counts?.total===0&&<p className="muted-text">此需求版本暂无测试用例，其他版本的结果不会自动继承。</p>}
   </fieldset>
  </section>
  <RequirementTrace request={request} projectId={projectId} versionId={sourceId} refreshKey={`${data?.summary.caseRevision??0}:${traceRevision}`}/>
 </section>;
}
export { DocumentWorkspace as Documents } from './components/DocumentWorkspace';
