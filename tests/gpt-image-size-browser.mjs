import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
const base = process.env.JULIU_TEST_URL || 'http://127.0.0.1:5188'
const out = process.env.JULIU_TEST_OUT || '/tmp/juliu-gpt-image-sizes-browser'
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
  const wait=async expression=>{for(let i=0;i<75;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,200))}throw new Error('UI timeout '+expression)}
  const test=async(name,expression)=>{const value=await evaluate(expression);assert.equal(value,true,name+': '+JSON.stringify(value));checks.push({name,passed:true});console.log(name)}

  await send('Page.enable');await send('Runtime.enable');await send('Emulation.setDeviceMetricsOverride',{width:1280,height:1000,deviceScaleFactor:1,mobile:false})
  await send('Page.navigate',{url:base+'/#/'})
  await wait('!!document.querySelector("#app")?.__vue_app__?.config.globalProperties.$pinia')
  const bind=String.raw`(async()=>{
    const pinia=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
    const stores=await import('/src/stores/index.ts');window.p=stores.useProjectStore(pinia);window.s=stores.useSettingsStore(pinia);
    window.runner=await import('/src/services/canvas/runner.ts');
    const componentSource=await (await fetch('/src/components/settings/ImageModelSelect.vue')).text();const vueUrl=componentSource.match(/from [\"']([^\"']*\/vue\.js[^\"']*)/)[1];const v=await import(vueUrl);
    const C=(await import('/src/components/settings/ImageModelSelect.vue')).default;
    const old=document.querySelector('#size-fixture');if(old)old.remove();
    const mount=document.createElement('div');mount.id='size-fixture';mount.style='position:fixed;top:20px;left:20px;width:330px;z-index:9000;padding:12px;background:#252529';document.body.append(mount);
    window.fixtureApp=v.createApp(C,{nodeId:'size-test'});fixtureApp.use(pinia);fixtureApp.mount(mount);
  })()`
  await evaluate(`(async()=>{const pinia=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;const stores=await import('/src/stores/index.ts');window.p=stores.useProjectStore(pinia);window.s=stores.useSettingsStore(pinia);
    p.create('GPT尺寸隔离验收');window.projectId=p.current.id;localStorage.setItem('size-project-id',projectId);
    const models=['gpt-image-2','gpt-image-2.5-sunburst','gpt-image-2.5-flare','gpt-image-2.6-sunburst','gpt-image-2.6-flare','gpt-image-1.5'];
    s.update({aiMode:'real',images:[{id:'size-fixture',name:'GPT测试接入',provider:'openai',baseUrl:'https://api.openai.com/v1',apiKey:'fixture-only',model:models[1],models}],activeImageId:'size-fixture'});await s.flush();
    p.addCanvasNode({id:'size-test',type:'imageGen',position:{x:0,y:0},data:{label:'尺寸验收',prompt:'测试',imageModel:models[1],imageProfileId:'size-fixture',aspectRatio:'1:1',imageResolution:'auto'}});await p.save();})()`)
  await evaluate(bind)
  const mock=`(()=>{window.imageCalls=[];const native=window.fetch;window.fetch=async(url,init={})=>{if(String(url).startsWith('https://api.openai.com/v1/images/')){imageCalls.push({url:String(url),size:init.body instanceof FormData?init.body.get('size'):JSON.parse(init.body).size,refs:init.body instanceof FormData?init.body.getAll('image[]').length:0});return Response.json({data:[{b64_json:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRz8AAAAASUVORK5CYII='}]})}return native(url,init)}})()`
  await evaluate(mock)
  const click=async selector=>{await wait(`!!document.querySelector(${JSON.stringify(selector)})`);await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest'})`);await new Promise(r=>setTimeout(r,80));const r=await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);await send('Input.dispatchMouseEvent',{type:'mousePressed',...r,button:'left',clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',...r,button:'left',clickCount:1})}
  const change=async(selector,value)=>{await evaluate(`(()=>{const s=document.querySelector(${JSON.stringify(selector)});s.value=${JSON.stringify(String(value))};s.dispatchEvent(new Event('change',{bubbles:true}))})()`)}
  const open=async()=>{if(!await evaluate(`!!document.querySelector('.generation-settings-panel')`))await click('#size-fixture [aria-label="图片参数"]');await wait(`!!document.querySelector('.generation-settings-panel')`)}
  const close=async()=>{if(await evaluate(`!!document.querySelector('.generation-settings-panel')`))await click('[aria-label="关闭参数设置"]')}
  const shot=async name=>{await fs.writeFile(path.join(out,name),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'))}
  await open();await test('常用三种尺寸与更多入口',`document.querySelectorAll('.generation-settings-panel>.settings-section:not(.gpt-more-sizes) .aspect-option').length===3&&!!document.querySelector('.gpt-more-sizes')`)
  await click('.gpt-more-sizes>summary');await test('更多包含十种比例预设',`document.querySelector('.gpt-more-sizes').open&&document.querySelectorAll('.gpt-more-sizes .aspect-option').length===10`)
  for(const [ratio,size] of [['16:9','1536x864'],['9:16','864x1536'],['21:9','1792x768'],['4:5','1024x1280']]){
    await click(`[aria-label="比例 ${ratio}"]`);await test(`${ratio}界面像素准确`,`document.querySelector('.image-output-size').textContent.includes('${size.replace('x','×')}')&&p.current.canvas.nodes[0].data.aspectRatio==='${ratio}'`)
    await evaluate(`runner.generateFreeformImage('size-test')`);await test(`${ratio}节点提交尺寸与记录一致`,`imageCalls.at(-1).size==='${size}'&&p.current.canvas.nodes[0].data.outputAssetIds.length===1`)
  }
  await click('.gpt-custom-size');await change('[aria-label="图片宽度"]',2048);await change('[aria-label="图片高度"]',1152)
  await test('手动宽高与摘要同步且比例预设不误选',`p.current.canvas.nodes[0].data.imageResolution==='custom'&&document.querySelector('.image-output-size').textContent.includes('2048×1152')&&document.querySelectorAll('.aspect-option[aria-pressed=true]').length===0`)
  await evaluate(`runner.generateFreeformImage('size-test')`);await test('手填宽高经完整图片节点传入接口',`imageCalls.at(-1).size==='2048x1152'`)
  await change('[aria-label="图片宽度"]',1537);await test('非法尺寸即时显示错误',`document.querySelector('[role="alert"]').textContent.includes('16的倍数')`)
  await evaluate(`(async()=>{window.beforeCalls=imageCalls.length;try{await runner.generateFreeformImage('size-test');window.rejected=false}catch{window.rejected=true}})()`);await test('非法尺寸在请求前拦截',`rejected&&imageCalls.length===beforeCalls`)
  await change('[aria-label="图片宽度"]','');await test('清空宽度不能复用旧值',`p.current.canvas.nodes[0].data.imageWidth===undefined&&document.querySelector('[role="alert"]').textContent.includes('正整数')`)
  await change('[aria-label="图片宽度"]',2048);await close();await open();await test('关闭重开保留手填值',`document.querySelector('.gpt-more-sizes').open&&document.querySelector('[aria-label="图片宽度"]').value==='2048'`)
  await evaluate(`(async()=>{await p.save();await s.flush()})()`);await close();await send('Page.reload');await wait('!document.querySelector("#size-fixture")');await wait('!!document.querySelector("#app")?.__vue_app__?.config.globalProperties.$pinia')
  await evaluate(`(async()=>{const pinia=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;const stores=await import('/src/stores/index.ts');window.p=stores.useProjectStore(pinia);window.s=stores.useSettingsStore(pinia);await p.load(localStorage.getItem('size-project-id'))})()`)
  await evaluate(bind);await evaluate(mock);await open();await test('刷新加载项目后保留自定义尺寸',`document.querySelector('[aria-label="图片宽度"]').value==='2048'&&document.querySelector('[aria-label="图片高度"]').value==='1152'`)
  await shot('custom-desktop.png');await close()
  for(const model of ['gpt-image-2','gpt-image-2.5-sunburst','gpt-image-2.5-flare','gpt-image-2.6-sunburst','gpt-image-2.6-flare']){
    await change('#size-fixture select',`size-fixture::${model}`);await open();await test(`${model}开放更多`,`!!document.querySelector('.gpt-more-sizes')`);await close()
  }
  await change('#size-fixture select','size-fixture::gpt-image-1.5');await open();await test('GPT1.5切换后回落标准尺寸并收起自定义',`!document.querySelector('.gpt-more-sizes')&&p.current.canvas.nodes[0].data.imageResolution==='auto'&&['1:1','3:2','2:3'].includes(p.current.canvas.nodes[0].data.aspectRatio)`);await close()
  await change('#size-fixture select','size-fixture::gpt-image-2.6-sunburst');await open();await click('.gpt-more-sizes>summary');await click('[aria-label="比例 9:16"]');await click('.gpt-custom-size')
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});await new Promise(r=>setTimeout(r,250));await test('窄屏更多面板与手动宽高不横向溢出',`(()=>{const panel=document.querySelector('.generation-settings-panel'),r=panel.getBoundingClientRect();return r.left>=0&&r.right<=390&&panel.scrollWidth<=panel.clientWidth&&[...panel.querySelectorAll('.custom-size input')].every(i=>{const a=i.getBoundingClientRect();return a.left>=r.left&&a.right<=r.right})})()`)
  await click('[aria-label="图片高度"]');await shot('custom-narrow.png');await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await wait(`!document.querySelector('.generation-settings-panel')`);await test('Esc关闭参数且恢复按钮焦点',`document.activeElement===document.querySelector('#size-fixture [aria-label="图片参数"]')`)
  assert.equal(errors.length,0,JSON.stringify(errors));await fs.writeFile(path.join(out,'browser-validation.json'),JSON.stringify({checks,isolatedBrowser:true,realInference:false,userProjectsModified:false},null,2));console.log('Passed '+checks.length+' size UI checks')
} finally {socket?.close();chrome.kill('SIGTERM');await new Promise(r=>setTimeout(r,300));await fs.rm(profile,{recursive:true,force:true}).catch(()=>{})}
