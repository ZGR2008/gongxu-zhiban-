import { useId, useState } from 'react';
import { CopyButton } from './ContentView';
import { UiIcon } from './UiIcon';

const statusLabels: Record<string, string> = {
  running: '运行中',
  succeeded: '已完成',
  failed: '失败',
  skipped: '已跳过',
  pending: '未记录',
  awaiting_review: '待审核',
  confirmed: '已确认',
};
type Step = { id: string; stage: string; status: string; tools: { id: string; status: string }[] };
type Run = { id: string; status: string; createdAt: string };

/** Display only recorded execution evidence; absence of a step is never treated as success. */
export function AgentProgress({ run, steps }: { run: Run; steps: Step[] }) {
  const latest = (prefix: string) => [...steps].reverse().find((step) => step.stage.startsWith(prefix));
  const stages = [
    { name: '检索知识', caption: '寻找规划依据', icon: 'knowledge' as const, step: latest('knowledge') },
    { name: '生成计划', caption: '拆解任务与依赖', icon: 'agent' as const, step: latest('plan') },
    { name: '检查结果', caption: '校验结构与依赖', icon: 'test' as const, step: latest('validate') },
    {
      name: '人工审核',
      caption: '由你确认后入库',
      icon: 'spark' as const,
      step: {
        status:
          run.status === 'confirmed'
            ? 'confirmed'
            : run.status === 'awaiting_review'
              ? 'awaiting_review'
              : 'pending',
      },
    },
  ];
  const tools = steps.flatMap((step) => step.tools);
  return (
    <section className="agent-progress" aria-label="实际运行概览">
      <div className="agent-progress-heading">
        <div>
          <span className="eyebrow">EXECUTION TRACE</span>
          <h3>这一次规划，发生了什么</h3>
        </div>
        <span className="trace-status" data-status={run.status}>
          {statusLabels[run.status] || run.status}
        </span>
      </div>
      <ol className="agent-stage-strip">
        {stages.map((stage, index) => {
          const status = stage.step?.status || 'pending';
          return (
            <li key={stage.name} data-status={status}>
              <span className="agent-stage-icon">
                <UiIcon name={stage.icon} size={19} />
              </span>
              <div>
                <small>
                  0{index + 1} · {statusLabels[status] || status}
                </small>
                <strong>{stage.name}</strong>
                <p>{stage.caption}</p>
              </div>
            </li>
          );
        })}
      </ol>
      <div className="trace-facts">
        <span>
          运行 <code>{run.id.slice(0, 8)}</code>
        </span>
        <span>{steps.length} 条步骤记录</span>
        <span>{tools.length} 次工具调用</span>
        <span>{tools.filter((tool) => tool.status === 'failed').length} 次工具失败</span>
        <time dateTime={run.createdAt}>{new Date(run.createdAt).toLocaleString('zh-CN')}</time>
      </div>
    </section>
  );
}

