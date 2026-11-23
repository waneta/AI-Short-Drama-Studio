import type { AspectRatio } from '@/types'

/** https://help.aliyun.com/zh/model-studio/wan3-video-generation-api-reference */
export const WAN3_VIDEO_RATIOS: AspectRatio[] = ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9']
export const WAN3_VIDEO_RESOLUTIONS = ['480p', '720p', '1080p'] as const
export function isWan3VideoModel(model?: string) {
  return /^wan3\.0-video(?:-prime)?$/.test(model || '')
}
/** Preserve the previous 720p default for existing nodes and foreign-provider presets. */
export function normalizeWan3VideoResolution(value: unknown): typeof WAN3_VIDEO_RESOLUTIONS[number] {
  const normalized = String(value || '').toLowerCase()
  return normalized === '480p' || normalized === '1080p' ? normalized : '720p'
}
export function wan3VideoRatio(value?: string) {
  if (value === 'auto' || value === 'adaptive') return 'adaptive'
  const ratio = value || '16:9'
  if (!WAN3_VIDEO_RATIOS.includes(ratio as AspectRatio)) throw new Error('[百炼] Wan 3.0 不支持此视频比例，请重新选择。')
  return ratio
}
