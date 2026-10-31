import { preventPaidModelRequests } from './no-paid-model-guard.mjs';
import { chromium } from 'playwright';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// UI regression suite. Real local services, isolated synthetic account, no saved credentials.
const withAi = process.argv.includes('--with-ai');
if (process.argv.slice(2).some((arg) => arg !== '--with-ai'))
  throw new Error('Usage: pnpm smoke:ui [--with-ai]');
const origin = new URL(process.env.SMOKE_WEB_URL || 'http://127.0.0.1:5173');
if (
  !['http:', 'https:'].includes(origin.protocol) ||
  !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname) ||
  origin.username ||
  origin.password ||
  origin.search ||
  origin.hash ||
  origin.pathname !== '/'
)
  throw new Error('SMOKE_WEB_URL must be a loopback origin');
const id = randomUUID(),
  directory = new URL(`../.runtime/ui-${id}/`, import.meta.url);
await mkdir(directory, { recursive: true });
const report = {
  id,
  startedAt: new Date().toISOString(),
  realServices: true,
  syntheticInput: true,
  remoteAiRequested: withAi,
  checks: [],
  status: 'running',
};
class UiCheckFailure extends Error {}
const assert = (condition, code) => {
  if (!condition) throw new UiCheckFailure(code);
};
let browser,
  context,
  page,
  authenticated = false,
  stage = 'launch',
  projectPath,
  pageErrors = 0;
async function check(name, work) {
  stage = name;
  const started = Date.now();
  await work();
  report.checks.push({ name, status: 'passed', durationMs: Date.now() - started });
  console.log(`PASS ${name}`);
}
async function go(path) {
  await page.goto(new URL(path, origin).href);
  await page.locator('main h1').waitFor();
}
async function screenshot(name) {
  await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
  await page.waitForTimeout(200);
  await page.screenshot({ path: fileURLToPath(new URL(name, directory)), fullPage: true });
}

