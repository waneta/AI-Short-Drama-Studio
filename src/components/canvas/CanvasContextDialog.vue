<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import type { SubjectDraft, Verification } from '@/composables/useCanvasContextActions'
const props = defineProps<{ draft?: SubjectDraft; verification?: Verification; busy: boolean }>()
const emit = defineEmits<{ close: []; submit: [] }>()
const panel = ref<HTMLElement>()
let priorFocus: HTMLElement | null = null
function close() { if (!props.busy) emit('close') }
function key(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() }
  if (event.key !== 'Tab') return
  const items = Array.from(panel.value?.querySelectorAll<HTMLElement>('input,textarea,select,button:not(:disabled)') || [])
  if (!items.length) return
  if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1)?.focus() }
  else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0].focus() }
}
onMounted(async () => { priorFocus = document.activeElement as HTMLElement; await nextTick(); (panel.value?.querySelector<HTMLElement>('input,button') || panel.value)?.focus(); window.addEventListener('keydown', key, true) })
onBeforeUnmount(() => { window.removeEventListener('keydown', key, true); if (priorFocus?.isConnected) priorFocus.focus({ preventScroll: true }) })
</script>
<template>
  <Teleport to="body"><div class="context-dialog-mask" @pointerdown.self="close" @contextmenu.prevent><section ref="panel" class="context-dialog nodrag nopan nokey" role="dialog" aria-modal="true" :aria-label="draft?'创建主体':verification?.title" tabindex="-1" @pointerdown.stop @mousedown.stop>
    <header><strong>{{ draft?'创建主体':verification?.title }}</strong><button type="button" aria-label="关闭" :disabled="busy" @click="close">×</button></header>
    <form v-if="draft" @submit.prevent="emit('submit')"><div class="subject-reference"><img :src="draft.preview" alt="主体参考图" /><p>{{ draft.video?'以当前视频封面作为主体参考图':'以当前图片作为主体参考图' }}<br />创建后可在角色节点继续编辑</p></div><label>主体名称<input v-model="draft.name" aria-label="主体名称" maxlength="100" required :disabled="busy" /></label><label>主体类型<select v-model="draft.kind" aria-label="主体类型" :disabled="busy"><option value="person">人物</option><option value="animal">动物</option><option value="other">其他</option></select></label><label>外貌描述<textarea v-model="draft.description" aria-label="主体描述" placeholder="描述主体的外貌、服装或特征（可选）" rows="3" :disabled="busy" /></label><footer><button type="button" :disabled="busy" @click="close">取消</button><button type="submit" class="primary" :disabled="busy || !draft.name.trim()">{{ busy?'正在创建…':'创建主体' }}</button></footer></form>
    <template v-else-if="verification"><dl><div v-for="row in verification.rows" :key="row.label"><dt>{{ row.label }}</dt><dd :class="{bad:row.ok===false}"><span v-if="row.ok!==undefined" aria-hidden="true">{{ row.ok?'✓':'!' }}</span>{{ row.value }}</dd></div></dl><p class="verification-note">本地核验检查文件与媒体参数；内容合规需要供应商提供的专用服务。</p><footer><button type="button" class="primary" @click="close">完成</button></footer></template>
  </section></div></Teleport>
</template>
<style scoped>
.context-dialog-mask { position:fixed; inset:0; z-index:9500; display:grid; place-items:center; padding:20px; background:#0007; backdrop-filter:blur(3px); }
.context-dialog { box-sizing:border-box; width:440px; max-width:100%; max-height:calc(100dvh - 40px); overflow:auto; padding:20px; border:1px solid var(--color-border); border-radius:16px; background:var(--color-bg-1); color:var(--color-text-1); box-shadow:0 18px 60px #0005; font-size:12px; }
header { display:flex; align-items:center; justify-content:space-between; margin-bottom:18px; font-size:14px; } header button { border:0; background:transparent; color:var(--color-text-3); font-size:22px; cursor:pointer; }
.subject-reference { display:flex; align-items:center; gap:14px; margin-bottom:18px; } .subject-reference img { width:96px; height:96px; object-fit:contain; border-radius:9px; background:var(--color-bg-2); } p { color:var(--color-text-3); line-height:1.8; font-size:11px; }
label { display:grid; gap:7px; margin-bottom:14px; color:var(--color-text-2); } input,select,textarea { box-sizing:border-box; width:100%; border:1px solid var(--color-border); border-radius:8px; background:var(--color-bg-2); color:var(--color-text-1); padding:9px; font:inherit; } input:focus,select:focus,textarea:focus { outline:1px solid var(--color-accent); }
footer { display:flex; justify-content:flex-end; gap:8px; margin-top:20px; } footer button { border:1px solid var(--color-border); border-radius:8px; padding:8px 16px; font:inherit; background:transparent; color:var(--color-text-1); cursor:pointer; } footer .primary { background:var(--color-accent); color:#fff; border-color:transparent; } button:disabled { opacity:.5; cursor:default; }
dl { display:grid; gap:0; margin:0; } dl > div { display:grid; grid-template-columns:90px 1fr; padding:12px 0; border-bottom:1px solid var(--color-border); gap:12px; } dt { color:var(--color-text-3); } dd { margin:0; overflow-wrap:anywhere; } dd > span { color:#67b89b; padding-right:7px; } dd.bad,dd.bad > span { color:var(--color-error,#f87171); }
</style>
