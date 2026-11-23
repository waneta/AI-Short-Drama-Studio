import http from 'node:http'
import https from 'node:https'
import type { Plugin } from 'vite'
import { VOLC_PLAN_TTS_ORIGIN, VOLC_PLAN_TTS_PATH } from '../src/services/ai/volcTtsWebTransport'

/** The optional upstream is a code-only local fixture, never a browser parameter. */
export function volcTtsWebProxy(fixtureOrigin?: string): Plugin {
  const middleware = (req: http.IncomingMessage, res: http.ServerResponse, next: () => void) => {
    const raw = req.url || ''
    if (!raw.startsWith('/volc-tts-api')) return next()
    const fail = (status: number, message: string) => {
      if (res.headersSent) { res.destroy(); return }
      res.statusCode = status
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ error: { message, type: 'local_volc_tts_transport' } }))
    }
    if (req.headers['sec-fetch-site'] === 'cross-site') return fail(403, '火山配音转发拒绝跨站请求')
    if (req.headers.origin) {
      try {
        const origin = new URL(req.headers.origin)
        if (origin.protocol !== 'http:' || origin.host !== req.headers.host) return fail(403, '火山配音仅接受当前页面请求')
      } catch { return fail(403, '无效Origin') }
    }
    if (raw.includes('?') || raw.includes('#')) return fail(400, '火山配音接口不接受查询参数')
    if (raw !== `/volc-tts-api${VOLC_PLAN_TTS_PATH}`) return fail(403, '仅允许火山Agent Plan订阅配音接口')
    if (req.method !== 'POST') return fail(405, '火山配音仅支持POST')
    if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) return fail(415, '火山配音请求须为JSON')
    const maxBytes = 1024 * 1024
    if (Number(req.headers['content-length'] || 0) > maxBytes) return fail(413, '配音请求超过1MiB')
    const headers: Record<string, string> = { Accept: 'application/json', 'Content-Type': 'application/json' }
    for (const name of ['x-api-key', 'x-api-resource-id', 'x-api-request-id']) {
      if (req.headers[name]) headers[name] = String(req.headers[name])
    }
    const url = new URL(VOLC_PLAN_TTS_PATH, fixtureOrigin || VOLC_PLAN_TTS_ORIGIN)
    const request = url.protocol === 'https:' ? https.request : http.request
    const upstream = request(url, { method: 'POST', headers }, response => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400) {
        response.resume(); return fail(502, '火山配音上游返回重定向，已停止转发')
      }
      res.statusCode = response.statusCode || 502
      res.setHeader('Cache-Control', 'no-store')
      if (response.headers['content-type']) res.setHeader('Content-Type', response.headers['content-type'])
      if (response.headers['x-tt-logid']) res.setHeader('X-Tt-Logid', String(response.headers['x-tt-logid']))
      response.on('error', () => res.destroy())
      response.pipe(res)
    })
    upstream.setTimeout(180_000, () => upstream.destroy(new Error('timeout')))
    upstream.on('error', () => {
      if (!res.writableEnded) fail(502, '本机无法连接火山配音接口')
    })
    let bytes = 0
    req.on('data', chunk => {
      bytes += chunk.length
      if (bytes > maxBytes) { fail(413, '配音请求超过1MiB'); upstream.destroy() }
    })
    req.on('aborted', () => upstream.destroy())
    res.on('close', () => { if (!res.writableEnded) upstream.destroy() })
    req.pipe(upstream)
  }
  return {
    name: 'volc-plan-tts-web-transport',
    configureServer(server) { server.middlewares.use(middleware) },
    configurePreviewServer(server) { server.middlewares.use(middleware) }
  }
}
