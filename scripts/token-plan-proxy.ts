import http from 'node:http'
import https from 'node:https'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { isAlibabaResultUrl, isTokenPlanApiUrl, TOKEN_PLAN_ORIGIN } from '../src/services/ai/tokenPlanWebProxy'

/** Test-only overrides are passed in code; browser requests cannot change the upstream. */
export function tokenPlanWebProxy(options: { apiOrigin?: string; mediaOrigin?: string } = {}): Plugin {
  const middleware = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const raw = req.url || ''
    if (!/^\/token-plan-(?:api(?:\/|$)|media(?:\?|$))/.test(raw)) return next()
    const fail = (status: number, message: string) => {
      res.statusCode = status
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ code: 'LocalTokenPlanProxy', message }))
    }
    // The local transport accepts this page's requests, not cross-site calls.
    if (req.headers.origin) {
      try {
        const origin = new URL(req.headers.origin)
        if (origin.host !== req.headers.host || origin.protocol !== 'http:') return fail(403, '本机转发拒绝跨站请求')
      } catch { return fail(403, '无效 Origin') }
    }
    let target: URL
    let media = false
    try {
      if (raw.startsWith('/token-plan-api/')) {
        target = new URL(raw.slice('/token-plan-api'.length), TOKEN_PLAN_ORIGIN)
        if (!isTokenPlanApiUrl(target)) return fail(403, '仅支持已配置的 Token Plan 模型接口')
        const poll = target.pathname.startsWith('/api/v1/tasks/')
        if (req.method !== (poll ? 'GET' : 'POST')) return fail(405, '不支持此请求方法')
      } else {
        media = true
        const query = new URL(raw, 'http://localhost').searchParams
        target = new URL(query.get('url') || '')
        if (!isAlibabaResultUrl(target)) return fail(403, '仅允许阿里云 OSS 媒体下载地址')
        if (req.method !== 'GET' && req.method !== 'HEAD') return fail(405, '媒体只支持读取')
      }
    } catch { return fail(400, '无效的转发地址') }

    // Keep the original signed path/query when replacing the origin in an isolated test.
    const override = media ? options.mediaOrigin : options.apiOrigin
    if (override) target = new URL(target.pathname + target.search, override)
    const headers: Record<string, string> = { Accept: media ? '*/*' : 'application/json' }
    if (!media) {
      if (req.headers.authorization) headers.Authorization = req.headers.authorization
      if (req.headers['content-type']) headers['Content-Type'] = String(req.headers['content-type'])
      if (req.headers['x-dashscope-async']) headers['X-DashScope-Async'] = String(req.headers['x-dashscope-async'])
    }
    const request = target.protocol === 'https:' ? https.request : http.request
    const upstream = request(target, { method: req.method, headers }, response => {
      res.statusCode = response.statusCode || 502
      for (const name of ['content-type', 'content-length', 'cache-control']) {
        const value = response.headers[name]
        if (value !== undefined) res.setHeader(name, value)
      }
      response.on('error', () => res.destroy())
      response.pipe(res)
    })
    upstream.setTimeout(180_000, () => upstream.destroy(new Error('timeout')))
    upstream.on('error', error => {
      if (!res.headersSent) fail(502, `本机无法连接${media ? '阿里云媒体存储' : 'Token Plan 接口'}：${error.message}`)
      else res.destroy()
    })
    req.on('aborted', () => upstream.destroy())
    res.on('close', () => { if (!res.writableEnded) upstream.destroy() })
    req.pipe(upstream)
  }
  return {
    name: 'local-token-plan-transport',
    configureServer(server) { server.middlewares.use(middleware) },
    configurePreviewServer(server) { server.middlewares.use(middleware) }
  }
}
