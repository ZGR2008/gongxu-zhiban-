import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { z } from 'zod';
import type { ProjectStore } from '../project-store.js';
import { authorizeRequest } from '../project-routes.js';

const taskParams = z.object({ projectId: z.string().uuid(), taskId: z.string().uuid() });
const updateBody = z.object({ status: z.enum(['todo', 'doing', 'review', 'done', 'blocked']) }).strict();
type Counts = {
  projects: number; confirmedRequirements: number;
  tasks: { total: number; todo: number; doing: number; review: number; done: number; blocked: number };
  codeReviews: number; syntaxFindings: number; testCases: number;
  testExecutions: { total: number; passed: number; failed: number; blocked: number };
};

// Suggestions are deterministic observations about recorded work, not a skill score.
export function recommendations(counts: Counts) {
  const items: { code: string; text: string; evidence: string }[] = [];
  if (counts.tasks.blocked > 0) items.push({ code: 'blocked_tasks', text: '检查阻塞任务，记录阻塞原因并拆分下一步。', evidence: `当前 ${counts.tasks.blocked} 项任务处于阻塞状态，共 ${counts.tasks.total} 项任务。` });
  if (counts.syntaxFindings > 0) items.push({ code: 'syntax_findings', text: '回看语法检查记录，逐条修正并重新提交代码检查。', evidence: `${counts.codeReviews} 次代码审查中记录了 ${counts.syntaxFindings} 条语法诊断；诊断数量不等于未修复问题数量。` });
  if (counts.testCases > counts.testExecutions.total) items.push({ code: 'unexecuted_tests', text: '按用例步骤进行人工测试，并记录实际执行结果。', evidence: `${counts.testCases} 条用例中有 ${counts.testExecutions.total} 条记录了当前执行结果。` });
  if (counts.testExecutions.failed > 0) items.push({ code: 'failed_tests', text: '核对失败用例与需求，修复后重新执行并记录结果。', evidence: `${counts.testExecutions.total} 条当前执行记录中有 ${counts.testExecutions.failed} 条标记为失败。` });
  return items;
}

