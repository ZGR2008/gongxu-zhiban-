import {execFileSync} from 'node:child_process';
import {realpathSync} from 'node:fs';

const canonical=value=>{
 const resolved=realpathSync(value);
 return process.platform==='win32'?resolved.toLowerCase():resolved;
};

// A ZIP can live inside an unrelated repository. Never attribute the parent's
// commit to these files. Missing Git is unknown provenance, not a failed eval.
export function sourceProvenance(root){
 const cwd=realpathSync(root);
 const git=args=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:5000,maxBuffer:4_000_000}).trim();
 const unknown=reason=>({commit:null,workingTreeClean:null,gitStatus:reason});
 let top;
 try{top=git(['rev-parse','--show-toplevel']);}
 catch{return unknown('unavailable');}
 if(canonical(top)!==canonical(cwd))return unknown('parent_repository_ignored');
 let commit;
 try{commit=git(['rev-parse','--verify','HEAD^{commit}']);}
 catch{return unknown('head_unavailable');}
 if(!/^[a-f0-9]{40,64}$/.test(commit))return unknown('head_unavailable');
 try{return {commit,workingTreeClean:git(['status','--porcelain','--untracked-files=normal']).length===0,gitStatus:'verified_project_repository'};}
 catch{return {commit,workingTreeClean:null,gitStatus:'working_tree_state_unavailable'};}
}
