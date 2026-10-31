import { lazy, Suspense, useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { RequestScope } from './components/request-scope';
import { EditGuardProvider, useEditGuard, useUnsavedEdit } from './components/EditGuard';
import { useGuardedRoute } from './components/useGuardedRoute';
const Agent = lazy(() => import('./Modules').then(m => ({ default: m.Agent })));
const Knowledge = lazy(() => import('./Modules').then(m => ({ default: m.Knowledge })));
const Growth = lazy(() => import('./Modules').then(m => ({ default: m.Growth })));
const CodeReview = lazy(() => import('./Practice').then(m => ({ default: m.CodeReview })));
const Tests = lazy(() => import('./Practice').then(m => ({ default: m.Tests })));
const Documents = lazy(() => import('./Practice').then(m => ({ default: m.Documents })));
import { WorkspacePlanet } from './components/WorkspacePlanet';
import { WorkspaceTools, ProjectExplorer, ProjectNavigation } from './components/WorkspaceTools';
import { UiIcon, type IconName } from './components/UiIcon';
import { MarkdownEditor } from './components/ContentView';
import { DisplaySettings, QuickNavigation } from './components/WorkspaceChrome';
const ProjectPulse = lazy(() => import('./components/ProjectPulse').then(module => ({ default: module.ProjectPulse })));
const RequirementHistory = lazy(() => import('./components/RequirementHistory').then(module => ({ default: module.RequirementHistory })));
const RequirementTrace = lazy(() => import('./components/RequirementTrace').then(m => ({default:m.RequirementTrace})));
const WorkbenchPages = lazy(() => import('./pages/WorkbenchPages'));

type Project = { id: string; name: string; description: string; status: string; createdAt: string; updatedAt: string };
type Requirement = { id: string; version: number; content: unknown; status: string; createdAt: string };
type Detail = { project: Project; requirements: Requirement[] };
type Connection = 'checking' | 'online' | 'preparing' | 'offline';

function ConnectionStatus({ connection, onCheck }: { connection: Connection; onCheck: () => void }) {
  const labels: Record<Connection, string> = { checking: '检查服务中', online: '服务可使用', preparing: '数据服务准备中', offline: '服务未连接' };
  return <div className="connection" role="status" aria-live="polite"><span className={`connection-dot ${connection}`} />{labels[connection]}<button onClick={onCheck} disabled={connection === 'checking'} type="button" title="重新检查服务">↻</button></div>;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const session = localStorage.getItem('gongxu_token');
  let response: Response;
  try {
    response = await fetch(`/api${path}`, { ...options, headers: { ...(options?.body != null ? { 'Content-Type': 'application/json' } : {}), ...(session ? { Authorization: `Bearer ${session}` } : {}), ...options?.headers } });
  } catch (error) {
    if (options?.signal?.aborted) throw error;
    throw new Error('无法连接服务，请检查后端是否启动。');
  }
  const data: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && session && localStorage.getItem('gongxu_token') === session) { localStorage.removeItem('gongxu_token'); window.dispatchEvent(new Event('gongxu:expired')); }
    const result = data as { message?: string; error?: string };
    const codes: Record<string, string> = { database_not_configured: '数据库尚未配置，请先完成服务端数据库设置。', database_unavailable: '数据服务暂不可用，请稍后重试。', requirement_generation_limit: '需求已完整保存，但超过单次生成的 20000 字符边界；请拆分需求范围后重试。本次没有截断生成。', invalid_request: '请求内容不符合要求，请刷新页面后重试。', invalid_input: '输入不符合要求，请检查内容长度和格式。', invalid_credentials: '邮箱或密码不正确。', unauthorized: '登录已失效，请重新登录。', email_unavailable: '该邮箱已被使用。', too_many_attempts: '尝试次数过多，请稍后再试。', not_found: '项目不存在或无法访问。', not_found_or_confirmed: '该版本不存在或已经确认，请刷新后重试。', ai_not_configured: '服务端尚未配置 AI 模型。', ai_timeout: '模型请求超时，请稍后重试。', ai_output_truncated: '模型输出达到长度限制，尚未保存为完整结果。请缩小需求范围后重试。', ai_provider_error: '模型服务暂不可用，请检查服务端配置。', ai_auth_error: '模型服务鉴权失败，请检查本地服务端配置中的 API 密钥及访问权限。', ai_insufficient_balance: '模型服务余额不足，请检查服务账号余额。', ai_rate_limited: '模型请求过于频繁或超过服务额度，请稍后重试并检查服务额度。', pdf_no_text: 'PDF 中没有可提取的文本；扫描件暂不支持 OCR。', pdf_parser_unavailable: 'PDF 解析器不可用，请检查服务端配置。', invalid_pdf: 'PDF 文件无效或无法解析。', pdf_too_large: 'PDF 文件不能超过 3 MB。', pdf_too_many_pages: 'PDF 页数超过限制。', embedding_not_configured: '服务端尚未配置向量模型。', embedding_provider_error: '向量模型服务不可用，请检查服务端配置。', confirmed_requirement_required: '请先确认需求版本。', plan_validation_failed: '规划未通过校验，请查看运行记录。', requirement_version_outdated: '需求版本已更新，请重新规划。', run_not_awaiting_review: '该计划已处理，请刷新记录。', agent_rate_limited: '运行次数过多，请稍后再试。' };
    const queueCodes:Record<string,string>={trace_version_outdated:'需求版本已变化，请刷新追踪视图后重新审核。',case_revision_required:'请选择当前修订的用例再进行审核。',test_case_unknown_requirement:'模型关联了不存在的需求条目，未保存本次用例，请重试或检查需求。',embedding_queue_full:'向量服务等待队列已满，请稍后重试。',embedding_queue_timeout:'向量请求排队超时，已退出队列，请稍后重试。',embedding_timeout:'向量请求超过等待时间，已停止本次请求。',embedding_cancelled:'本次向量请求已取消。',embedding_busy:'向量服务仍忙，有限重试已结束，请稍后再试。',embedding_unavailable:'向量服务暂不可用，有限重试已结束。请检查服务后重试。',test_case_changed:'用例已被修改，请刷新后核对最新定义，再登记执行结果。'};
    const documentCodes:Record<string,string>={document_conflict:'文档已在另一处更新。当前输入已保留，请核对服务器版本后合并。',document_revision_required:'缺少文档修订号，已阻止覆盖。请保留输入并刷新文档。'};
    throw Object.assign(new Error((result.error && (codes[result.error]||queueCodes[result.error]||documentCodes[result.error])) || result.message || result.error || `请求失败（${response.status}）`),{code:result.error});
  }
  return data as T;
}

