import { ref, watch } from 'vue'

/** Local-only HTML drag state prevents drops from other nodes or external files. */
export function useReferenceReorder(options: {
  ids: () => string[]
  scope: () => string
  disabled: () => boolean
  commit: (ids: string[]) => void | Promise<void>
}) {
  const dragging = ref('')
  const target = ref('')
  const after = ref(false)
  let snapshot: string[] = [], scope = ''
  function end() { dragging.value = ''; target.value = ''; after.value = false }
  watch([options.scope, options.disabled], end)
  function valid() {
    return !options.disabled() && scope === options.scope() && snapshot.join('\0') === options.ids().join('\0')
  }
  function start(event: DragEvent, id: string) {
    if (options.disabled() || !event.dataTransfer || !options.ids().includes(id)) { event.preventDefault(); return }
    dragging.value = id; snapshot = [...options.ids()]; scope = options.scope()
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('application/x-juliu-reference', id)
  }
  function over(event: DragEvent, id: string) {
    if (!dragging.value || !valid() || !snapshot.includes(id)) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    target.value = id
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
    after.value = event.clientX >= rect.left + rect.width / 2
  }
  function leave(event: DragEvent) {
    if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) target.value = ''
  }
  async function drop(event: DragEvent, id: string) {
    if (!dragging.value || !valid() || !snapshot.includes(id)) { end(); return }
    event.preventDefault()
    const source = dragging.value
    over(event, id)
    const next = snapshot.filter(item => item !== source)
    const index = next.indexOf(id)
    if (index >= 0) next.splice(index + (after.value ? 1 : 0), 0, source)
    end()
    if (index >= 0 && next.some((item, i) => item !== snapshot[i])) await options.commit(next)
  }
  async function key(event: KeyboardEvent, id: string) {
    if (event.target !== event.currentTarget || !event.altKey || !['ArrowLeft', 'ArrowRight'].includes(event.key) || options.disabled()) return
    event.preventDefault(); event.stopPropagation()
    const next = [...options.ids()], from = next.indexOf(id), to = from + (event.key === 'ArrowLeft' ? -1 : 1)
    if (from < 0 || to < 0 || to >= next.length) return
    ;[next[from], next[to]] = [next[to], next[from]]
    await options.commit(next)
  }
  return { dragging, target, after, start, over, leave, drop, end, key }
}
