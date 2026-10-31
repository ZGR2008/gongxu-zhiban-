import {createServer} from 'node:http';
import {readFile,mkdir,cp,readdir,writeFile} from 'node:fs/promises';
import {extname,resolve,relative,sep,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';

// Local production assets + controlled synthetic API. Never reads config, DB or AI.
const root=fileURLToPath(new URL('../',import.meta.url));
const label=process.argv.find(arg=>arg.startsWith('--label='))?.slice(8)??'current';
if(!/^[a-z0-9-]{1,32}$/.test(label))throw Error('Use a short non-sensitive measurement label');
const source=resolve(root,process.argv.find(arg=>arg.startsWith('--dist='))?.slice(7)??'apps/web/dist');
if(!source.startsWith(resolve(root)+sep)||!source.endsWith(sep+'dist'))throw Error('Only local workspace production dist directories are accepted');
const out=join(root,'.runtime',`web-entry-${label}-${randomUUID()}`),dist=join(out,'dist');
await mkdir(out,{recursive:true});await cp(source,dist,{recursive:true,errorOnExist:true,force:false});
const report={scope:'loopback_production_assets_controlled_api_not_user_speed_or_ai_quality',label,commit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),startedAt:new Date().toISOString(),viewport:{width:1536,height:960},cpuSlowdown:4,network:'loopback_no_emulated_delay',samples:[],assets:[]};
for(const name of await readdir(join(dist,'assets'))){if(name.endsWith('.js')){const data=await readFile(join(dist,'assets',name));report.assets.push({name,bytes:data.length,gzipBytes:gzipSync(data).length,sha256:createHash('sha256').update(data).digest('hex')});}}
const mime={'.js':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.json':'application/json'};
const server=createServer(async(request,response)=>{
 try{const url=new URL(request.url,'http://localhost');const path=resolve(dist,'.'+decodeURIComponent(url.pathname));if(relative(dist,path).startsWith('..'+sep)){response.writeHead(403).end();return;}
  const target=extname(path)?path:join(dist,'index.html');const data=await readFile(target);response.writeHead(200,{'content-type':mime[extname(target)]??'application/octet-stream','cache-control':'no-store'});response.end(data);
 }catch{response.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
let browser,activePage;
try{
 browser=await chromium.launch({headless:true,channel:process.platform==='win32'?'msedge':undefined});
 for(let index=0;index<3;index++){
  const context=await browser.newContext({viewport:report.viewport,reducedMotion:'reduce'});await context.addInitScript(()=>localStorage.setItem('gongxu_token','controlled-performance-fixture'));
  const page=await context.newPage();activePage=page;page.setDefaultTimeout(15000);const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:report.cpuSlowdown});let errors=0;page.on('pageerror',error=>{errors++;report.pageErrors??=[];report.pageErrors.push({name:error.name,message:error.message.slice(0,200)});});
  await page.route('**/*',route=>{
   const url=new URL(route.request().url());if(url.origin!==origin)return route.abort();if(!url.pathname.startsWith('/api/'))return route.continue();
   const path=url.pathname.slice(4),now='2026-11-01T00:00:00Z';const body=path==='/health'?{status:'ok',service:'gongxu-api'}:path==='/ready'?{status:'ready'}:path==='/ai/status'?{configured:false}:path==='/projects'?{projects:[{id:'11111111-1111-4111-8111-111111111111',name:'首屏性能合成项目',description:'固定测试资料，不是真实业务数据',status:'active',createdAt:now,updatedAt:now}]}:{error:'not_found'};
   return route.fulfill({status:body.error?404:200,json:body});
  });
  const start=performance.now();await page.goto(origin+'/dashboard');await page.locator('.project-info strong').filter({hasText:'首屏性能合成项目'}).waitFor();const readyMs=Math.round(performance.now()-start);
  await page.waitForLoadState('networkidle');const resources=await page.evaluate(()=>performance.getEntriesByType('resource').filter(row=>/\.m?js(?:\?|$)/.test(row.name)).map(row=>({file:new URL(row.name).pathname,decodedBytes:row.decodedBodySize,encodedBytes:row.encodedBodySize,durationMs:Math.round(row.duration)})));
  assert.equal(errors,0);assert.ok(resources.length>0&&resources.every(row=>row.decodedBytes>0));
  if(process.argv.includes('--assert-deferred'))assert.ok(resources.every(row=>!row.file.includes('MarkdownRenderer')),'Dashboard must not fetch markdown formatting code');
  report.samples.push({index:index+1,readyMs,scriptDecodedBytes:resources.reduce((sum,row)=>sum+row.decodedBytes,0),resources,pageErrors:errors});await context.close();
 }
 report.status='passed';
}catch(error){report.status='failed';report.errorType=error.constructor.name;await activePage?.screenshot({path:join(out,'failure.png')}).catch(()=>{});process.exitCode=1;}
finally{await browser?.close();await new Promise(resolve=>server.close(resolve));report.finishedAt=new Date().toISOString();await writeFile(join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({report:join(out,'report.json'),status:report.status,samples:report.samples.map(({readyMs,scriptDecodedBytes})=>({readyMs,scriptDecodedBytes}))}));}