try {
  const channel = process.env.SMOKE_BROWSER_CHANNEL || (process.platform === 'win32' ? 'msedge' : undefined);
  browser = await chromium.launch({ headless: true, ...(channel ? { channel } : {}) });
  context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    locale: 'zh-CN',
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  if (!withAi) await preventPaidModelRequests(context);
  page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', () => {
    pageErrors++;
  });

  await check('registration_and_honest_empty_workspace', async () => {
    await page.goto(origin.href);
    await page.locator('.connection').filter({ hasText: '服务可使用' }).waitFor();
    await page.getByRole('button', { name: '注册', exact: true }).click();
    await page.getByLabel('姓名', { exact: true }).fill('界面回归演示账号');
    await page.getByLabel('邮箱', { exact: true }).fill(`ui-${id}@example.test`);
    await page.getByLabel('密码', { exact: true }).fill(randomBytes(24).toString('base64url'));
    await page.getByRole('button', { name: /注册并进入/ }).click();
    await page.locator('.empty-state').waitFor();
    authenticated = true;
    assert((await page.locator('.project-row').count()) === 0, 'unexpected_project_data');
    assert(
      (await page.locator('.workspace-facts > div').first().locator('strong').textContent()) === '00',
      'empty_metric',
    );
  });
  await check('display_preferences_and_quick_navigation', async () => {
    await page.locator('.display-settings summary').click();
    await page.getByRole('radio', { name: '紧凑', exact: true }).check();
    await page.getByRole('radio', { name: '较大', exact: true }).check();
    await page.getByRole('button', { name: /收起左侧导航/ }).click();
    await page.reload();
    await page.locator('.empty-state').waitFor();
    assert((await page.locator('body').getAttribute('data-density')) === 'compact', 'density_not_saved');
    assert((await page.locator('body').getAttribute('data-text-size')) === 'large', 'text_size_not_saved');
    assert(
      (await page.locator('.sidebar').evaluate((element) => element.getBoundingClientRect().width)) === 76,
      'sidebar_not_saved',
    );
    await page.locator('.display-settings summary').click();
    await page.getByRole('button', { name: '恢复默认显示', exact: true }).click();
    await page.keyboard.press('Escape');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert(
      (await page
        .locator('.nav-item.active')
        .evaluate((element) => getComputedStyle(element, '::before').animationName)) === 'none',
      'navigation_ignores_reduced_motion',
    );
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.keyboard.press('Control+k');
    await page.locator('#quick-nav-query').fill('知识库');
    const beforeComposition = page.url();
    await page
      .locator('#quick-nav-query')
      .evaluate((element) =>
        element.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }),
        ),
      );
    assert(page.url() === beforeComposition, 'composition_changed_route');
    assert(
      await page.locator('.quick-nav-dialog').evaluate((element) => element.open),
      'composition_closed_dialog',
    );
    await page.keyboard.press('Enter');
    await page.waitForURL('**/knowledge');
    await page.getByRole('button', { name: /快速导航，/ }).click();
    await page.keyboard.press('Escape');
    assert(
      await page
        .getByRole('button', { name: /快速导航，/ })
        .evaluate((element) => element === document.activeElement),
      'dialog_focus_not_restored',
    );
  });
  await check('project_creation_filters_and_view_switch', async () => {
    await go('/dashboard');
    await page.getByRole('button', { name: /创建实训项目/ }).click();
    assert(
      await page.getByLabel('项目名称').evaluate((element) => element === document.activeElement),
      'create_focus',
    );
    await page.getByLabel('项目名称').fill(`校园借阅 · 界面演示 ${id.slice(0, 8)}`);
    await page.getByLabel('项目想法').fill('用于界面回归验证的虚构项目，不是真实学生作业。');
    await page
      .locator('form')
      .getByRole('button', { name: /创建项目/ })
      .click();
    await page.waitForURL(/\/projects\/[a-f0-9-]+$/);
    projectPath = new URL(page.url()).pathname;
    await go('/projects');
    await page.locator('.project-row').first().waitFor();
    await page.getByLabel('搜索项目', { exact: true }).fill('no-project');
    await page.getByText('没有符合条件的项目', { exact: true }).waitFor();
    await page.getByRole('button', { name: '清除筛选', exact: true }).click();
    await page.getByLabel('项目状态', { exact: true }).selectOption('archived');
    await page.getByText('没有符合条件的项目', { exact: true }).waitFor();
    await page.getByRole('button', { name: '清除筛选', exact: true }).click();
    await page.getByLabel('项目排序', { exact: true }).selectOption('name');
    await page.getByRole('button', { name: '网格视图', exact: true }).click();
    await page.locator('.project-list--grid').waitFor();
  });
  await check('markdown_preview_outline_safety_and_save', async () => {
    await go(`${projectPath}/requirements`);
    await page.getByLabel('需求内容', { exact: true }).waitFor();
    const sample =
      '# 校园借阅 · 界面演示\n\n## 用户与目标\n学生登录后查找资料并申请借阅，管理员办理归还。\n\n## 业务限制\n每人最多借阅三份，零库存时禁止借阅。\n\n## 验收范围\n包含正常借阅、零库存、数量边界和未登录场景。\n\n| 场景 | 结果 |\n| --- | --- |\n| 零库存 | 拒绝借阅 |\n\n<script>window.__unsafeUi=true</script>\n\n![不应请求的外部图片](https://example.invalid/ui-image.png)';
    let externalImageRequests = 0;
    const observe = (request) => {
      if (request.url().includes('example.invalid')) externalImageRequests++;
    };
    page.on('request', observe);
    await page.getByLabel('需求内容', { exact: true }).fill(sample);
    await page.getByRole('button', { name: '预览', exact: true }).click();
    await page.locator('.rich-content table').waitFor();
    await page.getByRole('button', { name: '文档大纲', exact: true }).click();
    assert((await page.locator('.document-outline button').count()) === 4, 'outline_mismatch');
    await page.locator('.document-outline button').last().click();
    assert(await page.evaluate(() => !window.__unsafeUi), 'raw_html_executed');
    assert(externalImageRequests === 0, 'model_image_requested');
    page.off('request', observe);
    await page.getByRole('button', { name: '复制文本', exact: true }).click();
    await page.getByText('已复制', { exact: true }).waitFor();
    await page.getByRole('button', { name: '编辑', exact: true }).click();
    await page.getByLabel('需求内容', { exact: true }).fill(sample.split('<script>')[0]);
    await page.getByRole('button', { name: /保存需求草稿/ }).click();
    await page.locator('.version-list li').waitFor();
    await page.getByRole('button', { name: /确认最新版本/ }).click();
    await page.locator('.version-list').getByText('已确认', { exact: true }).waitFor();
  });
  await check('code_draft_keyboard_copy_and_size_controls', async () => {
    await go(`${projectPath}/reviews`);
    const input = page.getByLabel('代码内容', { exact: true });
    await input.fill('const maximum: number = 3;');
    await input.press('Tab');
    assert((await input.inputValue()).endsWith('  '), 'code_indentation');
    await input.press('Escape');
    await page.keyboard.press('Tab');
    assert(await input.evaluate((element) => element !== document.activeElement), 'code_keyboard_trap');
    await page.getByRole('button', { name: '展开编辑器', exact: true }).click();
    await page.locator('.code-editor--expanded').waitFor();
    await page.getByRole('button', { name: '缩小代码字号', exact: true }).click();
    await page.getByRole('button', { name: '放大代码字号', exact: true }).click();
    await page.getByRole('button', { name: '复制代码', exact: true }).click();
    await page.getByText('已复制', { exact: true }).waitFor();
    if (withAi) {
      await page.getByRole('button', { name: /提交审查/ }).click();
      await page.getByRole('heading', { name: 'AI 审查建议', exact: true }).waitFor({ timeout: 180000 });
    }
  });
  await check('knowledge_sources_real_index_and_copy', async () => {
    await go('/knowledge');
    const knowledgeText =
      '这是自行编写的界面回归演示资料，不是课程标准。校园借阅项目的业务限制为：学生每人最多借阅三份资料，零库存时禁止借阅。测试应覆盖合法借阅、零库存、超过三份限制、未登录以及管理员归还。测试的初始状态为未执行，必须实际操作后才能记录结果。需求应先经学生确认，再拆成开发、审查、测试和交付任务。代码语法检测与 AI 建议必须分开，不能声称未经执行的建议已经验证。交付文档应注明未提供的环境和接口信息。';
    const transfer = await page.evaluateHandle((text) => {
      const data = new DataTransfer();
      data.items.add(new File([text], '借阅规则-界面演示.txt', { type: 'text/plain' }));
      return data;
    }, knowledgeText);
    await page.locator('.file-drop-zone').dispatchEvent('drop', { dataTransfer: transfer });
    await transfer.dispose();
    await page.getByText(/已选择，保存后才会导入/).waitFor();
    await page.waitForFunction(
      (text) => document.querySelector('#knowledge-content')?.value === text,
      knowledgeText,
    );
    await page.getByLabel('文档名称', { exact: true }).fill('借阅规则 · 界面演示资料');
    await page.getByRole('button', { name: /保存并分块/ }).click();
    await page.getByRole('button', { name: '建立索引', exact: true }).click();
    await page.getByText('可检索', { exact: true }).waitFor({ timeout: 90000 });
    await page.getByLabel('检索问题', { exact: true }).fill('校园借阅有哪些数量和库存限制，如何设计测试？');
    await page.getByRole('button', { name: /检索知识/ }).click();
    await page.locator('.knowledge-source').first().waitFor();
    const source = page.locator('.knowledge-source').first();
    await source.getByRole('button', { name: '复制片段', exact: true }).click();
    await source.getByText('已复制', { exact: true }).waitFor();
    await source.locator('.source-metadata summary').click();
    await source.getByText('片段 ID', { exact: true }).waitFor();
    if (withAi) {
      await page.getByRole('button', { name: /知识增强回答/ }).click();
      await page.locator('.rich-content').waitFor({ timeout: 180000 });
      assert((await page.locator('.knowledge-source').count()) > 0, 'answer_without_sources');
    }
  });
  if (withAi) {
    await check('agent_trace_dependency_graph_and_task_board', async () => {
      await go(`${projectPath}/agent`);
      await page.getByRole('button', { name: /开始规划/ }).click();
      await page.getByRole('heading', { name: '待审阅计划', exact: true }).waitFor({ timeout: 190000 });
      assert((await page.locator('.agent-stage-strip li').count()) === 4, 'agent_stages_missing');
      const count = await page.locator('.agent-plan-grid > article').count();
      assert(count > 0, 'empty_plan');
      await page.getByRole('button', { name: '依赖关系', exact: true }).click();
      assert((await page.locator('.plan-map-node').count()) === count, 'graph_nodes');
      await page.locator('.plan-map-node').last().focus();
      await page.keyboard.press('Enter');
      assert(
        (await page.locator('.plan-map-node').last().getAttribute('aria-pressed')) === 'true',
        'graph_keyboard',
      );
      await page.getByRole('button', { name: /确认计划并创建任务/ }).click();
      await page.locator('.task-work-item').first().waitFor();
      await page.getByRole('button', { name: '任务看板视图', exact: true }).click();
      assert((await page.locator('.task-lane').count()) === 5, 'board_lanes');
      await page.getByRole('button', { name: '任务列表视图', exact: true }).click();
      await page.locator('.task-status-label select').first().selectOption('doing');
      await page.reload();
      await page.locator('.task-status-label select').first().waitFor();
      assert(
        (await page.locator('.task-status-label select').first().inputValue()) === 'doing',
        'task_persistence',
      );
      await page.getByLabel('搜索已确认任务', { exact: true }).fill('no-task');
      await page.getByRole('button', { name: '清除筛选', exact: true }).click();
      assert((await page.locator('.task-work-item').count()) === count, 'task_filter_loss');
      await screenshot('agent.png');
    });
    await check('test_filter_and_explicit_manual_result', async () => {
      await go(`${projectPath}/tests`);
      await page.getByRole('button', { name: /生成测试用例/ }).click();
      await page.locator('.case-item').first().waitFor({ timeout: 180000 });
      await page.getByLabel('测试类别筛选', { exact: true }).selectOption('boundary');
      assert((await page.locator('.case-item:visible').count()) > 0, 'boundary_cases_missing');
      await page.getByLabel('测试类别筛选', { exact: true }).selectOption('all');
      const first = page.locator('.case-item').first();
      const resultFieldId = await first.getByLabel('人工执行结果', { exact: true }).getAttribute('id');
      await first.getByLabel('人工执行结果', { exact: true }).selectOption('blocked');
      await first
        .getByLabel('执行说明 / 证据', { exact: true })
        .fill('界面演示：仅验证人工状态记录与持久化，没有执行示例项目代码，故标记为阻塞。');
      await first.getByRole('button', { name: '保存执行结果', exact: true }).click();
      await first.getByText(/记录时间：/).waitFor();
      await page.getByLabel('执行状态筛选', { exact: true }).selectOption('blocked');
      assert((await page.locator('.case-item:visible').count()) === 1, 'manual_result_filter');
      await page.reload();
      await page.locator(`[id="${resultFieldId}"]`).waitFor();
      assert(
        (await page.locator(`[id="${resultFieldId}"]`).inputValue()) === 'blocked',
        'manual_result_not_saved',
      );
    });
    await check('document_preview_edit_save_and_export', async () => {
      await go(`${projectPath}/documents`);
      await page.getByRole('button', { name: /生成草稿/ }).click();
      const editor = page.getByLabel('文档内容', { exact: true });
      await editor.waitFor({ timeout: 180000 });
      const text = `${await editor.inputValue()}\n\n> 界面回归演示：本段用于验证文档编辑、保存与导出。`;
      await editor.fill(text);
      await page.getByRole('button', { name: '分栏', exact: true }).click();
      await page.locator('.rich-content').waitFor();
      await page.getByRole('button', { name: /保存文档/ }).click();
      await page.getByText('文档已保存。', { exact: true }).waitFor();
      const pending = page.waitForEvent('download');
      await page.getByRole('button', { name: '导出 Markdown', exact: true }).click();
      const download = await pending;
      const file = fileURLToPath(new URL('document.md', directory));
      await download.saveAs(file);
      assert((await readFile(file, 'utf8')) === text, 'export_content_changed');
      await screenshot('documents.png');
    });
  }
  await check('responsive_layout_and_dark_surfaces', async () => {
    for (const width of [320, 390, 768, 1280, 1920]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const route of [
        '/dashboard',
        '/knowledge',
        '/growth',
        ...['requirements', 'agent', 'reviews', 'tests', 'documents'].map(
          (module) => `${projectPath}/${module}`,
        ),
      ]) {
        await go(route);
        await page.locator('.connection').filter({ hasText: '服务可使用' }).waitFor();
        assert(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2),
          `overflow_${width}`,
        );
        assert(
          (await page.locator('body').evaluate((element) => getComputedStyle(element).backgroundColor)) ===
            'rgb(10, 6, 20)',
          'light_background',
        );
      }
    }
    // Controlled response-only edge case; no long strings are written to the server.
    report.controlledLongContent = true;
    function longNames(value) {
      if (Array.isArray(value)) return value.map(longNames);
      if (!value || typeof value !== 'object') return value;
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key,
          typeof item === 'string' && ['name', 'title', 'projectName'].includes(key)
            ? `界面长文本演示-${'W'.repeat(100)}`
            : longNames(item),
        ]),
      );
    }
    const routePattern = '**/api/**';
    await page.route(routePattern, async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      const response = await route.fetch();
      if (!response.headers()['content-type']?.includes('application/json'))
        return route.fulfill({ response });
      return route.fulfill({ response, json: longNames(await response.json()) });
    });
    for (const width of [320, 1280]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const path of ['/knowledge', '/growth', `${projectPath}/agent`]) {
        await go(path);
        await page.waitForTimeout(250);
        assert(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2),
          `long_text_overflow_${width}`,
        );
      }
    }
    await page.unroute(routePattern);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await go('/dashboard');
    await page.locator('.project-row').first().waitFor();
    await screenshot('workspace.png');
    assert(pageErrors === 0, 'browser_errors');
  });
  await check('session_logout', async () => {
    await page.getByRole('button', { name: /退出登录/ }).click();
    await page.getByRole('heading', { name: '欢迎回来', exact: true }).waitFor();
    assert((await page.evaluate(() => localStorage.getItem('gongxu_token'))) === null, 'session_not_cleared');
    authenticated = false;
  });
  report.status = 'passed';
} catch (error) {
  if (authenticated && page)
    await page
      .screenshot({
        path: fileURLToPath(new URL('failure.png', directory)),
        fullPage: true,
        mask: [page.locator('input[type="password"],input[type="email"]')],
      })
      .catch(() => {});
  report.status = 'failed';
  report.checks.push({
    name: stage,
    status: 'failed',
    reason:
      error instanceof UiCheckFailure
        ? error.message
        : error?.name === 'TimeoutError'
          ? 'ui_wait_timeout'
          : 'ui_check_failed',
  });
  console.error(`FAIL ${stage}; inspect the local report. No credentials or response bodies were logged.`);
  process.exitCode = 1;
} finally {
  if (authenticated && page)
    await page
      .evaluate(async () => {
        const token = localStorage.getItem('gongxu_token');
        if (token)
          await fetch('/api/auth/logout', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
          }).catch(() => {});
        localStorage.removeItem('gongxu_token');
      })
      .catch(() => {});
  await context?.close();
  await browser?.close();
  report.pageErrors = pageErrors;
  report.finishedAt = new Date().toISOString();
  await writeFile(new URL('report.json', directory), JSON.stringify(report, null, 2));
  console.log(`UI result: ${report.status}. Report: .runtime/ui-${id}/report.json`);
}
