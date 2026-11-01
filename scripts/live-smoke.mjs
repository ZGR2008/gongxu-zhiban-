import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

// This is an opt-in test against real services. It never loads API keys or
// substitutes model responses. Synthetic input is labeled in the database.
const args = new Set(process.argv.slice(2));
if ([...args].some(arg => !['--with-rag', '--with-ai'].includes(arg))) {
  console.error('Usage: pnpm smoke [--with-rag | --with-ai]');
  process.exit(1);
}
const withAi = args.has('--with-ai');
const withRag = withAi || args.has('--with-rag');
const base = new URL(process.env.SMOKE_API_URL || 'http://127.0.0.1:3001');
if (!['http:', 'https:'].includes(base.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname) || base.username || base.password || base.search || base.hash || base.pathname !== '/') {
  throw new Error('SMOKE_API_URL must be a loopback service origin without credentials');
}
const runId = randomUUID();
const report = {
  runId, startedAt: new Date().toISOString(), status: 'running',
  realServices: true, syntheticInput: true, remoteAiRequested: withAi,
  generatedCodeExecuted: false, checks: [], artifacts: {},
  omitted: [!withRag && 'semantic_retrieval', !withAi && 'cloud_ai_workflow'].filter(Boolean),
};
const sessions = new Set();
class CheckFailure extends Error {}
function ensure(condition, reason) { if (!condition) throw new CheckFailure(reason); }

