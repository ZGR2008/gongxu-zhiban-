export type RequirementSummary = { id: string; version: number; status: string };
export type RunSummary = { id: string; requirementVersionId: string; status: string; createdAt: string };
export type TaskSummary = { id: string; title: string; status: string; requirementVersionId?: string };
export type CaseSummary = { id: string; title: string; requirementVersionId: string; result: string };
export type DocSummary = { id: string; type: string; requirementVersionId: string; createdAt: string; sourceStatus?:'current'|'changed'|'unknown'|'historical'|'unavailable' };
export type ReviewSummary = { id: string; createdAt: string; syntaxFindings: unknown[] };
export type Resource<T> = { data: T | null; error: string | null };
export type ProjectSnapshot = {
  runs: Resource<RunSummary[]>;
  tasks: Resource<TaskSummary[]>;
  cases: Resource<CaseSummary[]>;
  docs: Resource<DocSummary[]>;
  reviews: Resource<ReviewSummary[]>;
};
export const documentNames: Record<string, string> = {
  readme: 'README', requirements: '需求分析', design: '软件设计',
  api: 'API 说明', test_report: '测试报告', summary: '项目总结',
};
export type NextAction = { title: string; detail: string; route: string; label: string; tone: 'normal' | 'attention' };

/** Read-only presentation rules. They never confirm a plan or infer code execution. */
export function summarizeProject(requirements: RequirementSummary[], snapshot: ProjectSnapshot) {
  const ordered = [...requirements].sort((a, b) => b.version - a.version);
  const confirmed = ordered.find(item => item.status === 'confirmed');
  const latest = ordered[0];
  const currentRuns = snapshot.runs.data?.filter(run => run.requirementVersionId === confirmed?.id) ?? [];
  const latestRun = [...currentRuns].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
  const cases = snapshot.cases.data?.filter(item => item.requirementVersionId === confirmed?.id) ?? [];
  const docs = snapshot.docs.data?.filter(item => item.requirementVersionId === confirmed?.id) ?? [];
  const tasks = confirmed ? snapshot.tasks.data?.filter(task => task.requirementVersionId === confirmed.id) ?? [] : [];
  const done = tasks.filter(task => task.status === 'done').length;
  const blockedTasks = tasks.filter(task => task.status === 'blocked');
  const issues = cases.filter(item => item.result === 'failed' || item.result === 'blocked');
  const notRun = cases.filter(item => item.result === 'not_run').length;
  const passed = cases.filter(item => item.result === 'passed').length;
  const recorded = cases.filter(item => ['passed', 'failed', 'blocked'].includes(item.result)).length;
  const docKinds = Object.keys(documentNames).filter(kind => docs.some(doc => doc.type === kind));
  const reviewDocKinds=docKinds.filter(kind=>!docs.some(doc=>doc.type===kind&&doc.sourceStatus==='current'));
  const errors = Object.values(snapshot).filter(resource => resource.error).length;
  let next: NextAction;
  if (!confirmed) next = { title: '先把需求变成共同的依据', detail: '完善目标用户、功能边界与验收条件，保存并确认需求后再开始规划。', route: 'requirements', label: '完善并确认需求', tone: 'normal' };
  else if (latest?.status === 'draft' && latest.version > confirmed.version) next = { title: `版本 ${latest.version} 还在等待确认`, detail: `目前下游以已确认的版本 ${confirmed.version} 为依据。请先检查新草稿与历史版本的差异。`, route: 'requirements', label: '审阅最新需求', tone: 'attention' };
  else if (snapshot.runs.error) next = { title: '规划记录暂时无法读取', detail: '刷新概览后重试，或前往 Agent 中心查看。尚不能判断该需求是否已经规划。', route: 'agent', label: '查看规划记录', tone: 'attention' };
  else if (!latestRun && (snapshot.runs.data?.length ?? 0) >= 100) next = { title: '请进一步核对当前需求的规划记录', detail: '本次只读取最近 100 次运行，其中没有找到当前需求的计划，不能据此判断完整历史。', route: 'agent', label: '查看规划记录', tone: 'attention' };
  else if (!latestRun) next = { title: `为需求版本 ${confirmed.version} 制定计划`, detail: '让 Agent 检索知识、生成任务并检查依赖关系，完成后由你审核。', route: 'agent', label: '前往 Agent 规划', tone: 'normal' };
  else if (latestRun.status === 'awaiting_review') next = { title: '有一份任务计划待你审核', detail: '核对任务范围、前置依赖和引用依据；确认后才会写入任务列表。', route: 'agent', label: '审阅任务计划', tone: 'attention' };
  else if (latestRun.status === 'running') next = { title: 'Agent 正在规划任务', detail: '前往运行记录查看当前步骤与工具结果。概览中的状态为读取时快照。', route: 'agent', label: '查看运行过程', tone: 'normal' };
  else if (latestRun.status === 'failed') next = { title: '最近一次规划需要检查', detail: '查看失败步骤及实际工具结果，再决定是否重新规划。', route: 'agent', label: '检查规划记录', tone: 'attention' };
  else if (blockedTasks.length) next = { title: `${blockedTasks.length} 项任务被标记为阻塞`, detail: '核对前置任务、交付物与阻塞原因，处理后再更新任务状态。', route: 'agent', label: '处理阻塞任务', tone: 'attention' };
  else if (issues.length) next = { title: `${issues.length} 条测试记录需要跟进`, detail: `需求版本 ${confirmed.version} 的人工记录中存在失败或阻塞，请核对执行说明。`, route: 'tests', label: '查看测试记录', tone: 'attention' };
  else if (errors) next = { title: '部分实践记录暂不可用', detail: '请刷新缺失的记录，再判断下一步；当前已显示的数据仍可查看。', route: 'agent', label: '打开任务中心', tone: 'attention' };
  else if (tasks.some(task => task.status !== 'done')) next = { title: '继续推进已确认的任务', detail: '先处理进行中或待审核的事项，并记录真实完成情况。只统计当前已确认需求的任务。', route: 'agent', label: '打开任务看板', tone: 'normal' };
  else if (!cases.length) next = { title: '为当前需求补齐测试设计', detail: '设计正常、边界和异常用例，审阅后开展人工测试。生成用例本身不代表测试通过。', route: 'tests', label: '设计测试用例', tone: 'normal' };
  else if (notRun) next = { title: `${notRun} 条用例尚未登记执行`, detail: '在你自己的测试环境中执行，并填写结果及证据。平台不会自动执行提交的代码。', route: 'tests', label: '完善执行记录', tone: 'normal' };
  else if (docKinds.length < Object.keys(documentNames).length) next = { title: '把实践过程整理成文档', detail: `当前需求已有 ${docKinds.length} 类文档，核对内容后补充缺失类型并导出。`, route: 'documents', label: '整理项目文档', tone: 'normal' };
  else if(reviewDocKinds.length) next={title:'文档来源需要再次核对',detail:`${reviewDocKinds.length} 类文档的生成依据已变化或不可追溯；请核对原文及当前任务、测试记录。资料齐备不等于项目已验收。`,route:'documents',label:'复核文档依据',tone:'attention'};
  else next = { title: '进行一次交付前人工复核', detail: '逐项检查代码、测试证据、文档和部署情况。已有记录齐备不等于项目已验收。', route: 'documents', label: '检查交付文档', tone: 'normal' };
  return { confirmed, latest, latestRun, cases, docs, tasks, done, blockedTasks, issues, notRun, passed, recorded, docKinds, reviewDocKinds, errors, next };
}
