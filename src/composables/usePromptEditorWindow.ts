import { computed, onBeforeUnmount, ref, watch, type Ref } from 'vue'

type WindowRect = { x: number; y: number; width: number; height: number }

/** Screen-space geometry: moving the document never changes canvas geometry. */
export function usePromptEditorWindow(open: Ref<boolean>) {
  const viewport = ref({ width: window.innerWidth, height: window.innerHeight })
  const normalRect = ref<WindowRect>()
  const maximized = ref(false)
  const dragging = ref(false)
  const fontSize = ref(16)
  const backdrop = ref(12)
  let drag: { pointerId: number; x: number; y: number; rect: WindowRect; handle: HTMLElement } | undefined

  function clamp(rect: WindowRect): WindowRect {
    const width = Math.min(rect.width, Math.max(0, viewport.value.width - 24))
    const height = Math.min(rect.height, Math.max(0, viewport.value.height - 24))
    return { width, height, x: Math.max(12, Math.min(rect.x, viewport.value.width - width - 12)), y: Math.max(12, Math.min(rect.y, viewport.value.height - height - 12)) }
  }
  const rect = computed(() => {
    const { width: vw, height: vh } = viewport.value
    if (maximized.value) return { x: 12, y: 12, width: Math.max(0, vw - 24), height: Math.max(0, vh - 24) }
    if (normalRect.value) return clamp(normalRect.value)
    const inset = vw <= 760 ? 12 : 48
    const width = Math.min(1160, Math.max(0, vw - inset * 2))
    const height = Math.min(920, Math.max(0, vh - inset * 2))
    return { x: (vw - width) / 2, y: (vh - height) / 2, width, height }
  })
  const style = computed(() => open.value ? {
    left: `${rect.value.x}px`, top: `${rect.value.y}px`, width: `${rect.value.width}px`, height: `${rect.value.height}px`,
    '--prompt-editor-font-size': `${fontSize.value}px`
  } : undefined)
  const maskStyle = computed(() => ({ backgroundColor: `rgba(0, 0, 0, ${backdrop.value / 100})` }))

  function endDrag(event?: PointerEvent) {
    if (!drag || (event && drag.pointerId !== event.pointerId)) return
    const handle = drag.handle, pointerId = drag.pointerId
    drag = undefined
    dragging.value = false
    window.removeEventListener('pointermove', move, true)
    window.removeEventListener('pointerup', endDrag, true)
    window.removeEventListener('pointercancel', endDrag, true)
    window.removeEventListener('blur', cancelDrag)
    if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId)
  }
  function cancelDrag() { endDrag() }
  function move(event: PointerEvent) {
    if (!drag || drag.pointerId !== event.pointerId) return
    event.preventDefault()
    normalRect.value = clamp({ ...drag.rect, x: drag.rect.x + event.clientX - drag.x, y: drag.rect.y + event.clientY - drag.y })
  }
  function startDrag(event: PointerEvent) {
    if (event.button !== 0 || maximized.value) return
    event.preventDefault()
    endDrag()
    const handle = event.currentTarget as HTMLElement
    drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, rect: { ...rect.value }, handle }
    dragging.value = true
    handle.setPointerCapture(event.pointerId)
    window.addEventListener('pointermove', move, { capture: true, passive: false })
    window.addEventListener('pointerup', endDrag, true)
    window.addEventListener('pointercancel', endDrag, true)
    window.addEventListener('blur', cancelDrag)
  }
  function moveByKey(event: KeyboardEvent) {
    if (maximized.value || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
    event.preventDefault()
    event.stopPropagation()
    const step = event.shiftKey ? 40 : 10
    const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0
    const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0
    normalRect.value = clamp({ ...rect.value, x: rect.value.x + dx, y: rect.value.y + dy })
  }
  function toggleMaximized() { endDrag(); maximized.value = !maximized.value }
  function center() { endDrag(); maximized.value = false; normalRect.value = undefined }
  function resize() { endDrag(); viewport.value = { width: window.innerWidth, height: window.innerHeight } }
  watch(open, value => {
    endDrag()
    if (value) { resize(); window.addEventListener('resize', resize) }
    else window.removeEventListener('resize', resize)
  }, { flush: 'sync' })
  onBeforeUnmount(() => { endDrag(); window.removeEventListener('resize', resize) })

  return { style, maskStyle, maximized, dragging, fontSize, backdrop, startDrag, moveByKey, toggleMaximized, center }
}
