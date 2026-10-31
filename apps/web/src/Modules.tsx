import { RequestScope } from './components/request-scope';
import { EmbeddingActivity } from './components/EmbeddingActivity';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';

import { RichContent, CopyButton, ModuleGuide } from './components/ContentView';
import { AgentProgress, TaskBoard, SourceCollection } from './components/EvidenceViews';
import { RequirementTrace } from './components/RequirementTrace';
import { PlanReview } from './components/PlanReview';
import { PlanMap } from './components/PlanMap';
import { FileDropZone } from './components/FileDropZone';
import {useEditGuard,useUnsavedEdit} from './components/EditGuard';

type Api = <T>(path: string, options?: RequestInit) => Promise<T>;
type Document = { id: string; name: string; status: string; createdAt: string };
type Hit = { id: string; document_name: string; page: number | null; content: string; distance: number };
const errorMessage = (error: unknown) => error instanceof Error ? error.message : '操作失败，请重试。';
const date = (value: string) => new Date(value).toLocaleString('zh-CN');

export function Knowledge({ request }: { request: Api }) {
  const {protect}=useEditGuard();
  const uploadPending=useRef<Promise<boolean>|null>(null),fileRead=useRef(0),listScope=useRef(new RequestScope()),loaded=useRef(false),mounted=useRef(true);
  const [selectedFile,setSelectedFile]=useState<Pick<File,'name'|'size'>|null>(null),[readingFile,setReadingFile]=useState(false);
  const operation=useRef<AbortController|null>(null);const [operationKind,setOperationKind]=useState<'index'|'search'|'answer'|null>(null);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;operation.current?.abort();fileRead.current++;listScope.current.cancel();};},[]);
  async function runRead(kind:'index'|'search'|'answer',work:(signal:AbortSignal)=>Promise<void>){
    if(operation.current||uploadPending.current)return;const controller=new AbortController();operation.current=controller;setOperationKind(kind);setBusy(true);setError('');setNotice('');
    try{await work(controller.signal);}catch(error){if(controller.signal.aborted)setNotice('本次等待已取消，迟到结果不会回填。索引是否已提交请刷新资料核对。');else setError(errorMessage(error));}
    finally{if(operation.current===controller){operation.current=null;setBusy(false);setOperationKind(null);}}
  }

  const [docs, setDocs] = useState<Document[]>([]); const [configured, setConfigured] = useState(false); const [pdfAvailable, setPdfAvailable] = useState(false); const [pdfData, setPdfData] = useState(''); const [fileKey, setFileKey] = useState(0);
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [name, setName] = useState(''); const [text, setText] = useState(''); const [query, setQuery] = useState(''); const [hits, setHits] = useState<Hit[] | null>(null); const [answer, setAnswer] = useState<string | null>(null); const [answerAsked, setAnswerAsked] = useState(false);
  const currentDraft=useRef({name,text,pdfData});currentDraft.current={name,text,pdfData};
  const load = useCallback(async () => { const ticket=listScope.current.begin('knowledge');if(!loaded.current)setLoading(true);setError('');try { const data = await request<{documents: Document[]; embeddingConfigured: boolean; pdfAvailable: boolean}>('/knowledge',{signal:ticket.signal});if(!listScope.current.accepts(ticket,'knowledge'))return;setDocs(data.documents);setConfigured(data.embeddingConfigured);setPdfAvailable(data.pdfAvailable);loaded.current=true; } catch (e) { if(listScope.current.accepts(ticket,'knowledge'))setError(errorMessage(e)); } finally { if(listScope.current.accepts(ticket,'knowledge'))setLoading(false); } }, [request]);
  useEffect(() => { void load(); }, [load]);
  function upload():Promise<boolean> {
    if(uploadPending.current)return uploadPending.current;
    if(operation.current||readingFile){setError('请等待当前操作结束，再保存资料。');return Promise.resolve(false);}
    const snapshot={...currentDraft.current};
    if(!snapshot.name.trim()||snapshot.name.trim().length>160||(!snapshot.pdfData&&!snapshot.text.trim())){setError('请填写文档名称（不超过160字符）和有效内容后保存。');return Promise.resolve(false);}
    setBusy(true);setError('');setNotice('');
    const promise=(async()=>{try {
      const result=await request<{chunks:number}>(snapshot.pdfData?'/knowledge/pdf':'/knowledge/text',{method:'POST',body:JSON.stringify(snapshot.pdfData?{name:snapshot.name.trim(),data:snapshot.pdfData}:{name:snapshot.name.trim(),text:snapshot.text.trim()})});
      if(!mounted.current)return true;
      const current=currentDraft.current,unchanged=current.name===snapshot.name&&current.text===snapshot.text&&current.pdfData===snapshot.pdfData;
      if(unchanged){setName('');setText('');setPdfData('');setSelectedFile(null);setFileKey(k=>k+1);}
      setNotice(`文档已保存并分成 ${result.chunks} 个文本片段，等待建立向量索引。${unchanged?'':'提交后的新编辑仍保留在下方，尚未保存。'}`);
      // Refreshing the list is a read, not a second upload; a failed read must
      // never undo the confirmed save or erase edits made during the request.
      await load();return true;
    }catch(e){setError(errorMessage(e));return false;}finally{setBusy(false);uploadPending.current=null;}})();
    uploadPending.current=promise;return promise;
  }
  useUnsavedEdit('knowledge-upload',{label:'尚未保存的知识资料',dirty:!!(name.trim()||text.trim()||pdfData),save:upload});
  async function indexDocument(id:string) { await runRead('index',async signal=>{const result=await request<{chunks:number}>(`/knowledge/${encodeURIComponent(id)}/index`,{method:'POST',signal});if(signal.aborted)return;await load();setNotice(`向量索引已建立，共 ${result.chunks} 个片段。`);}); }
  async function search(event:FormEvent) {event.preventDefault();await runRead('search',async signal=>{setHits(null);setAnswer(null);setAnswerAsked(false);const result=await request<{hits:Hit[]}>('/knowledge/search',{method:'POST',body:JSON.stringify({query:query.trim()}),signal});if(!signal.aborted)setHits(result.hits);});}
  async function ask(){if(!query.trim())return;await runRead('answer',async signal=>{setHits(null);setAnswer(null);setAnswerAsked(false);const result=await request<{answer:string|null;sources:Hit[]}>('/knowledge/answer',{method:'POST',body:JSON.stringify({query:query.trim()}),signal});if(!signal.aborted){setAnswer(result.answer);setAnswerAsked(true);setHits(result.sources);}});}
  async function readFile(file?: File) {
    if(!file||uploadPending.current)return;
    const serial=++fileRead.current,isPdf=/\.pdf$/i.test(file.name);setError('');setReadingFile(false);
    if(!isPdf&&!/\.(txt|md)$/i.test(file.name)){setError('请选择 PDF、TXT 或 Markdown 文件。');return;}
    if(isPdf&&!pdfAvailable){setError('PDF 解析器不可用，请检查服务端配置；仍可上传文本资料。');return;}
    if(file.size>(isPdf?3_000_000:800_000)){setError(isPdf?'PDF 文件不能超过 3 MB（3000000 字节）。':'文本文件过大，请使用不超过 800 KB 的文件。');return;}
    if(file.name.length>160){setError('文件名称不能超过160字符，请重命名后选择。');return;}
    setReadingFile(true);
    try{
      const content=isPdf?await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>typeof reader.result==='string'?resolve(reader.result.split(',')[1]||''):reject(new Error());reader.onerror=()=>reject(new Error());reader.readAsDataURL(file);}):await file.text();
      if(serial!==fileRead.current)return;
      if(!content.trim()){setError('文件为空，原有草稿已保留。');return;}
      if(!isPdf&&content.length>200000){setError('文档不能超过 200000 字符，原有草稿已保留。');return;}
      protect(()=>{if(serial!==fileRead.current)return;setName(file.name);setText(isPdf?'':content);setPdfData(isPdf?content:'');setSelectedFile({name:file.name,size:file.size});setNotice('文件已读取到编辑区，保存后才会导入知识库。');});
    }catch{if(serial===fileRead.current)setError('读取文件失败，原有草稿已保留，请重试。');}
    finally{if(serial===fileRead.current)setReadingFile(false);}
  }
  return <section className="module-page"><div className="detail-heading"><div><div className="eyebrow">KNOWLEDGE / RETRIEVAL</div><h2>让知识成为实践的依据</h2><p>导入软件工程资料，通过真实语义检索查看原始片段与来源。</p></div><span className="status-pill">{loading ? '检查中' : configured ? '向量服务已配置' : '向量服务未配置'}</span></div>
    {error && <div className="alert error" role="alert">{error}<button type="button" onClick={() => void load()}>重新检查</button></div>}{notice && <div className="alert success" role="status">{notice}</div>}
    <EmbeddingActivity request={request} active={busy}/>{(operationKind==='search'||operationKind==='index')&&<div className="form-actions"><span role="status" className="muted-text">正在等待向量服务，排队与重试状态见上方记录。</span><button type="button" className="button secondary" onClick={()=>operation.current?.abort()}>取消检索或索引</button></div>}{loading ? <div className="state-block">正在读取知识库…</div> : <div className="module-grid"><div><form className="editor-panel" onSubmit={event=>{event.preventDefault();void upload();}}><div className="panel-heading"><div><h3>添加知识资料</h3><p>支持 PDF、TXT、Markdown 或粘贴文本。扫描件暂不支持 OCR。</p></div></div><label htmlFor="knowledge-file">选择文件</label><FileDropZone key={fileKey} id="knowledge-file" selectedFile={selectedFile} disabled={busy} onFile={file=>void readFile(file)}/>{readingFile&&<p className="muted-text" role="status">正在读取所选文件，原有草稿保持不变…</p>}<p className="muted-text">{pdfAvailable ? 'PDF 文本解析器可用' : 'PDF 解析器不可用，仍可保存文本资料'}。</p><label htmlFor="knowledge-name">文档名称</label><input id="knowledge-name" value={name} onChange={e => setName(e.target.value)} required maxLength={160} placeholder="例如：软件需求分析指南"/>{pdfData ? <p className="muted-text">已选择 PDF；提交后将在服务端提取文本并分块。</p> : <><label htmlFor="knowledge-content">文档内容</label><textarea id="knowledge-content" rows={8} value={text} onChange={e => setText(e.target.value)} required maxLength={200000} placeholder="在这里粘贴文本内容…"/></>}<div className="form-actions"><span className="muted-text">{pdfData ? 'PDF 文件已就绪' : `${text.length} / 200000 字符`}</span><button className="button primary" type="submit" disabled={busy || readingFile || !name.trim() || (!pdfData && !text.trim())}>{busy ? '处理中…' : '保存并分块'} <span>↗</span></button></div></form><section className="editor-panel"><div className="panel-heading"><div><h3>我的知识资料</h3><p>仅展示当前账号下的文档。文本可先保存并分块，配置向量服务后再建立索引。</p></div></div>{docs.length ? <ul className="module-list">{docs.map(doc => <li key={doc.id}><span><strong>{doc.name}</strong><small>{date(doc.createdAt)}</small></span><span className="document-actions"><span className="small-tag">{doc.status === 'ready' ? '可检索' : doc.status === 'failed' ? '索引失败' : doc.status === 'awaiting_embedding' ? '待向量化' : '处理中'}</span>{(doc.status === 'awaiting_embedding' || doc.status === 'failed') && <button type="button" className="button secondary" disabled={busy || !configured} onClick={() => void indexDocument(doc.id)} title={!configured ? '请先配置向量服务' : '为此文档建立向量索引'}>{busy ? '处理中…' : doc.status === 'failed' ? '重试索引' : '建立索引'}</button>}</span></li>)}</ul> : <p className="muted-text">暂无文档，添加资料后可进行检索。</p>}</section></div><div><form className="editor-panel" onSubmit={search}><div className="panel-heading"><div><h3>语义检索</h3><p>查找相关片段，来源可供核对。检索不等于事实验证。</p></div></div><label className="sr-only" htmlFor="knowledge-query">检索问题</label><textarea id="knowledge-query" value={query} onChange={e => setQuery(e.target.value)} maxLength={4000} rows={4} required placeholder="输入你要查找的工程问题…"/><div className="form-actions"><button className="button secondary" type="button" onClick={() => void ask()} disabled={busy || !configured || !query.trim()}>知识增强回答 <span>✦</span></button><button className="button primary" type="submit" disabled={busy || !configured || !query.trim()}>{busy ? '处理中…' : '检索知识'} <span>↗</span></button></div></form>{answerAsked && <section className="editor-panel"><h3>知识增强回答</h3><RichContent value={answer ?? '未找到足够相关的资料，无法给出基于知识库的回答。'}/>{answer && <CopyButton value={answer}/>}<p className="muted-text">引用仅表明来源存在，请人工核对原文是否支持结论。</p></section>}{!hits && !answerAsked && !busy && <ModuleGuide kind="knowledge"/>}{hits && <section className="editor-panel"><h3>检索来源</h3>{hits.length ? <SourceCollection hits={hits}/> : <p className="muted-text">未找到满足条件的相关片段，请更换问题或补充资料。</p>}</section>}</div></div>}
  </section>;
}

