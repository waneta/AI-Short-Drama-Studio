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
  await evaluate(`(async()=>{window.assistant=await import('/src/services/assistant/codexEngine.ts');window.coach=await import('/src/services/ai/promptCoach.ts');s.update({assistantEngine:'codex',codexModel:'',llm:{...s.config.llm,apiKey:''}});p.addCanvasNode({id:'fixture-source',type:'imageGen',position:{x:0,y:0},data:{label:'隔离参考图来源',prompt:'测试人物'},status:'idle'});await p.save();window.realEvents=[];window.realResult=null;window.realError=null;window.realTask=assistant.runAssistantTurn([{role:'user',content:'请先查询画布，然后给 fixture-source 新增并连接一个5秒视频节点，提示词是“人物缓慢转头”，名字改成“Codex实跑镜头”。只建节点和连线，不生成图片或视频，不写剧本。'}],'请先查询画布，然后给 fixture-source 新增并连接一个5秒视频节点，提示词是“人物缓慢转头”，名字改成“Codex实跑镜头”。只建节点和连线，不生成图片或视频，不写剧本。',e=>realEvents.push(e),{}).then(r=>realResult=r).catch(e=>realError=e.message)})()`)
  for(let i=0;i<240;i++){
    const value=await evaluate('({done:!!realResult,error:realError,events:realEvents.slice(-2)})')
    if(value.error)throw new Error(value.error)
    if(value.done)break
    if(i%10===0)console.log(JSON.stringify(value.events))
    await new Promise(r=>setTimeout(r,1000))
  }
  await test('真实 Codex 使用工具创建5秒视频节点', `!!realResult&&p.current.canvas.nodes.some(n=>n.type==='videoGen'&&n.data.duration===5)`)
  await test('真实 Codex 取得实际节点ID并连接上游', `p.current.canvas.edges.some(e=>e.source==='fixture-source'&&p.current.canvas.nodes.some(n=>n.id===e.target&&n.type==='videoGen'))`)
  await test('真实 Codex 重命名节点且保留参考来源', `p.current.canvas.nodes.some(n=>n.type==='videoGen'&&n.data.label==='Codex实跑镜头'&&n.data.referenceSourceNodeIds?.includes('fixture-source'))`)
  await test('未触发真实素材生成', `p.current.canvas.nodes.every(n=>n.status==='idle'&&!n.data.outputAssetId)`)
  await evaluate(`window.optimized=null;window.optimizeError=null;coach.optimizeNodePrompt({kind:'video',currentPrompt:'画面：人物站在纯白背景中，缓慢向左转头。\\n声音：无对白，无音乐。',userHint:'保留画面和声音标题，明确单一镜头、自然转头与稳定构图，不添加对白、场景或其他动作。',duration:5}).then(r=>optimized=r).catch(e=>optimizeError=e.message)`)
  for(let i=0;i<180;i++){const state=await evaluate('({done:!!optimized,error:optimizeError})');if(state.error)throw new Error(state.error);if(state.done)break;await new Promise(r=>setTimeout(r,1000))}
  await test('真实提示词优化通过 Codex 完成且原 LLM Key 为空', `!!optimized?.prompt&&optimized.prompt.includes('画面')&&s.config.llm.apiKey===''`)
  await evaluate(`document.querySelector('.agent-orb')?.click()`)
  await wait('!!document.querySelector(".assistant-engine")')
  const image=await send('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(out,'real-codex-canvas.png'),Buffer.from(image.data,'base64'))
  const evidence=await evaluate('({nodes:p.current.canvas.nodes,edges:p.current.canvas.edges,events:realEvents,reply:realResult.reply,optimized})')
  await fs.writeFile(path.join(out,'real-codex-validation.json'),JSON.stringify({checks,realModel:true,realMediaGeneration:false,evidence,consoleExceptions:errors},null,2))
  console.log(`Passed ${checks.length} real Codex checks`)

} finally { socket?.close();chrome.kill('SIGTERM');await new Promise(r=>setTimeout(r,300));await fs.rm(profile,{recursive:true,force:true}).catch(()=>{}) }
