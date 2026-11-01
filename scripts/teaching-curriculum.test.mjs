import {test} from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {curriculum} from '../knowledge/teaching-v6/catalog.mjs';
test('curriculum contains 48 distinct substantial lessons in eight domains plus three original business cases',()=>{
 assert.equal(curriculum.length,51);assert.equal(new Set(curriculum.map(d=>d.lessonId)).size,51);assert.equal(new Set(curriculum.map(d=>d.title)).size,51);
 assert.equal(new Set(curriculum.map(d=>createHash('sha256').update(d.text).digest('hex'))).size,51);
 const topics=curriculum.filter(d=>d.category!=='原创案例');assert.equal(new Set(topics.map(d=>d.category)).size,8);
 for(const d of curriculum){assert.ok(d.text.length>=550,d.lessonId);for(const heading of ['场景','知识点','示例','常见错误与边界','验收要点','来源说明'])assert.ok(d.text.includes('## '+heading));assert.match(d.text,/非学校制度或官方标准/);assert.match(d.text,/独立教师尚未审阅/);for(const s of d.sources)assert.ok(new URL(s.url).protocol==='https:');}
});
test('corpus preserves tail restriction, conflicting draft provenance and no invented school fine',()=>{
 const lending=curriculum.find(d=>d.lessonId==='GX-CASE-01');assert.match(lending.text,/BOR-09/);assert.match(lending.text,/不得作为自己的最终验收人/);
 const library=curriculum.find(d=>d.lessonId==='GX-CASE-02');assert.match(library.text,/七日/);assert.match(library.text,/十四日/);assert.match(library.text,/罚款多少.*资料不足/);
});
