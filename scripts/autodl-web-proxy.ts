import http, { type IncomingMessage, type ServerResponse } from 'node:http'
import https from 'node:https'
import dns from 'node:dns/promises'
import net from 'node:net'
import type { Plugin } from 'vite'
import { AUTODL_API_ORIGIN, isAutodlApiUrl, isAutodlTaskPath, autodlResultMediaUrls } from '../src/services/ai/autodlWebTransport'

/** Used before pinning DNS for a result download; private/internal hosts are never fetched. */
export function publicMediaAddress(address: string): boolean {
  if (net.isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number)
    return !(a === 0 || a === 10 || a === 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 ||
      a === 192 && (b === 168 || b === 0 && [0, 2].includes(c)) || a === 100 && b >= 64 && b <= 127 || a === 198 && ([18, 19].includes(b) || b === 51 && c === 100) || a === 203 && b === 0 && c === 113 || a >= 224)
  }
  if (net.isIP(address) === 6) {
    const ip = address.toLowerCase()
    // Restrict IPv6 to ordinary global unicast; exclude mapped IPv4, documentation and transition ranges.
    return /^[23]/.test(ip) && !/^(?:2001:(?:db8|0:|10:|20:)|2002:)/.test(ip)
  }
  return false
}

/** Overrides are fixtures in code; page requests cannot choose an API origin. */
export function autodlWebProxy(options: { apiOrigin?: string; mediaOrigin?: string } = {}): Plugin {
  const media = new Map<string, number>()
  const TTL = 60 * 60_000
  const middleware = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const raw = req.url || ''
    if (!raw.startsWith('/autodl-api') && !raw.startsWith('/autodl-result-media')) return next()
    const fail = (status: number, message: string) => {
      if (res.headersSent) { res.destroy(); return }
      res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify({ error: { type: 'local_autodl_transport', message } }))
    }
    if (req.headers['sec-fetch-site'] === 'cross-site') return fail(403, 'AutoDL转发拒绝跨站请求')
    if (req.headers.origin) {
      try {
        const origin = new URL(req.headers.origin)
        if (origin.protocol !== 'http:' || origin.host !== req.headers.host) return fail(403, 'AutoDL转发仅接受当前页面请求')
      } catch { return fail(403, '无效Origin') }
    }
    if (raw.startsWith('/autodl-result-media')) {
      let url: URL
      try {
        const local = new URL(raw, 'http://localhost'), params = [...local.searchParams.entries()]
        if (local.pathname !== '/autodl-result-media' || params.length !== 1 || params[0][0] !== 'url') return fail(400, '无效AutoDL结果下载路径')
        url = new URL(params[0][1])
        if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return fail(403, 'AutoDL结果只支持公共HTTPS地址')
        if ((media.get(url.href) || 0) < Date.now()) return fail(403, '此视频地址尚未通过任务结果确认，请重试续查原任务后下载')
      } catch { return fail(400, '无效AutoDL结果地址') }
      if (req.method !== 'GET') return fail(405, '视频结果仅支持GET')
      let active: http.ClientRequest | undefined
      req.on('aborted', () => active?.destroy())
      res.on('close', () => { if (!res.writableEnded) active?.destroy() })
      const download = async (target: URL, redirects = 0): Promise<void> => {
        if (res.destroyed) return
        if (target.protocol !== 'https:' || target.username || target.password || target.port || target.hash) return fail(403, '拒绝非公共HTTPS结果地址')
        const hostname = target.hostname.replace(/^\[|\]$/g, '')
        const addresses = await dns.lookup(hostname, { all: true })
        if (!addresses.length || addresses.some(item => !publicMediaAddress(item.address))) return fail(403, '拒绝访问私有或本机视频地址')
        if (res.destroyed) return
        const original = target
        const routed = options.mediaOrigin ? new URL(target.pathname + target.search, options.mediaOrigin) : target
        const request = routed.protocol === 'https:' ? https.request : http.request
        const pinned = addresses[0]
        active = request(routed, {
          method: 'GET', headers: { Accept: '*/*' },
          ...(!options.mediaOrigin ? { lookup: (_name: string, _opts: any, callback: any) => _opts?.all ? callback(null, [pinned]) : callback(null, pinned.address, pinned.family) } : {})
        }, response => {
          const status = response.statusCode || 502
          if (status >= 300 && status < 400) {
            response.resume()
            if (redirects >= 3 || !response.headers.location) return fail(502, '视频地址重定向过多或缺少目标')
            let redirected: URL
            try { redirected = new URL(response.headers.location, original) } catch { return fail(502, '无效视频重定向地址') }
            void download(redirected, redirects + 1).catch(() => fail(502, '无法连接AutoDL结果存储'))
            return
          }
          if (Number(response.headers['content-length'] || 0) > 512 * 1024 * 1024) { response.resume(); return fail(413, '视频超过512MiB下载限制') }
          res.statusCode = status; res.setHeader('Cache-Control', 'no-store')
          if (response.headers['content-type']) res.setHeader('Content-Type', response.headers['content-type'])
          let bytes = 0
          response.on('data', chunk => { bytes += chunk.length; if (bytes > 512 * 1024 * 1024) { response.destroy(); res.destroy() } })
          response.on('error', () => res.destroy()); response.pipe(res)
        })
        active.setTimeout(180_000, () => active?.destroy(new Error('timeout')))
        active.on('error', () => fail(502, '本机无法连接AutoDL结果存储')); active.end()
      }
      void download(url).catch(() => fail(502, '无法解析或连接AutoDL结果存储'))
      return
    }
    let api: URL
    try {
      const match = /^\/autodl-api(\/[^?#]*)$/.exec(raw)
      if (!match) return fail(400, '无效AutoDL接口路径')
      api = new URL(match[1], AUTODL_API_ORIGIN)
      if (!isAutodlApiUrl(api)) return fail(403, '仅允许已适配的AutoDL工作流与任务查询')
      const poll = isAutodlTaskPath(api.pathname)
      if (req.method !== (poll ? 'GET' : 'POST')) return fail(405, '不支持的AutoDL请求方法')
      if (!poll && !String(req.headers['content-type'] || '').startsWith('application/json')) return fail(415, 'AutoDL任务须使用JSON')
    } catch { return fail(400, '无效AutoDL接口地址') }
    const limit = 192 * 1024 * 1024
    if (Number(req.headers['content-length'] || 0) > limit) return fail(413, 'AutoDL任务请求超过192MiB')
    const target = options.apiOrigin ? new URL(api.pathname, options.apiOrigin) : api
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (req.headers.authorization) headers.Authorization = req.headers.authorization
    if (req.method === 'POST') headers['Content-Type'] = 'application/json'
    const request = target.protocol === 'https:' ? https.request : http.request
    const upstream = request(target, { method: req.method, headers }, response => {
      const status = response.statusCode || 502
      if (status >= 300 && status < 400) { response.resume(); return fail(502, 'AutoDL接口重定向已停止，未转发Token') }
      const chunks: Buffer[] = []; let bytes = 0
      response.on('data', chunk => { bytes += chunk.length; if (bytes > 4 * 1024 * 1024) { response.destroy(); fail(502, 'AutoDL任务响应过大') } else chunks.push(Buffer.from(chunk)) })
      response.on('error', () => fail(502, 'AutoDL任务响应读取中断'))
      response.on('end', () => {
        if (res.writableEnded || res.destroyed) return
        const body = Buffer.concat(chunks)
        if (status >= 200 && status < 300 && isAutodlTaskPath(api.pathname)) {
          try {
            for (const [url, expires] of media) if (expires < Date.now()) media.delete(url)
            for (const url of autodlResultMediaUrls(JSON.parse(body.toString('utf8')))) {
              if (media.size >= 2048) media.delete(media.keys().next().value!)
              media.set(url, Date.now() + TTL)
            }
          } catch { /* Preserve upstream errors as received, without authorizing downloads. */ }
        }
        res.statusCode = status; res.setHeader('Cache-Control', 'no-store')
        res.setHeader('Content-Type', String(response.headers['content-type'] || 'application/json'))
        res.end(body)
      })
    })
    upstream.setTimeout(180_000, () => upstream.destroy(new Error('timeout')))
    upstream.on('error', () => fail(502, '本机无法连接AutoDL工作流接口'))
    let bytes = 0
    req.on('data', chunk => { bytes += chunk.length; if (bytes > limit) { upstream.destroy(); fail(413, 'AutoDL任务请求过大') } })
    req.on('aborted', () => upstream.destroy())
    res.on('close', () => { if (!res.writableEnded) upstream.destroy() })
    req.pipe(upstream)
  }
  return { name: 'local-autodl-web-transport', configureServer(server) { server.middlewares.use(middleware) }, configurePreviewServer(server) { server.middlewares.use(middleware) } }
}
