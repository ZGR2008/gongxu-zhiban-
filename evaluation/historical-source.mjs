import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {mkdir,writeFile,symlink} from 'node:fs/promises';
import path from 'node:path';

export const historicalCommit='5740ec36d03fffd30122e06287c92ef63a2ac5b1';
const sourceRoot='apps/api/src/';
export function historicalDependency(from,specifier){
 if(!specifier.startsWith('.'))return null;
 if(!specifier.endsWith('.js'))throw Error('Unsupported historical source import');
 const resolved=path.posix.normalize(path.posix.join(path.posix.dirname(from),specifier)).replace(/\.js$/,'.ts');
 if(!resolved.startsWith(sourceRoot)||resolved.includes('\\')||!/^apps\/api\/src\/[A-Za-z0-9_./-]+\.ts$/.test(resolved))throw Error('Historical import escaped source root');
 return resolved;
}
// Read a fixed, local Git object. Never checkout old code over the current tree,
// inspect historical configuration, run migrations, or install dependencies.
export async function prepareHistoricalSource(root,directory){
 const require=createRequire(path.join(root,'apps/api/package.json'));
 const ts=require('typescript');
 const git=(args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:4_000_000});
 try{if(git(['rev-parse',`${historicalCommit}^{commit}`]).trim()!==historicalCommit)throw Error();}
 catch{throw Error('Historical Git commit is unavailable; do not substitute reconstructed prompts');}
 const sourceDirectory=path.join(directory,'historical-source');
 await mkdir(sourceDirectory,{recursive:true});
 await writeFile(path.join(sourceDirectory,'package.json'),JSON.stringify({private:true,type:'module'}));
 await symlink(path.join(root,'apps/api/node_modules'),path.join(sourceDirectory,'node_modules'),process.platform==='win32'?'junction':'dir');
 const sources=new Map(),pending=['apps/api/src/agent/routes.ts','apps/api/src/rag/routes.ts'];
 while(pending.length){
  const file=pending.shift();if(sources.has(file))continue;
  if(!file.startsWith(sourceRoot)||file.endsWith('.test.ts'))throw Error('Non-production historical source rejected');
  const mode=git(['ls-tree',historicalCommit,'--',file]).split(/\s+/)[0];
  if(mode!=='100644'&&mode!=='100755')throw Error('Historical source must be a regular file');
  const source=git(['show',`${historicalCommit}:${file}`]);
  const compiled=ts.transpileModule(source,{fileName:file,reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,isolatedModules:true}});
  if(compiled.diagnostics?.some(item=>item.category===ts.DiagnosticCategory.Error))throw Error('Historical source transpilation failed');
  sources.set(file,{sha256:createHash('sha256').update(source).digest('hex'),bytes:Buffer.byteLength(source)});
  const target=path.join(sourceDirectory,file.replace(sourceRoot,'').replace(/\.ts$/,'.js'));
  await mkdir(path.dirname(target),{recursive:true});await writeFile(target,compiled.outputText);
  for(const item of ts.preProcessFile(compiled.outputText,true,true).importedFiles){const dependency=historicalDependency(file,item.fileName);if(dependency)pending.push(dependency);}
 }
 return {sourceDirectory,manifest:{commit:historicalCommit,compilerVersion:ts.version,fastifyVersion:require('fastify/package.json').version,zodVersion:require('zod/package.json').version,sourceFiles:Object.fromEntries(sources),sourceUnmodified:true,transpilation:'TypeScript to ES2022; original route source unchanged',historicalLockfileInstall:false}};
}
