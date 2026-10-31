import { EmbeddingActivity } from './components/EmbeddingActivity';
import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { RichContent, CopyButton, ModuleGuide } from './components/ContentView';
import { AgentProgress, TaskBoard, SourceCollection, TaskDistribution } from './components/EvidenceViews';
import { PlanMap } from './components/PlanMap';
import { FileDropZone } from './components/FileDropZone';

type Api = <T>(path: string, options?: RequestInit) => Promise<T>;
type Document = { id: string; name: string; status: string; createdAt: string };
type Hit = { id: string; document_name: string; page: number | null; content: string; distance: number };
const errorMessage = (error: unknown) => error instanceof Error ? error.message : '操作失败，请重试。';
const date = (value: string) => new Date(value).toLocaleString('zh-CN');

export function Knowledge({ request }: { request: Api }) {
  const [docs, setDocs] = useState<Document[]>([]); const [configured, setConfigured] = useState(false); const [pdfAvailable, setPdfAvailable] = useState(false); const [pdfData, setPdfData] = useState(''); const [fileKey, setFileKey] = useState(0);
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [name, setName] = useState(''); const [text, setText] = useState(''); const [query, setQuery] = useState(''); const [hits, setHits] = useState<Hit[] | null>(null); const [answer, setAnswer] = useState<string | null>(null); const [answerAsked, setAnswerAsked] = useState(false);
  const load = useCallback(async () => { setLoading(true); setError(''); try { const data = await request<{documents: Document[]; embeddingConfigured: boolean; pdfAvailable: boolean}>('/knowledge'); setDocs(data.documents); setConfigured(data.embeddingConfigured); setPdfAvailable(data.pdfAvailable); } catch (e) { setError(errorMessage(e)); } finally { setLoading(false); } }, [request]);
  useEffect(() => { void load(); }, [load]);
  async function upload(event: FormEvent) { event.preventDefault(); setBusy(true); setError(''); setNotice(''); try { const result = pdfData ? await request<{chunks: number}>('/knowledge/pdf', {method: 'POST', body: JSON.stringify({name: name.trim(), data: pdfData})}) : await request<{chunks: number}>('/knowledge/text', {method: 'POST', body: JSON.stringify({name: name.trim(), text: text.trim()})}); await load(); setName(''); setText(''); setPdfData(''); setFileKey(k => k + 1); setNotice(`文档已保存并分成 ${result.chunks} 个文本片段，等待建立向量索引。`); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); } }
  async function indexDocument(id:string) { setBusy(true); setError(''); setNotice(''); try { const result = await request<{chunks:number}>(`/knowledge/${encodeURIComponent(id)}/index`, {method:'POST'}); await load(); setNotice(`向量索引已建立，共 ${result.chunks} 个片段。`); } catch(e) { setError(errorMessage(e)); } finally { setBusy(false); } }
  async function search(event: FormEvent) { event.preventDefault(); setBusy(true); setError(''); setHits(null); setAnswer(null); setAnswerAsked(false); try { const result = await request<{hits: Hit[]}>('/knowledge/search', {method: 'POST', body: JSON.stringify({query: query.trim()})}); setHits(result.hits); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); } }
  async function ask() { if (!query.trim()) return; setBusy(true); setError(''); setHits(null); setAnswer(null); setAnswerAsked(false); try { const result = await request<{answer:string | null;sources:Hit[]}>( '/knowledge/answer', {method:'POST',body:JSON.stringify({query:query.trim()})}); setAnswer(result.answer); setAnswerAsked(true); setHits(result.sources); } catch(e) { setError(errorMessage(e)); } finally { setBusy(false); } }
  async function readFile(file?: File) {
    if (!file) return; setError(''); setPdfData(''); setText(''); setName('');
    if (/\.pdf$/i.test(file.name)) {
      if (!pdfAvailable) { setError('PDF 解析器不可用，请检查服务端配置；仍可上传文本资料。'); return; }
      if (file.size > 3 * 1024 * 1024) { setError('PDF 文件不能超过 3 MB。'); return; }
      try { const data = await new Promise<string>((resolve,reject) => { const reader = new FileReader(); reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result.split(',')[1] || '') : reject(new Error('读取失败')); reader.onerror = () => reject(new Error('读取失败')); reader.readAsDataURL(file); }); if (!data) throw new Error('文件为空'); setPdfData(data); setName(file.name); }
      catch { setError('读取 PDF 文件失败，请重试。'); } return;
    }
    if (!/\.(txt|md)$/i.test(file.name)) { setError('请选择 PDF、TXT 或 Markdown 文件。'); return; }
    if (file.size > 800000) { setError('文本文件过大，请使用不超过 800 KB 的文件。'); return; }
    try { const content = await file.text(); if (content.length > 200000) { setError('文档不能超过 200000 字符。'); return; } setName(file.name); setText(content); } catch { setError('读取文件失败，请重试。'); }
  }
  return <section className="module-page"><div className="detail-heading"><div><div className="eyebrow">KNOWLEDGE / RETRIEVAL</div><h2>让知识成为实践的依据</h2><p>导入软件工程资料，通过真实语义检索查看原始片段与来源。</p></div><span className="status-pill">{loading ? '检查中' : configured ? '向量服务已配置' : '向量服务未配置'}</span></div>
    {error && <div className="alert error" role="alert">{error}<button type="button" onClick={() => void load()}>重新检查</button></div>}{notice && <div className="alert success" role="status">{notice}</div>}
    <EmbeddingActivity request={request} active={busy}/>{loading ? <div className="state-block">正在读取知识库…</div> : <div className="module-grid"><div><form className="editor-panel" onSubmit={upload}><div className="panel-heading"><div><h3>添加知识资料</h3><p>支持 PDF、TXT、Markdown 或粘贴文本。扫描件暂不支持 OCR。</p></div></div><label htmlFor="knowledge-file">选择文件</label><FileDropZone key={fileKey} id="knowledge-file" onFile={file=>void readFile(file)}/><p className="muted-text">{pdfAvailable ? 'PDF 文本解析器可用' : 'PDF 解析器不可用，仍可保存文本资料'}。</p><label htmlFor="knowledge-name">文档名称</label><input id="knowledge-name" value={name} onChange={e => setName(e.target.value)} required maxLength={160} placeholder="例如：软件需求分析指南"/>{pdfData ? <p className="muted-text">已选择 PDF；提交后将在服务端提取文本并分块。</p> : <><label htmlFor="knowledge-content">文档内容</label><textarea id="knowledge-content" rows={8} value={text} onChange={e => setText(e.target.value)} required maxLength={200000} placeholder="在这里粘贴文本内容…"/></>}<div className="form-actions"><span className="muted-text">{pdfData ? 'PDF 文件已就绪' : `${text.length} / 200000 字符`}</span><button className="button primary" type="submit" disabled={busy || !name.trim() || (!pdfData && !text.trim())}>{busy ? '处理中…' : '保存并分块'} <span>↗</span></button></div></form><section className="editor-panel"><div className="panel-heading"><div><h3>我的知识资料</h3><p>仅展示当前账号下的文档。文本可先保存并分块，配置向量服务后再建立索引。</p></div></div>{docs.length ? <ul className="module-list">{docs.map(doc => <li key={doc.id}><span><strong>{doc.name}</strong><small>{date(doc.createdAt)}</small></span><span className="document-actions"><span className="small-tag">{doc.status === 'ready' ? '可检索' : doc.status === 'failed' ? '索引失败' : doc.status === 'awaiting_embedding' ? '待向量化' : '处理中'}</span>{(doc.status === 'awaiting_embedding' || doc.status === 'failed') && <button type="button" className="button secondary" disabled={busy || !configured} onClick={() => void indexDocument(doc.id)} title={!configured ? '请先配置向量服务' : '为此文档建立向量索引'}>{busy ? '处理中…' : doc.status === 'failed' ? '重试索引' : '建立索引'}</button>}</span></li>)}</ul> : <p className="muted-text">暂无文档，添加资料后可进行检索。</p>}</section></div><div><form className="editor-panel" onSubmit={search}><div className="panel-heading"><div><h3>语义检索</h3><p>查找相关片段，来源可供核对。检索不等于事实验证。</p></div></div><label className="sr-only" htmlFor="knowledge-query">检索问题</label><textarea id="knowledge-query" value={query} onChange={e => setQuery(e.target.value)} maxLength={4000} rows={4} required placeholder="输入你要查找的工程问题…"/><div className="form-actions"><button className="button secondary" type="button" onClick={() => void ask()} disabled={busy || !configured || !query.trim()}>知识增强回答 <span>✦</span></button><button className="button primary" type="submit" disabled={busy || !configured || !query.trim()}>{busy ? '处理中…' : '检索知识'} <span>↗</span></button></div></form>{answerAsked && <section className="editor-panel"><h3>知识增强回答</h3><RichContent value={answer ?? '未找到足够相关的资料，无法给出基于知识库的回答。'}/>{answer && <CopyButton value={answer}/>}<p className="muted-text">引用仅表明来源存在，请人工核对原文是否支持结论。</p></section>}{!hits && !answerAsked && !busy && <ModuleGuide kind="knowledge"/>}{hits && <section className="editor-panel"><h3>检索来源</h3>{hits.length ? <SourceCollection hits={hits}/> : <p className="muted-text">未找到满足条件的相关片段，请更换问题或补充资料。</p>}</section>}</div></div>}
  </section>;
}

