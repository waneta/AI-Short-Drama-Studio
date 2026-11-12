<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'

const props = defineProps<{ label: string; summary: string; disabled?: boolean }>()
const open = ref(false)
const trigger = ref<HTMLButtonElement>()
const panel = ref<HTMLDivElement>()
const id = useId()
const position = ref({ left: '0px', top: '0px', maxHeight: '80vh' })
function place() {
  const rect = trigger.value?.getBoundingClientRect()
  if (!rect || !panel.value) return
  const width = Math.min(340, window.innerWidth - 24)
  const height = panel.value.getBoundingClientRect().height
  const above = rect.top - 10
  const below = window.innerHeight - rect.bottom - 10
  const useAbove = above >= height || above > below
  const space = Math.max(120, (useAbove ? above : below) - 12)
  position.value = {
    left: `${Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))}px`,
    top: `${useAbove ? Math.max(12, rect.top - Math.min(height, space) - 10) : rect.bottom + 10}px`,
    maxHeight: `${space}px`
  }
}
function close(restoreFocus = false) {
  open.value = false
  if (restoreFocus) trigger.value?.focus()
}
function outside(event: PointerEvent) {
  if (!panel.value?.contains(event.target as Node) && !trigger.value?.contains(event.target as Node)) close()
}
function keyboard(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); close(true) }
  if (event.key !== 'Tab' || !panel.value) return
  const items = [...panel.value.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), summary')]
  const first = items[0], last = items[items.length - 1]
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
}
function detach() {
  document.removeEventListener('pointerdown', outside, true)
  document.removeEventListener('keydown', keyboard, true)
  window.removeEventListener('resize', place)
  window.removeEventListener('scroll', place, true)
}
watch(open, async value => {
  detach()
  if (!value) return
  await nextTick()
  if (!open.value) return
  place()
  panel.value?.querySelector<HTMLElement>('button')?.focus()
  document.addEventListener('pointerdown', outside, true)
  document.addEventListener('keydown', keyboard, true)
  window.addEventListener('resize', place)
  window.addEventListener('scroll', place, true)
})
watch(() => props.disabled, value => { if (value) close() })
onBeforeUnmount(detach)
</script>

<template>
  <button ref="trigger" type="button" class="generation-settings-trigger nodrag nowheel" :disabled="disabled"
    :aria-label="label" :aria-expanded="open" :aria-controls="id" aria-haspopup="dialog"
    @pointerdown.stop @mousedown.stop @click.stop="open = !open">
    <span class="settings-icon" aria-hidden="true">▭</span><span>{{ summary }}</span><span aria-hidden="true">⌃</span>
  </button>
  <Teleport to="body">
    <div v-if="open" :id="id" ref="panel" role="dialog" :aria-label="label" class="generation-settings-panel nodrag nowheel"
      :style="position" @pointerdown.stop @mousedown.stop @click.stop @wheel.stop>
      <div class="settings-panel-heading"><span>{{ label }}</span><button type="button" aria-label="关闭参数设置" @click="close(true)">×</button></div>
      <slot />
    </div>
  </Teleport>
</template>

<style>
.generation-settings-trigger { display:inline-flex; align-items:center; justify-content:space-between; gap:8px; max-width:100%; min-width:0; height:30px; padding:0 10px; border:1px solid var(--color-border, #414149); border-radius:8px; background:var(--color-bg-2, #27272c); color:var(--color-text-2, #ddd); font:inherit; font-size:11px; cursor:pointer; }
.generation-settings-trigger > span:nth-child(2) { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.generation-settings-trigger:hover, .generation-settings-trigger[aria-expanded=true] { border-color:var(--color-accent, #94b9ff); }
.generation-settings-trigger:disabled { opacity:.55; cursor:wait; }
.generation-settings-panel { position:fixed; z-index:10000; width:min(340px, calc(100vw - 24px)); overflow:auto; overscroll-behavior:contain; box-sizing:border-box; padding:16px; border:1px solid var(--color-border, #414149); border-radius:16px; background:var(--color-bg-1, #202024); color:var(--color-text-1, #eee); box-shadow:0 16px 60px #0006; font-family:inherit; font-size:12px; }
.settings-panel-heading { display:flex; align-items:center; justify-content:space-between; margin-bottom:14px; font-weight:600; }
.settings-panel-heading button { width:24px; height:24px; border:0; border-radius:6px; color:var(--color-text-3, #aaa); background:transparent; cursor:pointer; font-size:18px; }
.generation-settings-panel .settings-section { margin-bottom:16px; }
.generation-settings-panel .settings-section:last-child { margin-bottom:0; }
.generation-settings-panel .settings-label { display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:8px; font-size:12px; color:var(--color-text-2, #ddd); }
.generation-settings-panel .settings-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:7px; }
.generation-settings-panel .settings-grid.two { grid-template-columns:repeat(2,minmax(0,1fr)); }
.generation-settings-panel .settings-option { min-width:0; min-height:33px; padding:7px 5px; border:1px solid var(--color-border, #414149); border-radius:9px; background:var(--color-bg-2, #29292f); color:var(--color-text-2, #ddd); font:inherit; font-size:12px; cursor:pointer; }
.generation-settings-panel .settings-option.on { border-color:var(--color-accent, #94b9ff); background:color-mix(in srgb,var(--color-accent, #94b9ff) 12%,var(--color-bg-2, #29292f)); color:var(--color-text-1, #fff); }
.generation-settings-panel button:disabled, .generation-settings-panel input:disabled { cursor:wait; opacity:.5; }
.generation-settings-panel :focus-visible { outline:2px solid var(--color-accent, #94b9ff); outline-offset:2px; }
.generation-settings-panel .settings-note { margin:7px 0 0; color:var(--color-text-3, #aaa); font-size:11px; line-height:1.6; }
.generation-settings-panel .settings-note.error { color:var(--color-danger, #ff9292); }
.generation-settings-panel .settings-input { width:100%; height:32px; box-sizing:border-box; border:1px solid var(--color-border, #414149); border-radius:7px; padding:0 8px; background:var(--color-bg-2, #29292f); color:var(--color-text-1, #eee); font:inherit; }
</style>
