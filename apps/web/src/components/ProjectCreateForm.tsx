import {useEffect,useRef,useState,type FormEvent} from 'react';
import {useEditGuard,useUnsavedEdit} from './EditGuard';

type Project={id:string;name:string;description:string;status:string;createdAt:string;updatedAt:string};
type Api=<T>(path:string,options?:RequestInit)=>Promise<T>;

/** Creating a project saves user input locally; it never invokes a model. */
export function ProjectCreateForm({request,onCreated,onOpen,onClose}:{request:Api;onCreated:(project:Project)=>void;onOpen:(project:Project)=>void;onClose:()=>void}){
  const [name,setName]=useState(''),[description,setDescription]=useState('');
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const fields=useRef({name,description});fields.current={name,description};
  const pending=useRef<Promise<Project|null>|null>(null),mounted=useRef(true),submitting=useRef(false);
  const {protect}=useEditGuard();
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);

  function persist():Promise<Project|null>{
    if(pending.current)return pending.current;
    const snapshot={...fields.current};
    if(!snapshot.name.trim()){setError('请先填写项目名称，再保存或创建。');return Promise.resolve(null);}
    setBusy(true);setError('');setNotice('');
    const operation=(async()=>{
      try{
        const {project}=await request<{project:Project}>('/projects',{method:'POST',body:JSON.stringify({name:snapshot.name.trim(),description:snapshot.description.trim()})});
        // The parent is still the same session; it may have navigated away while
        // this write finished. Update its list, but never redirect after unmount.
        onCreated(project);
        if(mounted.current){
          const unchanged=fields.current.name===snapshot.name&&fields.current.description===snapshot.description;
          if(unchanged){fields.current={name:'',description:''};setName('');setDescription('');}
          setNotice(unchanged?'项目已创建。':'提交时的项目已创建；随后输入的内容仍未保存，已保留在表单中。');
        }
        return project;
      }catch(error){if(mounted.current)setError(error instanceof Error?error.message:'创建未成功，已保留输入。');return null;}
      finally{pending.current=null;if(mounted.current)setBusy(false);}
    })();pending.current=operation;return operation;
  }
  useUnsavedEdit('new-project',{label:'新项目名称与想法',dirty:Boolean(name||description),save:async()=>Boolean(await persist())});
  async function submit(event:FormEvent){
    event.preventDefault();if(submitting.current)return;
    submitting.current=true;
    try{const project=await persist();await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
      if(project&&mounted.current&&!fields.current.name&&!fields.current.description)onOpen(project);
    }finally{submitting.current=false;}
  }
  return <section className="editor-panel" aria-labelledby="create-title">
    <div className="panel-heading"><div><div className="eyebrow">NEW PROJECT</div><h2 id="create-title">开始一个新项目</h2><p>先写下初步想法，后续可以继续完善需求。</p></div><button className="icon-button" type="button" onClick={()=>protect(onClose)} aria-label="关闭">×</button></div>
    {error&&<p className="alert error" role="alert">{error}</p>}{notice&&<p className="alert success" role="status">{notice}</p>}
    <form onSubmit={submit} aria-labelledby="create-title">
      <label htmlFor="name">项目名称 <span>必填</span></label><input id="name" value={name} onChange={event=>setName(event.target.value)} maxLength={120} required placeholder="例如：校园二手物品交易平台"/>
      <label htmlFor="description">项目想法 <span>选填</span></label><textarea id="description" rows={4} value={description} onChange={event=>setDescription(event.target.value)} maxLength={10000} placeholder="描述你想解决的问题、目标用户或核心功能…"/>
      <p className="muted-text" role="status">{busy?'创建请求处理中；已发出的请求不会因离开页面而撤销。':name||description?'有尚未创建的内容；离开前可以保存、放弃或取消。':'创建只保存项目，不调用 AI。'}</p>
      <div className="form-actions"><button className="button secondary" type="button" onClick={()=>protect(onClose)}>取消</button><button className="button primary" type="submit" disabled={busy||!name.trim()}>{busy?'创建中…':'创建项目'} <span>↗</span></button></div>
    </form>
  </section>;
}
