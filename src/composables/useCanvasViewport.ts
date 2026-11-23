import { onBeforeUnmount, onMounted, watch, type Ref } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { useProjectStore, useToastStore } from '@/stores'
import type { CanvasViewport } from '@/types'

const STORAGE_PREFIX = 'aicut:canvas-viewport:'

function validViewport(value: unknown): value is CanvasViewport {
  if (!value || typeof value !== 'object') return false
  const v = value as CanvasViewport
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.zoom) && v.zoom >= 0.2 && v.zoom <= 2
}

/** Keep the last camera separately from graph history and survive an immediate exit. */
export function useCanvasViewport(flow: { viewport: Ref<CanvasViewport>; getViewport: () => CanvasViewport }) {
  const project = useProjectStore()
  const toast = useToastStore()
  const projectId = project.current?.id
  const key = projectId ? STORAGE_PREFIX + projectId : ''
  let initialViewport: CanvasViewport = { x: 0, y: 0, zoom: 0.85 }
  const stored = project.current?.canvas?.viewport
  if (validViewport(stored)) initialViewport = { ...stored }
  try {
    const cached: unknown = JSON.parse(localStorage.getItem(key) || 'null')
    if (validViewport(cached)) initialViewport = { ...cached }
  } catch { /* The project viewport remains available when local storage is unavailable. */ }

  let initialized = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let lastCached = ''
  const ownsProject = () => Boolean(projectId && project.current?.id === projectId)

  function flush() {
    clearTimeout(timer)
    timer = undefined
    if (!initialized || !ownsProject() || !project.current?.canvas) return
    const next = flow.getViewport()
    if (!validViewport(next)) return
    const viewport = { x: next.x, y: next.y, zoom: next.zoom }
    const json = JSON.stringify(viewport)
    if (json !== lastCached) {
      try {
        // Synchronous fallback: IndexedDB cannot be awaited while a tab is closing.
        localStorage.setItem(key, json)
        lastCached = json
      } catch {
        // Do not let a stale cache override the normally saved project next time.
        try { localStorage.removeItem(key) } catch { /* Storage may be disabled entirely. */ }
      }
    }
    const previous = project.current.canvas.viewport
    if (previous?.x !== viewport.x || previous?.y !== viewport.y || previous?.zoom !== viewport.zoom) {
      project.setCanvas({ ...project.current.canvas, viewport })
    }
  }

  function ready() {
    initialized = true
    flush()
  }

  watch(flow.viewport, () => {
    if (!initialized || !ownsProject()) return
    clearTimeout(timer)
    timer = setTimeout(flush, 120)
  }, { deep: true, flush: 'sync' })

  function saveOnPageExit() {
    flush()
    if (ownsProject() && project.dirty) {
      void project.save().catch(error => console.warn('[canvas] viewport save failed', error))
    }
  }
  function onVisibilityChange() {
    if (document.visibilityState === 'hidden') saveOnPageExit()
  }

  onBeforeRouteLeave(async () => {
    flush()
    if (!ownsProject() || !project.dirty) return
    try {
      await project.save()
    } catch (error) {
      toast.error(`项目保存失败，请重试：${(error as Error)?.message || error}`)
      return false
    }
  })

  onMounted(() => {
    window.addEventListener('beforeunload', saveOnPageExit)
    window.addEventListener('pagehide', saveOnPageExit)
    document.addEventListener('visibilitychange', onVisibilityChange)
  })
  onBeforeUnmount(() => {
    saveOnPageExit()
    window.removeEventListener('beforeunload', saveOnPageExit)
    window.removeEventListener('pagehide', saveOnPageExit)
    document.removeEventListener('visibilitychange', onVisibilityChange)
  })

  return { initialViewport, ready, flush }
}