const workflow = ['需求分析', '任务规划', '知识检索', '代码审查', '测试设计', '项目交付'];
const nav = [
  { icon: 'dashboard', title: '项目工作台', route: '/dashboard' },
  { icon: 'projects', title: '我的项目', route: '/projects' },
  { icon: 'layers', title: '实训任务库', route: '/missions' },
  { icon: 'knowledge', title: '知识库', route: '/knowledge' },
  { icon: 'activity', title: '运行记录', route: '/runs' },
  { icon: 'delivery', title: '交付检查', route: '/delivery' },
  { icon: 'growth', title: '学习成长', route: '/growth' },
];

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' }).format(date);
}
function textContent(content: unknown) {
  if (typeof content === 'string') return content;
  if (content && typeof content === 'object' && 'text' in content && typeof content.text === 'string') return content.text;
  return JSON.stringify(content, null, 2);
}
function message(error: unknown) { return error instanceof Error ? error.message : '发生未知错误，请稍后重试。'; }

function Auth({ onAuthenticated, connection, onCheck }: { onAuthenticated: (token: string) => void; connection: Connection; onCheck: () => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [name, setName] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { const result = await request<{ token: string }>(`/auth/${mode}`, { method: 'POST', body: JSON.stringify({ email: email.trim(), password, ...(mode === 'register' ? { name: name.trim() } : {}) }) }); localStorage.setItem('gongxu_token', result.token); onAuthenticated(result.token); }
    catch (err) { setError(message(err)); } finally { setBusy(false); }
  }
  return <div className="auth-page"><div className="auth-intro"><a className="brand" href="/"><span className="brand-mark">工</span><span><strong>工序智伴</strong><small>GONGXU AI</small></span></a><div><div className="auth-kicker">SOFTWARE ENGINEERING · AI</div><h1>让每个想法，<br/>走完真正的开发流程。</h1><p>从需求到交付，在真实项目中练习软件工程。</p></div><small>AI 软件工程实训平台 · 工序智伴</small></div><div className="auth-main"><div className="auth-form"><div className="eyebrow">WELCOME TO GONGXU</div><h2>{mode === 'login' ? '欢迎回来' : '创建你的账号'}</h2><p>登录工作空间，继续你的项目实践。</p><ConnectionStatus connection={connection} onCheck={onCheck} />{connection === 'preparing' && <p role="status">数据服务暂未就绪，请稍后重新检查，再登录或注册。</p>}<div className="auth-tabs"><button type="button" className={mode === 'login' ? 'selected' : ''} onClick={() => { setMode('login'); setError(''); }}>登录</button><button type="button" className={mode === 'register' ? 'selected' : ''} onClick={() => { setMode('register'); setError(''); }}>注册</button></div>{error && <div className="alert error" role="alert">{error}</div>}<form onSubmit={submit}>{mode === 'register' && <><label htmlFor="auth-name">姓名</label><input id="auth-name" value={name} onChange={e => setName(e.target.value)} required maxLength={80} autoComplete="name" placeholder="你的名字"/></>}<label htmlFor="email">邮箱</label><input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" placeholder="you@example.com"/><label htmlFor="password">密码</label><input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={10} maxLength={128} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} placeholder="至少 10 位"/><button type="submit" className="button primary auth-submit" disabled={busy || connection !== 'online'}>{busy ? '处理中…' : mode === 'login' ? '登录工作空间' : '注册并进入'} <span>↗</span></button></form><p className="auth-help">项目数据与当前账号关联保存。请勿使用重要密码进行公开演示。</p></div></div></div>;
}

