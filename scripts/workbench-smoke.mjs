import { preventPaidModelRequests } from './no-paid-model-guard.mjs';
import { chromium, webkit } from "playwright";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// Isolated synthetic account; existing production APIs. Only --with-ai spends model quota.
const withAi = process.argv.includes("--with-ai"),
  useWebkit = process.argv.includes("--webkit");
if (
  process.argv.slice(2).some((arg) => !["--with-ai", "--webkit"].includes(arg))
)
  throw Error("Usage: pnpm smoke:workbench [--with-ai] [--webkit]");
const origin = new URL(process.env.SMOKE_WEB_URL || "http://127.0.0.1:5173");
if (
  !["http:", "https:"].includes(origin.protocol) ||
  !["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname) ||
  origin.username ||
  origin.password ||
  origin.pathname !== "/" ||
  origin.search ||
  origin.hash
)
  throw Error("SMOKE_WEB_URL must be a loopback origin");
const id = randomUUID(),
  directory = new URL(`../.runtime/workbench-${id}/`, import.meta.url);
await mkdir(directory, { recursive: true });
const report = {
  startedAt: new Date().toISOString(),
  browser: useWebkit ? "Windows WebKit" : "Chromium",
  realServices: true,
  syntheticInput: true,
  remoteAiRequested: withAi,
  controlledResponseChecks: true,
  status: "running",
  checks: [],
};
let browser,
  context,
  page,
  projectPath,
  requirement,
  secondId,
  stage = "launch",
  authenticated = false,
  pageErrors = 0,
  aiCalls = 0;
class CheckFailure extends Error {}
const assert = (condition, code) => {
  if (!condition) throw new CheckFailure(code);
};
async function check(name, work) {
  stage = name;
  const started = Date.now();
  await work();
  report.checks.push({
    name,
    status: "passed",
    durationMs: Date.now() - started,
  });
  console.log(`PASS ${name}`);
}
async function api(path, method = "GET", body) {
  return page.evaluate(
    async ({ path, method, body }) => {
      const response = await fetch(`/api${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${localStorage.getItem("gongxu_token")}`,
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      if (!response.ok) throw Error("Service check failed");
      return response.json();
    },
    { path, method, body },
  );
}
async function go(path, selector = "main h1") {
  await page.goto(new URL(path, origin).href);
  await page.locator(selector).first().waitFor();
}
async function chooseProject(path, projectId) {
  await go(path, ".wb-project-picker select");
  await page.locator(".wb-project-picker select").selectOption(projectId);
}
async function download(button) {
  const pending = page.waitForEvent("download");
  await button.click();
  return readFile(await (await pending).path(), "utf8");
}
const firstBrief =
  "# 书架验收练习\n每位学生最多同时借阅 3 本，库存为 0 时拒绝借阅。\n管理员可登记归还，重复归还不增加库存。";
try {
  const channel =
    process.env.SMOKE_BROWSER_CHANNEL ||
    (process.platform === "win32" ? "msedge" : undefined);
  browser = await (useWebkit ? webkit : chromium).launch({
    headless: true,
    ...(!useWebkit && channel ? { channel } : {}),
  });
  context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    locale: "zh-CN",
    ...(!useWebkit
      ? { permissions: ["clipboard-read", "clipboard-write"] }
      : {}),
  });
  if (!withAi) await preventPaidModelRequests(context);
  page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", () => pageErrors++);
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      /\/(analyze|generate|agent\/runs|code-reviews|knowledge\/ask)$/.test(
        new URL(request.url()).pathname,
      )
    )
      aiCalls++;
  });
  await check("real_registration_and_empty_global_pages", async () => {
    await page.goto(origin.href);
    await page
      .locator(".connection")
      .filter({ hasText: "服务可使用" })
      .waitFor();
    await page.getByRole("button", { name: "注册", exact: true }).click();
    await page
      .getByLabel("姓名", { exact: true })
      .fill("任务与交付验证 · 演示");
    await page
      .getByLabel("邮箱", { exact: true })
      .fill(`workbench-${id}@example.test`);
    await page
      .getByLabel("密码", { exact: true })
      .fill(randomBytes(24).toString("base64url"));
    await page.getByRole("button", { name: /注册并进入/ }).click();
    await page.locator(".empty-state").waitFor();
    authenticated = true;
    for (const path of ["/runs", "/delivery"]) {
      await go(path, ".wb-empty h3");
      assert(
        (await page.locator(".wb-empty h3").textContent()).includes("真实项目"),
        "empty_project_misrepresented",
      );
    }
  });
  await check("mission_search_filters_and_empty_recovery", async () => {
    await go("/missions", ".mission-card");
    assert(
      (await page.locator(".mission-card").count()) === 6,
      "mission_count",
    );
    await page.getByLabel("练习难度", { exact: true }).selectOption("入门");
    assert((await page.locator(".mission-card").count()) === 2, "level_filter");
    await page.getByLabel("任务方向", { exact: true }).selectOption("AI 应用");
    await page.getByRole("heading", { name: "没有匹配的任务" }).waitFor();
    await page.getByRole("button", { name: "清除筛选", exact: true }).click();
    await page.getByLabel("搜索实训任务").fill("RAG");
    assert((await page.locator(".mission-card").count()) === 1, "skill_search");
    await page.getByLabel("搜索实训任务").fill("");
  });
  await check(
    "local_bookmarks_survive_refresh_and_can_be_removed",
    async () => {
      await page
        .getByRole("button", { name: "收藏校园共享书架", exact: true })
        .click();
      await page.reload();
      await page.locator(".mission-card").first().waitFor();
      await page.getByRole("button", { name: "我的收藏", exact: true }).click();
      assert(
        (await page.locator(".mission-card").count()) === 1,
        "favorite_not_persisted",
      );
      await page
        .getByRole("button", { name: "取消收藏校园共享书架", exact: true })
        .click();
      await page.getByRole("heading", { name: "没有匹配的任务" }).waitFor();
      await page.getByRole("button", { name: "清除筛选", exact: true }).click();
    },
  );
  await check(
    "original_brief_creates_real_project_and_confirmed_requirement",
    async () => {
      await page.locator('a[href="/missions/campus-books"]').click();
      await page.locator(".mission-start").waitFor();
      await page
        .getByRole("button", { name: "复制完整任务书", exact: true })
        .click();
      await page
        .locator('.copy-control [role="status"]')
        .filter({ hasText: "已复制" })
        .waitFor();
      await page
        .getByLabel("实训项目名称", { exact: true })
        .fill("任务库创建的书架练习 · 演示");
      await page.getByRole("button", { name: /以此任务创建项目/ }).click();
      await page.waitForURL("**/requirements");
      projectPath = new URL(page.url()).pathname.replace(/\/requirements$/, "");
      const state = await api(projectPath);
      assert(
        state.project.description.includes("库存为 0") &&
          state.requirements.length === 0,
        "mission_not_persisted_or_auto_confirmed",
      );
      assert(
        (
          await page.getByLabel("需求内容", { exact: true }).inputValue()
        ).includes("原创实训任务书"),
        "brief_not_loaded_into_editor",
      );
      await page.getByLabel("需求内容", { exact: true }).fill(firstBrief);
      await page.getByRole("button", { name: /保存需求草稿/ }).click();
      await page
        .locator(".alert.success")
        .filter({ hasText: "需求草稿已保存" })
        .waitFor();
      await page.getByRole("button", { name: /确认最新版本/ }).click();
      await page
        .locator(".alert.success")
        .filter({ hasText: "需求版本已确认" })
        .waitFor();
      requirement = (await api(projectPath)).requirements[0];
      assert(requirement.status === "confirmed", "requirement_not_confirmed");
    },
  );
  await check(
    "manual_delivery_persistence_export_and_server_read_only",
    async () => {
      const before = await api(projectPath);
      await go("/delivery", ".delivery-check");
      await page
        .getByLabel("需求与范围核对状态", { exact: true })
        .selectOption("checked");
      await page
        .getByLabel("测试与证据核对状态", { exact: true })
        .selectOption("blocked");
      await page
        .getByLabel("测试与证据核对备注", { exact: true })
        .fill("尚未执行并发借阅场景，请在独立环境补测。");
      await page.reload();
      await page.locator(".delivery-check").first().waitFor();
      await page.locator('.delivery-grid[aria-busy="false"]').waitFor();
      assert(
        (await page
          .getByLabel("测试与证据核对状态", { exact: true })
          .inputValue()) === "blocked",
        "decision_lost",
      );
      assert(
        (
          await page
            .getByLabel("测试与证据核对备注", { exact: true })
            .inputValue()
        ).includes("独立环境"),
        "note_lost",
      );
      assert(
        (await page.getByRole("progressbar").getAttribute("aria-valuenow")) ===
          "1",
        "manual_progress_count",
      );
      const text = await download(
        page.getByRole("button", { name: "导出交付清单", exact: true }),
      );
      assert(
        text.includes("独立环境") &&
          text.includes("不是自动验收") &&
          text.includes("需求 V1"),
        "handoff_export_scope",
      );
      const after = await api(projectPath);
      assert(
        JSON.stringify(before) === JSON.stringify(after),
        "manual_checklist_mutated_project",
      );
      assert(
        (await api(`${projectPath}/test-cases`)).cases.length === 0,
        "manual_checklist_created_test_results",
      );
    },
  );
  await check(
    "checklists_are_isolated_by_project_and_requirement",
    async () => {
      secondId = (
        await api("/projects", "POST", {
          name: "独立清单范围验证 · 演示",
          description: "隔离测试项目，不代表真实学生成果。",
        })
      ).project.id;
      await chooseProject("/delivery", secondId);
      await page.locator(".delivery-check").first().waitFor();
      await page.locator('.delivery-grid[aria-busy="false"]').waitFor();
      assert(
        (await page.getByRole("progressbar").getAttribute("aria-valuenow")) ===
          "0",
        "cross_project_manual_state",
      );
      const next = await api(`${projectPath}/requirements`, "POST", {
        content: firstBrief + "\n增加归还时间记录。",
      });
      await api(
        `${projectPath}/requirements/${next.requirement.id}/confirm`,
        "POST",
      );
      await page
        .locator(".wb-project-picker select")
        .selectOption(projectPath.split("/").pop());
      await page.getByText("依据需求 V2", { exact: true }).waitFor();
      // The version header loads before the independent evidence snapshot.
      // During that read the progressbar intentionally has no numeric value.
      await page.locator('.delivery-grid[aria-busy="false"]').waitFor();
      assert(
        (await page
          .getByLabel("测试与证据核对备注", { exact: true })
          .inputValue()) === "",
        "cross_version_note",
      );
      assert(
        (await page.getByRole("progressbar").getAttribute("aria-valuenow")) ===
          "0",
        "cross_version_approval",
      );
      requirement = (await api(projectPath)).requirements[0];
    },
  );
  await check(
    "partial_read_failure_and_storage_denial_remain_explicit",
    async () => {
      const pattern = `**/api${projectPath}/test-cases`;
      await page.route(pattern, (route) =>
        route.fulfill({ status: 503, json: { error: "database_unavailable" } }),
      );
      await page
        .getByRole("button", { name: "刷新成果记录", exact: true })
        .click();
      await page.getByText("用例记录暂不可用", { exact: true }).waitFor();
      await page.unroute(pattern);
      await page
        .getByRole("button", { name: "刷新成果记录", exact: true })
        .click();
      await page.getByText(/0 条当前需求用例/).waitFor();
      await page.evaluate(() => {
        window.__workbenchSetItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
          if (key.startsWith("gongxu-delivery-v1:"))
            throw new DOMException("test quota", "QuotaExceededError");
          return window.__workbenchSetItem.call(this, key, value);
        };
      });
      await page
        .getByLabel("需求与范围核对备注", { exact: true })
        .fill("仅内存内容，必须明确提示。");
      await page
        .getByRole("alert")
        .filter({ hasText: "本机保存失败" })
        .waitFor();
      await page.evaluate(() => {
        Storage.prototype.setItem = window.__workbenchSetItem;
        delete window.__workbenchSetItem;
      });
      await page
        .getByLabel("需求与范围核对备注", { exact: true })
        .fill("存储恢复后的记录。");
      await page
        .getByRole("alert")
        .filter({ hasText: "本机保存失败" })
        .waitFor({ state: "hidden" });
    },
  );
  await check(
    "controlled_run_evidence_filters_export_and_safe_text",
    async () => {
      const run = {
        id: randomUUID(),
        requirementVersionId: requirement.id,
        status: "failed",
        createdAt: "2026-10-31T10:00:00Z",
        finishedAt: null,
        modelName: "受控边界测试记录",
        errorCode: "test_failure",
        plan: null,
      };
      const marker = "<script>window.__workbenchExecuted=true</script>";
      const detail = {
        run,
        steps: [
          {
            id: "controlled-step",
            stage: "knowledge_search",
            status: "failed",
            outputSummary: "受控响应：用于验证未知耗时与文本安全",
            startedAt: run.createdAt,
            finishedAt: null,
            tools: [
              {
                id: "controlled-tool",
                toolName: "read_evidence",
                status: "failed",
                inputSummary: "W".repeat(500),
                outputSummary: marker,
                startedAt: run.createdAt,
                finishedAt: null,
              },
            ],
          },
        ],
      };
      const listPattern = `**/api${projectPath}/agent/runs`,
        detailPattern = `**/api${projectPath}/agent/runs/${run.id}`;
      await page.route(listPattern, (route) =>
        route.fulfill({ json: { runs: [run] } }),
      );
      await page.route(detailPattern, (route) =>
        route.fulfill({ json: detail }),
      );
      await chooseProject("/runs", projectPath.split("/").pop());
      await page.locator(".run-step-evidence").waitFor();
      await page.locator(".run-step-evidence summary").click();
      await page.locator(".run-tool pre").first().waitFor();
      assert(
        (await page.locator(".run-tool pre").last().textContent()) === marker,
        "tool_output_not_literal",
      );
      assert(
        !(await page.evaluate(() => window.__workbenchExecuted)),
        "tool_output_executed",
      );
      assert(
        (await page.locator(".run-card-bottom").textContent()).includes(
          "未记录",
        ),
        "invented_duration",
      );
      const exported = JSON.parse(
        await download(
          page.getByRole("button", { name: "导出运行摘要", exact: true }),
        ),
      );
      assert(
        exported.steps[0].tools[0].outputSummary === marker &&
          exported.run.id === run.id,
        "trace_export_mismatch",
      );
      await page
        .getByLabel("运行状态", { exact: true })
        .selectOption("confirmed");
      await page.getByRole("heading", { name: "没有匹配的运行记录" }).waitFor();
      await page.getByRole("button", { name: "清除筛选", exact: true }).click();
      await page
        .getByLabel("搜索运行记录", { exact: true })
        .fill(run.id.slice(0, 8));
      await page.locator(".run-step-evidence").waitFor();
      for (const width of [320, 390, 768, 1440, 1920]) {
        await page.setViewportSize({ width, height: 1000 });
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
          `trace_overflow_${width}`,
        );
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.unroute(listPattern);
      await page.unroute(detailPattern);
      await page.getByLabel("搜索运行记录", { exact: true }).fill("");
      await page.getByRole("button", { name: "刷新记录", exact: true }).click();
      await page
        .getByRole("heading", { name: "还没有 Agent 运行记录" })
        .waitFor();
    },
  );
  if (withAi)
    await check(
      "real_deepseek_plan_visible_with_matching_stored_tools",
      async () => {
        await go(`${projectPath}/agent`, ".module-page");
        await page.getByRole("button", { name: /开始规划/ }).click();
        await page
          .getByRole("button", { name: /确认计划并创建任务/ })
          .waitFor({ timeout: 180000 });
        // Leave the newly generated plan awaiting human review; viewing must not confirm it.
        const actual = (await api(`${projectPath}/agent/runs`)).runs[0];
        assert(actual.status === "awaiting_review", "real_plan_not_reviewable");
        const evidence = await api(`${projectPath}/agent/runs/${actual.id}`);
        await chooseProject("/runs", projectPath.split("/").pop());
        await page.locator(".run-step-evidence").first().waitFor();
        assert(
          (await page.locator(".run-step-evidence").count()) ===
            evidence.steps.length,
          "real_step_count_mismatch",
        );
        const exported = JSON.parse(
          await download(
            page.getByRole("button", { name: "导出运行摘要", exact: true }),
          ),
        );
        assert(
          exported.run.id === actual.id &&
            JSON.stringify(exported.steps) === JSON.stringify(evidence.steps),
          "real_export_mismatch",
        );
        assert(
          (await api(`${projectPath}/tasks`)).tasks.length === 0,
          "view_auto_confirmed_plan",
        );
      },
    );
  await check("run_fetch_failure_recovery_and_opt_in_refresh", async () => {
    const pattern = `**/api${projectPath}/agent/runs`;
    await page.route(pattern, (route) =>
      route.fulfill({ status: 503, json: { error: "database_unavailable" } }),
    );
    await page.getByRole("button", { name: "刷新记录", exact: true }).click();
    await page.locator(".run-history .alert.error").waitFor();
    assert(
      (await page.locator(".run-metrics strong").first().textContent()) === "—",
      "failed_history_is_zero",
    );
    await page.unroute(pattern);
    await page.getByRole("button", { name: "重新读取", exact: true }).click();
    await page
      .locator(".run-history .alert.error")
      .waitFor({ state: "hidden" });
    const next = page.waitForRequest(
      (request) =>
        request.method() === "GET" &&
        new URL(request.url()).pathname === `/api${projectPath}/agent/runs`,
      { timeout: 15000 },
    );
    await page.getByLabel("每 10 秒刷新", { exact: true }).check();
    await next;
    await page.getByLabel("每 10 秒刷新", { exact: true }).uncheck();
  });
  await check(
    "responsive_routes_navigation_and_no_unrequested_ai_calls",
    async () => {
      for (const [route, selector] of [
        ["/missions", ".mission-card"],
        ["/missions/campus-books", ".mission-start"],
        ["/runs", ".run-metrics"],
        ["/delivery", ".delivery-check"],
      ]) {
        await go(route, selector);
        for (const width of [320, 390, 768, 1440, 1920]) {
          await page.setViewportSize({ width, height: 1000 });
          assert(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth + 1,
            ),
            `route_overflow_${route}_${width}`,
          );
        }
        assert(
          (await page.locator(".side-nav .active").count()) === 1,
          "multiple_active_navigation_items",
        );
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
      assert(aiCalls === (withAi ? 1 : 0), "unrequested_model_calls");
      assert(pageErrors === 0, "page_errors");
    },
  );
  await check("quick_navigation_and_logout", async () => {
    await page.keyboard.press("Control+k");
    await page.locator(".quick-nav-dialog[open]").waitFor();
    await page.locator(".quick-nav-dialog input").fill("实训任务库");
    await page.keyboard.press("Enter");
    await page.waitForURL("**/missions");
    await page.getByRole("button", { name: /退出登录/ }).click();
    await page
      .getByRole("heading", { name: "欢迎回来", exact: true })
      .waitFor();
    authenticated = false;
  });
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.checks.push({
    name: stage,
    status: "failed",
    reason:
      error instanceof CheckFailure
        ? error.message
        : error?.name === "TimeoutError"
          ? "ui_wait_timeout"
          : "check_failed",
  });
  if (page && authenticated)
    await page
      .screenshot({
        path: fileURLToPath(new URL("failure.png", directory)),
        fullPage: true,
        mask: [page.locator('input[type="password"],input[type="email"]')],
      })
      .catch(() => {});
  console.error(`FAIL ${stage}; no credentials or response bodies logged.`);
  process.exitCode = 1;
} finally {
  if (authenticated && page)
    await page
      .evaluate(async () => {
        const token = localStorage.getItem("gongxu_token");
        if (token)
          await fetch("/api/auth/logout", {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
          }).catch(() => {});
        localStorage.removeItem("gongxu_token");
      })
      .catch(() => {});
  await context?.close();
  await browser?.close();
  report.finishedAt = new Date().toISOString();
  report.pageErrors = pageErrors;
  report.modelCalls = aiCalls;
  await writeFile(
    new URL("report.json", directory),
    JSON.stringify(report, null, 2),
  );
  console.log(
    `Workbench: ${report.status}. Report: .runtime/workbench-${id}/report.json`,
  );
}
