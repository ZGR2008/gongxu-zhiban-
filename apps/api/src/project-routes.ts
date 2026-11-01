import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { ProjectStore, User } from './project-store.js';
import { RequirementWriteConflict } from './project-store.js';

const scrypt = promisify(scryptCallback);
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
const extractToken = (request: FastifyRequest) => /^Bearer ([a-f0-9]{64})$/.exec(request.headers.authorization ?? '')?.[1];
export async function authorizeRequest(request: FastifyRequest, store: ProjectStore): Promise<User | null> {
  const token = extractToken(request); return token ? store.userBySession(tokenHash(token)) : null;
}
async function makePassword(password: string): Promise<string> { const salt = randomBytes(16).toString('hex'); const key = await scrypt(password, salt, 64) as Buffer; return `${salt}:${key.toString('hex')}`; }
async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hex] = stored.split(':'); if (!salt || !hex || !/^[a-f0-9]{128}$/.test(hex)) return false;
  const expected = Buffer.from(hex, 'hex'); const actual = await scrypt(password, salt, 64) as Buffer; return timingSafeEqual(actual, expected);
}
const credentials = z.object({ email: z.string().trim().email().max(254).transform((v) => v.toLowerCase()), password: z.string().min(10).max(128) });
const registration = credentials.extend({ name: z.string().trim().min(1).max(80) });
const projectInput = z.object({ name: z.string().trim().min(1).max(120), description: z.string().max(10000).default('') });
const requirementInput = z.object({ content: z.string().trim().min(1).max(50000) });
const requirementSnapshot = z.object({ expectedContent: z.string().min(1).max(50000) });
const projectParams = z.object({ projectId: z.string().uuid() });
const requirementParams = projectParams.extend({ id: z.string().uuid() });

