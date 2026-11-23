/** Let Vue Flow move panel backgrounds while controls keep their own pointer interaction. */
const NODE_CONTROL_SELECTOR = [
  'button', 'input', 'textarea', 'select', 'option', 'label', 'a', 'audio', 'video',
  '[contenteditable]', '[role="textbox"]', '[role="button"]', '[role="menu"]', '[role="listbox"]',
  '[draggable="true"]', '.nodrag', '.nopan'
].join(',')

export function stopNodeDragFromControls(event: Event, isolate = false) {
  const target = event.target
  if (isolate) { event.stopPropagation(); return }
  if (!(target instanceof Element) || !(event.currentTarget instanceof Element)) return
  const control = target.closest(NODE_CONTROL_SELECTOR)
  // Vue Flow's outer node itself has role=button; only controls inside this panel should block a drag.
  if (control && event.currentTarget.contains(control)) event.stopPropagation()
}
