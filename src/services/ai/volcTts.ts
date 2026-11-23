import { fetchVolcTtsWeb, VOLC_PLAN_TTS_PATH } from './volcTtsWebTransport'
import { throwIfAborted } from './abort'
import { isVolcTtsModel, VOLC_TTS_VOICES } from './ttsVoices'

const ORIGIN = 'https://openspeech.bytedance.com'

export function isVolcTtsConfig(baseUrl: string, model: string): boolean {
  if (isVolcTtsModel(model)) return true
  try { return new URL(baseUrl).hostname === 'openspeech.bytedance.com' }
  catch { return false }
}

export function volcPlanTtsUrl(baseUrl: string): string {
  let url: URL
  try { url = new URL(baseUrl.trim()) }
  catch { throw new Error('[火山配音] 订阅接口地址无效') }
  const path = url.pathname.replace(/\/+$/, '')
  if (url.origin !== ORIGIN || url.username || url.password || url.search || url.hash ||
      !['', '/api/v3/plan', '/api/v3/plan/tts', VOLC_PLAN_TTS_PATH].includes(path)) {
    throw new Error('[火山配音] 请使用 Agent Plan 订阅地址 https://openspeech.bytedance.com/api/v3/plan/tts/unidirectional')
  }
  return ORIGIN + VOLC_PLAN_TTS_PATH
}

/** HTTP chunked JSON records contain ordered base64 audio and a final success code. */
export async function generateVolcSpeech(input: {
  baseUrl: string; apiKey: string; model: string; text: string; voice: string
  instruction?: string; signal?: AbortSignal
}): Promise<Blob> {
  throwIfAborted(input.signal)
  const url = volcPlanTtsUrl(input.baseUrl)
  if (!isVolcTtsModel(input.model)) throw new Error('[火山配音] 此订阅接入的模型请选择 seed-tts-2.0')
  if (!VOLC_TTS_VOICES.some(v => v.id === input.voice)) throw new Error('[火山配音] 请选择豆包语音 2.0 音色')
  const key = input.apiKey.trim().replace(/^Bearer\s+/i, '').trim()
  if (!key || /[^\x21-\x7e]/.test(key)) throw new Error('[火山配音] 请填写有效的 Agent Plan 专属 API Key')
  const requestId = crypto.randomUUID()
  let response: Response
  try {
    response = await fetchVolcTtsWeb(url, {
      method: 'POST', credentials: 'omit', signal: input.signal,
      headers: {
        'Content-Type': 'application/json', 'X-Api-Key': key,
        'X-Api-Resource-Id': 'seed-tts-2.0', 'X-Api-Request-Id': requestId
      },
      body: JSON.stringify({ req_params: {
        text: input.text, speaker: input.voice,
        audio_params: { format: 'mp3', sample_rate: 24000 },
        ...(input.instruction?.trim() ? { additions: JSON.stringify({ context_texts: [input.instruction.trim()] }) } : {})
      } })
    })
  } catch (error: any) {
    throwIfAborted(input.signal)
    throw new Error(`[火山配音] 合成请求未完成：${error?.message || error}。请先核对平台调用记录再重试。 (request_id=${requestId})`)
  }
  const logId = response.headers.get('x-tt-logid')
  const fail = (message: string) => new Error(`[火山配音] ${message} (${logId ? `logid=${logId}, ` : ''}request_id=${requestId})`)
  if (!response.ok) {
    const raw = await response.text()
    let detail = `HTTP ${response.status}`
    try {
      const data = JSON.parse(raw)
      detail += ` ${data.code || data.error?.code || ''}: ${data.message || data.error?.message || raw.slice(0, 200)}`
    } catch { detail += ` ${raw.slice(0, 200)}` }
    throw fail(detail)
  }
  if (!response.body) throw fail('合成接口没有返回音频流')
  const reader = response.body.getReader(), decoder = new TextDecoder()
  const audio: Uint8Array<ArrayBuffer>[] = []
  let pending = '', bytes = 0, finished = false
  const record = (line: string) => {
    const text = line.trim()
    if (!text) return
    let data: any
    try { data = JSON.parse(text) } catch { throw fail('合成接口返回了无效的分块 JSON') }
    if (!data || typeof data !== 'object' || !Number.isInteger(data.code)) throw fail('合成响应缺少状态码')
    if (data.code !== 0 && data.code !== 20000000) throw fail(`合成失败 ${data.code}: ${data.message || '平台拒绝请求'}`)
    if (data.data) {
      if (typeof data.data !== 'string') throw fail('音频片段格式无效')
      let binary: string
      try { binary = atob(data.data) } catch { throw fail('音频 Base64 格式无效') }
      bytes += binary.length
      if (bytes > 32 * 1024 * 1024) throw fail('返回音频超过32MiB限制')
      audio.push(Uint8Array.from(binary, c => c.charCodeAt(0)))
    }
    if (data.code === 20000000) finished = true
  }
  try {
    while (!finished) {
      throwIfAborted(input.signal)
      const { value, done } = await reader.read()
      pending += decoder.decode(value, { stream: !done })
      let newline: number
      while (!finished && (newline = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, newline); pending = pending.slice(newline + 1)
        record(line)
      }
      if (pending.length > 8 * 1024 * 1024) throw fail('单条合成响应超过8MiB限制')
      if (done) { if (!finished) record(pending); break }
    }
    throwIfAborted(input.signal)
    if (!finished) throw fail('音频流提前结束，未收到合成完成标记，请核对平台调用记录')
    if (!bytes) throw fail('平台返回了空音频')
    return new Blob(audio, { type: 'audio/mpeg' })
  } catch (error: any) {
    throwIfAborted(input.signal)
    if (error?.message?.startsWith('[火山配音]')) throw error
    throw fail(`音频流读取失败：${error?.message || error}`)
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
