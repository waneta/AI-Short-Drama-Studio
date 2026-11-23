<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue'
import { shortcutSections, type CanvasCommand } from '@/services/canvas/shortcuts'
const emit = defineEmits<{ close: []; command: [command: CanvasCommand] }>()
const panel = ref<HTMLElement>()
let priorFocus: HTMLElement | null = null
function closeKey(event: KeyboardEvent) { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); emit('close') } }
onMounted(() => { priorFocus = document.activeElement as HTMLElement; panel.value?.focus(); window.addEventListener('keydown', closeKey, true) })
onBeforeUnmount(() => { window.removeEventListener('keydown', closeKey, true); priorFocus?.focus() })
</script>
<template>
  <section ref="panel" class="shortcut-panel nodrag nopan nokey" role="dialog" aria-label="画布快捷键" tabindex="-1" @pointerdown.stop @mousedown.stop @click.stop>
    <header><strong>画布快捷键</strong><span>Mac 可用 ⌘ 代替 Ctrl · 输入文字时保留编辑器快捷键</span><button type="button" aria-label="关闭快捷键" @click="emit('close')">×</button></header>
    <div class="shortcut-columns">
      <section v-for="section in shortcutSections" :key="section.title"><h3>{{ section.title }}</h3>
        <template v-for="row in section.rows" :key="row.label">
          <button v-if="row.command" class="shortcut-row" type="button" @click="emit('command', row.command); emit('close')"><span>{{ row.label }}</span><kbd>{{ row.keys }}</kbd></button>
          <div v-else class="shortcut-row"><span>{{ row.label }}</span><kbd>{{ row.keys }}</kbd></div>
        </template>
      </section>
    </div>
    <footer>在空白处拖动左键框选 · Shift 点击增选 · 复制适用于图片、视频和用户组合 · Esc 取消连线或清除选择</footer>
  </section>
</template>
<style scoped>
.shortcut-panel { position:absolute; left:50%; bottom:78px; transform:translateX(-50%); width:min(1120px,calc(100% - 32px)); max-height:calc(100% - 105px); overflow:auto; z-index:60; box-sizing:border-box; border:1px solid var(--color-border); border-radius:16px; background:var(--color-bg-1); color:var(--color-text-1); box-shadow:0 14px 50px #0006; padding:20px; outline:none; }
header { display:flex; align-items:center; gap:16px; margin-bottom:20px; } header strong { font-size:14px; } header span { font-size:11px; color:var(--color-text-3); } header button { margin-left:auto; border:0; background:transparent; color:var(--color-text-2); font-size:24px; cursor:pointer; }
.shortcut-columns { display:grid; grid-template-columns:1.25fr 1fr 1.15fr 1fr; gap:20px; }
.shortcut-columns > section + section { border-left:1px solid var(--color-border); padding-left:20px; }
h3 { margin:0 0 14px; font-size:12px; font-weight:500; color:var(--color-accent); }
.shortcut-row { display:flex; align-items:center; justify-content:space-between; gap:10px; width:100%; min-height:36px; box-sizing:border-box; padding:4px 0; font:inherit; font-size:11px; color:var(--color-text-2); border:0; background:transparent; text-align:left; }
button.shortcut-row { cursor:pointer; } button.shortcut-row:hover { color:var(--color-accent); }
kbd { font:inherit; font-size:10px; white-space:nowrap; color:var(--color-text-1); padding:3px 5px; border:1px solid var(--color-border); border-radius:5px; background:var(--color-bg-2); }
footer { border-top:1px solid var(--color-border); padding-top:12px; margin-top:16px; font-size:11px; color:var(--color-text-3); }
@media(max-width:1100px) { .shortcut-columns { grid-template-columns:1fr 1fr; gap:18px; } .shortcut-columns > section + section { border:0; padding:0; } }
@media(max-width:600px) { .shortcut-columns { grid-template-columns:1fr; } header span { display:none; } }
</style>
