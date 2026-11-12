/** Ubuntu Web regression checks; uses an ephemeral HTTP fixture, never a real model. */
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { transform, build } from 'esbuild'

const root = fileURLToPath(new URL('../', import.meta.url))
const source = await fs.readFile(new URL('../src/services/ai/comfyWebProxy.ts', import.meta.url), 'utf8')
const { code } = await transform(source, { loader: 'ts', format: 'esm' })
const { comfyWebProxyUrl } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
const target = 'http://127.0.0.1:8188'
assert.equal(comfyWebProxyUrl(`${target}/view?filename=a%20b.png&type=output`, target), '/comfy-local/view?filename=a%20b.png&type=output')
assert.equal(comfyWebProxyUrl(`${target}/prompt`, target, true), `${target}/prompt`)
assert.equal(comfyWebProxyUrl(`${target}/prompt`, ''), `${target}/prompt`)
assert.equal(comfyWebProxyUrl('https://example.com/prompt', target), 'https://example.com/prompt')
assert.equal(comfyWebProxyUrl('http://127.0.0.1:8189/prompt', target), 'http://127.0.0.1:8189/prompt')
const imageTarget = 'http://127.0.0.1:8191'
assert.equal(comfyWebProxyUrl(`${imageTarget}/view?filename=a%20b.png&type=output`, target, false, imageTarget), '/comfy-image/view?filename=a%20b.png&type=output')
assert.equal(comfyWebProxyUrl(`${target}/prompt`, target, false, imageTarget), '/comfy-local/prompt')
assert.equal(comfyWebProxyUrl(`${imageTarget}/prompt`, '', false, imageTarget), '/comfy-image/prompt')
assert.equal(comfyWebProxyUrl(`${imageTarget}/prompt`, target, true, imageTarget), `${imageTarget}/prompt`)
assert.equal(comfyWebProxyUrl('http://user:secret@127.0.0.1:8191/prompt', target, false, imageTarget), 'http://user:secret@127.0.0.1:8191/prompt')
assert.equal(comfyWebProxyUrl('http://127.0.0.1.evil.test:8191/prompt', target, false, imageTarget), 'http://127.0.0.1.evil.test:8191/prompt')
assert.equal(comfyWebProxyUrl('/relative', target, false, imageTarget), '/relative')

const helperSource = await fs.readFile(new URL('../src/services/ai/tokenPlanWebProxy.ts', import.meta.url), 'utf8')
const helperCode = await transform(helperSource, { loader: 'ts', format: 'esm' })
const { tokenPlanWebProxyUrl } = await import(`data:text/javascript;base64,${Buffer.from(helperCode.code).toString('base64')}`)
const tokenApi = 'https://token-plan.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation'
const speechApi = 'https://token-plan.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer'
assert.equal(tokenPlanWebProxyUrl(speechApi, true), '/token-plan-api/api/v1/services/audio/tts/SpeechSynthesizer')
const visionApi = 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions'
assert.equal(tokenPlanWebProxyUrl(visionApi, true), '/token-plan-api/compatible-mode/v1/chat/completions')
const resultUrl = 'https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/result.png?Signature=a%2Fb&Expires=123'
assert.equal(tokenPlanWebProxyUrl(tokenApi, true), '/token-plan-api/api/v1/services/aigc/multimodal-generation/generation')
assert.equal(tokenPlanWebProxyUrl(resultUrl, true), `/token-plan-media?url=${encodeURIComponent(resultUrl)}`)
assert.equal(tokenPlanWebProxyUrl(tokenApi, false), tokenApi)
assert.equal(tokenPlanWebProxyUrl(tokenApi, true, true), tokenApi)
assert.equal(tokenPlanWebProxyUrl('https://example.com/result.png', true), 'https://example.com/result.png')
assert.equal(tokenPlanWebProxyUrl('https://token-plan.cn-beijing.maas.aliyuncs.com.evil.test/api/v1/tasks/id', true), 'https://token-plan.cn-beijing.maas.aliyuncs.com.evil.test/api/v1/tasks/id')
const proxyBundle = await build({ entryPoints: [fileURLToPath(new URL('./token-plan-proxy.ts', import.meta.url))], bundle: true, write: false, format: 'esm', platform: 'node' })
const { tokenPlanWebProxy } = await import(`data:text/javascript;base64,${Buffer.from(proxyBundle.outputFiles[0].text).toString('base64')}`)