export async function registerGrowthRoutes(app: FastifyInstance, store?: ProjectStore, pool?: Pool) {
  app.get('/growth', async (request, reply) => {
    if (!store || !pool) return reply.code(503).send({ error: 'database_not_configured' });
    try {
      const user = await authorizeRequest(request, store);
      if (!user) return reply.code(401).send({ error: 'unauthorized' });
      // Every aggregate and event is scoped through the project owner.
      const [summary, events] = await Promise.all([
        pool.query(`WITH owned AS (SELECT id FROM projects WHERE owner_id=$1)
          SELECT
            (SELECT count(*)::int FROM owned) AS projects,
            (SELECT count(*)::int FROM requirement_versions WHERE project_id IN (SELECT id FROM owned) AND status='confirmed') AS "confirmedRequirements",
            (SELECT count(*)::int FROM tasks WHERE project_id IN (SELECT id FROM owned)) AS "tasksTotal",
            (SELECT count(*)::int FROM tasks WHERE project_id IN (SELECT id FROM owned) AND status='todo') AS todo,
            (SELECT count(*)::int FROM tasks WHERE project_id IN (SELECT id FROM owned) AND status='doing') AS doing,
            (SELECT count(*)::int FROM tasks WHERE project_id IN (SELECT id FROM owned) AND status='review') AS review,
            (SELECT count(*)::int FROM tasks WHERE project_id IN (SELECT id FROM owned) AND status='done') AS done,
            (SELECT count(*)::int FROM tasks WHERE project_id IN (SELECT id FROM owned) AND status='blocked') AS blocked,
            (SELECT count(*)::int FROM code_reviews WHERE project_id IN (SELECT id FROM owned)) AS "codeReviews",
            (SELECT COALESCE(sum(jsonb_array_length(syntax_findings)),0)::int FROM code_reviews WHERE project_id IN (SELECT id FROM owned)) AS "syntaxFindings",
            (SELECT count(*)::int FROM practice_test_cases WHERE project_id IN (SELECT id FROM owned)) AS "testCases",
            (SELECT count(*)::int FROM practice_test_cases WHERE project_id IN (SELECT id FROM owned) AND result<>'not_run') AS "executedTests",
            (SELECT count(*)::int FROM practice_test_cases WHERE project_id IN (SELECT id FROM owned) AND result='passed') AS "passedTests",
            (SELECT count(*)::int FROM practice_test_cases WHERE project_id IN (SELECT id FROM owned) AND result='failed') AS "failedTests",
            (SELECT count(*)::int FROM practice_test_cases WHERE project_id IN (SELECT id FROM owned) AND result='blocked') AS "blockedTests"`, [user.id]),
        pool.query(`SELECT * FROM (
          SELECT 'project_created' AS type,p.id AS "projectId",p.name AS "projectName",p.name AS title,p.created_at AS at FROM projects p WHERE p.owner_id=$1
          UNION ALL SELECT 'requirement_confirmed',p.id,p.name,'需求版本 ' || r.version,r.confirmed_at FROM requirement_versions r JOIN projects p ON p.id=r.project_id WHERE p.owner_id=$1 AND r.status='confirmed'
          UNION ALL SELECT 'task_status_changed',p.id,p.name,t.title || '：' || e.previous_status || ' → ' || e.new_status,e.created_at FROM task_status_events e JOIN projects p ON p.id=e.project_id JOIN tasks t ON t.id=e.task_id WHERE p.owner_id=$1
          UNION ALL SELECT 'code_reviewed',p.id,p.name,c.language || ' 语法检查与 AI 审查',c.created_at FROM code_reviews c JOIN projects p ON p.id=c.project_id WHERE p.owner_id=$1
          UNION ALL SELECT 'test_recorded',p.id,p.name,c.title || '：' || c.result,c.executed_at FROM practice_test_cases c JOIN projects p ON p.id=c.project_id WHERE p.owner_id=$1 AND c.executed_at IS NOT NULL
        ) AS activity ORDER BY at DESC LIMIT 30`, [user.id]),
      ]);
      const s = summary.rows[0];
      const counts: Counts = { projects: s.projects, confirmedRequirements: s.confirmedRequirements,
        tasks: { total: s.tasksTotal, todo: s.todo, doing: s.doing, review: s.review, done: s.done, blocked: s.blocked },
        codeReviews: s.codeReviews, syntaxFindings: s.syntaxFindings, testCases: s.testCases,
        testExecutions: { total: s.executedTests, passed: s.passedTests, failed: s.failedTests, blocked: s.blockedTests } };
      return { counts, events: events.rows, recommendations: recommendations(counts), disclaimer: '统计来自当前账户的实际操作记录，不代表编程能力测评。代码语法诊断是历史记录，测试结果为人工登记的当前状态。' };
    } catch (error) { request.log.error(error, 'growth read failed'); return reply.code(503).send({ error: 'database_unavailable' }); }
  });

  app.patch('/projects/:projectId/tasks/:taskId', async (request, reply) => {
    if (!store || !pool) return reply.code(503).send({ error: 'database_not_configured' });
    try {
      const user = await authorizeRequest(request, store);
      if (!user) return reply.code(401).send({ error: 'unauthorized' });
      const params = taskParams.safeParse(request.params); const body = updateBody.safeParse(request.body);
      if (!params.success || !body.success) return reply.code(400).send({ error: 'invalid_input' });
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const current = await client.query(`SELECT t.id,t.project_id AS "projectId",t.title,t.status FROM tasks t JOIN projects p ON p.id=t.project_id WHERE t.id=$1 AND t.project_id=$2 AND p.owner_id=$3 FOR UPDATE OF t`, [params.data.taskId, params.data.projectId, user.id]);
        const task = current.rows[0];
        if (!task) { await client.query('ROLLBACK'); return reply.code(404).send({ error: 'not_found' }); }
        if (task.status !== body.data.status) {
          await client.query('UPDATE tasks SET status=$2 WHERE id=$1', [task.id, body.data.status]);
          await client.query('INSERT INTO task_status_events(task_id,project_id,actor_id,previous_status,new_status) VALUES($1,$2,$3,$4,$5)', [task.id, params.data.projectId, user.id, task.status, body.data.status]);
          task.status = body.data.status;
        }
        await client.query('COMMIT'); return { task };
      } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    } catch (error) { request.log.error(error, 'task update failed'); return reply.code(503).send({ error: 'database_unavailable' }); }
  });
}
