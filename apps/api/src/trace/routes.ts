import type {FastifyInstance,FastifyRequest,FastifyReply} from 'fastify';
import type {Pool} from 'pg';
import {z} from 'zod';
import type {ProjectStore} from '../project-store.js';
import {authorizeRequest} from '../project-routes.js';
import {requirementItems,itemEvidence,type RequirementItem,type EvidenceCase,type EvidenceLink} from './domain.js';
import {taskTestEvidence,type TaskTestLink} from './task-test.js';

const params=z.object({projectId:z.string().uuid()});
const linkInput=z.object({itemId:z.string().uuid(),targetId:z.string().uuid(),targetKind:z.enum(['task','case']),decision:z.enum(['confirmed','rejected']),note:z.string().trim().min(3).max(2000),expectedCaseRevision:z.number().int().positive().optional()}).strict();
const changeInput=z.object({itemId:z.string().uuid(),predecessorId:z.string().uuid(),note:z.string().trim().min(3).max(2000)}).strict();
const pairInput=z.object({itemId:z.string().uuid(),taskId:z.string().uuid(),caseId:z.string().uuid(),expectedCaseRevision:z.number().int().positive(),decision:z.enum(['confirmed','rejected']),note:z.string().trim().min(3).max(2000)}).strict();

export async function registerTraceRoutes(app:FastifyInstance,store?:ProjectStore,pool?:Pool){
  async function access(request:FastifyRequest,reply:FastifyReply){
    if(!store||!pool){reply.code(503).send({error:'database_not_configured'});return null;}
    const user=await authorizeRequest(request,store);if(!user){reply.code(401).send({error:'unauthorized'});return null;}
    const parsed=params.safeParse(request.params);if(!parsed.success){reply.code(400).send({error:'invalid_input'});return null;}
    if(!await store.getProject(user.id,parsed.data.projectId)){reply.code(404).send({error:'not_found'});return null;}
    return {user,projectId:parsed.data.projectId};
  }
  async function materialize(projectId:string,versionId:string,content:string){
    const items=requirementItems(projectId,versionId,content);
    await pool!.query(`INSERT INTO requirement_items(id,project_id,requirement_version_id,stable_key,position,start_offset,end_offset,content,acceptance_candidate)
      SELECT x.id,$1,$2,x.key,x.position,x.start,x.end,x.text,x."acceptanceCandidate"
      FROM jsonb_to_recordset($3::jsonb) AS x(id uuid,key text,position integer,start integer,"end" integer,text text,"acceptanceCandidate" boolean)
      ON CONFLICT(requirement_version_id,stable_key) DO NOTHING`,[projectId,versionId,JSON.stringify(items)]);
    return items;
  }
  app.get('/projects/:projectId/trace',async(req,reply)=>{
    const a=await access(req,reply);if(!a)return;
    const q=z.object({requirementVersionId:z.string().uuid().optional()}).strict().safeParse(req.query);
    if(!q.success)return reply.code(400).send({error:'invalid_input'});
    const versions=(await store!.listRequirements(a.user.id,a.projectId)??[]).filter(v=>v.status==='confirmed').sort((x,y)=>y.version-x.version);
    const version=q.data.requirementVersionId?versions.find(v=>v.id===q.data.requirementVersionId):versions[0];
    if(!version)return {version:null,items:[],links:[],tasks:[],cases:[],previousItems:[],history:[],impact:null};
    await materialize(a.projectId,version.id,version.content);
    const previous=versions.find(v=>v.version<version.version);
    if(previous)await materialize(a.projectId,previous.id,previous.content);
    // Suggestions never overwrite human decisions. Old data has an empty key array.
    await pool!.query(`INSERT INTO trace_links(project_id,requirement_version_id,item_id,task_id,origin,status)
      SELECT t.project_id,t.requirement_version_id,i.id,t.id,'model','suggested' FROM tasks t
      JOIN requirement_items i ON i.project_id=t.project_id AND i.requirement_version_id=t.requirement_version_id AND i.stable_key=ANY(t.suggested_requirement_keys)
      WHERE t.project_id=$1 AND t.requirement_version_id=$2 ON CONFLICT DO NOTHING`,[a.projectId,version.id]);
    await pool!.query(`INSERT INTO trace_links(project_id,requirement_version_id,item_id,case_id,case_revision,origin,status)
      SELECT c.project_id,c.requirement_version_id,i.id,c.id,c.revision,'model','suggested' FROM practice_test_cases c
      JOIN requirement_items i ON i.project_id=c.project_id AND i.requirement_version_id=c.requirement_version_id AND i.stable_key=ANY(c.suggested_requirement_keys)
      WHERE c.project_id=$1 AND c.requirement_version_id=$2 ON CONFLICT DO NOTHING`,[a.projectId,version.id]);
    const [itemRows,linkRows,taskRows,caseRows,impactRows,historyRows,pairRows,pairHistory]=await Promise.all([
      pool!.query(`SELECT id,stable_key AS key,position,start_offset AS start,end_offset AS end,content AS text,acceptance_candidate AS "acceptanceCandidate",requirement_version_id AS "versionId",predecessor_id AS "predecessorId",change_review_note AS "changeReviewNote",change_reviewed_at AS "changeReviewedAt" FROM requirement_items WHERE project_id=$1 AND requirement_version_id=ANY($2::uuid[]) ORDER BY position`,[a.projectId,[version.id,...(previous?[previous.id]:[])]]),
      pool!.query(`SELECT id,item_id AS "itemId",task_id AS "taskId",case_id AS "caseId",case_revision AS "caseRevision",origin,status,review_note AS "reviewNote",reviewed_at AS "reviewedAt" FROM trace_links WHERE project_id=$1 AND requirement_version_id=$2 ORDER BY created_at`,[a.projectId,version.id]),
      pool!.query('SELECT id,title,status FROM tasks WHERE project_id=$1 AND requirement_version_id=$2 ORDER BY created_at',[a.projectId,version.id]),
      pool!.query(`SELECT id,title,revision,result,steps,expected,execution_note AS "executionNote",executed_at AS "executedAt",model_name AS "modelName" FROM practice_test_cases WHERE project_id=$1 AND requirement_version_id=$2 ORDER BY created_at`,[a.projectId,version.id]),
      pool!.query(`SELECT (SELECT count(*)::int FROM tasks WHERE project_id=$1 AND requirement_version_id<>$2) AS tasks,
      (SELECT count(*)::int FROM practice_test_cases WHERE project_id=$1 AND requirement_version_id<>$2) AS cases,
      (SELECT count(*)::int FROM project_documents WHERE project_id=$1 AND requirement_version_id<>$2) AS documents`,[a.projectId,version.id]),
      pool!.query(`SELECT h.id,h.snapshot,h.recorded_at AS "recordedAt" FROM trace_link_history h JOIN trace_links l ON l.id=h.link_id WHERE l.project_id=$1 AND l.requirement_version_id=$2 ORDER BY h.recorded_at DESC LIMIT 100`,[a.projectId,version.id]),
      pool!.query(`SELECT id,item_id AS "itemId",task_id AS "taskId",case_id AS "caseId",case_revision AS "caseRevision",status,review_note AS "reviewNote",reviewed_at AS "reviewedAt" FROM task_test_links WHERE project_id=$1 AND requirement_version_id=$2 ORDER BY created_at`,[a.projectId,version.id]),
      pool!.query(`SELECT h.id,h.link_id AS "linkId",h.snapshot,h.recorded_at AS "recordedAt" FROM task_test_link_history h JOIN task_test_links l ON l.id=h.link_id WHERE l.project_id=$1 AND l.requirement_version_id=$2 ORDER BY h.recorded_at DESC,h.id LIMIT 100`,[a.projectId,version.id]),
    ]);
    const items=itemRows.rows.filter(i=>i.versionId===version.id),old=itemRows.rows.filter(i=>i.versionId!==version.id);
    const priorKeys=new Set(old.map(i=>i.key)),newKeys=new Set(items.map(i=>i.key));
    return {version:{id:version.id,number:version.version,current:versions[0]?.id===version.id},
      items:items.map(i=>({...i,change:previous?(priorKeys.has(i.key)?'unchanged':i.predecessorId?'changed_reviewed':'new_or_changed'):'initial',coverage:itemEvidence(i.id,linkRows.rows as EvidenceLink[],caseRows.rows as EvidenceCase[])})),
      links:linkRows.rows,tasks:taskRows.rows,cases:caseRows.rows,previousItems:old,history:historyRows.rows,
      taskTests:pairRows.rows.map(pair=>({...pair,evidence:taskTestEvidence(pair as TaskTestLink,linkRows.rows as EvidenceLink[],caseRows.rows as EvidenceCase[])})),taskTestHistory:pairHistory.rows,
      impact:{previousVersion:previous?.version??null,removedOrChanged:old.filter(i=>!newKeys.has(i.key)),historicalAssets:impactRows.rows[0]},
      scope:'按原文行提取；超过200行合并连续片段，无语义完整性保证。执行证据为人工登记，不代表平台自动执行或验证代码。旧版本关联不会继承到新版本。'};
  });
  app.post('/projects/:projectId/trace/task-tests',async(req,reply)=>{
    const a=await access(req,reply);if(!a)return;
    const parsed=pairInput.safeParse(req.body);if(!parsed.success)return reply.code(400).send({error:'invalid_input'});
    const b=parsed.data,client=await pool!.connect();
    try{
      await client.query('BEGIN');
      await client.query('SELECT id FROM projects WHERE id=$1 AND owner_id=$2 FOR UPDATE',[a.projectId,a.user.id]);
      const item=await client.query(`SELECT requirement_version_id AS version FROM requirement_items WHERE id=$1 AND project_id=$2 AND requirement_version_id=(SELECT id FROM requirement_versions WHERE project_id=$2 AND status='confirmed' ORDER BY version DESC LIMIT 1)`,[b.itemId,a.projectId]);
      if(!item.rows[0]){await client.query('ROLLBACK');return reply.code(409).send({error:'trace_version_outdated'});}
      const version=item.rows[0].version;
      const task=await client.query('SELECT id FROM tasks WHERE id=$1 AND project_id=$2 AND requirement_version_id=$3 FOR UPDATE',[b.taskId,a.projectId,version]);
      const test=await client.query('SELECT id,revision FROM practice_test_cases WHERE id=$1 AND project_id=$2 AND requirement_version_id=$3 FOR UPDATE',[b.caseId,a.projectId,version]);
      if(!task.rows[0]||!test.rows[0]){await client.query('ROLLBACK');return reply.code(404).send({error:'not_found'});}
      if(test.rows[0].revision!==b.expectedCaseRevision){await client.query('ROLLBACK');return reply.code(409).send({error:'test_case_changed'});}
      const links=await client.query(`SELECT task_id AS "taskId",case_id AS "caseId",case_revision AS "caseRevision" FROM trace_links WHERE item_id=$1 AND project_id=$2 AND requirement_version_id=$3 AND status='confirmed' AND (task_id=$4 OR case_id=$5)`,[b.itemId,a.projectId,version,b.taskId,b.caseId]);
      if(b.decision==='confirmed'&&(!links.rows.some(l=>l.taskId===b.taskId)||!links.rows.some(l=>l.caseId===b.caseId&&l.caseRevision===b.expectedCaseRevision))){await client.query('ROLLBACK');return reply.code(409).send({error:'trace_source_review_required'});}
      await client.query(`INSERT INTO task_test_links(project_id,requirement_version_id,item_id,task_id,case_id,case_revision,status,review_note,reviewed_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(item_id,task_id,case_id) DO UPDATE SET case_revision=EXCLUDED.case_revision,status=EXCLUDED.status,review_note=EXCLUDED.review_note,reviewed_by=EXCLUDED.reviewed_by,reviewed_at=now()`,
        [a.projectId,version,b.itemId,b.taskId,b.caseId,b.expectedCaseRevision,b.decision,b.note,a.user.id]);
      await client.query('COMMIT');return {status:b.decision,scope:'human_task_test_pairing_not_execution'};
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  });
  app.post('/projects/:projectId/trace/links',async(req,reply)=>{
    const a=await access(req,reply);if(!a)return;
    const parsed=linkInput.safeParse(req.body);if(!parsed.success)return reply.code(400).send({error:'invalid_input'});
    const b=parsed.data;if(b.targetKind==='case'&&!b.expectedCaseRevision)return reply.code(400).send({error:'case_revision_required'});
    const client=await pool!.connect();
    try{
      await client.query('BEGIN');
      await client.query('SELECT id FROM projects WHERE id=$1 AND owner_id=$2 FOR UPDATE',[a.projectId,a.user.id]);
      const item=await client.query(`SELECT i.requirement_version_id AS version FROM requirement_items i WHERE i.id=$1 AND i.project_id=$2 AND i.requirement_version_id=(SELECT id FROM requirement_versions WHERE project_id=$2 AND status='confirmed' ORDER BY version DESC LIMIT 1)`,[b.itemId,a.projectId]);
      if(!item.rows[0]){await client.query('ROLLBACK');return reply.code(409).send({error:'trace_version_outdated'});}
      const isCase=b.targetKind==='case';const table=isCase?'practice_test_cases':'tasks',column=isCase?'case_id':'task_id';
      const target=await client.query(`SELECT id${isCase?',revision':''} FROM ${table} WHERE id=$1 AND project_id=$2 AND requirement_version_id=$3 FOR UPDATE`,[b.targetId,a.projectId,item.rows[0].version]);
      if(!target.rows[0]){await client.query('ROLLBACK');return reply.code(404).send({error:'not_found'});}
      if(isCase&&target.rows[0].revision!==b.expectedCaseRevision){await client.query('ROLLBACK');return reply.code(409).send({error:'test_case_changed'});}
      await client.query(`INSERT INTO trace_links(project_id,requirement_version_id,item_id,${column},case_revision,origin,status,review_note,reviewed_by,reviewed_at)
        VALUES($1,$2,$3,$4,$5,'human',$6,$7,$8,now()) ON CONFLICT(item_id,${column}) WHERE ${column} IS NOT NULL
        DO UPDATE SET status=EXCLUDED.status,case_revision=EXCLUDED.case_revision,review_note=EXCLUDED.review_note,reviewed_by=EXCLUDED.reviewed_by,reviewed_at=now()`,
        [a.projectId,item.rows[0].version,b.itemId,b.targetId,isCase?b.expectedCaseRevision:null,b.decision,b.note,a.user.id]);
      await client.query('COMMIT');return {status:b.decision,scope:'human_association_review_not_execution'};
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  });
  app.post('/projects/:projectId/trace/change-review',async(req,reply)=>{
    const a=await access(req,reply);if(!a)return;
    const parsed=changeInput.safeParse(req.body);if(!parsed.success)return reply.code(400).send({error:'invalid_input'});
    const b=parsed.data;
    // Only same-project earlier versions may be linked. No execution/link state is copied.
    const result=await pool!.query(`UPDATE requirement_items i SET predecessor_id=p.id,change_review_note=$4,change_reviewed_by=$5,change_reviewed_at=now()
      FROM requirement_items p,requirement_versions iv,requirement_versions pv WHERE i.id=$1 AND p.id=$2 AND i.project_id=$3 AND p.project_id=$3
      AND iv.id=i.requirement_version_id AND pv.id=p.requirement_version_id AND pv.version<iv.version
      AND iv.id=(SELECT id FROM requirement_versions WHERE project_id=$3 AND status='confirmed' ORDER BY version DESC LIMIT 1) RETURNING i.id`,[b.itemId,b.predecessorId,a.projectId,b.note,a.user.id]);
    return result.rowCount?{status:'reviewed',copiedEvidence:false}:reply.code(409).send({error:'trace_version_outdated'});
  });
}
