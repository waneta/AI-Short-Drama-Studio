import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
const base = process.env.JULIU_TEST_URL || 'http://127.0.0.1:5186'
const out = process.env.JULIU_TEST_OUT || '/tmp/juliu-chat-scroll-browser'
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
  const fixtureScript=`(()=>{const original=window.fetch;window.fakeCalls=[];window.failStatus=false;const model=(id,efforts)=>({id,model:id,name:id,isDefault:id==='gpt-6.1-sol',defaultReasoningEffort:'low',supportedReasoningEfforts:efforts});window.fixtureStatus={available:true,authenticated:true,authType:'chatgpt',defaultModel:'gpt-6.1-sol',configuredEffort:'high',models:[model('gpt-6.1-sol',['low','medium','high','xhigh','max','ultra']),model('gpt-6-luna',['low','medium','high'])]};window.fetch=async(url,init={})=>{const route=String(url);if(route.includes('/__juliu-codex/')){const data=init.body?JSON.parse(init.body):{};fakeCalls.push({route,data});if(route.endsWith('/status')){if(failStatus)return Response.json({error:'fixture offline'},{status:503});return Response.json(fixtureStatus)}if(route.endsWith('/run')){const enc=new TextEncoder();return new Response(enc.encode(JSON.stringify({type:'started',runId:'fixture',token:'fixture'})+'\\n'+JSON.stringify({type:'done',text:'先梳理当前画布，再确定这个镜头的动作和节奏。保持人物与武器参考一致，先不生成素材。',model:data.model||'gpt-6.1-sol'})+'\\n'),{headers:{'content-type':'application/x-ndjson'}})}return Response.json({accepted:true})}return original(url,init)}})()`
  await send('Page.enable');await send('Runtime.enable');await send('Page.addScriptToEvaluateOnNewDocument',{source:fixtureScript});await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false})
  await send('Page.navigate',{url:base+'/#/'})
  await wait('!!document.querySelector("#app")?.__vue_app__?.config.globalProperties.$pinia')
  const bind=`(async()=>{const pinia=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;const stores=await import('/src/stores/index.ts');window.p=stores.useProjectStore(pinia);window.s=stores.useSettingsStore(pinia);window.assistant=await import('/src/services/assistant/codexEngine.ts');window.textClient=await import('/src/services/ai/client.ts');window.taskState=await import('/src/services/assistant/state.ts')})()`
  await evaluate(bind)
  await evaluate(`(async()=>{localStorage.setItem('aicut:guide:canvas','done');p.create('长会话滚动隔离验收');await p.save();localStorage.setItem('effort-test-project',p.current.id);s.update({assistantEngine:'codex',codexModel:'gpt-6.1-sol'});await s.flush();await document.querySelector('#app').__vue_app__.config.globalProperties.$router.push('/studio')})()`)
  await wait('!!document.querySelector(".agent-orb")');await evaluate(`document.querySelector('.agent-orb').click()`);await wait('!!document.querySelector(".codex-run-select")');await wait('document.querySelector(".run-summary").innerText.includes("高")')


  await evaluate(`(async()=>{window.ts=await import('/src/services/canvas/taskStore.ts');window.canvasEvents=await import('/src/services/canvas/canvasBridge.ts');const now=Date.now();const messages=Array.from({length:100},(_,n)=>({id:'long-'+n,role:n%2?'assistant':'user',content:'第'+n+'条记录：人物外观和武器比例保持一致。\\n这是较长的镜头背景，保留每次讨论的要求。\\n先核对画布，再规划下一步创作。',createdAt:now-100000+n*1000}));p.setAgentState({...ts.getAgentState(),activeConversationId:'long-chat',messages,conversations:[{id:'long-chat',title:'长会话',customTitle:'长会话',messages,createdAt:now-100000,updatedAt:now},{id:'other-chat',title:'另一个会话',messages:[{id:'other',role:'user',content:'另一条聊天',createdAt:now-200000}],createdAt:now-200000,updatedAt:now-200000}]});await p.save();localStorage.setItem('scroll-test-project',p.current.id);window.scrollCalls=[];const native=Element.prototype.scrollTo;Element.prototype.scrollTo=function(...args){if(this.classList.contains('msgs'))scrollCalls.push(args[0]);return native.apply(this,args)}})()`)
  const capture=async action=>{await evaluate(`window.frames=[];window.captureUntil=performance.now()+700;window.captureFrame=()=>{const e=document.querySelector('.msgs');if(e&&e.clientHeight&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none')frames.push({top:e.scrollTop,max:e.scrollHeight-e.clientHeight});if(performance.now()<captureUntil)requestAnimationFrame(captureFrame)};requestAnimationFrame(captureFrame)`);await evaluate(action);await wait('performance.now()>captureUntil&&frames.length>4')}
  const bottom=`(()=>{const e=document.querySelector('.msgs');return e.scrollHeight-e.clientHeight-e.scrollTop<=2})()`
  await capture(`document.querySelector('[data-conversation-id="long-chat"] .history-open').click()`)
  await test('长会话首个可见帧已在底部，无顶部闪现与扫屏',`frames[0].max>5000&&frames.every(f=>f.max-f.top<=2)`)
  await test('历史恢复不请求平滑滚动且消息无入场动画',`scrollCalls.length>0&&scrollCalls.every(c=>c.behavior==='instant')&&getComputedStyle(document.querySelector('.msg')).animationName==='none'&&getComputedStyle(document.querySelector('.msgs')).visibility==='visible'`)
  await evaluate(`window.readTop=900;document.querySelector('.msgs').scrollTop=readTop`)
  await wait('!!document.querySelector("[aria-label=\\"回到最新消息\\"]")')
  await test('上翻显示回到最新入口',`Math.abs(document.querySelector('.msgs').scrollTop-readTop)<2`)
  await evaluate(`window.canvasEvents.emitCanvasActivity({kind:'done',source:'canvas',nodeId:'synthetic-node',label:'测试图片',message:'测试更新完成'})`)
  await wait('p.current.agentState.messages.length===101')
  await test('阅读旧记录时画布新消息不强制拉到底部',`Math.abs(document.querySelector('.msgs').scrollTop-readTop)<2&&!!document.querySelector('[aria-label="回到最新消息"]')`)
  await evaluate(`document.querySelector('[aria-label="返回会话列表"]').click()`);await wait('!!document.querySelector(".codex-history")')
  await capture(`document.querySelector('[data-conversation-id="long-chat"] .history-open').click()`)
  await test('再次进入会话从首帧恢复原阅读位置',`frames.every(f=>Math.abs(f.top-readTop)<2)`)
  await evaluate(`document.querySelector('[aria-label="收起 AI 助手"]').click()`)
  await wait('!document.querySelector(".agent.director").getBoundingClientRect().width')
  await capture(`document.querySelector('.agent-orb').click()`)
  await test('收起再打开保留阅读位置且无动画',`frames.every(f=>Math.abs(f.top-readTop)<2)`)
  await evaluate(`document.querySelector('[aria-label="回到最新消息"]').click()`)
  await wait(bottom)
  await test('回到最新立即定位到底部并隐藏入口',`!document.querySelector('[aria-label="回到最新消息"]')&&scrollCalls.at(-1).behavior==='instant'`)
  await evaluate(`canvasEvents.emitCanvasActivity({kind:'done',source:'canvas',nodeId:'synthetic-node-2',label:'测试视频',message:'测试更新完成'})`)
  await wait('p.current.agentState.messages.length===102');await wait(bottom)
  await test('位于底部时继续跟随新消息',bottom)
  await evaluate(`document.querySelector('.msgs').scrollTop=1200`);await wait('!!document.querySelector("[aria-label=\\"回到最新消息\\"]")')
  await evaluate(`(()=>{const i=document.querySelector('textarea');i.value='这是新的跟进，先不生成';i.dispatchEvent(new Event('input',{bubbles:true}))})()`);await wait(`!!document.querySelector('[aria-label="发送消息"]')&&!document.querySelector('[aria-label="发送消息"]').disabled`);await evaluate(`document.querySelector('[aria-label="发送消息"]').click()`)
  await wait('!document.querySelector(".stop")&&p.current.agentState.messages.length===104');await wait(bottom)
  await test('主动发送会定位本轮最新消息且沿用原会话',`fakeCalls.filter(c=>c.route.endsWith('/run')).at(-1).data.conversationId==='long-chat'&&!document.querySelector('[aria-label="回到最新消息"]')`)
  await fs.writeFile(path.join(out,'long-chat-latest.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'))
  await evaluate(`document.querySelector('[aria-label="返回会话列表"]').click()`);await wait('!!document.querySelector(".codex-history")');await evaluate(`document.querySelector('[data-conversation-id="other-chat"] .history-open').click()`);await wait('p.current.agentState.activeConversationId==="other-chat"&&!document.querySelector(".msgs").classList.contains("positioning")')
  await test('短会话正常显示且不出现多余滚动入口',`document.querySelector('.msgs').scrollHeight===document.querySelector('.msgs').clientHeight&&!document.querySelector('[aria-label="回到最新消息"]')`)
  await evaluate(`document.querySelector('[aria-label="返回会话列表"]').click()`);await wait('!!document.querySelector(".codex-history")');await evaluate(`document.querySelector('[data-conversation-id="long-chat"] .history-open').click()`);await wait(bottom)
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false})
  await evaluate(`document.querySelector('.msgs').scrollTop=600`);await wait('!!document.querySelector("[aria-label=\\"回到最新消息\\"]")')
  await test('窄屏回到最新按钮位于消息区且不挡输入',`(()=>{const b=document.querySelector('[aria-label="回到最新消息"]').getBoundingClientRect(),c=document.querySelector('.composer').getBoundingClientRect();return b.width>0&&b.left>=0&&b.right<=innerWidth&&b.bottom<c.top})()`)
  await fs.writeFile(path.join(out,'long-chat-reading-narrow.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'))
  await evaluate(`(async()=>{await p.save()})()`)
  const previous=await evaluate('performance.timeOrigin');await send('Page.reload');await wait(`performance.timeOrigin>${previous}&&!!document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia`);await evaluate(bind)
  await evaluate(`(async()=>{await p.load(localStorage.getItem('scroll-test-project'));await document.querySelector('#app').__vue_app__.config.globalProperties.$router.push('/studio')})()`);await wait('!!document.querySelector(".agent-orb")')
  await capture(`document.querySelector('.agent-orb').click()`)
  await test('刷新后首次重新打开仍直接显示最新消息',`frames[0].max>5000&&frames.every(f=>f.max-f.top<=2)`)
  await evaluate(`s.update({assistantEngine:'api'})`);await wait('!!document.querySelector(".conversation-toggle")&&!document.querySelector(".msgs").classList.contains("positioning")')
  await test('切回API后消息可见且沿用无动画定位',`getComputedStyle(document.querySelector('.msgs')).visibility==='visible'&&getComputedStyle(document.querySelector('.msgs')).scrollBehavior==='auto'`)
  assert.equal(errors.length,0,JSON.stringify(errors));await fs.writeFile(path.join(out,'browser-validation.json'),JSON.stringify({checks,isolatedBrowser:true,realModel:false,userProjectsModified:false},null,2));console.log('Passed '+checks.length+' chat scroll checks')
} finally { socket?.close();chrome.kill('SIGTERM');await new Promise(r=>setTimeout(r,300));await fs.rm(profile,{recursive:true,force:true}).catch(()=>{}) }
