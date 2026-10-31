export type KnowledgeDocument={id:string;name:string;status:string;createdAt:string;indexCompatibility?:'current'|'model_changed'|'incomplete'|'awaiting_embedding'|'unconfigured';chunkCount?:number;indexedChunks?:number;currentChunks?:number};
const names={current:'当前模型索引',model_changed:'模型已变化 · 待重建',incomplete:'索引不完整',awaiting_embedding:'待向量化',unconfigured:'向量服务未配置',unknown:'索引来源待核对'};
export function KnowledgeDocumentList({documents,configured,busy,total,limited,refresh,index,pagination}:{documents:KnowledgeDocument[];configured:boolean;busy:boolean;total:number|null;limited:boolean;refresh:()=>void;index:(id:string)=>void;pagination:{index:number;loading:boolean;stale:boolean;next:boolean;previous:()=>void;following:()=>void}}){
 const locked=busy||pagination.loading||pagination.stale;
 return <section className="editor-panel" aria-label="知识资料与索引来源">
  <div className="panel-heading"><div><h3>我的知识资料</h3><p>仅展示当前账号下的文档。索引状态为读取时快照，更换向量模型后请刷新核对。</p></div><button className="text-link" type="button" onClick={refresh} disabled={busy||pagination.loading}>刷新资料状态</button></div>
  <div className="knowledge-catalogue-toolbar" role="group" aria-label="知识资料分页"><p role="status">{pagination.loading?'正在读取资料目录…':pagination.stale?'目录读取未完成或已有变化，请刷新后继续':`读取时共 ${total??'未知'} 份 · 第 ${pagination.index+1} 页 · 本页 ${documents.length} 份`}</p><div className="form-actions"><button type="button" className="button secondary" disabled={locked||pagination.index===0} onClick={pagination.previous}>上一页资料</button><button type="button" className="button secondary" disabled={locked||!pagination.next} onClick={pagination.following}>下一页资料</button></div></div>
  {limited&&<p className="muted-text">每页最多20份，刷新回到第一页。语义检索仍查询当前模型下的全部已索引片段，不受当前页限制。</p>}
  {documents.length?<ul className="module-list">{documents.map(doc=>{
   const state=doc.indexCompatibility??'unknown',needsIndex=state!=='current';
   const action=state==='model_changed'||state==='incomplete'||(state==='unknown'&&doc.status==='ready')?'重建索引':doc.status==='failed'?'重试索引':'建立索引';
   return <li key={doc.id}><span><strong>{doc.name}</strong><small>{new Date(doc.createdAt).toLocaleString('zh-CN')}{doc.chunkCount!==undefined&&` · ${doc.currentChunks??0}/${doc.chunkCount} 片段匹配当前模型`}</small></span><span className="document-actions"><span className="small-tag">{names[state]}</span>{needsIndex&&<button type="button" className="button secondary" disabled={locked||!configured} onClick={()=>index(doc.id)} title={!configured?'请先配置向量服务':'只在明确点击后建立索引；保留原文，失败不会冒报完成'}>{busy?'处理中…':action}</button>}</span></li>;
  })}</ul>:<p className="muted-text">{pagination.stale?'目录暂不可用，原有输入仍保留。':'暂无文档，添加资料后可进行检索。'}</p>}
  <p className="muted-text">标识一致不代表检索能回答每个问题。重建由你主动触发，不会自动调用聊天模型；失败时原文仍保留。</p>
 </section>;
}
