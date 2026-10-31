import { useEffect, useState } from 'react';
type Activity={id:string;kind:string;state:string;attempt?:number;code?:string;updatedAt:string};
const states:Record<string,string>={queued:'正在排队',running:'正在处理',retrying:'等待有限重试',succeeded:'已完成',failed:'失败，可检查后重试',cancelled:'已取消'};
const kinds:Record<string,string>={index:'建立索引',search:'知识检索',answer:'回答前检索',agent:'规划前检索'};
export function EmbeddingActivity({request,active}:{request:<T>(path:string,options?:RequestInit)=>Promise<T>;active:boolean}){
 const [rows,setRows]=useState<Activity[]>([]);const [error,setError]=useState(false);
 useEffect(()=>{
  let live=true;let timer:ReturnType<typeof setTimeout>;const controller=new AbortController();
  async function poll(){try{const response=await request<{activities:Activity[]}>('/knowledge/activity',{signal:controller.signal});if(live){setRows(response.activities);setError(false);}}catch{if(live)setError(true);}finally{if(live&&active)timer=setTimeout(()=>void poll(),700);}}
  void poll();return()=>{live=false;clearTimeout(timer);controller.abort();};
 },[request,active]);
 if(!active&&!rows.length)return null;
 return <details className="editor-panel embedding-activity" open={active}><summary>本账号近期向量任务 · 实际服务状态</summary>{error?<p role="status">暂时无法读取队列状态，请检查服务；不会据此标记任务完成。</p>:rows.length?<ul className="module-list">{rows.slice(0,5).map(row=><li key={row.id}><span>{kinds[row.kind]||row.kind}<small>{new Date(row.updatedAt).toLocaleTimeString('zh-CN')}</small></span><span>{states[row.state]||row.state}{row.attempt?` · 第 ${row.attempt} 次请求`:''}</span></li>)}</ul>:<p role="status">尚无已记录的向量任务。</p>}<p className="muted-text">单次推理串行执行，最多等待 8 个请求。排队最长 15 秒；仅对临时故障最多重试两次。批次完成后仍需保存索引。</p></details>;
}
