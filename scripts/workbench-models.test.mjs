import test from "node:test";
import assert from "node:assert/strict";
import {
  missions,
  missionBrief,
  elapsedMs,
  durationLabel,
  deliveryChecks,
  blankDelivery,
  readDelivery,
  deliveryKey,
} from "../apps/web/src/pages/workbench-data.ts";

test("mission routes are unique and briefs fit the existing project API limits", () => {
  assert.equal(new Set(missions.map((item) => item.id)).size, missions.length);
  for (const item of missions) {
    assert.match(item.id, /^[a-z]+(?:-[a-z]+)*$/);
    assert.ok(item.title.length <= 120);
    const brief = missionBrief(item);
    assert.ok(brief.length > 100 && brief.length <= 10000);
    assert.ok(brief.includes("不表示功能已经实现"));
    for (const condition of item.acceptance)
      assert.ok(brief.includes(condition));
  }
});
test("missing, malformed or reversed timestamps remain unknown", () => {
  assert.equal(elapsedMs(null, "2026-10-31T12:00:00Z"), null);
  assert.equal(elapsedMs("2026-10-31T12:00:00Z", null), null);
  assert.equal(elapsedMs("not-a-date", "2026-10-31T12:00:00Z"), null);
  assert.equal(elapsedMs("2026-10-31T12:01:00Z", "2026-10-31T12:00:00Z"), null);
});
test("actual time calculations preserve zero and timezone offsets", () => {
  assert.equal(elapsedMs("2026-10-31T12:00:00Z", "2026-10-31T12:00:00Z"), 0);
  assert.equal(
    elapsedMs("2026-10-31T20:00:00+08:00", "2026-10-31T12:00:01.234Z"),
    1234,
  );
});
test("duration presentation never invents elapsed time and handles minute carry", () => {
  for (const value of [null, NaN, Infinity, -1])
    assert.equal(durationLabel(value), "未记录");
  assert.equal(durationLabel(0), "0 ms");
  assert.equal(durationLabel(119999), "2 分 0 秒");
  assert.equal(durationLabel(62300), "1 分 2 秒");
});
test("a new checklist contains no automatic human approvals", () => {
  const record = blankDelivery();
  assert.equal(record.updatedAt, null);
  assert.deepEqual(
    Object.keys(record.items),
    deliveryChecks.map((item) => item.id),
  );
  assert.ok(
    Object.values(record.items).every(
      (item) => item.status === "todo" && item.note === "",
    ),
  );
});
test("checklist instances are isolated from each other", () => {
  const first = blankDelivery();
  const second = blankDelivery();
  first.items.tests.status = "checked";
  first.items.tests.note = "已人工执行";
  assert.equal(second.items.tests.status, "todo");
  assert.equal(second.items.tests.note, "");
});
test("corrupt and unsupported storage does not crash or approve a checklist", () => {
  for (const raw of [
    null,
    "",
    "{",
    "null",
    "[]",
    '{"version":2,"items":{}}',
    '{"version":1,"items":null}',
  ])
    assert.deepEqual(readDelivery(raw), blankDelivery());
});
test("valid manual decisions and notes survive persistence", () => {
  const original = blankDelivery();
  original.updatedAt = "2026-10-31T12:00:00Z";
  original.items.tests = {
    status: "blocked",
    note: "库存并发场景尚未测试\n需要独立测试环境。",
  };
  original.items.requirements = { status: "checked", note: "已核对版本 2。" };
  assert.deepEqual(readDelivery(JSON.stringify(original)), original);
});
test("untrusted stored fields, invalid statuses and excessive notes are discarded", () => {
  const value = {
    version: 1,
    updatedAt: "bad-date",
    items: {
      tests: { status: "passed", note: "自动通过" },
      requirements: { status: "checked", note: "x".repeat(2001) },
      demo: { status: "blocked", note: "待部署", token: "REVIEW_PLACEHOLDER_7ac4d14785834db38d90" },
      invented: { status: "checked", note: "" },
    },
  };
  const restored = readDelivery(JSON.stringify(value));
  assert.equal(restored.updatedAt, null);
  assert.equal(restored.items.tests.status, "todo");
  assert.equal(restored.items.requirements.status, "todo");
  assert.deepEqual(restored.items.demo, { status: "blocked", note: "待部署" });
  assert.equal(Object.keys(restored.items).length, 6);
});
test("storage scopes do not reuse a decision for another project or requirement", () => {
  assert.equal(
    new Set([
      deliveryKey("project-a"),
      deliveryKey("project-b"),
      deliveryKey("project-a", "req-1"),
      deliveryKey("project-a", "req-2"),
    ]).size,
    4,
  );
});
