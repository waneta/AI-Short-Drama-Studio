import { existsSync, readFileSync, mkdirSync, writeFileSync, renameSync, chmodSync } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

export interface CodexConnection {
  mode: 'existing' | 'chatgpt' | 'custom'
  baseUrl: string
  apiKey: string
  keySource: 'stored' | 'env'
  envKey: string
  model: string
  proxy: string
  revision: string
}
export function connectionFile() {
  return process.env.JULIU_CODEX_CONFIG_FILE || path.join(process.cwd(), '.cache/juliu-codex-private/connection.json')
}
export function readConnection(): CodexConnection {
  const defaults: CodexConnection = { mode: 'chatgpt', baseUrl: '', apiKey: '', keySource: 'stored', envKey: 'OPENAI_API_KEY', model: '', proxy: process.env.JULIU_CODEX_PROXY || '', revision: 'initial' }
  return existsSync(connectionFile()) ? { ...defaults, ...JSON.parse(readFileSync(connectionFile(), 'utf8')) } : defaults
}
export function effectiveKey(value: CodexConnection) { return value.keySource === 'env' ? process.env[value.envKey] || '' : value.apiKey }
function address(value: unknown, label: string, empty = false) {
  if (typeof value !== 'string' || value.length > 2048) throw new Error(`${label}格式无效`)
  const text = value.trim()
  if (empty && !text) return ''
  let url: URL
  try { url = new URL(text) } catch { throw new Error(`${label}必须是完整的 HTTP(S) 地址`) }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || /[\r\n]/.test(text)) throw new Error(`${label}仅支持无账号、无查询参数的 HTTP(S) 地址`)
  if (label === '网络代理' && url.pathname !== '/') throw new Error('网络代理地址不能带路径')
  return text.replace(/\/+$/, '')
}
export function saveConnection(input: any) {
  const old = readConnection()
  if (!['existing', 'chatgpt', 'custom'].includes(input.mode)) throw new Error('请选择本机已有配置、ChatGPT 设备登录或自定义接口')
  if (typeof input.apiKey !== 'undefined' && (typeof input.apiKey !== 'string' || input.apiKey.length > 8192 || /[\r\n\0]/.test(input.apiKey))) throw new Error('API Key 格式无效')
  if (typeof input.model !== 'string' || input.model.length > 200 || /[\r\n\0]/.test(input.model)) throw new Error('模型名格式无效')
  if (!['stored', 'env'].includes(input.keySource || 'stored') || typeof (input.envKey || 'OPENAI_API_KEY') !== 'string' || !/^[A-Za-z_][A-Za-z_0-9]{0,99}$/.test(input.envKey || 'OPENAI_API_KEY')) throw new Error('凭证来源或环境变量名无效')
  const next: CodexConnection = { mode: input.mode, baseUrl: address(input.baseUrl, '接口地址', input.mode !== 'custom'),
    apiKey: input.clearApiKey ? '' : input.apiKey?.trim() || old.apiKey,
    keySource: input.keySource || 'stored', envKey: input.envKey || 'OPENAI_API_KEY',
    model: input.model.trim(), proxy: address(input.proxy, '网络代理', true), revision: randomUUID() }
  if (next.mode === 'custom' && !next.model) throw new Error('自定义接口需要模型名')
  if (next.mode === 'custom' && !effectiveKey(next)) throw new Error(next.keySource === 'env' ? `Web 服务未取得环境变量 ${next.envKey}，请改为在此填写 API Key，或设置服务环境后重启` : '自定义接口需要 API Key')
  const file = connectionFile(), dir = path.dirname(file)
  mkdirSync(dir, { recursive: true, mode: 0o700 }); chmodSync(dir, 0o700)
  const temp = path.join(dir, `${randomUUID()}.tmp`)
  writeFileSync(temp, JSON.stringify(next), { mode: 0o600 }); renameSync(temp, file); chmodSync(file, 0o600)
  return publicConnection(next)
}
export function publicConnection(value = readConnection()) {
  const { apiKey, ...safe } = value
  return { ...safe, hasApiKey: Boolean(effectiveKey(value)) }
}
