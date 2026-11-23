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
  stdin: { contents: `export * from './src/services/ai/dashscopeMedia'; export { comfyPromptGenerate } from './src/services/ai/adapters'; export { generateImage } from './src/services/ai/image'; export * from './src/services/ai/gptImageSize'; export * from './src/services/ai/imageModelCapabilities'; export { imageResolutionOptions, nodeImageResolution } from './src/services/canvas/nodeGeneration'; export { generateVideo } from './src/services/ai/video'; export { generateSpeech, compatibleVoice, voicesForModel } from './src/services/ai/tts'; export { callLLM } from './src/services/ai/client'; export { LLM_PROVIDERS, TTS_PROVIDERS, VIDEO_PROVIDERS, VISION_PROVIDERS } from './src/services/ai/providers';`, resolveDir: root },
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

let checks = 0
const pngBase64 = Buffer.from([137,80,78,71,13,10,26,10]).toString('base64')
const modern = ['gpt-image-2', 'gpt-image-2.5-sunburst', 'gpt-image-2.5-flare', 'gpt-image-2.6-sunburst', 'gpt-image-2.6-flare']
const expected = {
  '1:1':[1024,1024], '2:3':[1024,1536], '3:2':[1536,1024],
  '16:9':[1536,864], '9:16':[864,1536], '4:3':[1536,1152], '3:4':[1152,1536],
  '5:4':[1280,1024], '4:5':[1024,1280], '2:1':[2048,1024], '1:2':[1024,2048],
  '21:9':[1792,768], '9:21':[768,1792]
}
try {
  Object.assign(config.image,{provider:'openai',baseUrl:'https://api.openai.com/v1',apiKey:'test-fixture-openai'})
  responder=(url,init)=>{
    assert.equal(url,config.image.baseUrl+(init.body instanceof FormData?'/images/edits':'/images/generations'))
    assert.equal(init.headers.Authorization,'Bearer test-fixture-openai')
    return json({data:[{b64_json:pngBase64}]})
  }
  for(const model of modern){
    config.image.model=model
    const capability=api.imageModelCapabilities(config.image)
    assert(capability.gptCustomSize)
    assert.equal(capability.qualities.length,model==='gpt-image-2'?4:6)
    for(const [aspectRatio,[w,h]] of Object.entries(expected)){
      assert(capability.ratios.includes(aspectRatio))
      for(const withRefs of [false,true]){
        const result=await api.generateImage({...imageInput,aspectRatio,quality:'high',referenceImages:withRefs?[new Blob(['a']),new Blob(['b'])]:undefined})
        const call=calls.at(-1),fields=call.body instanceof FormData?Object.fromEntries(call.body):JSON.parse(call.body)
        assert.equal(fields.model,model);assert.equal(fields.size,`${w}x${h}`);assert.equal(fields.quality,'high')
        assert.equal(result.generation.requestedWidth,w);assert.equal(result.generation.requestedHeight,h)
        assert.equal('response_format' in fields,false)
        if(withRefs)assert.equal(call.body.getAll('image[]').length,2)
        const [rw,rh]=aspectRatio.split(':').map(Number);assert.equal(w*rh,h*rw)
        checks++
      }
    }
    for(const [w,h] of [[2048,1152],[3840,2160],[2160,3840],[1280,1024]]){
      const result=await api.generateImage({...imageInput,h3Resolution:'custom',h3CustomWidth:w,h3CustomHeight:h,referenceImages:[new Blob(['a'])]})
      assert.equal(calls.at(-1).body.get('size'),`${w}x${h}`)
      assert.equal(result.generation.requestedWidth,w);assert.equal(result.generation.requestedHeight,h);checks++
    }
    for(const [w,h,message] of [[1537,864,/16的倍数/],[3840,3840,/总像素/],[4000,1024,/3840/],[512,512,/总像素/],[3072,512,/宽高比/],[undefined,1024,/正整数/],[1536.5,864,/正整数/]]){
      const before=calls.length
      await assert.rejects(api.generateImage({...imageInput,h3Resolution:'custom',h3CustomWidth:w,h3CustomHeight:h}),message)
      assert.equal(calls.length,before,'Invalid sizes must fail before any API call');checks++
    }
  }
  config.image.model='gpt-image-1.5'
  assert.equal(api.imageModelCapabilities(config.image).gptCustomSize,false)
  assert.equal(api.imageModelCapabilities(config.image).ratios.length,3)
  for(const [aspectRatio,w,h] of [['1:1',1024,1024],['3:2',1536,1024],['2:3',1024,1536],['16:9',1536,1024]]){
    const output=await api.generateImage({...imageInput,aspectRatio,quality:'max'})
    const fields=JSON.parse(calls.at(-1).body);assert.equal(fields.size,`${w}x${h}`);assert.equal(fields.quality,undefined)
    assert.equal(output.generation.requestedWidth,w);assert.equal(output.generation.requestedHeight,h);checks++
  }
  await assert.rejects(api.generateImage({...imageInput,h3Resolution:'custom',h3CustomWidth:1536,h3CustomHeight:864}),/仅支持标准尺寸/);checks++
  for(const model of ['gpt-image-2-2026-04-21','gpt-image-2.5-sunburst-2026-09-08','gpt-image-2.6-flare-2026-11-01']){assert(api.gptImageCustomSizeSupported(model));checks++}
  for(const model of ['gpt-image-1','gpt-image-1-mini','chatgpt-image-latest','gpt-image-3','gpt-image-2-unknown']){assert.equal(api.gptImageCustomSizeSupported(model),false);checks++}
  const data={imageModel:'gpt-image-2.5-sunburst',imageResolution:'custom',aspectRatio:'16:9'}
  assert.equal(api.nodeImageResolution(data,config.image),'custom');checks++
  assert.equal(api.nodeImageResolution({...data,imageModel:'gpt-image-1.5'},config.image),'auto');checks++
  const comfy={provider:'comfyui',model:'comfyui',adapter:{type:'comfyui-prompt',workflowTemplate:JSON.stringify({'1':{class_type:'MiniMaxH3ImageConditioning',inputs:{}}})}}
  assert.equal(api.imageModelCapabilities(comfy).mode,'pixels');assert.equal(api.imageModelCapabilities(comfy).gptCustomSize,false)
  assert(api.imageResolutionOptions(comfy).some(o=>o.value==='4mp'));checks++
  const qwen={...comfy,adapter:{...comfy.adapter,workflowTemplate:JSON.stringify({'1':{class_type:'TextEncodeQwenImage21',inputs:{}}})}}
  assert.equal(api.imageModelCapabilities(qwen).mode,'pixels');assert(api.imageModelCapabilities(qwen).ratios.includes('9:16'));checks++
  // A saved display name must never turn a Comfy/relay transport into the GPT custom-size API.
  assert.equal(api.imageModelCapabilities(comfy,'gpt-image-2.5-sunburst').gptCustomSize,false);checks++
  console.log(JSON.stringify({checks,passed:true,realInference:false,network:false}))
} finally {globalThis.fetch=nativeFetch;globalThis.setTimeout=nativeTimeout}
