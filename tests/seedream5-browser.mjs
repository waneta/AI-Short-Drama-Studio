import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
const base = process.env.JULIU_TEST_URL || 'http://127.0.0.1:5189'
const out = process.env.JULIU_TEST_OUT || '/tmp/juliu-seedream5-browser'
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

  await send('Page.enable');await send('Runtime.enable');await send('Emulation.setDeviceMetricsOverride',{width:1280,height:1000,deviceScaleFactor:1,mobile:false});await send('Page.navigate',{url:base+'/#/'});await wait('!!document.querySelector("#app")?.__vue_app__?.config.globalProperties.$pinia')
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

  await evaluate(`(async()=>{const pinia=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;const stores=await import('/src/stores/index.ts');window.p=stores.useProjectStore(pinia);window.s=stores.useSettingsStore(pinia);window.assets=stores.useAssetsStore(pinia);
  p.create('Seedream5清晰度隔离验收');localStorage.setItem('size-project-id',p.current.id);
  const models=['doubao-seedream-5.0-flash','doubao-seedream-5.0-pro','doubao-seedream-5-0-pro','doubao-seedream-5-0-flash-260915','gpt-image-2.6-sunburst','gpt-image-1.5'];
  const image={id:'size-fixture',name:'火山方舟测试接入',provider:'volcengine',baseUrl:'https://ark.cn-beijing.volces.com/api/plan/v3',apiKey:'fixture-only',model:models[0],models};
  const comfy=(id,type)=>({id,name:id,provider:'comfyui',baseUrl:'http://fixture.invalid',apiKey:'',model:'comfyui',models:['comfyui'],adapter:{type:'comfyui-prompt',workflowTemplate:JSON.stringify({'1':{class_type:type,inputs:{}}})}});
  s.update({aiMode:'real',image,images:[image,comfy('h3-fixture','MiniMaxH3ImageConditioning'),comfy('qwen-fixture','TextEncodeQwenImage21')],activeImageId:'size-fixture'});await s.flush();
  p.addCanvasNode({id:'size-test',type:'imageGen',position:{x:0,y:0},data:{label:'图片39等效验收',prompt:'以@1为人物参考，白色背景',imageModel:models[0],imageProfileId:'size-fixture',aspectRatio:'16:9',imageResolution:'auto'}});await p.save()})()`)
  await evaluate(bind)
  const mock=`(()=>{window.imageCalls=[];const native=window.fetch;window.fetch=async(url,init={})=>{if(String(url).startsWith('/ark-image-api/')||String(url).startsWith('https://ark.cn-beijing.volces.com/')||String(url).startsWith('https://api.openai.com/')){imageCalls.push({url:String(url),body:init.body instanceof FormData?Object.fromEntries(init.body):JSON.parse(init.body)});return Response.json({data:[{b64_json:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRz8AAAAASUVORK5CYII='}]})}return native(url,init)}})()`
  await evaluate(mock)
  const click=async selector=>{await wait(`!!document.querySelector(${JSON.stringify(selector)})`);await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest'})`);await new Promise(r=>setTimeout(r,80));const r=await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);await send('Input.dispatchMouseEvent',{type:'mousePressed',...r,button:'left',clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',...r,button:'left',clickCount:1})}
  const change=async(selector,value)=>{await evaluate(`(()=>{const s=document.querySelector(${JSON.stringify(selector)});s.value=${JSON.stringify(String(value))};s.dispatchEvent(new Event('change',{bubbles:true}))})()`)}
  const open=async()=>{if(!await evaluate(`!!document.querySelector('.generation-settings-panel')`))await click('#size-fixture [aria-label="图片参数"]');await wait(`!!document.querySelector('.generation-settings-panel')`)}
  const close=async()=>{if(await evaluate(`!!document.querySelector('.generation-settings-panel')`))await click('[aria-label="关闭参数设置"]')}
  const shot=async name=>{await fs.writeFile(path.join(out,name),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'))}

  const option=async text=>{const selector=await evaluate(`(()=>{const buttons=[...document.querySelectorAll('.generation-settings-panel .settings-option')];return buttons.findIndex(b=>b.textContent.trim()===${JSON.stringify(text)})})()`);assert(selector>=0,'Option missing '+text);await evaluate(`document.querySelectorAll('.generation-settings-panel .settings-option')[${selector}].click()`)}
  await open();await test('Doubao Seedream识别为清晰度控件',`document.querySelector('.settings-label').textContent==='清晰度'&&!document.querySelector('.generation-settings-panel').textContent.includes('兼容接口使用预设尺寸')`)
  await test('仅显示默认和1K1.5K2K，不冒称支持4K',`['默认 · 2K','1K','1.5K','2K'].every(x=>[...document.querySelectorAll('.settings-option')].some(b=>b.textContent.trim()===x))&&![...document.querySelectorAll('.settings-option')].some(b=>b.textContent.trim()==='4K')`)
  await test('默认2K显示2816×1584',`document.querySelector('.image-output-size').textContent.includes('2816×1584')`)
  await evaluate(`(async()=>{const bytes=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRz8AAAAASUVORK5CYII='),c=>c.charCodeAt(0));const ids=[];for(let i=0;i<4;i++)ids.push((await assets.add(new Blob([bytes],{type:'image/png'}),'image','uploaded',{filename:'ref'+i+'.png',projectId:p.current.id})).id);p.patchCanvasNode('size-test',{referenceAssetIds:ids})})()`)
  for(const model of ['doubao-seedream-5.0-flash','doubao-seedream-5.0-pro']){
    await close();await change('#size-fixture select','size-fixture::'+model);await open()
    for(const [tier,size] of [['1K','1424x800'],['1.5K','2048x1152'],['2K','2816x1584']]){
      await option(tier);await test(`${model} ${tier}显示准确尺寸`,`document.querySelector('.image-output-size').textContent.includes('${size.replace('x','×')}')`)
      await evaluate(`runner.generateFreeformImage('size-test')`);await test(`${model} ${tier}四参考走原生JSON且宽高一致`,`(()=>{const r=imageCalls.at(-1);return r.url==='/ark-image-api/api/plan/v3/images/generations'&&r.body.size==='${size}'&&r.body.model==='${model}'&&r.body.image.length===4&&!('sequential_image_generation' in r.body)})()`)
    }
  }
  await click('[aria-label="比例 9:16"]');await test('竖版2K尺寸1584×2816',`document.querySelector('.image-output-size').textContent.includes('1584×2816')`)
  await click('.generation-settings-panel details>summary');await option('自定义宽高');await change('[aria-label="图片宽度"]',2048);await change('[aria-label="图片高度"]',1152);await evaluate(`runner.generateFreeformImage('size-test')`);await test('手填宽高准确提交',`imageCalls.at(-1).body.size==='2048x1152'`)
  await change('[aria-label="图片宽度"]',4096);await test('超过Seedream像素限制即时提示',`document.querySelector('[role="alert"]').textContent.includes('总像素')`)
  await evaluate(`(async()=>{window.beforeCalls=imageCalls.length;try{await runner.generateFreeformImage('size-test');window.rejected=false}catch{window.rejected=true}})()`);await test('非法尺寸不发送请求',`rejected&&imageCalls.length===beforeCalls`)
  await change('[aria-label="图片宽度"]','');await test('清空自定义尺寸不能复用旧值',`document.querySelector('[role="alert"]').textContent.includes('正整数')`)
  await change('[aria-label="图片宽度"]',2048);await close();await evaluate(`(async()=>{await p.save();await s.flush()})()`);await send('Page.reload');await wait('!document.querySelector("#size-fixture")');await wait('!!document.querySelector("#app")?.__vue_app__?.config.globalProperties.$pinia');await evaluate(`(async()=>{const stores=await import('/src/stores/index.ts');const pinia=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;window.p=stores.useProjectStore(pinia);window.s=stores.useSettingsStore(pinia);await p.load(localStorage.getItem('size-project-id'))})()`);await evaluate(bind);await open();await test('刷新保存后恢复Seedream自定义尺寸',`document.querySelector('[aria-label="图片宽度"]').value==='2048'&&document.querySelector('.image-output-size').textContent.includes('2048×1152')`)
  await option('1.5K');await shot('seedream-desktop.png');await close();await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});await open();await test('窄屏清晰度面板不横向溢出',`(()=>{const p=document.querySelector('.generation-settings-panel'),r=p.getBoundingClientRect();return r.left>=0&&r.right<=390&&p.scrollWidth<=p.clientWidth})()`);await shot('seedream-narrow.png');await close()
  await change('#size-fixture select','size-fixture::gpt-image-2.6-sunburst');await open();await test('切换GPT仍显示画质及更多比例',`!!document.querySelector('.image-quality-section')&&!!document.querySelector('.gpt-more-sizes')`);await close()
  await evaluate(`p.patchCanvasNode('size-test',{referenceAssetIds:[]})`);await change('#size-fixture select','h3-fixture::comfyui');await open();await test('H3仍保留4K及20MP档位',`[...document.querySelectorAll('.settings-option')].some(b=>b.textContent.trim()==='4K')&&[...document.querySelectorAll('.settings-option')].some(b=>b.textContent.includes('20MP'))`);await close()
  await change('#size-fixture select','qwen-fixture::comfyui');await open();await test('Qwen仍保留比例和清晰度',`!!document.querySelector('[aria-label="比例 9:16"]')&&[...document.querySelectorAll('.settings-option')].some(b=>b.textContent.trim()==='2K')`);await close()
  assert.equal(errors.length,0,JSON.stringify(errors));await fs.writeFile(path.join(out,'browser-validation.json'),JSON.stringify({checks,isolatedBrowser:true,realInference:false,userProjectsModified:false},null,2));console.log('Passed '+checks.length+' Seedream UI checks')
} finally {socket?.close();chrome.kill('SIGTERM');await new Promise(r=>setTimeout(r,300));await fs.rm(profile,{recursive:true,force:true}).catch(()=>{})}
