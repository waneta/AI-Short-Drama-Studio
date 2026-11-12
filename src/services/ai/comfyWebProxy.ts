/** Route configured ComfyUI origins through the local Vite Web server. */
export function comfyWebProxyUrl(url: string, target: string, desktop = false, imageTarget = '', remoteImageTarget = ''): string {
  if (desktop) return url
  try {
    const request = new URL(url)
    if (request.username || request.password) return url
    for (const [origin, prefix] of [[target, '/comfy-local'], [imageTarget, '/comfy-image'], [remoteImageTarget, '/comfy-remote-image']]) {
      if (origin && request.origin === new URL(origin).origin) {
        return `${prefix}${request.pathname}${request.search}`
      }
    }
  } catch {
    return url
  }
  return url
}
