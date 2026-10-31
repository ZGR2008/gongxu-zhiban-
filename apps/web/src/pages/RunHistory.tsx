import { useEffect, useState } from "react";
import { UiIcon } from "../components/UiIcon";
import { CopyButton } from "../components/ContentView";
import {
  dateLabel,
  downloadText,
  EmptyProjects,
  ProjectPicker,
  ReadError,
  useApiResource,
  type PageProps,
  type Requirement,
  type Run,
  type RunDetail,
  type RunStep,
} from "./WorkbenchShared";
import {
  durationLabel,
  elapsedMs,
  runStates,
  stageNames,
} from "./workbench-data";

export default function RunHistory({
  projects,
  loading,
  unavailable,
  request,
  navigate,
}: PageProps) {
  const [projectChoice, setProjectChoice] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState("newest");
  const [revision, setRevision] = useState(0);
  const [automatic, setAutomatic] = useState(false);
  const projectId =
    !loading && !unavailable
      ? (projects.find((project) => project.id === projectChoice)?.id ??
        projects[0]?.id ??
        "")
      : "";
  const base = projectId ? `/projects/${encodeURIComponent(projectId)}` : null;
  const history = useApiResource<{ runs: Run[] }>(
    request,
    base ? `${base}/agent/runs` : null,
    revision,
  );
  const requirements = useApiResource<{ requirements: Requirement[] }>(
    request,
    base,
    revision,
  );
  const versionLabel = (id: string) =>
    requirements.data?.requirements.find((item) => item.id === id)?.version;
  const filtered = [...(history.data?.runs ?? [])]
    .filter(
      (run) =>
        (status === "all" || run.status === status) &&
        `${run.id} ${run.modelName} ${runStates[run.status] ?? run.status} V${versionLabel(run.requirementVersionId) ?? ""}`
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
    )
    .sort((a, b) =>
      sort === "duration"
        ? (elapsedMs(b.createdAt, b.finishedAt) ?? -1) -
          (elapsedMs(a.createdAt, a.finishedAt) ?? -1)
        : Date.parse(b.createdAt) - Date.parse(a.createdAt),
    );
  const selected = filtered.find((run) => run.id === selectedId) ?? filtered[0];
  const detail = useApiResource<RunDetail>(
    request,
    base && selected
      ? `${base}/agent/runs/${encodeURIComponent(selected.id)}`
      : null,
    revision,
  );
  useEffect(() => {
    if (!automatic || !projectId) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible")
        setRevision((value) => value + 1);
    }, 10000);
    return () => clearInterval(timer);
  }, [automatic, projectId]);
  const refresh = () => setRevision((value) => value + 1);
  if (!projectId)
    return (
      <EmptyProjects
        loading={loading}
        unavailable={unavailable}
        navigate={navigate}
      />
    );
  const all = history.data?.runs;
  return (
    <section className="wb-page run-history">
      <div className="wb-page-heading">
        <div>
          <span className="eyebrow">AGENT / RUN HISTORY</span>
          <h2>让每次运行，都能被复盘。</h2>
          <p>
            从实际记录中查看规划、检索、校验与工具调用。计划确认与任务完成分别记录。
          </p>
        </div>
        <button
          type="button"
          className="button primary"
          onClick={() => navigate(`${base}/agent`)}
        >
          前往规划与审核 <UiIcon name="arrow" size={16} />
        </button>
      </div>
      <div className="wb-scope-toolbar">
        <ProjectPicker
          projects={projects}
          id="runs-project"
          value={projectId}
          onChange={(value) => {
            setProjectChoice(value);
            setSelectedId("");
          }}
        />
        <label className="wb-checkbox">
          <input
            type="checkbox"
            checked={automatic}
            onChange={(event) => setAutomatic(event.target.checked)}
          />
          每 10 秒刷新
        </label>
        <button
          type="button"
          className="button secondary"
          onClick={refresh}
          disabled={history.loading}
        >
          刷新记录
        </button>
        <span className="wb-read-state" role="status">
          {history.loading
            ? "正在读取…"
            : automatic
              ? "自动刷新已开启，离开页面后停止"
              : "手动刷新 · 数据来自已保存记录"}
        </span>
      </div>
      {history.error && <ReadError message={history.error} retry={refresh} />}
      {requirements.error && (
        <p className="wb-warning" role="status">
          需求版本名称暂不可用；运行记录仍可按 ID 查看。
        </p>
      )}
      <div className="run-metrics">
        <div>
          <span>最近运行</span>
          <strong>{all ? all.length : "—"}</strong>
          <small>最多读取 100 条</small>
        </div>
        <div>
          <span>待人工审核</span>
          <strong>
            {all
              ? all.filter((run) => run.status === "awaiting_review").length
              : "—"}
          </strong>
          <small>等待你检查计划</small>
        </div>
        <div>
          <span>计划已确认</span>
          <strong>
            {all ? all.filter((run) => run.status === "confirmed").length : "—"}
          </strong>
          <small>不代表开发已完成</small>
        </div>
        <div>
          <span>失败记录</span>
          <strong>
            {all ? all.filter((run) => run.status === "failed").length : "—"}
          </strong>
          <small>可查看失败步骤</small>
        </div>
      </div>
      <div className="run-filters">
        <div className="wb-search">
          <UiIcon name="search" size={16} />
          <label className="sr-only" htmlFor="run-search">
            搜索运行记录
          </label>
          <input
            id="run-search"
            value={query}
            type="search"
            placeholder="搜索运行 ID、模型或版本…"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <label className="sr-only" htmlFor="run-status">
          运行状态
        </label>
        <select
          id="run-status"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="all">全部状态</option>
          {["running", "awaiting_review", "confirmed", "failed"].map(
            (value) => (
              <option key={value} value={value}>
                {runStates[value]}
              </option>
            ),
          )}
        </select>
        <label className="sr-only" htmlFor="run-sort">
          运行排序
        </label>
        <select
          id="run-sort"
          value={sort}
          onChange={(event) => setSort(event.target.value)}
        >
          <option value="newest">最近运行</option>
          <option value="duration">已记录耗时最长</option>
        </select>
        <span className="wb-read-state">
          {all ? `${filtered.length} 条匹配` : "等待记录"}
        </span>
      </div>
      {all?.length === 100 && (
        <p className="wb-warning">
          当前展示最近 100 条运行，筛选与统计仅涵盖本次读取范围。
        </p>
      )}
      {!all && history.loading ? (
        <div className="wb-empty" role="status">
          正在读取运行历史…
        </div>
      ) : all && !filtered.length ? (
        <div className="wb-empty">
          <UiIcon name="activity" size={34} />
          <h3>{all.length ? "没有匹配的运行记录" : "还没有 Agent 运行记录"}</h3>
          <p>
            {all.length
              ? "尝试更换关键词或状态。"
              : "先确认项目需求，再从 Agent 中心开始规划。"}
          </p>
          {all.length > 0 && (
            <button
              type="button"
              className="button secondary"
              onClick={() => {
                setQuery("");
                setStatus("all");
              }}
            >
              清除筛选
            </button>
          )}
        </div>
      ) : (
        selected && (
          <div className="run-inspector">
            <aside className="run-list" aria-label="运行列表">
              {filtered.map((run) => (
                <button
                  type="button"
                  key={run.id}
                  className={
                    selected.id === run.id ? "run-card selected" : "run-card"
                  }
                  aria-pressed={selected.id === run.id}
                  onClick={() => setSelectedId(run.id)}
                >
                  <span className="run-card-top">
                    <span className={`run-status run-status--${run.status}`}>
                      {runStates[run.status] ?? run.status}
                    </span>
                    <time>{dateLabel(run.createdAt)}</time>
                  </span>
                  <strong>
                    {versionLabel(run.requirementVersionId)
                      ? `需求 V${versionLabel(run.requirementVersionId)}`
                      : "需求版本待核对"}
                    <span>{run.modelName || "未记录模型"}</span>
                  </strong>
                  <span className="run-card-bottom">
                    <code>{run.id.slice(0, 8)}</code>
                    <span>
                      {durationLabel(elapsedMs(run.createdAt, run.finishedAt))}
                    </span>
                  </span>
                </button>
              ))}
            </aside>
            <div className="run-detail" aria-label="运行详情">
              {detail.error ? (
                <ReadError message={detail.error} retry={refresh} />
              ) : !detail.data ? (
                <div className="wb-empty" role="status">
                  正在读取步骤与工具记录…
                </div>
              ) : (
                <RunInspection
                  detail={detail.data}
                  version={versionLabel(detail.data.run.requirementVersionId)}
                  projectName={
                    projects.find((project) => project.id === projectId)
                      ?.name ?? ""
                  }
                />
              )}
            </div>
          </div>
        )
      )}
    </section>
  );
}

