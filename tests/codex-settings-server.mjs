import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url), { build } = require('esbuild')
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'juliu-codex-settings-'))
const fake = path.join(temp, 'fake-codex'), logFile = path.join(temp, 'protocol.jsonl')
await fs.writeFile(fake, `#!${process.execPath}
const readline=require('node:readline'),fs=require('node:fs');
const send=m=>process.stdout.write(JSON.stringify(m)+'\\n');
fs.appendFileSync(process.env.JULIU_PROTOCOL_LOG,JSON.stringify({args:process.argv.slice(2),key:process.env.JULIU_CODEX_API_KEY,proxy:process.env.HTTPS_PROXY})+'\\n');
let device=false;
readline.createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);fs.appendFileSync(process.env.JULIU_PROTOCOL_LOG,JSON.stringify(m)+'\\n');const r=result=>send({id:m.id,result});
if(m.method==='initialize')r({});
else if(m.method==='account/read')r({account:{type:'chatgpt'},requiresOpenaiAuth:true});
else if(m.method==='model/list')r({data:[{id:'fixture',model:'fixture',displayName:'Fixture',isDefault:true}]});
else if(m.method==='config/read')r({config:{model_provider:'cliproxyapi',model:'fixture-proxy',model_providers:{cliproxyapi:{base_url:'http://192.168.18.216:8310/v1',wire_api:'responses',env_key:'OPENAI_API_KEY',secret:'never-return'}}}});
else if(m.method==='account/login/start'){device=true;r({type:'chatgptDeviceCode',loginId:'login-fixture',verificationUrl:'https://auth.openai.com/codex/device',userCode:'ABCD-1234'});if(process.env.JULIU_LOGIN_COMPLETE==='yes')setTimeout(()=>send({method:'account/login/completed',params:{loginId:'login-fixture',success:true}}),100)}
else if(m.method==='account/login/cancel'){device=false;r({status:'canceled'})}
else if(m.method==='thread/start'||m.method==='thread/resume')r({thread:{id:'fixture-thread'}});
else if(m.method==='turn/start'){r({turn:{id:'fixture-turn'}});if(!m.params.input[0].text.includes('HOLD')){send({method:'item/completed',params:{item:{type:'agentMessage',text:'fixture'}}});send({method:'turn/completed',params:{turn:{status:'completed'}}})}}
});
`, { mode: 0o700 })
process.env.JULIU_CODEX_BIN = fake
process.env.JULIU_PROTOCOL_LOG = logFile
process.env.JULIU_CODEX_CONFIG_FILE = path.join(temp, 'juliu-codex-private/connection.json')
process.env.OPENAI_API_KEY = 'fixture-environment-secret'
process.env.JULIU_CODEX_PROXY = 'http://127.0.0.1:7897'
const built = path.join(temp, 'bridge.mjs')
await build({ entryPoints: ['scripts/codex-bridge.ts'], bundle: true, platform: 'node', format: 'esm', outfile: built, external: ['vite'], target: 'node22' })
const { codexBridge } = await import(built)
function serve() {
  const server = http.createServer(), plugin = codexBridge()
  plugin.configureServer({ middlewares: { use: fn => server.on('request', (req, res) => fn(req, res, () => { res.statusCode = 404; res.end() })) }, httpServer: server })
  return server
}
let server = serve()
await new Promise(r => server.listen(0, '127.0.0.1', r))
let base = `http://127.0.0.1:${server.address().port}/__juliu-codex`
const headers = { 'Content-Type': 'application/json', 'X-Juliu-Codex': '1' }
const get = route => fetch(base + route, { headers })
const post = (route, value) => fetch(base + route, { method: 'POST', headers, body: JSON.stringify(value) })
const cfg = { mode: 'custom', baseUrl: 'http://192.168.18.216:8310/v1', apiKey: 'fixture-stored-secret', model: 'fixture-proxy', proxy: '', keySource: 'stored', envKey: 'OPENAI_API_KEY' }
const checks = [], pass = name => { checks.push({ name, passed: true }); console.log(name) }
try {
  assert.equal((await fetch(base + '/config')).status, 403)
  assert.equal((await fetch(base + '/config', { headers: { ...headers, Origin: 'https://other.invalid' } })).status, 403)
  pass('配置和登录接口继承本机同源保护')
  const initial = await (await get('/config')).json(); assert.equal(initial.mode, 'chatgpt'); assert.equal(initial.proxy, process.env.JULIU_CODEX_PROXY)
  pass('初次使用保持原有ChatGPT接入及网络代理')
  const imported = await (await get('/cli-provider')).json(); assert.equal(imported.baseUrl, cfg.baseUrl); assert.equal(imported.envKey, 'OPENAI_API_KEY'); assert(imported.hasEnvironmentKey); assert(!JSON.stringify(imported).includes('secret'))
  pass('从CLI只读导入有效接口模型与环境变量名，不返回其他配置')
  for (const patch of [{ baseUrl: 'file:///tmp/x' }, { baseUrl: 'http://user:pass@host/v1' }, { proxy: 'http://host/path' }, { model: '' }, { envKey: 'X\nY' }]) assert.equal((await post('/config', { ...cfg, ...patch })).status, 400)
  pass('无效地址协议和凭证模型字段被拒绝')
  const response = await post('/config', cfg); assert.equal(response.status, 200); const saved = await response.json(); assert(saved.hasApiKey); assert(!JSON.stringify(saved).includes(cfg.apiKey))
  assert.equal((await fs.stat(process.env.JULIU_CODEX_CONFIG_FILE)).mode & 0o777, 0o600)
  assert.equal((await fs.stat(path.dirname(process.env.JULIU_CODEX_CONFIG_FILE))).mode & 0o777, 0o700)
  pass('密钥保存在主机私有文件，响应不回显Key')
  const kept = await (await post('/config', { ...cfg, apiKey: '' })).json(); assert(kept.hasApiKey); assert.notEqual(kept.revision, saved.revision)
  assert.equal(JSON.parse(await fs.readFile(process.env.JULIU_CODEX_CONFIG_FILE, 'utf8')).apiKey, cfg.apiKey)
  pass('空Key保留已存凭证，并为新连接生成独立修订')
  const status = await (await get('/status')).json(); assert.equal(status.authType, 'custom'); assert.equal(status.models[0].model, cfg.model); assert.equal(status.credentialVerified, false); assert(!JSON.stringify(status).includes(cfg.apiKey))
  const logs = (await fs.readFile(logFile, 'utf8')).trim().split('\n').map(JSON.parse), child = logs.find(v => v.key === cfg.apiKey)
  assert(child); assert(!child.args.join(' ').includes(cfg.apiKey)); assert(child.args.some(v => v.includes('requires_openai_auth=false'))); assert.equal(child.proxy, undefined)
  pass('自定义Responses接入只向子进程环境注入Key，直连不继承代理，状态不冒称凭证已验证')
  const input = { kind: 'agent', clientId: 'fixture', projectId: 'fixture', conversationId: 'fixture', prompt: 'HOLD' }
  const held = await post('/run', input), reader = held.body.getReader(); let identity
  while (!identity) { const r = await reader.read(); for (const line of new TextDecoder().decode(r.value).trim().split('\n')) { const v = JSON.parse(line); if (v.type === 'started') identity = { runId: v.runId, token: v.token } } }
  assert.equal((await post('/config', cfg)).status, 409); assert.equal((await post('/login/start', {})).status, 409)
  await post('/cancel', identity); await reader.cancel().catch(() => {})
  pass('执行任务时禁止改连接或开始设备登录')
  await new Promise(r => setTimeout(r, 30))
  const envSaved = await post('/config', { ...cfg, keySource: 'env', apiKey: '' }); assert.equal(envSaved.status, 200)
  await (await get('/status')).json()
  assert((await fs.readFile(logFile, 'utf8')).includes('fixture-environment-secret'))
  assert.equal((await post('/config', { ...cfg, keySource: 'env', envKey: 'JULIU_MISSING_FIXTURE' })).status, 400)
  pass('支持OPENAI_API_KEY来源，缺失环境变量有明确提示')
  await post('/config', { ...cfg, mode: 'chatgpt', proxy: 'http://127.0.0.1:7897' })
  const login = await (await post('/login/start', {})).json(); assert.equal(login.userCode, 'ABCD-1234')
  assert.equal((await post('/login/poll', { ...login, token: 'wrong' })).status, 404)
  assert.equal((await post('/login/poll', login)).status, 200)
  assert.equal((await post('/config', cfg)).status, 409); assert.equal((await post('/run', input)).status, 409)
  pass('设备登录返回一次性验证码，轮询凭证隔离且阻止并发改配置和生成')
  assert.equal((await (await post('/login/cancel', login)).json()).state, 'cancelled')
  pass('取消通过官方登录协议执行，不登出既有账号')
  process.env.JULIU_LOGIN_COMPLETE = 'yes'
  const completed = await (await post('/login/start', {})).json(); await new Promise(r => setTimeout(r, 150))
  assert.equal((await (await post('/login/poll', completed)).json()).state, 'completed')
  pass('官方登录完成通知自动结束等待并刷新状态')
  server.closeAllConnections(); await new Promise(r => server.close(r)); server = serve(); await new Promise(r => server.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${server.address().port}/__juliu-codex`
  const reopened = await (await get('/config')).json(); assert.equal(reopened.proxy, 'http://127.0.0.1:7897'); assert.equal(reopened.mode, 'chatgpt'); assert(reopened.hasApiKey)
  pass('服务重启后连接配置和保留的凭证仍可使用')
  const out = process.env.JULIU_TEST_OUT || '/tmp/juliu-codex-settings-tests'; await fs.mkdir(out, { recursive: true }); await fs.writeFile(path.join(out, 'server-validation.json'), JSON.stringify({ checks, realModel: false, actualDeviceAuthorization: false }, null, 2))
  console.log(`Passed ${checks.length} settings server checks`)
} finally { server.closeAllConnections(); await new Promise(r => server.close(r)); await fs.rm(temp, { recursive: true, force: true }) }
