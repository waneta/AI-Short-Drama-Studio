import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { createRequire } from 'node:module'
const require=createRequire(import.meta.url),{build}=require('esbuild')
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'juliu-codex-protocol-'))
const fake=path.join(temp,'fake-codex')
await fs.writeFile(fake,`#!${process.execPath}
const readline=require('node:readline'),fs=require('node:fs');
const log=m=>fs.appendFileSync(process.env.JULIU_PROTOCOL_LOG,JSON.stringify(m)+'\\n');
const send=m=>process.stdout.write(JSON.stringify(m)+'\\n');
let waiting=false;
readline.createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);log(m);const result=r=>send({id:m.id,result:r});
if(m.method==='initialize')result({});
else if(m.method==='account/read')result({account:{type:'chatgpt'},requiresOpenaiAuth:true});
else if(m.method==='config/read')result({config:{model_reasoning_effort:'high'}});
else if(m.method==='model/list')result({data:[{id:'fixture',model:'fixture',displayName:'Fixture',isDefault:true}]});
else if(m.method==='thread/start'||m.method==='thread/resume')result({thread:{id:'fixture-thread'}});
else if(m.method==='turn/start'){result({turn:{id:'fixture-turn'}});send({method:'turn/started',params:{turn:{id:'fixture-turn'}}});const text=m.params.input[0].text;if(text.includes('HOLD'))return;if(text.includes('TOOL')){waiting=true;send({id:900,method:'item/tool/call',params:{tool:'juliu_read_project',callId:'fixture-call',threadId:'fixture-thread',turnId:'fixture-turn',arguments:{}}});return}send({method:'item/completed',params:{item:{type:'agentMessage',text:'{"ok":true}'}}});send({method:'turn/completed',params:{turn:{status:'completed'}}})}
else if(!m.method&&m.id===900&&waiting){waiting=false;send({method:'item/completed',params:{item:{type:'agentMessage',text:'tool success'}}});send({method:'turn/completed',params:{turn:{status:'completed'}}})}
});
`,{mode:0o700})
process.env.JULIU_CODEX_CONFIG_FILE=path.join(temp,'private/connection.json');process.env.JULIU_CODEX_BIN=fake;process.env.JULIU_PROTOCOL_LOG=path.join(temp,'protocol.jsonl')
const built=path.join(temp,'bridge.mjs')
await build({entryPoints:['scripts/codex-bridge.ts'],bundle:true,platform:'node',format:'esm',outfile:built,external:['vite'],target:'node22'})
const {codexBridge}=await import(built)
const server=http.createServer(),plugin=codexBridge()
plugin.configureServer({middlewares:{use:fn=>server.on('request',(req,res)=>fn(req,res,()=>{res.statusCode=404;res.end()}))},httpServer:server})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const base=`http://127.0.0.1:${server.address().port}/__juliu-codex`
const headers={'Content-Type':'application/json','X-Juliu-Codex':'1'}
const post=(route,data,h=headers)=>fetch(base+route,{method:'POST',headers:h,body:JSON.stringify(data)})
const input={kind:'agent',clientId:'fixture-client',projectId:'fixture-project',conversationId:'fixture-conversation',prompt:'TOOL'}
const checks=[];const pass=name=>{checks.push({name,passed:true});console.log(name)}
try{
assert.equal((await fetch(base+'/status')).status,403);pass('缺少本机请求标识被拒绝')
assert.equal((await fetch(base+'/status',{headers:{...headers,Origin:'https://other.invalid'}})).status,403);pass('跨站请求被拒绝')
const health=await(await fetch(base+'/health',{headers})).json();assert.equal(health.bridge,'juliu-codex');assert.equal(health.tools,5);pass('本地健康检查不提交模型请求')
const status=await(await fetch(base+'/status',{headers})).json();assert(status.authenticated);assert.equal(status.models[0].model,'fixture');pass('状态只返回登录类型和模型目录')
assert.equal((await post('/run',{...input,kind:'shell'})).status,400);pass('非预定义任务类型被拒绝')
const response=await post('/run',input), reader=response.body.getReader();let buffer='',identity,tool
while(!tool){const{value}=await reader.read();buffer+=new TextDecoder().decode(value);let n;while((n=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,n);buffer=buffer.slice(n+1);if(!line)continue;const ev=JSON.parse(line);if(ev.type==='started')identity={runId:ev.runId,token:ev.token};if(ev.type==='tool')tool=ev}}
assert.equal(tool.tool,'juliu_read_project');pass('app-server 动态工具请求被转发到页面')
assert.equal((await post('/run',input)).status,409);pass('同项目对话禁止并发执行')
assert.equal((await post('/tool-result',{...identity,token:'wrong',callId:tool.callId,success:true,contentItems:[]})).status,404);pass('工具结果必须匹配任务凭证')
assert.equal((await post('/tool-result',{...identity,callId:tool.callId,success:true,contentItems:[{type:'inputText',text:'project fixture'}]})).status,200)
let final=buffer;while(true){const r=await reader.read();if(r.done)break;final+=new TextDecoder().decode(r.value)}assert(final.includes('tool success'));pass('真实协议收到工具反馈后继续并完成')
assert.equal((await post('/tool-result',{...identity,callId:tool.callId,success:true,contentItems:[]})).status,404);pass('结束后不重复接收工具结果')
const resumed=await post('/run',{...input,prompt:'simple text'});await resumed.text()
const logs=(await fs.readFile(process.env.JULIU_PROTOCOL_LOG,'utf8')).trim().split('\n').map(JSON.parse)
assert(logs.some(m=>m.method==='thread/resume'&&m.params.threadId==='fixture-thread'));pass('同一会话恢复线程且刷新工作目录')
const init=logs.find(m=>m.method==='thread/start');assert.equal(init.params.sandbox,'read-only');assert.equal(init.params.approvalPolicy,'never');assert.equal(init.params.dynamicTools.length,5);pass('显式限定工具目录、只读沙箱与协议能力')
const hold=await post('/run',{...input,conversationId:'cancel-fixture',prompt:'HOLD'}),holdReader=hold.body.getReader();let holdIdentity;while(!holdIdentity){const r=await holdReader.read();for(const line of new TextDecoder().decode(r.value).trim().split('\n')){const ev=JSON.parse(line);if(ev.type==='started')holdIdentity={runId:ev.runId,token:ev.token}}}
await new Promise(r=>setTimeout(r,80));assert.equal((await post('/cancel',holdIdentity)).status,200);await holdReader.cancel().catch(()=>{});pass('取消关闭本轮连接及子进程')
await fs.mkdir('/tmp/juliu-dual-engine-tests',{recursive:true});await fs.writeFile('/tmp/juliu-dual-engine-tests/server-validation.json',JSON.stringify({checks,realModel:false},null,2))
console.log('Passed '+checks.length+' server checks')
}finally{server.closeAllConnections();await new Promise(r=>server.close(r));await fs.rm(temp,{recursive:true,force:true})}
