import test from 'node:test';
import assert from 'node:assert/strict';
import { compareLines, requirementText } from '../apps/web/src/components/line-diff.ts';
import { summarizeProject } from '../apps/web/src/components/project-pulse-model.ts';

const resource = (data) => ({ data, error: null });
const caseResource=(cases)=>{const scoped=cases.filter(c=>c.requirementVersionId==='current');return resource({cases,summary:{requirementVersionId:'current',requirementVersion:2,caseRevision:1,capturedAt:'2026-11-01T00:00:00Z',total:scoped.length,passed:scoped.filter(c=>c.result==='passed').length,failed:scoped.filter(c=>c.result==='failed').length,blocked:scoped.filter(c=>c.result==='blocked').length,notRun:scoped.filter(c=>c.result==='not_run').length}});};
const empty = () => ({ runs: resource([]), tasks: resource([]), cases: caseResource([]), docs: resource([]), reviews: resource([]) });
const requirements = [{ id: 'current', version: 2, status: 'confirmed' }, { id: 'old', version: 1, status: 'confirmed' }];
const currentRun = { id: 'run', requirementVersionId: 'current', createdAt: '2026-10-31T10:00:00Z', status: 'confirmed' };

test('line comparison preserves both originals including repeated and blank lines', () => {
  const before = '标题\n重复\n旧内容\n\n重复\n末行';
  const after = '标题\n新增\n重复\n\n重复\n末行\n';
  const result = compareLines(before, after);
  assert.equal(result.rows.filter(row => row.kind !== 'added').map(row => row.text).join('\n'), before);
  assert.equal(result.rows.filter(row => row.kind !== 'removed').map(row => row.text).join('\n'), after);
  assert.deepEqual(result.rows.filter(row => row.before != null).map(row => row.before), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(result.rows.filter(row => row.after != null).map(row => row.after), [1, 2, 3, 4, 5, 6, 7]);
});
test('equal content and line endings do not produce artificial changes', () => {
  const result = compareLines('一\r\n二\r\n', '一\n二\n');
  assert.equal(result.added, 0); assert.equal(result.removed, 0);
});
test('empty versions and complete replacements have exact line numbers', () => {
  assert.deepEqual(compareLines('', '').rows, []);
  assert.equal(compareLines('', '新内容').rows[0].before, null);
  assert.equal(compareLines('旧内容', '').rows[0].after, null);
  assert.deepEqual(compareLines('一\n二', '三').rows.map(row => row.kind), ['removed', 'removed', 'added']);
});
test('large adversarial changes use bounded replacement without losing text', () => {
  const a = Array.from({ length: 1500 }, (_, i) => `旧${i}`).join('\n');
  const b = Array.from({ length: 1500 }, (_, i) => `新${i}`).join('\n');
  const result = compareLines(a, b);
  assert.equal(result.coarse, true);
  assert.equal(result.added, 1500); assert.equal(result.removed, 1500);
  assert.equal(result.rows.filter(row => row.kind !== 'removed').map(row => row.text).join('\n'), b);
});
test('structured historic requirements remain readable', () => {
  assert.equal(requirementText({ text: '# 需求' }), '# 需求');
  assert.equal(requirementText(undefined), '');
  assert.equal(requirementText({ goal: '学习' }), '{\n  "goal": "学习"\n}');
});
test('new project suggests requirement confirmation without inventing progress', () => {
  const result = summarizeProject([], empty());
  assert.equal(result.confirmed, undefined); assert.equal(result.tasks.length, 0);
  assert.equal(result.next.route, 'requirements'); assert.equal(result.docKinds.length, 0);
});
test('latest confirmed requirement is selected even if input is unsorted', () => {
  const data = empty(); data.runs = resource([{ ...currentRun, requirementVersionId: 'old' }]);
  const result = summarizeProject([...requirements].reverse(), data);
  assert.equal(result.confirmed.id, 'current'); assert.equal(result.latestRun, undefined);
  assert.equal(result.next.route, 'agent');
});
test('new draft is surfaced without attributing older evidence to it', () => {
  const result = summarizeProject([...requirements, { id: 'draft', version: 3, status: 'draft' }], empty());
  assert.equal(result.confirmed.id, 'current'); assert.equal(result.next.route, 'requirements');
  assert.match(result.next.detail, /版本 2/);
});
test('old requirement tests and documents do not count toward current progress', () => {
  const data = empty(); data.runs = resource([currentRun]);
  data.cases = caseResource([{ id: 'old-test', requirementVersionId: 'old', result: 'passed' }, { id: 'new-test', requirementVersionId: 'current', result: 'not_run' }]);
  data.docs = resource([{ id: 'old-doc', requirementVersionId: 'old', type: 'readme' }]);
  const result = summarizeProject(requirements, data);
  assert.equal(result.cases.length, 1); assert.equal(result.recorded, 0); assert.equal(result.passed, 0); assert.equal(result.docKinds.length, 0);
});

test('historical or unversioned task completion cannot count toward current requirement', () => {
  const data=empty();data.runs=resource([currentRun]);
  data.tasks=resource([{id:'old',title:'旧需求已完成',status:'done',requirementVersionId:'old'},{id:'unknown',title:'来源未知',status:'done'},{id:'current',title:'当前待开始',status:'todo',requirementVersionId:'current'}]);
  const summary=summarizeProject(requirements,data);
  assert.equal(summary.tasks.length,1);assert.equal(summary.done,0);assert.equal(summary.tasks[0].id,'current');
});
test('awaiting review and failed plans remain explicit human actions', () => {
  for (const status of ['awaiting_review', 'failed']) {
    const data = empty(); data.runs = resource([{ ...currentRun, status }]);
    const result = summarizeProject(requirements, data);
    assert.equal(result.next.route, 'agent'); assert.equal(result.next.tone, 'attention');
    assert.equal(result.done, 0);
  }
});
test('partial reads stay unavailable instead of suggesting no records exist', () => {
  const data = empty(); data.runs = { data: null, error: '读取失败' };
  const result = summarizeProject(requirements, data);
  assert.equal(result.errors, 1); assert.match(result.next.title, /无法读取/);
});
test('limited history is not treated as proof that a plan never existed', () => {
  const data = empty(); data.runs = resource(Array.from({ length: 100 }, (_, index) => ({ ...currentRun, id: String(index), requirementVersionId: 'old' })));
  assert.match(summarizeProject(requirements, data).next.detail, /不能据此判断完整历史/);
});
test('blocked tasks and failed tests take precedence over document preparation', () => {
  const data = empty(); data.runs = resource([currentRun]);
  data.tasks = resource([{ id: 'blocked', title: '待处理', status: 'blocked', requirementVersionId:'current' }]);
  data.cases = caseResource([{ id: 'failed', requirementVersionId: 'current', result: 'failed' }]);
  assert.equal(summarizeProject(requirements, data).next.route, 'agent');
  data.tasks = resource([]);
  const result = summarizeProject(requirements, data);
  assert.equal(result.next.route, 'tests'); assert.equal(result.recorded, 1); assert.equal(result.passed, 0);
});
test('duplicate document types are not counted twice', () => {
  const data = empty(); data.docs = resource([{ id: '1', requirementVersionId: 'current', type: 'readme' }, { id: '2', requirementVersionId: 'current', type: 'readme' }]);
  assert.deepEqual(summarizeProject(requirements, data).docKinds, ['readme']);
});
test('a fully recorded project still requires review rather than automatic acceptance', () => {
  const data = empty(); data.runs = resource([currentRun]);
  data.tasks = resource([{ id: 'done', title: '任务', status: 'done', requirementVersionId:'current' }]);
  data.cases = caseResource([{ id: 'pass', requirementVersionId: 'current', result: 'passed' }]);
  data.docs = resource(['readme', 'requirements', 'design', 'api', 'test_report', 'summary'].map(type => ({ id: type, type, requirementVersionId: 'current' })));
  assert.match(summarizeProject(requirements, data).next.detail, /不等于项目已验收/);
});

test('full test totals surface a failure hidden behind a page of passing cases',()=>{
 const data=empty();data.runs=resource([currentRun]);data.cases=caseResource(Array.from({length:200},(_,i)=>({id:String(i),result:'passed',requirementVersionId:'current'})));
 data.cases.data.summary={...data.cases.data.summary,total:201,failed:1};
 const value=summarizeProject(requirements,data);assert.equal(value.recorded,201);assert.equal(value.passed,200);assert.equal(value.issues,1);assert.match(value.next.title,/1 条测试记录需要跟进/);
});
test('missing, inconsistent and wrong-version totals cannot imply complete success',()=>{
 const data=empty();data.runs=resource([currentRun]);data.cases=caseResource([{id:'pass',result:'passed',requirementVersionId:'current'}]);const good=data.cases.data.summary;
 for(const bad of [null,{...good,requirementVersionId:'old'},{...good,total:201}]){data.cases.data.summary=bad;const value=summarizeProject(requirements,data);assert.equal(value.testCounts,null);assert.equal(value.errors,1);assert.match(value.next.title,/暂不可用/);}
});
