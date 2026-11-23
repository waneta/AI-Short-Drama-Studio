<script setup lang="ts">
import { computed, ref } from 'vue'
import { Handle, Position, useVueFlow } from '@vue-flow/core'

const { viewport, connectionStartHandle, connectionClickStartHandle } = useVueFlow()
const connecting = computed(() => Boolean(connectionStartHandle.value || connectionClickStartHandle.value))
const offsets = ref({ in: { x: 0, y: 0 }, out: { x: 0, y: 0 } })
const ports = [
  { id: 'in' as const, type: 'target' as const, position: Position.Left, side: -1, label: '输入锚点' },
  { id: 'out' as const, type: 'source' as const, position: Position.Right, side: 1, label: '输出锚点' }
]
function follow(event: PointerEvent, id: 'in' | 'out', side: number) {
  if (connecting.value || event.buttons) return
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const zoom = viewport.value.zoom
  const x = (event.clientX - rect.left - rect.width / 2) / zoom - side * 22
  const y = (event.clientY - rect.top - rect.height / 2) / zoom
  const scale = Math.min(1, 14 / (Math.hypot(x, y) || 1))
  offsets.value[id] = { x: x * scale, y: y * scale }
}
function reset(id: 'in' | 'out') { offsets.value[id] = { x: 0, y: 0 } }
function activate(event: KeyboardEvent) {
  const element = event.currentTarget as HTMLElement
  const rect = element.getBoundingClientRect()
  element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2 }))
}
</script>

<template>
  <Handle v-for="port in ports" :key="port.id" :id="port.id" :type="port.type" :position="port.position"
    class="magnetic-handle nokey" :class="{ 'is-connecting': connecting }"
    :style="{ '--anchor-x': `${port.side * 22}px`, '--follow-x': `${offsets[port.id].x}px`, '--follow-y': `${offsets[port.id].y}px` }"
    role="button" tabindex="0" :aria-label="`${port.label}，点击后选择另一节点锚点连线`" :title="`${port.label} · 点击或拖动连线，Esc取消`"
    @pointermove="follow($event, port.id, port.side)" @pointerleave="reset(port.id)"
    @keydown.enter.prevent.stop="activate" @keydown.space.prevent.stop="activate">
    <span class="anchor-button" aria-hidden="true"><svg viewBox="0 0 20 20"><path d="M10 5v10M5 10h10" /></svg></span>
  </Handle>
</template>

<style scoped>
/* Only the visual button moves. The real handle stays on the node border, so
   established edges do not jump when the pointer enters the magnetic region. */
.magnetic-handle { width:8px; height:8px; min-width:0; min-height:0; border:0; background:transparent; border-radius:50%; overflow:visible; z-index:5; cursor:crosshair; }
.magnetic-handle::before { content:''; position:absolute; left:calc(50% + var(--anchor-x)); top:50%; width:72px; height:72px; border-radius:50%; transform:translate(-50%,-50%); }
.anchor-button { position:absolute; left:calc(50% + var(--anchor-x)); top:50%; transform:translate(calc(-50% + var(--follow-x)),calc(-50% + var(--follow-y))); display:grid; place-items:center; width:22px; height:22px; box-sizing:border-box; border:1px solid var(--color-text-3); border-radius:50%; color:var(--color-text-2); background:var(--color-bg-1); box-shadow:0 2px 5px #0002; opacity:0; pointer-events:none; transition:opacity .14s ease, border-color .14s ease, background .14s ease; }
.anchor-button svg { width:16px; height:16px; fill:none; stroke:currentColor; stroke-width:1.3; stroke-linecap:round; }
:global(.vue-flow__node:hover .magnetic-handle .anchor-button),
.magnetic-handle:hover .anchor-button,
.magnetic-handle:focus-visible .anchor-button,
.magnetic-handle.is-connecting .anchor-button { opacity:1; }
.magnetic-handle:hover .anchor-button,
.magnetic-handle:focus-visible .anchor-button,
.magnetic-handle.connecting .anchor-button { color:var(--color-accent); border-color:var(--color-accent); background:var(--color-bg-2); }
.magnetic-handle:focus { outline:none; }
@media (hover:none) and (pointer:coarse) { .anchor-button { opacity:1; } }
</style>
