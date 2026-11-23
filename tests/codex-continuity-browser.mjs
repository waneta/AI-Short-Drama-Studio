import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
const base = process.env.JULIU_TEST_URL || 'http://127.0.0.1:5181'
const out = process.env.JULIU_TEST_OUT || '/tmp/juliu-codex-continuity-browser'
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
  await evaluate(`(async()=>{localStorage.setItem('aicut:guide:canvas','done');const stores=await import('/src/stores/index.ts');window.p=stores.useProjectStore();window.s=stores.useSettingsStore();p.create('Codex 项目历史隔离验收');await p.save();await document.querySelector('#app').__vue_app__.config.globalProperties.$router.push('/studio')})()`)
  await wait('!!document.querySelector(".vue-flow")')
  await evaluate(`(async()=>{window.assistant=await import('/src/services/assistant/codexEngine.ts');window.textClient=await import('/src/services/ai/client.ts');window.tools=await import('/src/services/canvas/toolRegistry.ts');window.taskState=await import('/src/services/assistant/state.ts');window.originalFetch=window.fetch;window.fakeCalls=[];window.fakeResults=[];window.fakeMode='text';window.fakePending=new Map();window.fakeScript=[];
    const enc=new TextEncoder();window.fetch=async(url,init={})=>{const route=String(url);if(route.includes('/__juliu-codex/')){const data=init.body?JSON.parse(init.body):{};fakeCalls.push({route,data});if(route.endsWith('/status'))return Response.json({available:true,authenticated:true,authType:'chatgpt',models:[{id:'fixture',model:'fixture-model',name:'Fixture',isDefault:true}]});if(route.endsWith('/cancel')){window.fakeCancelled=true;return Response.json({cancelled:true})}if(route.endsWith('/tool-result')){fakeResults.push(data);return Response.json({accepted:true})}if(route.endsWith('/run'))return new Response(new ReadableStream({start(c){c.enqueue(enc.encode(JSON.stringify({type:'started',runId:crypto.randomUUID(),token:'fixture-token'})+'\\n'));if(fakeMode==='hold'){init.signal?.addEventListener('abort',()=>c.error(new DOMException('任务已取消','AbortError')),{once:true});return}for(const ev of fakeScript)c.enqueue(enc.encode(JSON.stringify(ev)+'\\n'));c.enqueue(enc.encode(JSON.stringify({type:'done',text:data.kind==='text'?'{"ok":true,"engine":"codex"}':'工具已完成',model:'fixture-model'})+'\\n'));c.close()}}),{headers:{'content-type':'application/x-ndjson'}})}if(route.includes('fixture-api')){fakeCalls.push({route,data:JSON.parse(init.body)});return Response.json({model:'original-api-model',choices:[{message:{content:'原始API回答'}}]})}return originalFetch(url,init)};
  })()`)
  await evaluate(`(async()=>{window.ts=await import('/src/services/canvas/taskStore.ts');window.hs=await import('/src/services/assistant/history.ts');s.update({assistantEngine:'codex'});const old=Array.from({length:145},(_,i)=>({id:'msg-'+i,role:i%2?'assistant':'user',content:i===0?'旧目标：人物全程穿红衣，禁止改成蓝衣':'背景消息 '+i,createdAt:i+1}));await ts.replaceAgentMessages(old);window.savedProject=p.current.id})()`)
  await test('超过120条仍保存最早项目目标', `p.current.agentState.messages.length===145&&p.current.agentState.messages[0].content.includes('全程穿红衣')`)
  await evaluate(`(async()=>{await ts.appendAgentMessage('user','新补充：先不生成');await p.save()})()`)
  const oldOrigin=await evaluate('performance.timeOrigin')
  await send('Page.reload',{ignoreCache:true})
  await wait(`performance.timeOrigin > ${oldOrigin} && !!document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia`)
  await evaluate(`(async()=>{const stores=await import('/src/stores/index.ts');const pinia=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;window.p=stores.useProjectStore(pinia);window.s=stores.useSettingsStore(pinia);await s.ensureHydrated();await p.refreshList();const found=p.allProjects.find(x=>x.name==='Codex 项目历史隔离验收');await p.load(found.id);window.ts=await import('/src/services/canvas/taskStore.ts');window.hs=await import('/src/services/assistant/history.ts');window.assistant=await import('/src/services/assistant/codexEngine.ts');window.originalFetch=fetch;window.fakeResults=[];window.fakeCalls=[];window.fakeScript=[];window.fetch=async(url,init={})=>{const route=String(url);if(route.includes('/__juliu-codex/')){const data=init.body?JSON.parse(init.body):{};fakeCalls.push({route,data});if(route.endsWith('/status'))return Response.json({available:true,authenticated:true,authType:'chatgpt',models:[]});if(route.endsWith('/tool-result')){fakeResults.push(data);return Response.json({accepted:true})}if(route.endsWith('/run'))return new Response([{type:'started',runId:crypto.randomUUID(),token:'fixture-token'},...fakeScript,{type:'done',text:'历史目标已找回',model:'fixture'}].map(e=>JSON.stringify(e)+'\\n').join(''))}return originalFetch(url,init)};await document.querySelector('#app').__vue_app__.config.globalProperties.$router.push('/studio')})()`)
  await wait('!!document.querySelector(".vue-flow")')
  await test('刷新浏览器重新打开项目后完整聊天仍在', `p.current.agentState.messages.length===146&&p.current.agentState.messages[0].id==='msg-0'`)
  await test('搜索能找回近期12条之外的最早目标', `(()=>{const r=hs.readProjectHistory(ts.getAgentState(),{query:'旧目标'});return r.messages.length===1&&r.messages[0].index===0&&r.messages[0].content.includes('全程穿红衣')})()`)
  await test('历史分页可逐页读取全部已保存消息', `(()=>{let before,total=0,seen=new Set();do{const r=hs.readProjectHistory(ts.getAgentState(),{before,limit:30});for(const m of r.messages){if(seen.has(m.id))return false;seen.add(m.id)}total+=r.messages.length;before=r.nextBefore}while(before!==null);return total===146})()`)
  await evaluate(`(async()=>{window.firstChat=ts.getAgentState().activeConversationId||'legacy';await ts.startAgentConversation();window.secondChat=ts.getAgentState().activeConversationId;await ts.appendAgentMessage('user','新聊天的目标：武器保持金色')})()`)
  await test('同项目新聊天可按对话ID检索之前的背景', `(()=>{const r=hs.readProjectHistory(ts.getAgentState(),{conversationId:firstChat,query:'旧目标'});return r.messages[0].content.includes('全程穿红衣')&&r.conversations.length===2})()`)
  await test('找不到的对话ID不能读到其他项目记录', `(()=>{try{hs.readProjectHistory(ts.getAgentState(),{conversationId:'other-project-chat'});return false}catch{return true}})()`)
  await evaluate(`(async()=>{await ts.appendAgentMessage('user','长文本背景'+ '甲'.repeat(50000)+'完整结尾');window.longMessage=ts.getAgentState().messages.at(-1)})()`)
  await test('长消息预览明确截断且可分段还原完整正文', `(()=>{const state=ts.getAgentState(),preview=hs.readProjectHistory(state,{limit:1});if(!preview.messages[0].truncated)return false;let offset=0,content='';do{const r=hs.readProjectHistory(state,{messageId:longMessage.id,offset});content+=r.content;offset=r.nextOffset}while(offset!==null);return content===longMessage.content})()`)
  await test('Codex确实能通过动态工具读取旧目标和项目对话索引', `(async()=>{fakeScript=[{type:'tool',callId:'read-history',tool:'juliu_read_history',arguments:{conversationId:firstChat,query:'旧目标'}},{type:'tool',callId:'read-project',tool:'juliu_read_project',arguments:{}}];await assistant.runAssistantTurn([],'之前对人物服装有什么要求？',()=>{},{});const a=JSON.parse(fakeResults.find(r=>r.callId==='read-history').contentItems[0].text),b=JSON.parse(fakeResults.find(r=>r.callId==='read-project').contentItems[0].text);return a.messages[0].content.includes('全程穿红衣')&&b.conversations.length===2&&fakeCalls.find(c=>c.route.endsWith('/run')).data.prompt.includes('juliu_read_history')})()`)
  await test('历史查询不会修改画布或触发媒体生成', `p.current.canvas.nodes.length===0&&fakeResults.every(r=>r.success)`)
  await evaluate(`document.querySelector('.agent-orb')?.click()`)
  await wait('!!document.querySelector(".context-note")')
  await test('当前项目聊天界面提示持续保存', `document.querySelector('.context-note').innerText.includes('持续保存')`)
  const screenshot=await send('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(out,'project-continuity.png'),Buffer.from(screenshot.data,'base64'))
  await evaluate(`(async()=>{await ts.switchAgentConversation(firstChat);await p.save();await p.refreshList();window.originalProjectId=p.current.id;await p.create('另一个历史隔离项目');await p.save()})()`)
  await test('切换项目后检索工具仅看到新项目历史', `(()=>{try{hs.readProjectHistory(ts.getAgentState(),{conversationId:secondChat});return false}catch{return true}})()`)
  assert.equal(errors.length,0,JSON.stringify(errors))
  await fs.writeFile(path.join(out,'browser-validation.json'),JSON.stringify({checks,consoleExceptions:errors,isolatedBrowser:true,realModel:false,userProjectsModified:false},null,2))
  console.log('Passed '+checks.length+' continuity browser checks')
} finally { socket?.close();chrome.kill('SIGTERM');await new Promise(r=>setTimeout(r,300));await fs.rm(profile,{recursive:true,force:true}).catch(()=>{}) }
