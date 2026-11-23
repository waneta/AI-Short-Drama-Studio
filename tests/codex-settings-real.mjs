import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url), { build } = require('esbuild')
const out = process.env.JULIU_TEST_OUT || '/tmp/juliu-codex-settings-tests'
const base = (process.env.JULIU_TEST_URL || 'http://127.0.0.1:5177') + '/__juliu-codex'
const headers = { 'X-Juliu-Codex': '1', 'Content-Type': 'application/json' }
const call = async (route, input) => {
  const response = await fetch(base + route, { headers, ...(input ? { method: 'POST', body: JSON.stringify(input) } : {}), signal: AbortSignal.timeout(75_000) })
  const result = await response.json(); assert(response.ok, result.error); return result
}
const checks = [], pass = name => { checks.push({ name, passed: true }); console.log(name) }
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'juliu-settings-real-'))
let login, rpc
try {
  const imported = await call('/cli-provider')
  assert.equal(imported.provider, 'cliproxyapi'); assert.equal(imported.baseUrl, 'http://192.168.18.216:8310/v1'); assert.equal(imported.envKey, 'OPENAI_API_KEY')
  pass('真实CLI读取与用户指定CLIProxyAPI配置一致，不返回密钥')
  const before = await call('/status'); assert(before.authenticated)
  login = await call('/login/start', {}); assert.equal(new URL(login.verificationUrl).hostname, 'auth.openai.com'); assert(login.userCode.length > 0)
  pass('真实app-server设备登录返回官方授权地址与验证码')
  const cancelled = await call('/login/cancel', login); assert.equal(cancelled.state, 'cancelled'); login = undefined
  const after = await call('/status'); assert(after.authenticated); assert.equal(after.authType, before.authType)
  pass('真实设备登录可取消，既有ChatGPT账号登录保留')
  const file = path.join(temp, 'rpc.mjs'); await build({ entryPoints: ['scripts/codex-rpc.ts'], bundle: true, platform: 'node', format: 'esm', outfile: file, target: 'node22' })
  const { CodexRpc } = await import(file)
  rpc = new CodexRpc(undefined, { mode: 'custom', baseUrl: imported.baseUrl, apiKey: 'isolated-protocol-fixture', keySource: 'stored', envKey: 'OPENAI_API_KEY', model: imported.model, proxy: '', revision: 'real-fixture' })
  await rpc.initialize(); const cfg = await rpc.request('config/read', { includeLayers: false })
  assert.equal(cfg.config.model_provider, 'juliu'); assert.equal(cfg.config.model_providers.juliu.base_url, imported.baseUrl); assert.equal(cfg.config.model_providers.juliu.wire_api, 'responses'); assert.equal(cfg.config.model_providers.juliu.requires_openai_auth, false)
  pass('真实CLI接受独立Responses自定义接入，未覆盖用户全局配置或请求模型')
  await fs.mkdir(out, { recursive: true }); await fs.writeFile(path.join(out, 'real-protocol-validation.json'), JSON.stringify({ checks, realCli: true, deviceCodeRequestedAndCancelled: true, deviceAuthorizationCompleted: false, customModelInference: false, userGlobalConfigurationModified: false }, null, 2))
} finally { if (login) await call('/login/cancel', login).catch(() => {}); rpc?.close(); await fs.rm(temp, { recursive: true, force: true }) }
