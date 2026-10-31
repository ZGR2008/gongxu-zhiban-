import { chromium } from 'playwright';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const withAi = process.argv.includes('--with-ai');
if (process.argv.slice(2).some(arg => arg !== '--with-ai')) throw new Error('Usage: pnpm smoke:browser [--with-ai]');
const origin = new URL(process.env.SMOKE_WEB_URL || 'http://127.0.0.1:5173');
if (!['http:', 'https:'].includes(origin.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname) || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') throw new Error('SMOKE_WEB_URL must be a loopback origin');
const id = randomUUID();
const directory = new URL(`../.runtime/browser-${id}/`, import.meta.url);
await mkdir(directory, { recursive: true });
const report = { id, startedAt: new Date().toISOString(), realBrowser: true, realServices: true, syntheticInput: true, remoteAiRequested: withAi, checks: [], status: 'running' };
let browser, context, page, stage = 'launch_browser', pageErrors = 0, authenticated = false;
class BrowserCheckFailure extends Error {}
function requireTrue(condition, code) { if (!condition) throw new BrowserCheckFailure(code); }
async function step(name, work) {
  stage = name; const started = Date.now();
  await work(); report.checks.push({ name, status: 'passed', durationMs: Date.now() - started }); console.log(`PASS ${name}`);
}
async function noOverflow() {
  requireTrue(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2), 'horizontal_overflow');
}
try {
  const channel = process.env.SMOKE_BROWSER_CHANNEL || (process.platform === 'win32' ? 'msedge' : undefined);
  browser = await chromium.launch({ headless: true, ...(channel ? { channel } : {}) });
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' });
  page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', () => { pageErrors++; });

  await step('desktop_registration', async () => {
    await page.goto(origin.href);
    await page.locator('.connection').filter({ hasText: '服务可使用' }).waitFor();
    await page.getByRole('button', { name: '注册', exact: true }).click();
    await page.getByLabel('姓名', { exact: true }).fill('浏览器联调测试账号');
    await page.getByLabel('邮箱', { exact: true }).fill(`browser-${id}@example.test`);
    await page.getByLabel('密码', { exact: true }).fill(randomBytes(24).toString('base64url'));
    await page.getByRole('button', { name: /注册并进入/ }).click();
    await page.getByRole('heading', { level: 1, name: '项目工作台', exact: true }).waitFor();
    authenticated = true;
    await noOverflow();
  });

  let projectPath;
  await step('project_create_reload_and_requirements', async () => {
    await page.getByRole('button', { name: /创建项目|新建项目/ }).first().click();
    await page.getByLabel('项目名称').fill(`浏览器联调 · ${id.slice(0, 8)}`);
    await page.getByLabel('项目想法').fill('自动化测试输入：校园资料借阅平台，不是真实学生作业。');
    await page.locator('form').getByRole('button', { name: /创建项目/ }).click();
    await page.waitForURL(/\/projects\/[a-f0-9-]+$/);
    projectPath = new URL(page.url()).pathname;
    await page.locator(`a[href="${projectPath}/requirements"]`).click();
    await page.getByLabel('需求内容').fill('学生登录后查询资料并申请借阅，管理员确认归还。每人最多借阅三份，零库存时禁止借阅。按需求、开发、审查、测试和交付拆分实训任务。');
    await page.getByRole('button', { name: /保存需求草稿/ }).click();
    await page.locator('.version-list li').waitFor();
    await page.reload();
    await page.getByRole('button', { name: /确认最新版本/ }).click();
    await page.locator('.version-list').getByText('已确认', { exact: true }).waitFor();
    await noOverflow();
    await page.screenshot({ path: fileURLToPath(new URL('desktop-requirements.png', directory)), fullPage: true });
  });

  await step('knowledge_upload_and_real_index', async () => {
    await page.getByRole('navigation').getByRole('link', { name: /知识库/ }).click();
    await page.getByLabel('文档名称', { exact: true }).fill('浏览器联调资料');
    await page.getByLabel('文档内容', { exact: true }).fill('软件工程实训先确认需求，再建立有依赖关系的开发任务，随后审查代码、设计正常与边界测试、整理交付文档。借阅项目必须检查零库存以及每人最多三份的边界。');
    await page.getByRole('button', { name: /保存并分块/ }).click();
    await page.getByRole('button', { name: '建立索引', exact: true }).click();
    await page.getByText('可检索', { exact: true }).waitFor();
    await page.getByLabel('检索问题').fill('软件工程实训应该按哪些步骤完成？');
    await page.getByRole('button', { name: /检索知识/ }).click();
    await page.locator('.hit-list article').first().waitFor();
    await noOverflow();
  });

  if (withAi) {
    await step('agent_live_progress_and_review_gate', async () => {
      await page.goto(new URL(`${projectPath}/agent`, origin).href);
      await page.getByRole('button', { name: /开始规划/ }).waitFor();
      let planning = false, progressReads = 0;
      const observe = request => {
        const path = new URL(request.url()).pathname;
        if (request.method() === 'POST' && path.endsWith('/agent/runs')) planning = true;
        if (planning && request.method() === 'GET' && path.includes('/agent/runs')) progressReads++;
      };
      const finished = response => {
        if (response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/agent/runs')) planning = false;
      };
      page.on('request', observe);
      page.on('response', finished);
      await page.getByRole('button', { name: /开始规划/ }).click();
      await page.getByRole('heading', { name: '待审阅计划', exact: true }).waitFor({ timeout: 190000 });
      planning = false; page.off('request', observe); page.off('response', finished);
      requireTrue(progressReads > 0, 'no_live_progress_requests');
      report.agentProgressReadsWhileRequestPending = progressReads;
      await page.getByText('尚无已确认任务。', { exact: true }).waitFor();
      await page.screenshot({ path: fileURLToPath(new URL('desktop-agent.png', directory)), fullPage: true });
      await page.getByRole('button', { name: /确认计划并创建任务/ }).click();
      await page.locator('.task-status-label select').first().waitFor();
      await page.locator('.task-status-label select').first().selectOption('doing');
      await page.reload();
      requireTrue(await page.locator('.task-status-label select').first().inputValue() === 'doing', 'task_status_not_persisted');
    });
  }

  await step('all_project_routes_and_mobile_layout', async () => {
    for (const route of ['agent', 'reviews', 'tests', 'documents']) {
      await page.goto(new URL(`${projectPath}/${route}`, origin).href);
      await page.locator('main h1').waitFor();
      await page.locator('.module-page').waitFor();
      await noOverflow();
    }
    await page.setViewportSize({ width: 390, height: 844 });
    for (const route of ['/dashboard', '/knowledge', '/growth', `${projectPath}/requirements`, `${projectPath}/agent`, `${projectPath}/reviews`, `${projectPath}/tests`, `${projectPath}/documents`]) {
      await page.goto(new URL(route, origin).href);
      await page.locator('main h1').waitFor();
      await page.locator('.connection').filter({ hasText: '服务可使用' }).waitFor();
      await noOverflow();
    }
    await page.goto(new URL('/growth', origin).href);
    await page.getByRole('heading', { name: '看见每一次真实实践', exact: true }).waitFor();
    await page.locator('.growth-stats').waitFor();
    await page.screenshot({ path: fileURLToPath(new URL('mobile-growth.png', directory)), fullPage: true });
    requireTrue(pageErrors === 0, 'browser_runtime_errors');
  });

  await step('logout_clears_browser_session', async () => {
    const previousToken = await page.evaluate(() => localStorage.getItem('gongxu_token'));
    await page.getByRole('button', { name: /退出登录/ }).click();
    await page.getByRole('heading', { name: '欢迎回来', exact: true }).waitFor();
    requireTrue(await page.evaluate(() => localStorage.getItem('gongxu_token')) === null, 'session_not_cleared');
    const rejected = await context.request.get(new URL('/api/auth/me', origin).href, { headers: { Authorization: `Bearer ${previousToken}` } });
    requireTrue(rejected.status() === 401, 'server_session_not_revoked');
    authenticated = false;
  });
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  if (page && authenticated) {
    report.failureRoute = new URL(page.url()).pathname;
    report.visibleHeadings = await page.locator('h1,h2,h3').allTextContents();
    report.visibleButtons = await page.getByRole('button').allTextContents();
    await page.screenshot({ path: fileURLToPath(new URL('failure.png', directory)), fullPage: true,
      mask: [page.locator('input[type="password"],input[type="email"]')] }).catch(() => {});
  }
  // A browser error can include request bodies or HTML. Keep it out of output.
  report.checks.push({ name: stage, status: 'failed', reason: error instanceof BrowserCheckFailure ? error.message : error?.name === 'TimeoutError' ? 'browser_wait_timeout' : 'browser_check_failed' });
  console.error(`FAIL ${stage}; inspect the local UI and report. No request bodies were logged.`);
  process.exitCode = 1;
} finally {
  if (authenticated && page) {
    await page.evaluate(async () => {
      const token = localStorage.getItem('gongxu_token');
      if (token) await fetch('/api/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
      localStorage.removeItem('gongxu_token');
    }).catch(() => {});
  }
  await context?.close(); await browser?.close();
  report.pageErrors = pageErrors; report.finishedAt = new Date().toISOString();
  await writeFile(new URL('report.json', directory), JSON.stringify(report, null, 2));
  console.log(`Browser result: ${report.status}. Report: .runtime/browser-${id}/report.json`);
}
