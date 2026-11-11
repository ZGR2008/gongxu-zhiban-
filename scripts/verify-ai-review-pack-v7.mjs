// Offline-only review delivery: approved REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3b data, no model or application calls.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, copyFile, access } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';

const root = resolve(import.meta.dirname, '..');
const bundledPython = process.platform === 'win32' && process.env.USERPROFILE ? join(process.env.USERPROFILE, '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe') : null;
const python = process.env.GONGXU_REVIEW_PYTHON || (bundledPython && existsSync(bundledPython) ? bundledPython : process.platform === 'win32' ? 'python' : 'python3');
const source = join(root, 'output/ai-review-v7-6963be28-3a9b-4704-9a46-14bc76df11ca');
const digest = value => createHash('sha256').update(value).digest('hex');
const files = ['review-packet.json', 'blank-review-form.json', 'read-responses.html', 'organizer-mapping.json', 'AI-PRELIMINARY-NOT-HUMAN.md'];
const contents = Object.fromEntries(await Promise.all(files.map(async name => [name, await readFile(join(source, name))])));
const packet = JSON.parse(contents['review-packet.json']);
const form = JSON.parse(contents['blank-review-form.json']);
const mapping = JSON.parse(contents['organizer-mapping.json']);
const html = contents['read-responses.html'].toString('utf8');
// Merely check presence; never read, remove, or reuse the consumed paid-call authorization.
await access(join(root, '.runtime/quality-v7-approval-consumed.json'));
assert.equal(packet.actualCalls, 13);
assert.equal(packet.samples.length, 13);
assert.equal(new Set(packet.samples.map(s => s.anonymousId)).size, 13);
for (const sample of packet.samples) {
  assert.equal(digest(sample.output), sample.outputHash);
  assert.equal(sample.independentReview, 'pending');
  assert.ok(sample.input.length > 0 && sample.atomicConditions && sample.sourceExcerpts);
}
assert.equal(packet.independentHumanReviews, 0);
assert.equal(packet.longOriginal.REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3b, true);
assert.equal(packet.longOriginal.source.length, 49781);
assert.equal(packet.longOriginal.utf16Length, 49781);
assert.deepEqual(packet.unprocessedSegments.map(s => s.part), [10, 11, 12, 13]);
assert.ok(packet.unprocessedSegments.every(s => s.status === 'not_called_after_failure'));
assert.equal(packet.unprocessedSegments.at(-1).end, packet.longOriginal.source.length);
assert.equal(form.packetHash, digest(JSON.stringify(packet)));
assert.equal(form.independentHumanConfirmation, false);
assert.equal(form.reviewer, null);
assert.deepEqual(form.rows.map(row => row.id), packet.samples.map(s => s.anonymousId));
assert.ok(form.rows.every(row => Object.entries(row).every(([key, value]) => key === 'id' || value === null)));
assert.equal(mapping.keepSeparateFromIndependentReview, true);
assert.equal(mapping.mapping.length, 13);
assert.equal(mapping.mapping.filter(row => row.phase === 'long').length, 9);
assert.equal(mapping.mapping.filter(row => row.phase === 'teacher').length, 4);
assert.ok(!/<\s*(script|iframe|object|embed|base)\b/i.test(html));
assert.ok(!/\s(?:on\w+|src|srcset|href)\s*=/i.test(html));
assert.ok(!/@import\b|url\s*\(/i.test(html));
assert.ok(!/\shttp-equiv\s*=/i.test(html));
const historicalZip = join(root, 'output/gongxu-zhiban-ai-review-v5-20261101-190101.zip');
const historicalRead = spawnSync(python, ['-c', "import zipfile,json,sys;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;print(json.dumps({'summary':json.loads(z.read('gongxu-zhiban-ai-review-v5/summary.json')),'packet':json.loads(z.read('gongxu-zhiban-ai-review-v5/reviewer/packet.json'))},ensure_ascii=True))", historicalZip], { encoding: 'utf8' });
assert.equal(historicalRead.status, 0, historicalRead.stderr);
const historical = JSON.parse(historicalRead.stdout);
assert.equal(historical.summary.savedRealCalls, 12);
assert.equal(historical.packet.samples.length, 15);
const historicalResponses = historical.packet.samples.filter(s => s.status === 'completed');
assert.equal(historicalResponses.length, 12);
assert.equal(historical.packet.samples.filter(s => s.status === 'policy_blocked').length, 3);
for (const sample of historicalResponses) {
  assert.equal(sample.outputHashConvention, 'sha256(JSON.stringify(raw_string))');
  assert.equal(digest(JSON.stringify(sample.output)), sample.outputHash);
}
const historicalBytes = await readFile(historicalZip);
const historicalEvidence = { path: historicalZip.replaceAll('\\', '/'), bytes: historicalBytes.length, sha256: digest(historicalBytes), crcPassed: true, savedRealCalls: 12, samples: 15, policyBlocked: 3, outputHashesVerified: 12, independentHumanReviews: 0, unchanged: true, mergedIntoNewExperiment: false };

const browser = await chromium.launch({ headless: true, channel: 'msedge' });
const pageErrors = [];
const forbiddenRequests = [];
let browserEvidence;
try {
  const context = await browser.newContext({ offline: true, viewport: { width: 1440, height: 1000 } });
  await context.route('**/*', route => {
    if (new URL(route.request().url()).protocol === 'file:') return route.continue();
    forbiddenRequests.push(route.request().url());
    return route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(pathToFileURL(join(source, 'read-responses.html')).href);
  assert.equal(await page.locator('article').count(), 13);
  assert.equal(await page.locator('script,iframe,object,embed').count(), 0);
  for (const [index, sample] of packet.samples.entries()) {
    const article = page.locator('article').nth(index);
    assert.equal(await article.locator('h2').innerText(), sample.anonymousId);
    assert.equal(await article.locator('pre').nth(0).textContent(), JSON.stringify(sample.input, null, 2));
    assert.equal(await article.locator('pre').nth(1).textContent(), JSON.stringify(sample.atomicConditions, null, 2));
    assert.equal(await article.locator('pre').nth(2).textContent(), sample.output);
  }
  const firstSummary = page.locator('summary').first();
  await firstSummary.focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('details').first().getAttribute('open'), '');
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('details').first().getAttribute('open'), null);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(forbiddenRequests, []);
  browserEvidence = { engine: 'Chromium (installed Microsoft Edge)', version: browser.version(), offline: true, viewport: '1440x1000', articles: 13, originalInputsExact: 13, originalOutputsExact: 13, atomicCriteriaExact: 13, keyboardExpandCollapse: 'passed', horizontalOverflow: false, externalRequests: 0, pageErrors: 0, videoRecorded: false };
} finally { await browser.close(); }

const id = new Date().toISOString().replaceAll(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z') + '-' + randomUUID().slice(0, 8);
const target = join(root, 'output', 'ai-review-delivery-v7-' + id);
await mkdir(join(target, 'reviewer'), { recursive: true });
await mkdir(join(target, 'organizer'), { recursive: true });
for (const name of files) await copyFile(join(source, name), join(target, name.startsWith('organizer') || name.startsWith('AI-PRELIMINARY') ? 'organizer' : 'reviewer', name));
const instructions = '# 工序智伴真实合成响应审核包\n\nreviewer/：13 份保存的真实输入、原始回答、引用片段、原子条件与空白审核表；打开 read-responses.html 可离线阅读，不触发模型调用。review-packet.json 另保留完整 49,781 字符合成需求及第 10–13 段未调用记录。\n\norganizer/：流程编号映射与 AI 辅助初审。请组织者保管；独立审核前不要向审核者分发，以免影响判断。匿名编号不保证双盲，内容本身可能透露流程。AI 初审不是教师或独立人工结论。\n\n审核时填写遗漏、引用支持、错误回答、正确/错误拒答、修改字符数与实际耗时，引用具体原文和回答位置；无法判断时保留空值并说明原因，不把空值当作零错误。不得改写原始输入和回答以改善结果。\n\n长规划前 8 段结构接受，第 9 段条件关联不一致导致暂停；后 4 段未调用，不能评价完整长需求或末尾条件已处理。4 份教师点评为未发布草稿。历史 12 次调用是另一批历史实验，不合并为质量通过率。尚无独立人工审核；模型别名、单次采样、无新增普通问答对照等限制见原始包。\n\n本包仅包含获授权的原创合成数据和模型回答，不含应用凭据、私人作业、源码或真实账号信息。此文件不代表新增收费调用授权。\n';
await writeFile(join(target, 'README.md'), instructions);
const sourceHashes = Object.fromEntries(files.map(name => [name, digest(contents[name])]));
const report = { version: 'v7', checkedAt: new Date().toISOString(), sourceDirectory: source.replaceAll('\\', '/'), paidAuthorizationConsumedMarkerPresent: true, paidCallsMadeByThisVerification: 0, actualSavedResponses: 13, outputHashesVerified: 13, anonymousIdsUnique: true, sourceHashes, canonicalPacketHash: form.packetHash, originalLongRequirementUtf16Length: 49781, uncalledSegments: [10, 11, 12, 13], blankHumanReviewRows: 13, independentHumanReviews: 0, reviewerOrganizerSeparated: true, htmlActiveContentAbsent: true, browser: browserEvidence, historicalArchive: historicalEvidence, setupFailureAndResolution: ['First browser attempt could not find bundled Playwright Chromium. No data was changed and no downloads were made; verification then used the already installed Microsoft Edge browser.'], limitations: ['Independent human review not performed', 'Anonymous labels do not guarantee blindness', 'Long-plan semantic completeness not verified', 'Previous 12 calls remain a separate historical experiment', 'No new paid model calls'], status: 'passed' };
await writeFile(join(target, 'verification.json'), JSON.stringify(report, null, 2));
const zipPath = join(root, 'output', 'gongxu-zhiban-ai-review-v7-' + id + '.zip');
const zipScript = `import json,hashlib,pathlib,sys,zipfile\nroot=pathlib.Path(sys.argv[1]).resolve()\noutput=pathlib.Path(sys.argv[2]).resolve()\nfiles=sorted(p for p in root.rglob('*') if p.is_file())\nwith zipfile.ZipFile(output,'x',compression=zipfile.ZIP_DEFLATED) as z:\n for p in files:z.write(p,p.relative_to(root).as_posix())\nwith zipfile.ZipFile(output) as z:\n assert z.testzip() is None\n names=z.namelist()\n assert len(names)==len(files)\n for p in files:assert z.read(p.relative_to(root).as_posix())==p.read_bytes()\n extracted=root.parent/(root.name+'-extract-check')\n extracted.mkdir(exist_ok=False)\n for name in names:\n  dest=(extracted/name).resolve()\n  assert dest.is_relative_to(extracted)\n z.extractall(extracted)\n for p in files:assert (extracted/p.relative_to(root)).read_bytes()==p.read_bytes()\nprint(json.dumps({'path':str(output),'bytes':output.stat().st_size,'sha256':hashlib.sha256(output.read_bytes()).hexdigest(),'entries':len(files),'crcPassed':True,'extractedBytesMatch':True,'extractionDirectory':str(extracted)}))\n`;
const result = spawnSync(python, ['-c', zipScript, target, zipPath], { encoding: 'utf8' });
assert.equal(result.status, 0, result.stderr);
report.archive = JSON.parse(result.stdout);
const reportFile = join(root, 'docs/verification/ai-review-pack-v7.json');
await writeFile(reportFile, JSON.stringify(report, null, 2));
await writeFile(join(root, 'output', 'ai-review-delivery-v7-' + id + '-manifest.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ status: report.status, report: reportFile, archive: report.archive, browser: browserEvidence }, null, 2));
