import {createServer} from 'node:http';
import {readFile,writeFile,mkdir,cp,readdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {resolve,relative,join,extname,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {sourceProvenance} from '../evaluation/source-provenance.mjs';

// Reuse the behavioral assertions against frozen built assets, not Vite's dev
// transforms. The child intercepts every API request and blocks external origins.
if(process.argv.length>2)throw Error('This local production check accepts no remote options');
const root=fileURLToPath(new URL('../',import.meta.url));
const output=join(root,'.runtime','production-recovery-'+randomUUID()),dist=join(output,'dist');
await mkdir(output,{recursive:true});await cp(join(root,'apps/web/dist'),dist,{recursive:true,force:false,errorOnExist:true});
const hash=data=>createHash('sha256').update(data).digest('hex');
const report={scope:'frozen_production_assets_controlled_api_no_database_no_model',...sourceProvenance(root),startedAt:new Date().toISOString(),assets:[],checks:[]};
for(const name of await readdir(join(dist,'assets'))){if(/\.(js|css)$/.test(name)){const bytes=await readFile(join(dist,'assets',name));report.assets.push({name,bytes:bytes.length,sha256:hash(bytes)});}}
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2','.json':'application/json'};
const server=createServer(async(request,response)=>{
  try{
    const path=resolve(dist,'.'+decodeURIComponent(new URL(request.url,'http://localhost').pathname)),inside=relative(dist,path);
    if(inside==='..'||inside.startsWith('..'+sep)||isAbsolute(inside)){response.writeHead(403).end();return;}
    const target=extname(path)?path:join(dist,'index.html');
    response.writeHead(200,{'content-type':mime[extname(target)]??'application/octet-stream','cache-control':'no-store'});response.end(await readFile(target));
  }catch{if(!response.headersSent)response.writeHead(404);response.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
try{
  const result=await new Promise(resolve=>execFile(process.execPath,['scripts/reliability-browser.mjs','--case=workspace_load_','--production-assets'],{cwd:root,windowsHide:true,timeout:180000,maxBuffer:1024*1024,env:{...process.env,SMOKE_WEB_URL:`http://127.0.0.1:${server.address().port}`}},(error,stdout,stderr)=>resolve({error,stdout,stderr})));
  await writeFile(join(output,'controlled-browser.log'),result.stdout+result.stderr);
  const match=result.stdout.match(/^Report: (.+)$/m);assert.ok(match,'Browser report must be emitted');
  const childPath=resolve(match[1].trim());assert.ok(childPath.startsWith(join(root,'.runtime')+sep));
  const bytes=await readFile(childPath),child=JSON.parse(bytes);
  report.browserReport={file:relative(root,childPath),sha256:hash(bytes)};report.browserVersion=child.browserVersion;report.checks=child.checks;
  assert.equal(child.assetMode,'production');assert.equal(child.checks.length,3);assert.ok(child.checks.every(check=>check.status==='passed'));assert.equal(result.error,null);
  report.status='passed';
}catch(error){report.status='failed';report.errorType=error.constructor.name;process.exitCode=1;}
finally{
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));report.finishedAt=new Date().toISOString();
  await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,checks:report.checks.length,report:join(output,'report.json')}));
}
