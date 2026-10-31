import { chromium, webkit } from 'playwright';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const useWebkit = process.argv.includes('--webkit');
if (process.argv.slice(2).some(arg => arg !== '--webkit')) throw Error('Usage: pnpm smoke:project-controls [--webkit]');
const origin = new URL(process.env.SMOKE_WEB_URL || 'http://127.0.0.1:5173');
if (!['http:', 'https:'].includes(origin.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw Error('SMOKE_WEB_URL must be a loopback origin');
const id = randomUUID(), directory = new URL(`../.runtime/project-controls-${id}/`, import.meta.url);
await mkdir(directory, { recursive: true });
const report = { startedAt: new Date().toISOString(), browser: useWebkit ? 'Windows WebKit' : 'Chromium', realServices: true, syntheticInput: true, remoteAiRequested: false, controlledResponseChecks: true, status: 'running', checks: [] };
let browser, page, context, projectPath, sourceVersion, currentVersion, stage, authenticated = false, pageErrors = 0, aiCalls = 0;
class CheckFailure extends Error {}
const assert = (condition, code) => { if (!condition) throw new CheckFailure(code); };
const firstText = '# 校园书架 · 初版\n\n每位学生可借阅 2 本书。\n零库存时不能借阅。';
const secondText = '# 校园书架 · 第二版\n\n每位学生可借阅 3 本书。\n零库存时不能借阅。\n管理员可登记归还。';
async function check(name, work) { stage = name; const started = Date.now(); await work(); report.checks.push({ name, status: 'passed', durationMs: Date.now() - started }); console.log(`PASS ${name}`); }
async function api(path) {
  return page.evaluate(async path => {
    const response = await fetch(`/api${path}`, { headers: { Authorization: `Bearer ${localStorage.getItem('gongxu_token')}` } });
    if (!response.ok) throw Error('Read failed');
    return response.json();
  }, path);
}
async function go(path) { await page.goto(new URL(path, origin).href); await page.locator('main h1').waitFor(); }
async function saveRequirement(text) {
  await page.getByLabel('需求内容', { exact: true }).fill(text);
  await page.getByRole('button', { name: /保存需求草稿/ }).click();
  await page.locator('.alert.success').filter({ hasText: '需求草稿已保存' }).waitFor();
}
async function closeDialog() { await page.keyboard.press('Escape'); await page.locator('.history-dialog[open]').waitFor({ state: 'hidden' }); }
try {
  const channel = process.env.SMOKE_BROWSER_CHANNEL || (process.platform === 'win32' ? 'msedge' : undefined);
  browser = await (useWebkit ? webkit : chromium).launch({ headless: true, ...(!useWebkit && channel ? { channel } : {}) });
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', ...(!useWebkit ? { permissions: ['clipboard-read', 'clipboard-write'] } : {}) });
  page = await context.newPage(); page.setDefaultTimeout(15000);
  page.on('pageerror', () => pageErrors++);
  page.on('request', request => { if (request.method() === 'POST' && /\/(analyze|generate|agent\/runs|code-reviews|knowledge\/ask)$/.test(new URL(request.url()).pathname)) aiCalls++; });
  await check('real_registration_project_and_empty_overview', async () => {
    await page.goto(origin.href);
    await page.locator('.connection').filter({ hasText: '服务可使用' }).waitFor();
    await page.getByRole('button', { name: '注册', exact: true }).click();
    await page.getByLabel('姓名', { exact: true }).fill('项目交互验证 · 演示');
    await page.getByLabel('邮箱', { exact: true }).fill(`controls-${id}@example.test`);
    await page.getByLabel('密码', { exact: true }).fill(randomBytes(24).toString('base64url'));
    await page.getByRole('button', { name: /注册并进入/ }).click();
    await page.locator('.empty-state').waitFor(); authenticated = true;
    await page.locator('.empty-state').getByRole('button', { name: /创建项目/ }).click();
    await page.locator('#name').fill('项目推进与版本核对 · 演示');
    await page.locator('#description').fill('测试账号中的真实持久化记录，用于界面验证。');
    await page.locator('form').getByRole('button', { name: /创建项目/ }).click();
    await page.locator('.pulse-stats').waitFor(); projectPath = new URL(page.url()).pathname;
    assert(await page.locator('.pulse-next').getByText('先把需求变成共同的依据').isVisible(), 'incorrect_empty_suggestion');
    assert((await page.locator('.pulse-stats > div').nth(1).locator('strong').textContent()).replace(/\s/g, '') === '0/0', 'invented_task_progress');
    await page.locator('.pulse-next button').click(); await page.waitForURL('**/requirements');
  });
  await check('two_real_versions_saved_and_confirmed', async () => {
    await saveRequirement(firstText);
    await saveRequirement(secondText);
    await page.getByRole('button', { name: /确认最新版本/ }).click();
    await page.locator('.alert.success').filter({ hasText: '需求版本已确认' }).waitFor();
    const detail = await api(projectPath); assert(detail.requirements.length === 2, 'version_count');
    sourceVersion = detail.requirements.find(item => item.version === 1);
    currentVersion = detail.requirements.find(item => item.version === 2);
    assert(currentVersion.status === 'confirmed', 'confirmation_not_persisted');
  });
  await check('historic_preview_diff_targets_and_read_only_behavior', async () => {
    const localEdit = secondText + '\n\n尚未保存的验收边界。';
    await page.getByLabel('需求内容', { exact: true }).fill(localEdit);
    await page.getByRole('button', { name: '查看需求版本 1', exact: true }).click();
    await page.locator('.history-dialog[open]').waitFor();
    assert((await page.locator('.history-preview').textContent()).includes('2 本书'), 'wrong_history');
    await page.getByRole('button', { name: '差异对比', exact: true }).click();
    assert((await page.locator('.diff-line--removed').allTextContents()).join('').includes('2 本书'), 'missing_deletion');
    assert((await page.locator('.diff-line--added').allTextContents()).join('').includes('3 本书'), 'missing_addition');
    await page.getByLabel('只看变化', { exact: true }).check();
    assert(await page.locator('.diff-line--same').count() === 0, 'change_filter');
    await page.getByLabel('对比目标', { exact: true }).selectOption(currentVersion.id);
    assert(!(await page.locator('.history-diff').textContent()).includes('尚未保存'), 'saved_target_contains_draft');
    const state = await api(projectPath); assert(state.requirements.length === 2, 'comparison_wrote_data');
    await closeDialog();
    assert(await page.getByLabel('需求内容', { exact: true }).inputValue() === localEdit, 'view_overwrote_draft');
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '查看需求版本 1');
  });
  await check('restore_requires_confirmation_and_explicit_version_save', async () => {
    const oldDraft = await page.locator('#requirement').inputValue();
    await page.getByRole('button', { name: '查看需求版本 1', exact: true }).click();
    await page.getByRole('button', { name: '使用此版本编辑', exact: true }).click();
    await page.getByRole('button', { name: '保留当前编辑', exact: true }).click();
    await closeDialog();
    assert(await page.locator('#requirement').inputValue() === oldDraft, 'cancel_lost_draft');
    await page.getByRole('button', { name: '查看需求版本 1', exact: true }).click();
    await page.getByRole('button', { name: '使用此版本编辑', exact: true }).click();
    await page.getByRole('button', { name: '替换编辑区内容', exact: true }).click();
    await page.locator('.history-dialog[open]').waitFor({ state: 'hidden' });
    assert(await page.locator('#requirement').inputValue() === firstText, 'restore_content_mismatch');
    assert((await api(projectPath)).requirements.length === 2, 'restore_persisted_without_save');
    await saveRequirement(firstText);
    const state = await api(projectPath); assert(state.requirements.length === 3, 'new_version_missing');
    assert(state.requirements.find(item => item.id === currentVersion.id).status === 'confirmed', 'historical_version_mutated');
    await go(projectPath); await page.locator('.pulse-stats').waitFor();
    assert((await page.locator('.pulse-next h3').textContent()).includes('版本 3'), 'new_draft_not_surfaced');
    assert((await page.locator('.pulse-stats > div').first().locator('strong').textContent()) === 'V2', 'draft_counted_as_confirmed');
  });
  await check('partial_failure_refresh_and_snapshot_copy', async () => {
    const pattern = `**/api${projectPath}/test-cases`;
    await page.route(pattern, route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'database_unavailable' }) }));
    await page.getByRole('button', { name: '刷新概览', exact: true }).click();
    await page.locator('.pulse-error').waitFor();
    assert((await page.locator('.pulse-stats > div').nth(2).locator('strong').textContent()) === '—', 'failed_read_shown_as_zero');
    await page.unroute(pattern);
    await page.getByRole('button', { name: '刷新概览', exact: true }).click();
    await page.locator('.pulse-error').waitFor({ state: 'hidden' });
    await page.locator('.pulse-stats').waitFor();
    assert(await page.locator('.pulse-error').count() === 0, 'refresh_not_recovered');
    await page.getByRole('button', { name: '复制实践快照', exact: true }).click();
    await page.locator('.pulse-actions [role="status"]').filter({ hasText: '已复制' }).waitFor();
    if (!useWebkit) {
      const text = await page.evaluate(() => navigator.clipboard.readText());
      assert(text.includes('需求版本 2') && text.includes('不代表自动执行'), 'snapshot_scope_missing');
    }
  });
  await check('controlled_cross_version_evidence_and_status_counts', async () => {
    const cases = [{ id: 'old', requirementVersionId: sourceVersion.id, result: 'passed' }, { id: 'new1', requirementVersionId: currentVersion.id, result: 'blocked' }, { id: 'new2', requirementVersionId: currentVersion.id, result: 'not_run' }];
    const documents = [{ id: 'old', requirementVersionId: sourceVersion.id, type: 'readme' }, { id: 'new1', requirementVersionId: currentVersion.id, type: 'design' }, { id: 'new2', requirementVersionId: currentVersion.id, type: 'design' }];
    const patterns = [`**/api${projectPath}/test-cases`, `**/api${projectPath}/documents`];
    await page.route(patterns[0], route => route.fulfill({ json: { cases } }));
    await page.route(patterns[1], route => route.fulfill({ json: { documents } }));
    await page.getByRole('button', { name: '刷新概览', exact: true }).click(); await page.locator('.pulse-stats').waitFor();
    await page.waitForFunction(() => document.querySelector('.pulse-stats > div:nth-child(3) strong')?.textContent.replace(/\s/g, '') === '1/2');
    assert((await page.locator('.pulse-stats > div').nth(2).locator('strong').textContent()).replace(/\s/g, '') === '1/2', 'cross_version_test_count');
    assert((await page.locator('.pulse-stats > div').nth(3).locator('strong').textContent()).replace(/\s/g, '') === '1/6', 'duplicate_or_old_document_count');
    assert((await page.locator('.pulse-document-list li').filter({ hasText: 'README' }).textContent()).includes('待补充'), 'old_readme_present');
    for (const pattern of patterns) await page.unroute(pattern);
    await page.getByRole('button', { name: '刷新概览', exact: true }).click(); await page.locator('.pulse-stats').waitFor();
  });
  await check('responsive_long_diff_and_safe_markdown', async () => {
    for (const width of [320, 390, 768, 1440, 1920]) {
      await page.setViewportSize({ width, height: 1000 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `overview_overflow_${width}`);
    }
    await go(`${projectPath}/requirements`);
    const longText = Array.from({ length: 1000 }, (_, i) => `新文本${i}`).join('\n') + '\n' + 'W'.repeat(500);
    await page.locator('#requirement').fill(longText);
    await page.getByRole('button', { name: '比较版本', exact: true }).click();
    await page.locator('.history-dialog[open]').waitFor();
    assert(await page.locator('.diff-line').count() === 400, 'unbounded_initial_diff_rows');
    await page.getByRole('button', { name: /继续显示后续行/ }).click();
    assert(await page.locator('.diff-line').count() === 800, 'diff_expansion');
    await page.getByRole('button', { name: /继续显示后续行/ }).click();
    for (const width of [320, 390, 768, 1440, 1920]) {
      await page.setViewportSize({ width, height: 1000 });
      assert(await page.locator('.history-dialog').evaluate(el => el.scrollWidth <= el.clientWidth + 1), `dialog_overflow_${width}`);
      assert(await page.locator('.history-diff').evaluate(el => el.scrollWidth <= el.clientWidth + 1), `diff_overflow_${width}`);
    }
    await page.screenshot({ path: fileURLToPath(new URL('version-diff.png', directory)) });
    await closeDialog();
    await page.locator('#requirement').fill('# 安全预览\n<script>window.__history_script_executed=true</script>\n![不得请求外部图片](https://invalid.example.test/pixel.png)');
    await saveRequirement(await page.locator('#requirement').inputValue());
    let externalImages = 0; page.on('request', request => { if (request.url().includes('invalid.example.test')) externalImages++; });
    await page.getByRole('button', { name: '查看需求版本 4', exact: true }).click();
    await page.locator('.history-preview').waitFor();
    assert(!(await page.evaluate(() => window.__history_script_executed)), 'historic_html_executed');
    assert(await page.locator('.history-preview img').count() === 0 && externalImages === 0, 'historic_external_image_loaded');
    await closeDialog();
  });
  await check('no_automatic_model_calls_and_logout', async () => {
    assert(pageErrors === 0, 'page_errors'); assert(aiCalls === 0, 'unexpected_model_call');
    await page.getByRole('button', { name: /退出登录/ }).click();
    await page.getByRole('heading', { name: '欢迎回来', exact: true }).waitFor(); authenticated = false;
  });
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.checks.push({ name: stage, status: 'failed', reason: error instanceof CheckFailure ? error.message : error?.name === 'TimeoutError' ? 'ui_wait_timeout' : 'check_failed' });
  if (page && authenticated) await page.screenshot({ path: fileURLToPath(new URL('failure.png', directory)), fullPage: true, mask: [page.locator('input[type="password"],input[type="email"]')] }).catch(() => {});
  console.error(`FAIL ${stage}; no credentials or response bodies logged.`); process.exitCode = 1;
} finally {
  if (authenticated && page) await page.evaluate(async () => { const token = localStorage.getItem('gongxu_token'); if (token) await fetch('/api/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => {}); localStorage.removeItem('gongxu_token'); }).catch(() => {});
  await context?.close(); await browser?.close(); report.finishedAt = new Date().toISOString(); report.pageErrors = pageErrors; report.automaticModelCalls = aiCalls;
  await writeFile(new URL('report.json', directory), JSON.stringify(report, null, 2));
  console.log(`Project controls: ${report.status}. Report: .runtime/project-controls-${id}/report.json`);
}
