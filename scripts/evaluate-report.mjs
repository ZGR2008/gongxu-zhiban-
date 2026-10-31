import {readFile, mkdir, writeFile, stat} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {buildEvaluationReport} from '../evaluation/report.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.some(arg => !arg.startsWith('--input=')) || args.length > 1) throw Error('Only --input=<local JSON record file> is accepted; no live calls are supported');
const source = args.length ? resolve(args[0].slice(8)) : resolve(root, 'evaluation/record-template.json');
if (!source.endsWith('.json') || (await stat(source)).size > 10_000_000) throw Error('Use a JSON record file no larger than 10 MB');
const input = JSON.parse(await readFile(source, 'utf8'));
const dataset = JSON.parse(await readFile(resolve(root, 'evaluation/cases.v1.json'), 'utf8'));
const records = Array.isArray(input) ? input : Array.isArray(input.records) ? input.records : [input];
const report = buildEvaluationReport(records, dataset);
const output = resolve(root, '.runtime', `evaluation-report-${randomUUID()}`);
await mkdir(output, {recursive: true});
await writeFile(resolve(output, 'report.json'), JSON.stringify({...report, createdAt: new Date().toISOString()}, null, 2));
const lines = ['# 离线评测记录核对', '', '本报告只核算显式提供的记录，没有执行模型、访问网络或验证人工语义判断。', '',
  `记录数：${report.recordCount}；完成：${report.totals.completed}；未执行：${report.totals.not_executed}；失败：${report.totals.failed}；策略阻止：${report.totals.policy_blocked}。`, '',
  '| 案例 | 可比状态 | 仍缺内容或限制 |', '| --- | --- | --- |',
  ...report.comparisons.map(row => `| ${row.caseId} | ${row.status} | ${row.reasons.join(', ') || '人工判定可核算；仍需核对原始输出真实性'} |`), '',
  '未填写的指标保持 null；不据此生成提升比例。用量只记录提供方实际返回的字段，不估计成本。'];
await writeFile(resolve(output, 'report.md'), lines.join('\n'));
console.log(JSON.stringify({output, records: report.recordCount, comparableCases: report.comparisons.filter(row => row.status === 'comparable_reviewed_records').length, externalCalls: 0}));
