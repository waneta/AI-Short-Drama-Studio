import type { H3ImageResolution } from '@/types'
import { H3_IMAGE_RESOLUTIONS, h3ImageOutputSize } from './comfyH3Image'

/** https://help.aliyun.com/zh/model-studio/wan-image-generation-and-editing-api-reference */
export function wan27ImageLimits(model = '', referenceCount = 0) {
  if (!/^wan2\.7-image(?:-pro)?$/.test(model)) return undefined
  return { minPixels: 768 * 768, maxPixels: model === 'wan2.7-image-pro' && !referenceCount ? 4096 * 4096 : 2048 * 2048 }
}

export function wan27ImageSizeIssue(model: string, width: number, height: number, referenceCount = 0): string {
  const limits = wan27ImageLimits(model, referenceCount)
  if (!limits) return ''
  const prefix = `[百炼] ${model}${referenceCount ? '（参考图生成）' : ''}`
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) return `${prefix} 的宽高须为正整数。`
  if (width / height < 1 / 8 || width / height > 8) return `${prefix} 的宽高比须在1:8至8:1之间，请调整自定义宽高。`
  const pixels = width * height
  return pixels < limits.minPixels || pixels > limits.maxPixels
    ? `${prefix} 总像素须在${limits.minPixels.toLocaleString('en-US')}至${limits.maxPixels.toLocaleString('en-US')}之间，当前${width}×${height}为${pixels.toLocaleString('en-US')}像素，请调整分辨率或自定义宽高。` : ''
}

export function wan27ImageResolutionOptions(model: string, width: number, height: number, referenceCount = 0) {
  return [
    { value: 'auto' as const, label: '默认尺寸' },
    ...H3_IMAGE_RESOLUTIONS.filter(item => {
      if (item.value === 'custom') return true
      if (!['480p', '720p', '1080p', '1440p', '2160p'].includes(item.value)) return false
      const size = h3ImageOutputSize(item.value, width, height)
      return !wan27ImageSizeIssue(model, size.width, size.height, referenceCount)
    })
  ]
}

/** Replace an incompatible saved preset with the smallest legal preset shown in the UI. Custom input stays explicit. */
export function wan27ImageResolution(model: string, resolution: H3ImageResolution | undefined, width: number, height: number, referenceCount = 0) {
  if (!wan27ImageLimits(model, referenceCount) || !resolution) return resolution
  const options = wan27ImageResolutionOptions(model, width, height, referenceCount)
  return options.find(item => item.value === resolution)?.value || options.find(item => item.value !== 'auto' && item.value !== 'custom')?.value || 'auto'
}
