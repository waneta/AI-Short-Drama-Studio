import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
const base = process.env.JULIU_TEST_URL || 'http://127.0.0.1:5190'
const out = process.env.JULIU_TEST_OUT || '/tmp/juliu-ark-image-browser'
await fs.mkdir(out, { recursive: true })
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'juliu-codex-browser-'))
const chrome = spawn('/usr/bin/google-chrome', ['--headless=new','--no-sandbox','--disable-gpu','--disable-extensions','--no-first-run','--disable-background-networking','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'], { stdio: ['ignore','ignore','pipe'] })
let socket
const checks = [], errors = [], networkFailures=[]
try {
  const port = await new Promise((resolve, reject) => { let log=''; const timer=setTimeout(()=>reject(new Error('Chrome startup timeout')),15000); chrome.on('error',reject); chrome.stderr.on('data',v=>{log+=v;const m=/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/.exec(log);if(m){clearTimeout(timer);resolve(m[1])}}) })
  const tabs=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  socket=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl)
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject})
  let seq=0; const pending=new Map()
  socket.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result)}}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);else if(m.method==='Network.loadingFailed')networkFailures.push(m.params)}
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq,t=setTimeout(()=>reject(new Error('CDP timeout '+method)),30000);pending.set(id,{resolve:v=>{clearTimeout(t);resolve(v)},reject:e=>{clearTimeout(t);reject(e)}});socket.send(JSON.stringify({id,method,params}))})
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value}
  const wait=async expression=>{for(let i=0;i<75;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,200))}throw new Error('UI timeout '+expression)}
  const test=async(name,expression)=>{const value=await evaluate(expression);assert.equal(value,true,name+': '+JSON.stringify(value));checks.push({name,passed:true});console.log(name)}

  await send('Page.enable');await send('Runtime.enable');await send('Network.enable');await send('Page.navigate',{url:base+'/#/'})
  await wait('!!document.querySelector("#app")?.__vue_app__?.config.globalProperties.$pinia')
  await evaluate(`(async()=>{const pinia=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;const stores=await import('/src/stores/index.ts');window.s=stores.useSettingsStore(pinia);window.images=await import('/src/services/ai/image.ts');const profile={id:'ark-isolated',name:'订阅传输隔离测试',provider:'volcengine',baseUrl:'https://ark.cn-beijing.volces.com/api/plan/v3',apiKey:'fixture-invalid-key-for-cors-check',model:'doubao-seedream-5.0-flash',models:['doubao-seedream-5.0-flash']};s.update({aiMode:'real',images:[profile],image:profile,activeImageId:profile.id});window.beforeConfig=JSON.stringify(s.config.image)})()`)
  // Invalid fixture key only. Direct request should fail preflight before any generation.
  await evaluate(`(async()=>{try{await fetch('https://ark.cn-beijing.volces.com/api/plan/v3/images/generations',{method:'POST',headers:{Authorization:'Bearer fixture-invalid-key-for-cors-check','Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(15000)});window.directFailure='unexpected response'}catch(e){window.directFailure=e.message}})()`)
  await test('复现浏览器直连Failed to fetch',`directFailure.toLowerCase().includes('fetch')`)
  const cors=networkFailures.find(f=>f.corsErrorStatus)
  assert(cors,'Expected browser CORS diagnostic');checks.push({name:'浏览器诊断确认为CORS预检拦截',passed:true,detail:cors.corsErrorStatus});console.log('浏览器诊断确认为CORS预检拦截')
  await evaluate(`(()=>{const native=window.fetch;window.routes=[];window.fetch=async(url,init)=>{routes.push(String(url));return native(url,init)}})()`)
  await evaluate(`(async()=>{try{await images.generateImage({prompt:'不提交有效生成',style:'anime',aspectRatio:'16:9',width:1280,height:720,imageProfileId:'ark-isolated'});window.proxyError='unexpected success'}catch(e){window.proxyError=e.message}})()`)
  await test('真实图片入口使用本机同源转发',`routes.some(r=>r==='/ark-image-api/api/plan/v3/images/generations')&&!routes.some(r=>r.startsWith('https://ark.cn-beijing.volces.com'))`)
  await test('无效测试Key返回可读取401而不是Failed to fetch',`proxyError.includes('401')&&!proxyError.includes('Failed to fetch')&&proxyError.includes('AuthenticationError')`)
  await test('原订阅地址及配置保持不变',`beforeConfig===JSON.stringify(s.config.image)`)
  assert.equal(errors.length,0,JSON.stringify(errors));await fs.writeFile(path.join(out,'browser-validation.json'),JSON.stringify({checks,isolatedBrowser:true,invalidFixtureKeyOnly:true,realInference:false,userProjectsModified:false},null,2));console.log('Passed '+checks.length+' transport browser checks')
}finally{socket?.close();chrome.kill('SIGTERM');await new Promise(r=>setTimeout(r,300));await fs.rm(profile,{recursive:true,force:true}).catch(()=>{})}
