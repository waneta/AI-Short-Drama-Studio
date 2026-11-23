import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url), { build } = require('esbuild')
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'juliu-continuity-'))
const out = process.env.JULIU_TEST_OUT || '/tmp/juliu-codex-continuity-tests'
await fs.mkdir(out, { recursive: true }); await fs.mkdir(path.join(temp,'native'))
const fake = path.join(temp,'fake-codex'), logFile = path.join(temp,'protocol.jsonl'), fault = path.join(temp,'fault.json')
await fs.writeFile(fake, `#!${process.execPath}
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),readline=require('node:readline');
const log=m=>fs.appendFileSync(process.env.FIXTURE_LOG,JSON.stringify({...m,pid:process.pid,cwd:process.cwd()})+'\\n');
const send=m=>process.stdout.write(JSON.stringify(m)+'\\n');let thread,turn;
const file=id=>path.join(process.env.FIXTURE_NATIVE,id+'.json');const save=()=>fs.writeFileSync(file(thread.id),JSON.stringify(thread));
readline.createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);log(m);const ok=result=>send({id:m.id,result});
if(m.method==='initialize')ok({});
else if(m.method==='account/read')ok({account:{type:'chatgpt'},requiresOpenaiAuth:true});
else if(m.method==='config/read')ok({config:{model_reasoning_effort:'high'}});
else if(m.method==='model/list')ok({data:[]});
else if(m.method==='thread/start'){thread={id:crypto.randomUUID(),history:[],tools:m.params.dynamicTools};save();ok({thread:{id:thread.id}})}
else if(m.method==='thread/resume'){const fail=JSON.parse(fs.readFileSync(process.env.FIXTURE_FAULT,'utf8'));if(fail.resume){send({id:m.id,error:{code:-32000,message:fail.resume==='missing'?'Thread not found: '+m.params.threadId:'connection timed out during resume'}});return}if(!fs.existsSync(file(m.params.threadId))){send({id:m.id,error:{code:-32000,message:'Thread not found: '+m.params.threadId}});return}thread=JSON.parse(fs.readFileSync(file(m.params.threadId),'utf8'));ok({thread:{id:thread.id}})}
else if(m.method==='turn/interrupt'){ok({});send({method:'turn/completed',params:{turn:{id:m.params.turnId,status:'interrupted'}}})}
else if(m.method==='turn/start'){turn=crypto.randomUUID();thread.history.push(m.params.input[0].text);save();ok({turn:{id:turn}});send({method:'turn/started',params:{turn:{id:turn}}});const text=m.params.input[0].text;if(text.includes('HOLD'))return;if(text.includes('TOOL_HISTORY')){send({id:900,method:'item/tool/call',params:{tool:'juliu_read_history',arguments:{query:'旧目标'},callId:'fixture-history',threadId:thread.id,turnId:turn}});return}const marker=thread.history.map(s=>/REMEMBER:([A-Za-z0-9-]+)/.exec(s)?.[1]).find(Boolean)||'none';send({method:'item/completed',params:{item:{type:'agentMessage',text:'RECALL:'+marker}}});send({method:'turn/completed',params:{turn:{id:turn,status:'completed'}}})}
else if(m.id===900&&!m.method){send({method:'item/completed',params:{item:{type:'agentMessage',text:'历史已查阅'}}});send({method:'turn/completed',params:{turn:{id:turn,status:'completed'}}})}
}).on('close',()=>process.exit(0));
`,{mode:0o700})
await fs.writeFile(fault,'{}')
const bridgeFile = path.join(temp,'bridge.mjs')
await build({entryPoints:['scripts/codex-bridge.ts'],bundle:true,platform:'node',format:'esm',outfile:bridgeFile,external:['vite'],target:'node22'})
const host = path.join(temp,'host.mjs')
await fs.writeFile(host, `import http from 'node:http';import {codexBridge} from ${JSON.stringify(bridgeFile)};
const server=http.createServer();codexBridge().configureServer({middlewares:{use:fn=>server.on('request',(req,res)=>fn(req,res,()=>res.end()))},httpServer:server});
server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({port:server.address().port})));
process.on('SIGTERM',()=>{server.closeAllConnections();server.close(()=>process.exit(0))});`)
const env={...process.env,JULIU_CODEX_BIN:fake,JULIU_CODEX_CONFIG_FILE:path.join(temp,'private/connection.json'),FIXTURE_LOG:logFile,FIXTURE_NATIVE:path.join(temp,'native'),FIXTURE_FAULT:fault}
const hosts=[], checks=[]
async function start() {
  const child=spawn(process.execPath,[host],{env,stdio:['ignore','pipe','pipe']});let error='';child.stderr.on('data',b=>error+=b)
  const port=await new Promise((resolve,reject)=>{let str='';const t=setTimeout(()=>reject(new Error('host timeout '+error)),10000);child.stdout.on('data',b=>{str+=b;if(str.includes('\n')){clearTimeout(t);resolve(JSON.parse(str.split('\n')[0]).port)}});child.on('error',reject)})
  const value={child,base:`http://127.0.0.1:${port}/__juliu-codex`};hosts.push(value);return value
}
async function stop(host,signal='SIGTERM'){if(host.child.exitCode!==null||host.child.signalCode)return;host.child.kill(signal);await new Promise(r=>host.child.once('exit',r))}
const headers={'Content-Type':'application/json','X-Juliu-Codex':'1'}
const input={kind:'agent',clientId:'browser-a',projectId:'project-a',conversationId:'chat-a',model:'fixture',prompt:'REMEMBER:old-project-goal'}
const post=(host,data)=>fetch(host.base+'/run',{method:'POST',headers,body:JSON.stringify(data)})
const run=async(host,data)=>{const response=await post(host,data);assert.equal(response.status,200);return(await response.text()).trim().split('\n').map(JSON.parse)}
const logs=async()=> (await fs.readFile(logFile,'utf8')).trim().split('\n').map(JSON.parse)
const files=async(dir)=>{const out=[];for(const e of await fs.readdir(dir,{withFileTypes:true})){const p=path.join(dir,e.name);out.push(p);if(e.isDirectory())out.push(...await files(p))}return out}
const pass=name=>{checks.push({name,passed:true});console.log(name)}
try {
  let a=await start()
  const first=await run(a,input);assert(first.some(e=>e.text==='RECALL:old-project-goal'));assert(first.some(e=>e.message?.includes('已建立并保存')))
  let nativeLogs=await logs();const started=nativeLogs.find(m=>m.method==='thread/start'), threadIds=(await fs.readdir(path.join(temp,'native')))
  assert.equal(started.params.ephemeral,false);assert.equal(started.params.dynamicTools.length,5)
  const workspace=started.params.cwd;assert(workspace.startsWith(path.join(temp,'private/conversations')));await fs.stat(workspace)
  pass('首次任务持久保存真实thread关联，并使用项目专属稳定工作区')
  await stop(a);a=await start()
  const resumed=await run(a,{...input,prompt:'RECALL ONLY'});assert(resumed.some(e=>e.text==='RECALL:old-project-goal'));assert(resumed.some(e=>e.message?.includes('已恢复本项目原')))
  nativeLogs=await logs();const restore=nativeLogs.filter(m=>m.method==='thread/resume').at(-1);assert.equal(restore.params.threadId,threadIds[0].replace('.json',''));assert.equal(restore.params.cwd,workspace)
  assert.notEqual(started.pid,restore.pid);pass('真正重启Web子进程后恢复原thread，记住旧目标且工作区不变')
  for(const patch of [{projectId:'project-b'},{conversationId:'chat-b'},{clientId:'browser-b'},{model:'other-model'}]) {
    const separate=await run(a,{...input,...patch,prompt:'RECALL ONLY'});assert(separate.some(e=>e.text==='RECALL:none'))
  }
  pass('不同项目、聊天、浏览器及模型不串上下文')
  const held=await post(a,{...input,prompt:'HOLD'}),reader=held.body.getReader();let identity
  for(let i=0;!identity;i++){const r=await reader.read();for(const line of new TextDecoder().decode(r.value).trim().split('\n')){const e=JSON.parse(line);if(e.type==='started')identity=e}}
  const b=await start();assert.equal((await post(b,input)).status,409);pass('两个独立Web进程并发同一项目对话被持久锁拒绝')
  await new Promise(r=>setTimeout(r,100));await stop(a,'SIGKILL');await reader.cancel().catch(()=>{})
  const afterCrash=await run(b,{...input,prompt:'RECALL ONLY'});assert(afterCrash.some(e=>e.text==='RECALL:old-project-goal'),JSON.stringify(afterCrash));assert((await logs()).some(m=>m.method==='turn/interrupt'))
  assert((await logs()).filter(m=>m.method==='turn/start').at(-1).params.input[0].text.includes('上次任务曾中断'))
  pass('异常退出后回收失效锁、恢复会话并停止旧turn，不重放中断操作')
  const beforeFailures=(await logs()).filter(m=>m.method==='thread/start').length
  await fs.writeFile(fault,JSON.stringify({resume:'network'}));const failed=await run(b,{...input,prompt:'RECALL ONLY'});assert(failed.some(e=>e.type==='error'&&e.message.includes('恢复原 Codex 对话失败')))
  assert.equal((await logs()).filter(m=>m.method==='thread/start').length,beforeFailures);pass('网络恢复失败明确报错，不悄悄新建或重放')
  await fs.writeFile(fault,'{}');const retry=await run(b,{...input,prompt:'RECALL ONLY'});assert(retry.some(e=>e.text==='RECALL:old-project-goal'));pass('重试仍恢复原thread和已有上下文')
  await fs.writeFile(fault,JSON.stringify({resume:'missing'}));const rebuilt=await run(b,{...input,prompt:'RECALL ONLY'});assert(rebuilt.some(e=>e.message?.includes('原 Codex 会话文件已不可用')));assert(rebuilt.some(e=>e.type==='done'));assert((await logs()).filter(m=>m.method==='turn/start').at(-1).params.input[0].text.includes('恢复背景'))
  pass('仅确认旧会话缺失才重建，并明确提示读取已存历史')
  await fs.writeFile(fault,'{}')
  const toolsResponse=await post(b,{...input,prompt:'TOOL_HISTORY'}),toolsReader=toolsResponse.body.getReader();let runIdentity,tool
  while(!tool){const r=await toolsReader.read();for(const line of new TextDecoder().decode(r.value).trim().split('\n')){const e=JSON.parse(line);if(e.type==='started')runIdentity=e;if(e.type==='tool')tool=e}}
  assert.equal(tool.tool,'juliu_read_history');await fetch(b.base+'/tool-result',{method:'POST',headers,body:JSON.stringify({runId:runIdentity.runId,token:runIdentity.token,callId:tool.callId,success:true,contentItems:[{type:'inputText',text:'旧目标背景'}]})})
  let final='';while(true){const r=await toolsReader.read();if(r.done)break;final+=new TextDecoder().decode(r.value)}assert(final.includes('历史已查阅'));pass('恢复后的会话仍可调用完整聊天检索工具并继续回答')
  const all=await files(path.join(temp,'private/conversations'));for(const p of all){const stat=await fs.stat(p);assert.equal(stat.mode&0o777,stat.isDirectory()?0o700:0o600)}
  assert(!all.some(f=>f.endsWith('.tmp')||f.endsWith('.lock')));pass('索引文件0600、项目目录0700、任务完成清理锁且保留工作区')
  const traversal=await run(b,{...input,projectId:'../../somewhere',prompt:'RECALL ONLY'});assert(traversal.some(e=>e.type==='done'));assert((await logs()).filter(m=>m.method==='thread/start').at(-1).params.cwd.startsWith(path.join(temp,'private/conversations')))
  assert.equal((await post(b,{...input,projectId:''})).status,400);assert.equal((await post(b,{...input,conversationId:'x'.repeat(201)})).status,400);pass('客户端标识校验及目录哈希阻止路径穿越')
  const currentThread=(await logs()).filter(m=>m.method==='thread/resume').at(-1).params.threadId
  let mainRecord
  for(const f of all.filter(f=>f.endsWith('.json'))){if(JSON.parse(await fs.readFile(f,'utf8')).threadId===currentThread)mainRecord=f}
  assert(mainRecord);await fs.writeFile(mainRecord,'invalid-json')
  const bad=await run(b,{...input,prompt:'RECALL ONLY'});assert(bad.some(e=>e.type==='error'&&e.message.includes('索引损坏')));pass('损坏索引停止恢复并保留明确错误')
  await fs.writeFile(path.join(out,'server-validation.json'),JSON.stringify({checks,processRestart:true,simulatedCrash:true,realModel:false,userProjectsModified:false},null,2))
  console.log('Passed '+checks.length+' continuity server checks')
} finally {for(const h of hosts)await stop(h).catch(()=>{});await fs.rm(temp,{recursive:true,force:true})}