const png = Buffer.from([137,80,78,71,13,10,26,10])
const fixture = http.createServer(async (req,res) => {
  const body=[]
  for await (const chunk of req) body.push(chunk)
  if (req.url.startsWith('/view') || req.url.startsWith('/result.png')) { assert(!req.headers.authorization); res.setHeader('Content-Type','image/png'); res.end(png); return }
  res.setHeader('Content-Type','application/json')
  res.end(JSON.stringify({path:req.url,method:req.method,origin:req.headers.origin || null,authorization:req.headers.authorization || null,async:req.headers['x-dashscope-async'] || null,body:Buffer.concat(body).toString()}))
})
await new Promise(resolve=>fixture.listen(0,'127.0.0.1',resolve))
const imageFixture = http.createServer(async (req, res) => {
  const body = []
  for await (const chunk of req) body.push(chunk)
  assert(!req.headers.origin)
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify({ instance: 'local-image', path: req.url, method: req.method, body: Buffer.concat(body).toString() }))
})
await new Promise(resolve => imageFixture.listen(0, '127.0.0.1', resolve))
const previousImageTarget = process.env.COMFYUI_IMAGE_URL
process.env.COMFYUI_IMAGE_URL = `http://127.0.0.1:${imageFixture.address().port}`
const previousTarget = process.env.COMFYUI_URL
process.env.COMFYUI_URL = `http://127.0.0.1:${fixture.address().port}`
const reservation = http.createServer()
await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve))
const webPort = reservation.address().port
await new Promise(resolve=>reservation.close(resolve))
// A regression server must not replace the running workbench dependency cache.
const cacheDir = await fs.mkdtemp(join(tmpdir(), 'juliu-web-test-'))
let vite
try {
  const fixtureOrigin = process.env.COMFYUI_URL
  vite = await createServer({root,cacheDir,mode:'web',logLevel:'error',plugins:[{ ...tokenPlanWebProxy({ apiOrigin: fixtureOrigin, mediaOrigin: fixtureOrigin }), enforce: 'pre' }],server:{port:webPort,host:'127.0.0.1'}})
  assert(!vite.config.plugins.some(p=>/electron/i.test(p.name)), 'Web must not instantiate Electron plugins')
  await vite.listen()
  const base=`http://127.0.0.1:${vite.httpServer.address().port}`
  const home=await fetch(base)
  assert.equal(home.status,200)
  assert.equal(home.headers.get('cross-origin-opener-policy'),'same-origin')
  assert.equal(home.headers.get('cross-origin-embedder-policy'),'require-corp')
  const input=JSON.stringify({prompt:{'4':{inputs:{text:'中文提示词\n第二行'}}}})
  const submit=await fetch(`${base}/comfy-local/prompt`,{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:input})
  const echoed=await submit.json()
  assert.equal(echoed.path,'/prompt')
  assert.equal(echoed.method,'POST')
  assert.equal(echoed.body,input)
  assert.equal(echoed.origin,null)
  const history=await(await fetch(`${base}/comfy-local/history/test-id?test=1`)).json()
  assert.equal(history.path,'/history/test-id?test=1')
  const output=await fetch(`${base}/comfy-local/view?filename=test.png`)
  assert.equal(output.headers.get('content-type'),'image/png')
  assert.deepEqual(Buffer.from(await output.arrayBuffer()),png)
  const imageSubmit = await fetch(`${base}/comfy-image/prompt`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: input })
  assert.equal(imageSubmit.status, 200)
  assert.deepEqual(await imageSubmit.json(), { instance: 'local-image', path: '/prompt', method: 'POST', body: input })
  const imageHistory = await (await fetch(`${base}/comfy-image/history/test-image?test=1`)).json()
  assert.equal(imageHistory.instance, 'local-image')
  assert.equal(imageHistory.path, '/history/test-image?test=1')
  assert.notEqual((await (await fetch(`${base}/comfy-local/history/test-video`)).json()).instance, 'local-image')
  const cloud = await fetch(base + tokenPlanWebProxyUrl(tokenApi, true), {
    method: 'POST', headers: { Origin: base, Authorization: 'Bearer test-fixture-only', 'Content-Type': 'application/json', 'X-DashScope-Async': 'enable' }, body: input
  })
  assert.equal(cloud.status, 200)
  const cloudBody = await cloud.json()
  assert.equal(cloudBody.path, '/api/v1/services/aigc/multimodal-generation/generation')
  assert.equal(cloudBody.authorization, 'Bearer test-fixture-only')
  assert.equal(cloudBody.async, 'enable')
  assert.equal(cloudBody.origin, null)
  assert.equal(cloudBody.body, input)
  const visionInput = JSON.stringify({model:'qwen3.8-max',messages:[{role:'user',content:[{type:'text',text:'描述画面'},{type:'image_url',image_url:{url:'data:image/png;base64,test'}}]}]})
  const vision = await fetch(base + tokenPlanWebProxyUrl(visionApi, true), {method:'POST',headers:{Origin:base,Authorization:'Bearer test-vision','Content-Type':'application/json'},body:visionInput})
  assert.equal(vision.status,200)
  const visionBody = await vision.json()
  assert.equal(visionBody.path,'/compatible-mode/v1/chat/completions')
  assert.equal(visionBody.authorization,'Bearer test-vision')
  assert.equal(visionBody.body,visionInput)
  const task = await (await fetch(base + '/token-plan-api/api/v1/tasks/test-task')).json()
  assert.equal(task.path, '/api/v1/tasks/test-task')
  const media = await fetch(base + tokenPlanWebProxyUrl(resultUrl, true), { headers: { Authorization: 'Bearer must-not-forward' } })
  assert.equal(media.status, 200)
  assert.deepEqual(Buffer.from(await media.arrayBuffer()), png)
  for (const badUrl of ['http://127.0.0.1:8188/private', 'https://example.com/result.png', 'https://bucket.oss-cn-beijing.aliyuncs.com.evil.test/image']) {
    assert.equal((await fetch(`${base}/token-plan-media?url=${encodeURIComponent(badUrl)}`)).status, 403)
  }
  assert.equal((await fetch(base + '/token-plan-api/api/v1/unknown', { method: 'POST' })).status, 403)
  assert.equal((await fetch(base + '/token-plan-api/api/v1/tasks/id', { headers: { Origin: 'https://example.com' } })).status, 403)
  assert.equal((await fetch(base + tokenPlanWebProxyUrl(tokenApi, true))).status, 405)
  console.log('PASS: Web-only startup, isolation headers, separate local-image/remote-video Comfy proxies; Token Plan POST/auth/async/body/polling and signed OSS media downloads; origin/target/method restrictions; desktop URLs unchanged.')
} finally {
  await vite?.close()
  await fs.rm(cacheDir, { recursive: true, force: true })
  await new Promise(resolve=>fixture.close(resolve))
  await new Promise(resolve => imageFixture.close(resolve))
  if (previousImageTarget === undefined) delete process.env.COMFYUI_IMAGE_URL
  else process.env.COMFYUI_IMAGE_URL = previousImageTarget
  if(previousTarget===undefined) delete process.env.COMFYUI_URL
  else process.env.COMFYUI_URL=previousTarget
}
