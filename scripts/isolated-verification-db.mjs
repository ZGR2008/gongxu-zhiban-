import {createRequire} from 'node:module';import {randomUUID} from 'node:crypto';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {fileURLToPath} from 'node:url';
/** Caller keeps the connection string in memory only. Never emits credentials or changes roles. */
export async function isolatedVerificationDatabase(){
 const require=createRequire(new URL('../apps/api/package.json',import.meta.url));require('dotenv').config({path:fileURLToPath(new URL('../apps/api/.env',import.meta.url)),quiet:true});
 const url=new URL(process.env.DATABASE_URL??'invalid:');if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw Error('Local database configuration required');
 const {Pool}=require('pg'),pool=new Pool({connectionString:url.href,connectionTimeoutMillis:3000});
 const name='gx_verify_v6_'+randomUUID().replaceAll('-','');
 try{await pool.query(`CREATE DATABASE ${name} TEMPLATE template0`);}finally{await pool.end();}
 url.pathname='/'+name;
 await promisify(execFile)(process.execPath,[fileURLToPath(new URL('../apps/api/dist/migrate.js',import.meta.url))],{cwd:fileURLToPath(new URL('../apps/api/',import.meta.url)),env:{...process.env,DATABASE_URL:url.href},windowsHide:true,timeout:30000,maxBuffer:128000});
 return {env:{DATABASE_URL:url.href},evidence:{database:name,retained:true,primaryDatabaseModified:false,credentialConfigurationChanged:false}};
}
