import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
const base = process.env.JULIU_TEST_URL || 'http://127.0.0.1:5182'
const out = process.env.JULIU_TEST_OUT || '/tmp/juliu-codex-effort-browser'
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
  const fixtureScript=`(()=>{const original=window.fetch;window.fakeCalls=[];window.failStatus=false;const model=(id,efforts)=>({id,model:id,name:id,isDefault:id==='gpt-6.1-sol',defaultReasoningEffort:'low',supportedReasoningEfforts:efforts});window.fixtureStatus={available:true,authenticated:true,authType:'chatgpt',defaultModel:'gpt-6.1-sol',configuredEffort:'high',models:[model('gpt-6.1-sol',['low','medium','high','xhigh','max','ultra']),model('gpt-6-luna',['low','medium','high'])]};window.fetch=async(url,init={})=>{const route=String(url);if(route.includes('/__juliu-codex/')){const data=init.body?JSON.parse(init.body):{};fakeCalls.push({route,data});if(route.endsWith('/status')){if(failStatus)return Response.json({error:'fixture offline'},{status:503});return Response.json(fixtureStatus)}if(route.endsWith('/run')){const enc=new TextEncoder();return new Response(enc.encode(JSON.stringify({type:'started',runId:'fixture',token:'fixture'})+'\\n'+JSON.stringify({type:'done',text:'合成回答',model:data.model||'gpt-6.1-sol'})+'\\n'),{headers:{'content-type':'application/x-ndjson'}})}return Response.json({accepted:true})}return original(url,init)}})()`
  await send('Page.enable');await send('Runtime.enable');await send('Page.addScriptToEvaluateOnNewDocument',{source:fixtureScript});await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false})
  await send('Page.navigate',{url:base+'/#/'})
  await wait('!!document.querySelector("#app")?.__vue_app__?.config.globalProperties.$pinia')
  const bind=`(async()=>{const pinia=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;const stores=await import('/src/stores/index.ts');window.p=stores.useProjectStore(pinia);window.s=stores.useSettingsStore(pinia);window.assistant=await import('/src/services/assistant/codexEngine.ts');window.textClient=await import('/src/services/ai/client.ts');window.taskState=await import('/src/services/assistant/state.ts')})()`
  await evaluate(bind)
  await evaluate(`(async()=>{localStorage.setItem('aicut:guide:canvas','done');p.create('Codex 模型强度隔离验收');await p.save();localStorage.setItem('effort-test-project',p.current.id);s.update({assistantEngine:'codex',codexModel:'gpt-6.1-sol'});await s.flush();await document.querySelector('#app').__vue_app__.config.globalProperties.$router.push('/studio')})()`)
  await wait('!!document.querySelector(".agent-orb")');await evaluate(`document.querySelector('.agent-orb').click()`);await wait('!!document.querySelector(".codex-run-select")');await wait('document.querySelector(".run-summary").innerText.includes("高")')
  const open=async()=>{await evaluate(`if(!document.querySelector('.codex-run-select').open)document.querySelector('.run-summary').click()`);await wait('document.querySelector(".codex-run-select").open')}
  const models=async()=>{await open();await evaluate(`document.querySelector('[aria-label="选择 Codex 模型"]').click()`);await wait('!!document.querySelector(".model-list")')}
  const choose=async id=>{await models();await evaluate(`document.querySelector('[data-model="${id}"]').click()`);await wait('!document.querySelector(".codex-run-select").open')}
  const slider=async(index)=>{await open();const r=await evaluate(`(()=>{const r=document.querySelector('input[type="range"]').getBoundingClientRect();return {x:r.left+14+(r.width-28)*${index}/(Number(document.querySelector('input[type="range"]').max)||1),y:r.top+r.height/2}})()`);await send('Input.dispatchMouseEvent',{type:'mousePressed',x:r.x,y:r.y,button:'left',clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:r.x,y:r.y,button:'left',clickCount:1})}
  const key=async(key,code=key)=>{const windowsVirtualKeyCode={Enter:13,Escape:27,End:35,Home:36,ArrowLeft:37,ArrowUp:38,ArrowRight:39,ArrowDown:40}[key];await send('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode});await send('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode})}
  const screenshot=async name=>{const shot=await send('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(out,name),Buffer.from(shot.data,'base64'))}
  await test('输入区直接显示当前模型与继承的高强度',`document.querySelector('.run-summary').innerText.includes('6.1 Sol')&&s.config.codexEffort===''`)
  await open()
  await test('紧凑强度浮层展示六个实际档位与默认强度',`document.querySelector('input[type="range"]').max==='5'&&document.querySelector('.effort-current').textContent==='高'&&document.querySelector('[aria-label="恢复默认强度"]').disabled`)
  await slider(5)
  await test('点击滑杆选择Ultra立即保存并显示当前强度',`s.config.codexEffort==='ultra'&&document.querySelector('input[type="range"]').getAttribute('aria-valuetext')==='Ultra'&&document.querySelector('.run-summary').innerText.includes('Ultra')`)
  await test('画布助手实际请求带上模型和effort',`(async()=>{await assistant.runAssistantTurn([],'只回答不要生成',()=>{},{});const call=fakeCalls.filter(c=>c.route.endsWith('/run')).at(-1);return call.data.kind==='agent'&&call.data.model==='gpt-6.1-sol'&&call.data.effort==='ultra'})()`)
  await test('写剧本优化等文本路径共享所选强度',`(async()=>{await textClient.callLLM({messages:[{role:'user',content:'合成文本'}]});const call=fakeCalls.filter(c=>c.route.endsWith('/run')).at(-1);return call.data.kind==='text'&&call.data.effort==='ultra'})()`)
  await models()
  await test('模型独立列表包含默认项及当前选中标记',`document.querySelectorAll('[role="menuitemradio"]').length===3&&document.querySelector('[data-model="gpt-6.1-sol"]').getAttribute('aria-checked')==='true'&&!!document.querySelector('[data-model="gpt-6.1-sol"] .check')`)
  await key('End');await test('模型列表支持键盘导航',`document.activeElement.dataset.model==='gpt-6-luna'`)
  await key('Enter');await wait('s.config.codexModel==="gpt-6-luna"&&s.config.codexEffort===""')
  await test('选择模型关闭列表并移除不支持的Ultra',`!document.querySelector('.codex-run-select').open`)
  await open()
  await test('重新打开回到强度面板并按模型能力显示三档',`document.querySelector('input[type="range"]').max==='2'&&!document.querySelector('.model-list')`)
  await slider(0)
  await evaluate(`document.querySelector('input[type="range"]').focus()`);await key('ArrowRight')
  await test('键盘右键切换并保存中强度',`s.config.codexEffort==='medium'`)
  const range=await evaluate(`(()=>{const r=document.querySelector('input[type="range"]').getBoundingClientRect();return {x:r.left+14+(r.width-28)/2,end:r.right-14,y:r.top+r.height/2}})()`)
  await send('Input.dispatchMouseEvent',{type:'mousePressed',x:range.x,y:range.y,button:'left',clickCount:1})
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:range.end,y:range.y,button:'left',buttons:1})
  await test('拖动预览强度并在松手前保留已保存设置',`document.querySelector('.effort-current').textContent==='高'&&s.config.codexEffort==='medium'`)
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:range.end,y:range.y,button:'left',clickCount:1})
  await test('松手保存高强度',`(async()=>{await s.flush();await p.save();return s.config.codexEffort==='high'})()`)
  const oldOrigin=await evaluate('performance.timeOrigin');await send('Page.reload');await wait(`performance.timeOrigin>${oldOrigin}&&!!document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia`);await evaluate(bind)
  await test('刷新后模型与强度仍保留',`s.config.codexModel==='gpt-6-luna'&&s.config.codexEffort==='high'`)
  await evaluate(`(async()=>{await p.load(localStorage.getItem('effort-test-project'));await document.querySelector('#app').__vue_app__.config.globalProperties.$router.push('/studio')})()`)
  await wait('!!document.querySelector(".agent-orb")');await evaluate(`if(!document.querySelector('.agent.director')?.getBoundingClientRect().width)document.querySelector('.agent-orb').click()`);await wait('!!document.querySelector(".codex-run-select")')
  await open();await evaluate(`taskState.assistantActiveTasks.value++`)
  await test('任务运行时关闭面板并锁住模型强度',`(async()=>{await new Promise(r=>setTimeout(r,40));return !document.querySelector('.codex-run-select').open&&document.querySelector('.run-summary').getAttribute('aria-disabled')==='true'&&document.querySelector('[aria-label="选择 Codex 模型"]').disabled&&document.querySelector('input[type="range"]').disabled})()`)
  await evaluate(`taskState.assistantActiveTasks.value--`);await open()
  await evaluate(`document.querySelector('[aria-label="恢复默认强度"]').click()`)
  await test('重置清除覆盖并恢复继承高强度',`s.config.codexEffort===''&&document.querySelector('.run-summary').innerText.includes('高')`)
  await evaluate(`document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))`)
  await test('点击外部关闭浮层',`!document.querySelector('.codex-run-select').open`)
  await open();await key('Escape')
  await test('Esc关闭并恢复焦点',`!document.querySelector('.codex-run-select').open&&document.activeElement.matches('.run-summary')`)
  await choose('gpt-6.1-sol');await slider(2)
  await test('浮层位于可见窗口且不覆盖发送按钮',`(()=>{const r=document.querySelector('.run-panel').getBoundingClientRect(),b=document.querySelector('[aria-label="发送消息"]').getBoundingClientRect();return r.width>=250&&r.height<=125&&b.width>0&&r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=b.top+3})()`)
  await screenshot('codex-effort-slider.png')
  await models();await screenshot('codex-model-list.png')
  await evaluate(`document.querySelector('[data-model=""]').click()`)
  await test('默认模型可选并清除模型覆盖',`s.config.codexModel===''&&!document.querySelector('.codex-run-select').open`)
  await models()
  await test('默认模型选中标记正确',`document.querySelector('[data-model=""]').getAttribute('aria-checked')==='true'&&!!document.querySelector('[data-model=""] .check')`)
  await evaluate(`failStatus=true;document.querySelector('[aria-label="刷新 Codex 模型列表"]').click()`)
  await wait('!!document.querySelector(".picker-error")')
  await test('刷新失败保留列表并显示重试',`!!document.querySelector('.picker-error button')&&document.querySelectorAll('[role="menuitemradio"]').length===3`)
  await wait(`!!document.querySelector('.picker-error button')&&!document.querySelector('.picker-error button').disabled`);await evaluate(`failStatus=false;document.querySelector('.picker-error button').click()`);await wait('!document.querySelector(".picker-error")')
  await evaluate(`document.querySelector('[data-model="gpt-6.1-sol"]').click()`);await open()
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false})
  await test('窄屏浮层与输入区控件均在可视范围内',`(async()=>{await new Promise(r=>setTimeout(r,80));const panel=document.querySelector('.run-panel').getBoundingClientRect(),summary=document.querySelector('.run-summary').getBoundingClientRect();return panel.width>=250&&panel.left>=0&&panel.right<=innerWidth&&summary.right<=innerWidth})()`)
  await screenshot('codex-effort-slider-narrow.png');await models();await screenshot('codex-model-list-narrow.png')
  await evaluate(`document.querySelector('.run-summary').click();s.update({assistantEngine:'api'})`);await wait('!document.querySelector(".codex-run-select")')
  await test('原API助手不显示Codex控制并保留原设置',`s.config.assistantEngine==='api'&&s.config.codexModel==='gpt-6.1-sol'`)
  assert.equal(errors.length,0,JSON.stringify(errors));await fs.writeFile(path.join(out,'browser-validation.json'),JSON.stringify({checks,isolatedBrowser:true,realModel:false,userProjectsModified:false},null,2));console.log('Passed '+checks.length+' effort browser checks')
} finally { socket?.close();chrome.kill('SIGTERM');await new Promise(r=>setTimeout(r,300));await fs.rm(profile,{recursive:true,force:true}).catch(()=>{}) }
