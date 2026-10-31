import { useCallback, useEffect, useId, useRef, useState, type ReactNode, type CSSProperties, type ComponentType } from 'react';
import { UiIcon } from './UiIcon';
import './content-fallback.css';

let cachedRenderer: ComponentType<{ value: string }> | null = null;
let rendererLoad: Promise<typeof import('./MarkdownRenderer')> | undefined;
function loadRenderer() {
  rendererLoad ??= import('./MarkdownRenderer').then(module => {
    cachedRenderer = module.MarkdownRenderer;
    return module;
  }).catch(error => {
    rendererLoad = undefined;
    throw error;
  });
  return rendererLoad;
}

export function CopyButton({ value, label = '复制内容' }: { value: string; label?: string }) {
  const [feedback, setFeedback] = useState('');
  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => setFeedback(''), 2500);
    return () => clearTimeout(timer);
  }, [feedback]);
  return (
    <span className="copy-control">
      <button
        type="button"
        disabled={!value}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setFeedback('已复制');
          } catch {
            setFeedback('复制失败，请手动选择文本');
          }
        }}
      >
        {label}
      </button>
      <span role="status" aria-live="polite">
        {feedback}
      </span>
    </span>
  );
}

/** Markdown is rendered as React nodes: raw HTML is disabled, and images never
 * fetch remote resources supplied by a model or uploaded knowledge document. */
