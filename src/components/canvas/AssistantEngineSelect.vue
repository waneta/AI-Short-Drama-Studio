<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { useSettingsStore } from '@/stores'
import { assistantActiveTasks } from '@/services/assistant/state'
import { readCodexStatus, type CodexStatus } from '@/services/assistant/transport'
const props = defineProps<{ disabled?: boolean; active?: boolean }>()
const settings = useSettingsStore()
const root = ref<HTMLDetailsElement>()
const status = ref<CodexStatus>(), error = ref(''), checking = ref(false)
const locked = computed(() => props.disabled || assistantActiveTasks.value > 0)
const label = computed(() => settings.config.assistantEngine === 'codex' ? 'Codex 助手' : '原始 API 助手')
function close(focus = false) {
  if (!root.value?.open) return
  root.value.open = false
  if (focus) root.value.querySelector('summary')?.focus({ preventScroll: true })
}
function outside(event: PointerEvent) {
  if (event.target instanceof Node && !root.value?.contains(event.target)) close()
}
function focusOut(event: FocusEvent) {
  if (event.relatedTarget instanceof Node && !root.value?.contains(event.relatedTarget)) close()
}
watch(locked, value => { if (value) close() })
watch(() => props.active, value => { if (value === false) close() })
onMounted(() => document.addEventListener('pointerdown', outside, true))
onBeforeUnmount(() => document.removeEventListener('pointerdown', outside, true))
async function check() {
  checking.value = true; error.value = ''; status.value = undefined
  try { status.value = await readCodexStatus() } catch (e: any) { error.value = e.message }
  finally { checking.value = false }
}
function pickEngine(event: Event) {
  if (locked.value) return
  settings.update({ assistantEngine: (event.target as HTMLSelectElement).value === 'codex' ? 'codex' : 'api' })
  if (settings.config.assistantEngine === 'codex') void check()
  close(true)
}
function pickModel(event: Event) {
  if (locked.value) return
  settings.update({ codexModel: (event.target as HTMLSelectElement).value })
  close(true)
}
</script>
<template>
  <details ref="root" class="assistant-engine" @keydown.esc.prevent.stop="close(true)" @focusout="focusOut">
    <summary @click="locked && $event.preventDefault()" :aria-disabled="locked" :title="locked ? '等待当前文本任务结束后再切换' : '切换 AI 助手与文本功能的执行引擎'">{{ label }} ▾</summary>
    <div class="engine-panel">
      <div class="engine-heading"><span>助手设置</span><button type="button" class="close-engine" aria-label="关闭助手设置" title="关闭 · Esc" @click="close(true)">×</button></div>
      <label>文本智能引擎<select aria-label="文本智能引擎" :value="settings.config.assistantEngine" :disabled="locked" @change="pickEngine"><option value="api">原始 API 助手</option><option value="codex">Codex 助手</option></select></label>
      <p>写剧本、拆分镜、优化与翻译跟随此选择。</p>
      <template v-if="settings.config.assistantEngine === 'codex'">
        <label>Codex 模型<select aria-label="Codex 模型" :value="settings.config.codexModel" :disabled="locked" @change="pickModel"><option value="">跟随 Codex 默认模型</option><option v-if="settings.config.codexModel && !status?.models.some(m => m.model === settings.config.codexModel)" :value="settings.config.codexModel">{{ settings.config.codexModel }}（已保存）</option><option v-for="model in status?.models || []" :key="model.id" :value="model.model">{{ model.name }}</option></select></label>
        <button type="button" :disabled="checking" @click="check">{{ checking ? '检查中…' : '检查 Codex 登录与模型' }}</button>
        <p v-if="status" role="status">{{ status.authType === 'existing' ? status.connectionIssue || '已加载本机 Codex 当前配置；模型调用按该接入处理' : status.authType === 'custom' ? '自定义接口已配置；凭证与工具兼容性需实际请求验证' : status.authenticated ? '已识别 Codex 登录' : '尚未登录：请到语言模型配置页开始设备登录' }}</p>
        <p v-if="error" class="engine-error" role="alert">{{ error }}</p>
        <p>授权和额度由所选 Codex 接入决定；生图、视频和视觉接入各自独立。</p>
      </template>
      <p v-else>使用设置页当前 LLM 接入及 API Key。</p>
      <RouterLink to="/settings/llm" @click="close()">语言模型连接配置 →</RouterLink>
    </div>
  </details>
</template>
<style scoped>
.assistant-engine{position:relative;font-size:11px;color:var(--color-text-3,#aaa)}
summary{cursor:pointer;list-style:none;padding:5px 7px;border:1px solid var(--color-border,#444);border-radius:7px;white-space:nowrap}
summary[aria-disabled=true]{opacity:.55;cursor:wait}
.engine-heading{display:flex;align-items:center;justify-content:space-between;margin:-4px -4px 8px 0;color:var(--color-text-3,#aaa)}
.engine-heading .close-engine{width:24px;height:24px;padding:0;border:0;background:transparent;font-size:19px;line-height:1;border-radius:5px;cursor:pointer}.close-engine:hover{background:var(--color-fill-hover,#ffffff12);color:var(--color-text-1,#eee)}
summary:focus-visible,button:focus-visible{outline:2px solid var(--color-accent,#4b9fff);outline-offset:2px}
.engine-panel{position:absolute;right:0;top:100%;margin-top:6px;z-index:150;width:270px;padding:12px;border:1px solid var(--color-border,#444);border-radius:10px;background:var(--color-bg-1,#202024);box-shadow:0 8px 30px #0007;color:var(--color-text-1,#eee)}
label{display:grid;gap:5px;margin-bottom:8px}select,button{font:inherit;color:inherit;background:var(--color-bg-2,#303036);border:1px solid var(--color-border,#555);padding:6px;border-radius:6px;width:100%}p{line-height:1.55;margin:7px 0;color:var(--color-text-3,#aaa)}.engine-error{color:#f6a29b}
@media(max-width:500px){.assistant-engine{position:static}.engine-panel{left:10px;right:10px;top:100%;width:auto;box-sizing:border-box;margin-top:0;max-height:calc(100dvh - 260px);overflow:auto}}
</style>
