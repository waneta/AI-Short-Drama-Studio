import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
const base = process.env.JULIU_TEST_URL || 'http://127.0.0.1:5185'
const out = process.env.JULIU_TEST_OUT || '/tmp/juliu-codex-chat-layout-browser'
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
  await evaluate(`(async()=>{localStorage.setItem('aicut:guide:canvas','done');p.create('悟空短剧 · 会话界面验收');await p.save();localStorage.setItem('effort-test-project',p.current.id);s.update({assistantEngine:'codex',codexModel:'gpt-6.1-sol'});await s.flush();await document.querySelector('#app').__vue_app__.config.globalProperties.$router.push('/studio')})()`)
  await wait('!!document.querySelector(".agent-orb")');await evaluate(`document.querySelector('.agent-orb').click()`);await wait('!!document.querySelector(".codex-run-select")');await wait('document.querySelector(".run-summary").innerText.includes("高")')

  const input=async text=>{await evaluate(`(()=>{const i=document.querySelector('textarea[aria-label="和 AI 导演对话"]');i.value=${JSON.stringify(text)};i.dispatchEvent(new Event('input',{bubbles:true}))})()`)}
  const key=async key=>{const windowsVirtualKeyCode={Enter:13,Escape:27}[key];await send('Input.dispatchKeyEvent',{type:'keyDown',key,code:key,windowsVirtualKeyCode});await send('Input.dispatchKeyEvent',{type:'keyUp',key,code:key,windowsVirtualKeyCode})}
  const shot=async name=>{const r=await send('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(out,name),Buffer.from(r.data,'base64'))}
  const home=async()=>{await evaluate(`if(document.querySelector('[data-codex-view="chat"]'))document.querySelector('[aria-label="返回会话列表"]').click()`);await wait('!!document.querySelector("[data-codex-view=home]")')}
  const all=async()=>{await home();await evaluate(`document.querySelector('.history-view-all')?.click()`)}
  const openChat=async id=>{await all();await wait(`!!document.querySelector('[data-conversation-id="${id}"] .history-open')&&!document.querySelector('[data-conversation-id="${id}"] .history-open').disabled`);await evaluate(`document.querySelector('[data-conversation-id="${id}"] .history-open').click()`);await wait(`!!document.querySelector('[data-codex-view="chat"]')&&!document.querySelector('[aria-label="新对话"]').disabled`)}
  const sendMessage=async text=>{await input(text);await evaluate(`document.querySelector('[aria-label="发送消息"]').click()`);await wait('!!document.querySelector("[data-codex-view=chat]")&&!document.querySelector(".stop")&&p.current.agentState.messages.at(-1)?.role==="assistant"')}
  await test('首次打开Codex显示独立会话首页及底部输入框',`!!document.querySelector('[data-codex-view="home"]')&&!!document.querySelector('.codex-history')&&document.querySelector('textarea').placeholder.includes('描述')&&document.querySelector('.msgs').style.display==='none'`)
  await test('空项目首页不显示虚构历史',`document.querySelectorAll('.history-entry').length===0`)
  await evaluate(`(async()=>{window.ts=await import('/src/services/canvas/taskStore.ts');const now=Date.now();const chats=[1,2,3,4].map(n=>({id:'chat-'+n,title:['','参考图与人物设定','三段动作的镜头规划','金箍棒尺寸与构图','短剧画面风格讨论'][n],createdAt:now-(5-n)*3600000,updatedAt:now-(5-n)*3600000,messages:[{id:'u-'+n,role:'user',content:['','参考图与人物设定','三段动作的镜头规划','金箍棒尺寸与构图','短剧画面风格讨论'][n],createdAt:now-(5-n)*3600000},{id:'a-'+n,role:'assistant',content:'这是已保存的项目背景。人物外观和武器比例保持一致，先确认镜头再生成。',createdAt:now-(5-n)*3600000}]}));p.setAgentState({...ts.getAgentState(),activeConversationId:'chat-4',messages:chats[3].messages,conversations:chats});await p.save();window.savedProject=p.current.id})()`)
  await test('首页直接展示最近三条名称与相对时间',`document.querySelectorAll('.history-entry').length===3&&document.querySelector('.history-entry').dataset.conversationId==='chat-4'&&document.querySelector('.history-open time').textContent.includes('小时')&&document.querySelector('.history-view-all').textContent.includes('4')`)
  await shot('codex-home.png')
  await all();await test('查看全部展开本项目完整会话列表和搜索',`document.querySelectorAll('.history-entry').length===4&&!!document.querySelector('[aria-label="搜索项目会话"]')`)
  await evaluate(`(()=>{const i=document.querySelector('[aria-label="搜索项目会话"]');i.value='人物';i.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  await test('搜索按会话名称筛选',`document.querySelectorAll('.history-entry').length===1&&document.querySelector('.history-open').textContent.includes('人物')`)
  await evaluate(`document.querySelector('[aria-label="收起全部会话"]').click()`)
  await input('新聊天的输入草稿');await openChat('chat-3')
  await test('打开历史会话恢复原ID与消息并显示返回入口',`p.current.agentState.activeConversationId==='chat-3'&&document.querySelector('.codex-nav h2').textContent==='金箍棒尺寸与构图'&&document.querySelectorAll('.msg').length===2&&!!document.querySelector('[aria-label="返回会话列表"]')`)
  await input('旧会话的跟进草稿');await home()
  await test('返回首页不新建会话且恢复新聊天草稿',`ts.agentConversations().length===4&&document.querySelector('textarea').value==='新聊天的输入草稿'`)
  await openChat('chat-3')
  await test('历史会话草稿与首页草稿独立',`document.querySelector('textarea').value==='旧会话的跟进草稿'`)
  await sendMessage('继续讨论这根武器的比例，先不生成')
  await test('在历史会话发送沿用原conversationId和projectId',`fakeCalls.filter(c=>c.route.endsWith('/run')).at(-1).data.conversationId==='chat-3'&&fakeCalls.filter(c=>c.route.endsWith('/run')).at(-1).data.projectId===savedProject&&ts.agentConversations().length===4`)
  await test('详情使用正文回复与可折叠执行过程',`!!document.querySelector('.codex-work')&&!document.querySelector('.codex-work').open&&document.querySelectorAll('.msg.assistant .msg-orb').length===0&&document.querySelector('.msg.user .bubble').getBoundingClientRect().width>0`)
  await shot('codex-conversation.png')
  await evaluate(`document.querySelector('[aria-label="新对话"]').click();document.querySelector('[aria-label="新对话"]').click()`);await wait('!!document.querySelector("[data-codex-view=home]")')
  await test('点击新对话只回到空白输入，不累积空会话',`ts.agentConversations().length===4&&document.querySelector('textarea').value===''&&fakeCalls.filter(c=>c.route.endsWith('/run')).length===1`)
  await input('   ');await evaluate(`document.querySelector('textarea').focus()`);await key('Enter')
  await test('空白发送不创建会话或请求模型',`ts.agentConversations().length===4&&fakeCalls.filter(c=>c.route.endsWith('/run')).length===1`)
  await input('为悟空新增三个视频节点，先不生成');await evaluate(`document.querySelector('[aria-label="发送消息"]').click();document.querySelector('[aria-label="发送消息"]').click()`)
  await wait('!!document.querySelector("[data-codex-view=chat]")&&!document.querySelector(".stop")&&p.current.agentState.messages.at(-1)?.role==="assistant"')
  await evaluate(`window.newChatId=p.current.agentState.activeConversationId`)
  await test('首页首次发送只创建一次新会话且自动命名',`ts.agentConversations().length===5&&newChatId!=='chat-3'&&fakeCalls.filter(c=>c.route.endsWith('/run')).length===2&&fakeCalls.filter(c=>c.route.endsWith('/run')).at(-1).data.conversationId===newChatId&&p.current.agentState.messages[0].content.includes('悟空')&&document.querySelector('.codex-nav h2').textContent.includes('悟空')`)
  await evaluate(`document.querySelector('[aria-label="会话操作"]').click();document.querySelector('.codex-more-menu button').click()`);await wait('!!document.querySelector(".conversation-rename-form input")')
  await test('详情菜单可进入当前会话改名且ID保持',`!!document.querySelector('[data-codex-view="home"]')&&p.current.agentState.activeConversationId===newChatId`)
  await evaluate(`(()=>{const i=document.querySelector('[aria-label="对话名称"]');i.value='';i.dispatchEvent(new Event('input',{bubbles:true}));i.focus()})()`);await key('Enter')
  await test('改名空白校验',`document.querySelector('.rename-error').textContent==='请输入对话名称'`)
  await evaluate(`(()=>{const i=document.querySelector('[aria-label="对话名称"]');i.value='悟空 · 三段动作讨论';i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true,cancelable:true}))})()`)
  await test('中文输入法Enter不提前提交',`!!document.querySelector('.conversation-rename-form')&&!ts.agentConversations().find(c=>c.id===newChatId).customTitle`)
  await key('Escape')
  await test('改名Esc取消不关闭助手和首页',`!document.querySelector('.conversation-rename-form')&&!!document.querySelector('[data-codex-view="home"]')&&document.querySelector('.agent.director').getBoundingClientRect().width>0`)
  await evaluate(`document.querySelector('[data-conversation-id="'+newChatId+'"] .conversation-rename').click()`);await wait('!!document.querySelector(".conversation-rename-form")')
  await evaluate(`(()=>{const i=document.querySelector('[aria-label="对话名称"]');i.value='  悟空  三段动作讨论  ';i.dispatchEvent(new Event('input',{bubbles:true}));i.focus()})()`);await key('Enter');await wait('!document.querySelector(".conversation-rename-form")')
  await test('手动名称保存到列表且保留消息',`ts.agentConversations().find(c=>c.id===newChatId).customTitle==='悟空 三段动作讨论'&&p.current.agentState.messages.length===2`)
  await openChat(await evaluate('newChatId'));await sendMessage('保持原来的名称，继续完善镜头')
  await test('后续聊天不覆盖手动名称且延续新会话标识',`document.querySelector('.codex-nav h2').textContent==='悟空 三段动作讨论'&&fakeCalls.filter(c=>c.route.endsWith('/run')).at(-1).data.conversationId===newChatId&&ts.agentConversations().length===5`)
  await evaluate(`localStorage.setItem('chat-ui-project',p.current.id);localStorage.setItem('chat-ui-id',newChatId)`)
  const oldOrigin=await evaluate('performance.timeOrigin');await send('Page.reload');await wait(`performance.timeOrigin>${oldOrigin}&&!!document.querySelector('#app')?.__vue_app__?.config.globalProperties.$pinia`);await evaluate(bind)
  await evaluate(`(async()=>{window.ts=await import('/src/services/canvas/taskStore.ts');await p.load(localStorage.getItem('chat-ui-project'));await document.querySelector('#app').__vue_app__.config.globalProperties.$router.push('/studio')})()`);await wait('!!document.querySelector(".agent-orb")');await evaluate(`if(!document.querySelector('.agent.director')?.getBoundingClientRect().width)document.querySelector('.agent-orb').click()`)
  await test('刷新恢复详情页、原会话及手动名称',`!!document.querySelector('[data-codex-view="chat"]')&&p.current.agentState.activeConversationId===localStorage.getItem('chat-ui-id')&&document.querySelector('.codex-nav h2').textContent==='悟空 三段动作讨论'&&p.current.agentState.messages.length===4`)
  await evaluate(`window.fakeHold=true;window.normalFetch=fetch;window.fetch=async(url,init={})=>{if(String(url).endsWith('/__juliu-codex/run')&&fakeHold){const data=JSON.parse(init.body);fakeCalls.push({route:String(url),data});return new Response(new ReadableStream({start(c){const enc=new TextEncoder();c.enqueue(enc.encode(JSON.stringify({type:'started',runId:'held',token:'held'})+'\\n'));c.enqueue(enc.encode(JSON.stringify({type:'progress',message:'正在查看画布'})+'\\n'));init.signal?.addEventListener('abort',()=>c.error(new DOMException('停止','AbortError')),{once:true})}}),{headers:{'content-type':'application/x-ndjson'}})}return normalFetch(url,init)}`)
  await input('请继续等待');await evaluate(`document.querySelector('[aria-label="发送消息"]').click()`);await wait('!!document.querySelector(".stop")&&document.querySelector(".codex-live").textContent.includes("正在查看画布")')
  await test('运行中显示进度停止入口并禁止切换',`document.querySelector('[aria-label="返回会话列表"]').disabled&&document.querySelector('[aria-label="新对话"]').disabled&&document.querySelector('.run-summary').getAttribute('aria-disabled')==='true'&&document.querySelector('textarea').disabled`)
  await evaluate(`document.querySelector('.stop').click()`);await wait('!document.querySelector(".stop")')
  await test('取消任务释放输入并保留已完成记录',`!document.querySelector('textarea').disabled&&p.current.agentState.messages.at(-1).content.includes('已停止')&&fakeCalls.some(c=>c.route.endsWith('/cancel'))`)
  await evaluate(`fakeHold=false`)
  await home();await evaluate(`document.querySelector('[aria-label="附件与创作"]').click()`)
  await test('加号菜单保留附件、创作入口和出片模式',`document.querySelector('.codex-add-menu').textContent.includes('上传文本附件')&&document.querySelector('.codex-add-menu').textContent.includes('批量优化')&&document.querySelector('.codex-add-menu').textContent.includes('首尾帧链')`)
  await key('Escape')
  await evaluate(`p.current.canvas.nodes.push({id:'reference-node',type:'imageGen',position:{x:0,y:0},data:{label:'悟空参考',prompt:'人物设定'}});document.querySelector('[aria-label="引用节点或资源"]').click()`);await wait('!!document.querySelector("[data-reference-id=\\"node:reference-node\\"]")')
  await evaluate(`document.querySelector('[data-reference-id="node:reference-node"]').click()`)
  await test('首页仍可引用画布节点',`document.querySelector('.context-chips').textContent.includes('悟空参考')`)
  await evaluate(`document.querySelector('.context-chip button').click()`)
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false})
  await test('390px首页列表和固定输入区均在窗口内',`(async()=>{await new Promise(r=>setTimeout(r,80));const a=document.querySelector('.codex-history').getBoundingClientRect(),b=document.querySelector('.composer').getBoundingClientRect();return a.width>200&&a.left>=0&&a.right<=innerWidth&&b.bottom<=innerHeight&&b.left>=0&&b.right<=innerWidth&&a.bottom<=b.top})()`)
  await shot('codex-home-narrow.png');await openChat(await evaluate("localStorage.getItem('chat-ui-id')"))
  await test('390px详情标题、输入区与发送控件可用',`(()=>{const b=document.querySelector('.composer').getBoundingClientRect(),r=document.querySelector('.run-summary').getBoundingClientRect();return b.bottom<=innerHeight&&b.width>200&&r.right<=innerWidth&&!!document.querySelector('[aria-label="返回会话列表"]')})()`)
  await shot('codex-conversation-narrow.png')
  await evaluate(`s.update({assistantEngine:'api'})`);await wait('!!document.querySelector(".conversation-toggle")')
  await test('切回原API保留原对话列表与输入交互',`!document.querySelector('[data-codex-view]')&&!!document.querySelector('.creative-tabs')&&!document.querySelector('.codex-history')&&!!document.querySelector('[aria-label="新对话"]')`)
  await evaluate(`document.querySelector('[aria-label="新对话"]').click()`);await wait('p.current.agentState.messages.length===0')
  await test('原API新对话仍按原方式立即创建',`ts.agentConversations().length===6`)
  await evaluate(`window.apiChatId=p.current.agentState.activeConversationId;document.querySelector('[aria-label="切换对话"]').click()`)
  await wait(`!!document.querySelector('[data-conversation-id="'+apiChatId+'"] .conversation-rename')&&!document.querySelector('[data-conversation-id="'+apiChatId+'"] .conversation-rename').disabled`)
  await evaluate(`document.querySelector('[data-conversation-id="'+apiChatId+'"] .conversation-rename').click()`);await wait('!!document.querySelector(".conversation-rename-form")')
  await evaluate(`(()=>{const i=document.querySelector('[aria-label="对话名称"]');i.value='原API创作讨论';i.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.conversation-rename-form button[type="submit"]').click()})()`);await wait('!document.querySelector(".conversation-rename-form")')
  await test('原API对话重命名保持可用',`document.querySelector('.conversation-toggle').textContent.includes('原API创作讨论')&&ts.agentConversations().find(c=>c.id===apiChatId).customTitle==='原API创作讨论'`)
  assert.equal(errors.length,0,JSON.stringify(errors));await fs.writeFile(path.join(out,'browser-validation.json'),JSON.stringify({checks,isolatedBrowser:true,realModel:false,userProjectsModified:false},null,2));console.log('Passed '+checks.length+' Codex chat layout checks')
} finally { socket?.close();chrome.kill('SIGTERM');await new Promise(r=>setTimeout(r,300));await fs.rm(profile,{recursive:true,force:true}).catch(()=>{}) }
