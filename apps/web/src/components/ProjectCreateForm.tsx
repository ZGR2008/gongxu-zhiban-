import {useEditGuard} from './EditGuard';
import {useProjectCreation,type CreatedProject} from './useProjectCreation';
type Api=<T>(path:string,options?:RequestInit)=>Promise<T>;

/** Creating a project persists user input; it never invokes a model. */
export function ProjectCreateForm({request,onCreated,onOpen,onClose}:{request:Api;onCreated:(project:CreatedProject)=>void;onOpen:(project:CreatedProject)=>void;onClose:()=>void}){
  const {protect}=useEditGuard();
  const {name,setName,description,setDescription,busy,error,notice,submit}=useProjectCreation({request,key:'new-project',label:'新项目名称与想法',onCreated,onOpen});
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
