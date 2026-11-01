import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { UiIcon, type IconName } from './UiIcon';

function storedChoice(key: string, values: string[], fallback: string) {
  try {
    const value = localStorage.getItem(key);
    return value && values.includes(value) ? value : fallback;
  } catch {
    return fallback;
  }
}
function persistChoice(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* The current tab remains usable when storage is disabled. */
  }
}

export function DisplaySettings() {
  const [density, setDensity] = useState(() =>
    storedChoice('gongxu-ui-density', ['comfortable', 'compact'], 'comfortable'),
  );
  const [textSize, setTextSize] = useState(() =>
    storedChoice('gongxu-ui-text', ['standard', 'large'], 'standard'),
  );
  const [sidebar, setSidebar] = useState(() =>
    storedChoice('gongxu-ui-sidebar', ['expanded', 'collapsed'], 'expanded'),
  );
  const panel = useRef<HTMLDetailsElement>(null);
  const id = useId();
  useLayoutEffect(() => {
    document.body.dataset.density = density;
    persistChoice('gongxu-ui-density', density);
    return () => {
      delete document.body.dataset.density;
    };
  }, [density]);
  useLayoutEffect(() => {
    document.body.dataset.textSize = textSize;
    persistChoice('gongxu-ui-text', textSize);
    return () => {
      delete document.body.dataset.textSize;
    };
  }, [textSize]);
  useLayoutEffect(() => {
    document.body.dataset.sidebar = sidebar;
    persistChoice('gongxu-ui-sidebar', sidebar);
    return () => {
      delete document.body.dataset.sidebar;
    };
  }, [sidebar]);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (panel.current?.open && event.target instanceof Node && !panel.current.contains(event.target))
        panel.current.open = false;
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);
  return (
    <details
      className="display-settings"
      ref={panel}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && panel.current) {
          panel.current.open = false;
          panel.current.querySelector('summary')?.focus();
        }
      }}
    >
      <summary aria-label="显示设置">
        <svg
          width="17"
          height="17"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <path d="M4 6h16M4 12h16M4 18h16M8 3v6m8 0v6m-5 0v6" />
        </svg>
        <span>显示设置</span>
      </summary>
      <div className="display-settings-panel">
        <h2>让工作台适合你</h2>
        <p>显示偏好保存在当前浏览器。</p>
        <fieldset>
          <legend>信息密度</legend>
          <div className="preference-options">
            {[
              ['comfortable', '舒适'],
              ['compact', '紧凑'],
            ].map(([value, label]) => (
              <label key={value}>
                <input
                  type="radio"
                  name={`${id}-density`}
                  value={value}
                  checked={density === value}
                  onChange={() => setDensity(value)}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>内容字号</legend>
          <div className="preference-options">
            {[
              ['standard', '标准'],
              ['large', '较大'],
            ].map(([value, label]) => (
              <label key={value}>
                <input
                  type="radio"
                  name={`${id}-text`}
                  value={value}
                  checked={textSize === value}
                  onChange={() => setTextSize(value)}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <button
          type="button"
          className="sidebar-appearance-toggle"
          aria-pressed={sidebar === 'collapsed'}
          onClick={() => setSidebar((value) => (value === 'collapsed' ? 'expanded' : 'collapsed'))}
        >
          {sidebar === 'collapsed' ? '展开左侧导航' : '收起左侧导航'}
          <span>↔</span>
        </button>
        <button
          type="button"
          className="reset-appearance"
          onClick={() => {
            setDensity('comfortable');
            setTextSize('standard');
            setSidebar('expanded');
          }}
        >
          恢复默认显示
        </button>
      </div>
    </details>
  );
}

type Project = { id: string; name: string };
type Entry = { key: string; title: string; detail: string; icon: IconName; path?: string; create?: boolean };
export function QuickNavigation({
  projects,
  projectId,
  navigate,
  onCreate,
  request,
}: {
  projects: Project[];
  projectId?: string;
  navigate: (path: string) => void;
  onCreate: () => void;
  request: <T>(path:string,options?:RequestInit)=>Promise<T>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const restoreFocus = useRef(true);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const [catalogue,setCatalogue]=useState<Project[]>([]);
  const [catalogueStatus,setCatalogueStatus]=useState<'idle'|'loading'|'ready'|'error'>('idle');
  const catalogueState=useRef(catalogueStatus),catalogueRead=useRef<AbortController|null>(null);
  useEffect(()=>()=>{catalogueRead.current?.abort();},[]);
  async function readCatalogue(force=false){
    if(!force&&['loading','ready'].includes(catalogueState.current))return;
    catalogueRead.current?.abort();const controller=new AbortController();catalogueRead.current=controller;
    catalogueState.current='loading';setCatalogueStatus('loading');setCatalogue([]);
    try{
      const result=await request<{projects:Project[]}>('/projects',{signal:controller.signal});
      if(controller.signal.aborted||catalogueRead.current!==controller)return;
      if(!Array.isArray(result.projects)||result.projects.some(p=>!p||typeof p.id!=='string'||typeof p.name!=='string'))throw new Error('invalid_catalogue');
      setCatalogue(result.projects);catalogueState.current='ready';setCatalogueStatus('ready');
    }catch{if(!controller.signal.aborted&&catalogueRead.current===controller){catalogueState.current='error';setCatalogueStatus('error');}}
  }
  const availableProjects=[...new Map([...projects,...catalogue].map(project=>[project.id,project])).values()];
  const entries: Entry[] = [
    { key: 'dashboard', title: '项目工作台', detail: '返回工作空间', icon: 'dashboard', path: '/dashboard' },
    { key: 'projects', title: '我的项目', detail: '搜索与管理实训项目', icon: 'projects', path: '/projects' },
    { key: 'missions', title: '实训任务库', detail: '挑选原创任务书，开始工程实践', icon: 'layers', path: '/missions' },
    { key: 'runs', title: '运行记录', detail: '查看 Agent 步骤、耗时与工具证据', icon: 'activity', path: '/runs' },
    { key: 'delivery', title: '交付检查', detail: '人工核对成果并导出清单', icon: 'delivery', path: '/delivery' },
    {
      key: 'knowledge',
      title: '知识库',
      detail: '资料导入、检索与知识增强回答',
      icon: 'knowledge',
      path: '/knowledge',
    },
    { key: 'growth', title: '学习成长', detail: '查看真实实践记录', icon: 'growth', path: '/growth' },
    { key: 'create', title: '创建项目', detail: '写下新的实训想法', icon: 'plus', create: true },
    ...availableProjects.map((project) => ({
      key: project.id,
      title: project.name,
      detail: '打开项目',
      icon: 'projects' as const,
      path: `/projects/${project.id}`,
    })),
  ];
  if (projectId)
    entries.push(
      ...(
        [
          ['requirements', 'AI 项目导师', 'spark'],
          ['agent', 'Agent 任务规划', 'agent'],
          ['reviews', '代码审查', 'code'],
          ['tests', '智能测试', 'test'],
          ['documents', '项目文档', 'document'],
        ] as const
      ).map(([route, title, icon]) => ({
        key: route,
        title,
        icon,
        detail: '当前项目',
        path: `/projects/${projectId}/${route}`,
      })),
    );
  const matching = entries
    .filter((entry) =>
      `${entry.title} ${entry.detail}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
    )
    .slice(0, 12);
  const activeIndex = Math.min(selected, Math.max(0, matching.length - 1));
  useEffect(() => {
    if (dialog.current?.open)
      dialog.current.querySelector('.quick-nav-results .highlighted')?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, query]);
  const open = (source?: HTMLElement) => {
    if (!dialog.current?.open) {
      opener.current =
        source ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
      restoreFocus.current = true;
      setQuery('');
      setSelected(0);
      dialog.current?.showModal();
      void readCatalogue();
      requestAnimationFrame(() => input.current?.focus());
    }
  };
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && !event.isComposing) {
        event.preventDefault();
        if (dialog.current?.open) dialog.current.close();
        else open();
      }
    };
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  }, []);
  const run = (entry: Entry) => {
    restoreFocus.current = false;
    dialog.current?.close();
    if (entry.create) onCreate();
    else if (entry.path) navigate(entry.path);
  };
  return (
    <>
      <button
        type="button"
        className="quick-nav-trigger"
        aria-label="快速导航 Ctrl K"
        aria-keyshortcuts="Control+K"
        onClick={(event) => open(event.currentTarget)}
      >
        <UiIcon name="search" size={16} />
        <span>快速导航</span>
        <kbd>Ctrl K</kbd>
      </button>
      <dialog
        ref={dialog}
        className="quick-nav-dialog"
        aria-labelledby="quick-nav-title"
        onClose={() => {
          if (restoreFocus.current && opener.current?.isConnected)
            opener.current.focus({ preventScroll: true });
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            const box = event.currentTarget.getBoundingClientRect();
            if (
              event.clientX < box.left ||
              event.clientX > box.right ||
              event.clientY < box.top ||
              event.clientY > box.bottom
            )
              event.currentTarget.close();
          }
        }}
      >
        <div className="quick-nav-input">
          <UiIcon name="search" />
          <label htmlFor="quick-nav-query" id="quick-nav-title" className="sr-only">
            搜索页面、项目与操作
          </label>
          <input
            ref={input}
            id="quick-nav-query"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelected(0);
            }}
            placeholder="搜索页面、项目与操作…"
            autoComplete="off"
            onKeyDown={(event) => {
              // Enter confirms Chinese/Japanese composition before it opens a result.
              if (event.nativeEvent.isComposing || event.keyCode === 229) return;
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setSelected((index) => (index + 1) % Math.max(1, matching.length));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setSelected((index) => (index - 1 + matching.length) % Math.max(1, matching.length));
              } else if (event.key === 'Enter' && matching[activeIndex]) {
                event.preventDefault();
                run(matching[activeIndex]);
              }
            }}
          />
          <button type="button" onClick={() => dialog.current?.close()} aria-label="Esc 关闭快速导航" aria-keyshortcuts="Escape">
            Esc
          </button>
        </div>
        <div className="quick-nav-catalogue">
          {catalogueStatus==='loading'&&<p role="status">正在读取可访问项目目录…</p>}
          {catalogueStatus==='error'&&<p role="alert">项目目录读取失败；页面操作仍可使用，请重新读取目录后搜索项目。</p>}
          {catalogueStatus==='ready'&&catalogue.length===0&&<p role="status">当前账号还没有项目。</p>}
          <button type="button" className="text-link" disabled={catalogueStatus==='loading'} onClick={()=>void readCatalogue(true)}>重新读取项目目录</button>
        </div>
        <div className="quick-nav-results" role="group" aria-label="可用操作">
          {matching.length ? (
            matching.map((entry, index) => (
              <button
                type="button"
                key={entry.key}
                className={index === activeIndex ? 'highlighted' : ''}
                onMouseEnter={() => setSelected(index)}
                onClick={() => run(entry)}
              >
                <span className="quick-nav-icon">
                  <UiIcon name={entry.icon} size={18} />
                </span>
                <span>
                  <strong>{entry.title}</strong>
                  <small>{entry.detail}</small>
                </span>
                <span className="quick-nav-enter">↵</span>
              </button>
            ))
          ) : (
            catalogueStatus==='ready'?<p className="quick-nav-empty">没有匹配项，试试项目名称或模块名称。</p>:null
          )}
        </div>
        <div className="quick-nav-footer">
          <span>↑ ↓ 选择 · Enter 打开</span>
          <span>Esc 关闭</span>
        </div>
      </dialog>
    </>
  );
}
