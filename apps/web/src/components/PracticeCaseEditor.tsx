import {useEffect,useRef,useState,type FormEvent} from 'react';
import {useUnsavedEdit} from './EditGuard';

type Api=<T>(path:string,options?:RequestInit)=>Promise<T>;
export type PracticeCase={id:string;revision?:number;executionRevision?:number;category:'normal'|'boundary'|'exception';title:string;preconditions:string;steps:string;expected:string;result:'not_run'|'passed'|'failed'|'blocked';executionNote:string;executedAt:string|null;requirementVersionId:string};
const categories={normal:'正常',boundary:'边界',exception:'异常'};
const outcomes={not_run:'未执行',passed:'通过',failed:'失败',blocked:'阻塞'};
const editable=(v:PracticeCase)=>JSON.stringify([v.category,v.title,v.preconditions,v.steps,v.expected,v.result,v.executionNote||'']);
const errorText=(e:unknown)=>e instanceof Error?e.message:'操作失败，请重试。';
type History={id:string;kind:string;recordedAt:string;snapshot:{revision:number;execution_revision?:number;result:PracticeCase['result'];execution_note:string}};

export function PracticeCaseEditor({item,base,request,onSaved}:{item:PracticeCase;base:string;request:Api;onSaved:(item:PracticeCase)=>void}){
 const [edit,setEdit]=useState(false),[form,setForm]=useState(item),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [needsReview,setNeedsReview]=useState(false),[comparison,setComparison]=useState<PracticeCase|null>(null),[reading,setReading]=useState(false);
 const [history,setHistory]=useState<History[]|null>(null);
 const previous=useRef(item),pending=useRef<Promise<boolean>|null>(null),mounted=useRef(true),read=useRef<AbortController|null>(null);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;read.current?.abort();};},[]);
 useEffect(()=>{const before=previous.current;previous.current=item;setForm(value=>editable(value)===editable(before)?item:value);},[item]);
 function persist(definition:boolean):Promise<boolean>{
  if(pending.current)return pending.current;
  if(needsReview){setError('请先读取并比较最新记录；当前输入仍保留，不会自动覆盖。');return Promise.resolve(false);}
  if(!definition&&!Number.isInteger(form.executionRevision)){setNeedsReview(true);setError('缺少执行版本，请读取最新记录后比较。旧页面不能直接覆盖登记。');return Promise.resolve(false);}
  if(!definition&&form.result!=='not_run'&&!form.executionNote?.trim()){setError('请填写执行说明或证据后再登记结果。记录应说明实际做了什么；未执行请选择“未执行”。');return Promise.resolve(false);}
  const snapshot=form;setBusy(true);setError('');setNotice('');
  const body=definition?{category:snapshot.category,title:snapshot.title,preconditions:snapshot.preconditions,steps:snapshot.steps,expected:snapshot.expected,expectedRevision:snapshot.revision??1}:{result:snapshot.result,note:snapshot.executionNote,expectedRevision:snapshot.revision??1,expectedExecutionRevision:snapshot.executionRevision};
  const operation=(async()=>{
   try{
    const response=await request<{case:PracticeCase}>(`${base}/${item.id}${definition?'':'/execution'}`,{method:'PATCH',body:JSON.stringify(body)});
    if(!mounted.current)return false;
    onSaved(response.case);setForm(value=>editable(value)===editable(snapshot)?response.case:value);if(definition)setEdit(false);setHistory(null);setComparison(null);setNotice(definition?'用例已保存，变更的定义需重新执行。':'人工执行记录已保存。');return true;
   }catch(e){if(mounted.current){setError(errorText(e));if(['test_execution_changed','test_case_changed','execution_revision_required'].includes((e as {code?:string}).code??''))setNeedsReview(true);}return false;}
   finally{pending.current=null;if(mounted.current)setBusy(false);}
  })();pending.current=operation;return operation;
 }
 async function compare(){
  if(reading)return;read.current?.abort();const controller=new AbortController();read.current=controller;setReading(true);setError('');
  try{const {case:latest}=await request<{case:PracticeCase}>(`${base}/${item.id}`,{signal:controller.signal});
   if(controller.signal.aborted||!mounted.current)return;
   if(latest.id!==item.id||latest.requirementVersionId!==item.requirementVersionId||!Number.isInteger(latest.executionRevision))throw new Error('记录来源或执行版本不一致，未替换输入。');
   setComparison(latest);
  }catch(e){if(!controller.signal.aborted&&mounted.current)setError(errorText(e));}
  finally{if(!controller.signal.aborted&&mounted.current)setReading(false);}
 }
 function adoptLatest(keepInput:boolean){
  if(!comparison||keepInput&&comparison.revision!==form.revision)return;
  // Updating the comparison base does not register an outcome. The user must
  // explicitly submit again; another writer can still cause a new conflict.
  onSaved(comparison);setForm(value=>keepInput?{...value,executionRevision:comparison.executionRevision}:comparison);
  setNeedsReview(false);setComparison(null);setError('');setNotice(keepInput?'已保留输入并更新登记依据；核对后再次点击保存才会提交。':'已放弃本地输入，采用最新记录。');
 }
 useUnsavedEdit(`case:${item.id}`,{label:`测试用例：${item.title}`,dirty:editable(form)!==editable(item),save:()=>persist(edit)});
 async function loadHistory(){try{const response=await request<{history:History[]}>(`${base}/${item.id}/history`);if(mounted.current)setHistory(response.history);}catch(e){if(mounted.current)setError(errorText(e));}}
 async function save(event:FormEvent){event.preventDefault();await persist(true);}
 return <article className="case-item"><fieldset className="case-editor-fields" disabled={busy} aria-busy={busy}>
  <div className="case-head"><strong>{item.title}</strong><span className="small-tag">{categories[item.category]} · {outcomes[item.result]} · 定义 v{item.revision??1} / 执行 {item.executionRevision??'待读取'}</span></div>
  {error&&<div className="alert error" role="alert">{error}</div>}{notice&&<p className="muted-text" role="status">{notice}</p>}
  {needsReview&&<section className="execution-conflict" aria-label="执行记录冲突比较"><p>其他窗口可能已更新定义或执行记录。当前输入保留，先比较再决定。</p><button type="button" className="button secondary" disabled={reading} onClick={()=>void compare()}>{reading?'正在读取最新记录…':'读取最新记录以比较'}</button>
   {comparison&&<div className="execution-comparison"><h4>服务端最新记录</h4><p>定义 v{comparison.revision} · 执行版本 {comparison.executionRevision} · {outcomes[comparison.result]}</p><blockquote>{comparison.executionNote||'没有执行说明'}</blockquote><p>步骤：{comparison.steps}</p><p>预期：{comparison.expected}</p><p>{comparison.executedAt?new Date(comparison.executedAt).toLocaleString('zh-CN'):'尚未执行'}</p>
    {comparison.revision!==form.revision&&<p>用例定义已经变化。旧定义下的输入不能直接登记到新定义，请采用最新记录后重新核对。</p>}
    <div className="form-actions"><button type="button" className="button secondary" onClick={()=>adoptLatest(false)}>放弃本地输入，采用最新记录</button><button type="button" className="button secondary" disabled={comparison.revision!==form.revision} onClick={()=>adoptLatest(true)}>保留输入，更新登记依据</button></div>
   </div>}
  </section>}
  {edit?<form onSubmit={save}>
   <label htmlFor={`${item.id}-title`}>标题</label><input id={`${item.id}-title`} value={form.title} maxLength={200} required onChange={e=>setForm({...form,title:e.target.value})}/>
   <label htmlFor={`${item.id}-category`}>类别</label><select id={`${item.id}-category`} value={form.category} onChange={e=>setForm({...form,category:e.target.value as PracticeCase['category']})}><option value="normal">正常</option><option value="boundary">边界</option><option value="exception">异常</option></select>
   <label htmlFor={`${item.id}-preconditions`}>前置条件</label><textarea id={`${item.id}-preconditions`} value={form.preconditions} maxLength={2000} onChange={e=>setForm({...form,preconditions:e.target.value})}/>
   <label htmlFor={`${item.id}-steps`}>步骤和输入</label><textarea id={`${item.id}-steps`} value={form.steps} maxLength={4000} required onChange={e=>setForm({...form,steps:e.target.value})}/>
   <label htmlFor={`${item.id}-expected`}>预期结果</label><textarea id={`${item.id}-expected`} value={form.expected} maxLength={3000} required onChange={e=>setForm({...form,expected:e.target.value})}/>
   <p className="muted-text">修改用例会将已有执行结果重置为未执行。</p><div className="form-actions"><button className="button secondary" type="button" onClick={()=>{setForm(item);setEdit(false);setNeedsReview(false);setComparison(null);}}>取消</button><button className="button primary" disabled={busy||needsReview}>保存用例</button></div>
  </form>:<><p>前置条件：{item.preconditions||'无'}</p><p>步骤：{item.steps}</p><p>预期：{item.expected}</p><button className="text-link" type="button" onClick={()=>setEdit(true)}>编辑用例 →</button><div className="execution-box">
   <label htmlFor={`${item.id}-result`}>人工执行结果</label><select id={`${item.id}-result`} value={form.result} onChange={e=>setForm({...form,result:e.target.value as PracticeCase['result']})}>{Object.entries(outcomes).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select>
   <label htmlFor={`${item.id}-note`}>执行说明 / 证据</label><textarea id={`${item.id}-note`} rows={2} maxLength={4000} value={form.executionNote||''} onChange={e=>setForm({...form,executionNote:e.target.value})} placeholder="填写人工执行记录"/>
   <div className="form-actions"><span className="muted-text">{item.executedAt?`记录时间：${new Date(item.executedAt).toLocaleString('zh-CN')}`:'尚无执行记录'}</span><button type="button" className="button secondary" onClick={()=>void persist(false)} disabled={busy||needsReview}>保存执行结果</button></div>
  </div></>}
  <details className="case-history"><summary onClick={()=>void loadHistory()}>查看用例变更与人工记录历史</summary>{history===null?<p role="status">展开后读取历史…</p>:history.length?<ul>{history.map(row=><li key={row.id}><strong>{row.kind==='definition_changed'?'定义修改前':'登记结果前'} · 修订 v{row.snapshot.revision} · 执行 {row.snapshot.execution_revision??'历史未记录'}</strong><p>{new Date(row.recordedAt).toLocaleString('zh-CN')} · {outcomes[row.snapshot.result]||row.snapshot.result}</p><p>{row.snapshot.execution_note||'当时没有执行说明'}</p></li>)}</ul>:<p>暂无历史快照。当前人工记录仍显示在上方。</p>}</details>
 </fieldset></article>;
}
