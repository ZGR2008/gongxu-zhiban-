import {useRef,useState} from 'react';
import {useEditGuard,useUnsavedEdit} from './EditGuard';

type Api=<T>(path:string,options?:RequestInit)=>Promise<T>;
export type ChainTarget={id:string;title:string;status?:string;revision?:number;steps?:string;expected?:string;executionNote?:string;executedAt?:string|null;result?:string};
export type ChainLink={itemId:string;taskId:string|null;caseId:string|null;caseRevision:number|null;status:string};
export type TaskTestPair={id:string;itemId:string;taskId:string;caseId:string;caseRevision:number;status:string;reviewNote:string;reviewedAt:string;evidence:{state:string;manualEvidence:boolean}};
export type PairHistory={id:string;linkId:string;recordedAt:string;snapshot:{case_revision:number;status:string;review_note:string}};
const states:Record<string,string>={rejected:'已排除配对',stale_case:'用例已改动 · 配对待复核',source_review_required:'需求关联待审核',not_run:'尚无当前修订执行记录',missing_evidence:'执行说明不足',manual_pass_record:'有人工通过记录',manual_fail_record:'有人工失败记录',manual_blocked_record:'人工登记阻塞'};

export function TaskTestEvidence({projectId,itemId,current,blocked=false,tasks,cases,links,pairs,history,request,refresh}:{projectId:string;itemId:string;current:boolean;blocked?:boolean;tasks:ChainTarget[];cases:ChainTarget[];links:ChainLink[];pairs:TaskTestPair[];history:PairHistory[];request:Api;refresh:()=>Promise<void>}){
 const [taskId,setTaskId]=useState(''),[caseId,setCaseId]=useState(''),[note,setNote]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [expanded,setExpanded]=useState(false),[notice,setNotice]=useState('');
 const pending=useRef<Promise<boolean>|null>(null);const {protect}=useEditGuard();
 const selectedCase=cases.find(row=>row.id===caseId);
 const sourceReady=links.some(link=>link.itemId===itemId&&link.taskId===taskId&&link.status==='confirmed')&&links.some(link=>link.itemId===itemId&&link.caseId===caseId&&link.status==='confirmed'&&link.caseRevision===selectedCase?.revision);
 const related=pairs.filter(pair=>pair.itemId===itemId);
 const canPair=Boolean((tasks.length&&cases.length)||taskId||caseId||note);
 function save(decision:'confirmed'|'rejected'='confirmed'):Promise<boolean>{
  if(pending.current)return pending.current;
  if(blocked||!current){setError('请先刷新并核对当前需求快照，再提交配对。');return Promise.resolve(false);}
  if(!taskId||!selectedCase?.revision||note.trim().length<3||(decision==='confirmed'&&!sourceReady)){setError('请先审核任务、用例与需求条目的关联，再填写配对依据（至少3个字符）。');return Promise.resolve(false);}
  setBusy(true);setError('');setNotice('');
  const promise=(async()=>{try{
   await request(`/projects/${projectId}/trace/task-tests`,{method:'POST',body:JSON.stringify({itemId,taskId,caseId,expectedCaseRevision:selectedCase.revision,decision,note:note.trim()})});
   setNote('');setNotice('配对审核已保存，执行结果未被修改。');await refresh();return true;
  }catch(error){setError(error instanceof Error?error.message:'配对保存失败，审核输入已保留。');return false;}
  finally{setBusy(false);pending.current=null;}})();pending.current=promise;return promise;
 }
 useUnsavedEdit(`task-test:${itemId}`,{label:'任务与测试配对审核',dirty:!!note.trim(),save:()=>save()});
 return <section className="task-test-chain" aria-label="任务与测试验证链"><h4>任务如何被测试验证</h4><p className="muted-text">先审核与需求的关联，再明确任务由哪些用例检查。配对本身不会修改任务状态或测试结果。</p>
  {related.length?<ul className="trace-links">{related.map(pair=>{
   const task=tasks.find(row=>row.id===pair.taskId),test=cases.find(row=>row.id===pair.caseId),revisions=history.filter(row=>row.linkId===pair.id);
   return <li key={pair.id} data-evidence={pair.evidence.state}><div className="chain-path"><span>任务<strong>{task?.title??'对象不可用'}</strong></span><span aria-hidden="true">→</span><span>测试<strong>{test?.title??'对象不可用'}</strong></span></div><p className="chain-state">{states[pair.evidence.state]??'待核对'} · 关联修订 {pair.caseRevision} / 当前修订 {test?.revision??'未知'}</p>
    <details><summary>核对人工审核与执行说明</summary><p>配对依据：{pair.reviewNote}</p><p>人工审核：{new Date(pair.reviewedAt).toLocaleString('zh-CN')}</p><p>步骤：{test?.steps}</p><p>预期：{test?.expected}</p><blockquote>{test?.executionNote||'没有人工执行说明。'}</blockquote><p>{test?.executedAt?`登记时间：${new Date(test.executedAt).toLocaleString('zh-CN')}`:'没有执行登记时间'}</p><p>以上为人工登记内容，平台未自动执行用户代码或认证结果。</p></details>
    {revisions.length>0&&<details><summary>历史配对审核（本次读取 {revisions.length} 条）</summary>{revisions.map(row=><blockquote key={row.id}>修订 {row.snapshot.case_revision} · {row.snapshot.status==='confirmed'?'曾确认':'曾排除'}<p>{row.snapshot.review_note}</p><small>{new Date(row.recordedAt).toLocaleString('zh-CN')}</small></blockquote>)}</details>}
    {current&&<button type="button" className="text-link" disabled={busy} onClick={()=>protect(()=>{setTaskId(pair.taskId);setCaseId(pair.caseId);setNote('');setExpanded(true);})}>复核这条任务验证链 →</button>}
   </li>;
  })}</ul>:<p className="trace-empty">尚未明确任务与用例配对。两者都关联到需求，不代表已经核对它们之间的验证关系。</p>}
  {current&&!canPair&&<p className="muted-text">待准备：{[!tasks.length&&'当前版本开发任务',!cases.length&&'当前版本测试用例'].filter(Boolean).join('、')}。两类对象齐备后，在这里登记它们如何相互验证。</p>}
  {notice&&<p className="alert success" role="status">{notice}</p>}
  {current&&canPair&&<details className="trace-advanced" open={expanded} onToggle={event=>setExpanded(event.currentTarget.open)}><summary>展开任务与用例配对审核{note.trim()?' · 有未保存输入':''}</summary><form className="trace-review" onSubmit={event=>{event.preventDefault();void save();}}><h4>登记人工核对的任务—用例配对</h4>{error&&<p className="alert error" role="alert">{error}</p>}
   <div className="trace-review-fields"><label>开发任务<select aria-label="验证链开发任务" value={taskId} disabled={busy} onChange={e=>setTaskId(e.target.value)}><option value="">选择任务</option>{tasks.map(row=><option key={row.id} value={row.id}>{row.title}</option>)}</select></label><label>验证用例<select aria-label="验证链测试用例" value={caseId} disabled={busy} onChange={e=>setCaseId(e.target.value)}><option value="">选择用例</option>{cases.map(row=><option key={row.id} value={row.id}>{row.title} · 修订 {row.revision}</option>)}</select></label></div>
   {taskId&&caseId&&!sourceReady&&<p className="wb-warning">这项任务和用例尚未都通过上方的需求关联审核，或关联修订已失效。请先核对原文和当前用例。</p>}
   <label>任务验证依据<textarea aria-label="任务验证依据" value={note} disabled={busy} onChange={e=>setNote(e.target.value)} rows={3} minLength={3} maxLength={2000} required placeholder="说明这个用例检查任务的哪项交付结果，以及实际验收方法。"/></label>
   <div className="form-actions"><button type="button" className="button secondary" disabled={blocked||busy||!taskId||!caseId||note.trim().length<3} onClick={()=>void save('rejected')}>排除此配对</button><button type="submit" className="button primary" disabled={blocked||busy||!sourceReady||note.trim().length<3}>{busy?'保存审核中…':'确认任务与用例配对'}</button></div>
  </form></details>}
 </section>;
}
