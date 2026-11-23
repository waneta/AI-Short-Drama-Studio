/** Native DashScope media protocols used by the Ubuntu cloud tutorial. */
import { isWan3VideoModel, normalizeWan3VideoResolution, wan3VideoRatio } from './wan3VideoSettings'
import { wan27ImageSizeIssue } from './wan27ImageSize'
import { providerHttp } from './adapters'
import { abortableDelay, throwIfAborted } from './abort'
import { dashscopeReferenceMaxBytes, prepareDashscopeReferenceImage } from './dashscopeReferenceImage'

type Endpoint = { baseUrl: string; apiKey: string; provider?: string }

export function isDashScopeEndpoint(ep: { baseUrl?: string; provider?: string }): boolean {
  if (ep.provider === 'dashscope') return true
  try {
    const host = new URL(ep.baseUrl || '').hostname
    return /^dashscope(?:-intl|-us)?\.aliyuncs\.com$/i.test(host) || host.endsWith('.maas.aliyuncs.com')
  } catch { return false }
}

export function isWan3VideoProfile(profile?: { workflowId?: string; provider?: string; baseUrl?: string; adapter?: { type?: string } }) {
  return !!profile && isDashScopeEndpoint(profile) && !profile.adapter?.type && isWan3VideoModel(profile.workflowId)
}

function apiRoot(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '').replace(/\/compatible-mode\/v1$/i, '/api/v1').replace(/\/api\/v1$/i, '') + '/api/v1'
}

