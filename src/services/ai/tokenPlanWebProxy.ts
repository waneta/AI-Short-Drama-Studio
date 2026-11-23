/** Known cloud API endpoints use fixed local Web transport; other destinations stay unchanged. */
export const ARK_IMAGE_ORIGIN = 'https://ark.cn-beijing.volces.com'

export function isArkImageApiUrl(url: URL): boolean {
  return url.origin === ARK_IMAGE_ORIGIN && !url.username && !url.password && !url.search && !url.hash &&
    /^\/api\/(?:plan\/)?v3\/images\/generations$/.test(url.pathname)
}

export const TOKEN_PLAN_ORIGIN = 'https://token-plan.cn-beijing.maas.aliyuncs.com'

export function isTokenPlanApiUrl(url: URL): boolean {
  return url.origin === TOKEN_PLAN_ORIGIN && !url.username && !url.password &&
    /^(?:\/compatible-mode\/v1\/chat\/completions|\/api\/v1\/(?:services\/(?:audio\/tts\/SpeechSynthesizer|aigc\/(?:multimodal-generation\/generation|video-generation\/video-synthesis))|tasks\/[a-zA-Z0-9_-]+))$/.test(url.pathname)
}

export function isAlibabaResultUrl(url: URL): boolean {
  return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
    /^[a-z0-9][a-z0-9.-]*\.oss(?:-[a-z0-9-]+)?\.aliyuncs\.com$/i.test(url.hostname)
}

export function tokenPlanWebProxyUrl(raw: string, enabled: boolean, desktop = false): string {
  if (!enabled || desktop) return raw
  try {
    const url = new URL(raw)
    if (isArkImageApiUrl(url)) return `/ark-image-api${url.pathname}`
    if (isTokenPlanApiUrl(url)) return `/token-plan-api${url.pathname}${url.search}`
    if (isAlibabaResultUrl(url)) return `/token-plan-media?url=${encodeURIComponent(url.href)}`
  } catch { /* Other local and third-party URLs keep their existing transport. */ }
  return raw
}
