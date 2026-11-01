// Actual loopback HTTP transport only. No application data, credentials or model calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {fetchJsonResponse} from '../apps/web/src/components/request-transport.ts';

async function local(handler,work){
 const server=createServer(handler);server.listen(0,'127.0.0.1');await once(server,'listening');
 const url=`http://127.0.0.1:${server.address().port}/fixture`;
 try{await work(url);}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
const timeout=error=>error.code==='request_timeout'&&error.message.includes('读取超时');
test('read timeout stops a real HTTP request before headers and does not retry',async()=>{
 let calls=0;await local(()=>{calls++;},async url=>{await assert.rejects(fetchJsonResponse(url,{},200),timeout);assert.equal(calls,1);});
});
test('read deadline includes stalled JSON body after successful headers',async()=>{
 let headersSent=false;await local((_req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.flushHeaders();res.write('{"ok":');headersSent=true;},async url=>{
  await assert.rejects(fetchJsonResponse(url,{},200),timeout);assert.equal(headersSent,true);
 });
});
test('caller cancellation during the response body retains its own reason',async()=>{
 let reached;const started=new Promise(resolve=>{reached=resolve;});const controller=new AbortController(),reason=new Error('controlled local cancellation');
 await local((_req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.flushHeaders();res.write('{');reached();},async url=>{
  const pending=fetchJsonResponse(url,{signal:controller.signal},2000);const rejected=assert.rejects(pending,error=>error===reason);await started;controller.abort(reason);await rejected;
 });
});
test('successful non-object or malformed JSON fails without exposing raw response content',async()=>{
 for(const body of ['<html>synthetic proxy body</html>','null','[]','"synthetic string"','{"incomplete":'])await local((_req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.end(body);},async url=>{
  await assert.rejects(fetchJsonResponse(url),error=>error.code==='invalid_response'&&!error.message.includes('synthetic')&&!error.message.includes('incomplete'));
 });
});
test('non-JSON errors preserve HTTP status with no response-body disclosure',async()=>{
 await local((_req,res)=>{res.writeHead(503,{'content-type':'text/html'});res.end('<h1>synthetic upstream detail</h1>');},async url=>{
  const result=await fetchJsonResponse(url);assert.equal(result.response.status,503);assert.deepEqual(result.data,{});
 });
});
test('a slow write is not cancelled by the default read policy or retried',async()=>{
 let calls=0,received='';await local((req,res)=>{calls++;req.on('data',data=>{received+=data;});setTimeout(()=>{res.writeHead(201,{'content-type':'application/json'});res.end('{"saved":true}');},200);},async url=>{
  const result=await fetchJsonResponse(url,{method:'POST',body:'synthetic draft'},20);assert.equal(result.response.status,201);assert.deepEqual(result.data,{saved:true});assert.equal(calls,1);assert.equal(received,'synthetic draft');
 });
});
test('valid object reads preserve complete data and do not cancel a completed response',async()=>{
 await local((_req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.end('{"content":"完整正文与末尾验收条件","items":[1,2]}');},async url=>{
  const result=await fetchJsonResponse(url,{},200);assert.deepEqual(result.data,{content:'完整正文与末尾验收条件',items:[1,2]});
 });
});
test('connection failure is recoverable without exposing host or internal error details',async()=>{
 const server=createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const port=server.address().port;await new Promise(resolve=>server.close(resolve));
 await assert.rejects(fetchJsonResponse(`http://127.0.0.1:${port}/closed`),error=>error.code==='connection_unavailable'&&!error.message.includes(String(port))&&!error.message.includes('ECONN'));
});