export function RichContent({ value, onRendered }: { value: string; onRendered?: () => void }) {
  const [Renderer, setRenderer] = useState(() => cachedRenderer);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (Renderer) return;
    let active = true;
    setFailed(false);
    void loadRenderer().then(module => {
      if (active) setRenderer(() => module.MarkdownRenderer);
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [Renderer, attempt]);
  // Notify after the actual DOM commit, including the first deferred render.
  useEffect(() => { if (Renderer) onRendered?.(); }, [Renderer, value, onRendered]);
  return (
    <div className="rich-content">
      {Renderer?<Renderer value={value}/>:<>
        <p className="muted-text" role="status">{failed?'排版资源暂未加载，以下保留完整原文，可继续编辑和复制。':'正在准备排版，以下为完整原文…'}</p>
        {failed&&<button type="button" className="button secondary" onClick={()=>setAttempt(value=>value+1)}>重试排版</button>}
        <pre className="rich-content-fallback">{value}</pre>
      </>}
    </div>
  );
}

export function MarkdownEditor({
  id,
  value,
  onChange,
  maxLength,
  placeholder,
  required = false,
  disabled = false,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  maxLength: number;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
}) {
  const [view, setView] = useState<'edit' | 'preview' | 'split'>('edit');
  const groupId = useId();
  const preview = useRef<HTMLDivElement>(null);
  const [outline, setOutline] = useState<{ id: string; title: string; level: number }[]>([]);
  const [showOutline, setShowOutline] = useState(false);
  const updateOutline = useCallback(() => {
    const headings = [...(preview.current?.querySelectorAll<HTMLHeadingElement>('h1,h2,h3') ?? [])];
    setOutline(headings.map((heading, index) => {
      const id = `${groupId}-heading-${index}`;
      heading.id = id;
      return { id, title: heading.textContent || '未命名章节', level: Number(heading.tagName.slice(1)) };
    }));
  }, [groupId]);
  useEffect(() => {
    if (view === 'edit') {
      setOutline([]);
      return;
    }
    updateOutline();
  }, [value, view, updateOutline]);
  return (
    <div className={`markdown-editor markdown-editor--${view}`}>
      <div className="editing-toolbar">
        <div className="editor-view-tabs" role="group" aria-label="文档显示方式">
          {(
            [
              ['edit', '编辑'],
              ['preview', '预览'],
              ['split', '分栏'],
            ] as const
          ).map(([key, label]) => (
            <button
              type="button"
              aria-pressed={view === key}
              aria-controls={`${groupId}-content`}
              key={key}
              onClick={() => setView(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="markdown-read-controls">
          {view !== 'edit' && outline.length > 0 && (
            <button
              type="button"
              aria-pressed={showOutline}
              onClick={() => setShowOutline((value) => !value)}
            >
              文档大纲
            </button>
          )}
          <CopyButton value={value} label="复制文本" />
        </div>
      </div>
      {view !== 'edit' && showOutline && outline.length > 0 && (
        <nav className="document-outline" aria-label="当前文档大纲">
          {outline.map((item) => (
            <button
              type="button"
              key={item.id}
              data-level={item.level}
              onClick={() => {
                const container = preview.current;
                const target = document.getElementById(item.id);
                if (container && target)
                  container.scrollTo({
                    top:
                      target.getBoundingClientRect().top -
                      container.getBoundingClientRect().top +
                      container.scrollTop -
                      18,
                    behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
                  });
              }}
            >
              {item.title}
            </button>
          ))}
        </nav>
      )}
      <div className="markdown-editor-content" id={`${groupId}-content`}>
        <textarea
          id={id}
          className="requirements-input"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          maxLength={maxLength}
          placeholder={placeholder}
          required={required}
          disabled={disabled}
          hidden={view === 'preview'}
        />
        {view !== 'edit' && (
          <div ref={preview} className="markdown-preview" role="region" tabIndex={0} aria-label="文档预览">
            {value.trim() ? (
              <RichContent value={value} onRendered={updateOutline} />
            ) : (
              <div className="preview-placeholder">
                <UiIcon name="document" size={26} />
                <p>写下内容后，在这里查看排版。</p>
                <small>支持标题、表格、列表和代码块</small>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="editor-meta">
        <span>Markdown</span>
        <span>
          {value.length.toLocaleString('zh-CN')} / {maxLength.toLocaleString('zh-CN')} 字符
        </span>
      </div>
    </div>
  );
}

export function CodeEditor({
  value,
  onChange,
  language,
}: {
  value: string;
  onChange: (value: string) => void;
  language: string;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  const gutter = useRef<HTMLPreElement>(null);
  const tabNavigation = useRef(false);
  const [expanded, setExpanded] = useState(false);
  const [fontSize, setFontSize] = useState(12);
  const lines = value.split('\n').length;
  return (
    <div
      className={`code-editor ${expanded ? 'code-editor--expanded' : ''}`}
      style={{ '--editor-font-size': `${fontSize}px` } as CSSProperties}
    >
      <div className="editing-toolbar">
        <span className="code-file-name">
          <UiIcon name="code" size={15} />
          {language === 'typescript' ? 'review.ts' : 'review.js'}
        </span>
        <div className="code-view-controls">
          <button
            type="button"
            aria-label="A− 缩小代码字号"
            title="缩小代码字号"
            disabled={fontSize <= 11}
            onClick={() => setFontSize((size) => size - 1)}
          >
            A−
          </button>
          <button
            type="button"
            aria-label="A＋ 放大代码字号"
            title="放大代码字号"
            disabled={fontSize >= 18}
            onClick={() => setFontSize((size) => size + 1)}
          >
            A＋
          </button>
          <button type="button" aria-pressed={expanded} onClick={() => setExpanded((value) => !value)}>
            {expanded ? '收起编辑器' : '展开编辑器'}
          </button>
          <CopyButton value={value} label="复制代码" />
        </div>
      </div>
      <div className="code-editing-area">
        <div className="code-gutter" aria-hidden="true">
          <pre ref={gutter}>{Array.from({ length: lines }, (_, index) => String(index + 1)).join('\n')}</pre>
        </div>
        <textarea
          ref={input}
          className="code-input"
          id="code-input"
          rows={15}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onScroll={(event) => {
            if (gutter.current)
              gutter.current.style.transform = `translateY(${-event.currentTarget.scrollTop}px)`;
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setExpanded(false);
              tabNavigation.current = true;
            } else if (event.key !== 'Tab') tabNavigation.current = false;
            if (event.key === 'Tab' && tabNavigation.current) {
              tabNavigation.current = false;
              return;
            }
            // Keyboard indentation edits only the draft. No submitted code is executed.
            if (event.key === 'Tab' && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
              const target = event.currentTarget;
              const start = target.selectionStart,
                end = target.selectionEnd;
              const next = `${value.slice(0, start)}  ${value.slice(end)}`;
              if (next.length <= 50000) {
                event.preventDefault();
                onChange(next);
                requestAnimationFrame(() => input.current?.setSelectionRange(start + 2, start + 2));
              }
            }
          }}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          maxLength={50000}
          required
          placeholder="粘贴 TypeScript 或 JavaScript 代码…"
        />
      </div>
      <div className="editor-meta">
        <span>
          {language === 'typescript' ? 'TypeScript' : 'JavaScript'} · {lines} 行
        </span>
        <span>Tab 缩进 · Esc 后 Tab 离开</span>
        <span>{value.length.toLocaleString('zh-CN')} / 50,000 字符</span>
      </div>
    </div>
  );
}

export function ModuleGuide({ kind }: { kind: 'review' | 'agent' | 'knowledge' | 'document' }) {
  const content = {
    review: {
      icon: 'code' as const,
      title: '让代码，多一份可靠的检查',
      description: '提交代码后，诊断和建议会分开展示在这里。',
      steps: [
        ['语法诊断', '来自实际解析器的检测结果'],
        ['AI 建议', '分析潜在问题，保留人工判断'],
        ['人工验证', '结合实际项目和测试采纳建议'],
      ],
    },
    agent: {
      icon: 'agent' as const,
      title: '一份计划，从真实需求出发',
      description: '确认需求后启动规划，查看实际工具调用与执行结果。',
      steps: [
        ['检索知识', '关联你的知识库资料与来源'],
        ['规划与校验', '生成任务、依赖关系和交付物'],
        ['人工审核', '确认计划后创建项目任务'],
      ],
    },
    knowledge: {
      icon: 'knowledge' as const,
      title: '让每个回答，都有迹可循',
      description: '检索后，相关原文、文档名称和页码会显示在这里。',
      steps: [
        ['导入资料', '支持 PDF、文本与 Markdown'],
        ['建立索引', '真实向量检索，找到相关片段'],
        ['知识增强', '结合来源回答，再核对原文'],
      ],
    },
    document: {
      icon: 'document' as const,
      title: '把实践，沉淀为可交付的成果',
      description: '选择文档类型生成草稿，或打开已保存的文档。',
      steps: [
        ['生成草稿', '关联已确认需求及工程记录'],
        ['编辑与核实', '支持 Markdown 预览和分栏编辑'],
        ['保存与导出', '保存修改后导出 Markdown 文件'],
      ],
    },
  }[kind];
  return (
    <aside className="module-guide">
      <span className="module-guide-icon">
        <UiIcon name={content.icon} size={29} />
      </span>
      <span className="eyebrow">YOUR NEXT STEP</span>
      <h3>{content.title}</h3>
      <p>{content.description}</p>
      <ol>
        {content.steps.map(([title, description], index) => (
          <li key={title}>
            <span>0{index + 1}</span>
            <div>
              <strong>{title}</strong>
              <small>{description}</small>
            </div>
          </li>
        ))}
      </ol>
      <span className="module-guide-note">结果以实际运行与人工确认为准</span>
    </aside>
  );
}

export function TestCaseCollection<
  T extends { id: string; title: string; category: string; result: string },
>({ items, renderItem }: { items: T[]; renderItem: (item: T) => ReactNode }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [result, setResult] = useState('all');
  const filterId = useId();
  const matching = (item: T) =>
    (category === 'all' || item.category === category) &&
    (result === 'all' || item.result === result) &&
    item.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  const passed = items.filter((item) => item.result === 'passed').length,
    failed = items.filter((item) => item.result === 'failed').length,
    notRun = items.filter((item) => item.result === 'not_run').length;
  const visible = items.filter(matching).length;
  return (
    <div className="test-collection">
      <div className="test-summary">
        <div>
          <span>用例总数</span>
          <strong>{items.length}</strong>
        </div>
        <div data-outcome="passed">
          <span>人工记录通过</span>
          <strong>{passed}</strong>
        </div>
        <div data-outcome="failed">
          <span>人工记录失败</span>
          <strong>{failed}</strong>
        </div>
        <div>
          <span>尚未执行</span>
          <strong>{notRun}</strong>
        </div>
      </div>
      <div className="collection-filter">
        <label className="sr-only" htmlFor={`${filterId}-query`}>
          搜索测试用例
        </label>
        <input
          id={`${filterId}-query`}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索测试用例…"
        />
        <label className="sr-only" htmlFor={`${filterId}-category`}>
          测试类别筛选
        </label>
        <select
          id={`${filterId}-category`}
          value={category}
          onChange={(event) => setCategory(event.target.value)}
        >
          <option value="all">全部类别</option>
          <option value="normal">正常</option>
          <option value="boundary">边界</option>
          <option value="exception">异常</option>
        </select>
        <label className="sr-only" htmlFor={`${filterId}-result`}>
          执行状态筛选
        </label>
        <select id={`${filterId}-result`} value={result} onChange={(event) => setResult(event.target.value)}>
          <option value="all">全部结果</option>
          <option value="not_run">未执行</option>
          <option value="passed">通过</option>
          <option value="failed">失败</option>
          <option value="blocked">阻塞</option>
        </select>
      </div>
      <p className="muted-text">
        显示 {visible} / {items.length} 条用例 · 执行状态来自人工记录
      </p>
      {!visible && (
        <div className="empty-state">
          <p>没有匹配的用例，请调整筛选条件。</p>
          <button
            className="button secondary"
            type="button"
            onClick={() => {
              setQuery('');
              setCategory('all');
              setResult('all');
            }}
          >
            清除筛选
          </button>
        </div>
      )}
      {items.map((item) => (
        <div key={item.id} hidden={!matching(item)}>
          {renderItem(item)}
        </div>
      ))}
    </div>
  );
}
