import type { AdapterConfig } from './adapters'
import type { VideoResolution } from '@/types'

export type NativeH3Resolution = '480p' | '720p' | '1080p'

/** Existing unspecified nodes keep their previous ~720p output size. */
export function normalizeNativeH3Resolution(value: unknown): NativeH3Resolution {
  return value === '480p' || value === '1080p' ? value : '720p'
}

/** H3's canvas uses a 32px grid. Preserve aspect/orientation before rounding each axis. */
export function nativeH3VideoSize(resolution: VideoResolution | undefined, width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error('[comfyui] H3 视频尺寸无效。')
  const short = resolution === '480p' ? 480 : resolution === '720p' ? 720 : resolution === '1080p' ? 1080 : resolution === '768p' ? 768 : undefined
  const scale = short ? short / Math.min(width, height) : 1
  return { width: Math.max(32, Math.round(width * scale / 32) * 32), height: Math.max(32, Math.round(height * scale / 32) * 32) }
}

/** Detect actual native H3 conditioning, independent of display name or server address. */
export function isNativeH3VideoProfile(profile?: { adapter?: AdapterConfig } | null): boolean {
  if (profile?.adapter?.type !== 'comfyui-prompt') return false
  try {
    const payload = JSON.parse(profile.adapter.workflowTemplate || '{}')
    const nodes = payload.prompt || payload
    return Object.values(nodes).some((node: any) => ['MiniMaxH3ImageToVideo', 'MiniMaxH3ReferenceToVideo'].includes(node?.class_type))
  } catch { return false }
}