export default function App() { return <EditGuardProvider><Workspace /></EditGuardProvider>; }
function Workspace() {
  const [token, setToken] = useState(() => localStorage.getItem('gongxu_token') || '');
  useEffect(() => { const onExpired = () => setToken(''); window.addEventListener('gongxu:expired', onExpired); return () => window.removeEventListener('gongxu:expired', onExpired); }, []);
  const [connection, setConnection] = useState<Connection>('checking');
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  useEffect(() => {
    if (!showCreate) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.getElementById('create-title')?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'center' });
    document.getElementById('name')?.focus({ preventScroll: true });
    return () => { if (trigger?.isConnected) trigger.focus({ preventScroll: true }); };
  }, [showCreate]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState('');
  const [aiStatus, setAiStatus] = useState<'checking' | 'ready' | 'unconfigured' | 'unavailable'>('checking');
  const [aiModel, setAiModel] = useState('');
  const detailScope = useRef(new RequestScope());
  const projectScope = useRef(new RequestScope());
  const activeProject = useRef<string | undefined>(location.pathname.match(/^\/projects\/([^/]+)/)?.[1]);
  const draftOwner = useRef<string | undefined>(undefined);
  const baselineDraft = useRef('');
  const savePending = useRef<Promise<boolean> | null>(null);
  const operationEpoch = useRef(0);
  const { protect } = useEditGuard();
  const { path, navigate } = useGuardedRoute(next => {
    const owner = next.match(/^\/projects\/([^/]+)/)?.[1];
    if (owner !== activeProject.current) {
      operationEpoch.current++;
      detailScope.current.cancel(); projectScope.current.cancel();
      draftOwner.current = undefined; setDetail(null); setDraft(''); setSaving(false);
      savePending.current = null;
    }
    activeProject.current = owner;
    setError(''); setNotice(''); setShowCreate(false);
  });
  const match = path.match(/^\/projects\/([^/]+)(?:\/(requirements|agent|reviews|tests|documents))?\/?$/);
  const projectId = match?.[1];
  const isRequirements = match?.[2] === 'requirements';
  const isAgent = match?.[2] === 'agent';
  const isReview = match?.[2] === 'reviews';
  const isTests = match?.[2] === 'tests';
  const isDocuments = match?.[2] === 'documents';
  const isKnowledge = path === '/knowledge';
  const isGrowth = path === '/growth';
  const isList = path === '/projects';
  const isWorkbenchPage = path === '/missions' || path.startsWith('/missions/') || path === '/runs' || path === '/delivery';
  const pageTitle = projectId ? (isRequirements ? '需求分析' : isAgent ? 'Agent 任务规划' : isReview ? '代码审查' : isTests ? '测试中心' : isDocuments ? '文档中心' : '项目概览') : path.startsWith('/missions') ? '实训任务库' : path === '/runs' ? '运行记录' : path === '/delivery' ? '交付检查' : isKnowledge ? '知识库' : isGrowth ? '学习成长' : isList ? '我的项目' : '项目工作台';

  const checkHealth = useCallback(async () => {
    setConnection('checking');
    try {
      const health = await request<{ status: string; service: string }>('/health', { signal: AbortSignal.timeout(5000) });
      if (health.status !== 'ok' || health.service !== 'gongxu-api') throw new Error('Invalid health response');
    } catch { setConnection('offline'); return; }
    try {
      const ready = await request<{ status: string }>('/ready', { signal: AbortSignal.timeout(5000) });
      setConnection(ready.status === 'ready' ? 'online' : 'preparing');
    } catch { setConnection('preparing'); }
  }, []);
  useEffect(() => { void checkHealth(); }, [checkHealth]);
  const loadProjects = useCallback(async () => {
    const ticket = projectScope.current.begin('list');
    setLoading(true); setError('');
    const current = () => projectScope.current.accepts(ticket, activeProject.current ? undefined : 'list');
    try { const data = await request<{ projects: Project[] }>('/projects', { signal: ticket.signal }); if (current()) setProjects(data.projects); }
    catch (err) { if (current()) setError(message(err)); }
    finally { if (current()) setLoading(false); }
  }, []);
  const loadDetail = useCallback(async (id: string) => {
    if (activeProject.current !== id) return;
    const ticket = detailScope.current.begin(id);
    const current = () => detailScope.current.accepts(ticket, activeProject.current);
    draftOwner.current = undefined;
    setLoading(true); setError(''); setDetail(null);
    try {
      const data = await request<Detail>(`/projects/${encodeURIComponent(id)}`, { signal: ticket.signal });
      if (!current()) return;
      if (data.project.id !== id) throw new Error('项目响应归属不一致，已阻止载入。请重新读取。');
      const text = data.requirements[0] ? textContent(data.requirements[0].content) : data.project.description;
      draftOwner.current = id; baselineDraft.current = text;
      setDetail(data); setDraft(text);
    } catch (err) { if (current()) setError(message(err)); }
    finally { if (current()) setLoading(false); }
  }, []);
  useEffect(() => { if (!token || isKnowledge || isGrowth) return; if (projectId) void loadDetail(projectId); else void loadProjects(); }, [token, projectId, isKnowledge, isGrowth, loadDetail, loadProjects]);
  useEffect(() => {
    if (!token || !projectId) return;
    setAiStatus('checking');
    request<{ configured: boolean; model?: string }>('/ai/status').then(result => { setAiStatus(result.configured ? 'ready' : 'unconfigured'); setAiModel(result.model || ''); }).catch(() => setAiStatus('unavailable'));
  }, [token, projectId]);

  async function createProject(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError('');
    try {
      const data = await request<{ project: Project }>('/projects', { method: 'POST', body: JSON.stringify({ name: name.trim(), description: description.trim() }) });
      setName(''); setDescription(''); navigate(`/projects/${data.project.id}`);
    } catch (err) { setError(message(err)); }
    finally { setSaving(false); }
  }
  function persistRequirement(): Promise<boolean> {
    if (savePending.current) return savePending.current;
    if (saving) { setError('当前操作尚未结束，请等待后再保存。'); return Promise.resolve(false); }
    const owner = draftOwner.current, original = draft, content = draft.trim();
    if (!owner || owner !== projectId || owner !== activeProject.current || detail?.project.id !== owner || !content) {
      setError('需求内容与当前项目尚未对应，已阻止保存。请等待项目读取完成。'); return Promise.resolve(false);
    }
    setSaving(true); setError(''); setNotice('');
    const generation = detailScope.current.begin(owner);
    const current = () => detailScope.current.accepts(generation, activeProject.current) && draftOwner.current === owner;
    const pending: Promise<boolean> = (async () => {
      try {
        const result = await request<{ requirement: Requirement }>(`/projects/${encodeURIComponent(owner)}/requirements`, { method: 'POST', body: JSON.stringify({ content }) });
        if (!current()) return false;
        baselineDraft.current = content;
        setDraft(value => value === original ? content : value);
        setDetail(value => value?.project.id === owner ? { ...value, requirements: [result.requirement, ...value.requirements] } : value);
        setNotice('需求草稿已保存为新版本。'); return true;
      } catch (err) { if (current()) setError(message(err)); return false; }
      finally { if (current()) { setSaving(false); savePending.current = null; } }
    })();
    savePending.current = pending; return pending;
  }
  async function saveRequirement(event: FormEvent) { event.preventDefault(); await persistRequirement(); }
  useUnsavedEdit('requirement', { label: '需求草稿', dirty: Boolean(token && isRequirements && draftOwner.current === projectId && draft !== baselineDraft.current), save: persistRequirement });
  async function analyze() {
    if (!projectId || !draft.trim() || saving || draftOwner.current !== projectId || detail?.project.id !== projectId) return;
    if (draft.trim().length > 10000) { setError('AI 分析输入不能超过 10000 字，请精简后重试。'); return; }
    setSaving(true); setError(''); setNotice('');
    const epoch = ++operationEpoch.current, snapshot = draft;
    const current = () => epoch === operationEpoch.current && activeProject.current === projectId;
    try {
      const result = await request<{ model: string; requirement: Requirement }>(`/projects/${encodeURIComponent(projectId)}/requirements/analyze`, { method: 'POST', body: JSON.stringify({ idea: snapshot.trim() }) });
      if (!current()) return;
      const generated = textContent(result.requirement.content); baselineDraft.current = generated;
      setDetail(value => value?.project.id === projectId ? { ...value, requirements: [result.requirement, ...value.requirements] } : value);
      setDraft(value => value === snapshot ? generated : value);
      setNotice(`AI 需求分析已保存（模型：${result.model}）。等待期间继续输入的内容会保留；可在版本记录中查看生成稿。`);
    } catch (err) { if (current()) setError(message(err)); }
    finally { if (current()) setSaving(false); }
  }
  async function confirmRequirement() {
    const latest = detail?.requirements[0]; if (!projectId || !latest || saving || detail?.project.id !== projectId || draftOwner.current !== projectId) return;
    setSaving(true); setError(''); setNotice('');
    const epoch = ++operationEpoch.current;
    const current = () => epoch === operationEpoch.current && activeProject.current === projectId;
    try { const result = await request<{ requirement: Requirement }>(`/projects/${encodeURIComponent(projectId)}/requirements/${encodeURIComponent(latest.id)}/confirm`, { method: 'POST' }); if (current()) { setDetail(value => value?.project.id === projectId ? { ...value, requirements: value.requirements.map(row => row.id === latest.id ? result.requirement : row) } : value); setNotice('需求版本已确认。'); } }
    catch (err) { if (current()) setError(message(err)); } finally { if (current()) setSaving(false); }
  }
  async function logout() { try { await request('/auth/logout', { method: 'POST' }); } catch { /* Local logout remains available if the service is offline. */ } finally { detailScope.current.cancel(); projectScope.current.cancel(); localStorage.removeItem('gongxu_token'); setToken(''); } }
  const link = (event: React.MouseEvent<HTMLAnchorElement>, to: string) => { if (!event.metaKey && !event.ctrlKey && !event.shiftKey && event.button === 0) { event.preventDefault(); navigate(to); } };

  if (!token) return <Auth onAuthenticated={setToken} connection={connection} onCheck={() => void checkHealth()} />;
  return <div className="app-shell">
    <aside className="sidebar" aria-label="工作空间导航">
      <a className="brand" href="/dashboard" onClick={e => link(e, '/dashboard')}><span className="brand-mark">工</span><span><strong>工序智伴</strong><small>GONGXU AI</small></span></a>
      <div className="side-label">WORKSPACE <span>工作空间</span></div>
      <nav className="side-nav" aria-label="主导航">{nav.map(item => <a key={item.title} className={(item.route === '/projects' ? isList || !!projectId : item.route === '/missions' ? path === '/missions' || path.startsWith('/missions/') : item.route === '/dashboard' ? !isList && !projectId && !isKnowledge && !isGrowth && !isWorkbenchPage : path === item.route) ? 'nav-item active' : 'nav-item'} aria-label={item.title} title={item.title} href={item.route} onClick={e => link(e, item.route)}><span className="nav-icon"><UiIcon name={item.icon as IconName} size={19} /></span><span className="nav-title">{item.title}</span><span className="nav-arrow">↗</span></a>)}</nav>
      <button type="button" className="logout-button" onClick={() => protect(() => void logout())}>退出登录 <span>↗</span></button><div className="side-note"><span className="side-note-icon">✦</span><p>每一步实践，<br />都让想法更接近现实。</p><small>AI 软件工程实训平台</small></div>
    </aside>
    <main className="main-area">
      <header className="topbar"><div><div className="eyebrow">WORKSPACE <span>/</span> {projectId ? 'PROJECT' : 'OVERVIEW'}</div><h1>{pageTitle}</h1></div><div className="header-tools"><QuickNavigation projects={loading ? [] : detail && projectId ? [detail.project, ...projects.filter(project => project.id !== detail.project.id)] : projects} projectId={projectId} navigate={navigate} onCreate={() => setShowCreate(true)} /><DisplaySettings /><ConnectionStatus connection={connection} onCheck={() => void checkHealth()} /></div></header>
      <div className="content">
        {!projectId && !isKnowledge && !isGrowth && !isWorkbenchPage && <>
          <section className="hero hero--cosmic">
            <div className="hero-copy">
              <div className="hero-kicker"><span /> SOFTWARE ENGINEERING · AI</div>
              <h2>让每个想法，<br /><em>走完真正的开发流程。</em></h2>
              <p>从需求到交付，在真实项目中练习软件工程。<br className="desktop-break" />你的每一次思考，都将成为下一步的起点。</p>
              <button type="button" className="button primary" onClick={() => setShowCreate(true)}>创建实训项目 <span>↗</span></button>
            </div>
            <WorkspacePlanet />
          </section>
          {!isList && <WorkspaceTools projects={projects} loading={loading} unavailable={Boolean(error)} navigate={navigate} onCreate={() => setShowCreate(true)} />}
          <div className="section-heading"><div><div className="eyebrow">YOUR PROJECTS <span>/</span> 实训项目</div><h2>{isList ? '全部项目' : '继续你的实践'}</h2><p>创建项目，将想法一步步转化为可交付的成果。</p></div>{!isList && <a href="/projects" onClick={e => link(e, '/projects')} className="text-link">查看全部 <span>→</span></a>}</div>
        </>}
        {error && <div className="alert error" role="alert"><span>!</span><div><strong>操作未完成</strong><p>{error}</p></div><button type="button" onClick={() => protect(() => projectId ? void loadDetail(projectId) : void loadProjects())}>重试</button></div>}
        {notice && <div className="alert success" role="status">✓ &nbsp;{notice}</div>}
        {showCreate && <section className="editor-panel" aria-labelledby="create-title"><div className="panel-heading"><div><div className="eyebrow">NEW PROJECT</div><h2 id="create-title">开始一个新项目</h2><p>先写下初步想法，后续可以继续完善需求。</p></div><button className="icon-button" type="button" onClick={() => setShowCreate(false)} aria-label="关闭">×</button></div><form onSubmit={createProject}><label htmlFor="name">项目名称 <span>必填</span></label><input id="name" value={name} onChange={e => setName(e.target.value)} maxLength={120} required placeholder="例如：校园二手物品交易平台" /><label htmlFor="description">项目想法 <span>选填</span></label><textarea id="description" rows={4} value={description} onChange={e => setDescription(e.target.value)} maxLength={10000} placeholder="描述你想解决的问题、目标用户或核心功能…" /><div className="form-actions"><button className="button secondary" type="button" onClick={() => setShowCreate(false)}>取消</button><button className="button primary" type="submit" disabled={saving || !name.trim()}>{saving ? '创建中…' : '创建项目'} <span>↗</span></button></div></form></section>}
        {isKnowledge && <Suspense fallback={<div className="state-block" role="status">正在准备工作区…</div>}><Knowledge request={request} /></Suspense>}
        {isGrowth && <Suspense fallback={<div className="state-block" role="status">正在准备工作区…</div>}><Growth request={request} navigate={navigate} /></Suspense>}
        {isWorkbenchPage && <Suspense fallback={<div className="state-block" role="status">正在准备工作页面…</div>}><WorkbenchPages path={path} request={request} projects={projects} loading={loading} unavailable={Boolean(error)} navigate={navigate}/></Suspense>}
        {!isKnowledge && !isGrowth && !isWorkbenchPage && (loading ? <div className="state-block" role="status"><span className="spinner" /> 正在读取项目数据…</div> : !error && !projectId && (projects.length ? <ProjectExplorer projects={projects} all={isList} navigate={navigate} onCreate={() => setShowCreate(true)} /> : <div className="empty-state"><span className="empty-icon">✳</span><h3>你的第一个想法，从这里开始</h3><p>目前还没有项目。创建项目后，你可以保存需求并逐步完成实训。</p><button type="button" className="button secondary" onClick={() => setShowCreate(true)}>创建项目 <span>↗</span></button></div>))}
        {!loading && detail && projectId && detail.project.id === projectId && <><div className="breadcrumb"><a href="/projects" onClick={e => link(e, '/projects')}>我的项目</a><span>/</span><a href={`/projects/${projectId}`} onClick={e => link(e, `/projects/${projectId}`)}>{detail.project.name}</a>{isRequirements && <><span>/</span>需求分析</>}{isAgent && <><span>/</span>Agent 任务规划</>}{isReview && <><span>/</span>代码审查</>}{isTests && <><span>/</span>测试中心</>}{isDocuments && <><span>/</span>文档中心</>}</div>
          <section className="detail-heading project-context-heading"><div><div className="eyebrow">PROJECT / {isRequirements ? 'REQUIREMENTS' : isAgent ? 'AGENT' : isReview ? 'REVIEW' : isTests ? 'TESTS' : isDocuments ? 'DOCUMENTS' : 'OVERVIEW'}</div><h2>{detail.project.name}</h2><p>{isRequirements ? '将想法写下来，保存后会形成可追溯的需求版本。' : isAgent ? '查看真实规划、执行过程与人工审核结果。' : isReview || isTests || isDocuments ? '围绕当前项目开展工程实践。' : detail.project.description || '这个项目还没有填写简介。'}</p></div><span className="status-pill">{detail.project.status === 'archived' ? '已归档' : '进行中'}</span></section>
          <ProjectNavigation projectId={projectId} path={path} navigate={navigate} />
          {isRequirements ? <div className="requirements-layout"><form className="editor-panel" onSubmit={saveRequirement}><div className="panel-heading"><div><h3>需求草稿</h3><p>描述目标用户、希望解决的问题和主要功能。</p></div><span className="small-tag">人工编辑</span></div><label className="sr-only" htmlFor="requirement">需求内容</label><MarkdownEditor id="requirement" value={draft} onChange={setDraft} maxLength={50000} placeholder="例如：为校园学生提供闲置物品发布、搜索和联系卖家的服务…" required /><div className="form-actions"><span className="muted-text">保存将创建新版本 · 最多 50000 字符；规划、测试与文档生成最多 20000 字符</span><button className="button secondary" type="button" onClick={() => protect(() => void analyze())} disabled={saving || !draft.trim() || aiStatus !== 'ready'}>AI 分析 <span>✦</span></button><button className="button primary" type="submit" disabled={saving || !draft.trim()}>{saving ? '处理中…' : '保存需求草稿'} <span>↗</span></button></div></form><aside className="context-panel" aria-label="AI 导师与需求版本"><div className="context-icon">✦</div><h3>AI 项目导师</h3><p>根据你的项目想法生成需求草稿，结果需要由你检查、修改和确认。</p><span className="small-tag">{aiStatus === 'checking' ? '正在检查模型配置' : aiStatus === 'ready' ? `模型已配置${aiModel ? ` · ${aiModel}` : ''}` : aiStatus === 'unconfigured' ? '未配置模型，暂无法分析' : '模型状态不可用'}</span>{detail.requirements[0]?.status === 'draft' && <div className="confirm-wrap"><p>请先保存修改，再确认最新版本。</p><button type="button" className="button secondary" onClick={() => void confirmRequirement()} disabled={saving || draft !== textContent(detail.requirements[0].content)}>确认最新版本 <span>✓</span></button></div>}<div className="context-divider"/><Suspense fallback={<p className="muted-text" role="status">正在准备视图…</p>}><RequirementHistory key={projectId} versions={detail.requirements} draft={draft} onRestore={(content,onApplied)=>protect(()=>{setDraft(content);onApplied();})} busy={saving} formatDate={formatDate} /></Suspense></aside></div> : isAgent ? <Suspense fallback={<div className="state-block" role="status">正在准备工作区…</div>}><Agent key={projectId} request={request} projectId={projectId} requirements={detail.requirements} /></Suspense> : isReview ? <Suspense fallback={<div className="state-block" role="status">正在准备工作区…</div>}><CodeReview key={projectId} request={request} projectId={projectId} requirements={detail.requirements} /></Suspense> : isTests ? <Suspense fallback={<div className="state-block" role="status">正在准备工作区…</div>}><Tests key={projectId} request={request} projectId={projectId} requirements={detail.requirements} /></Suspense> : isDocuments ? <Suspense fallback={<div className="state-block" role="status">正在准备工作区…</div>}><Documents key={projectId} request={request} projectId={projectId} requirements={detail.requirements} /></Suspense> : <><Suspense fallback={<p className="muted-text" role="status">正在准备视图…</p>}><ProjectPulse key={projectId} request={request} projectId={projectId} projectName={detail.project.name} requirements={detail.requirements} navigate={navigate} /></Suspense><div className="section-heading compact"><div><div className="eyebrow">PROJECT WORKFLOW</div><h2>项目实训路径</h2><p>从清晰的需求开始，逐步完成整个项目。</p></div></div><div className="workflow-list">{workflow.map((item, i) => <div className="workflow-row" key={item}><span className="step-number">0{i + 1}</span><div><strong>{item}</strong><small>{i === 0 ? '编辑并保存项目需求' : i === 1 ? '检索知识、规划任务并审核' : i === 2 ? '在知识库中检索资料' : i === 3 ? '语法诊断与 AI 审查建议' : i === 4 ? '设计用例并记录人工执行结果' : '生成、编辑和导出文档'}</small></div>{i === 0 ? <a href={`/projects/${projectId}/requirements`} onClick={e => link(e, `/projects/${projectId}/requirements`)} className="text-link">进入 <span>→</span></a> : <a href={i === 1 ? `/projects/${projectId}/agent` : i === 2 ? '/knowledge' : `/projects/${projectId}/${['','','','reviews','tests','documents'][i]}`} onClick={e => link(e, i === 1 ? `/projects/${projectId}/agent` : i === 2 ? '/knowledge' : `/projects/${projectId}/${['','','','reviews','tests','documents'][i]}`)} className="text-link">进入 <span>→</span></a>}</div>)}</div></>}
          {isRequirements && <Suspense fallback={<p role="status">正在准备追踪视图…</p>}><RequirementTrace key={projectId} request={request} projectId={projectId} versionId={detail.requirements.find(r=>r.status==='confirmed')?.id}/></Suspense>}
        </>}
        {!projectId && !isKnowledge && !isGrowth && !isWorkbenchPage && <section className="process"><div><div className="eyebrow">THE PROCESS <span>/</span> 工程实践</div><h2>把复杂项目，拆成清晰的每一步。</h2><p>围绕真实项目，逐步构建完整的软件工程经验。</p></div><div className="process-grid">{workflow.map((item, i) => <div key={item}><span>0{i + 1}</span><strong>{item}</strong><small>{i === 0 ? '需求草稿已开放' : '已开放'}</small></div>)}</div></section>}
        <footer><span>工序智伴 · AI 软件工程实训平台</span><span>BUILT FOR LEARNING, MADE FOR MAKING.</span></footer>
      </div>
    </main>
  </div>;
}

