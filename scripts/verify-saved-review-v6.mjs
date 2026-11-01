// Re-check the existing synthetic 12-call review package. Never contacts a model.
import {readFile,writeFile,mkdir} from 'node:fs/promises';import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';import assert from 'node:assert/strict';import {chromium} from 'playwright';
const dir=new URL('../output/human-review-v5-7bfe323d-482f-4b14-9ec7-7b4e0409de8f/',import.meta.url),out=new URL(`../.runtime/saved-review-v6-${randomUUID()}/`,import.meta.url);await mkdir(out,{recursive:true});
const json=async p=>JSON.parse(await readFile(p,'utf8')),summary=await json(new URL('summary.json',dir)),packet=await json(new URL('reviewer/packet.json',dir)),form=await json(new URL('reviewer/blank-review-form.json',dir));
const digest=v=>createHash('sha256').update(v).digest('hex');
assert.equal(summary.savedRealCalls,12);assert.equal(packet.samples.length,15);assert.equal(digest(JSON.stringify(packet)),summary.packetHash);assert.equal(form.packetHash,summary.packetHash);assert.equal(form.independentHumanConfirmation,false);
const raw=await readFile(new URL('../.runtime/evaluation-live-v4-358716bb-f229-4405-8050-d9fc7f487125/report.json',import.meta.url));assert.equal(digest(raw),summary.sourceHashes.live);
for(const sample of packet.samples)if(sample.output!==null)assert.equal(digest(JSON.stringify(sample.output)),sample.outputHash);
const browser=await chromium.launch({headless:true,channel:'msedge'}),page=await browser.newPage(),errors=[],external=[];
page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>{if(!r.request().url().startsWith('file:')){external.push(new URL(r.request().url()).origin);return r.abort();}return r.continue();});
try{await page.goto(new URL('reviewer/read-responses.html',dir).href);assert.equal(await page.locator('article').count(),15);await page.getByText('完整合成输入（未截断）',{exact:true}).first().click();assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 const report={status:'passed',historicalRealCalls:12,newModelCalls:0,samples:15,policyBlocked:3,packetHash:summary.packetHash,rawReportSha256:digest(raw),rawOutputHashesVerified:true,independentHumanReviews:0,qualityImprovementPercent:null,browser:'Edge Chromium',externalRequests:0,videoRecorded:false};await writeFile(new URL('report.json',out),JSON.stringify(report,null,2));console.log(fileURLToPath(new URL('report.json',out)));
}finally{await browser.close();}
