// Offline only. Does not import model clients, read credentials or send network traffic.
import {mkdir,writeFile} from 'node:fs/promises';import {randomUUID,createHash} from 'node:crypto';import {fileURLToPath} from 'node:url';
import {teachingQualityVersion,teachingQualityCases,qualityRubric} from '../evaluation/teaching-quality-v7.mjs';import {longBusinessCase} from '../evaluation/long-business-cases.mjs';
const out=new URL(`../output/ai-quality-v7-${randomUUID()}/`,import.meta.url);await mkdir(out,{recursive:true});const long=longBusinessCase();
const cases=[{id:'LQ-01',kind:'long_planning',input:long,atomicConditions:long.expected},...teachingQualityCases.map(c=>({id:c.id,kind:'teacher_feedback',input:c.snapshot,atomicConditions:{must:c.must,mustNot:c.mustNot}}))];
const packet={version:teachingQualityVersion,dataScope:'original_REVIEW_PLACEHOLDER_575a8dfc08a84f40bc3b_only',newRealModelCalls:0,sourceHash:createHash('sha256').update(JSON.stringify(cases)).digest('hex'),cases,rubric:qualityRubric};
await writeFile(new URL('cases-and-rubric.json',out),JSON.stringify(packet,null,2));
await writeFile(new URL('blank-review-form.json',out),JSON.stringify({version:packet.version,sourceHash:packet.sourceHash,independentHumanConfirmation:false,reviewer:null,rows:cases.map(c=>({caseId:c.id,output:null,outputHash:null,judgments:qualityRubric.dimensions.map(d=>({dimension:d,value:null,outputSpan:null,sourceSpan:null,reason:null})),status:'awaiting_authorized_model_run_then_independent_review'}))},null,2));
await writeFile(new URL('README.md',out),'# 新能力质量核对准备\n\n本包未调用模型。长需求为既有原创多章案例（'+long.utf16Length+' UTF-16单位），含尾部禁止自批、7/14日冲突和跨章依赖；4份点评案例只含合成快照。\n\n旧12次响应独立保留在v5审核包，不用它们替代新能力质量验收。真实调用需独立批准；空白表不是评价结果。先核对原始输入/输出范围，再分别判断遗漏、支持、错误回答与拒答。教师真实审核和学生试用由参赛团队安排，本工具不联系参与者。\n');
console.log(fileURLToPath(out));
