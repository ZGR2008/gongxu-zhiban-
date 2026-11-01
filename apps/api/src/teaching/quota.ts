import {AsyncLocalStorage} from 'node:async_hooks';
import type {Pool} from 'pg';
export const aiCaller=new AsyncLocalStorage<{pool:Pool;userId:string}>();
export class CallBudgetError extends Error {constructor(readonly code:'ai_call_quota_exhausted'|'account_disabled'){super(code);}}
/** Dispatch reservations include failures/unknown outcomes; this is not a money or billing meter. */
export async function reserveCall(model:string){
 const context=aiCaller.getStore();if(!context)return null;
 const {pool,userId}=context,db=await pool.connect();
 try{
  await db.query('BEGIN');await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[userId]);
  const control=(await db.query('SELECT disabled,monthly_call_limit FROM teaching_accounts WHERE user_id=$1',[userId])).rows[0];
  if(control?.disabled)throw new CallBudgetError('account_disabled');
  const used=(await db.query("SELECT attempts FROM ai_call_budget WHERE user_id=$1 AND month=date_trunc('month',now() AT TIME ZONE 'UTC')::date",[userId])).rows[0]?.attempts??0;
  if(control?.monthly_call_limit!==null&&control?.monthly_call_limit!==undefined&&used>=control.monthly_call_limit)throw new CallBudgetError('ai_call_quota_exhausted');
  await db.query(`INSERT INTO ai_call_budget(user_id,month,attempts) VALUES($1,date_trunc('month',now() AT TIME ZONE 'UTC')::date,1)
   ON CONFLICT(user_id,month) DO UPDATE SET attempts=ai_call_budget.attempts+1`,[userId]);
  const receipt=(await db.query('INSERT INTO ai_call_receipts(user_id,model) VALUES($1,$2) RETURNING id',[userId,model])).rows[0];await db.query('COMMIT');
  return {finish:async(status:string,usage:unknown=null)=>{await pool.query('UPDATE ai_call_receipts SET status=$2,usage=$3,finished_at=now() WHERE id=$1',[receipt.id,status,usage?JSON.stringify(usage):null]);}};
 }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
}
