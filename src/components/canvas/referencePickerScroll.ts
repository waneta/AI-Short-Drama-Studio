/** Smooth large wheel steps in the reference popup and assistant message area. */
export function createReferencePickerScroll(getList: () => HTMLElement | null, step = 48) {
  let frame: number | undefined
  let target = 0
  let direction = 0

  function stop() {
    if (frame !== undefined) cancelAnimationFrame(frame)
    frame = undefined
    direction = 0
  }

  function onWheel(event: WheelEvent) {
    event.stopPropagation()
    const list = getList()
    if (!list || event.ctrlKey || event.metaKey || event.shiftKey || !event.cancelable || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
      stop()
      return
    }
    // Fine pixel deltas (touchpad inertia included) stay under native control.
    if (event.deltaMode === 0 && Math.abs(event.deltaY) < 40) {
      stop()
      return
    }
    const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? list.clientHeight : 1)
    if (!Number.isFinite(pixels) || pixels === 0) return
    event.preventDefault()
    const delta = Math.max(-step, Math.min(step, pixels))
    const from = list.scrollTop
    const pending = frame !== undefined && direction === Math.sign(delta) ? target : from
    target = Math.max(0, Math.min(list.scrollHeight - list.clientHeight, from + step * 3, Math.max(from - step * 3, pending + delta)))
    stop()
    if (target === from) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      list.scrollTop = target
      return
    }
    direction = Math.sign(delta)
    const started = performance.now()
    function tick(now: number) {
      if (getList() !== list) { stop(); return }
      const progress = Math.min(1, Math.max(0, (now - started) / 120))
      list!.scrollTop = from + (target - from) * (1 - (1 - progress) ** 2)
      if (progress < 1) frame = requestAnimationFrame(tick)
      else { frame = undefined; direction = 0 }
    }
    frame = requestAnimationFrame(tick)
  }

  return { onWheel, stop, isScrolling: () => frame !== undefined }
}