type Requirement = { id:string; version:number; status:string };
type TaskPlan = {key:string;stage:string;title:string;description:string;deliverable:string;dependsOn:string[];citations:string[]};
type Run = {id:string;requirementVersionId:string;status:string;plan:{tasks:TaskPlan[]} | null;errorCode:string|null;createdAt:string;heartbeatAt?:string|null;deadlineAt?:string|null;requestKey?:string|null;humanReview?:{reviewedAt:string;note:string;warningCount:number;scope:string}|null};
type Tool = {id:string;toolName:string;status:string;inputSummary:string;outputSummary:string};
type Step = {id:string;stage:string;status:string;outputSummary:string;tools:Tool[]};
type RunDetail = {run:Run; steps:Step[]};
type Task = {id:string;title:string;stage:string;description:string;deliverable:string;status:string;dependsOn:string[];requirementVersionId?:string};
const statuses: Record<string,string> = {running:'运行中',succeeded:'成功',failed:'失败',skipped:'已跳过',awaiting_review:'待审核',confirmed:'已确认',pending:'待开始',todo:'待开始',doing:'进行中',review:'待审核',done:'已完成',blocked:'阻塞'};
const stages: Record<string,string> = {knowledge_search:'知识检索',plan_1:'计划生成（第 1 次）',plan_2:'计划生成（第 2 次）',validate_1:'计划校验（第 1 次）',validate_2:'计划校验（第 2 次）',validate_plan:'计划校验'};
export function Agent({ request, projectId, requirements }: {request:Api;projectId:string;requirements:Requirement[]}) {
  const editGuard=useEditGuard();
  const [runs,setRuns] = useState<Run[]>([]); const [selected,setSelected] = useState<RunDetail | null>(null); const [tasks,setTasks] = useState<Task[]>([]);
  const [planning,setPlanning] = useState(false);
  const [cancelling,setCancelling]=useState(false);const cancelPending=useRef(false),requestKey=useRef<string|null>(null);
  const [reviewed,setReviewed]=useState(false);
  const [reviewNote,setReviewNote]=useState('');
  const runSelection=useRef(new RequestScope()),historyScope=useRef(new RequestScope());const working=useRef(false);
  const selectedRunId=useRef<string|null>(null),selectionEpoch=useRef(0);
  const [pendingRun,setPendingRun]=useState<string|null>(null);
  useEffect(()=>()=>{runSelection.current.cancel();historyScope.current.cancel();selectionEpoch.current++;},[]);
  const chooseRun=useCallback((id:string|null)=>{selectionEpoch.current++;selectedRunId.current=id;runSelection.current.cancel();setSelected(null);setPendingRun(id);setReviewed(false);setReviewNote('');},[]);
  const [loading,setLoading] = useState(true); const [busy,setBusy] = useState(false); const [error,setError] = useState(''); const [notice,setNotice] = useState('');
  useUnsavedEdit(`plan-review:${projectId}`,{label:'计划审核备注（需主动确认计划）',dirty:Boolean(reviewNote.trim()&&selected?.run.status==='awaiting_review'),save:async()=>{setError('审核备注在主动确认采用计划时保存。请留在此页完成审核；离开保护不会代你确认计划。');return false;}});
  const base = `/projects/${encodeURIComponent(projectId)}`; const latestConfirmed = [...requirements].filter(r => r.status === 'confirmed').sort((a,b)=>b.version-a.version)[0];
  const [taskVersion,setTaskVersion]=useState('current');
  const visibleTaskVersion=taskVersion==='current'?latestConfirmed?.id:taskVersion;
  const visibleTasks=taskVersion==='all'?tasks:tasks.filter(task=>Boolean(visibleTaskVersion)&&task.requirementVersionId===visibleTaskVersion);
  const readRun=useCallback(async(id:string)=>{
    const ticket=runSelection.current.begin(id);
    try{const next=await request<RunDetail>(`${base}/agent/runs/${encodeURIComponent(id)}`,{signal:ticket.signal});
      if(runSelection.current.accepts(ticket,selectedRunId.current??undefined)&&next.run.id===id)setSelected(next);
    }catch(error){if(runSelection.current.accepts(ticket,selectedRunId.current??undefined))setError(errorMessage(error));}
    finally{if(runSelection.current.accepts(ticket,selectedRunId.current??undefined))setPendingRun(null);}
  },[base,request]);
  const refresh = useCallback(async () => {
    const ticket=historyScope.current.begin(base),epoch=selectionEpoch.current;setLoading(true);setError('');
    try{const [history,taskData]=await Promise.all([request<{runs:Run[]}>(`${base}/agent/runs`,{signal:ticket.signal}),request<{tasks:Task[]}>(`${base}/tasks`,{signal:ticket.signal})]);
      if(!historyScope.current.accepts(ticket,base))return;setRuns(history.runs);setTasks(taskData.tasks);
      if(epoch!==selectionEpoch.current)return;
      const id=selectedRunId.current??history.runs[0]?.id;
      if(id){if(!selectedRunId.current)chooseRun(id);await readRun(id);}else chooseRun(null);
    }catch(error){if(historyScope.current.accepts(ticket,base))setError(errorMessage(error));}
    finally{if(historyScope.current.accepts(ticket,base))setLoading(false);}
  },[base,request,chooseRun,readRun]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!planning && selected?.run.status !== 'running') return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function poll() {
      try {
        const history = await request<{runs:Run[]}>(`${base}/agent/runs`, { signal: controller.signal });
        if(!active)return;setRuns(history.runs);
        const id = planning ? history.runs.find(run=>run.requestKey===requestKey.current)?.id : selectedRunId.current;
        if(id){if(!selectedRunId.current)chooseRun(id);if(selectedRunId.current===id)await readRun(id);}
      } catch (error) { if (active) setError(errorMessage(error)); }
      finally { if (active) timer = setTimeout(() => void poll(), 1500); }
    }
    void poll();
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [planning, selected?.run.id, selected?.run.status, base, request,chooseRun,readRun]);
  function selectRun(id:string) {if(id===selectedRunId.current&&selected){void readRun(id);return;}editGuard.protect(()=>{chooseRun(id);setError('');void readRun(id);});}
  async function start() { if (!latestConfirmed||working.current) return;working.current=true;requestKey.current=crypto.randomUUID();chooseRun(null); setBusy(true); setPlanning(true); setError(''); setNotice(''); try { const result = await request<RunDetail>(`${base}/agent/runs`, {method:'POST',body:JSON.stringify({requirementId:latestConfirmed.id,requestKey:requestKey.current})}); if(!selectedRunId.current)chooseRun(result.run.id);await refresh(); setNotice('规划已生成，请审阅任务及实际工具记录。'); } catch (e) { await refresh();if((e as {code?:string}).code==='agent_cancelled')setNotice('运行已取消，已完成步骤保留。重新规划会创建新运行。');else setError(errorMessage(e)); } finally { working.current=false;setBusy(false); setPlanning(false); } }
  async function cancelRun(){if(!selected||selected.run.status!=='running'||cancelPending.current)return;cancelPending.current=true;setCancelling(true);setError('');runSelection.current.cancel();try{await request(`${base}/agent/runs/${selected.run.id}/cancel`,{method:'POST'});await refresh();setNotice('运行已取消，已完成步骤保留。取消不承诺撤销供应商计费。');}catch(error){setError(errorMessage(error));}finally{cancelPending.current=false;setCancelling(false);}}
  async function updateTask(id:string,status:string) { if(working.current)return;working.current=true;setBusy(true); setError(''); try { await request(`${base}/tasks/${encodeURIComponent(id)}`, {method:'PATCH',body:JSON.stringify({status})}); setTasks(prev=>prev.map(task=>task.id===id?{...task,status}:task)); } catch(e) { setError(errorMessage(e)); } finally { working.current=false;setBusy(false); } }
  async function confirm() { if (!selected||selected.run.id!==selectedRunId.current||!reviewed||working.current) return;working.current=true; setBusy(true); setError(''); setNotice(''); try { await request(`${base}/agent/runs/${encodeURIComponent(selected.run.id)}/confirm`,{method:'POST',body:JSON.stringify({acknowledged:true,note:reviewNote})}); await refresh(); setNotice('计划已确认，任务和人工审核记录已保存。'); } catch(e) { setError(errorMessage(e)); } finally { working.current=false;setBusy(false); } }
  return <section className="module-page module-page--agent">
    <div className="section-heading compact"><div><div className="eyebrow">AGENT / PLANNING</div><h2>让计划有依据，也能被检查</h2><p>使用已确认的需求，检索知识并生成任务计划。所有步骤和工具调用来自实际运行。</p></div><div className="form-actions">{selected?.run.status==='running'&&<button type="button" className="button secondary" disabled={cancelling} onClick={()=>void cancelRun()}>{cancelling?'正在取消…':'取消本次运行'}</button>}<button type="button" className="button primary" onClick={() => editGuard.protect(()=>void start())} disabled={busy || cancelling || !latestConfirmed || runs.some(run=>run.status==='running')}>{busy ? '执行中…' : selected?.run.status==='failed'?'重新规划当前需求':'开始规划'} <span>↗</span></button></div></div>
    {selected?.run.status==='running'&&<p className="agent-recovery-note" role="status">最近活动：{selected.run.heartbeatAt?date(selected.run.heartbeatAt):'待读取'}。单次运行最多 10 分钟；失去心跳后，刷新会将运行标记为中断，不会自动重试模型。</p>}
    {selected?.run.status==='failed'&&<p className="agent-recovery-note" role="status">本次运行已停止。{selected.run.errorCode==='agent_cancelled'?'由用户取消。':selected.run.errorCode==='agent_interrupted'?'服务心跳中断，已保留已完成步骤。':selected.run.errorCode==='agent_deadline_exceeded'?'已达到单次运行截止时间。':'请核对失败步骤。'}重新规划由你主动触发，创建新运行，原记录保留。</p>}
    {planning&&!selected&&<p className="agent-recovery-note" role="status">正在等待本次请求的真实运行记录；不会把其他运行的步骤当作本次进度。</p>}
    {!latestConfirmed && <div className="alert error">请先在需求分析页面确认一个需求版本。</div>}
    <EmbeddingActivity request={request} active={planning}/>
    {error && <div className="alert error" role="alert">{error}<button type="button" onClick={() => void refresh()}>刷新记录</button></div>}
    {notice && <div className="alert success" role="status">{notice}</div>}
    {!loading && selected && <AgentProgress run={selected.run} steps={selected.steps}/>}
    {loading ? <div className="state-block">正在读取运行记录…</div> : <>
      <div className="agent-audit-grid">
        <section className="editor-panel"><div className="panel-heading"><div><h3>运行记录</h3><p>选择记录查看执行过程与结果。</p></div><button type="button" className="button secondary" disabled={busy||cancelling} onClick={()=>void refresh()}>刷新运行记录</button></div>
          {runs.length ? <ul className="module-list">{runs.map(run => <li key={run.id}><button type="button" className="run-link" aria-pressed={selected?.run.id === run.id} data-status={run.status} disabled={busy} onClick={() => void selectRun(run.id)}><strong>{date(run.createdAt)}</strong><small>{run.id.slice(0,8)} · {statuses[run.status] || run.status}</small></button></li>)}</ul> : <p className="muted-text">还没有运行记录。先确认需求，再开始规划。</p>}
        </section>
        {selected ? <section className="editor-panel"><div className="panel-heading"><div><h3>执行过程</h3><p>状态：{statuses[selected.run.status] || selected.run.status}{selected.run.errorCode ? ` · ${selected.run.errorCode}` : ''}</p></div></div>
          {selected.steps.length ? <div className="steps-list">{selected.steps.map(step => <article key={step.id} data-status={step.status}><strong>{stages[step.stage] || step.stage} · {statuses[step.status] || step.status}</strong><p>{step.outputSummary}</p>{step.tools.map(tool => <details key={tool.id}><summary>工具：{stages[tool.toolName] || tool.toolName} · {statuses[tool.status] || tool.status}</summary><pre>输入：{tool.inputSummary}{'\n'}输出：{tool.outputSummary}</pre></details>)}</article>)}</div> : <p className="muted-text">暂无步骤记录。</p>}
        </section> : pendingRun?<div className="state-block" role="status">正在读取所选运行…</div>:selectedRunId.current?<div className="state-block">运行读取失败，请刷新记录重试。</div>:<ModuleGuide kind="agent"/>}
      </div>
      {selected?.run.plan && <details className="editor-panel agent-plan-panel" key={`${selected.run.id}-${selected.run.status}`} open={selected.run.status !== 'confirmed'}>
        <summary><span><h3>{selected.run.status === 'confirmed' ? '已确认计划' : '待审阅计划'}</h3><span>{selected.run.plan.tasks.length} 项任务 · 核对任务、依赖及来源后再确认</span></span><span className="plan-disclosure-mark">⌄</span></summary>
        <PlanMap tasks={selected.run.plan.tasks} key={selected.run.id}/>
        <PlanReview plan={selected.run.plan as Parameters<typeof PlanReview>[0]['plan']} outputs={selected.steps.flatMap(step=>step.tools.map(tool=>tool.outputSummary))}/>
        {selected.run.status==='awaiting_review'&&<><label htmlFor="plan-review-note">人工审核备注（可选）</label><textarea id="plan-review-note" rows={3} maxLength={2000} value={reviewNote} disabled={busy} onChange={e=>setReviewNote(e.target.value)} placeholder="记录已核对的缺项、验收条件、引用依据或仍需处理的问题"/><label className="plan-review-check"><input type="checkbox" checked={reviewed} disabled={busy} onChange={e=>setReviewed(e.target.checked)}/>我已核对缺项、验收方法及知识原文；确认只创建任务，不代表需求已验证。模型条目关联仍需逐项审核。</label></>}
        {selected.run.status==='confirmed'&&<div className="plan-audit-note">{selected.run.humanReview?<><strong>人工审核记录 · {date(selected.run.humanReview.reviewedAt)}</strong><p>{selected.run.humanReview.note||'未填写补充备注'}</p><p>确认时有 {selected.run.humanReview.warningCount} 项规则提示。审核仅确认采用此计划，不等于执行或验证完成。</p></>:<p>此历史计划没有可追溯的人工审核记录，不补造审核时间或结论。</p>}</div>}
        {selected.run.status === 'awaiting_review' && <div className="form-actions"><button type="button" className="button primary" onClick={() => void confirm()} disabled={busy || !reviewed}>确认计划并创建任务 <span>✓</span></button></div>}
      </details>}
      <RequirementTrace request={request} projectId={projectId} versionId={latestConfirmed?.id} refreshKey={selected?.run.status}/>
      <section className="editor-panel confirmed-task-panel"><div className="panel-heading"><div><h3>已确认的项目任务</h3><p>{taskVersion==='current'?'当前已确认需求的任务，状态由人工维护。':'历史任务仅供核对，不计入当前需求进度。'}</p></div><label>任务来源版本<select aria-label="任务来源需求版本" value={taskVersion} onChange={event=>setTaskVersion(event.target.value)}><option value="current">当前需求 V{latestConfirmed?.version??'—'}</option>{requirements.filter(row=>row.status==='confirmed'&&row.id!==latestConfirmed?.id).map(row=><option value={row.id} key={row.id}>历史需求 V{row.version}（只读）</option>)}<option value="all">全部任务（只读，含来源待核对）</option></select></label></div><TaskBoard tasks={visibleTasks} busy={busy||taskVersion!=='current'} onChange={(id,status)=>void updateTask(id,status)}/></section>
    </>}
  </section>;
}
export {GrowthWorkspace as Growth} from './components/GrowthWorkspace';
