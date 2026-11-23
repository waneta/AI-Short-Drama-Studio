import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useProjectStore, useToastStore } from '@/stores'
import { runningNodeIds } from '@/services/canvas/jobs'
import type { Project } from '@/types'

type Snapshot = Pick<Project, 'canvas' | 'subjects' | 'scenes' | 'shots' | 'script'>
export function useCanvasHistory(clearSelection: () => void) {
  const project = useProjectStore(), toast = useToastStore()
  const entries = ref<string[]>([]), index = ref(-1)
  let timer: ReturnType<typeof setTimeout> | undefined, paused = false, replay = false
  const serialized = () => {
    const p = project.current
    if (!p) return ''
    const canvas = p.canvas ? { ...p.canvas, viewport: undefined } : undefined
    return JSON.stringify({ canvas, subjects: p.subjects, scenes: p.scenes, shots: p.shots, script: p.script })
  }
  function flush() {
    clearTimeout(timer)
    if (paused || replay || runningNodeIds.value.length) return
    const value = serialized()
    if (!value || value === entries.value[index.value]) return
    entries.value = [...entries.value.slice(0, index.value + 1), value].slice(-60)
    index.value = entries.value.length - 1
  }
  watch(() => project.current?.id, () => { clearTimeout(timer); entries.value = []; index.value = -1; paused = false; flush() }, { immediate: true })
  watch(serialized, () => { if (!paused && !replay) { clearTimeout(timer); timer = setTimeout(flush, 350) } })
  watch(() => runningNodeIds.value.length, count => { if (!count) flush() })
  function begin() { flush(); clearTimeout(timer); paused = true }
  function end() { paused = false; flush() }
  function restore(delta: number) {
    if (runningNodeIds.value.length) { toast.warn('生成完成后再撤销或重做'); return }
    flush()
    const target = index.value + delta, p = project.current
    if (!p || target < 0 || target >= entries.value.length) return
    replay = true; clearTimeout(timer)
    const snapshot = JSON.parse(entries.value[target]) as Snapshot
    const viewport = p.canvas?.viewport || { x: 0, y: 0, zoom: 1 }
    p.subjects = snapshot.subjects; p.scenes = snapshot.scenes; p.shots = snapshot.shots; p.script = snapshot.script
    if (snapshot.canvas) project.setCanvas({ ...snapshot.canvas, viewport })
    index.value = target
    clearSelection()
    replay = false
  }
  onBeforeUnmount(() => clearTimeout(timer))
  return { flush, begin, end, undo: () => restore(-1), redo: () => restore(1), canUndo: computed(() => index.value > 0), canRedo: computed(() => index.value < entries.value.length - 1) }
}
