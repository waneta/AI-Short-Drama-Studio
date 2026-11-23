export const AUTODL_API_ORIGIN = 'https://autodl.art'
const WORKFLOWS = new Set([
  'minimax_h3_lightx2v_v5_15s', 'minimax_h3_lightx2v_v5',
  'minimax_h3_b99_002', 'minimax_h3_image_audio_to_video',
  'minimax_h3_lightx2v', 'minimax_h3_zm_u24'
])

export function isAutodlTaskPath(path: string): boolean {
  return /^\/api\/v1\/comfyui\/comfyui_workflow\/result\/[a-zA-Z0-9_-]{1,160}$/.test(path)
}

export function isAutodlApiUrl(url: URL): boolean {
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.search || url.hash ||
      !['autodl.art', 'www.autodl.art'].includes(url.hostname)) return false
  const prefix = '/api/v1/comfyui/comfyui_workflow/'
  return isAutodlTaskPath(url.pathname) || (url.pathname.startsWith(prefix) && WORKFLOWS.has(url.pathname.slice(prefix.length)))
}

export function autodlWebProxyUrl(raw: string, enabled: boolean): string {
  if (!enabled) return raw
  try {
    const url = new URL(raw)
    if (isAutodlApiUrl(url)) return `/autodl-api${url.pathname}`
  } catch { /* Custom endpoints keep their existing transport. */ }
  return raw
}

export function autodlMediaProxyUrl(raw: string, enabled: boolean): string {
  if (!enabled) return raw
  return `/autodl-result-media?url=${encodeURIComponent(raw)}`
}

/** The proxy registers media only from an authenticated official task response. */
export function autodlResultMediaUrls(payload: any): string[] {
  const found = new Set<string>()
  const visit = (value: any, depth: number) => {
    if (depth > 6 || found.size >= 64) return
    if (typeof value === 'string' && value.startsWith('https://')) {
      try {
        const url = new URL(value)
        if (!url.username && !url.password && !url.port && !url.hash) found.add(url.href)
      } catch { /* Not a usable result. */ }
    } else if (Array.isArray(value)) value.slice(0, 64).forEach(item => visit(item, depth + 1))
    else if (value && typeof value === 'object') Object.values(value).slice(0, 64).forEach(item => visit(item, depth + 1))
  }
  visit(payload?.data?.results ?? payload?.results, 0)
  return [...found]
}
