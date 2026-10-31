import { useEffect, useState } from 'react';
import { UiIcon } from './UiIcon';
import { CopyButton } from './ContentView';
import { documentNames, summarizeProject, type ProjectSnapshot, type RequirementSummary, type Resource, type RunSummary, type TaskSummary, type CaseSummary, type DocSummary, type ReviewSummary } from './project-pulse-model';
import './project-pulse.css';

type Api = <T>(path: string, options?: RequestInit) => Promise<T>;
function result<T>(item: PromiseSettledResult<T>): Resource<T> {
  return item.status === 'fulfilled' ? { data: item.value, error: null } : { data: null, error: item.reason instanceof Error ? item.reason.message : '读取失败，请重试。' };
}
function stamp(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '时间未知' : date.toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function ProjectPulse({ request, projectId, projectName, requirements, navigate }: {
  request: Api; projectId: string; projectName: string; requirements: RequirementSummary[]; navigate: (path: string) => void;
}) {
  const [revision, setRevision] = useState(0);
  const [snapshot, setSnapshot] = useState<ProjectSnapshot | null>(null);
  const [updatedAt, setUpdatedAt] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    const options = { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]) };
    const base = `/projects/${encodeURIComponent(projectId)}`;
    setSnapshot(null);
    void Promise.allSettled([
      request<{ runs: RunSummary[] }>(`${base}/agent/runs`, options).then(data => data.runs),
      request<{ tasks: TaskSummary[] }>(`${base}/tasks`, options).then(data => data.tasks),
      request<{ cases: CaseSummary[] }>(`${base}/test-cases`, options).then(data => data.cases),
      request<{ documents: DocSummary[] }>(`${base}/documents`, options).then(data => data.documents),
      request<{ reviews: ReviewSummary[] }>(`${base}/code-reviews`, options).then(data => data.reviews),
    ]).then(([runs, tasks, cases, docs, reviews]) => {
      if (controller.signal.aborted) return;
      setSnapshot({ runs: result(runs), tasks: result(tasks), cases: result(cases), docs: result(docs), reviews: result(reviews) });
      setUpdatedAt(new Date().toISOString());
    });
    return () => controller.abort();
  }, [request, projectId, revision]);
  const go = (route: string) => navigate(`/projects/${encodeURIComponent(projectId)}/${route}`);
  if (!snapshot) return <section className="project-pulse pulse-loading" aria-label="项目推进概览" role="status"><span className="spinner" />正在汇总项目的真实实践记录…</section>;
  const summary = summarizeProject(requirements, snapshot);
  const { confirmed, tasks, done, cases, recorded, passed, docKinds, next } = summary;
  const version = confirmed ? `需求版本 ${confirmed.version}` : '尚未确认需求';
  const pending = tasks.filter(task => ['blocked', 'review', 'doing', 'todo', 'pending'].includes(task.status))
    .sort((a, b) => ['blocked', 'review', 'doing', 'todo', 'pending'].indexOf(a.status) - ['blocked', 'review', 'doing', 'todo', 'pending'].indexOf(b.status));
  const taskStatus: Record<string, string> = { blocked: '阻塞', review: '待审核', doing: '进行中', todo: '待开始', pending: '待开始' };
  const errors = [
    ['规划记录', snapshot.runs.error], ['任务', snapshot.tasks.error], ['测试用例', snapshot.cases.error], ['项目文档', snapshot.docs.error], ['代码审查', snapshot.reviews.error],
  ].filter(([, error]) => error);
  const limited = (snapshot.cases.data?.length ?? 0) >= 200 || (snapshot.docs.data?.length ?? 0) >= 100 || (snapshot.reviews.data?.length ?? 0) >= 100 || (snapshot.runs.data?.length ?? 0) >= 100;
  const report = [
    `# ${projectName} · 实践快照`, `读取时间：${new Date(updatedAt).toLocaleString('zh-CN')}`, `当前依据：${version}`,
    `任务（项目全部计划）：${snapshot.tasks.error ? '暂不可用' : `${done}/${tasks.length} 标记完成，${summary.blockedTasks.length} 项阻塞`}`,
    `测试（${version}）：${snapshot.cases.error ? '暂不可用' : confirmed ? `${cases.length} 条用例，人工登记 ${recorded} 条，其中通过 ${passed} 条` : '无已确认需求，不统计'}`,
    `文档（${version}）：${snapshot.docs.error ? '暂不可用' : confirmed ? `${docKinds.length}/6 类已保存` : '无已确认需求，不统计'}`,
    `下一步建议：${next.title}。${next.detail}`, '',
    '此快照仅汇总当前读取的记录，任务和测试状态由用户维护，不代表自动执行或正式验收。',
    ...(limited ? ['接口达到返回上限，历史数据可能未全部包含。'] : []),
    ...(errors.length ? [`缺失记录：${errors.map(([name]) => name).join('、')}`] : []),
  ].join('\n');
  return <section className="project-pulse" aria-labelledby="pulse-title">
    <div className="pulse-heading"><div><span className="eyebrow">PROJECT PULSE</span><h2 id="pulse-title">每一步，都有据可循。</h2></div><div className="pulse-actions"><span>读取于 {stamp(updatedAt)}</span><CopyButton value={report} label="复制实践快照" /><button type="button" className="button secondary" onClick={() => setRevision(value => value + 1)}>刷新概览</button></div></div>
    {errors.length > 0 && <div className="pulse-error" role="status"><strong>部分记录暂不可用</strong><ul>{errors.map(([name, error]) => <li key={name}>{name}：{error}</li>)}</ul></div>}
    <div className={`pulse-next pulse-next--${next.tone}`}><div className="pulse-next-icon"><UiIcon name="spark" size={26} /></div><div><span className="eyebrow">建议下一步 · 依据已保存记录</span><h3>{next.title}</h3><p>{next.detail}</p></div><button className="button primary" type="button" onClick={() => go(next.route)}>{next.label}<UiIcon name="arrow" size={17} /></button></div>
    <div className="pulse-stats" aria-label="真实实践指标">
      <div><span><UiIcon name="document" size={16} />已确认需求</span><strong>{confirmed ? `V${confirmed.version}` : '待确认'}</strong><small>{summary.latest && summary.latest.id !== confirmed?.id ? `最新版本 V${summary.latest.version} 为草稿` : '作为规划与测试的依据'}</small></div>
      <div><span><UiIcon name="agent" size={16} />任务标记完成</span><strong>{snapshot.tasks.error ? '—' : <>{done}<em> / {tasks.length}</em></>}</strong><small>项目全部计划 · 人工状态</small></div>
      <div><span><UiIcon name="test" size={16} />测试已登记结果</span><strong>{snapshot.cases.error || !confirmed ? '—' : <>{recorded}<em> / {cases.length}</em></>}</strong><small>{confirmed ? `V${confirmed.version} · 人工登记，非自动执行` : '确认需求后统计'}</small></div>
      <div><span><UiIcon name="projects" size={16} />已保存文档类型</span><strong>{snapshot.docs.error || !confirmed ? '—' : <>{docKinds.length}<em> / 6</em></>}</strong><small>{confirmed ? `V${confirmed.version} · 内容仍需核实` : '确认需求后统计'}</small></div>
    </div>
    <div className="pulse-grid">
      <section className="pulse-panel" aria-labelledby="pulse-task-title"><div className="pulse-panel-title"><h3 id="pulse-task-title">继续手头的任务</h3><button className="text-link" type="button" onClick={() => go('agent')}>任务中心 →</button></div>
        {snapshot.tasks.error ? <p className="muted-text">任务暂不可用，刷新后重试。</p> : tasks.length ? <><div className="pulse-progress-label"><span>标记完成 {done} / {tasks.length}</span><span>{Math.round(done / tasks.length * 100)}%</span></div><div className="pulse-progress" role="progressbar" aria-label="项目任务标记完成比例" aria-valuenow={done} aria-valuemin={0} aria-valuemax={tasks.length}><span style={{ width: `${done / tasks.length * 100}%` }} /></div>{pending.length ? <ul className="pulse-task-list">{pending.slice(0, 4).map(task => <li key={task.id}><span className={`pulse-task-dot pulse-task-dot--${task.status}`} /><strong>{task.title}</strong><span className="small-tag">{taskStatus[task.status]}</span></li>)}</ul> : <p className="muted-text">当前任务均已标记完成，请核对实际交付物。</p>}{pending.length > 4 && <p className="muted-text">还有 {pending.length - 4} 项，前往任务中心查看。</p>}</> : <div className="pulse-empty"><UiIcon name="agent" size={29}/><p>还没有已确认的任务计划。</p><small>完成需求确认后，让 Agent 规划第一步。</small></div>}
      </section>
      <section className="pulse-panel" aria-labelledby="pulse-doc-title"><div className="pulse-panel-title"><h3 id="pulse-doc-title">文档准备情况</h3><button className="text-link" type="button" onClick={() => go('documents')}>文档中心 →</button></div><p className="pulse-panel-note">{version} · 已保存不等于已验收</p><ul className="pulse-document-list">{Object.entries(documentNames).map(([kind, name]) => <li key={kind}><UiIcon name="document" size={16}/><span>{name}</span><small className={docKinds.includes(kind) ? 'present' : ''}>{snapshot.docs.error ? '暂不可用' : !confirmed ? '待需求确认' : docKinds.includes(kind) ? '已保存' : '待补充'}</small></li>)}</ul></section>
    </div>
    <div className="pulse-review-note"><UiIcon name="code" size={17}/><span>{snapshot.reviews.error ? '代码审查记录暂不可用' : snapshot.reviews.data?.length ? `最近审查：${stamp(snapshot.reviews.data[0].createdAt)} · ${snapshot.reviews.data[0].syntaxFindings.length} 条语法诊断；AI 建议需验证` : '尚无代码审查记录，开发过程中可随时提交片段。'}</span><button className="text-link" type="button" onClick={() => go('reviews')}>前往审查 →</button></div>
    <p className="pulse-footnote">指标来自已保存记录，不是能力评分或项目验收结论。{limited && '当前读取达到接口上限，历史记录可能未全部包含。'}</p>
  </section>;
}
