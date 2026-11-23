import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { createHash, randomUUID } from 'node:crypto'
const require=createRequire(import.meta.url),{build}=require('esbuild')
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'juliu-continuity-real-')), out=process.env.JULIU_TEST_OUT||'/tmp/juliu-codex-continuity-real'
await fs.mkdir(out,{recursive:true})
const globalConfig=path.join(os.homedir(),'.codex/config.toml'),beforeHash=createHash('sha256').update(await fs.readFile(globalConfig)).digest('hex')
const built=path.join(temp,'bridge.mjs'),hostFile=path.join(temp,'host.mjs')
await build({entryPoints:['scripts/codex-bridge.ts'],bundle:true,platform:'node',format:'esm',outfile:built,external:['vite'],target:'node22'})
await fs.writeFile(hostFile,`import http from 'node:http';import {codexBridge} from ${JSON.stringify(built)};const server=http.createServer();codexBridge().configureServer({middlewares:{use:fn=>server.on('request',(req,res)=>fn(req,res,()=>res.end()))},httpServer:server});server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({port:server.address().port})));process.on('SIGTERM',()=>{server.closeAllConnections();server.close(()=>process.exit(0))});`)
const headers={'Content-Type':'application/json','X-Juliu-Codex':'1'},hosts=[],checks=[]
async function start(){const child=spawn(process.execPath,[hostFile],{env:{...process.env,JULIU_CODEX_CONFIG_FILE:path.join(temp,'private/connection.json'),JULIU_CODEX_PROXY:'http://127.0.0.1:7897'},stdio:['ignore','pipe','pipe']});const port=await new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(new Error('startup timeout')),15000);child.stdout.on('data',b=>{text+=b;if(text.includes('\n')){clearTimeout(timer);resolve(JSON.parse(text.split('\n')[0]).port)}});child.on('error',reject)});const h={child,base:'http://127.0.0.1:'+port+'/__juliu-codex'};hosts.push(h);return h}
async function stop(h){if(h.child.exitCode!==null||h.child.signalCode)return;h.child.kill('SIGTERM');await new Promise(r=>h.child.once('exit',r))}
const identity={kind:'agent',clientId:'isolated-real-browser',projectId:'synthetic-continuity-project',conversationId:'synthetic-chat'}
async function run(h,prompt,model){const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),240000);try{const response=await fetch(h.base+'/run',{method:'POST',headers,body:JSON.stringify({...identity,prompt,model}),signal:ctl.signal});assert(response.ok);const reader=response.body.getReader();let buffer='',id,done,events=[];while(true){const r=await reader.read();buffer+=new TextDecoder().decode(r.value||new Uint8Array());let n;while((n=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,n);buffer=buffer.slice(n+1);if(!line)continue;const e=JSON.parse(line);events.push(e);if(e.type==='started')id={runId:e.runId,token:e.token};if(e.type==='error')throw new Error(e.message);if(e.type==='progress')console.log(e.message);if(e.type==='done')done=e;if(e.type==='tool'){assert(['juliu_read_project','juliu_read_history'].includes(e.tool),'Only synthetic read tools are allowed');const payload=e.tool==='juliu_read_project'?{id:identity.projectId,name:'虚构的连续对话验收项目',canvas:{nodes:[],edges:[]},conversations:[]}:{messages:[],conversations:[]};const result=await fetch(h.base+'/tool-result',{method:'POST',headers,body:JSON.stringify({...id,callId:e.callId,success:true,contentItems:[{type:'inputText',text:JSON.stringify(payload)}]})});assert(result.ok)}}if(r.done)break}assert(done);return {done,events}}finally{clearTimeout(timer)}}
const files=async(dir)=>{let a=[];for(const e of await fs.readdir(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())a.push(...await files(p));else a.push(p)}return a}
try {
  let host=await start();const statusResponse=await fetch(host.base+'/status',{headers,signal:AbortSignal.timeout(45000)}),status=await statusResponse.json();assert(statusResponse.ok&&status.authenticated);const model=status.models.find(m=>m.isDefault)?.model||status.models[0]?.model;assert(model)
  const marker='CONTINUITY-'+randomUUID()
  await run(host,'这是虚构项目的连续对话验收。请先调用juliu_read_project确认项目，再记住验收口令：'+marker+'。不要修改任何内容，不生成媒体，只回复“已记住”。',model)
  const record=(await files(path.join(temp,'private/conversations'))).find(f=>f.endsWith('.json'));assert(record)
  const before=JSON.parse(await fs.readFile(record,'utf8'));assert(before.threadId&&!before.inProgress);checks.push({name:'真实CLI完成首轮并持久保存thread',passed:true})
  await stop(host);host=await start()
  const result=await run(host,'这是重启后的下一条消息。请回忆刚才告诉你的验收口令，只输出口令。不要调用历史检索，不修改项目或生成媒体。',model)
  assert(result.events.some(e=>e.message?.includes('已恢复本项目原')));assert(result.done.text.includes(marker),'Expected old marker from native thread memory')
  const after=JSON.parse(await fs.readFile(record,'utf8'));assert.equal(after.threadId,before.threadId);assert(!after.inProgress)
  checks.push({name:'重启真实Web进程后恢复同一thread，无历史重发仍正确回忆首轮口令',passed:true})
  assert.equal(createHash('sha256').update(await fs.readFile(globalConfig)).digest('hex'),beforeHash)
  checks.push({name:'用户全局config.toml未修改，合成只读项目未生成媒体',passed:true})
  await fs.writeFile(path.join(out,'real-validation.json'),JSON.stringify({checks,realCli:true,realModel:true,actualHostRestart:true,sameThread:true,noHistoryResent:true,userProjectsModified:false,realMediaGeneration:false,globalConfigUnchanged:true},null,2));console.log('Passed '+checks.length+' real continuity checks')
} finally {for(const h of hosts)await stop(h).catch(()=>{});await fs.rm(temp,{recursive:true,force:true})}
