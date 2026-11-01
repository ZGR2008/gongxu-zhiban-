import {useEffect,useRef,useState,type FormEvent} from 'react';
import {useUnsavedEdit} from './EditGuard';

export type CreatedProject={id:string;name:string;description:string;status:string;createdAt:string;updatedAt:string};
type Api=<T>(path:string,options?:RequestInit)=>Promise<T>;

/** Shared by blank-project and mission forms. A network cancellation cannot
 * undo creation: writes finish, but an unmounted form cannot navigate or reset. */
export function useProjectCreation({request,key,label,initialName='',initialDescription='',onCreated,onOpen}:{request:Api;key:string;label:string;initialName?:string;initialDescription?:string;onCreated?:(project:CreatedProject)=>void;onOpen:(project:CreatedProject)=>void}){
 const [name,setName]=useState(initialName),[description,setDescription]=useState(initialDescription);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [created,setCreated]=useState<CreatedProject|null>(null),[openAfterCommit,setOpenAfterCommit]=useState<CreatedProject|null>(null);
 const baseline=useRef({name:initialName,description:initialDescription}),fields=useRef({name,description});fields.current={name,description};
 const pending=useRef<Promise<CreatedProject|null>|null>(null),mounted=useRef(true),submitting=useRef(false);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 useEffect(()=>{if(!openAfterCommit)return;setOpenAfterCommit(null);if(mounted.current&&!fields.current.name&&!fields.current.description)onOpen(openAfterCommit);},[openAfterCommit,onOpen]);
 function persist():Promise<CreatedProject|null>{
  if(pending.current)return pending.current;
  const snapshot={...fields.current};
  if(!snapshot.name.trim()){setError('请先填写项目名称，再保存或创建。');return Promise.resolve(null);}
  setBusy(true);setError('');setNotice('');
  const operation=(async()=>{
   try{
    const {project}=await request<{project:CreatedProject}>('/projects',{method:'POST',body:JSON.stringify({name:snapshot.name.trim(),description:snapshot.description.trim()})});
    // This callback may update the same-session catalogue; all form-local work
    // remains mounted-only. The shared request layer rejects account changes.
    onCreated?.(project);
    if(mounted.current){
     const unchanged=fields.current.name===snapshot.name&&fields.current.description===snapshot.description;
     baseline.current={name:'',description:''};setCreated(project);
     if(unchanged){fields.current={name:'',description:''};setName('');setDescription('');}
     setNotice(unchanged?'项目已创建。':'提交时的项目已创建；随后输入的内容仍未保存，已保留在表单中。');
    }
    return project;
   }catch(e){if(mounted.current)setError(e instanceof Error?e.message:'创建未成功，已保留输入。');return null;}
   finally{pending.current=null;if(mounted.current)setBusy(false);}
  })();pending.current=operation;return operation;
 }
 const dirty=busy||name!==baseline.current.name||description!==baseline.current.description;
 useUnsavedEdit(key,{label,dirty,save:async()=>Boolean(await persist())});
 async function submit(event:FormEvent){event.preventDefault();if(submitting.current)return;submitting.current=true;
  try{const project=await persist();if(project&&mounted.current&&!fields.current.name&&!fields.current.description)setOpenAfterCommit(project);}
  finally{submitting.current=false;}
 }
 return {name,setName,description,setDescription,busy,error,notice,dirty,created,submit};
}
