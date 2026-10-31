import {CopyButton} from './ContentView';

export type ReviewContext={schemaVersion:1;scope:'project'|'code_only';capturedAt:string;
  requirement:{id:string;version:number;content:string}|null;
  retrieval:{status:string;segments:{part:number;start:number;end:number;sourceIds:string[]}[];
    sources:{id:string;documentName:string;page:number|null;content:string;distance:number}[]}};
const statuses:Record<string,string>={not_requested:'本次明确选择仅代码，未检索资料',no_confirmed_requirement:'当时没有已确认需求，未检索资料',not_configured:'当时未配置向量服务，未检索资料',retrieved:'已按确认需求分段检索',no_matches:'已实际检索，但没有匹配片段'};

export function ReviewSources({context,currentVersionId}:{context?:ReviewContext|null;currentVersionId?:string}){
  return <section className="editor-panel review-sources" aria-label="本次审查依据"><h3>本次审查依据</h3>
    {!context?<p className="muted-text">历史记录未保存来源快照，无法确认当时使用了哪些需求或资料。</p>:<>
      <p className="muted-text">{context.scope==='code_only'?'审查范围：仅代码，不代表检查了项目需求。':context.requirement?`审查范围：提交时已确认需求 V${context.requirement.version}`:'审查范围：代码；当时没有已确认的项目需求。'}</p>
      {context.requirement&&context.requirement.id!==currentVersionId&&<p className="review-source-warning" role="status">依据为历史需求；这份建议不代表当前确认版本已经审查。</p>}
      {context.requirement&&<details><summary>核对提交时的完整需求 · V{context.requirement.version}</summary><pre className="review-source-text">{context.requirement.content}</pre></details>}
      <p className="muted-text">{statuses[context.retrieval.status]??'资料状态未知'}{context.retrieval.segments.length?` · 实际检索 ${context.retrieval.segments.length} 段`:''}</p>
      {context.retrieval.sources.length>0&&<><p className="muted-text">以下是提供给模型的原文，并不证明模型实际引用了每条资料或资料支持全部建议。请逐项核对。</p>
        <ul className="review-source-list">{context.retrieval.sources.map(source=><li key={source.id}><details><summary>{source.documentName}{source.page?` · 第 ${source.page} 页`:''}</summary><p className="muted-text">资料 ID：{source.id}</p><pre className="review-source-text">{source.content}</pre><CopyButton value={source.content} label="复制来源原文"/></details></li>)}</ul></>}
    </>}
  </section>;
}
