<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { AgentConversation } from '@/types'
import { renameAgentConversation } from '@/services/canvas/taskStore'
const props = defineProps<{ conversations: AgentConversation[]; activeId: string; disabled?: boolean }>()
const emit = defineEmits<{ open: [id: string] }>()
const root = ref<HTMLElement>(), all = ref(false), query = ref(''), editing = ref(''), draft = ref(''), error = ref(''), saving = ref(false)
const history = computed(() => props.conversations.filter(c => c.messages.length || c.customTitle))
const matching = computed(() => history.value.filter(c => c.title.toLowerCase().includes(query.value.trim().toLowerCase())))
const visible = computed(() => all.value ? matching.value : history.value.slice(0, 3))
function age(value: number) {
  const minutes = Math.max(0, Math.floor((Date.now() - value) / 60000))
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes}分钟`
  if (minutes < 1440) return `${Math.floor(minutes / 60)}小时`
  if (minutes < 2880) return '昨天'
  return new Date(value).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}
async function rename(id: string) {
  if (props.disabled || saving.value) return
  const item = history.value.find(c => c.id === id)
  if (!item) return
  all.value = true; query.value = ''; editing.value = id; draft.value = item.title; error.value = ''
  await nextTick()
  const input = root.value?.querySelector<HTMLInputElement>('[aria-label="对话名称"]'); input?.focus(); input?.select()
}
async function cancel(focus = true) {
  const id = editing.value; editing.value = ''; error.value = ''
  if (focus) { await nextTick(); root.value?.querySelector<HTMLButtonElement>(`[data-conversation-id="${CSS.escape(id)}"] .conversation-rename`)?.focus() }
}
async function save() {
  if (props.disabled || saving.value || !editing.value) return
  if (!draft.value.trim()) { error.value = '请输入对话名称'; return }
  saving.value = true; error.value = ''
  try { await renameAgentConversation(editing.value, draft.value); await cancel() }
  catch (e: any) { error.value = e.message || '保存失败，请重试' }
  finally { saving.value = false }
}
function keys(event: KeyboardEvent) {
  if (event.key === 'Escape' && editing.value) { event.preventDefault(); event.stopPropagation(); if (!saving.value) void cancel() }
}
watch(() => props.disabled, value => { if (value) void cancel(false) })
defineExpose({ rename })
</script>
<template>
  <section ref="root" class="codex-history" aria-label="当前项目的会话" @keydown="keys">
    <div v-if="all" class="history-search"><input v-model="query" aria-label="搜索项目会话" placeholder="搜索会话…" :disabled="saving" /><button type="button" aria-label="收起全部会话" :disabled="saving" @click="all = false; query = ''">收起</button></div>
    <div class="history-rows" role="list">
      <div v-for="chat in visible" :key="chat.id" class="history-entry" :data-conversation-id="chat.id" role="listitem">
        <form v-if="editing === chat.id" class="conversation-rename-form" @submit.prevent="save">
          <input v-model="draft" aria-label="对话名称" maxlength="60" :disabled="saving || disabled" autocomplete="off" @input="error = ''" @keydown.enter.prevent="!$event.isComposing && save()" />
          <div class="rename-actions"><span v-if="error" class="rename-error" role="alert">{{ error }}</span><button type="button" :disabled="saving" @click="cancel()">取消</button><button type="submit" :disabled="saving || disabled">{{ saving ? '保存中…' : '保存' }}</button></div>
        </form>
        <template v-else>
          <button type="button" class="history-open conversation-select" :aria-current="chat.id === activeId ? 'true' : undefined" :aria-label="`打开会话 ${chat.title}`" :disabled="disabled || saving" @click="emit('open', chat.id)"><span :title="chat.title">{{ chat.title }}</span><time :datetime="new Date(chat.updatedAt).toISOString()" :title="new Date(chat.updatedAt).toLocaleString('zh-CN')">{{ age(chat.updatedAt) }}</time></button>
          <button type="button" class="conversation-rename" :aria-label="`重命名对话 ${chat.title}`" title="重命名" :disabled="disabled || saving" @click="rename(chat.id)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 5 4 4M4 20l2-6L17 3l4 4L10 18z" /></svg></button>
        </template>
      </div>
    </div>
    <button v-if="!all && history.length > 3" type="button" class="history-view-all" @click="all = true">查看全部（{{ history.length }}）</button>
    <p v-if="all && !matching.length" class="history-empty">没有找到匹配的会话</p>
    <p v-else-if="!history.length" class="history-empty">还没有会话。在下方输入，开始新的创作。</p>
    <div v-if="!all && !editing" class="history-space" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5h10l7 11-7 11H11L4 16z"/><path d="m11 12 4 4-4 4M18 20h5"/></svg></div>
  </section>
</template>
<style scoped>
.codex-history{display:flex;flex-direction:column;flex:1;min-height:0;overflow:auto;padding:0 12px 12px;color:var(--color-text-1);font-size:12px}
.history-rows{display:flex;flex-direction:column;gap:1px;flex-shrink:0}.history-entry{display:flex;align-items:center;min-width:0;border-radius:7px}.history-entry:hover,.history-entry:focus-within{background:var(--color-fill)}
button,input{font:inherit}button{border:0;background:transparent;color:inherit;cursor:pointer}button:disabled{opacity:.4;cursor:default}button:focus-visible{outline:2px solid var(--color-accent);outline-offset:-2px}
.history-open{display:flex;align-items:center;gap:12px;flex:1;min-width:0;padding:8px 6px;text-align:left}.history-open>span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.history-open time{flex-shrink:0;color:var(--color-text-4);font-size:10px}
.conversation-rename{display:flex;justify-content:center;align-items:center;width:25px;height:25px;flex-shrink:0;margin-right:2px;padding:5px;color:var(--color-text-3);opacity:0}.history-entry:hover .conversation-rename,.conversation-rename:focus-visible{opacity:1}.conversation-rename:hover{color:var(--color-text-1)}
.history-view-all{padding:5px 6px;align-self:flex-start;font-size:11px;color:var(--color-text-4)}.history-view-all:hover{color:var(--color-text-2)}.history-search{display:flex;align-items:center;gap:6px;padding:4px 0 9px;flex-shrink:0}.history-search input{flex:1;min-width:0;padding:7px 8px;border:1px solid var(--color-border);border-radius:7px;background:var(--color-bg-1);color:var(--color-text-1);outline-color:var(--color-accent)}.history-search button{font-size:10px;color:var(--color-text-3)}
.history-empty{font-size:11px;line-height:1.7;color:var(--color-text-4);margin:8px 6px}.history-space{display:grid;place-items:center;flex:1;min-height:60px;color:var(--color-text-4);opacity:.3}.history-space svg{width:34px;height:34px}
.conversation-rename-form{flex:1;min-width:0;padding:6px}.conversation-rename-form input{box-sizing:border-box;width:100%;padding:7px 8px;border:1px solid var(--color-accent);border-radius:6px;background:var(--color-bg-1);color:var(--color-text-1);outline-color:var(--color-accent)}.rename-actions{display:flex;align-items:center;justify-content:flex-end;gap:5px;margin-top:5px}.rename-actions button{padding:4px 7px;font-size:11px}.rename-actions button[type=submit]{color:var(--color-accent)}.rename-error{flex:1;font-size:10px;color:#f59a9a}
@media(hover:none){.conversation-rename{opacity:1}}@media(max-width:500px){.conversation-rename{opacity:1}.codex-history{padding-inline:10px}}
</style>
