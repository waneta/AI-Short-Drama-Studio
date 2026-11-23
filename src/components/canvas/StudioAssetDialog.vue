<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useLightbox } from '@/composables/useLightbox'
const props=defineProps<{label:string;wide?:boolean;busy?:boolean}>()
const emit=defineEmits<{close:[]}>()
const box=ref<HTMLElement>(),previous=document.activeElement as HTMLElement|null,lightbox=useLightbox()
onMounted(async()=>{document.addEventListener('keydown',outsideKeys,true);await nextTick();(box.value?.querySelector<HTMLElement>('input,button') || box.value)?.focus()})
onBeforeUnmount(()=>{document.removeEventListener('keydown',outsideKeys,true);if(previous?.isConnected)previous.focus()})
function outsideKeys(event:KeyboardEvent){
  const dialogs=[...document.querySelectorAll('.asset-dialog')]
  if(dialogs[dialogs.length-1]!==box.value || box.value?.contains(event.target as Node))return
  // Removing a playing item can move focus to body; the top dialog still owns keys.
  keys(event)
  if(!lightbox.src.value && event.key!=='Escape' && event.key!=='Tab')box.value?.focus()
}
function keys(event:KeyboardEvent){
  event.stopPropagation()
  if(event.key==='Escape'){event.preventDefault();if(lightbox.src.value){lightbox.close();return}if(!props.busy)emit('close');return}
  if(event.key==='Tab'){
    const items=[...(box.value?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href],audio[controls],[tabindex="0"]') || [])].filter(e=>e.getClientRects().length)
    const first=items[0],last=items[items.length-1]
    if(!first){event.preventDefault();return}
    if(!box.value?.contains(document.activeElement)){event.preventDefault();(event.shiftKey?last:first).focus()}
    else if(event.shiftKey && (document.activeElement===first || document.activeElement===box.value)){event.preventDefault();last.focus()}
    else if(!event.shiftKey && document.activeElement===last){event.preventDefault();first.focus()}
  }
}
</script>
<template>
  <Teleport to="body"><div class="asset-dialog-backdrop studio-asset-surface" :class="{wide}" @pointerdown.self="!busy && emit('close')">
    <section ref="box" class="asset-dialog" :class="{wide}" role="dialog" aria-modal="true" :aria-label="label" tabindex="-1" @keydown="keys"><slot /></section>
  </div></Teleport>
</template>
<style scoped>
.asset-dialog-backdrop{position:fixed;inset:0;z-index:4100;background:#0008;display:flex;align-items:center;justify-content:center;padding:24px;backdrop-filter:blur(4px)}
.asset-dialog-backdrop.wide{z-index:3100}
.asset-dialog{box-sizing:border-box;width:390px;max-width:100%;max-height:calc(100dvh - 48px);overflow:auto;border:1px solid var(--color-border);border-radius:18px;background:var(--color-bg-1);color:var(--color-text-1);box-shadow:0 24px 100px #0007;outline:none;padding:24px}
.asset-dialog.wide{width:1180px;height:min(780px,calc(100dvh - 72px));padding:0;display:flex;overflow:hidden}
@media(max-width:700px){.asset-dialog-backdrop{padding:12px}.asset-dialog.wide{height:calc(100dvh - 24px)} }
</style>
