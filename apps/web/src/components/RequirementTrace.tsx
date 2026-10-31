import {useCallback,useEffect,useRef,useState} from 'react';
import {useEditGuard,useUnsavedEdit} from './EditGuard';
import './requirement-trace.css';
type Api=<T>(path:string,options?:RequestInit)=>Promise<T>;
type Item={id:string;key:string;position:number;start:number;end:number;text:string;change:string;predecessorId:string|null;changeReviewNote:string|null;coverage:{suggested:number;confirmedTasks:number;confirmedCases:number;stale:number;manualEvidence:number}};
type Target={id:string;title:string;revision?:number;result?:string;executionNote?:string;executedAt?:string|null;steps?:string;expected?:string};
type Link={id:string;itemId:string;taskId:string|null;caseId:string|null;caseRevision:number|null;origin:string;status:string;reviewNote:string};
type Data={version:{id:string;number:number;current:boolean}|null;items:Item[];previousItems:Item[];links:Link[];tasks:Target[];cases:Target[];scope:string;impact:{previousVersion:number|null;removedOrChanged:Item[];historicalAssets:{tasks:number;cases:number;documents:number}}|null};
const labels:Record<string,string>={suggested:'模型建议 · 待确认',confirmed:'人工已确认关联',rejected:'已排除关联',passed:'人工登记通过',failed:'人工登记失败',blocked:'人工登记阻塞',not_run:'未执行',initial:'初始条目',unchanged:'文字未变，证据仍需重新核对',changed_reviewed:'已登记变更关系',new_or_changed:'新增或变更 · 待审核'};

