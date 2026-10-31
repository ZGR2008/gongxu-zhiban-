import {useCallback,useEffect,useRef,useState,type FormEvent} from 'react';
import {CodeEditor,RichContent,CopyButton,ModuleGuide} from './ContentView';
import {useEditGuard,useUnsavedEdit} from './EditGuard';
import {RequestScope} from './request-scope';
import './code-review-workspace.css';

type Api=<T>(path:string,options?:RequestInit)=>Promise<T>;
type Draft={language:string;code:string;revision:number;updatedAt?:string};
type Review={id:string;language:string;code:string;syntaxFindings:{code:number;line:number;column:number;message:string}[];aiAdvice:string;modelName:string;createdAt:string};
const empty:Draft={language:'typescript',code:'',revision:0};
const message=(error:unknown)=>error instanceof Error?error.message:'操作失败，当前输入已保留。';
const same=(a:Pick<Draft,'code'|'language'>,b:Pick<Draft,'code'|'language'>)=>a.code===b.code&&a.language===b.language;
const date=(value:string)=>new Date(value).toLocaleString('zh-CN');

export function CodeReviewWorkspace({request,projectId}:{request:Api;projectId:string;requirements?:unknown}){
  const base=`/projects/${projectId}`,{protect}=useEditGuard();
  const [saved,setSaved]=useState<Draft>(empty),[code,setCode]=useState(''),[language,setLanguage]=useState('typescript');
  const [ready,setReady]=useState(false),[reading,setReading]=useState(true),[saving,setSaving]=useState(false),[reviewing,setReviewing]=useState(false);
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[conflict,setConflict]=useState<Draft|null>(null);
  const [reviews,setReviews]=useState<Review[]>([]),[selected,setSelected]=useState<Review|null>(null),[loadingReviews,setLoadingReviews]=useState(true);
  const draftScope=useRef(new RequestScope()),reviewScope=useRef(new RequestScope()),pendingSave=useRef<Promise<boolean>|null>(null),pendingReview=useRef(false),selection=useRef(0),mounted=useRef(true);
  const current=useRef({code,language});current.current={code,language};
  const dirty=!same(current.current,saved);

  const loadDraft=useCallback(async()=>{
    const ticket=draftScope.current.begin(projectId);setReading(true);setError('');
    try{const result=await request<{draft:Draft|null}>(`${base}/code-draft`,{signal:ticket.signal});if(!draftScope.current.accepts(ticket,projectId))return;
      const next=result.draft??empty;setSaved(next);setCode(next.code);setLanguage(next.language);setConflict(null);setReady(true);
    }catch(error){if(draftScope.current.accepts(ticket,projectId)){setError(message(error));setReady(false);}}
    finally{if(draftScope.current.accepts(ticket,projectId))setReading(false);}
  },[request,base,projectId]);
  const loadReviews=useCallback(async()=>{
    const ticket=reviewScope.current.begin(projectId);setLoadingReviews(true);
    try{const result=await request<{reviews:Review[]}>(`${base}/code-reviews`,{signal:ticket.signal});if(!reviewScope.current.accepts(ticket,projectId))return;
      setReviews(result.reviews);setSelected(value=>result.reviews.find(row=>row.id===value?.id)??result.reviews[0]??null);
    }catch(error){if(reviewScope.current.accepts(ticket,projectId))setError(message(error));}
    finally{if(reviewScope.current.accepts(ticket,projectId))setLoadingReviews(false);}
  },[request,base,projectId]);
  useEffect(()=>{mounted.current=true;void loadDraft();void loadReviews();return()=>{mounted.current=false;draftScope.current.cancel();reviewScope.current.cancel();};},[loadDraft,loadReviews]);

  function saveDraft():Promise<boolean>{
    if(pendingSave.current)return pendingSave.current;
    if(!ready||reading||conflict){setError('请先读取并核对已保存的代码草稿，再保存当前输入。');return Promise.resolve(false);}
    if(!dirty)return Promise.resolve(true);
    const snapshot={...current.current},revision=saved.revision;setSaving(true);setError('');setNotice('');
    const promise=(async()=>{try{
      const result=await request<{draft:Draft}>(`${base}/code-draft`,{method:'PUT',body:JSON.stringify({...snapshot,expectedRevision:revision})});
      if(mounted.current){setSaved(result.draft);setNotice(same(current.current,snapshot)?'代码草稿已保存，仅存入本项目，未调用 AI。':'已保存提交时的代码草稿；随后输入的内容仍未保存。');}return true;
    }catch(error){if(mounted.current){setError(message(error));if(error instanceof Error&&'code' in error&&error.code==='code_draft_conflict'){
      try{const latest=await request<{draft:Draft|null}>(`${base}/code-draft`);if(mounted.current)setConflict(latest.draft??empty);}catch{if(mounted.current)setError('草稿发生冲突，但最新草稿读取失败。当前输入已保留，请稍后重试。');}
    }}return false;}
    finally{pendingSave.current=null;if(mounted.current)setSaving(false);}})();pendingSave.current=promise;return promise;
  }
  useUnsavedEdit(`code-draft:${projectId}`,{label:'代码审查草稿（仅保存，不调用AI）',dirty,save:saveDraft});

  async function submit(event:FormEvent){
    event.preventDefault();if(pendingReview.current||!ready||reading||!current.current.code.trim())return;
    const snapshot={...current.current},selectedAtStart=selection.current;
    pendingReview.current=true;setReviewing(true);setError('');setNotice('');
    try{
      if(!(await saveDraft()))return;
      reviewScope.current.cancel();setLoadingReviews(false);
      const result=await request<{review:Review}>(`${base}/code-reviews`,{method:'POST',body:JSON.stringify(snapshot)});
      if(!mounted.current)return;
      setReviews(rows=>[result.review,...rows.filter(row=>row.id!==result.review.id)]);
      if(selection.current===selectedAtStart)setSelected(result.review);
      setNotice('审查记录已保存，结果对应提交时的代码。AI建议未经运行验证。');
    }catch(error){if(mounted.current)setError(message(error));}
    finally{pendingReview.current=false;if(mounted.current)setReviewing(false);}
  }

  return <section className="module-page">
    <div className="section-heading compact"><div><div className="eyebrow">CODE REVIEW</div><h2>让每一次审查都有依据</h2><p>语法诊断由解析器产生；AI 建议未经运行验证。系统不会执行提交的代码。</p></div></div>
    {error&&<div className="alert error" role="alert">{error}</div>}{notice&&<p className="alert success" role="status">{notice}</p>}
    <div className="module-grid"><div><form className="editor-panel" onSubmit={submit}>
      <div className="panel-heading"><div><h3>提交代码</h3><p>保存草稿仅写入本项目；提交审查才会将代码发送至配置的 AI 服务。</p></div><button type="button" className="text-link" disabled={reading||saving||reviewing} onClick={()=>protect(()=>void loadDraft())}>重新读取草稿</button></div>
      {reading&&<p role="status" className="muted-text">正在读取当前项目草稿…</p>}
      <fieldset className="code-draft-fields" disabled={!ready||reading}>
        <label htmlFor="code-language">语言</label><select id="code-language" value={language} onChange={event=>setLanguage(event.target.value)}><option value="typescript">TypeScript</option><option value="javascript">JavaScript</option></select>
        <label htmlFor="code-input">代码内容</label><CodeEditor value={code} onChange={setCode} language={language}/>
        <p className="muted-text" role="status">{dirty?'有尚未保存的编辑':saved.revision?`草稿修订 ${saved.revision} · 已保存`:'尚无已保存草稿'} · 最多 50000 字符</p>
        <div className="form-actions"><button type="button" className="button secondary" disabled={saving||reviewing||!dirty||!!conflict} onClick={()=>void saveDraft()}>{saving?'保存草稿中…':'保存代码草稿'}</button><button className="button primary" disabled={saving||reviewing||!!conflict||!code.trim()}>{reviewing?'审查中…':'提交审查'} <span>↗</span></button></div>
      </fieldset>
      {conflict&&<section className="code-draft-conflict" aria-label="代码草稿冲突"><h4>另一个窗口的草稿 · 修订 {conflict.revision}</h4><p>当前输入仍保留在编辑器中。请比较后手动合并，再明确选择继续编辑；这一步不会立即覆盖服务器草稿。</p><pre className="code-preview">{conflict.code||'（空草稿）'}</pre><CopyButton value={code} label="复制当前输入"/><button type="button" className="button secondary" onClick={()=>{setSaved(conflict);setConflict(null);setError('');setNotice('已采用最新修订作为保存依据；当前编辑内容尚未提交。');}}>已核对，以当前输入继续编辑</button></section>}
    </form>
    <section className="editor-panel"><div className="panel-heading"><h3>审查记录</h3><button className="text-link" type="button" disabled={loadingReviews||reviewing} onClick={()=>void loadReviews()}>刷新审查记录</button></div>
      {loadingReviews?<p role="status" className="muted-text">正在加载…</p>:reviews.length?<ul className="module-list">{reviews.map(row=><li key={row.id}><button type="button" className="run-link" aria-pressed={selected?.id===row.id} onClick={()=>{selection.current++;setSelected(row);}}><strong>{row.language} · {date(row.createdAt)}</strong><small>模型：{row.modelName}</small></button></li>)}</ul>:<p className="muted-text">暂无审查记录。</p>}
    </section></div><div>{selected?<>
      <section className="editor-panel"><h3>真实语法诊断</h3><p className="muted-text">仅检查语法，不包含类型、安全、性能或运行正确性验证。</p>{selected.syntaxFindings.length?<ul className="finding-list">{selected.syntaxFindings.map((finding,index)=><li key={index}>第 {finding.line} 行，第 {finding.column} 列 · TS{finding.code}<p>{finding.message}</p></li>)}</ul>:<p className="muted-text">语法检查未报告问题，不代表代码没有其他问题。</p>}</section>
      <section className="editor-panel"><h3>AI 审查建议</h3><p className="muted-text">以下内容未经验证，请结合实际代码和测试判断。</p><RichContent value={selected.aiAdvice}/><div className="result-copy"><CopyButton value={selected.aiAdvice}/></div></section>
      <details className="editor-panel"><summary>查看本次提交的代码</summary><pre className="code-preview">{selected.code}</pre></details>
    </>:<ModuleGuide kind="review"/>}</div></div>
  </section>;
}
