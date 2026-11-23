<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
export type CanvasContextItem = { id: string; label: string; shortcut?: string; title?: string; disabled?: boolean; separator?: boolean; danger?: boolean }
const props = defineProps<{ x: number; y: number; label: string; rating: number; showRating: boolean; busy: boolean; items: CanvasContextItem[] }>()
const emit = defineEmits<{ close: []; action: [id: string]; rate: [value: number] }>()
const menu = ref<HTMLElement>(), left = ref(props.x), top = ref(props.y), hoverRating = ref(0)
let priorFocus: HTMLElement | null = null
async function position() {
  await nextTick()
  const rect = menu.value?.getBoundingClientRect()
  if (!rect) return
  left.value = Math.max(8, Math.min(props.x, innerWidth - rect.width - 8))
  top.value = Math.max(8, Math.min(props.y, innerHeight - rect.height - 8))
}
function outside(event: PointerEvent) { if (event.target instanceof Node && !menu.value?.contains(event.target)) emit('close') }
function key(event: KeyboardEvent) {
  if (event.isComposing) return
  const mod = event.ctrlKey || event.metaKey
  const action = mod && !event.altKey ? ({ c: 'copy', v: 'paste', d: 'duplicate' } as Record<string, string>)[event.key.toLowerCase()] : event.key === 'Delete' || event.key === 'Backspace' ? 'delete' : undefined
  if (action) { event.preventDefault(); event.stopPropagation(); if (props.items.some(item => item.id === action && !item.disabled)) emit('action', action); return }
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); emit('close'); return }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Tab'].includes(event.key)) return
  event.preventDefault(); event.stopPropagation()
  const buttons = Array.from(menu.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || [])
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowUp' || (event.key === 'Tab' && event.shiftKey) ? -1 : 1) + buttons.length) % buttons.length
  buttons[next]?.focus()
}
watch(() => [props.x, props.y, props.items], () => { void position(); hoverRating.value = 0 })
onMounted(() => { priorFocus = document.activeElement as HTMLElement; void position(); menu.value?.focus({ preventScroll: true }); window.addEventListener('pointerdown', outside, true); window.addEventListener('resize', position) })
onBeforeUnmount(() => { window.removeEventListener('pointerdown', outside, true); window.removeEventListener('resize', position); if (document.activeElement === menu.value || menu.value?.contains(document.activeElement)) priorFocus?.focus({ preventScroll: true }) })
</script>
<template>
  <div ref="menu" class="node-context-menu nodrag nopan nokey" role="menu" :aria-label="`${label}右键菜单`" tabindex="-1" :style="{ left:`${left}px`, top:`${top}px` }" @keydown="key" @pointerdown.stop @mousedown.stop @click.stop @contextmenu.prevent.stop>
    <div v-if="showRating" class="context-rating"><span>评级</span><div @mouseleave="hoverRating=0"><button v-for="star in 5" :key="star" type="button" role="menuitemradio" :aria-checked="rating===star" :aria-label="`评分${star}星`" :title="rating===star?'再次点击清除评分':`${star}星`" :disabled="busy" :class="{filled:star <= (hoverRating || rating)}" @mouseenter="hoverRating=star" @focus="hoverRating=star" @blur="hoverRating=0" @click="emit('rate',rating===star?0:star)"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m10 1.8 2.45 4.96 5.48.8-3.97 3.86.94 5.46L10 14.3l-4.9 2.58.94-5.46L2.07 7.56l5.48-.8Z" /></svg></button></div></div>
    <template v-for="item in items" :key="item.id"><div v-if="item.separator" class="context-divider" role="separator" /><button type="button" role="menuitem" class="context-item" :class="{danger:item.danger}" :data-context-action="item.id" :disabled="item.disabled || busy" :title="item.title" @click="emit('action',item.id)"><span>{{ item.label }}</span><kbd v-if="item.shortcut">{{ item.shortcut }}</kbd></button></template>
  </div>
</template>
<style scoped>
.node-context-menu { position:fixed; z-index:9001; width:236px; max-width:calc(100vw - 16px); max-height:calc(100dvh - 16px); overflow-y:auto; box-sizing:border-box; padding:7px; border:1px solid var(--color-border); border-radius:14px; background:var(--color-bg-1); color:var(--color-text-1); box-shadow:0 12px 44px #0003,0 2px 6px #0002; outline:none; }
.context-item { display:flex; align-items:center; justify-content:space-between; gap:14px; width:100%; min-height:34px; padding:7px 10px; border:0; border-radius:7px; background:transparent; color:inherit; text-align:left; font:inherit; font-size:12px; cursor:pointer; }
.context-item:hover:not(:disabled),.context-item:focus-visible { background:var(--color-fill-hover); outline:none; }
.context-item:disabled { color:var(--color-text-3); opacity:.48; cursor:default; }
.context-item.danger:hover:not(:disabled) { color:var(--color-error,#f87171); background:#f8717112; }
kbd { font:inherit; font-size:11px; white-space:nowrap; color:var(--color-text-3); }
.context-divider { height:1px; margin:5px 7px; background:var(--color-border); }
.context-rating { display:flex; align-items:center; justify-content:space-between; padding:8px 10px; font-size:12px; min-height:18px; }
.context-rating > div { display:flex; gap:1px; }
.context-rating button { border:0; background:none; padding:1px; width:17px; height:19px; color:var(--color-text-3); opacity:.55; cursor:pointer; }
.context-rating button.filled { color:#e6b34b; opacity:1; }
.context-rating button:focus-visible { outline:1px solid var(--color-accent); border-radius:3px; }
.context-rating svg { width:15px; height:15px; fill:currentColor; }
</style>