function RunInspection({
  detail,
  version,
  projectName,
}: {
  detail: RunDetail;
  version?: number;
  projectName: string;
}) {
  const run = detail.run;
  const tools = detail.steps.flatMap((step) => step.tools);
  const exported = JSON.stringify(
    {
      project: projectName,
      exportedAt: new Date().toISOString(),
      scope:
        "已保存的运行与工具摘要；不包含未记录的模型内部推理。计划确认不代表开发完成。",
      ...detail,
    },
    null,
    2,
  );
  return (
    <>
      <div className="run-detail-heading">
        <div>
          <span className="eyebrow">EXECUTION RECORD</span>
          <h3>{version ? `需求版本 ${version} 的规划记录` : "规划执行记录"}</h3>
          <span className={`run-status run-status--${run.status}`}>
            {runStates[run.status] ?? run.status}
          </span>
        </div>
        <button
          className="button secondary"
          type="button"
          onClick={() =>
            downloadText(
              `agent-run-${run.id.slice(0, 8)}.json`,
              exported,
              "application/json;charset=utf-8",
            )
          }
        >
          导出运行摘要
        </button>
      </div>
      <dl className="run-metadata">
        <div>
          <dt>运行 ID</dt>
          <dd>
            <code>{run.id}</code>
            <CopyButton value={run.id} label="复制 ID" />
          </dd>
        </div>
        <div>
          <dt>已记录耗时</dt>
          <dd>{durationLabel(elapsedMs(run.createdAt, run.finishedAt))}</dd>
        </div>
        <div>
          <dt>模型</dt>
          <dd>{run.modelName || "未记录"}</dd>
        </div>
        <div>
          <dt>工具调用</dt>
          <dd>
            {tools.length} 次记录 ·{" "}
            {tools.filter((tool) => tool.status === "failed").length} 次失败
          </dd>
        </div>
      </dl>
      {run.errorCode && (
        <p className="wb-warning">本次运行错误：{run.errorCode}</p>
      )}
      <div className="run-timeline-heading">
        <h4>执行步骤与耗时</h4>
        <span>根据服务端时间记录绘制</span>
      </div>
      <StepTimeline steps={detail.steps} />
      <div className="run-evidence-heading">
        <h4>工具调用证据</h4>
        <p>展开查看已保存的输入与输出摘要；没有记录的调用不会补造。</p>
      </div>
      {detail.steps.length ? (
        detail.steps.map((step) => (
          <details className="run-step-evidence" key={step.id}>
            <summary>
              <span className={`run-step-dot run-step-dot--${step.status}`} />
              <strong>{stageNames[step.stage] ?? step.stage}</strong>
              <span>{step.tools.length} 次工具调用</span>
              <span>{runStates[step.status] ?? step.status}</span>
            </summary>
            <div className="run-step-body">
              <p className="run-step-summary">
                {step.outputSummary || "尚无步骤输出摘要。"}
              </p>
              {step.tools.length ? (
                step.tools.map((tool) => (
                  <article className="run-tool" key={tool.id}>
                    <header>
                      <strong>{tool.toolName}</strong>
                      <span className={`run-status run-status--${tool.status}`}>
                        {runStates[tool.status] ?? tool.status}
                      </span>
                      <small>
                        {durationLabel(
                          elapsedMs(tool.startedAt, tool.finishedAt),
                        )}
                      </small>
                    </header>
                    <h5>输入摘要</h5>
                    <pre>{tool.inputSummary || "未记录"}</pre>
                    <h5>输出摘要</h5>
                    <pre>{tool.outputSummary || "尚未记录输出"}</pre>
                    <CopyButton
                      value={tool.outputSummary}
                      label="复制工具输出"
                    />
                  </article>
                ))
              ) : (
                <p className="wb-fineprint">该步骤没有工具调用记录。</p>
              )}
            </div>
          </details>
        ))
      ) : (
        <p className="wb-fineprint">尚无步骤记录。</p>
      )}
      <p className="wb-fineprint">
        这里展示执行记录，不是模拟思考。模型用量与费用尚未记录，因此不显示推算数值。
      </p>
    </>
  );
}
function StepTimeline({ steps }: { steps: RunStep[] }) {
  const starts = steps
    .map((step) => Date.parse(step.startedAt))
    .filter(Number.isFinite);
  const ends = steps
    .map((step) => Date.parse(step.finishedAt || ""))
    .filter(Number.isFinite);
  const start = starts.length ? Math.min(...starts) : 0;
  const total = ends.length ? Math.max(1, Math.max(...ends) - start) : 1;
  return (
    <ol className="run-timeline">
      {steps.map((step) => {
        const duration = elapsedMs(step.startedAt, step.finishedAt);
        const offset = Math.max(
          0,
          Math.min(100, ((Date.parse(step.startedAt) - start) / total) * 100),
        );
        return (
          <li key={step.id}>
            <div>
              <strong>{stageNames[step.stage] ?? step.stage}</strong>
              <small>{runStates[step.status] ?? step.status}</small>
            </div>
            <div className="run-time-track" aria-hidden="true">
              {duration !== null && (
                <span
                  className={`run-time-bar run-time-bar--${step.status}`}
                  style={{
                    left: `${offset}%`,
                    width: `${Math.min(100 - offset, (duration / total) * 100)}%`,
                  }}
                />
              )}
            </div>
            <span>{durationLabel(duration)}</span>
          </li>
        );
      })}
      {!steps.length && <li>暂无时间记录</li>}
    </ol>
  );
}