async function jsonRequest(ep: Endpoint, path: string, body?: unknown, signal?: AbortSignal, asyncTask = false) {
  if (!ep.apiKey.trim()) throw new Error('[百炼] 当前接入没有 API Key，请在对应的生图或视频设置中填写')
  const res = await providerHttp(apiRoot(ep.baseUrl) + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${ep.apiKey.trim()}`, 'Content-Type': 'application/json', ...(asyncTask ? { 'X-DashScope-Async': 'enable' } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal, timeoutMs: 180_000
  })
  let data: any
  try { data = await res.json() } catch { throw new Error(`[百炼] 接口返回非 JSON，HTTP ${res.status}`) }
  if (!res.ok || data.code) throw new Error(`[百炼] ${data.code || res.status}: ${data.message || '请求失败'}${data.request_id ? ` (request_id=${data.request_id})` : ''}`)
  return data
}

async function dataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768))
  return `data:${blob.type || 'image/png'};base64,${btoa(binary)}`
}

async function download(url: string, kind: 'image' | 'video', signal?: AbortSignal) {
  if (!/^https?:\/\//i.test(url)) throw new Error('[百炼] 响应缺少有效的媒体下载地址')
  // Signed result URLs do not need the API credential.
  const res = await providerHttp(url, { signal, timeoutMs: 180_000 })
  if (!res.ok) throw new Error(`[百炼] 下载失败 ${res.status}`)
  const blob = await res.blob()
  if (!blob.size) throw new Error('[百炼] 下载结果为空')
  if (blob.type && blob.type !== 'application/octet-stream' && !blob.type.startsWith(kind + '/')) {
    throw new Error(`[百炼] 预期 ${kind}，实际收到 ${blob.type}`)
  }
  const mimeType = blob.type && blob.type !== 'application/octet-stream' ? blob.type : kind === 'video' ? 'video/mp4' : 'image/png'
  return { blob: blob.type === mimeType ? blob : new Blob([blob], { type: mimeType }), mimeType }
}

export async function dashscopeImage(ep: Endpoint & { model: string }, input: {
  prompt: string; width: number; height: number; aspectRatio?: string; referenceImages?: Blob[]; signal?: AbortSignal
}, onProgress?: (message: string) => void) {
  const refs = input.referenceImages || []
  const sizeIssue = wan27ImageSizeIssue(ep.model, input.width, input.height, refs.length)
  if (sizeIssue) throw new Error(sizeIssue)
  const qwen3 = /^qwen-image-3\.0(?:-pro)?(?:-\d{4}-\d{2}-\d{2})?$/.test(ep.model)
  const wan27 = /^wan2\.7-image(?:-pro)?$/.test(ep.model)
  const flexible = qwen3 || wan27 || /^qwen-image-2\.0(?:-pro)?(?:-\d{4}-\d{2}-\d{2})?$/.test(ep.model)
  const edit = /^qwen-image-edit(?:-plus|-max)?(?:-\d{4}-\d{2}-\d{2})?$/.test(ep.model)
  const textOnly = /^qwen-image(?:-plus|-max)?(?:-\d{4}-\d{2}-\d{2})?$/.test(ep.model)
  if (!flexible && !edit && !textOnly) throw new Error('[百炼] 当前适配支持 qwen-image-3.0、wan2.7-image、qwen-image-2.0、qwen-image-plus/max 和 qwen-image-edit 系列（含对应 pro 型号）')
  if (refs.length && textOnly) throw new Error('[百炼] 当前模型只支持文生图；有参考图时请选择 qwen-image-2.0 或 qwen-image-edit-plus')
  if (!refs.length && edit) throw new Error('[百炼] 图像编辑模型需要参考图')
  const maxRefs = wan27 ? 9 : ep.model === 'qwen-image-edit' ? 1 : 3
  if (refs.length > maxRefs) throw new Error(`[百炼] ${ep.model} 最多支持 ${maxRefs} 张参考图，当前提供 ${refs.length} 张`)
  const sizes: Record<string, string> = { '16:9': '1664*928', '9:16': '928*1664', '1:1': '1328*1328', '4:3': '1472*1104' }
  const size = flexible ? `${input.width}*${input.height}` : sizes[input.aspectRatio || '16:9'] || '1664*928'
  const content: Array<{ image: string } | { text: string }> = []
  for (const [index, ref] of refs.entries()) {
    const prepared = await prepareDashscopeReferenceImage(ref, index + 1, input.signal, onProgress, dashscopeReferenceMaxBytes(ep.model))
    content.push({ image: await dataUrl(prepared) })
  }
  throwIfAborted(input.signal)
  content.push({ text: input.prompt })
  const data = await jsonRequest(ep, '/services/aigc/multimodal-generation/generation', {
    model: ep.model, input: { messages: [{ role: 'user', content }] },
    parameters: { n: 1, ...(ep.model === 'qwen-image-edit' ? {} : { size }), watermark: false, ...(wan27 ? {} : { prompt_extend: false }) }
  }, input.signal)
  const url = data.output?.choices?.[0]?.message?.content?.find((item: any) => item.image)?.image
  return { ...await download(String(url || ''), 'image', input.signal), prompt: input.prompt }
}

export async function dashscopeVideo(ep: Endpoint & { workflowId: string }, input: {
  prompt: string; imageBlob?: Blob; lastFrameBlob?: Blob; referenceImages?: Blob[]; aspectRatio?: string; duration: number; signal?: AbortSignal;
  videoResolution?: import('@/types').VideoResolution; videoAspectAuto?: boolean;
  videoGenerationMode?: import('@/types').VideoGenerationMode; h3GenMode?: 'reference' | 'fl2va';
  resumeTaskId?: string; onTaskSubmitted?: (id: string) => void | Promise<void>
}, onProgress?: (message: string) => void) {
  const model = ep.workflowId
  const legacy = /^wan2\.6-(?:i2v(?:-flash)?|t2v)$/.test(model)
  const wan3 = isWan3VideoModel(model)
  const happy = /^happyhorse-1\.1-(?:i2v|t2v|r2v)$/.test(model)
  if (!legacy && !wan3 && !happy) throw new Error('[百炼] 当前原生适配支持万相 2.6、wan3.0-video 和 HappyHorse 1.1 系列')
  if (legacy && ![5, 10, 15].includes(input.duration)) throw new Error('[百炼] 此接入使用 5、10 或 15 秒镜头，请先调整时长')
  if (!legacy && (!Number.isInteger(input.duration) || input.duration < (wan3 ? 2 : 3) || input.duration > (wan3 ? 30 : 15))) throw new Error(`[百炼] ${model} 时长须为 ${wan3 ? '2–30' : '3–15'} 秒整数`)
  throwIfAborted(input.signal)
  let id = input.resumeTaskId
  if (!id) {
    const firstLast = input.videoGenerationMode === 'first-last' || input.h3GenMode === 'fl2va'
    if (firstLast) {
      if (!wan3) throw new Error('[百炼] 当前模型不支持首尾帧，请切换到 Wan 3.0')
      if (!input.imageBlob || !input.lastFrameBlob) throw new Error('[百炼] 首尾帧模式需要首帧和尾帧各一张图')
      if (input.referenceImages?.length) throw new Error('[百炼] 首尾帧模式不能同时提交其他参考图，请切换图片参考模式或移除额外参考图')
    } else if (input.lastFrameBlob) {
      throw new Error('[百炼] 尾帧图片需要选择首尾帧模式，不能作为普通参考图提交')
    }
    const i2v = model.includes('i2v')
    const r2v = model.endsWith('-r2v')
    if (i2v && !input.imageBlob) throw new Error('[百炼] 图生视频需要一张分镜首帧')
    const refs = [input.imageBlob, ...(input.referenceImages || [])].filter((b): b is Blob => !!b)
    if (r2v && !refs.length) throw new Error('[百炼] 参考生视频需要至少一张参考图')
    if ((r2v || wan3) && refs.length > (wan3 ? 10 : 9)) throw new Error(`[百炼] ${model} 参考图过多，最多 ${wan3 ? 10 : 9} 张`)
    const ratio = input.aspectRatio && input.aspectRatio !== 'auto' ? input.aspectRatio : '16:9'
    const requestInput: Record<string, unknown> = { prompt: input.prompt }
    const parameters: Record<string, unknown> = { duration: input.duration, watermark: false }
    if (legacy) {
      if (i2v) requestInput.img_url = await dataUrl(input.imageBlob!)
      Object.assign(parameters, i2v ? { resolution: '720P' } : { size: '1280*720' }, { prompt_extend: false }, model.endsWith('-flash') ? { audio: false } : {})
    } else {
      const media = firstLast ? [input.imageBlob!, input.lastFrameBlob!] : wan3 ? refs : r2v ? refs : i2v ? [input.imageBlob!] : []
      if (media.length) requestInput.media = await Promise.all(media.map(async (blob, index) => ({
        type: firstLast ? index === 0 ? 'first_frame' : 'last_frame'
          : r2v || (wan3 && (input.videoGenerationMode === 'reference' || media.length > 1 || !input.imageBlob)) ? 'reference_image' : 'first_frame',
        url: await dataUrl(blob)
      })))
      Object.assign(parameters, { resolution: wan3 ? normalizeWan3VideoResolution(input.videoResolution).toUpperCase() : '720P' }, i2v ? {} : { ratio: wan3 ? wan3VideoRatio(input.videoAspectAuto ? 'adaptive' : input.aspectRatio ?? (input.videoGenerationMode !== 'reference' && (firstLast || media.length === 1) && input.imageBlob ? 'adaptive' : undefined)) : ratio }, wan3 ? { prompt_extend: false } : {})
    }
    const data = await jsonRequest(ep, '/services/aigc/video-generation/video-synthesis', {
      model, input: requestInput, parameters
    }, input.signal, true)
    id = String(data.output?.task_id || '')
    if (!id) throw new Error('[百炼] 提交响应缺少 task_id')
    await input.onTaskSubmitted?.(id)
  }
  onProgress?.(`百炼任务 ${id}：等待生成`)
  const deadline = Date.now() + 15 * 60_000
  while (Date.now() < deadline) {
    await abortableDelay(3000, input.signal)
    const data = await jsonRequest(ep, `/tasks/${encodeURIComponent(id)}`, undefined, input.signal)
    const output = data.output || {}
    if (output.task_status === 'SUCCEEDED') return { ...await download(String(output.video_url || ''), 'video', input.signal), prompt: input.prompt, duration: input.duration }
    if (['FAILED', 'CANCELED', 'UNKNOWN'].includes(output.task_status)) throw new Error(`[百炼] ${output.task_status}: ${output.message || '任务失败'} (task_id=${id})`)
    onProgress?.(`百炼 ${output.task_status || '等待结果'} (task_id=${id})`)
  }
  throw new Error(`[百炼] 查询超时，请保留 task_id=${id} 查询结果，勿重复提交`)
}