type Requirement = { id:string; version:number; status:string };
type TaskPlan = {key:string;stage:string;title:string;description:string;deliverable:string;dependsOn:string[];citations:string[]};
type Run = {id:string;requirementVersionId:string;status:string;plan:{tasks:TaskPlan[]} | null;errorCode:string|null;createdAt:string};
type Tool = {id:string;toolName:string;status:string;inputSummary:string;outputSummary:string};
type Step = {id:string;stage:string;status:string;outputSummary:string;tools:Tool[]};
type RunDetail = {run:Run; steps:Step[]};
type Task = {id:string;title:string;stage:string;description:string;deliverable:string;status:string;dependsOn:string[]};
const statuses: Record<string,string> = {running:'运行中',succeeded:'成功',failed:'失败',skipped:'已跳过',awaiting_review:'待审核',confirmed:'已确认',pending:'待开始',todo:'待开始',doing:'进行中',review:'待审核',done:'已完成',blocked:'阻塞'};
const stages: Record<string,string> = {knowledge_search:'知识检索',plan_1:'计划生成（第 1 次）',plan_2:'计划生成（第 2 次）',validate_1:'计划校验（第 1 次）',validate_2:'计划校验（第 2 次）',validate_plan:'计划校验'};
export function Agent({ request, projectId, requirements }: {request:Api;projectId:string;requirements:Requirement[]}) {
  const [runs,setRuns] = useState<Run[]>([]); const [selected,setSelected] = useState<RunDetail | null>(null); const [tasks,setTasks] = useState<Task[]>([]);
  const [planning,setPlanning] = useState(false);
  const [loading,setLoading] = useState(true); const [busy,setBusy] = useState(false); const [error,setError] = useState(''); const [notice,setNotice] = useState('');
  const base = `/projects/${encodeURIComponent(projectId)}`; const latestConfirmed = requirements.find(r => r.status === 'confirmed');
  const refresh = useCallback(async () => { setLoading(true); try { const [history,taskData] = await Promise.all([request<{runs:Run[]}>(`${base}/agent/runs`),request<{tasks:Task[]}>(`${base}/tasks`)]); setRuns(history.runs); setTasks(taskData.tasks); if (history.runs[0]) setSelected(await request<RunDetail>(`${base}/agent/runs/${encodeURIComponent(history.runs[0].id)}`)); else setSelected(null); } catch (e) { setError(errorMessage(e)); } finally { setLoading(false); } }, [base,request]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!planning && selected?.run.status !== 'running') return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function poll() {
      try {
        const history = await request<{runs:Run[]}>(`${base}/agent/runs`, { signal: controller.signal });
        const id = planning ? history.runs[0]?.id : selected?.run.id;
        const detail = id ? await request<RunDetail>(`${base}/agent/runs/${encodeURIComponent(id)}`, { signal: controller.signal }) : null;
        if (active) { setRuns(history.runs); if (detail) setSelected(detail); }
      } catch (error) { if (active) setError(errorMessage(error)); }
      finally { if (active) timer = setTimeout(() => void poll(), 1500); }
    }
    void poll();
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [planning, selected?.run.id, selected?.run.status, base, request]);
  async function selectRun(id:string) { setError(''); try { setSelected(await request<RunDetail>(`${base}/agent/runs/${encodeURIComponent(id)}`)); } catch (e) { setError(errorMessage(e)); } }
  async function start() { if (!latestConfirmed) return; setBusy(true); setPlanning(true); setError(''); setNotice(''); try { const result = await request<RunDetail>(`${base}/agent/runs`, {method:'POST',body:JSON.stringify({requirementId:latestConfirmed.id})}); await refresh(); setSelected(result); setNotice('规划已生成，请审阅任务及实际工具记录。'); } catch (e) { await refresh(); setError(errorMessage(e)); } finally { setBusy(false); setPlanning(false); } }
  async function updateTask(id:string,status:string) { setBusy(true); setError(''); try { await request(`${base}/tasks/${encodeURIComponent(id)}`, {method:'PATCH',body:JSON.stringify({status})}); setTasks(prev=>prev.map(task=>task.id===id?{...task,status}:task)); } catch(e) { setError(errorMessage(e)); } finally { setBusy(false); } }
  async function confirm() { if (!selected) return; setBusy(true); setError(''); setNotice(''); try { await request(`${base}/agent/runs/${encodeURIComponent(selected.run.id)}/confirm`,{method:'POST'}); await refresh(); setNotice('计划已确认，任务已保存。'); } catch(e) { setError(errorMessage(e)); } finally { setBusy(false); } }
  return <section className="module-page module-page--agent">
    <div className="section-heading compact"><div><div className="eyebrow">AGENT / PLANNING</div><h2>让计划有依据，也能被检查</h2><p>使用已确认的需求，检索知识并生成任务计划。所有步骤和工具调用来自实际运行。</p></div><button type="button" className="button primary" onClick={() => void start()} disabled={busy || !latestConfirmed}>{busy ? '执行中…' : '开始规划'} <span>↗</span></button></div>
    {!latestConfirmed && <div className="alert error">请先在需求分析页面确认一个需求版本。</div>}
    {error && <div className="alert error" role="alert">{error}<button type="button" onClick={() => void refresh()}>刷新记录</button></div>}
    {notice && <div className="alert success" role="status">{notice}</div>}
    {!loading && selected && <AgentProgress run={selected.run} steps={selected.steps}/>}
    {loading ? <div className="state-block">正在读取运行记录…</div> : <>
      <div className="agent-audit-grid">
        <section className="editor-panel"><div className="panel-heading"><div><h3>运行记录</h3><p>选择记录查看执行过程与结果。</p></div></div>
          {runs.length ? <ul className="module-list">{runs.map(run => <li key={run.id}><button type="button" className="run-link" aria-pressed={selected?.run.id === run.id} data-status={run.status} onClick={() => void selectRun(run.id)}><strong>{date(run.createdAt)}</strong><small>{run.id.slice(0,8)} · {statuses[run.status] || run.status}</small></button></li>)}</ul> : <p className="muted-text">还没有运行记录。先确认需求，再开始规划。</p>}
        </section>
        {selected ? <section className="editor-panel"><div className="panel-heading"><div><h3>执行过程</h3><p>状态：{statuses[selected.run.status] || selected.run.status}{selected.run.errorCode ? ` · ${selected.run.errorCode}` : ''}</p></div></div>
          {selected.steps.length ? <div className="steps-list">{selected.steps.map(step => <article key={step.id} data-status={step.status}><strong>{stages[step.stage] || step.stage} · {statuses[step.status] || step.status}</strong><p>{step.outputSummary}</p>{step.tools.map(tool => <details key={tool.id}><summary>工具：{stages[tool.toolName] || tool.toolName} · {statuses[tool.status] || tool.status}</summary><pre>输入：{tool.inputSummary}{'\n'}输出：{tool.outputSummary}</pre></details>)}</article>)}</div> : <p className="muted-text">暂无步骤记录。</p>}
        </section> : <ModuleGuide kind="agent"/>}
      </div>
      {selected?.run.plan && <details className="editor-panel agent-plan-panel" key={`${selected.run.id}-${selected.run.status}`} open={selected.run.status !== 'confirmed'}>
        <summary><span><h3>{selected.run.status === 'confirmed' ? '已确认计划' : '待审阅计划'}</h3><span>{selected.run.plan.tasks.length} 项任务 · 核对任务、依赖及来源后再确认</span></span><span className="plan-disclosure-mark">⌄</span></summary>
        <PlanMap tasks={selected.run.plan.tasks} key={selected.run.id}/>
        {selected.run.status === 'awaiting_review' && <div className="form-actions"><button type="button" className="button primary" onClick={() => void confirm()} disabled={busy}>确认计划并创建任务 <span>✓</span></button></div>}
      </details>}
      <section className="editor-panel confirmed-task-panel"><div className="panel-heading"><div><h3>已确认的项目任务</h3><p>展示本项目已入库任务，可在列表或看板中更新状态。</p></div></div><TaskBoard tasks={tasks} busy={busy} onChange={(id,status)=>void updateTask(id,status)}/></section>
    </>}
  </section>;
}
type GrowthData = {counts:{projects:number;confirmedRequirements:number;tasks:{total:number;todo:number;doing:number;review:number;done:number;blocked:number};codeReviews:number;syntaxFindings:number;testCases:number;testExecutions:{total:number;passed:number;failed:number;blocked:number}};events:{type:string;projectId:string;projectName:string;title:string;at:string}[];recommendations:{code:string;text:string;evidence:string}[];disclaimer:string};
const eventNames:Record<string,string>={project_created:'创建项目',requirement_confirmed:'确认需求',task_status_changed:'更新任务',code_reviewed:'代码审查',test_recorded:'记录测试'};
export function Growth({request,navigate}:{request:Api;navigate:(path:string)=>void}){
 const [data,setData]=useState<GrowthData|null>(null);const [loading,setLoading]=useState(true);const [error,setError]=useState('');
 const load=useCallback(async()=>{setLoading(true);setError('');try{setData(await request<GrowthData>('/growth'))}catch(e){setError(errorMessage(e))}finally{setLoading(false)}},[request]);useEffect(()=>{void load()},[load]);
 const stats=data?[['实训项目',data.counts.projects],['已确认需求',data.counts.confirmedRequirements],['已完成任务',data.counts.tasks.done],['代码审查',data.counts.codeReviews]] as const:[];
 return <section className="module-page"><div className="detail-heading"><div><div className="eyebrow">LEARNING / ACTIVITY</div><h2>看见每一次真实实践</h2><p>根据当前账号的项目、任务、审查与人工测试记录汇总。</p></div></div>{error&&<div className="alert error" role="alert">{error}<button type="button" onClick={()=>void load()}>重试</button></div>}{loading?<div className="state-block">正在汇总真实操作记录…</div>:data&&<><p className="growth-disclaimer">{data.disclaimer}</p><div className="growth-stats">{stats.map(([label,value])=><div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div><div className="module-grid"><div><section className="editor-panel"><div className="panel-heading"><div><h3>任务进度</h3><p>共 {data.counts.tasks.total} 项，以当前状态为准。</p></div></div><TaskDistribution counts={data.counts.tasks}/><div className="growth-breakdown">{([['待开始',data.counts.tasks.todo],['进行中',data.counts.tasks.doing],['待审核',data.counts.tasks.review],['已完成',data.counts.tasks.done],['阻塞',data.counts.tasks.blocked]] as const).map(([label,value])=><div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div></section><section className="editor-panel"><h3>审查与测试记录</h3><ul className="growth-facts"><li><span>历史语法诊断</span><strong>{data.counts.syntaxFindings} 条</strong></li><li><span>测试用例</span><strong>{data.counts.testCases} 条</strong></li><li><span>当前有人工执行结果</span><strong>{data.counts.testExecutions.total} 条</strong></li><li><span>通过 / 失败 / 阻塞</span><strong>{data.counts.testExecutions.passed} / {data.counts.testExecutions.failed} / {data.counts.testExecutions.blocked}</strong></li></ul></section><section className="editor-panel"><h3>下一步建议</h3>{data.recommendations.length?data.recommendations.map(item=><div className="recommendation" key={item.code}><strong>{item.text}</strong><p>{item.evidence}</p></div>):<p className="muted-text">暂无基于现有记录的建议。完成实训后再来查看。</p>}</section></div><section className="editor-panel"><div className="panel-heading"><div><h3>最近活动</h3><p>最多展示最近 30 条真实操作记录。</p></div></div>{data.events.length?<ul className="activity-list">{data.events.map((event,i)=><li key={`${event.type}-${event.projectId}-${event.at}-${i}`}><span className="activity-dot"/><div><strong>{eventNames[event.type]||'项目活动'}</strong><p>{event.title}</p><button type="button" className="text-link" onClick={()=>navigate(`/projects/${event.projectId}`)}>{event.projectName} →</button><time>{date(event.at)}</time></div></li>)}</ul>:<p className="muted-text">暂无活动。创建项目后，操作记录会显示在这里。</p>}</section></div></>}</section>;
}