async function request(path, { method = 'GET', body, token, expected = 200, text = false, timeout = 180_000 } = {}) {
  let response;
  try {
    response = await fetch(new URL(path, base), {
      method, redirect: 'error', signal: AbortSignal.timeout(timeout),
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch { throw new CheckFailure('service_unreachable_or_timeout'); }
  const data = text ? await response.text() : await response.json().catch(() => ({}));
  if (response.status !== expected) {
    // Do not print response bodies, generated text, URLs or credentials.
    const code = typeof data?.error === 'string' && /^[a-z_]{1,64}$/.test(data.error) ? data.error : 'unexpected_response';
    throw new CheckFailure(`http_${response.status}_${code}`);
  }
  return data;
}

async function step(name, work) {
  const started = Date.now();
  try {
    await work();
    report.checks.push({ name, status: 'passed', durationMs: Date.now() - started });
    console.log(`PASS ${name}`);
  } catch (error) {
    const reason = error instanceof CheckFailure ? error.message : 'unexpected_check_failure';
    report.checks.push({ name, status: 'failed', durationMs: Date.now() - started, reason });
    console.error(`FAIL ${name}: ${reason}`);
    throw error;
  }
}

let ownerToken, otherToken, project, requirement, documentId, pdfId, tasks = [], cases = [];
const password = randomBytes(24).toString('base64url');
const email = `smoke-${runId}@example.test`;
const projectDescription = '自动化联调测试数据，不是真实学生项目；只验证平台流程，不执行生成代码。';
const requirementText = '校园资料借阅 Web 实训：学生登录后查询资料并提交借阅申请，管理员确认归还。每人最多同时借阅三份资料；资料数量为零时拒绝申请。需要需求确认、开发任务、代码审查、正常/边界/异常测试和交付文档。登录测试检查空输入、密码长度边界、错误凭证及超时处理。';

try {
  await step('service_and_database_readiness', async () => {
    const health = await request('/health', { timeout: 8000 });
    ensure(health.service === 'gongxu-api' && health.status === 'ok', 'wrong_service');
    const ready = await request('/ready', { timeout: 8000 });
    ensure(ready.status === 'ready' && ready.schema === 'current' && ready.vector === 'installed', 'database_not_ready');
  });

  await step('register_two_isolated_accounts', async () => {
    const owner = await request('/auth/register', { method: 'POST', expected: 201, body: { email, password, name: '自动联调测试账号' } });
    ownerToken = owner.token; sessions.add(ownerToken);
    const other = await request('/auth/register', { method: 'POST', expected: 201, body: { email: `other-${runId}@example.test`, password: randomBytes(24).toString('base64url'), name: '自动联调隔离账号' } });
    otherToken = other.token; sessions.add(otherToken);
    ensure(typeof ownerToken === 'string' && typeof otherToken === 'string', 'missing_session');
    ensure(!('passwordHash' in owner.user) && !('password' in owner.user), 'credential_in_response');
  });

  await step('project_and_requirement_persistence', async () => {
    ({ project } = await request('/projects', { method: 'POST', token: ownerToken, expected: 201, body: { name: `联调测试 · 资料借阅 ${runId.slice(0, 8)}`, description: projectDescription } }));
    report.artifacts.projectId = project.id;
    ({ requirement } = await request(`/projects/${project.id}/requirements`, { method: 'POST', token: ownerToken, expected: 201, body: { content: requirementText } }));
    ensure(requirement.status === 'draft', 'requirement_not_draft');
    ({ requirement } = await request(`/projects/${project.id}/requirements/${requirement.id}`, { method: 'PATCH', token: ownerToken, body: { content: `${requirementText}\n本版本为自动联调输入。`, expectedContent: requirement.content } }));
    await request(`/projects/${project.id}/agent/runs`, { method: 'POST', token: ownerToken, expected: 409, body: { requirementId: requirement.id } });
    ({ requirement } = await request(`/projects/${project.id}/requirements/${requirement.id}/confirm`, { method: 'POST', token: ownerToken, body: { expectedContent: requirement.content } }));
    ensure(requirement.status === 'confirmed', 'confirmation_not_saved');
    await request(`/projects/${project.id}/requirements/${requirement.id}`, { method: 'PATCH', token: ownerToken, expected: 404, body: { content: 'Confirmed versions must remain immutable.', expectedContent: requirement.content } });
    const detail = await request(`/projects/${project.id}`, { token: ownerToken });
    ensure(detail.requirements.some(item => item.id === requirement.id && item.status === 'confirmed'), 'requirement_not_persisted');
  });

  await step('ownership_and_anonymous_access', async () => {
    await request(`/projects/${project.id}`, { token: otherToken, expected: 404 });
    await request(`/projects/${project.id}/requirements`, { token: otherToken, expected: 404 });
    await request(`/projects/${project.id}/tasks`, { token: otherToken, expected: 404 });
    await request('/projects', { expected: 401 });
    const list = await request('/projects', { token: otherToken });
    ensure(list.projects.length === 0, 'other_account_sees_project');
  });

  await step('text_and_pdf_parsing_persistence', async () => {
    const saved = await request('/knowledge/text', { method: 'POST', token: ownerToken, expected: 201, body: {
      name: '联调测试资料：软件工程与登录测试',
      text: '软件工程实训按需求确认、任务规划、开发、代码审查、测试和交付逐步推进。每个任务记录输入、依赖、交付物和验收条件。登录功能测试要覆盖正常登录、空邮箱或空密码、密码最短长度前后一位、错误凭证、网络超时和重复提交。AI 生成的用例必须经人工审核，生成用例不等于已经执行。借阅业务还需要验证零库存和最多借阅三份的边界。',
    } });
    documentId = saved.id;
    ensure(saved.status === 'awaiting_embedding' && saved.chunks > 0, 'text_not_chunked');
    const pdf = await readFile(new URL('../apps/api/test-data/minimal.pdf', import.meta.url));
    const savedPdf = await request('/knowledge/pdf', { method: 'POST', token: ownerToken, expected: 201, body: { name: '联调测试 PDF', data: pdf.toString('base64') } });
    pdfId = savedPdf.id;
    ensure(savedPdf.status === 'awaiting_embedding' && savedPdf.chunks > 0, 'pdf_not_parsed');
    const list = await request('/knowledge', { token: ownerToken });
    ensure(list.documents.some(doc => doc.id === documentId) && list.documents.some(doc => doc.id === pdfId && doc.mediaType === 'application/pdf'), 'documents_not_persisted');
    const foreign = await request('/knowledge', { token: otherToken });
    ensure(foreign.documents.length === 0, 'knowledge_owner_leak');
    report.artifacts.knowledgeDocumentIds = [documentId, pdfId];
  });

  if (withRag) {
    await step('real_vectors_and_source_retrieval', async () => {
      for (const id of [documentId, pdfId]) {
        const indexed = await request(`/knowledge/${id}/index`, { method: 'POST', token: ownerToken });
        ensure(indexed.status === 'ready' && indexed.chunks > 0, 'index_not_ready');
      }
      const relevant = await request('/knowledge/search', { method: 'POST', token: ownerToken, body: { query: '登录功能应该测试哪些边界和异常情况？' } });
      ensure(relevant.hasEvidence && relevant.hits[0]?.document_id === documentId, 'semantic_retrieval_missed_source');
      ensure(relevant.hits.every(hit => typeof hit.distance === 'number' && Number.isFinite(hit.distance)), 'invalid_similarity');
      const pdfResult = await request('/knowledge/search', { method: 'POST', token: ownerToken, body: { query: 'Software engineering requirements' } });
      ensure(pdfResult.hits.some(hit => hit.document_id === pdfId && hit.page === 1), 'pdf_page_reference_missing');
      const foreign = await request('/knowledge/search', { method: 'POST', token: otherToken, body: { query: '登录功能应该测试哪些边界和异常情况？' } });
      ensure(foreign.hits.length === 0 && foreign.hasEvidence === false, 'cross_account_vector_leak');
      await request(`/knowledge/${documentId}/index`, { method: 'POST', token: otherToken, expected: 404 });
    });
  }

  if (withAi) {
    await step('real_ai_requirement_analysis', async () => {
      const result = await request(`/projects/${project.id}/requirements/analyze`, { method: 'POST', token: ownerToken, expected: 201, body: { idea: requirementText } });
      ensure(result.requirement.status === 'draft' && result.requirement.content.length > 100, 'analysis_not_draft');
      ({ requirement } = await request(`/projects/${project.id}/requirements/${result.requirement.id}/confirm`, { method: 'POST', token: ownerToken, body: { expectedContent: result.requirement.content } }));
      report.artifacts.requirementId = requirement.id;
      const records = await request(`/projects/${project.id}/ai-generations`, { token: ownerToken });
      ensure(records.generations.length > 0, 'generation_not_audited');
    });

    await step('real_rag_answer_and_citations', async () => {
      const answer = await request('/knowledge/answer', { method: 'POST', token: ownerToken, body: { query: '登录功能应该测试哪些边界和异常情况？' } });
      ensure(typeof answer.answer === 'string' && answer.answer.length > 0 && answer.sources.length > 0, 'answer_missing');
      ensure(answer.sources.every(hit => [documentId, pdfId].includes(hit.document_id)), 'citation_outside_owned_evidence');
    });

    await step('real_agent_tools_review_gate_and_tasks', async () => {
      const planned = await request(`/projects/${project.id}/agent/runs`, { method: 'POST', token: ownerToken, expected: 201, body: { requirementId: requirement.id } });
      report.artifacts.agentRunId = planned.run.id;
      ensure(planned.run.status === 'awaiting_review', 'agent_did_not_wait_for_review');
      const tools = planned.steps.flatMap(item => item.tools);
      ensure(tools.some(item => item.toolName === 'knowledge_search' && item.status === 'succeeded'), 'knowledge_tool_not_recorded');
      ensure(tools.some(item => item.toolName === 'validate_plan' && item.status === 'succeeded'), 'validation_tool_not_recorded');
      const before = await request(`/projects/${project.id}/tasks`, { token: ownerToken });
      ensure(before.tasks.length === 0, 'tasks_created_before_approval');
      await request(`/projects/${project.id}/agent/runs/${planned.run.id}/confirm`, { method: 'POST', token: otherToken, expected: 404 });
      ({ tasks } = await request(`/projects/${project.id}/agent/runs/${planned.run.id}/confirm`, { method: 'POST', token: ownerToken, body:{acknowledged:true,note:'联调人员主动采用本次计划；不代表执行结果'} }));
      ensure(tasks.length === planned.run.plan.tasks.length && tasks.length > 0, 'approved_tasks_not_persisted');
      ensure(tasks.every(item => item.status === 'todo' && item.dependsOn.every(id => tasks.some(task => task.id === id))), 'invalid_task_dependency');
      await request(`/projects/${project.id}/agent/runs/${planned.run.id}/confirm`, { method: 'POST', token: ownerToken, body:{acknowledged:true}, expected: 409 });
      await request(`/projects/${project.id}/tasks/${tasks[0].id}`, { method: 'PATCH', token: ownerToken, body: { status: 'doing' } });
      await request(`/projects/${project.id}/tasks/${tasks[0].id}`, { method: 'PATCH', token: otherToken, body: { status: 'done' }, expected: 404 });
    });

    await step('real_code_review_evidence_separation', async () => {
      const result = await request(`/projects/${project.id}/code-reviews`, { method: 'POST', token: ownerToken, expected: 201, body: { language: 'typescript', code: 'function add(a: number, b: number) { return a + ; }' } });
      ensure(result.syntaxScope === 'syntax_only' && result.aiStatus === 'unverified', 'review_claims_unverified_execution');
      ensure(result.review.syntaxFindings.length > 0 && result.review.aiAdvice.length > 0, 'review_evidence_missing');
      const saved = await request(`/projects/${project.id}/code-reviews`, { token: ownerToken });
      ensure(saved.reviews.some(review => review.id === result.review.id), 'review_not_persisted');
    });

    await step('real_test_design_and_result_invalidation', async () => {
      ({ cases } = await request(`/projects/${project.id}/test-cases`, { method: 'POST', token: ownerToken, expected: 201, body: { requirementId: requirement.id } }));
      ensure(['normal', 'boundary', 'exception'].every(category => cases.some(item => item.category === category)), 'test_categories_missing');
      ensure(cases.every(item => item.result === 'not_run'), 'generated_tests_claim_executed');
      const item = cases[0];
      const recorded = await request(`/projects/${project.id}/test-cases/${item.id}/execution`, { method: 'PATCH', token: ownerToken, body: { result: 'blocked', note: '自动联调登记：借阅项目尚未实现，本脚本没有执行用户代码。',expectedRevision:item.revision,expectedExecutionRevision:item.executionRevision } });
      ensure(recorded.case.result === 'blocked' && recorded.case.executorId, 'manual_record_not_saved');
      const edited = await request(`/projects/${project.id}/test-cases/${item.id}`, { method: 'PATCH', token: ownerToken, body: { category: item.category, title: item.title, preconditions: item.preconditions, steps: `${item.steps}\n联调补充：确认测试环境。`, expected: item.expected,expectedRevision:item.revision } });
      ensure(edited.case.result === 'not_run' && edited.case.executorId === null && edited.case.executedAt === null, 'edited_test_kept_stale_result');
    });

    await step('real_document_generation_edit_and_export', async () => {
      const generated = await request(`/projects/${project.id}/documents/generate`, { method: 'POST', token: ownerToken, expected: 201, body: { type: 'test_report' } });
      const document = generated.document;
      ensure(document.requirementVersionId === requirement.id && document.content.includes(`未执行 ${cases.length} 条`), 'document_lacks_actual_test_snapshot');
      const content = `${document.content}\n\n## 联调备注\n这是自动联调记录，未执行借阅项目的代码。`;
      await request(`/projects/${project.id}/documents/${document.id}`, { method: 'PATCH', token: ownerToken, body: { content, expectedRevision: document.revision } });
      const exported = await request(`/projects/${project.id}/documents/${document.id}/export`, { token: ownerToken, text: true });
      ensure(exported === content, 'document_export_differs_from_saved_edit');
      await request(`/projects/${project.id}/documents/${document.id}`, { token: otherToken, expected: 404 });
      report.artifacts.projectDocumentId = document.id;
    });
  }

  await step('growth_counts_come_from_recorded_work', async () => {
    const growth = await request('/growth', { token: ownerToken });
    ensure(growth.counts.projects === 1 && growth.counts.tasks.total === tasks.length && growth.counts.testCases === cases.length, 'growth_counts_mismatch');
    ensure(growth.counts.testExecutions.passed === 0 && growth.counts.tasks.done === 0, 'unperformed_work_counted_complete');
    ensure(growth.events.some(event => event.type === 'project_created'), 'growth_events_missing');
    if (withAi) ensure(growth.events.some(event => event.type === 'task_status_changed'), 'task_audit_missing');
    const other = await request('/growth', { token: otherToken });
    ensure(other.counts.projects === 0 && other.events.length === 0, 'growth_owner_leak');
  });

  await step('logout_login_and_persistent_project', async () => {
    const previousToken = ownerToken;
    await request('/auth/logout', { method: 'POST', token: ownerToken }); sessions.delete(ownerToken);
    await request('/auth/me', { token: previousToken, expected: 401 });
    const login = await request('/auth/login', { method: 'POST', body: { email, password } });
    ownerToken = login.token; sessions.add(ownerToken);
    const detail = await request(`/projects/${project.id}`, { token: ownerToken });
    ensure(detail.project.id === project.id && detail.requirements.length > 0, 'data_lost_between_sessions');
  });
  report.status = 'passed';
} catch {
  report.status = report.checks.length === 1 ? 'blocked' : 'failed';
  process.exitCode = 1;
} finally {
  let revoked = 0;
  for (const token of sessions) {
    try { await request('/auth/logout', { method: 'POST', token, timeout: 8000 }); revoked++; } catch { /* Failure remains visible in the report. */ }
  }
  report.sessionsRevoked = revoked === sessions.size;
  report.finishedAt = new Date().toISOString();
  const directory = new URL('../.runtime/', import.meta.url);
  await mkdir(directory, { recursive: true });
  await writeFile(new URL(`smoke-${runId}.json`, directory), JSON.stringify(report, null, 2));
  console.log(`Result: ${report.status}; ${report.checks.filter(item => item.status === 'passed').length} checks passed. Report: .runtime/smoke-${runId}.json`);
}
