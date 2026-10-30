import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApp } from './app.js';
import type { ProjectStore, User, Project, Requirement } from './project-store.js';

function fakeStore(): ProjectStore {
  const users = new Map<string, User & {passwordHash: string}>(); const sessions = new Map<string,string>();
  const projects = new Map<string, Project & { owner: string }>(); const requirements = new Map<string, Requirement>();
  const owned = (u: string, p: string) => projects.get(p)?.owner === u;
  return {
    async createUser(name,email,passwordHash) { if (users.has(email)) return null; const user = {id:randomUUID(),name,email,passwordHash}; users.set(email,user); return {id:user.id,name,email}; },
    async findUserByEmail(email) { return users.get(email) ?? null; },
    async createSession(id,hash) { sessions.set(hash,id); },
    async userBySession(hash) { return [...users.values()].find(u => u.id === sessions.get(hash)) ?? null; },
    async deleteSession(hash) { sessions.delete(hash); },
    async listProjects(userId) { return [...projects.values()].filter(p => p.owner === userId); },
    async createProject(userId,name,description) { const p = {id:randomUUID(),name,description,status:'active',createdAt:new Date(),updatedAt:new Date(),owner:userId}; projects.set(p.id,p); return p; },
    async getProject(userId,id) { return owned(userId,id) ? projects.get(id)! : null; },
    async listRequirements(userId,id) { return owned(userId,id) ? [...requirements.values()].filter(r => r.projectId === id) : null; },
    async createRequirement(userId,projectId,content) { if (!owned(userId,projectId)) return null; const r: Requirement = {id:randomUUID(),projectId,version:[...requirements.values()].filter(x=>x.projectId===projectId).length+1,content,status:'draft',createdAt:new Date(),confirmedAt:null}; requirements.set(r.id,r); return r; },
    async updateRequirement(userId,projectId,id,content) { const r = requirements.get(id); if (!owned(userId,projectId) || !r || r.projectId !== projectId || r.status !== 'draft') return null; r.content=content; return r; },
    async confirmRequirement(userId,projectId,id) { const r = requirements.get(id); if (!owned(userId,projectId) || !r || r.projectId !== projectId || r.status !== 'draft') return null; r.status='confirmed'; r.confirmedAt=new Date(); return r; },
  };
}

test('authentication, ownership, requirement editing, versioning, confirmation and logout', async () => {
  const app = await createApp({ corsOrigin:'http://localhost:5173', projectStore:fakeStore() });
  const register = (email:string) => app.inject({ method:'POST', url:'/auth/register', payload:{email,name:'student',password:'strong-password-123'} });
  const a = await register('a@example.com'); const b = await register('b@example.com'); assert.equal(a.statusCode,201); assert.equal(b.statusCode,201);
  const ha = {authorization:`Bearer ${a.json().token}`}; const hb = {authorization:`Bearer ${b.json().token}`};
  assert.equal((await app.inject({method:'POST',url:'/auth/login',payload:{email:'a@example.com',password:'wrong-password'}})).statusCode,401);
  assert.equal((await app.inject({method:'POST',url:'/auth/login',payload:{email:'a@example.com',password:'strong-password-123'}})).statusCode,200);
  const created = await app.inject({method:'POST',url:'/projects',headers:ha,payload:{name:'项目',description:'说明'}}); assert.equal(created.statusCode,201); const projectId = created.json().project.id;
  assert.equal((await app.inject({method:'GET',url:`/projects/${projectId}`,headers:hb})).statusCode,404);
  assert.equal((await app.inject({method:'POST',url:`/projects/${projectId}/requirements`,headers:hb,payload:{content:'unauthorized'}})).statusCode,404);
  const url = `/projects/${projectId}/requirements`;
  const draft = await app.inject({method:'POST',url,headers:ha,payload:{content:'需求草稿'}}); assert.equal(draft.statusCode,201); const id=draft.json().requirement.id;
  assert.equal((await app.inject({method:'PATCH',url:`${url}/${id}`,headers:ha,payload:{content:'更新需求'}})).json().requirement.content,'更新需求');
  assert.equal((await app.inject({method:'POST',url:`${url}/${id}/confirm`,headers:ha})).json().requirement.status,'confirmed');
  assert.equal((await app.inject({method:'PATCH',url:`${url}/${id}`,headers:ha,payload:{content:'不能更改'}})).statusCode,404);
  assert.equal((await app.inject({method:'POST',url,headers:ha,payload:{content:'第二版'}})).json().requirement.version,2);
  assert.equal((await app.inject({method:'GET',url:`/projects/${projectId}`,headers:ha})).json().requirements.length,2);
  assert.equal((await app.inject({method:'POST',url:'/auth/logout',headers:ha})).statusCode,200);
  assert.equal((await app.inject({method:'GET',url:'/projects',headers:ha})).statusCode,401);
  await app.close();
});

test('business endpoints report database unconfigured and reject anonymous access', async () => {
  const absent = await createApp({corsOrigin:'http://localhost:5173'}); assert.equal((await absent.inject('/projects')).statusCode,503); await absent.close();
  const app = await createApp({corsOrigin:'http://localhost:5173',projectStore:fakeStore()}); assert.equal((await app.inject('/projects')).statusCode,401); await app.close();
});

test('database errors do not leak connection details', async () => {
  const store = fakeStore(); store.userBySession = async () => { throw new Error('sensitive database detail'); };
  const app = await createApp({corsOrigin:'http://localhost:5173',projectStore:store});
  const response = await app.inject({url:'/projects',headers:{authorization:`Bearer ${'a'.repeat(64)}`}});
  assert.equal(response.statusCode,500); assert.ok(!response.body.includes('sensitive database detail')); await app.close();
});
