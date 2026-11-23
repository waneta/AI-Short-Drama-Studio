import { ref } from 'vue'
import { throwIfAborted } from '@/services/ai/abort'

/** 正在生成的画布节点。各节点互不影响，可同时点。 */
export const runningNodeIds = ref<string[]>([])
const runningNodeStarts = ref<Record<string, number>>({})
const nodeControllers = new Map<string, AbortController>()
const cancellingNodeIds = ref<string[]>([])

export function canCancelNodeJob(id: string) {
  return isNodeRunning(id) && nodeControllers.has(id)
}

export function isNodeCancelling(id: string) {
  return cancellingNodeIds.value.includes(id)
}

/** Keep the node locked until its provider has finished cancellation cleanup. */
export function cancelNodeJob(id: string): boolean {
  const controller = nodeControllers.get(id)
  if (!controller || controller.signal.aborted) return false
  cancellingNodeIds.value = [...cancellingNodeIds.value, id]
  controller.abort(new DOMException('任务已取消', 'AbortError'))
  return true
}

/** Monotonic task start survives overlay remounts and progress label changes. */
export function nodeJobStartedAt(id: string): number | undefined {
  return runningNodeStarts.value[id]
}

export function isNodeRunning(id: string) {
  return runningNodeIds.value.includes(id)
}

export async function withNodeJob<T>(
  id: string,
  fn: (signal: AbortSignal) => Promise<T>,
  parentSignal?: AbortSignal
): Promise<T> {
  if (runningNodeIds.value.includes(id)) {
    throw new Error('这个节点正在生成')
  }
  const controller = new AbortController()
  const abort = () => controller.abort(parentSignal?.reason)
  parentSignal?.addEventListener('abort', abort, { once: true })
  if (parentSignal?.aborted) abort()
  nodeControllers.set(id, controller)
  runningNodeStarts.value = { ...runningNodeStarts.value, [id]: performance.now() }
  runningNodeIds.value = [...runningNodeIds.value, id]
  try {
    throwIfAborted(controller.signal)
    return await fn(controller.signal)
  } finally {
    parentSignal?.removeEventListener('abort', abort)
    nodeControllers.delete(id)
    cancellingNodeIds.value = cancellingNodeIds.value.filter(x => x !== id)
    runningNodeIds.value = runningNodeIds.value.filter((x) => x !== id)
    const next = { ...runningNodeStarts.value }
    delete next[id]
    runningNodeStarts.value = next
  }
}

/** AutoDL 出视频支持并发；批量出片按这个上限同时提交 */
export const VIDEO_GEN_CONCURRENCY = 8

export async function mapPool<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  if (!items.length) return
  const queue = [...items]
  const n = Math.min(Math.max(1, limit), queue.length)
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (queue.length) {
        const item = queue.shift()
        if (item === undefined) break
        try {
          await fn(item)
        } catch {
          /* 单个失败不影响其它 */
        }
      }
    })
  )
}
