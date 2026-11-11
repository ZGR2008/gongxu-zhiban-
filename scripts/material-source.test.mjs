import test from 'node:test';
import assert from 'node:assert/strict';
import { materialSourceLabel, executionRecordLabel } from '../apps/web/src/components/material-source.ts';

test('imported demo material is never presented as an application model call', () => {
  const label = materialSourceLabel('demo-material-import-v1');
  assert.equal(label, '演示资料导入 · AI 辅助编写 · 未调用平台模型 · 待人工审核');
  assert.doesNotMatch(label, /模型生成用例|已审核|已验证/);
});

test('normal model attribution is retained and absent attribution is not invented', () => {
  assert.equal(materialSourceLabel('deepseek-flash'), '模型来源：deepseek-flash · 需人工审核');
  for (const source of [undefined, null, '', '   ']) {
    assert.equal(materialSourceLabel(source), '资料来源未记录，需人工核对');
  }
  assert.equal(materialSourceLabel('demo-material-import-v1-copy'), '模型来源：demo-material-import-v1-copy · 需人工审核');
});

test('not-run cases do not claim an execution has been manually recorded', () => {
  assert.equal(executionRecordLabel('not_run'), '未执行，未登记执行结果');
  assert.equal(executionRecordLabel('passed'), '通过（人工登记）');
  assert.equal(executionRecordLabel('failed'), '失败（人工登记）');
  assert.equal(executionRecordLabel('blocked'), '阻塞（人工登记）');
  for (const state of [undefined, null, '', 'unknown']) {
    assert.equal(executionRecordLabel(state), '执行状态未识别，需核对记录');
  }
});

test('a later manual outcome does not rewrite the imported origin or remain not-run', () => {
  const origin = materialSourceLabel('demo-material-import-v1');
  const afterExecution = `${origin} · ${executionRecordLabel('failed')}`;
  assert.match(afterExecution, /未调用平台模型/);
  assert.match(afterExecution, /失败（人工登记）/);
  assert.doesNotMatch(afterExecution, /未执行|未登记执行结果/);
});
