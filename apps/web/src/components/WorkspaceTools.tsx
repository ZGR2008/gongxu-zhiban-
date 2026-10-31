import { useMemo, useState } from 'react';
import { UiIcon, type IconName } from './UiIcon';

type Project = { id: string; name: string; description: string; status: string; createdAt: string; updatedAt: string };
type Props = { projects: Project[]; loading: boolean; navigate: (path: string) => void; onCreate: () => void };
const tools: { title: string; detail: string; icon: IconName; route: string }[] = [
  { title: 'AI 项目导师', detail: '梳理想法，确认需求', icon: 'spark', route: 'requirements' },
  { title: 'Agent 规划', detail: '检索、规划与人工审核', icon: 'agent', route: 'agent' },
  { title: 'RAG 知识库', detail: '查看专业资料与来源', icon: 'knowledge', route: '/knowledge' },
  { title: '代码审查', detail: '语法诊断与 AI 建议', icon: 'code', route: 'reviews' },
  { title: '智能测试', detail: '设计用例，记录结果', icon: 'test', route: 'tests' },
  { title: '项目文档', detail: '编辑与导出项目成果', icon: 'document', route: 'documents' },
];

/** UI-only shortcuts; every action opens an existing route or project form. */
export function WorkspaceTools({ projects, loading, navigate, onCreate }: Props) {
  const [selectedId, setSelectedId] = useState('');
  const targetId = projects.some(project => project.id === selectedId) ? selectedId : projects[0]?.id || '';
  const archived = projects.filter(project => project.status === 'archived').length;
  const updated = projects.filter(project => Date.now() - new Date(project.updatedAt).getTime() <= 7 * 86400000).length;
  return <section className="workspace-tools" aria-label="实训工具与项目概况">
    <div className="workspace-facts">
      <div><span>实训项目</span><strong>{loading ? '—' : projects.length.toString().padStart(2, '0')}</strong><small>当前账号</small></div>
      <div><span>进行中</span><strong>{loading ? '—' : (projects.length - archived).toString().padStart(2, '0')}</strong><small>持续推进你的想法</small></div>
      <div><span>最近 7 天更新</span><strong>{loading ? '—' : updated.toString().padStart(2, '0')}</strong><small>依据项目更新时间</small></div>
      <button className="fact-action" onClick={() => navigate('/growth')}><span>学习成长</span><strong>每一步，都算数 <UiIcon name="arrow" size={17} /></strong><small>查看真实任务与实践记录</small></button>
    </div>
    <div className="tools-heading"><div><span className="eyebrow">YOUR ENGINEERING TOOLKIT</span><h2>从这里，推进下一步。</h2></div><div className="tool-project-picker"><label htmlFor="tool-project">当前操作项目</label><select id="tool-project" value={targetId} onChange={event => setSelectedId(event.target.value)} disabled={loading || !projects.length}>{projects.length ? projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>) : <option value="">创建项目后开始实践</option>}</select></div></div>
    <div className="tools-grid">{tools.map(tool => <button key={tool.route} className="tool-launcher" type="button" disabled={loading} onClick={() => tool.route.startsWith('/') ? navigate(tool.route) : targetId ? navigate(`/projects/${targetId}/${tool.route}`) : onCreate()}><span className={`tool-symbol tool-symbol--${tool.icon}`}><UiIcon name={tool.icon} /></span><strong>{tool.title}</strong><span className="tool-description">{tool.detail}</span><span className="tool-arrow"><UiIcon name="arrow" size={14} /></span></button>)}</div>
  </section>;
}

export function ProjectExplorer({ projects, all, navigate, onCreate }: Omit<Props, 'loading'> & { all: boolean }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('updated');
  const [view, setView] = useState<'list' | 'grid'>('list');
  const filtered = useMemo(() => projects.filter(project => (filter === 'all' || (filter === 'archived' ? project.status === 'archived' : project.status !== 'archived')) && `${project.name} ${project.description}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name, 'zh-CN') : new Date(sort === 'created' ? b.createdAt : b.updatedAt).getTime() - new Date(sort === 'created' ? a.createdAt : a.updatedAt).getTime()), [projects, query, filter, sort]);
  const visible = all || query || filter !== 'all' ? filtered : filtered.slice(0, 4);
  return <section className="project-explorer" aria-label="项目列表">
    <div className="project-toolbar"><div className="project-search"><UiIcon name="search" size={17} /><label className="sr-only" htmlFor="project-search">搜索项目</label><input id="project-search" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索项目名称或描述…" /></div><label className="sr-only" htmlFor="project-filter">项目状态</label><select id="project-filter" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">全部状态</option><option value="active">进行中</option><option value="archived">已归档</option></select><label className="sr-only" htmlFor="project-sort">项目排序</label><select id="project-sort" value={sort} onChange={event => setSort(event.target.value)}><option value="updated">最近更新</option><option value="created">最近创建</option><option value="name">按名称排序</option></select><div className="view-switch" role="group" aria-label="项目显示方式"><button type="button" aria-label="列表视图" aria-pressed={view === 'list'} onClick={() => setView('list')}><UiIcon name="list" size={17} /></button><button type="button" aria-label="网格视图" aria-pressed={view === 'grid'} onClick={() => setView('grid')}><UiIcon name="grid" size={16} /></button></div><button className="new-project-icon" type="button" onClick={onCreate} aria-label="创建项目" title="创建项目"><UiIcon name="plus" size={18} /></button></div>
    <div className="project-result-count">{query || filter !== 'all' ? `找到 ${filtered.length} 个项目` : `当前展示 ${visible.length} / ${projects.length} 个项目`}</div>
    {visible.length ? <div className={`project-list ${view === 'grid' ? 'project-list--grid' : ''}`}>{visible.map((project, index) => <a className="project-row" href={`/projects/${project.id}`} key={project.id} onClick={event => { if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey) { event.preventDefault(); navigate(`/projects/${project.id}`); } }}><span className={`project-icon project-icon--${index % 3}`}><UiIcon name="projects" size={21} /></span><span className="project-info"><strong>{project.name}</strong><small>{project.description || '补充项目想法，开始你的需求分析'}</small></span><span className="project-date"><UiIcon name="clock" size={12} />{new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(new Date(project.updatedAt))} 更新</span><span className="status-pill">{project.status === 'archived' ? '已归档' : '进行中'}</span><span className="row-arrow"><UiIcon name="arrow" size={17} /></span></a>)}</div> : <div className="empty-state"><UiIcon name="search" size={26} /><h3>没有符合条件的项目</h3><p>换个关键词，或清除筛选后查看全部项目。</p><button className="button secondary" onClick={() => { setQuery(''); setFilter('all'); }}>清除筛选</button></div>}
  </section>;
}

export function ProjectNavigation({ projectId, path, navigate }: { projectId: string; path: string; navigate: (path: string) => void }) {
  const items = [{ title: '项目概览', icon: 'dashboard' as IconName, route: '' }, ...tools.filter(tool => !tool.route.startsWith('/'))];
  return <div className="project-navigation" role="navigation" aria-label="项目内导航">{items.map(item => { const target = `/projects/${projectId}${item.route ? `/${item.route}` : ''}`; return <button type="button" key={item.route} className={path === target ? 'selected' : ''} aria-current={path === target ? 'page' : undefined} onClick={() => navigate(target)}><UiIcon name={item.icon} size={16} />{item.title}</button>; })}</div>;
}
