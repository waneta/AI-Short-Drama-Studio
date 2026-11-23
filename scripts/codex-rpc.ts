import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import { existsSync, readdirSync, mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { readConnection, effectiveKey, type CodexConnection } from './codex-config'

/** Only a digest enters thread identity; raw config and credential values never leave the server. */
export function nativeConfigRevision() {
  const file = path.join(process.env.CODEX_HOME || path.join(homedir(), '.codex'), 'config.toml')
  return createHash('sha256').update(existsSync(file) ? readFileSync(file) : '').digest('hex')
}
export async function readNativeProvider(rpc: CodexRpc) {
  const result = await rpc.request('config/read', { includeLayers: false })
  const id = result.config?.model_provider || 'openai', provider = result.config?.model_providers?.[id]
  // Do not spread provider/config: these may contain static authorization headers.
  let baseUrl = ''
  if (provider?.base_url) {
    const url = new URL(provider.base_url)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('本机接口地址包含不能展示的字段，请在本机Codex中检查配置')
    baseUrl = url.href.replace(/\/+$/, '')
  }
  return { provider: String(id), baseUrl, model: String(result.config?.model || ''),
    envKey: typeof provider?.env_key === 'string' ? provider.env_key : '',
    hasEnvironmentKey: Boolean(provider?.env_key && process.env[provider.env_key]),
    wireApi: provider?.wire_api || 'responses' }
}

export function codexExecutable() {
  if (process.env.JULIU_CODEX_BIN) return process.env.JULIU_CODEX_BIN
  const extensions = path.join(homedir(), '.vscode/extensions')
  if (existsSync(extensions)) {
    const candidates = readdirSync(extensions).filter(n => n.startsWith('openai.chatgpt-')).sort().reverse()
    for (const name of candidates) {
      const bin = path.join(extensions, name, 'bin', `${process.platform}-${process.arch === 'x64' ? 'x86_64' : process.arch}`, 'codex')
      if (existsSync(bin)) return bin
    }
  }
  return 'codex'
}

/** Versioned app-server JSON-RPC over stdio, never a shell command or terminal scraper. */
export class CodexRpc {
  child: ChildProcessWithoutNullStreams
  cwd: string
  private sequence = 0
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  onMessage: (message: any) => void = () => undefined
  onExit: (error: Error) => void = () => undefined
  private stopped = false
  constructor(executable = codexExecutable(), connection: CodexConnection = readConnection(), useCliProvider = false, workspace?: string) {
    this.cwd = workspace || mkdtempSync(path.join(tmpdir(), 'juliu-codex-'))
    const provider = useCliProvider || connection.mode === 'existing' ? [] : connection.mode === 'custom' ? [
      '-c', 'model_provider="juliu"',
      '-c', `model_providers.juliu={name="剧流自定义接口",base_url=${JSON.stringify(connection.baseUrl)},wire_api="responses",env_key="JULIU_CODEX_API_KEY",requires_openai_auth=false}`,
      '-c', `model=${JSON.stringify(connection.model)}`
    ] : ['-c', 'model_provider="openai"']
    const childEnv: NodeJS.ProcessEnv = { ...process.env, RUST_LOG: 'error', ...(!useCliProvider && connection.mode === 'custom' ? { JULIU_CODEX_API_KEY: effectiveKey(connection) } : {}) }
    if (!useCliProvider && connection.mode === 'chatgpt') { delete childEnv.OPENAI_API_KEY; delete childEnv.CODEX_API_KEY }
    // An explicitly empty proxy means direct access, including inherited shell proxy variables.
    for (const name of ['HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'https_proxy', 'http_proxy', 'all_proxy']) delete childEnv[name]
    if (connection.proxy) Object.assign(childEnv, { HTTPS_PROXY: connection.proxy, HTTP_PROXY: connection.proxy, ALL_PROXY: connection.proxy })
    const bypass = ['127.0.0.1', 'localhost', '::1']
    if (connection.mode === 'custom' && connection.baseUrl) {
      const host = new URL(connection.baseUrl).hostname
      if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) bypass.push(host)
    }
    Object.assign(childEnv, { NO_PROXY: bypass.join(','), no_proxy: bypass.join(',') })
    this.child = spawn(executable, ['app-server', '--listen', 'stdio://',
      ...provider,
      '-c', 'features.shell_tool=false', '-c', 'features.unified_exec=false',
      '-c', 'features.plugins=false', '-c', 'features.remote_plugin=false',
      '-c', 'features.multi_agent=false', '-c', 'features.multi_agent_v2=false',
      '-c', 'features.code_mode=false', '-c', 'web_search="disabled"', '-c', 'mcp_servers={}'], {
      cwd: this.cwd, stdio: ['pipe', 'pipe', 'pipe'], shell: false,
      env: childEnv
    })
    // Never forward startup logs (which may contain account/config information) to a browser.
    this.child.stderr.on('data', () => undefined)
    const lines = createInterface({ input: this.child.stdout })
    lines.on('line', line => {
      let message: any
      try { message = JSON.parse(line) } catch { return }
      if (message.id !== undefined && !message.method) {
        const pending = this.pending.get(message.id)
        if (pending) {
          this.pending.delete(message.id); clearTimeout(pending.timer)
          if (message.error) pending.reject(new Error(message.error.message || 'Codex 协议错误'))
          else pending.resolve(message.result)
        }
      } else this.onMessage(message)
    })
    const failed = (error: Error) => {
      for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error) }
      this.pending.clear()
      if (!this.stopped) this.onExit(error)
    }
    this.child.on('error', () => failed(new Error('无法启动 Codex，请安装 CLI 或设置 JULIU_CODEX_BIN')))
    this.child.on('exit', () => { failed(new Error('Codex 进程已退出')); lines.close(); if (!workspace) rmSync(this.cwd, { recursive: true, force: true }) })
  }
  send(message: unknown) {
    if (!this.child.stdin.destroyed) this.child.stdin.write(JSON.stringify(message) + '\n')
  }
  request(method: string, params: unknown = {}, timeoutMs = 30_000): Promise<any> {
    const id = ++this.sequence
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Codex ${method} 超时`)) }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer }); this.send({ id, method, params })
    })
  }
  async initialize() {
    await this.request('initialize', { clientInfo: { name: 'juliu_studio', title: '剧流 AI 助手', version: '1.0.0' }, capabilities: { experimentalApi: true } })
    this.send({ method: 'initialized' })
  }
  close() {
    if (this.stopped) return
    this.stopped = true
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('Codex 连接已关闭')) }
    this.pending.clear()
    this.child.kill('SIGTERM')
    const timer = setTimeout(() => { if (this.child.exitCode === null) this.child.kill('SIGKILL') }, 1500)
    timer.unref()
  }
}
