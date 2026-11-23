export const VOLC_PLAN_TTS_ORIGIN = 'https://openspeech.bytedance.com'
export const VOLC_PLAN_TTS_PATH = '/api/v3/plan/tts/unidirectional'

/** Only this official subscription endpoint uses the local web transport. */
export function volcTtsWebProxyUrl(raw: string, enabled: boolean): string {
  if (!enabled) return raw
  try {
    const url = new URL(raw)
    if (url.origin === VOLC_PLAN_TTS_ORIGIN && !url.username && !url.password && !url.search && !url.hash && url.pathname === VOLC_PLAN_TTS_PATH) {
      return `/volc-tts-api${VOLC_PLAN_TTS_PATH}`
    }
  } catch { /* Keep validation errors in the subscription adapter. */ }
  return raw
}

export function fetchVolcTtsWeb(url: string, init: RequestInit): Promise<Response> {
  const target = volcTtsWebProxyUrl(url, import.meta.env.VITE_VOLC_TTS_WEB_PROXY === 'true')
  return fetch(target === url ? url : new URL(target, window.location.origin), init)
}
