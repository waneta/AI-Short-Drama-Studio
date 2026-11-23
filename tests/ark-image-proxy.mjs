/** Fixed upstream transport tests; synthetic credentials and loopback fixtures only. */
import assert from 'node:assert/strict'
import http from 'node:http'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
const root=fileURLToPath(new URL('../',import.meta.url))
const out=await build({stdin:{contents:"export * from './scripts/token-plan-proxy';export * from './src/services/ai/tokenPlanWebProxy';",resolveDir:root},bundle:true,write:false,format:'esm',platform:'node'})
const api=await import('data:text/javascript;base64,'+Buffer.from(out.outputFiles[0].text).toString('base64'))
let checks=0
const seen=[]
const fixture=http.createServer(async(req,res)=>{const body=[];for await(const b of req)body.push(b);seen.push({url:req.url,headers:req.headers,body:Buffer.concat(body).toString()});res.setHeader('Content-Type','application/json');if(req.headers.authorization==='Bearer fixture-denied'){res.statusCode=401;res.end(JSON.stringify({error:{code:'AuthenticationError',message:'fixture invalid key'}}));return}res.end(JSON.stringify({data:[{b64_json:'aW1hZ2U='}]}))})
await new Promise(r=>fixture.listen(0,'127.0.0.1',r))
let handler
api.tokenPlanWebProxy({arkOrigin:`http://127.0.0.1:${fixture.address().port}`}).configureServer({middlewares:{use(f){handler=f}}})
const local=http.createServer((req,res)=>handler(req,res,()=>{res.statusCode=404;res.end()}))
await new Promise(r=>local.listen(0,'127.0.0.1',r))
const base=`http://127.0.0.1:${local.address().port}`
try{
  for(const path of ['/api/v3/images/generations','/api/plan/v3/images/generations']){
    const raw=api.ARK_IMAGE_ORIGIN+path,mapped='/ark-image-api'+path
    assert.equal(api.tokenPlanWebProxyUrl(raw,true),mapped);checks++
    assert.equal(api.tokenPlanWebProxyUrl(raw,false),raw);checks++
    assert.equal(api.tokenPlanWebProxyUrl(raw,true,true),raw);checks++
    const body=JSON.stringify({model:'doubao-seedream-5.0-flash',prompt:'参考@1与@2\n中文',size:'2048x1152',image:['data:image/png;base64,Zmlyc3Q=','data:image/png;base64,c2Vjb25k'],response_format:'b64_json'})
    const response=await fetch(base+mapped,{method:'POST',headers:{Origin:base,Authorization:'Bearer fixture-only','Content-Type':'application/json',Cookie:'do-not-forward=1','X-DashScope-Async':'enable'},body})
    assert.equal(response.status,200);assert.equal((await response.json()).data[0].b64_json,'aW1hZ2U=');const received=seen.at(-1);assert.equal(received.url,path);assert.equal(received.body,body);assert.equal(received.headers.authorization,'Bearer fixture-only');assert.equal(received.headers.origin,undefined);assert.equal(received.headers.cookie,undefined);assert.equal(received.headers['x-dashscope-async'],undefined);checks++
    const fail=await fetch(base+mapped,{method:'POST',headers:{Authorization:'Bearer fixture-denied','Content-Type':'application/json'},body:'{}'});assert.equal(fail.status,401);assert.equal((await fail.json()).error.code,'AuthenticationError');checks++
    for(const method of ['GET','PUT','DELETE']){const n=seen.length;assert.equal((await fetch(base+mapped,{method})).status,405);assert.equal(seen.length,n);checks++}
    const n=seen.length;assert.equal((await fetch(base+mapped,{method:'POST',headers:{Origin:'https://evil.test'},body:'{}'})).status,403);assert.equal(seen.length,n);checks++
  }
  for(const raw of ['https://ark.cn-beijing.volces.com.evil.test/api/plan/v3/images/generations','http://ark.cn-beijing.volces.com/api/plan/v3/images/generations','https://user:secret@ark.cn-beijing.volces.com/api/plan/v3/images/generations','https://ark.cn-beijing.volces.com:8443/api/plan/v3/images/generations','https://ark.cn-beijing.volces.com/api/plan/v3/chat/completions','https://ark.cn-beijing.volces.com/api/plan/v3/images/generations?target=http://localhost','https://api.openai.com/v1/images/generations','http://127.0.0.1:8188/prompt']){assert.equal(api.tokenPlanWebProxyUrl(raw,true),raw);checks++}
  for(const path of ['/ark-image-api/api/plan/v3/images/edits','/ark-image-api/api/v3/unknown','/ark-image-api/api/v3/images/generations?target=http://localhost','/ark-image-api//evil.test/api/v3/images/generations']){const n=seen.length;assert.equal((await fetch(base+path,{method:'POST',body:'{}'})).status,403);assert.equal(seen.length,n);checks++}
  console.log(JSON.stringify({passed:true,checks,realInference:false,realKeys:false}))
}finally{await new Promise(r=>local.close(r));await new Promise(r=>fixture.close(r))}
