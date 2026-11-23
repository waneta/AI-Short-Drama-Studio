import { chmodSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { connectionFile } from './codex-config'

export interface SavedConversation {
  version: 1
  threadId: string
  updatedAt: number
  inProgress: boolean
  turnId?: string
}
export interface ConversationLease {
  cwd: string
  read(): SavedConversation | undefined
  write(value: SavedConversation): void
  release(): void
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
function privateDir(dir: string) {
  mkdirSync(dir, { recursive: true, mode: 0o700 }); chmodSync(dir, 0o700)
}
/** The browser namespace prevents unrelated browser profiles/imported projects sharing a model session. */
export function conversationWorkspace(clientId: string, projectId: string) {
  const root = process.env.JULIU_CODEX_STATE_DIR || path.join(path.dirname(connectionFile()), 'conversations')
  privateDir(root)
  const project = path.join(root, hash(JSON.stringify([clientId, projectId])))
  privateDir(project)
  const cwd = path.join(project, 'workspace'); privateDir(cwd)
  return { project, cwd }
}
export function acquireConversation(clientId: string, projectId: string, conversationId: string, binding: string): ConversationLease {
  const { project, cwd } = conversationWorkspace(clientId, projectId)
  const dir = path.join(project, hash(conversationId)); privateDir(dir)
  // One lock for this logical conversation, even across provider changes or two Web service processes.
  const lock = path.join(dir, 'active.lock'), token = randomUUID()
  if (existsSync(lock)) {
    let alive = true
    try {
      const owner = JSON.parse(readFileSync(lock, 'utf8'))
      if (!Number.isInteger(owner.pid) || owner.pid <= 0) throw new Error('invalid owner')
      try { process.kill(owner.pid, 0) } catch (e: any) { if (e.code === 'ESRCH') alive = false }
    } catch { alive = Date.now() - statSync(lock).mtimeMs < 30_000 }
    if (alive) throw new Error('当前项目对话正在执行另一项 Codex 任务，请等待完成')
    unlinkSync(lock)
  }
  let fd: number
  try { fd = openSync(lock, 'wx', 0o600) } catch (e: any) {
    if (e.code === 'EEXIST') throw new Error('当前项目对话正在执行另一项 Codex 任务，请等待完成')
    throw e
  }
  try { writeFileSync(fd, JSON.stringify({ pid: process.pid, token })) } finally { closeSync(fd) }
  const file = path.join(dir, `${hash(binding)}.json`)
  return {
    cwd,
    read() {
      if (!existsSync(file)) return
      try {
        const value = JSON.parse(readFileSync(file, 'utf8'))
        if (value.version !== 1 || typeof value.threadId !== 'string' || !value.threadId || typeof value.inProgress !== 'boolean') throw new Error('invalid record')
        return value as SavedConversation
      } catch { throw new Error('项目 Codex 会话索引损坏，已停止恢复；聊天记录保留，请检查索引后重试') }
    },
    write(value) {
      if (JSON.parse(readFileSync(lock, 'utf8')).token !== token) throw new Error('项目对话锁已释放，停止写入旧任务状态')
      const temp = path.join(dir, `${randomUUID()}.tmp`)
      const fd = openSync(temp, 'wx', 0o600)
      try { writeFileSync(fd, JSON.stringify(value)); fsyncSync(fd) } finally { closeSync(fd) }
      renameSync(temp, file); chmodSync(file, 0o600)
      const parent = openSync(dir, 'r'); try { fsyncSync(parent) } finally { closeSync(parent) }
    },
    release() {
      try { if (JSON.parse(readFileSync(lock, 'utf8')).token === token) unlinkSync(lock) }
      catch (e: any) { if (e.code !== 'ENOENT') throw e }
    }
  }
}
/** Only a confirmed missing rollout allows reconstruction. Network/auth/compatibility failures must remain visible. */
export function missingConversation(error: unknown) {
  return /(?:thread|session|rollout).*(?:not found|does not exist|could not be found)|(?:no rollout found|could not find (?:thread|session|rollout))/i.test(String((error as any)?.message || error))
}
