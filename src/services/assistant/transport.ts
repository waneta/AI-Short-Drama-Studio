import { useProjectStore, useSettingsStore } from '@/stores'
import { controlledSignal } from '@/services/ai/abort'
import type { LLMRequest, LLMResponse } from '@/services/ai/client'
import { shallowRef } from 'vue'

export type ToolContent = { type: 'inputText'; text: string } | { type: 'inputImage'; imageUrl: string }
export interface BridgeToolResult { success: boolean; contentItems: ToolContent[] }
export interface CodexConnection { mode: 'existing' | 'chatgpt' | 'custom'; baseUrl: string; hasApiKey: boolean; keySource: 'stored' | 'env'; envKey: string; model: string; proxy: string; revision: string }
export interface CodexStatus { available: boolean; authenticated: boolean; authType: string; connection?: CodexConnection; native?: { provider: string; baseUrl: string; model: string; envKey: string; hasEnvironmentKey: boolean }; connectionIssue?: string; credentialVerified?: boolean; defaultModel?: string; configuredEffort?: string; models: { id: string; model: string; name: string; isDefault: boolean; defaultReasoningEffort?: string; supportedReasoningEfforts?: string[] }[] }
export const codexStatusState = shallowRef<CodexStatus>()
export const browserClientId = (() => {
  const key = 'juliu-codex-browser-id'
  try {
    const saved = localStorage.getItem(key)
    if (saved) return saved
    const id = crypto.randomUUID(); localStorage.setItem(key, id); return id
  } catch { return crypto.randomUUID() }
})()
const prefix = '/__juliu-codex'
const headers = { 'Content-Type': 'application/json', 'X-Juliu-Codex': '1' }
async function post(route: string, data: unknown, signal?: AbortSignal) {
  const response = await fetch(prefix + route, { method: 'POST', headers, body: JSON.stringify(data), signal })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body.error || `Codex 本机接口错误 ${response.status}`)
  }
  return response
}
export async function readCodexStatus(): Promise<CodexStatus> {
  const response = await fetch(prefix + '/status', { headers, signal: AbortSignal.timeout(40_000) })
  if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error || 'Codex 桥接未就绪，请重新启动剧流服务') }
  const value: CodexStatus = await response.json(); codexStatusState.value = value; return value
}
export async function readCodexConnection(): Promise<CodexConnection> {
  const response = await fetch(prefix + '/config', { headers, signal: AbortSignal.timeout(10_000) })
  if (!response.ok) throw new Error('无法读取 Codex 接入，请确认本机 Web 服务已更新')
  return response.json()
}
export async function readCliProvider(): Promise<{ provider: string; baseUrl: string; model: string; envKey: string; hasEnvironmentKey: boolean }> {
  const response = await fetch(prefix + '/cli-provider', { headers, signal: AbortSignal.timeout(40_000) })
  if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error || '读取本机 CLI 接入失败') }
  return response.json()
}
export async function saveCodexConnection(input: { mode: 'existing' | 'chatgpt' | 'custom'; baseUrl: string; model: string; proxy: string; apiKey?: string; clearApiKey?: boolean; keySource?: 'stored' | 'env'; envKey?: string }): Promise<CodexConnection> {
  const response = await post('/config', input, AbortSignal.timeout(10_000))
  codexStatusState.value = undefined
  return response.json()
}
export interface DeviceLogin { id: string; token: string; verificationUrl: string; userCode: string; state: string }
export async function startCodexDeviceLogin(): Promise<DeviceLogin> {
  return (await post('/login/start', {}, AbortSignal.timeout(70_000))).json()
}
export async function pollCodexDeviceLogin(login: DeviceLogin): Promise<{ state: string; error?: string }> {
  return (await post('/login/poll', { id: login.id, token: login.token }, AbortSignal.timeout(10_000))).json()
}
export async function cancelCodexDeviceLogin(login: DeviceLogin) {
  return post('/login/cancel', { id: login.id, token: login.token }, AbortSignal.timeout(10_000))
}
export async function runCodexBridge(input: {
  kind: 'agent' | 'text'; prompt: string; model?: string; effort?: string; projectId: string; conversationId: string; jsonMode?: boolean
}, options: { signal?: AbortSignal; onProgress?: (label: string) => void; onTool?: (tool: string, args: any) => Promise<BridgeToolResult> } = {}) {
  let identity: { runId: string; token: string } | undefined
  let finished = false
  const cancel = () => { if (identity && !finished) void post('/cancel', identity).catch(() => undefined) }
  options.signal?.throwIfAborted()
  options.signal?.addEventListener('abort', cancel, { once: true })
  let reply = '', model = input.model || 'codex-default'
  try {
    const response = await post('/run', { ...input, clientId: browserClientId }, options.signal)
    if (!response.body) throw new Error('Codex 服务没有返回执行流')
    const reader = response.body.getReader(), decoder = new TextDecoder()
    let buffer = ''
    const handle = async (event: any) => {
      options.signal?.throwIfAborted()
      if (event.type === 'started') identity = { runId: event.runId, token: event.token }
      if (event.type === 'progress') options.onProgress?.(event.message)
      if (event.type === 'tool') {
        if (!identity || !options.onTool) throw new Error('当前任务未开放工具调用')
        let result: BridgeToolResult
        try { result = await options.onTool(event.tool, event.arguments) }
        catch (error: any) {
          options.signal?.throwIfAborted()
          result = { success: false, contentItems: [{ type: 'inputText', text: error.message || String(error) }] }
        }
        options.signal?.throwIfAborted()
        await post('/tool-result', { ...identity, callId: event.callId, ...result }, options.signal)
      }
      if (event.type === 'done') { finished = true; reply = event.text || ''; model = event.model || model }
      if (event.type === 'error') throw new Error(event.message || 'Codex 任务失败')
    }
    while (true) {
      const { done, value } = await reader.read()
      buffer += decoder.decode(value, { stream: !done })
      if (buffer.length > 16_000_000) throw new Error('Codex 返回内容过长')
      let end: number
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1)
        if (line.trim()) await handle(JSON.parse(line))
      }
      if (done) break
    }
    if (buffer.trim()) await handle(JSON.parse(buffer))
    if (!finished) throw new Error('Codex 连接中断；请检查已完成步骤后再继续，不会自动重放操作')
    return { content: reply, model }
  } finally {
    cancel(); options.signal?.removeEventListener('abort', cancel)
  }
}

