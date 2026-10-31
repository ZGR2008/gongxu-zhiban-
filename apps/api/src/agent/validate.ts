import { z } from 'zod';

const item = z.object({
  key: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,31}$/),
  stage: z.string().trim().min(1).max(100),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(2000),
  deliverable: z.string().trim().min(1).max(500),
  dependsOn: z.array(z.string()).max(30),
  citations: z.array(z.string().uuid()).max(5),
  requirementIds: z.array(z.string().regex(/^REQ-[a-f0-9]{16}$/)).max(200).optional(),
}).strict();
const schema = z.object({ tasks: z.array(item).min(1).max(30) }).strict();
export type Plan = z.infer<typeof schema>;

/** Validate structure, references and acyclic dependencies without relying on the model. */
export function validatePlan(raw: string, allowedCitations: string[]): { plan?: Plan; errors: string[] } {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return { errors: ['输出不是有效 JSON'] }; }
  const result = schema.safeParse(parsed);
  if (!result.success) return { errors: ['输出结构或字段不符合要求'] };
  const tasks = result.data.tasks;
  const ids = new Set(tasks.map(t => t.key));
  const evidence = new Set(allowedCitations);
  const errors: string[] = [];
  if (ids.size !== tasks.length) errors.push('任务 key 必须唯一');
  for (const task of tasks) {
    if (new Set(task.dependsOn).size !== task.dependsOn.length) errors.push(`${task.key} 的依赖重复`);
    if (task.dependsOn.some(d => !ids.has(d) || d === task.key)) errors.push(`${task.key} 的依赖无效`);
    if (task.citations.some(c => !evidence.has(c))) errors.push(`${task.key} 引用了未检索到的来源`);
  }
  const done = new Set<string>(); const active = new Set<string>();
  const byKey = new Map(tasks.map(t => [t.key, t]));
  function visit(key: string): boolean {
    if (active.has(key)) return false;
    if (done.has(key)) return true;
    active.add(key);
    for (const dep of byKey.get(key)?.dependsOn ?? []) if (byKey.has(dep) && !visit(dep)) return false;
    active.delete(key); done.add(key); return true;
  }
  if (tasks.some(t => !visit(t.key))) errors.push('任务依赖存在循环');
  return errors.length ? { errors } : { plan: result.data, errors: [] };
}
