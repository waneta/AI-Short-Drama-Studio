import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const app = path.resolve(here, '..')
const require = createRequire(path.join(app, 'package.json'))
const { build } = require('esbuild')
const fixture = { baseUrl: 'https://fixture.invalid/v1', model: '', desktop: false }
globalThis.__llmParameterFixture = fixture
const mocks = {
  stores: `export const useSettingsStore=()=>({config:{assistantEngine:'api'}});export const useProjectStore=()=>({current:null});`,
  runtime: `const f=globalThis.__llmParameterFixture;export const getAIMode=()=>'real',getLlmConfig=()=>({baseUrl:f.baseUrl,model:f.model,apiKey:'synthetic-key'}),getVisionConfig=()=>({baseUrl:f.baseUrl,model:f.model,apiKey:'synthetic-key'});`,
  desktop: `const f=globalThis.__llmParameterFixture;export const isDesktop=()=>f.desktop,desktop=()=>({llmFetch:args=>f.desktopFetch(args)});`,
  mock: `export const mockLLM=()=>{throw Error('Mock AI mode must not be used')};`,
  speech: `export const extractSpokenFromNotes=()=>[];`
}
const result = await build({ stdin: { contents: `export {callLLM} from './services/ai/client';export {optimizeImagePrompt} from './services/ai/promptAssistance';`, resolveDir: path.join(app, 'src'), loader: 'ts' },
  bundle: true, write: false, platform: 'node', format: 'cjs', 
  define: { 'import.meta.env.VITE_TOKEN_PLAN_WEB_PROXY': '"false"' },
  plugins: [{ name: 'transport-fixture', setup(b) {
    b.onResolve({ filter: /^\.\/runtime$/ }, args => args.importer.endsWith('/services/ai/client.ts') ? { path: 'runtime', namespace: 'fixture' } : undefined)
    b.onResolve({ filter: /^\.\/mock$/ }, args => args.importer.endsWith('/services/ai/client.ts') ? { path: 'mock', namespace: 'fixture' } : undefined)
    b.onResolve({ filter: /^\.\/h3Prompt$/ }, args => args.importer.endsWith('/services/ai/promptAssistance.ts') ? { path: 'speech', namespace: 'fixture' } : undefined)
    b.onResolve({ filter: /\/services\/desktop$/ }, () => ({ path: 'desktop', namespace: 'fixture' }))
    b.onResolve({ filter: /^@\/stores$/ }, () => ({path:'stores',namespace:'fixture'}))
    b.onResolve({filter:/^@\//},args=>({path:path.join(app,'src',args.path.slice(2)+'.ts')}))
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: mocks[args.path], loader: 'js' }))
  } }], logLevel: 'silent'
})
const module = { exports: {} }
new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, module, module.exports)
const { callLLM, optimizeImagePrompt } = module.exports
let handler, calls = []
const originalFetch = globalThis.fetch
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const success = content => json({ model: fixture.model, choices: [{ message: { content } }], usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 } })
const unsupported = (param, alternative) => json({ error: { message: `Unsupported parameter: '${param}' is not supported with this model. Use '${alternative}' instead.`, type: 'invalid_request_error', param, code: 'unsupported_parameter' } }, 400)
const temperatureError = () => json({ error: { message: "Unsupported value: 'temperature' does not support 0.2 with this model. Only the default (1) value is supported.", type: 'invalid_request_error', param: 'temperature', code: 'unsupported_value' } }, 400)
globalThis.fetch = async (url, init) => {
  assert(String(url).startsWith(fixture.baseUrl), 'No real external requests allowed')
  const body = JSON.parse(init.body); calls.push(body)
  return handler(body, init)
}
fixture.desktopFetch = async args => {
  const body = JSON.parse(args.body); calls.push(body)
  const response = await handler(body, {})
  return { ok: response.ok, status: response.status, text: await response.text() }
}
const request = overrides => ({ messages: [{ role: 'user', content: '整理提示词' }], maxTokens: 8192, temperature: 0.2, ...overrides })
const modernHandler = content => body => body.max_tokens !== undefined ? unsupported('max_tokens', 'max_completion_tokens') : body.temperature !== undefined ? temperatureError() : success(content)
const checks = []
try {
  for (const model of ['gpt-4.1', 'gpt-4o', 'gpt-4o-mini']) {
    fixture.model = model; calls = []; handler = body => {
      assert.equal(body.max_tokens, 8192); assert.equal(body.max_completion_tokens, undefined); assert.equal(body.temperature, 0.2)
      return success('旧模型成功')
    }
    const response = await callLLM(request())
    assert.equal(response.content, '旧模型成功'); assert.equal(calls.length, 1); assert.equal(response.usage.totalTokens, 7)
  }
  checks.push('The three screenshot legacy models retain max_tokens, custom temperature, usage and one-request behavior')
  for (const model of ['gpt-6.1-terra', 'gpt-6.1-sol', 'gpt-6-luna', 'gpt-5.6-terra', 'gpt-5.4-mini']) {
    fixture.model = model; calls = []; handler = modernHandler('新模型成功')
    assert.equal((await callLLM(request())).content, '新模型成功')
    assert.equal(calls.length, 3)
    assert.deepEqual(calls.map(b => [b.max_tokens, b.max_completion_tokens, b.temperature]), [[8192, undefined, 0.2], [undefined, 8192, 0.2], [undefined, 8192, undefined]])
    calls = []; await callLLM(request({ maxTokens: 3200 }))
    assert.equal(calls.length, 1); assert.equal(calls[0].max_completion_tokens, 3200); assert.equal(calls[0].temperature, undefined)
  }
  checks.push('All five screenshot modern model names negotiate token and temperature errors and reuse per-model endpoint compatibility on subsequent calls')
  fixture.model = 'custom-alias'; calls = []; handler = body => body.max_tokens !== undefined ? unsupported('max_tokens', 'max_completion_tokens') : success('alias works')
  await callLLM(request()); assert.equal(calls.length, 2); assert.equal(calls[1].temperature, 0.2)
  checks.push('Unknown model aliases adapt by actual error without hardcoded family names or unnecessarily removing supported temperature')
  fixture.model = 'image-optimize-modern'; calls = []
  const source = '莫邪在左，干将在右。场景 @1，人物 @2。武器长2.1米。'
  const optimized = '【构图】莫邪在左，干将在右。\n【参考】场景 @1，人物 @2。\n【道具】武器长2.1米。'
  handler = modernHandler(optimized)
  assert.equal(await optimizeImagePrompt(source, { model: 'wan2.7-image-pro', aspectRatio: '16:9', references: [{ number: 1, label: '场景' }, { number: 2, label: '人物' }] }), optimized)
  assert.equal(calls.length, 3)
  assert.equal(JSON.parse(calls.at(-1).messages[1].content).source, source)
  checks.push('Actual image optimization service completes through actual callLLM after modern parameter negotiation, preserving source references and numeric constraints')
  fixture.model = 'json-repair-modern'; calls = []
  handler = body => {
    if (body.max_tokens !== undefined) return unsupported('max_tokens', 'max_completion_tokens')
    if (body.temperature !== undefined) return temperatureError()
    return success(body.messages.at(-1).content.includes('上一次只写') ? '{"ok":true}' : 'not JSON')
  }
  assert.equal((await callLLM(request({ jsonMode: true }))).content, '{"ok":true}')
  assert.equal(calls.length, 4)
  assert.equal(calls.at(-1).max_completion_tokens, 12000)
  assert.equal(calls.at(-1).max_tokens, undefined); assert.equal(calls.at(-1).temperature, undefined)
  checks.push('Video-style JSON output repair retains negotiated max_completion_tokens and omits rejected temperature in its follow-up request')
  fixture.model = 'json-format-modern'; calls = []
  handler = body => body.max_tokens !== undefined ? unsupported('max_tokens', 'max_completion_tokens')
    : body.response_format ? json({ error: { param: 'response_format', message: 'response_format json_object unsupported' } }, 400) : success('{"ok":true}')
  assert.equal((await callLLM(request({ jsonMode: true }))).content, '{"ok":true}')
  assert.equal(calls.at(-1).max_tokens, undefined); assert.equal(calls.at(-1).max_completion_tokens, 8192)
  assert.equal(calls.at(-1).response_format, undefined)
  checks.push('Existing response_format fallback composes with token compatibility instead of resetting rejected parameters')
  fixture.model = 'vision-modern'; calls = []; handler = modernHandler('看图成功')
  await callLLM(request({ provider: 'vision', maxTokens: undefined, messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,YQ==' } }] }] }))
  assert.equal(calls.at(-1).max_completion_tokens, 8192)
  assert.equal(calls.at(-1).messages[0].content[0].type, 'image_url')
  fixture.model = 'desktop-modern'; fixture.desktop = true; calls = []; handler = modernHandler('桌面成功')
  assert.equal((await callLLM(request())).content, '桌面成功'); assert.equal(calls.length, 3); fixture.desktop = false
  checks.push('Browser vision requests and desktop llmFetch transport both use the shared compatibility logic')
  for (const [status, message] of [[401, 'invalid API key'], [403, 'forbidden'], [400, 'max_tokens exceeds available quota'], [400, 'unsupported response_format']]) {
    fixture.model = `reject-${status}-${checks.length}-${message}`; calls = []
    handler = () => json({ error: { param: 'max_tokens', message } }, status)
    await assert.rejects(callLLM(request()), new RegExp(String(status))); assert.equal(calls.length, 1)
  }
  checks.push('Authentication, permissions, quota and unrelated validation errors are not retried as parameter incompatibility')
  fixture.model = 'flip-flop'; calls = []
  handler = body => body.max_tokens !== undefined ? unsupported('max_tokens', 'max_completion_tokens') : unsupported('max_completion_tokens', 'max_tokens')
  await assert.rejects(callLLM(request()), /400/); assert.equal(calls.length, 2)
  checks.push('Inconsistent endpoint requirements stop after one token-field switch without a retry loop')
  fixture.model = 'cancel-modern'; calls = []; const controller = new AbortController()
  handler = () => { controller.abort(); return unsupported('max_tokens', 'max_completion_tokens') }
  await assert.rejects(callLLM(request({ signal: controller.signal })), e => e.name === 'AbortError'); assert.equal(calls.length, 1)
  checks.push('Cancellation stops before any compatibility retry')
  fixture.model = 'gpt-6.1-sol'; fixture.baseUrl = 'https://other-fixture.invalid/v1'; calls = []
  handler = body => { assert.equal(body.max_tokens, 8192); return success('different endpoint') }
  await callLLM(request()); assert.equal(calls.length, 1)
  checks.push('Learned parameters are scoped by endpoint and model and do not leak into other providers')
  await fs.writeFile(path.join(here, 'validation.json'), JSON.stringify({ status: 'passed', checks, checked_at: new Date().toISOString(), actualClient: true, actualImageOptimizer: true, realHTTP: false, realLLM: false, scope: 'Real production client and image service; controlled HTTP/desktop responses, synthetic credentials, no user project writes.' }, null, 2) + '\n')
  console.log(`${checks.length} checks passed`)
} finally { globalThis.fetch = originalFetch }