export function RequirementTrace({request,projectId,versionId,refreshKey=''}:{request:Api;projectId:string;versionId?:string;refreshKey?:string}){
  const [data,setData]=useState<Data|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [selected,setSelected]=useState(''),[target,setTarget]=useState(''),[kind,setKind]=useState<'task'|'case'>('task'),[note,setNote]=useState(''),[predecessor,setPredecessor]=useState('');
  const [busy,setBusy]=useState(false);const saving=useRef(false),generation=useRef(0);const {protect}=useEditGuard();
  const base=`/projects/${projectId}/trace`,item=data?.items.find(i=>i.id===selected);
  const load=useCallback(async(signal?:AbortSignal)=>{
    const serial=++generation.current;setLoading(true);setError('');
    try{const next=await request<Data>(`${base}${versionId?`?requirementVersionId=${versionId}`:''}`,{signal});if(signal?.aborted||serial!==generation.current)return;setData(next);setSelected(id=>next.items.some(i=>i.id===id)?id:next.items[0]?.id??'');}
    catch(e){if(!signal?.aborted&&serial===generation.current)setError(e instanceof Error?e.message:'读取追踪关系失败');}
    finally{if(!signal?.aborted&&serial===generation.current)setLoading(false);}
  },[request,base,versionId]);
  useEffect(()=>{const c=new AbortController();void load(c.signal);return()=>{generation.current++;c.abort();};},[load,refreshKey]);
  async function save(decision:'confirmed'|'rejected'='confirmed',change=false):Promise<boolean>{
    if(saving.current||!item)return false;
    const targetRow=(kind==='task'?data?.tasks:data?.cases)?.find(row=>row.id===target);
    if(note.trim().length<3||(!change&&!targetRow)||(change&&!predecessor)){setError('请选择关联对象，并填写至少3个字符的审核依据。');return false;}
    saving.current=true;setBusy(true);setError('');setNotice('');
    try{await request(`${base}/${change?'change-review':'links'}`,{method:'POST',body:JSON.stringify(change?{itemId:item.id,predecessorId:predecessor,note:note.trim()}:{itemId:item.id,targetId:target,targetKind:kind,decision,note:note.trim(),...(kind==='case'?{expectedCaseRevision:targetRow!.revision}:{})})});setNote('');setTarget('');setPredecessor('');setNotice(change?'变更关系已记录，历史证据未自动继承。':'审核已保存。关联确认不等于需求已验证。');await load();return true;}
    catch(e){setError(e instanceof Error?e.message:'保存失败，审核内容已保留');return false;}
    finally{saving.current=false;setBusy(false);}
  }
  useUnsavedEdit(`trace:${projectId}`,{label:'需求追踪审核说明',dirty:!!note.trim(),save:()=>save('confirmed',!!predecessor)});
  function choose(id:string){protect(()=>{setSelected(id);setNote('');setTarget('');setPredecessor('');setNotice('');});}
  const related=data?.links.filter(link=>link.itemId===selected)??[];
  return <section className="editor-panel trace-panel" aria-label="需求到验证证据追踪">
    <div className="panel-heading"><div><span className="eyebrow">REQUIREMENT → EVIDENCE</span><h3>需求到验证证据</h3><p>{data?.version?`需求 v${data.version.number} · ${data.version.current?'当前确认版本':'历史版本（只读）'}`:'确认需求后建立条目追踪'} · 关联、审核、执行分别记录</p></div><button type="button" className="button secondary" disabled={busy||loading} onClick={()=>protect(()=>void load())}>刷新追踪</button></div>
    {error&&<p className="alert error" role="alert">{error}</p>}{notice&&<p className="alert success" role="status">{notice}</p>}
    {loading?<div className="trace-skeleton" role="status">正在核对需求原文、任务与用例证据…</div>:data?.items.length?<>
      <div className="trace-metrics" aria-label="当前版本追踪统计"><span><strong>{data.items.length}</strong> 原文条目</span><span><strong>{data.items.filter(i=>!i.coverage.confirmedTasks||!i.coverage.confirmedCases).length}</strong> 任务或测试关联缺口</span><span><strong>{data.items.filter(i=>i.coverage.stale>0).length}</strong> 关联需要复核</span><span><strong>{data.items.filter(i=>i.coverage.manualEvidence>0).length}</strong> 有人工通过记录及说明</span></div>
      <p className="muted-text">{data.scope} “有记录”不是对需求正确性的自动认证。</p>
      {data.impact?.previousVersion&&<details className="trace-impact"><summary>需求变更影响 · 对照 v{data.impact.previousVersion}</summary><p>其他版本保留 {data.impact.historicalAssets.tasks} 项任务、{data.impact.historicalAssets.cases} 条用例、{data.impact.historicalAssets.documents} 份文档，全部需核对后重新用于当前版本。</p><p>{data.impact.removedOrChanged.length} 个旧条目已删除或改写；下列原文仅帮助人工对照，不自动推断变更关系。</p>{data.impact.removedOrChanged.map(i=><blockquote key={i.id}><code>{i.key}</code><p>{i.text}</p></blockquote>)}</details>}
      <div className="trace-layout"><nav className="trace-item-list" aria-label="选择需求条目">{data.items.map(i=><button type="button" key={i.id} aria-pressed={i.id===selected} onClick={()=>choose(i.id)}><span>条目 {i.position} · {i.coverage.stale?'需复核':!i.coverage.confirmedCases?'测试关联缺口':'已关联测试'}</span><strong>{i.text}</strong><small>{labels[i.change]}</small></button>)}</nav>
      {item&&<div className="trace-detail"><code>{item.key}</code><h4>原文与版本来源</h4><blockquote className="trace-source">{item.text}</blockquote><p className="muted-text">v{data.version?.number} · 原文字符位置 {item.start}–{item.end}（UTF-16） · {labels[item.change]}</p>{item.changeReviewNote&&<p>变更审核：{item.changeReviewNote}</p>}
        <h4>任务 → 用例 → 人工执行记录</h4>{related.length?<ul className="trace-links">{related.map(link=>{
          const row=(link.taskId?data.tasks:data.cases).find(t=>t.id===(link.taskId??link.caseId));const stale=!!link.caseId&&row?.revision!==link.caseRevision;
          return <li key={link.id}><strong>{link.taskId?'任务':'测试'} · {row?.title??'关联对象不可用'}</strong><p>{labels[link.status]} · 最初来源：{link.origin==='model'?'模型建议':'人工添加'}{stale?' · 用例已修改，关联失效待复核':''}</p>{link.reviewNote&&<p>审核依据：{link.reviewNote}</p>}{link.caseId&&<details><summary>核对用例及执行证据</summary><p>步骤：{row?.steps}</p><p>预期：{row?.expected}</p><p>{labels[row?.result??'not_run']} · 当前修订 {row?.revision} / 关联修订 {link.caseRevision}</p><blockquote>{row?.executionNote||'没有执行说明，不能作为充分证据。'}</blockquote><p>{row?.executedAt?new Date(row.executedAt).toLocaleString('zh-CN'):'暂无执行时间'}</p></details>}<button type="button" className="text-link" disabled={busy||!data.version?.current} onClick={()=>protect(()=>{setKind(link.taskId?'task':'case');setTarget(link.taskId??link.caseId??'');setNote('');setPredecessor('');})}>人工复核此关联 →</button></li>;
        })}</ul>:<p className="trace-empty">此条目尚未关联任务或用例。可在下方人工补充；模型未提出关联时不会伪造覆盖。</p>}
        {data.version?.current&&<form className="trace-review" onSubmit={e=>{e.preventDefault();void save('confirmed',!!predecessor);}}><h4>人工审核</h4><div className="trace-review-fields"><label>关联类型<select aria-label="关联类型" value={kind} disabled={busy} onChange={e=>{setKind(e.target.value as 'task'|'case');setTarget('');setPredecessor('');}}><option value="task">开发任务</option><option value="case">测试用例</option></select></label><label>当前版本对象<select aria-label="当前版本对象" value={target} disabled={busy||!!predecessor} onChange={e=>setTarget(e.target.value)}><option value="">请选择任务或用例</option>{(kind==='task'?data.tasks:data.cases).map(t=><option key={t.id} value={t.id}>{t.title}</option>)}</select></label></div>
          {data.previousItems.length>0&&<label>或登记改写自哪个旧条目<select aria-label="或登记改写自哪个旧条目" value={predecessor} disabled={busy||!!target} onChange={e=>setPredecessor(e.target.value)}><option value="">不登记变更关系</option>{data.previousItems.map(i=><option value={i.id} key={i.id}>{i.position}. {i.text.slice(0,80)}</option>)}</select></label>}
          <label>审核依据<textarea aria-label="审核依据" value={note} disabled={busy} maxLength={2000} minLength={3} required rows={3} onChange={e=>setNote(e.target.value)} placeholder="说明任务/用例如何覆盖这条需求，或旧条目发生了什么改变。"/></label><div className="form-actions"><span className="muted-text">确认关联不会修改测试结果</span><button type="button" className="button secondary" disabled={busy||!target||!!predecessor} onClick={()=>void save('rejected')}>排除关联</button><button className="button primary" disabled={busy}>{busy?'保存审核中…':predecessor?'记录变更关系':'确认关联'}</button></div>
        </form>}
      </div>}</div>
    </>:<p className="trace-empty">还没有已确认的需求。先保存并确认需求，再从原文建立可追溯关系。</p>}
  </section>;
}
