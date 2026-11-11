import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { MarkdownEditor, ModuleGuide, RichContent } from './ContentView';
import { useEditGuard, useUnsavedEdit } from './EditGuard';
import { RequestScope } from './request-scope';
import { DocumentRevisionHistory } from './DocumentRevisionHistory';
import './document-workspace.css';
import { documentEvidence, type EvidenceSnapshot } from './evidence-state';
import { materialSourceLabel } from './material-source';

type Api = <T>(path: string, options?: RequestInit) => Promise<T>;
const types = { readme: 'README', requirements: '需求分析文档', design: '软件设计文档', api: 'API 说明文档', test_report: '测试报告', summary: '项目总结' } as const;
type DocType = keyof typeof types;
type Doc = { id: string; type: DocType; content: string; modelName: string; revision: number; createdAt: string; requirementVersionId: string; sourceSnapshot?:EvidenceSnapshot|null };
type CataloguePage={total:number;limit:number;hasMore:boolean;nextCursor:string|null};
type Props = { request: Api; projectId: string; requirements: { id: string; version: number; status: string }[] };
const errorText = (error: unknown) => error instanceof Error ? error.message : '操作失败，请重试。';

export function DocumentWorkspace({ request, projectId, requirements }: Props) {
  const base = '/projects/' + encodeURIComponent(projectId) + '/documents';
  const [docs, setDocs] = useState<Doc[]>([]), [selected, setSelected] = useState<Doc | null>(null), [content, setContent] = useState('');
  const [type, setType] = useState<DocType>('readme'), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState<'saving' | 'generating' | 'exporting' | null>(null);
  const [conflicted, setConflicted] = useState(false), [remote, setRemote] = useState<Doc | null>(null), [checking, setChecking] = useState(false);
  const [evidence,setEvidence]=useState<EvidenceSnapshot|null>(null);
  const [catalogue,setCatalogue]=useState<CataloguePage|null>(null),[catalogueStale,setCatalogueStale]=useState(false),[pageIndex,setPageIndex]=useState(0);
  const pageCursors=useRef<(string|null)[]>([null]);
  const active = useRef(true), savePending = useRef<Promise<boolean> | null>(null), working = useRef(false);
  const reads = useRef(new RequestScope()), conflictReads = useRef(new RequestScope());
  const selection = useRef(0), editor = useRef({ selected, content });
  editor.current = { selected, content };
  const { protect } = useEditGuard();
  const req = requirements.filter(row => row.status === 'confirmed').sort((a, b) => b.version - a.version)[0];
  const dirty = Boolean(selected && content !== selected.content);

  const choose = useCallback((doc: Doc | null) => {
    selection.current++; conflictReads.current.cancel();
    editor.current = { selected: doc, content: doc?.content || '' };
    setSelected(doc); setContent(doc?.content || ''); setNotice(''); setError(''); setRemote(null); setConflicted(false); setChecking(false);
  }, []);
  const edit = (value: string) => { editor.current.content = value; setContent(value); setNotice(''); };
  const load = useCallback(async (cursor:string|null=null,index=0) => {
    const ticket = reads.current.begin(base);
    setLoading(true);
    try {
      const data = await request<{ documents: Doc[]; evidence?:EvidenceSnapshot|null;page:CataloguePage }>(`${base}?limit=20${cursor?`&cursor=${encodeURIComponent(cursor)}`:''}`, { signal: ticket.signal });
      if (!active.current || !reads.current.accepts(ticket, base)) return;
      if(!data.page||!Number.isSafeInteger(data.page.total)||data.page.total<data.documents.length)throw new Error('文档目录分页信息暂不可用，已保留编辑内容；请核对前后端版本后重试。');
      setDocs(data.documents);
      setEvidence(data.evidence??null);
      setCatalogue(data.page);setCatalogueStale(false);setPageIndex(index);pageCursors.current=index===0?[null]:[...pageCursors.current.slice(0,index),cursor];
      choose(data.documents.find(row => row.id === editor.current.selected?.id) || data.documents[0] || null);
    } catch (error) { if (active.current && reads.current.accepts(ticket, base)){setError(errorText(error));setCatalogueStale(true);} }
    finally { if (active.current && reads.current.accepts(ticket, base)) setLoading(false); }
  }, [base, request, choose]);
  useEffect(() => {
    active.current = true; void load();
    return () => { active.current = false; reads.current.cancel(); conflictReads.current.cancel(); };
  }, [load]);

  function persist(): Promise<boolean> {
    if (savePending.current) return savePending.current;
    const current = editor.current;
    if (!current.selected || !current.content.trim() || working.current || loading) return Promise.resolve(false);
    if (current.content === current.selected.content) return Promise.resolve(true);
    const target = current.selected.id, revision = current.selected.revision, snapshot = current.content, epoch = selection.current;
    working.current = true; setBusy('saving'); setError(''); setNotice('');
    const pending = (async () => {
      try {
        const result = await request<{ document: Doc; evidence?:EvidenceSnapshot|null }>(base + '/' + target, { method: 'PATCH', body: JSON.stringify({ content: snapshot, expectedRevision: revision }) });
        if (!active.current) return false;
        if (result.document.id !== target || result.document.revision < revision) throw new Error('返回文档归属或修订不一致，已保留编辑内容。');
        setDocs(rows => rows.map(row => row.id === target ? result.document : row));
        setCatalogueStale(true);
        setEvidence(result.evidence??null);
        // A late save may update the list, but never the selection or a newer draft.
        if (selection.current !== epoch || editor.current.selected?.id !== target) return false;
        const unchanged = editor.current.content === snapshot;
        editor.current = { selected: result.document, content: unchanged ? result.document.content : editor.current.content };
        setSelected(result.document); setContent(editor.current.content); setRemote(null); setConflicted(false);
        setNotice(unchanged ? '已保存修订 ' + result.document.revision + '。' : '已保存修订 ' + result.document.revision + '；保存期间的新输入仍未保存，请再次保存。');
        return unchanged;
      } catch (error) {
        if (active.current && selection.current === epoch) {
          setError(errorText(error)); setConflicted((error as { code?: string }).code === 'document_conflict');
        }
        return false;
      } finally { working.current = false; savePending.current = null; if (active.current) setBusy(null); }
    })();
    savePending.current = pending; return pending;
  }
  useUnsavedEdit('document:' + projectId, { label: '项目文档', dirty, save: persist });

  async function inspectRemote() {
    if (!selected) return;
    const target = selected.id, epoch = selection.current, ticket = conflictReads.current.begin(target);
    setChecking(true);
    try {
      const response = await request<{ document: Doc; evidence?:EvidenceSnapshot|null }>(base + '/' + target, { signal: ticket.signal });
      if (active.current && selection.current === epoch && conflictReads.current.accepts(ticket, target)) {
        if (response.document.id !== target) throw new Error('服务器文档归属不一致，已保留草稿。');
        setRemote(response.document);
        setEvidence(response.evidence??null);
      }
    } catch (error) { if (active.current && conflictReads.current.accepts(ticket, target)) setError(errorText(error)); }
    finally { if (active.current && conflictReads.current.accepts(ticket, target)) setChecking(false); }
  }
  async function generate() {
    if (working.current || loading) return;
    working.current = true; setBusy('generating'); setError(''); setNotice('');
    try {
      const response = await request<{ document: Doc; evidence?:EvidenceSnapshot|null }>(base + '/generate', { method: 'POST', body: JSON.stringify({ type }) });
      if (active.current) { setDocs(rows => [response.document, ...rows].slice(0,20));setCatalogueStale(true); setEvidence(response.evidence??null);choose(response.document); setNotice('已生成草稿，请核实并编辑。'); }
    } catch (error) { if (active.current) setError(errorText(error)); }
    finally { working.current = false; if (active.current) setBusy(null); }
  }
  async function download() {
    if (!selected || working.current) return;
    working.current = true; setBusy('exporting'); setError('');
    try {
      const response = await fetch('/api' + base + '/' + encodeURIComponent(selected.id) + '/export', { headers: { Authorization: 'Bearer ' + (localStorage.getItem('gongxu_token') || '') } });
      if (!response.ok) throw new Error('导出失败（' + response.status + '），请检查登录状态。');
      const blob = await response.blob(); if (!active.current) return;
      const url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = url; a.download = selected.type + '-' + selected.id + '.md'; a.click(); URL.revokeObjectURL(url);
    } catch (error) { if (active.current) setError(errorText(error)); }
    finally { working.current = false; if (active.current) setBusy(null); }
  }
  async function save(event: FormEvent) { event.preventDefault(); await persist(); }

  return <section className="module-page module-page--documents">
    <div className="section-heading compact"><div><div className="eyebrow">PROJECT DOCUMENTS</div><h2>将实践沉淀为项目文档</h2><p>依据已确认需求、任务与人工测试记录生成草稿。缺失信息须人工核实，单次生成需求限 20000 字符。</p><details className="muted-text"><summary>资料完整性与生成边界</summary><p>任务与测试各最多 50 条，完整结构化明细最多 30000 字符。保留实际标识、完整步骤和执行说明；超过边界时明确阻止，不丢弃末尾限制。来源及结果仍须人工审核。</p></details></div></div>
    {!req && <div className="alert error">请先确认需求版本。</div>}
    {error && <div className="alert error" role="alert">{error}</div>}
    {notice && <div className="alert success" role="status">{notice}</div>}
    <div className="module-grid"><div>
      <section className="editor-panel"><h3>生成文档草稿</h3><label htmlFor="doc-type">文档类型</label><select id="doc-type" value={type} disabled={busy === 'generating'} onChange={event => setType(event.target.value as DocType)}>{Object.entries(types).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><div className="form-actions"><button type="button" className="button primary" onClick={() => protect(() => void generate())} disabled={Boolean(busy) || loading || !req}>{busy === 'generating' ? '正在生成草稿…' : '生成草稿'} <span>✦</span></button></div></section>
      <section className="editor-panel"><div className="panel-heading"><h3>已保存文档</h3><button type="button" className="text-link" disabled={Boolean(busy)} onClick={() => protect(() => void load())}>刷新文档</button></div>
        <div className="document-catalogue-toolbar" role="group" aria-label="文档目录分页"><p role="status">{loading?'正在读取目录…':catalogueStale?'目录已有变化或读取未完成，请刷新后分页':catalogue?`读取时共 ${catalogue.total} 份 · 第 ${pageIndex+1} 页 · 本页 ${docs.length} 份`:'目录暂不可用'}</p><div><button className="button secondary" type="button" disabled={loading||Boolean(busy)||catalogueStale||pageIndex===0} onClick={()=>protect(()=>void load(pageCursors.current[pageIndex-1],pageIndex-1))}>上一页文档</button><button className="button secondary" type="button" disabled={loading||Boolean(busy)||catalogueStale||!catalogue?.nextCursor} onClick={()=>protect(()=>void load(catalogue!.nextCursor,pageIndex+1))}>下一页文档</button></div><p className="muted-text">按创建时间分页，每页最多20份。刷新从第一页读取，修改与导出仍保留原始版本。</p></div>
        {loading ? <p role="status">正在读取文档，完成后可继续编辑…</p> : docs.length ? <ul className="module-list">{docs.map(doc => <li key={doc.id}><button type="button" className="run-link" aria-pressed={selected?.id === doc.id} disabled={busy === 'generating'} onClick={() => { if (selected?.id !== doc.id) protect(() => choose(doc)); }}><strong>{types[doc.type]}</strong><small>{new Date(doc.createdAt).toLocaleString('zh-CN')} · {materialSourceLabel(doc.modelName)} · 来源 v{requirements.find(row => row.id === doc.requirementVersionId)?.version ?? '未知'} · 修订 {doc.revision}</small></button></li>)}</ul> : <p>暂无文档。确认项目需求后可生成第一份草稿。</p>}
      </section>
    </div>
      {selected ? <div className="document-editor-column"><form className="editor-panel" onSubmit={save} aria-busy={loading || busy === 'generating'}>
        <div className="panel-heading"><div><h3>{types[selected.type]}</h3><p>来源需求 v{requirements.find(row => row.id === selected.requirementVersionId)?.version ?? '未找到'} · 修订 {selected.revision} · {selected.requirementVersionId !== req?.id ? '历史需求，须复核' : '当前已确认需求'} · {dirty ? '有未保存编辑' : '已保存'}</p></div></div>
        <div className="document-source-state" data-state={documentEvidence(selected,evidence).status} role="status"><strong>{documentEvidence(selected,evidence).label}</strong><p>{selected.sourceSnapshot?`生成依据读取于 ${new Date(selected.sourceSnapshot.capturedAt).toLocaleString('zh-CN')}。来源变化不会自动改写文档，也不代表所有段落失效。`:'此前文档没有生成依据快照，不能从创建日期推定资料仍然有效。'} 刷新文档可重新检查。</p></div>
        {conflicted && <div className="document-conflict" role="group" aria-label="文档保存冲突"><p>另一处编辑已更新此文档。你的输入仍在下方；核对服务器版本后，再决定如何合并。</p><button className="button secondary" type="button" disabled={checking} onClick={() => void inspectRemote()}>{checking ? '正在读取最新修订…' : '查看服务器版本'}</button>
          {remote && <><div className="document-remote" tabIndex={0} role="region" aria-label={'服务器修订 ' + remote.revision}><strong>服务器修订 {remote.revision}（只读）</strong><RichContent value={remote.content} /></div><div className="form-actions"><button type="button" className="button secondary" onClick={() => protect(() => choose(remote))}>使用服务器版本</button><button type="button" className="button secondary" onClick={() => { editor.current.selected = remote; setSelected(remote); setDocs(rows => rows.map(row => row.id === remote.id ? remote : row)); setConflicted(false); setRemote(null); setError(''); setNotice('已选择服务器最新修订作为保存依据，编辑区内容保留。请合并核对后再次保存。'); }}>保留我的内容继续合并</button></div></>}
        </div>}
        <label className="sr-only" htmlFor="doc-content">文档内容</label><MarkdownEditor id="doc-content" value={content} onChange={edit} required maxLength={50000} disabled={loading || busy === 'generating'} />
        <div className="form-actions"><span className="muted-text" role="status">{busy === 'saving' ? '正在保存当前快照，可继续输入' : dirty?'有修改待保存':'当前修订已保存'}</span><button type="button" className="button secondary" onClick={() => void download()} disabled={Boolean(busy) || loading || dirty}>导出 Markdown</button><button className="button primary" disabled={Boolean(busy) || loading || conflicted || !content.trim() || !dirty}>{busy === 'saving' ? '正在保存…' : '保存文档'} <span>↗</span></button></div>
      </form><DocumentRevisionHistory key={selected.id} request={request} base={base + '/' + selected.id} revision={selected.revision} disabled={Boolean(busy) || loading} onRestore={value => protect(() => { edit(value); setNotice('历史文本已放入编辑区，尚未保存；原修订记录会保留。'); })} /></div> : !loading && <ModuleGuide kind="document" />}
    </div>
  </section>;
}