/** Text buttons and legacy pipeline tools run isolated Codex turns, never recurse into the agent turn. */
export async function callCodexText(req: LLMRequest): Promise<LLMResponse> {
  const settings = useSettingsStore(), project = useProjectStore()
  const control = controlledSignal(req.signal, req.timeoutMs ?? 240_000)
  if (req.signal?.aborted) { control.cleanup(); req.signal.throwIfAborted() }
  try {
    const messages = req.messages.map(message => {
      if (typeof message.content !== 'string') throw new Error('多模态请求请使用视觉接入；Codex 文本任务不丢弃图片后继续执行')
      return { role: message.role, content: message.content }
    })
    const prompt = `这是一个独立的剧流文本子任务。只完成下面 messages 中的要求，直接返回最终正文；不调用工具、不修改文件。保留对白、@参考图编号和指定结构。${req.jsonMode ? '只输出有效 JSON，不要 Markdown 围栏。' : ''}\n\n${JSON.stringify(messages)}`
    return await runCodexBridge({ kind: 'text', prompt, model: settings.config.codexModel || undefined, effort: settings.config.codexEffort || undefined,
      projectId: project.current?.id || 'text-only', conversationId: crypto.randomUUID(), jsonMode: req.jsonMode }, { signal: control.signal })
  } finally { control.cleanup() }
}
