import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import {createHash,randomUUID} from 'node:crypto'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url),{build}=require('esbuild')
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'juliu-effort-real-'))
const out=process.env.JULIU_TEST_OUT||'/tmp/juliu-codex-effort-real';await fs.mkdir(out,{recursive:true})
const globalFile=path.join(os.homedir(),'.codex/config.toml'),hash=async()=>createHash('sha256').update(await fs.readFile(globalFile)).digest('hex'),before=await hash()
process.env.JULIU_CODEX_CONFIG_FILE=path.join(temp,'connection.json');process.env.JULIU_CODEX_PROXY='http://127.0.0.1:7897'
await build({entryPoints:['scripts/codex-bridge.ts'],bundle:true,platform:'node',format:'esm',outfile:path.join(temp,'bridge.mjs'),external:['vite'],target:'node22'})
const {codexBridge}=await import(path.join(temp,'bridge.mjs'));const server=http.createServer();codexBridge().configureServer({middlewares:{use:fn=>server.on('request',(req,res)=>fn(req,res,()=>res.end()))},httpServer:server});await new Promise(r=>server.listen(0,'127.0.0.1',r))
try{
 const response=await fetch(`http://127.0.0.1:${server.address().port}/__juliu-codex/run`,{method:'POST',headers:{'Content-Type':'application/json','X-Juliu-Codex':'1'},body:JSON.stringify({kind:'text',clientId:'synthetic-'+randomUUID(),projectId:'synthetic-effort-test',conversationId:randomUUID(),model:'gpt-6.1-sol',effort:'low',prompt:'这是合成的参数连通性验收。不要调用工具，不要修改文件，不生成媒体。只回复英文大写OK。'}),signal:AbortSignal.timeout(150000)})
 assert(response.ok);const text=await response.text(),events=text.trim().split('\n').map(JSON.parse);assert(!events.some(e=>e.type==='error'),JSON.stringify(events.filter(e=>e.type==='error')));assert(events.some(e=>e.type==='done'&&e.text.includes('OK')));assert.equal(await hash(),before)
 await fs.writeFile(path.join(out,'real-validation.json'),JSON.stringify({result:'passed',model:'gpt-6.1-sol',effort:'low',realCLI:true,realModel:true,globalConfigUnchanged:true,userProjectsModified:false,mediaGeneration:false,reply:'OK'},null,2));console.log('Real CLI effort=low completed; global config unchanged; no media or user project changes.')
}finally{server.closeAllConnections();await new Promise(r=>server.close(r));await fs.rm(temp,{recursive:true,force:true})}
