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
  stdin: { contents: `export * from './src/services/ai/dashscopeMedia'; export { comfyPromptGenerate } from './src/services/ai/adapters'; export { generateImage } from './src/services/ai/image'; export { generateVideo } from './src/services/ai/video'; export { generateSpeech, compatibleVoice, voicesForModel } from './src/services/ai/tts'; export { callLLM } from './src/services/ai/client'; export { LLM_PROVIDERS, TTS_PROVIDERS, VIDEO_PROVIDERS, VISION_PROVIDERS } from './src/services/ai/providers';`, resolveDir: root },
  bundle: true, write: false, format: 'esm', platform: 'browser',
  define: { 'import.meta.env': '{}' },
  alias: { '@': path.join(root, 'src') },
  plugins: [{ name: 'fixture-runtime', setup(b) {
    b.onResolve({ filter: /(?:^@\/services\/desktop$|(?:^\.\/|\/ai\/)runtime$|^@\/services\/ffmpeg$)/ }, args => ({ path: args.path, namespace: 'fixture' }))
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents:
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
try {
  config.llm = { ...config.vision, model: 'qwen3.8-max', apiKey: 'test-fixture-llm' }
  for (const [list, model] of [[api.LLM_PROVIDERS, 'qwen3.8-max'], [api.TTS_PROVIDERS, 'qwen-audio-3.0-tts-plus'], [api.VIDEO_PROVIDERS, 'wan3.0-video']]) {
    const preset = list.find(p => p.id === 'dashscope-token-plan')
    assert(preset.models.includes(model)); assert.equal(preset.defaultModel, model)
    assert.equal(new URL(preset.baseUrl).hostname, 'token-plan.cn-beijing.maas.aliyuncs.com')
  }
  responder = (url, init) => {
    assert.equal(url, config.llm.baseUrl + '/chat/completions')
    assert.equal(init.headers.Authorization, 'Bearer test-fixture-llm')
    assert.equal(JSON.parse(init.body).model, 'qwen3.8-max')
    return json({ model: 'qwen3.8-max', choices: [{ message: { content: '剧本' } }] })
  }
  assert.equal((await api.callLLM({ messages: [{ role: 'user', content: '写剧本' }] })).content, '剧本')
  const visionPreset = api.VISION_PROVIDERS.find(p => p.id === 'dashscope-token-plan')
  assert(visionPreset && visionPreset.models.includes('qwen3.7-plus'))
  assert.equal(visionPreset.baseUrl, config.vision.baseUrl)
  assert(!visionPreset.models.includes('qwen3.7-max'), 'Vision preset must not suggest text-only models')
  responder = (url, init) => {
    assert.equal(url, config.vision.baseUrl + '/chat/completions')
    assert.equal(init.headers.Authorization, 'Bearer test-fixture-vision')
    const body = JSON.parse(init.body)
    assert.equal(body.model, 'qwen3.7-plus')
    assert.equal(body.messages[0].content[1].type, 'image_url')
    return json({ model: body.model, choices: [{ message: { content: '画面里有一辆车。' } }] })
  }
  const visionResult = await api.callLLM({ provider: 'vision', messages: [{ role: 'user', content: [{ type: 'text', text: '描述这帧视频' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,test' } }] }] })
  assert.equal(visionResult.model, 'qwen3.7-plus')
  assert.equal(visionResult.content, '画面里有一辆车。')
  // GPT Image rejects response_format and the old DALL-E 1792x1024 sizes.
  const savedImageConfig = { ...config.image }
  Object.assign(config.image, { provider: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'test-fixture-openai' })
  const pngBase64 = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString('base64')
  responder = (url, init) => {
    assert.equal(url, 'https://api.openai.com/v1/images/generations')
    const body = JSON.parse(init.body)
    if ('response_format' in body) return new Response(JSON.stringify({ error: { message: "Unknown parameter: 'response_format'.", code: 'unknown_parameter' } }), { status: 400 })
    assert(['1024x1024', '1536x1024', '1024x1536'].includes(body.size), `Unsupported GPT Image size: ${body.size}`)
    return json({ data: [{ b64_json: pngBase64 }] })
  }
  for (const model of ['gpt-image-1', 'gpt-image-1-mini', 'gpt-image-1.5', 'gpt-image-2', 'gpt-image-2.5-sunburst', 'gpt-image-2.5-flare', 'chatgpt-image-latest']) {
    config.image.model = model
    for (const [aspectRatio, width, height, size] of [
      ['16:9', 1280, 720, '1536x1024'], ['9:16', 720, 1280, '1024x1536'], ['1:1', 1024, 1024, '1024x1024']
    ]) {
      assert.equal((await api.generateImage({ ...imageInput, aspectRatio, width, height })).mimeType, 'image/png')
      assert.equal(JSON.parse(calls.at(-1).body).size, size)
    }
  }
  config.image.model = 'gpt-image-1'
  responder = (url, init) => {
    assert.equal(url, 'https://api.openai.com/v1/images/edits')
    assert(init.body instanceof FormData)
    assert.equal(init.body.has('response_format'), false, 'GPT Image edits must omit legacy response_format')
    assert.equal(init.body.get('size'), '1536x1024')
    assert.equal(init.body.getAll('image[]').length, 1)
    return json({ data: [{ b64_json: pngBase64 }] })
  }
  assert.equal((await api.generateImage({ ...imageInput, referenceImages: [videoInput.imageBlob] })).mimeType, 'image/png')
  config.image.model = 'dall-e-3'
  responder = (url, init) => {
    const body = JSON.parse(init.body)
    assert.equal(body.response_format, 'b64_json', 'Preserve the legacy API contract for compatible models')
    assert.equal(body.size, '1792x1024')
    return json({ data: [{ b64_json: pngBase64 }] })
  }
  await api.generateImage(imageInput)
  Object.assign(config.image, savedImageConfig)
  // New subscription models use native DashScope messages, not OpenAI Images fields.
  for (const [provider, baseUrl] of [
    ['dashscope', 'https://dashscope.aliyuncs.com/api/v1'],
    ['dashscope-token-plan', 'https://token-plan.cn-beijing.maas.aliyuncs.com/api/v1']
  ]) {
    for (const model of ['qwen-image-3.0-pro', 'wan2.7-image', 'wan2.7-image-pro']) {
      Object.assign(config.image, { provider, baseUrl, model })
      responder = (url, init) => {
        if (url === 'https://fixture.invalid/image') {
          assert(!init.headers?.Authorization)
          return new Response('image', { headers: { 'Content-Type': 'image/png' } })
        }
        assert.equal(url, `${baseUrl}/services/aigc/multimodal-generation/generation`)
        const body = JSON.parse(init.body)
        assert.equal(body.model, model, 'Keep the exact requested model')
        assert.equal(body.parameters.size, '1280*720')
        assert.equal(body.parameters.n, 1)
        assert.equal('response_format' in body, false)
        if (model.startsWith('wan')) assert.equal('prompt_extend' in body.parameters, false, 'Wan 2.7 rejects prompt_extend')
        else assert.equal(body.parameters.prompt_extend, false)
        assert(body.input.messages[0].content.some(item => item.text?.includes('小满')))
        return json({ output: { choices: [{ message: { content: [{ image: 'https://fixture.invalid/image' }] } }] } })
      }
      await api.generateImage(imageInput)
      const count = model.startsWith('wan') ? 9 : 3
      await api.generateImage({ ...imageInput, referenceImages: Array(count).fill(videoInput.imageBlob) })
      const content = JSON.parse(calls.at(-2).body).input.messages[0].content
      assert.equal(content.filter(item => item.image?.startsWith('data:image/png;base64,')).length, count)
      const requestCount = calls.length
      await assert.rejects(api.generateImage({ ...imageInput, referenceImages: Array(count + 1).fill(videoInput.imageBlob) }), /最多支持/)
      assert.equal(calls.length, requestCount, 'Reject excessive references before submitting')
    }
  }
  Object.assign(config.image, savedImageConfig)
  responder = (url, init) => {
    if (url === 'https://fixture.invalid/image') { assert(!init.headers?.Authorization); return new Response('image', { headers: { 'Content-Type': 'image/png' } }) }
    assert(url.endsWith('/api/v1/services/aigc/multimodal-generation/generation'))
    const body = JSON.parse(init.body)
    assert.equal(body.model, 'qwen-image-2.0')
    assert.equal(body.parameters.size, '1280*720')
    assert(body.input.messages[0].content.some(x => x.text?.includes('小满')))
    return json({ output: { choices: [{ message: { content: [{ image: 'https://fixture.invalid/image' }] } }] } })
  }
  assert.equal((await api.generateImage(imageInput)).mimeType, 'image/png')
  await api.generateImage({ ...imageInput, referenceImages: [videoInput.imageBlob] })
  assert(JSON.parse(calls.at(-2).body).input.messages[0].content[0].image.startsWith('data:image/png;base64,'))
  config.image.model = 'qwen-image-plus'
  await assert.rejects(api.generateImage({ ...imageInput, referenceImages: [videoInput.imageBlob] }), /只支持文生图/)
  config.image.model = 'qwen-image-2.0'
  calls = []; let pollCount = 0; let savedId
  responder = (url, init) => {
    if (url.endsWith('/video-synthesis')) {
      const body = JSON.parse(init.body)
      assert.equal(body.model, 'wan2.6-i2v-flash')
      assert.equal(init.headers.Authorization, 'Bearer test-fixture-video')
      assert.equal(init.headers['X-DashScope-Async'], 'enable')
      assert(body.input.img_url.startsWith('data:image/png;base64,'))
      assert.equal(body.parameters.audio, false)
      return json({ output: { task_id: 'task-123' } })
    }
    if (url.endsWith('/tasks/task-123')) return json({ output: ++pollCount === 1 ? { task_status: 'RUNNING' } : { task_status: 'SUCCEEDED', video_url: 'https://fixture.invalid/video' } })
    assert.equal(url, 'https://fixture.invalid/video'); assert(!init.headers?.Authorization)
    return new Response('video', { headers: { 'Content-Type': 'video/mp4' } })
  }
  assert.equal((await api.generateVideo({ ...videoInput, onTaskSubmitted: id => { savedId = id } })).mimeType, 'video/mp4')
  assert.equal(savedId, 'task-123')
  calls = []
  await api.generateVideo({ ...videoInput, resumeTaskId: savedId })
  assert(!calls.some(x => x.method === 'POST'), 'Resume must not resubmit a paid task')
  await assert.rejects(api.generateVideo({ ...videoInput, duration: 7 }), /5、10 或 15/)
  responder = () => json({ output: { task_status: 'FAILED', message: 'fixture error' } })
  await assert.rejects(api.generateVideo({ ...videoInput, resumeTaskId: savedId }), /fixture error/)
  responder = () => json({ output: { task_status: 'SUCCEEDED' } })
  await assert.rejects(api.generateVideo({ ...videoInput, resumeTaskId: savedId }), /下载地址/)
  const abort = new AbortController(); abort.abort()
  await assert.rejects(api.generateVideo({ ...videoInput, signal: abort.signal }), /取消/)
  calls = []
  responder = (url, init) => {
    if (url.endsWith('/generation')) {
      const body = JSON.parse(init.body); assert.equal(body.input.voice, 'Cherry')
      return json({ output: { audio: { url: 'https://fixture.invalid/speech' } } })
    }
    return new Response('audio', { headers: { 'Content-Type': 'audio/wav' } })
  }
  await api.generateSpeech({ text: '钥匙找到了。' })
  assert(calls[0].url.endsWith('/multimodal-generation/generation'))
  config.tts.apiKey = ''
  await assert.rejects(api.generateSpeech({ text: '钥匙找到了。' }), /没有 API Key/)
  Object.assign(config.tts, { baseUrl: 'https://token-plan.cn-beijing.maas.aliyuncs.com/api/v1', apiKey: 'test-fixture-tts', model: 'qwen-audio-3.0-tts-plus', voice: 'Cherry' })
  assert.equal(api.compatibleVoice(config.tts.model, 'Cherry'), 'longanlingxin')
  assert.deepEqual(api.voicesForModel(config.tts.model).map(v => v.id), ['longanlingxin', 'longanlufeng'])
  responder = (url, init) => {
    if (url.endsWith('/SpeechSynthesizer')) {
      assert.equal(url, config.tts.baseUrl + '/services/audio/tts/SpeechSynthesizer')
      assert.equal(init.headers.Authorization, 'Bearer test-fixture-tts')
      const body = JSON.parse(init.body)
      assert.equal(body.model, 'qwen-audio-3.0-tts-plus'); assert.equal(body.input.voice, 'longanlufeng')
      return json({ output: { audio: { url: 'https://fixture.invalid/audio.wav' } } })
    }
    assert(!init.headers?.Authorization, 'Signed audio URL must not receive API key')
    return new Response('audio', { headers: { 'Content-Type': 'audio/wav' } })
  }
  assert.equal((await api.generateSpeech({ text: '钥匙找到了。', voice: 'longanlufeng' })).mimeType, 'audio/wav')
  Object.assign(config.video, { provider: 'dashscope-token-plan', baseUrl: config.tts.baseUrl })
  for (const [model, image, refs, mediaType] of [
    ['wan3.0-video', undefined, [], undefined],
    ['wan3.0-video', videoInput.imageBlob, [], 'first_frame'],
    ['wan3.0-video', videoInput.imageBlob, [videoInput.imageBlob], 'reference_image'],
    ['happyhorse-1.1-i2v', videoInput.imageBlob, [], 'first_frame'],
    ['happyhorse-1.1-t2v', undefined, [], undefined],
    ['happyhorse-1.1-r2v', videoInput.imageBlob, [videoInput.imageBlob], 'reference_image']
  ]) {
    config.video.workflowId = model
    responder = (url, init) => {
      if (init.method === 'POST') {
        assert.equal(url, config.video.baseUrl + '/services/aigc/video-generation/video-synthesis')
        assert.equal(init.headers['X-DashScope-Async'], 'enable')
        assert.equal(init.headers.Authorization, 'Bearer test-fixture-video')
        const body = JSON.parse(init.body)
        assert.equal(body.model, model); assert.equal(body.input.img_url, undefined)
        assert.equal(body.input.media?.[0]?.type, mediaType)
        assert.equal(body.input.media?.length || 0, mediaType ? 1 + refs.length : 0)
        if (mediaType) assert(body.input.media.every(m => m.url.startsWith('data:image/png;base64,')))
        if (model.startsWith('happyhorse')) assert(!('prompt_extend' in body.parameters))
        return json({ output: { task_id: 'subscription-task' } })
      }
      if (url.endsWith('/tasks/subscription-task')) return json({ output: { task_status: 'SUCCEEDED', video_url: 'https://fixture.invalid/subscribed.mp4' } })
      assert(!init.headers?.Authorization)
      return new Response('video', { headers: { 'Content-Type': 'video/mp4' } })
    }
    const args = { ...videoInput, imageBlob: image, referenceImages: refs, aspectRatio: '9:16' }
    assert.equal((await api.generateVideo(args)).mimeType, 'video/mp4')
    calls = []
    await api.generateVideo({ ...args, imageBlob: undefined, referenceImages: [], resumeTaskId: 'subscription-task' })
    assert(!calls.some(c => c.method === 'POST'), 'Resume must never resubmit')
  }
  config.video.workflowId = 'happyhorse-1.1-i2v'
  await assert.rejects(api.generateVideo({ ...videoInput, imageBlob: undefined }), /需要一张/)
  config.video.workflowId = 'happyhorse-1.1-r2v'
  await assert.rejects(api.generateVideo({ ...videoInput, imageBlob: undefined }), /至少一张/)
  await assert.rejects(api.generateVideo({ ...videoInput, referenceImages: Array(9).fill(videoInput.imageBlob) }), /最多 9/)
  config.video.workflowId = 'wan3.0-video'
  await assert.rejects(api.generateVideo({ ...videoInput, duration: 31 }), /2–30/)
  // Old Comfy image profiles map only prompt/seed: the selected canvas size must reach /prompt.
  const oldImageConfig = config.image
  const imageGraph = {
    '4': { class_type: 'CLIPTextEncode', inputs: { text: 'old' } },
    '6': { class_type: 'EmptySD3LatentImage', inputs: { width: 1024, height: 1024, batch_size: 1 } }
  }
  const imageMap = { version: 1, kind: 'text-to-image', bindings: [{ role: 'prompt', nodeId: '4', field: 'text' }] }
  let submittedImageGraph
  config.image = { provider: 'custom', baseUrl: 'http://127.0.0.1:8188', apiKey: '', model: 'comfyui',
    adapter: { type: 'comfyui-prompt', workflowTemplate: JSON.stringify(imageGraph), inputMap: imageMap } }
  responder = (url, init) => {
    if (url.endsWith('/prompt')) {
      submittedImageGraph = JSON.parse(init.body).prompt
      return json({ prompt_id: 'image-size-1' })
    }
    if (url.includes('/history/')) return json({ 'image-size-1': { status: { status_str: 'success' }, outputs: {
      '10': { images: [{ filename: 'portrait.png', type: 'output' }] }
    } } })
    return new Response('png', { headers: { 'Content-Type': 'image/png' } })
  }
  for (const [aspectRatio, width, height] of [['9:16', 720, 1280], ['16:9', 1280, 720], ['1:1', 1024, 1024]]) {
    assert.equal((await api.generateImage({ ...imageInput, aspectRatio, width, height })).mimeType, 'image/png')
    assert.equal(submittedImageGraph['6'].inputs.width, width)
    assert.equal(submittedImageGraph['6'].inputs.height, height)
    assert.notEqual(submittedImageGraph['4'].inputs.text, 'old')
  }
  assert.equal(imageGraph['6'].inputs.width, 1024, 'Source template remains unchanged')
  assert.equal(imageMap.bindings.length, 1, 'Saved map remains unchanged')
  config.image = oldImageConfig
  // Native Comfy history returns a SaveImage preview before its VideoCombine result.
  let onlyImage = false
  responder = (url, init) => {
    if (url.endsWith('/prompt')) return json({ prompt_id: 'comfy-1' })
    if (url.includes('/history/')) return json({ 'comfy-1': { status: { status_str: 'success' }, outputs: {
      '1': { images: [{ filename: 'preview.png', type: 'output', subfolder: '' }] },
      ...(onlyImage ? {} : { '2': { gifs: [{ filename: 'movie.mp4', type: 'output', subfolder: 'clips' }] } })
    } } })
    assert(url.includes('filename=movie.mp4')); return new Response('video', { headers: { 'Content-Type': 'video/mp4' } })
  }
  const comfy = { baseUrl: 'http://127.0.0.1:8188', prompt: '动作', kind: 'video', adapter: {
    workflowTemplate: JSON.stringify({ '3': { class_type: 'CLIPTextEncode', inputs: { text: 'old', clip: ['4', 0] } } }),
    inputMap: { bindings: [{ role: 'prompt', nodeId: '3', field: 'text' }] }
  } }
  assert.equal((await api.comfyPromptGenerate(comfy)).mimeType, 'video/mp4')
  onlyImage = true
  await assert.rejects(api.comfyPromptGenerate(comfy), /没有输出 视频/)
  console.log('PASS: Token Plan LLM/TTS/all four video presets and native payloads, voices, reference limits, resume; vision preset and frame messages, GPT Image generation/edit parameters and sizes, Qwen 3.0 / Wan 2.7 text and reference images on standard and Token Plan endpoints, reference limits, legacy compatibility, video/TTS dispatch, polling/resume/failure/cancel, downloads, mixed Comfy outputs, native image portrait/landscape/square size injection with legacy maps.')
} finally {
  globalThis.fetch = nativeFetch
  globalThis.setTimeout = nativeTimeout
  delete globalThis.__tutorialConfig
}
