import type {Pool} from 'pg';
import {withAbort} from '../ai/abortable.js';

export class AgentStopError extends Error{
  constructor(public code:'agent_interrupted'|'agent_cancelled'|'agent_deadline_exceeded'|'agent_checkpoint_failed'){super(code);}
}
export const heartbeatMs=15_000,staleHeartbeatMs=90_000,maxExecutionMs=600_000;

/** Recovery never retries a tool/model call; completed evidence remains intact. */
export async function finishInterruptedRuns(pool:Pool,projectId:string,runId?:string){
  return pool.query(`WITH ended AS (
    UPDATE agent_runs SET status='failed',error_code=CASE WHEN $2::uuid IS NOT NULL THEN 'agent_cancelled'
      WHEN deadline_at<=now() THEN 'agent_deadline_exceeded' ELSE 'agent_interrupted' END,finished_at=now()
    WHERE project_id=$1 AND status='running' AND ($2::uuid IS NULL OR id=$2)
      AND ($2::uuid IS NOT NULL OR COALESCE(heartbeat_at,created_at)<now()-INTERVAL '90 seconds' OR deadline_at<=now()) RETURNING id,error_code
  ), ended_steps AS (
    UPDATE agent_steps s SET status='failed',output_summary=e.error_code,finished_at=now() FROM ended e
      WHERE s.run_id=e.id AND s.status='running' RETURNING s.id
  ), ended_tools AS (
    UPDATE agent_tool_calls t SET status='failed',output_summary=e.error_code,finished_at=now() FROM agent_steps s,ended e
      WHERE t.step_id=s.id AND s.run_id=e.id AND t.status='running' RETURNING t.id
  ) SELECT id,error_code AS "errorCode" FROM ended`,[projectId,runId??null]);
}

export function executionLease(pool:Pool,runId:string,options:{heartbeatMs?:number;deadlineMs?:number}={}){
  const controller=new AbortController();let disposed=false,pulsing=false;
  const stop=(reason:AgentStopError)=>{if(!controller.signal.aborted)controller.abort(reason);};
  const deadline=setTimeout(()=>stop(new AgentStopError('agent_deadline_exceeded')),options.deadlineMs??maxExecutionMs);
  const heartbeat=setInterval(()=>{if(disposed||pulsing||controller.signal.aborted)return;pulsing=true;
    void pool.query("UPDATE agent_runs SET heartbeat_at=now() WHERE id=$1 AND status='running' AND deadline_at>now() RETURNING id",[runId])
      .then(result=>{if(!disposed&&!result.rows.length)stop(new AgentStopError('agent_interrupted'));})
      .catch(()=>stop(new AgentStopError('agent_checkpoint_failed'))).finally(()=>{pulsing=false;});
  },options.heartbeatMs??heartbeatMs);
  deadline.unref();heartbeat.unref();
  return {signal:controller.signal,stop,guard:<T>(work:()=>Promise<T>)=>withAbort(controller.signal,work),
    dispose:()=>{disposed=true;clearTimeout(deadline);clearInterval(heartbeat);}};
}
