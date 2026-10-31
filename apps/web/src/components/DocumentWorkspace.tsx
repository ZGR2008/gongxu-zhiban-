import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { MarkdownEditor, ModuleGuide } from './ContentView';
import { useEditGuard, useUnsavedEdit } from './EditGuard';
type Api=<T>(path:string,options?:RequestInit)=>Promise<T>;
const types={readme:'README',requirements:'需求分析文档',design:'软件设计文档',api:'API 说明文档',test_report:'测试报告',summary:'项目总结'} as const;
type DocType=keyof typeof types;
type Doc={id:string;type:DocType;content:string;modelName:string;createdAt:string;requirementVersionId:string};
type Props={request:Api;projectId:string;requirements:{id:string;version:number;status:string}[]};
const errorText=(error:unknown)=>error instanceof Error?error.message:'操作失败，请重试。';
export function DocumentWorkspace({request,projectId,requirements}:Props){
 const base=`/projects/${encodeURIComponent(projectId)}/documents`;
 const [docs,setDocs]=useState<Doc[]>([]),[selected,setSelected]=useState<Doc|null>(null),[content,setContent]=useState('');
 const [type,setType]=useState<DocType>('readme'),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
 const active=useRef(true),savePending=useRef<Promise<boolean>|null>(null),working=useRef(false);
 const {protect}=useEditGuard();
 const req=requirements.filter(row=>row.status==='confirmed').sort((a,b)=>b.version-a.version)[0];
 const choose=(doc:Doc)=>{setSelected(doc);setContent(doc.content);setNotice('');};
 const load=useCallback(async(signal?:AbortSignal)=>{
  setLoading(true);
  try{const data=await request<{documents:Doc[]}>(base,{signal});if(active.current&&!signal?.aborted){setDocs(data.documents);setSelected(data.documents[0]||null);setContent(data.documents[0]?.content||'');setError('');}}
  catch(error){if(active.current&&!signal?.aborted)setError(errorText(error));}
  finally{if(active.current&&!signal?.aborted)setLoading(false);}
 },[base,request]);
 useEffect(()=>{active.current=true;const controller=new AbortController();void load(controller.signal);return()=>{active.current=false;controller.abort();};},[load]);
 function persist():Promise<boolean>{
  if(savePending.current)return savePending.current;
  if(!selected||!content.trim()||working.current)return Promise.resolve(false);
  const target=selected.id,snapshot=content;
  working.current=true;setBusy(true);setError('');
  const pending=(async()=>{
   try{
    const result=await request<{document:Doc}>(`${base}/${target}`,{method:'PATCH',body:JSON.stringify({content:snapshot})});
    if(!active.current)return false;
    if(result.document.id!==target)throw new Error('返回文档归属不一致，已保留编辑内容。');
    setDocs(rows=>rows.map(row=>row.id===target?result.document:row));setSelected(result.document);
    setContent(value=>value===snapshot?result.document.content:value);setNotice('文档已保存。');return true;
   }catch(error){if(active.current)setError(errorText(error));return false;}
   finally{working.current=false;savePending.current=null;if(active.current)setBusy(false);}
  })();savePending.current=pending;return pending;
 }
 useUnsavedEdit(`document:${projectId}`,{label:'项目文档',dirty:Boolean(selected&&content!==selected.content),save:persist});
 async function generate(){
  if(working.current)return;working.current=true;setBusy(true);setError('');setNotice('');
  try{const response=await request<{document:Doc}>(`${base}/generate`,{method:'POST',body:JSON.stringify({type})});if(active.current){setDocs(rows=>[response.document,...rows]);choose(response.document);setNotice('已生成草稿，请核实并编辑。');}}
  catch(error){if(active.current)setError(errorText(error));}finally{working.current=false;if(active.current)setBusy(false);}
 }
 async function download(){
  if(!selected||working.current)return;working.current=true;setBusy(true);setError('');
  try{const response=await fetch(`/api${base}/${encodeURIComponent(selected.id)}/export`,{headers:{Authorization:`Bearer ${localStorage.getItem('gongxu_token')||''}`}});if(!response.ok)throw new Error(`导出失败（${response.status}），请检查登录状态。`);const blob=await response.blob();if(!active.current)return;const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`${selected.type}-${selected.id}.md`;a.click();URL.revokeObjectURL(url);}
  catch(error){if(active.current)setError(errorText(error));}finally{working.current=false;if(active.current)setBusy(false);}
 }
 async function save(event:FormEvent){event.preventDefault();await persist();}
 return <section className="module-page module-page--documents"><div className="section-heading compact"><div><div className="eyebrow">PROJECT DOCUMENTS</div><h2>将实践沉淀为项目文档</h2><p>使用已确认需求、任务与人工测试记录生成草稿。缺失信息须人工核实，单次生成需求限 20000 字符。</p></div></div>
 {!req&&<div className="alert error">请先确认需求版本。</div>}{error&&<div className="alert error" role="alert">{error}<button type="button" onClick={()=>protect(()=>void load())}>刷新</button></div>}{notice&&<div className="alert success" role="status">{notice}</div>}
 <div className="module-grid"><div><section className="editor-panel"><h3>生成文档草稿</h3><label htmlFor="doc-type">文档类型</label><select id="doc-type" value={type} onChange={event=>setType(event.target.value as DocType)}>{Object.entries(types).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select><div className="form-actions"><button type="button" className="button primary" onClick={()=>protect(()=>void generate())} disabled={busy||!req}>{busy?'处理中…':'生成草稿'} <span>✦</span></button></div></section>
 <section className="editor-panel"><h3>已保存文档</h3>{loading?<p role="status">正在读取…</p>:docs.length?<ul className="module-list">{docs.map(doc=><li key={doc.id}><button type="button" className="run-link" aria-pressed={selected?.id===doc.id} onClick={()=>{if(selected?.id!==doc.id)protect(()=>choose(doc));}}><strong>{types[doc.type]}</strong><small>{new Date(doc.createdAt).toLocaleString('zh-CN')} · {doc.modelName} · 来源 v{requirements.find(row=>row.id===doc.requirementVersionId)?.version??'未知'}</small></button></li>)}</ul>:<p>暂无文档。</p>}</section></div>
 {selected?<form className="editor-panel" onSubmit={save}><div className="panel-heading"><div><h3>{types[selected.type]}</h3><p>来源需求：版本 {requirements.find(row=>row.id===selected.requirementVersionId)?.version??'未找到'} · {selected.requirementVersionId!==req?.id?'历史版本，当前需求已变化，请复核文档。':'当前已确认版本'} · {content===selected.content?'已保存':'有未保存编辑'}</p></div></div><label className="sr-only" htmlFor="doc-content">文档内容</label><MarkdownEditor id="doc-content" value={content} onChange={setContent} required maxLength={50000}/><div className="form-actions"><button type="button" className="button secondary" onClick={()=>void download()} disabled={busy||content!==selected.content}>导出 Markdown</button><button className="button primary" disabled={busy||!content.trim()||content===selected.content}>保存文档 <span>↗</span></button></div></form>:<ModuleGuide kind="document"/>}</div></section>;
}
