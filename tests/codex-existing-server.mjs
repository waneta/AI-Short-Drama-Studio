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
else if(m.method==='config/read')r({config:{model_provider:'cliproxyapi',model:'fixture-proxy',model_providers:{cliproxyapi:{base_url:'http://192.168.18.216:8310/v1',wire_api:'responses',...(process.env.JULIU_NATIVE_AUTH==='managed'?{http_headers:{Authorization:'never-return'}}:{env_key:'OPENAI_API_KEY'}),secret:'never-return'}}}});
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
process.env.CODEX_HOME = path.join(temp, 'native-home');await fs.mkdir(process.env.CODEX_HOME);await fs.writeFile(path.join(process.env.CODEX_HOME,'config.toml'),'fixture-v1')
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
  const response = await post('/config', { mode:'existing',baseUrl:'',model:'',proxy:'',apiKey:'old-manual-key-must-not-be-used',keySource:'stored',envKey:'OPENAI_API_KEY' })
  assert.equal(response.status,200); pass('已有配置模式无需重新填写地址模型和Key')
  const status = await(await get('/status')).json();assert(status.authenticated);assert.equal(status.authType,'existing');assert.equal(status.native.provider,'cliproxyapi');assert.equal(status.native.model,'fixture-proxy');assert(!JSON.stringify(status).includes('never-return'));assert(!JSON.stringify(status).includes('fixture-environment-secret'))
  pass('原生预设只展示安全摘要，复用现有环境凭证且不泄露静态授权头')
  const input = {kind:'agent',clientId:'fixture',projectId:'fixture',conversationId:'fixture',prompt:'simple text'}
  const completed = await(await post('/run',input)).text();assert(completed.includes('"type":"done"'))
  const readLogs = async () => (await fs.readFile(logFile,'utf8')).trim().split('\n').map(JSON.parse)
  let logs=await readLogs();assert(logs.filter(x=>x.args).every(x=>!x.args.some(a=>a.startsWith('model_provider='))));assert(logs.filter(x=>x.args).every(x=>!x.key));const start=logs.find(x=>x.method==='thread/start');assert.equal(start.params.modelProvider,'cliproxyapi');assert.equal(start.params.model,undefined)
  pass('真实执行保留本机provider和默认模型，不注入旧手动Key或强制OpenAI')
  await(await post('/run',input)).text();logs=await readLogs();assert(logs.some(x=>x.method==='thread/resume'));const count=logs.filter(x=>x.method==='thread/start').length
  await fs.writeFile(path.join(process.env.CODEX_HOME,'config.toml'),'fixture-v2');await(await post('/run',input)).text();logs=await readLogs();assert.equal(logs.filter(x=>x.method==='thread/start').length,count+1)
  pass('切换本机预设后重新建立原生线程，防止沿用旧接入')
  delete process.env.OPENAI_API_KEY;await fs.writeFile(path.join(process.env.CODEX_HOME,'config.toml'),'fixture-v3')
  const missing=await(await get('/status')).json();assert.equal(missing.authenticated,false);assert(missing.connectionIssue.includes('OPENAI_API_KEY'))
  pass('仅在检查发现预设凭证缺失后提示补充，不要求重复设备登录')
  const before=(await readLogs()).filter(x=>x.method==='turn/start').length
  const denied=await(await post('/run',{...input,conversationId:'missing'})).text();assert(denied.includes('补充当前预设的凭证'));assert.equal((await readLogs()).filter(x=>x.method==='turn/start').length,before)
  pass('缺凭证时在模型请求前明确停止，不回退接入或重复执行')
  process.env.JULIU_NATIVE_AUTH='managed';await fs.writeFile(path.join(process.env.CODEX_HOME,'config.toml'),'fixture-v4')
  const managed=await(await get('/status')).json();assert(managed.authenticated);assert.equal(managed.native.envKey,'');assert(!JSON.stringify(managed).includes('never-return'))
  pass('无需环境变量的原生授权方式继续由CLI处理，不被强制要求API Key')
  const out=process.env.JULIU_TEST_OUT||'/tmp/juliu-codex-existing-tests';await fs.mkdir(out,{recursive:true});await fs.writeFile(path.join(out,'server-validation.json'),JSON.stringify({checks,realModel:false,userGlobalConfigurationModified:false},null,2));console.log('Passed '+checks.length+' native reuse server checks')
}finally{server.closeAllConnections();await new Promise(r=>server.close(r));await fs.rm(temp,{recursive:true,force:true})}