type Task = {
  id: string;
  title: string;
  stage: string;
  description: string;
  deliverable: string;
  status: string;
  dependsOn: string[];
};
const taskStatuses = [
  ['todo', '待开始'],
  ['doing', '进行中'],
  ['review', '待审核'],
  ['done', '已完成'],
  ['blocked', '阻塞'],
] as const;
export function TaskBoard({
  tasks,
  busy,
  onChange,
}: {
  tasks: Task[];
  busy: boolean;
  onChange: (id: string, status: string) => void;
}) {
  const [view, setView] = useState<'list' | 'board'>('list');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const shown = tasks.filter(
    (task) =>
      (filter === 'all' || task.status === filter) &&
      `${task.title} ${task.description}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  const done = tasks.filter((task) => task.status === 'done').length;
  const renderTask = (task: Task) => (
    <div className="task-work-item" key={task.id} data-status={task.status}>
      <div className="task-work-copy">
        <strong>{task.title}</strong>
        <small>{task.stage}</small>
        <p>{task.description}</p>
        <details>
          <summary>完整说明、交付要求与依赖</summary>
          <p>说明：{task.description}</p>
          <p>产物：{task.deliverable}</p>
          <p>
            前置任务：
            {task.dependsOn.length
              ? task.dependsOn.map((id) => tasks.find((item) => item.id === id)?.title || id).join('、')
              : '无'}
          </p>
        </details>
      </div>
      <label className="task-status-label">
        <span className="sr-only">{task.title}状态</span>
        <select
          value={task.status}
          onChange={(event) => onChange(task.id, event.target.value)}
          disabled={busy}
        >
          {taskStatuses.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
  if (!tasks.length) return <p className="muted-text">尚无已确认任务。</p>;
  return (
    <div className="task-workspace">
      <div className="task-workspace-summary">
        <span>
          {done} / {tasks.length} 项已完成
        </span>
        <div className="view-switch" role="group" aria-label="任务视图">
          <button
            type="button"
            aria-label="任务列表视图"
            aria-pressed={view === 'list'}
            onClick={() => setView('list')}
          >
            <UiIcon name="list" size={15} />
          </button>
          <button
            type="button"
            aria-label="任务看板视图"
            aria-pressed={view === 'board'}
            onClick={() => setView('board')}
          >
            <UiIcon name="grid" size={15} />
          </button>
        </div>
      </div>
      <div className="task-filter">
        <input
          aria-label="搜索已确认任务"
          placeholder="按名称或描述查找任务…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <select aria-label="筛选任务状态" value={filter} onChange={(event) => setFilter(event.target.value)}>
          <option value="all">全部状态</option>
          {taskStatuses.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      {!shown.length ? (
        <p className="muted-text task-empty">
          没有匹配的任务。
          <button
            type="button"
            className="text-link"
            onClick={() => {
              setQuery('');
              setFilter('all');
            }}
          >
            清除筛选
          </button>
        </p>
      ) : view === 'list' ? (
        <div className="task-list-view">{shown.map(renderTask)}</div>
      ) : (
        <div className="task-board" tabIndex={0} role="region" aria-label="任务看板，可横向滚动">
          {taskStatuses
            .filter(([status]) => filter === 'all' || filter === status)
            .map(([status, label]) => (
              <section className="task-lane" key={status} data-status={status}>
                <h4>
                  <span>{label}</span>
                  <span>{shown.filter((task) => task.status === status).length}</span>
                </h4>
                {shown.filter((task) => task.status === status).map(renderTask)}
                {!shown.some((task) => task.status === status) && <p className="lane-empty">当前没有任务</p>}
              </section>
            ))}
        </div>
      )}
    </div>
  );
}

type Hit = { id: string; document_name: string; page: number | null; content: string; distance: number };
function SourceCard({ hit, index }: { hit: Hit; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const long = hit.content.length > 320;
  return (
    <article className="knowledge-source">
      <div className="source-heading">
        <span className="source-number">{String(index + 1).padStart(2, '0')}</span>
        <div>
          <strong>{hit.document_name}</strong>
          <small>{hit.page != null ? `原文第 ${hit.page} 页` : '文本资料'}</small>
        </div>
        <CopyButton value={hit.content} label="复制片段" />
      </div>
      <p id={id} className={!expanded && long ? 'source-excerpt source-excerpt--clamped' : 'source-excerpt'}>
        {hit.content}
      </p>
      {long && (
        <button
          type="button"
          className="source-expand"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? '收起片段 ↑' : '展开原始片段 ↓'}
        </button>
      )}
      <details className="source-metadata">
        <summary>查看检索依据</summary>
        <dl>
          <dt>向量距离</dt>
          <dd>
            {Number.isFinite(hit.distance) ? hit.distance.toFixed(3) : '不可用'}{' '}
            <span>（越小越相近，不代表结论已验证）</span>
          </dd>
          <dt>片段 ID</dt>
          <dd>
            <code>{hit.id}</code>
          </dd>
        </dl>
      </details>
    </article>
  );
}
export function SourceCollection({ hits }: { hits: Hit[] }) {
  return (
    <div className="hit-list source-collection">
      <p className="source-count">{hits.length} 条检索来源 · 编号按本次返回顺序展示</p>
      {hits.map((hit, index) => (
        <SourceCard key={hit.id} hit={hit} index={index} />
      ))}
    </div>
  );
}

export function TaskDistribution({
  counts,
}: {
  counts: { total: number; todo: number; doing: number; review: number; done: number; blocked: number };
}) {
  if (!counts.total) return <p className="muted-text">确认 Agent 计划后，可以在这里查看任务分布。</p>;
  return (
    <div className="task-distribution">
      <div
        className="task-stacked-bar"
        role="img"
        aria-label={taskStatuses.map(([key, label]) => `${label} ${counts[key]} 项`).join('，')}
      >
        {taskStatuses.map(
          ([key, label]) =>
            counts[key] > 0 && (
              <span
                key={key}
                data-status={key}
                style={{ flex: counts[key] }}
                title={`${label} ${counts[key]} 项`}
              />
            ),
        )}
      </div>
      <p>
        完成 {counts.done} / {counts.total} 项任务 · 依据当前任务状态
      </p>
    </div>
  );
}
