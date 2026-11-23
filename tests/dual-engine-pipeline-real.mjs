import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
const base = process.env.JULIU_TEST_URL || 'http://127.0.0.1:5176'
const out = process.env.JULIU_TEST_OUT || '/tmp/juliu-dual-engine-tests'
await fs.mkdir(out, { recursive: true })
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'juliu-codex-browser-'))
const chrome = spawn('/usr/bin/google-chrome', ['--headless=new','--no-sandbox','--disable-gpu','--disable-extensions','--no-first-run','--disable-background-networking','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'], { stdio: ['ignore','ignore','pipe'] })
let socket
const checks = [], errors = []
try {
  const port = await new Promise((resolve, reject) => { let log=''; const timer=setTimeout(()=>reject(new Error('Chrome startup timeout')),15000); chrome.on('error',reject); chrome.stderr.on('data',v=>{log+=v;const m=/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/.exec(log);if(m){clearTimeout(timer);resolve(m[1])}}) })
  const tabs=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  socket=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl)
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject})
  let seq=0; const pending=new Map()
  socket.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result)}}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails)}
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq,t=setTimeout(()=>reject(new Error('CDP timeout '+method)),30000);pending.set(id,{resolve:v=>{clearTimeout(t);resolve(v)},reject:e=>{clearTimeout(t);reject(e)}});socket.send(JSON.stringify({id,method,params}))})
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value}
  const wait=async expression=>{for(let i=0;i<150;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,200))}throw new Error('UI timeout '+expression)}
  const test=async(name,expression)=>{const value=await evaluate(expression);assert.equal(value,true,name+': '+JSON.stringify(value));checks.push({name,passed:true});console.log(name)}
  await send('Page.enable');await send('Runtime.enable');await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false})
  await send('Page.navigate',{url:base+'/#/'})
  await wait('!!document.querySelector("#app")?.__vue_app__')
  await evaluate(`(async()=>{localStorage.setItem('aicut:guide:canvas','done');const stores=await import('/src/stores/index.ts');window.p=stores.useProjectStore();window.s=stores.useSettingsStore();p.create('Codex 双引擎隔离验收');await p.save();await document.querySelector('#app').__vue_app__.config.globalProperties.$router.push('/studio')})()`)
  await wait('!!document.querySelector(".vue-flow")')
  await evaluate(`(async()=>{const tools=await import('/src/services/canvas/toolRegistry.ts');s.update({assistantEngine:'codex',codexModel:'',llm:{...s.config.llm,apiKey:''}});p.create('Codex文本流水线隔离验收');await p.save();window.pipelineEvents=[];window.pipelineDone=false;window.pipelineError=null;window.pipelineTask=(async()=>{const ctx={onLog:m=>pipelineEvents.push(m)};await tools.executeRegisteredTool({tool:'seed_script',text:'请写一个约20秒的中文真人短片。只有母亲和成年女儿两个人，一个家门口场景。女儿带着修好的旧雨伞回家，母亲以为她来拿走旧物，女儿说“我回来，是想陪你吃顿饭。”用一个小误会和一句回应完成和解。有出镜对白，动作简单，适合AI制作。'},ctx);await tools.executeRegisteredTool({tool:'generate_play'},ctx);window.scriptEvidence={ready:p.current.script.playReady,length:p.current.script.content.length};for(const extractStage of ['subjects','scenes','shots']){pipelineEvents.push('开始提炼 '+extractStage);await tools.executeRegisteredTool({tool:'extract_cast',extractStage},ctx)}pipelineDone=true})().catch(e=>pipelineError=e.message)})()`)
  for(let i=0;i<600;i++){
    const state=await evaluate('({done:pipelineDone,error:pipelineError,events:pipelineEvents.slice(-2)})')
    if(state.error)throw new Error(state.error)
    if(state.done)break
    if(i%20===0)console.log(JSON.stringify(state.events))
    await new Promise(r=>setTimeout(r,1000))
  }
  await test('真实 Codex 写剧本通过原有解析与校验', 'pipelineDone&&scriptEvidence.ready&&scriptEvidence.length>100')
  await test('真实 Codex 提炼人物、场景、分镜并写入项目', 'pipelineDone&&p.current.subjects.length>0&&p.current.scenes.length>0&&p.current.shots.length>0')
  await test('文本流水线原 LLM Key 为空且没有生成素材', `s.config.llm.apiKey===''&&p.current.canvas.nodes.every(n=>!n.data.outputAssetId)`)
  const evidence=await evaluate('({scriptEvidence,script:p.current.script,subjects:p.current.subjects,scenes:p.current.scenes,shots:p.current.shots,events:pipelineEvents})')
  await fs.writeFile(path.join(out,'real-pipeline-validation.json'),JSON.stringify({checks,realModel:true,realMediaGeneration:false,evidence,consoleExceptions:errors},null,2))
  console.log(`Passed ${checks.length} real pipeline checks`)

} finally { socket?.close();chrome.kill('SIGTERM');await new Promise(r=>setTimeout(r,300));await fs.rm(profile,{recursive:true,force:true}).catch(()=>{}) }
