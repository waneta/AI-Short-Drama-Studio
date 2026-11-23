import type { AspectRatio } from '@/types'
import { comfyImageWorkflowModel } from './comfyImageWorkflow'
import { isDashScopeEndpoint } from './dashscopeMedia'
import { isRelayImageEndpoint } from './apimart'
import { isSeedream5ImageModel } from './seedream5ImageSize'
import { gptImageCustomSizeSupported, gptImageOutputSize } from './gptImageSize'

export type ImageCapabilityProfile = { model?: string; provider?: string; baseUrl?: string; adapter?: { type?: string; workflowTemplate?: string } }
export const IMAGE_RATIOS: AspectRatio[] = ['1:1', '1:2', '2:1', '9:16', '16:9', '3:4', '4:3', '3:2', '2:3', '5:4', '4:5', '21:9', '9:21']
export const IMAGE_QUALITY_LABELS: Record<string, string> = { auto: '自动画质', low: '低画质', medium: '标准画质', high: '高画质', xhigh: '超高画质', max: '最高画质' }

/** Match the actual transport, before considering a model alias. Never advertise ignored parameters. */
export function imageModelCapabilities(profile?: ImageCapabilityProfile, model = profile?.model || '') {
  let workflow = ''
  try { workflow = comfyImageWorkflowModel(JSON.parse(profile?.adapter?.workflowTemplate || '{}')) || '' } catch { /* not a JSON workflow */ }
  const adapter = profile?.adapter?.type
  const comfy = adapter === 'comfyui-prompt' || adapter === 'comfyui-workflow'
  const dash = isDashScopeEndpoint(profile || {}) && !adapter
  const relay = !comfy && !dash && (adapter === 'http-custom' || isRelayImageEndpoint(profile?.baseUrl, profile?.provider))
  const gpt = !adapter && !dash && !relay && /^(gpt[-_]image(?:[-_]|$)|chatgpt-image-latest$)/i.test(model)
  const gptCustomSize = gpt && gptImageCustomSizeSupported(model)
  const fixedDash = dash && !/^qwen-image-[23]\.0|^wan2\.7-image/.test(model)
  const seedream = !adapter && !dash && !relay && (/^seedream-/i.test(model) || isSeedream5ImageModel(model))
  const legacy = !adapter && !dash && !relay && !gpt && !seedream
  const mode = comfy ? 'pixels' : relay ? 'relay' : gpt ? 'gpt' : fixedDash ? 'fixed' : seedream ? 'seedream' : legacy ? 'legacy' : 'pixels'
  const qualities = gpt ? ['auto', 'low', 'medium', 'high', ...(/^gpt-image-2\.[56]-(sunburst|flare)(-|$)/i.test(model) ? ['xhigh', 'max'] : [])] : []
  const ratios: AspectRatio[] = gpt ? gptCustomSize ? IMAGE_RATIOS : ['1:1', '2:3', '3:2'] : relay ? ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9']
    : fixedDash ? ['1:1', '16:9', '9:16', '4:3'] : legacy ? ['1:1', '16:9', '9:16', '4:3', '21:9'] : IMAGE_RATIOS
  return { mode, ratios, qualities, seedream5: mode === 'seedream' && isSeedream5ImageModel(model), gptCustomSize, seed: comfy, h3: workflow === 'MiniMax H3 Image',
    note: mode === 'seedream' && isSeedream5ImageModel(model) ? '支持1K、1.5K、2K及自定义宽高；按所选比例提交实际像素尺寸。' : gptCustomSize ? '更多比例按对应像素尺寸提交；可在“更多”中手动输入宽高。'
      : gpt ? '当前模型使用标准尺寸：方形1024×1024、横版1536×1024、竖版1024×1536。'
      : mode === 'fixed' ? '尺寸由当前模型的预设画幅决定。' : mode === 'legacy' ? '当前兼容接口使用预设尺寸。' : '' }
}

export function imageFixedSize(profile: ImageCapabilityProfile | undefined, model: string, ratio: string) {
  const mode = imageModelCapabilities(profile, model).mode
  if (mode === 'gpt') return gptImageOutputSize(model, ratio)
  if (mode === 'fixed') return ({ '1:1': { width: 1328, height: 1328 }, '4:3': { width: 1472, height: 1104 }, '9:16': { width: 928, height: 1664 } } as Record<string, { width: number; height: number }>)[ratio] || { width: 1664, height: 928 }
  if (mode === 'legacy' && ratio === '4:3') return { width: 1536, height: 1024 }
  if (mode === 'legacy' && ratio === '21:9') return { width: 1792, height: 768 }
  if (mode === 'legacy') return ratio === '1:1' ? { width: 1024, height: 1024 } : ratio === '9:16' ? { width: 1024, height: 1792 } : { width: 1792, height: 1024 }
}

export function imageBatchCount(value: unknown): number { return [1, 2, 4].includes(Number(value)) ? Number(value) : 1 }

/** Match the existing Seedream transport's pixel budget before displaying or recording dimensions. */
export function seedreamRequestSize(width: number, height: number) {
  const even = (v: number) => Math.ceil(Math.max(2, Math.round(v)) / 2) * 2
  let w = even(width), h = even(height)
  if (w * h < 3_686_400) { const scale = Math.sqrt(3_686_400 / (w * h)); w = even(w * scale); h = even(h * scale) }
  if (w * h > 4096 * 4096) { const scale = Math.sqrt(4096 * 4096 / (w * h)); w = even(w * scale); h = even(h * scale) }
  return { width: w, height: h }
}
