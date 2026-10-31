import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { UiIcon } from './UiIcon';

export type PlanTask = {
  key: string;
  stage: string;
  title: string;
  description: string;
  deliverable: string;
  dependsOn: string[];
  citations: string[];
};

/** A dependency view of the existing plan, not a simulation of execution. */
export function PlanMap({ tasks }: { tasks: PlanTask[] }) {
  const [selected, setSelected] = useState(tasks[0]?.key || '');
  const [view, setView] = useState<'cards' | 'graph'>('cards');
  const marker = useId().replace(/:/g, '');
  const viewport = useRef<HTMLDivElement>(null);
  const { nodes, edges, width, height } = useMemo(() => {
    const byKey = new Map(tasks.map((task) => [task.key, task]));
    const depths = new Map<string, number>();
    function depth(key: string, visiting = new Set<string>()): number {
      if (depths.has(key)) return depths.get(key)!;
      if (visiting.has(key) || !byKey.has(key)) return 0;
      const next = new Set(visiting);
      next.add(key);
      const value = Math.min(
        tasks.length,
        Math.max(
          0,
          ...byKey
            .get(key)!
            .dependsOn.filter((key) => byKey.has(key))
            .map((key) => depth(key, next) + 1),
        ),
      );
      depths.set(key, value);
      return value;
    }
    tasks.forEach((task) => depth(task.key));
    const rows = new Map<number, PlanTask[]>();
    tasks.forEach((task) => {
      const level = depths.get(task.key) || 0;
      rows.set(level, [...(rows.get(level) || []), task]);
    });
    const columns = Math.max(1, ...[...rows.values()].map((row) => row.length));
    const width = Math.max(620, columns * 230 + 48),
      height = Math.max(150, (Math.max(0, ...rows.keys()) + 1) * 118 + 35);
    const nodes = tasks.map((task) => {
      const row = rows.get(depths.get(task.key) || 0)!;
      return {
        task,
        x: (width - row.length * 230) / 2 + row.indexOf(task) * 230 + 10,
        y: 24 + (depths.get(task.key) || 0) * 118,
      };
    });
    const locations = new Map(nodes.map((node) => [node.task.key, node]));
    const edges = nodes.flatMap((node) =>
      node.task.dependsOn.flatMap((key) => {
        const from = locations.get(key);
        return from
          ? [
              {
                from: from.task.key,
                to: node.task.key,
                path: `M${from.x + 105},${from.y + 62} C${from.x + 105},${from.y + 90} ${node.x + 105},${node.y - 28} ${node.x + 105},${node.y}`,
              },
            ]
          : [];
      }),
    );
    return { nodes, edges, width, height };
  }, [tasks]);
  const current = tasks.find((task) => task.key === selected) || tasks[0];
  useEffect(() => {
    const target = nodes.find((node) => node.task.key === selected);
    const element = viewport.current;
    if (view === 'graph' && element && target)
      element.scrollTo({
        top: Math.max(0, target.y - element.clientHeight / 2 + 31),
        left: Math.max(0, target.x - element.clientWidth / 2 + 105),
        behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
      });
  }, [selected, view, nodes]);
  return (
    <div className="plan-explorer">
      <div className="plan-explorer-toolbar">
        <p>
          共 {tasks.length} 项任务、{edges.length} 条依赖 · 计划不代表已执行
        </p>
        <div className="plan-view-switch" role="group" aria-label="计划显示方式">
          <button type="button" aria-pressed={view === 'cards'} onClick={() => setView('cards')}>
            <UiIcon name="grid" size={14} />
            任务卡片
          </button>
          <button type="button" aria-pressed={view === 'graph'} onClick={() => setView('graph')}>
            <UiIcon name="agent" size={14} />
            依赖关系
          </button>
        </div>
      </div>
      {view === 'cards' ? (
        <div className="agent-plan-grid">
          {tasks.map((task) => (
            <article key={task.key}>
              <div className="plan-task-heading">
                <span>{task.key}</span>
                <small>{task.stage}</small>
              </div>
              <h4>{task.title}</h4>
              <p>{task.description}</p>
              <div className="plan-deliverable">产物：{task.deliverable}</div>
              <details>
                <summary>依赖与引用依据</summary>
                <p>依赖：{task.dependsOn.join('、') || '无'}</p>
                <p>引用片段：{task.citations.join('、') || '无'}</p>
              </details>
            </article>
          ))}
        </div>
      ) : (
        <>
          <div
            ref={viewport}
            className="plan-map-scroll"
            tabIndex={0}
            role="region"
            aria-label="任务依赖关系图，可滚动并使用 Tab 选择任务"
          >
            <svg
              viewBox={`0 0 ${width} ${height}`}
              width={width}
              height={height}
              role="group"
              aria-label="模型计划中的真实任务依赖"
            >
              <defs>
                <marker id={marker} markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
                  <path d="M0 0 7 3.5 0 7" fill="#ac75d0" />
                </marker>
              </defs>
              <g fill="none">
                {edges.map((edge) => (
                  <path
                    key={`${edge.from}-${edge.to}`}
                    d={edge.path}
                    markerEnd={`url(#${marker})`}
                    className={
                      edge.from === current?.key || edge.to === current?.key
                        ? 'plan-edge plan-edge--selected'
                        : 'plan-edge'
                    }
                  />
                ))}
              </g>
              {nodes.map(({ task, x, y }) => (
                <g
                  key={task.key}
                  className={`plan-map-node ${current?.key === task.key ? 'selected' : ''}`}
                  transform={`translate(${x} ${y})`}
                  role="button"
                  tabIndex={0}
                  aria-label={`${task.key} ${task.title}，${task.dependsOn.length} 个前置任务`}
                  aria-pressed={current?.key === task.key}
                  onClick={() => setSelected(task.key)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setSelected(task.key);
                    }
                  }}
                >
                  <title>{task.title}</title>
                  <rect width="210" height="62" rx="9" />
                  <text x="14" y="21" className="plan-node-stage">
                    {task.key} · {task.stage.slice(0, 18)}
                  </text>
                  <text x="14" y="44" className="plan-node-title">
                    {task.title.length > 14 ? `${task.title.slice(0, 14)}…` : task.title}
                  </text>
                  <circle cx="196" cy="15" r="3" />
                </g>
              ))}
            </svg>
          </div>
          {current && (
            <div className="plan-selected-detail" aria-live="polite">
              <div>
                <span className="small-tag">
                  {current.key} · {current.stage}
                </span>
                <h4>{current.title}</h4>
                <p>{current.description}</p>
                <p>交付产物：{current.deliverable}</p>
              </div>
              <div>
                <strong>前置任务</strong>
                {current.dependsOn.length ? (
                  current.dependsOn.map((key) => (
                    <button type="button" key={key} onClick={() => setSelected(key)}>
                      {key} · {tasks.find((task) => task.key === key)?.title || '未找到任务'} ↗
                    </button>
                  ))
                ) : (
                  <p>没有前置依赖</p>
                )}
                <details>
                  <summary>引用片段</summary>
                  <p>{current.citations.join('、') || '本任务未引用知识片段'}</p>
                </details>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
