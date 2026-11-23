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
  await evaluate(`(async()=>{window.assistant=await import('/src/services/assistant/codexEngine.ts');window.textClient=await import('/src/services/ai/client.ts');window.tools=await import('/src/services/canvas/toolRegistry.ts');window.taskState=await import('/src/services/assistant/state.ts');window.originalFetch=window.fetch;window.fakeCalls=[];window.fakeResults=[];window.fakeMode='text';window.fakePending=new Map();window.fakeScript=[];
    const enc=new TextEncoder();window.fetch=async(url,init={})=>{const route=String(url);if(route.includes('/__juliu-codex/')){const data=init.body?JSON.parse(init.body):{};fakeCalls.push({route,data});if(route.endsWith('/status'))return Response.json({available:true,authenticated:true,authType:'chatgpt',models:[{id:'fixture',model:'fixture-model',name:'Fixture',isDefault:true}]});if(route.endsWith('/cancel')){window.fakeCancelled=true;return Response.json({cancelled:true})}if(route.endsWith('/tool-result')){fakeResults.push(data);return Response.json({accepted:true})}if(route.endsWith('/run'))return new Response(new ReadableStream({start(c){c.enqueue(enc.encode(JSON.stringify({type:'started',runId:crypto.randomUUID(),token:'fixture-token'})+'\\n'));if(fakeMode==='hold'){init.signal?.addEventListener('abort',()=>c.error(new DOMException('任务已取消','AbortError')),{once:true});return}for(const ev of fakeScript)c.enqueue(enc.encode(JSON.stringify(ev)+'\\n'));c.enqueue(enc.encode(JSON.stringify({type:'done',text:data.kind==='text'?'{"ok":true,"engine":"codex"}':'工具已完成',model:'fixture-model'})+'\\n'));c.close()}}),{headers:{'content-type':'application/x-ndjson'}})}if(route.includes('fixture-api')){fakeCalls.push({route,data:JSON.parse(init.body)});return Response.json({model:'original-api-model',choices:[{message:{content:'原始API回答'}}]})}return originalFetch(url,init)};
  })()`)
  await test('旧项目默认保留 API 引擎', `s.config.assistantEngine==='api'`)
  await test('工具字段校验保留连线来源、目标和节点名', `(()=>{const a=tools.validateToolAction({tool:'connect_nodes',sourceNodeId:'a',targetNodeId:'b',nodeLabel:'名称'});return a.sourceNodeId==='a'&&a.targetNodeId==='b'&&a.nodeLabel==='名称'})()`)
  await test('未注册工具被拒绝', `(()=>{try{tools.validateToolAction({tool:'run_shell',text:'x'});return false}catch{return true}})()`)
  await test('Codex 文本路径无需原 LLM Key', `(async()=>{s.update({assistantEngine:'codex',codexModel:'fixture-model',llm:{...s.config.llm,apiKey:''}});const r=await textClient.callLLM({messages:[{role:'user',content:'测试文本'}],jsonMode:true});return JSON.parse(r.content).engine==='codex'&&fakeCalls.at(-1).data.kind==='text'&&fakeCalls.at(-1).data.model==='fixture-model'})()`)
  await test('文本任务不传入原 API Key', `!JSON.stringify(fakeCalls.filter(c=>c.route.endsWith('/run'))).includes('apiKey')`)
  await test('切回 API 后使用原始 HTTP 调用', `(async()=>{s.update({assistantEngine:'api',llm:{baseUrl:'https://fixture-api.invalid/v1',apiKey:'fixture-only',model:'original-api-model'}});const r=await textClient.callLLM({messages:[{role:'user',content:'测试'}]});return r.content==='原始API回答'&&fakeCalls.at(-1).data.model==='original-api-model'})()`)
  await test('Codex 自主调用真实工具创建与修改画布', `(async()=>{s.update({assistantEngine:'codex'});fakeScript=[{type:'tool',callId:'read',tool:'juliu_read_project',arguments:{}},{type:'tool',callId:'create',tool:'juliu_action',arguments:{action:{tool:'create_video_node',text:'人物缓慢转头',duration:5}}}];const before=p.current.canvas.nodes.length;await assistant.runAssistantTurn([{role:'user',content:'创建一个视频节点，先不生成'}],'创建一个视频节点，先不生成',()=>{},{});return p.current.canvas.nodes.length===before+1&&p.current.canvas.nodes.at(-1).data.duration===5&&fakeResults.at(-1).success&&fakeResults.at(-1).contentItems[0].text.includes('createdNodes')})()`)
  await test('模型查询结果中不泄露密钥与工作流', `!fakeResults.find(r=>r.callId==='read').contentItems[0].text.includes('fixture-only')&&!fakeResults.find(r=>r.callId==='read').contentItems[0].text.includes('workflowTemplate')`)
  await test('节点重命名与提示词修改真正落库', `(async()=>{const id=p.current.canvas.nodes.at(-1).id;fakeScript=[{type:'tool',callId:'rename',tool:'juliu_action',arguments:{action:{tool:'update_node',nodeId:id,nodeLabel:'已改名',text:'新提示词'}}}];await assistant.runAssistantTurn([],'修改这个节点',()=>{},{});return p.current.canvas.nodes.find(n=>n.id===id).data.label==='已改名'})()`)
  await test('拒绝绕过用户先不生成的要求', `(async()=>{fakeScript=[{type:'tool',callId:'denied-generation',tool:'juliu_action',arguments:{action:{tool:'run_node',nodeId:p.current.canvas.nodes.at(-1).id}}}];await assistant.runAssistantTurn([],'先不生成，只修改',()=>{},{});return fakeResults.at(-1).success===false&&fakeResults.at(-1).contentItems[0].text.includes('先不生成')})()`)
  await test('陪我做逐步确认，拒绝后不修改', `(async()=>{const before=p.current.canvas.nodes.length;let approvals=0;fakeScript=[{type:'tool',callId:'denied-create',tool:'juliu_action',arguments:{action:{tool:'create_image_node',text:'测试'}}}];await assistant.runAssistantTurn([],'新增图片节点',()=>{},{autonomy:'assist',approve:async()=>{approvals++;return false}});return approvals===1&&p.current.canvas.nodes.length===before&&fakeResults.at(-1).success===false})()`)
  await test('跨项目的迟到工具调用被拒绝', `(async()=>{const before=p.current.id;fakeScript=[{type:'tool',callId:'switch',tool:'juliu_action',arguments:{action:{tool:'create_image_node',text:'旧项目'}}}];let changed=false;try{await assistant.runAssistantTurn([],'新增图片节点',()=>{},{autonomy:'assist',approve:async()=>{p.create('另一个隔离项目');changed=true;return true}});return false}catch{return changed&&p.current.id!==before&&p.current.canvas.nodes.length===0}})()`)
  await test('取消 Codex 文本会发送取消请求并释放切换锁', `(async()=>{fakeMode='hold';const c=new AbortController();setTimeout(()=>c.abort(),150);try{await textClient.callLLM({messages:[{role:'user',content:'等待'}],signal:c.signal});return false}catch(e){return e.name==='AbortError'&&fakeCancelled&&taskState.assistantActiveTasks.value===0}finally{fakeMode='text'}})()`)
  await test('Codex 出错不自动回退 API 或重放操作', `(async()=>{let api=0;fakeScript=[{type:'error',message:'fixture auth error'}];const before=fakeCalls.filter(c=>c.route.includes('fixture-api')).length;try{await assistant.runAssistantTurn([],'测试',()=>{},{});return false}catch{return fakeCalls.filter(c=>c.route.includes('fixture-api')).length===before}})()`)
  await evaluate(`fakeScript=[];s.update({assistantEngine:'codex'});document.querySelector('.agent-orb')?.click()`)
  await wait('!!document.querySelector(".assistant-engine")')
  await evaluate(`document.querySelector('.assistant-engine').open=true`)
  await test('界面可切换原 API 与 Codex', `document.querySelector('[aria-label="文本智能引擎"]').options.length===2`)
  await evaluate(`document.querySelector('.engine-panel button').click()`)
  await wait('document.querySelector(".engine-panel").innerText.includes("已识别 Codex 登录")')
  await test('界面展示登录状态与模型选择', `!!document.querySelector('[aria-label="Codex 模型"] option[value="fixture-model"]')`)
  await test('运行任务时禁止切换引擎', `(async()=>{taskState.assistantActiveTasks.value++;await new Promise(r=>setTimeout(r,30));const locked=document.querySelector('[aria-label="文本智能引擎"]').disabled;taskState.assistantActiveTasks.value--;return locked})()`)
  const image=await send('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(out,'engine-select.png'),Buffer.from(image.data,'base64'))
  assert.equal(errors.length,0,JSON.stringify(errors))
  await fs.writeFile(path.join(out,'browser-validation.json'),JSON.stringify({checks,consoleExceptions:errors,realModel:false,realMediaGeneration:false},null,2))
  console.log(`Passed ${checks.length} browser checks`)
} finally { socket?.close();chrome.kill('SIGTERM');await new Promise(r=>setTimeout(r,300));await fs.rm(profile,{recursive:true,force:true}).catch(()=>{}) }