export async function registerProjectRoutes(app: FastifyInstance, store?: ProjectStore) {
  // Authentication attempts are limited per process; production should also use a shared gateway limiter.
  const attempts = new Map<string, { count: number; expires: number }>();
  async function issueSession(user: User) { const token = randomBytes(32).toString('hex'); await store!.createSession(user.id, tokenHash(token)); return { token, user }; }
  app.addHook('onRequest', async (request, reply) => {
    const path = request.url.split('?')[0];
    if (!(path.startsWith('/auth/') || path === '/projects' || path.startsWith('/projects/'))) return;
    if (!store) return reply.code(503).send({ error: 'database_not_configured' });
    if (path === '/auth/login' || path === '/auth/register') {
      const now = Date.now();
      for (const [key, value] of attempts) if (value.expires <= now) attempts.delete(key);
      const key = request.ip; const item = attempts.get(key) ?? { count: 0, expires: now + 15 * 60_000 };
      item.count++; attempts.set(key, item);
      if (item.count > 20) return reply.code(429).send({ error: 'too_many_attempts' });
    }
  });
  app.post('/auth/register', async (request, reply) => {
    const input = registration.safeParse(request.body); if (!input.success) return reply.code(400).send({ error: 'invalid_input' });
    const user = await store!.createUser(input.data.name, input.data.email, await makePassword(input.data.password));
    if (!user) return reply.code(409).send({ error: 'email_unavailable' });
    return reply.code(201).send(await issueSession(user));
  });
  app.post('/auth/login', async (request, reply) => {
    const input = credentials.safeParse(request.body); if (!input.success) return reply.code(400).send({ error: 'invalid_input' });
    const user = await store!.findUserByEmail(input.data.email);
    // A missing user still incurs scrypt work to reduce account enumeration timing differences.
    const valid = await verifyPassword(input.data.password, user?.passwordHash ?? '00000000000000000000000000000000:' + '00'.repeat(64));
    if (!user || !valid) return reply.code(401).send({ error: 'invalid_credentials' });
    return issueSession({ id: user.id, name: user.name, email: user.email });
  });
  app.get('/auth/me', async (request, reply) => { const user = await authorizeRequest(request, store!); return user ? { user } : reply.code(401).send({ error: 'unauthorized' }); });
  app.post('/auth/logout', async (request, reply) => { const token = extractToken(request); if (!token || !(await authorizeRequest(request, store!))) return reply.code(401).send({ error: 'unauthorized' }); await store!.deleteSession(tokenHash(token)); return { ok: true }; });
  app.get('/projects', async (request, reply) => { const user = await authorizeRequest(request, store!); if (!user) return reply.code(401).send({ error: 'unauthorized' }); return { projects: await store!.listProjects(user.id) }; });
  app.post('/projects', async (request, reply) => { const user = await authorizeRequest(request, store!); if (!user) return reply.code(401).send({ error: 'unauthorized' }); const input = projectInput.safeParse(request.body); if (!input.success) return reply.code(400).send({ error: 'invalid_input' }); return reply.code(201).send({ project: await store!.createProject(user.id, input.data.name, input.data.description) }); });
  app.get('/projects/:projectId', async (request, reply) => { const user = await authorizeRequest(request, store!); if (!user) return reply.code(401).send({ error: 'unauthorized' }); const params = projectParams.safeParse(request.params); if (!params.success) return reply.code(400).send({ error: 'invalid_input' }); const project = await store!.getProject(user.id, params.data.projectId); if (!project) return reply.code(404).send({ error: 'not_found' }); return { project, requirements: await store!.listRequirements(user.id, project.id) }; });
  app.get('/projects/:projectId/requirements', async (request, reply) => { const user = await authorizeRequest(request, store!); if (!user) return reply.code(401).send({ error: 'unauthorized' }); const params = projectParams.safeParse(request.params); if (!params.success) return reply.code(400).send({ error: 'invalid_input' }); const requirements = await store!.listRequirements(user.id, params.data.projectId); return requirements ? { requirements } : reply.code(404).send({ error: 'not_found' }); });
  app.post('/projects/:projectId/requirements', async (request, reply) => { const user = await authorizeRequest(request, store!); if (!user) return reply.code(401).send({ error: 'unauthorized' }); const params = projectParams.safeParse(request.params); const input = requirementInput.safeParse(request.body); if (!params.success || !input.success) return reply.code(400).send({ error: 'invalid_input' }); const requirement = await store!.createRequirement(user.id, params.data.projectId, input.data.content); return requirement ? reply.code(201).send({ requirement }) : reply.code(404).send({ error: 'not_found' }); });
  app.patch('/projects/:projectId/requirements/:id', async (request, reply) => {
    const user = await authorizeRequest(request, store!); if (!user) return reply.code(401).send({error:'unauthorized'});
    const params = requirementParams.safeParse(request.params), input = requirementInput.safeParse(request.body);
    if (!params.success || !input.success) return reply.code(400).send({error:'invalid_input'});
    if ((request.body as {expectedContent?:unknown})?.expectedContent === undefined) return reply.code(428).send({error:'requirement_snapshot_required'});
    const snapshot = requirementSnapshot.safeParse(request.body); if (!snapshot.success) return reply.code(400).send({error:'invalid_input'});
    try {
      const requirement = await store!.updateRequirement(user.id, params.data.projectId, params.data.id, input.data.content, snapshot.data.expectedContent);
      return requirement ? {requirement} : reply.code(404).send({error:'not_found_or_confirmed'});
    } catch (error) { if (error instanceof RequirementWriteConflict) return reply.code(409).send({error:error.code}); throw error; }
  });
  app.post('/projects/:projectId/requirements/:id/confirm', async (request, reply) => {
    const user = await authorizeRequest(request, store!); if (!user) return reply.code(401).send({error:'unauthorized'});
    const params = requirementParams.safeParse(request.params); if (!params.success) return reply.code(400).send({error:'invalid_input'});
    if ((request.body as {expectedContent?:unknown})?.expectedContent === undefined) return reply.code(428).send({error:'requirement_snapshot_required'});
    const snapshot = requirementSnapshot.safeParse(request.body); if (!snapshot.success) return reply.code(400).send({error:'invalid_input'});
    try {
      const requirement = await store!.confirmRequirement(user.id, params.data.projectId, params.data.id, snapshot.data.expectedContent);
      return requirement ? {requirement} : reply.code(404).send({error:'not_found_or_confirmed'});
    } catch (error) { if (error instanceof RequirementWriteConflict) return reply.code(409).send({error:error.code}); throw error; }
  });
}
