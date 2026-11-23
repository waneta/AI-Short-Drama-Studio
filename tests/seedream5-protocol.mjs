/** Protocol regression fixtures. No credentials, network or model inference. */
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const config = {
  image: { provider: 'dashscope', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', apiKey: 'test-fixture-image', model: 'qwen-image-2.0' },
  video: { provider: 'dashscope', baseUrl: 'https://dashscope.aliyuncs.com/api/v1', apiKey: 'test-fixture-video', workflowId: 'wan2.6-i2v-flash' },
  tts: { baseUrl: 'https://dashscope.aliyuncs.com/api/v1', apiKey: 'test-fixture-tts', model: 'qwen3-tts-flash', voice: 'Cherry' }
}
config.vision = { provider: 'dashscope-token-plan', baseUrl: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1', apiKey: 'test-fixture-vision', model: 'qwen3.7-plus' }
globalThis.__tutorialConfig = config
const output = await build({
  stdin: { contents: `export * from './src/services/ai/dashscopeMedia'; export { comfyPromptGenerate } from './src/services/ai/adapters'; export { generateImage } from './src/services/ai/image'; export * from './src/services/ai/gptImageSize'; export * from './src/services/ai/seedream5ImageSize'; export * from './src/services/ai/imageModelCapabilities'; export { imageResolutionOptions, nodeImageResolution } from './src/services/canvas/nodeGeneration'; export { generateVideo } from './src/services/ai/video'; export { generateSpeech, compatibleVoice, voicesForModel } from './src/services/ai/tts'; export { callLLM } from './src/services/ai/client'; export { LLM_PROVIDERS, TTS_PROVIDERS, VIDEO_PROVIDERS, VISION_PROVIDERS } from './src/services/ai/providers';`, resolveDir: root },
  bundle: true, write: false, format: 'esm', platform: 'browser',
  define: { 'import.meta.env': '{}' },
  alias: { '@': path.join(root, 'src') },
  plugins: [{ name: 'fixture-runtime', setup(b) {
    b.onResolve({ filter: /(?:^@\/stores$|^@\/services\/desktop$|(?:^\.\/|\/ai\/)runtime$|^@\/services\/ffmpeg$)/ }, args => ({ path: args.path, namespace: 'fixture' }))
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents:
      args.path === '@/stores' ? 'export const useSettingsStore=()=>({config:globalThis.__tutorialConfig}); export const useProjectStore=()=>({current:null});' :
      args.path.endsWith('desktop') ? 'export const isDesktop=()=>false; export const desktop=()=>({}); export const blobFromPath=()=>{throw Error("unexpected desktop")};' :
      args.path.endsWith('ffmpeg') ? 'export const toDigitalHumanWav=()=>{throw Error("unexpected ffmpeg")};' :
      `export const getAIMode=()=> 'real'; export const getImageConfig=()=>globalThis.__tutorialConfig.image; export const getVideoConfig=()=>globalThis.__tutorialConfig.video; export const getTtsConfig=()=>globalThis.__tutorialConfig.tts; export const getLlmConfig=()=>globalThis.__tutorialConfig.llm; export const getVisionConfig=()=>globalThis.__tutorialConfig.vision; export const getVideoPromptStyle=()=> 'scene-narrative'; export const autodlVideoProfileId=()=>undefined;`
    }))
  } }]
})
const api = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text + '\n//# sourceURL=tutorial-media-fixture.mjs').toString('base64')}`)
const nativeTimeout = globalThis.setTimeout
const nativeFetch = globalThis.fetch
// Only poll delays are accelerated. Request timeout timers retain their real duration.
globalThis.setTimeout = (callback, ms, ...args) => nativeTimeout(callback, ms === 3000 || ms === 1500 ? 0 : ms, ...args)
let calls = []
let responder
globalThis.fetch = async (url, init = {}) => {
  calls.push({ url: String(url), ...init })
  return responder(String(url), init)
}
const json = data => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } })
const imageInput = { prompt: '小满站在门前', style: 'anime', width: 1280, height: 720, aspectRatio: '16:9' }
const videoInput = { prompt: '小满轻轻举起钥匙', imageBlob: new Blob(['image'], { type: 'image/png' }), duration: 5, width: 1280, height: 720, videoModel: 'h3', videoProfileId: 'fixture' }


let checks=0
const pngBase64=Buffer.from([137,80,78,71,13,10,26,10]).toString('base64')
const nativeReader=globalThis.FileReader
globalThis.FileReader=class {readAsDataURL(blob){blob.arrayBuffer().then(b=>{this.result=`data:${blob.type};base64,${Buffer.from(b).toString('base64')}`;this.onload()}).catch(e=>this.onerror(e))}}
const expected={'1mp':{'1:1':[1024,1024],'16:9':[1424,800],'9:16':[800,1424],'4:3':[1152,864]},'seedream-1.5k':{'1:1':[1536,1536],'16:9':[2048,1152],'9:16':[1152,2048],'4:3':[1792,1344]},'4mp':{'1:1':[2048,2048],'16:9':[2816,1584],'9:16':[1584,2816],'4:3':[2368,1776]}}
try {
  Object.assign(config.image,{provider:'volcengine',apiKey:'fixture-seedream'})
  for(const baseUrl of ['https://ark.cn-beijing.volces.com/api/v3','https://ark.cn-beijing.volces.com/api/plan/v3']){
    config.image.baseUrl=baseUrl
    responder=(url,init)=>{
      assert.equal(url,baseUrl+'/images/generations');assert.equal(init.headers.Authorization,'Bearer fixture-seedream');assert.equal(init.body instanceof FormData,false)
      const body=JSON.parse(init.body);assert.equal(body.model,config.image.model);assert.equal(body.response_format,'b64_json');assert.equal(body.watermark,false);assert.equal('sequential_image_generation' in body,false);assert.equal('quality' in body,false)
      return json({data:[{b64_json:pngBase64}]})
    }
    for(const model of ['doubao-seedream-5.0-flash','doubao-seedream-5.0-pro','doubao-seedream-5-0-pro','doubao-seedream-5-0-flash-260915','doubao-seedream-5-0-pro-260628']){
      config.image.model=model
      const caps=api.imageModelCapabilities(config.image);assert(caps.seedream5);assert.equal(caps.mode,'seedream');assert.equal(caps.ratios.length,13)
      const opts=api.imageResolutionOptions(config.image);assert.deepEqual(opts.map(x=>x.value),['auto','1mp','seedream-1.5k','4mp','custom']);checks++
      for(const resolution of ['auto','1mp','seedream-1.5k','4mp'])for(const ratio of caps.ratios)for(const withRefs of [false,true]){
        const refs=[new Blob(['first'],{type:'image/png'}),new Blob(['second'],{type:'image/png'})]
        const out=await api.generateImage({...imageInput,aspectRatio:ratio,h3Resolution:resolution,referenceImages:withRefs?refs:undefined})
        const body=JSON.parse(calls.at(-1).body),[w,h]=body.size.split('x').map(Number)
        assert.equal(api.seedream5SizeIssue(w,h),'');assert.equal(out.generation.requestedWidth,w);assert.equal(out.generation.requestedHeight,h)
        const known=expected[resolution==='auto'?'4mp':resolution][ratio];if(known)assert.deepEqual([w,h],known)
        if(withRefs){assert.equal(body.image.length,2);assert(body.image[0].endsWith(Buffer.from('first').toString('base64')));assert(body.image[1].endsWith(Buffer.from('second').toString('base64')))}else assert.equal(body.image,undefined)
        checks++
      }
      for(const [w,h] of [[2048,1152],[1280,720],[1792,1024]]){
        const out=await api.generateImage({...imageInput,h3Resolution:'custom',h3CustomWidth:w,h3CustomHeight:h});assert.equal(JSON.parse(calls.at(-1).body).size,`${w}x${h}`);assert.equal(out.generation.requestedWidth,w);checks++
      }
      for(const [w,h,reason] of [[512,512,/总像素/],[4096,4096,/总像素/],[2048.5,1152,/正整数/],[undefined,1152,/正整数/],[10000,100,/宽高比/]]){
        const n=calls.length;await assert.rejects(api.generateImage({...imageInput,h3Resolution:'custom',h3CustomWidth:w,h3CustomHeight:h}),reason);assert.equal(calls.length,n);checks++
      }
      const n=calls.length;await assert.rejects(api.generateImage({...imageInput,referenceImages:Array(11).fill(new Blob(['x']))}),/最多支持10张/);assert.equal(calls.length,n);checks++
      assert.equal(api.nodeImageResolution({imageResolution:'16mp',imageModel:model},config.image),'auto');checks++
    }
  }
  // Adapter/relay transport keeps precedence even when its display model looks like native Seedream.
  assert.equal(api.imageModelCapabilities({provider:'volcengine',model:'doubao-seedream-5.0-flash',adapter:{type:'http-custom'}}).seedream5,false);checks++
  assert.equal(api.imageModelCapabilities({provider:'comfyui',model:'doubao-seedream-5.0-flash',adapter:{type:'comfyui-prompt'}}).mode,'pixels');checks++
  console.log(JSON.stringify({passed:true,checks,realInference:false,network:false}))
}finally{globalThis.fetch=nativeFetch;globalThis.setTimeout=nativeTimeout;globalThis.FileReader=nativeReader}
