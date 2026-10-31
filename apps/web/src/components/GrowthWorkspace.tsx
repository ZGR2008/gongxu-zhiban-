import {useCallback,useEffect,useRef,useState} from 'react';
import {TaskDistribution} from './EvidenceViews';
import {RequestScope} from './request-scope';
import './growth-workspace.css';

type Api=<T>(path:string,options?:RequestInit)=>Promise<T>;
type Scope='current'|'history';
type GrowthData={scope:Scope;counts:{projects:number;confirmedRequirements:number;
  tasks:{total:number;todo:number;doing:number;review:number;done:number;blocked:number};
  codeReviews:number;syntaxFindings:number;testCases:number;testExecutions:{total:number;passed:number;failed:number;blocked:number}};
  events:{type:string;projectId:string;projectName:string;title:string;at:string}[];
  recommendations:{code:string;text:string;evidence:string}[];disclaimer:string};
const eventNames:Record<string,string>={project_created:'创建项目',requirement_confirmed:'确认需求',task_status_changed:'更新任务',code_reviewed:'代码审查',test_recorded:'记录测试'};

export function GrowthWorkspace({request,navigate}:{request:Api;navigate:(path:string)=>void}){
  const [scope,setScope]=useState<Scope>('current'),[data,setData]=useState<GrowthData|null>(null);
  const [loading,setLoading]=useState(true),[error,setError]=useState('');
  const reads=useRef(new RequestScope());
  const load=useCallback(async()=>{
    const ticket=reads.current.begin(scope);setLoading(true);setError('');setData(null);
    try{
      const result=await request<GrowthData>(`/growth?scope=${scope}`,{signal:ticket.signal});
      if(!reads.current.accepts(ticket,scope))return;
      if(result.scope!==scope)throw Error('统计范围与本次选择不一致，请刷新后重试。');
      setData(result);
    }catch(error){if(reads.current.accepts(ticket,scope))setError(error instanceof Error?error.message:'统计暂时无法读取，请重试。');}
    finally{if(reads.current.accepts(ticket,scope))setLoading(false);}
  },[request,scope]);
  useEffect(()=>{void load();return()=>reads.current.cancel();},[load]);
  const shown=data?.scope===scope?data:null,history=scope==='history';
  const stats=shown?[['实训项目',shown.counts.projects],[history?'累计确认版本':'当前确认版本',shown.counts.confirmedRequirements],[history?'历史已完成任务':'当前版本已完成',shown.counts.tasks.done],['累计代码审查',shown.counts.codeReviews]] as const:[];
  return <section className="module-page">
    <div className="detail-heading growth-heading"><div><div className="eyebrow">LEARNING / ACTIVITY</div><h2>看见每一次真实实践</h2><p>当前进度与历史记录分别核对，旧版本结果不会继承为新版本成果。</p></div><div className="growth-scope-tools"><label htmlFor="growth-scope">任务与测试统计范围</label><select id="growth-scope" value={scope} onChange={event=>setScope(event.target.value as Scope)}><option value="current">各项目当前已确认需求</option><option value="history">历史累计（含旧需求版本）</option></select></div></div>
    {error&&<div className="alert error" role="alert">{error}<button type="button" onClick={()=>void load()}>重试</button></div>}
    {loading?<div className="state-block" role="status">正在读取{history?'历史累计记录':'各项目当前确认版本'}…</div>:shown&&<>
      <p className="growth-disclaimer" role="status">{shown.disclaimer}</p><div className="growth-stats">{stats.map(([label,value])=><div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
      <div className="module-grid"><div>
        <section className="editor-panel" aria-label="任务进度"><div className="panel-heading"><div><h3>{history?'历史任务状态':'当前版本任务进度'}</h3><p>共 {shown.counts.tasks.total} 项。{history?'包含旧需求，不能作为当前验收依据。':'仅包含各项目最近确认需求的任务。'}</p></div></div><TaskDistribution counts={shown.counts.tasks}/><div className="growth-breakdown">{([['待开始',shown.counts.tasks.todo],['进行中',shown.counts.tasks.doing],['待审核',shown.counts.tasks.review],['已完成',shown.counts.tasks.done],['阻塞',shown.counts.tasks.blocked]] as const).map(([label,value])=><div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div></section>
        <section className="editor-panel" aria-label="审查与测试统计"><h3>审查与测试记录</h3><ul className="growth-facts"><li><span>历史语法诊断（所有版本）</span><strong>{shown.counts.syntaxFindings} 条</strong></li><li><span>{history?'累计测试用例':'当前版本测试用例'}</span><strong>{shown.counts.testCases} 条</strong></li><li><span>所选范围有人工结果</span><strong>{shown.counts.testExecutions.total} 条</strong></li><li><span>人工通过 / 失败 / 阻塞</span><strong>{shown.counts.testExecutions.passed} / {shown.counts.testExecutions.failed} / {shown.counts.testExecutions.blocked}</strong></li></ul><p className="muted-text">计数为各用例最近登记的状态，不是累计执行次数，也不代表自动测试。</p></section>
        <section className="editor-panel"><h3>下一步建议</h3>{history?<p className="muted-text">历史记录只供回看；切换到当前版本查看有依据的下一步建议。</p>:shown.recommendations.length?shown.recommendations.map(item=><div className="recommendation" key={item.code}><strong>{item.text}</strong><p>{item.evidence}</p></div>):<p className="muted-text">暂无基于当前记录的建议。完成实训后再来查看。</p>}</section>
      </div><section className="editor-panel"><div className="panel-heading"><div><h3>最近活动（含历史版本）</h3><p>最多展示最近 30 条已保存记录；用例结果为最近一次登记，完整变更历史请到测试中心核对。</p></div></div>{shown.events.length?<ul className="activity-list">{shown.events.map((event,i)=><li key={`${event.type}-${event.projectId}-${event.at}-${i}`}><span className="activity-dot"/><div><strong>{eventNames[event.type]||'项目活动'}</strong><p>{event.title}</p><button type="button" className="text-link" onClick={()=>navigate(`/projects/${event.projectId}`)}>{event.projectName} →</button><time>{new Date(event.at).toLocaleString('zh-CN')}</time></div></li>)}</ul>:<p className="muted-text">暂无活动。创建项目后，操作记录会显示在这里。</p>}</section></div>
    </>}
  </section>;
}
