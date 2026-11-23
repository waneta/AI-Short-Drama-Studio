import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
const base = (process.env.JULIU_TEST_URL || 'http://127.0.0.1:5178') + '/__juliu-codex'
const headers = { 'X-Juliu-Codex': '1', 'Content-Type': 'application/json' }
const file = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'config.toml')
const digest = async () => createHash('sha256').update(await fs.readFile(file)).digest('hex')
const before = await digest(), checks = [], pass = name => { checks.push({ name, passed: true }); console.log(name) }
const request = async (route, input) => {
  const response = await fetch(base + route, { headers, ...(input ? { method: 'POST', body: JSON.stringify(input) } : {}), signal: AbortSignal.timeout(45_000) })
  const result = await response.json(); assert(response.ok, result.error); return result
}
await request('/config', { mode: 'existing', baseUrl: '', model: '', proxy: 'http://127.0.0.1:7897', keySource: 'env', envKey: 'OPENAI_API_KEY' })
const status = await request('/status')
assert.equal(status.authType, 'existing'); assert.equal(status.native.provider, 'cliproxyapi'); assert.equal(status.native.baseUrl, 'http://192.168.18.216:8310/v1'); assert.equal(status.native.model, 'gpt-6-astra')
pass('真实CLI原生读取公司预设，不强制改成OpenAI账号')
assert.equal(status.authenticated, false); assert.equal(status.native.hasEnvironmentKey, false); assert(status.connectionIssue.includes('OPENAI_API_KEY'))
pass('真实主机准确提示当前服务未取得预设环境凭证')
const result = await fetch(base + '/run', { method: 'POST', headers, body: JSON.stringify({ kind: 'text', clientId: 'native-probe', projectId: 'isolated', conversationId: 'isolated', prompt: '连接检查；缺凭证时必须在提交模型前停止' }), signal: AbortSignal.timeout(45_000) })
const text = await result.text(); assert(text.includes('补充当前预设的凭证')); assert(!text.includes('"type":"done"'))
pass('真实执行在缺凭证时停止，不错误回退到已有ChatGPT账号')
assert.equal(await digest(), before); pass('用户全局Codex配置文件保持原值')
const out = process.env.JULIU_TEST_OUT || '/tmp/juliu-codex-existing-tests'
await fs.mkdir(out, { recursive: true }); await fs.writeFile(path.join(out, 'real-validation.json'), JSON.stringify({ checks, realCli: true, realModelInference: false, userGlobalConfigurationModified: false, userProjectsModified: false }, null, 2))
