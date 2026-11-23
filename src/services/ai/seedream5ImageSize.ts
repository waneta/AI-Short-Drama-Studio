import type { H3ImageResolution } from '@/types'

/** Official 5.0 Pro/Flash names, Agent Plan aliases, and dated public Model IDs. */
export function isSeedream5ImageModel(model: string) {
  return /^(?:doubao-)?seedream-5[.-]0-(?:pro|flash)(?:-\d{6})?$/i.test(model.trim())
}

export const SEEDREAM5_RESOLUTIONS: { value: H3ImageResolution; label: string }[] = [
  { value: 'auto', label: '默认 · 2K' },
  { value: '1mp', label: '1K' },
  { value: 'seedream-1.5k', label: '1.5K' },
  { value: '4mp', label: '2K' },
  { value: 'custom', label: '自定义宽高' }
]

/** Official common-ratio pixel mappings; K denotes a pixel tier, not the longest edge. */
const presets: Record<string, [number, number][]> = {
  '1:1': [[1024, 1024], [1536, 1536], [2048, 2048]],
  '4:3': [[1152, 864], [1792, 1344], [2368, 1776]],
  '3:4': [[864, 1152], [1344, 1792], [1776, 2368]],
  '16:9': [[1424, 800], [2048, 1152], [2816, 1584]],
  '9:16': [[800, 1424], [1152, 2048], [1584, 2816]],
  '3:2': [[1248, 832], [1872, 1248], [2496, 1664]],
  '2:3': [[832, 1248], [1248, 1872], [1664, 2496]],
  '21:9': [[1568, 672], [2352, 1008], [3136, 1344]]
}

export function seedream5SizeIssue(width?: number, height?: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width! <= 0 || height! <= 0) return 'Seedream 5.0 宽高需为正整数。'
  const pixels = width! * height!
  if (pixels < 921600 || pixels > 4624220) return 'Seedream 5.0 总像素需在921,600–4,624,220之间（约0.92–4.62MP）。'
  if (Math.max(width!, height!) > Math.min(width!, height!) * 16) return 'Seedream 5.0 宽高比需在1:16到16:1之间。'
  return ''
}

export function seedream5OutputSize(resolution: H3ImageResolution | undefined, ratio: string, custom?: { width?: number; height?: number }) {
  if (resolution === 'custom') {
    const issue = seedream5SizeIssue(custom?.width, custom?.height)
    if (issue) throw new Error(`[image] ${issue}`)
    return { width: custom!.width!, height: custom!.height! }
  }
  const tier = resolution === '1mp' ? 0 : resolution === 'seedream-1.5k' ? 1 : 2
  const known = presets[ratio]?.[tier]
  if (known) return { width: known[0], height: known[1] }
  const [w, h] = ratio.split(':').map(Number)
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0 || Math.max(w, h) > Math.min(w, h) * 16) throw new Error('[image] Seedream 5.0 比例需在1:16到16:1之间。')
  const scale = Math.sqrt([1024 ** 2, 1536 ** 2, 2048 ** 2][tier] / (w * h))
  const size = { width: Math.round(w * scale / 2) * 2, height: Math.round(h * scale / 2) * 2 }
  const issue = seedream5SizeIssue(size.width, size.height)
  if (issue) throw new Error(`[image] ${issue}`)
  return size
}
