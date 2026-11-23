<script setup lang="ts">
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { useSettingsStore } from '@/stores'
import { assistantActiveTasks } from '@/services/assistant/state'
import { codexStatusState, readCodexStatus } from '@/services/assistant/transport'

const props = defineProps<{ disabled?: boolean }>()
const settings = useSettingsStore(), root = ref<HTMLDetailsElement>()
const loading = ref(false), error = ref(''), page = ref<'effort' | 'models'>('effort')
const preview = ref<string>()
const locked = computed(() => Boolean(props.disabled) || assistantActiveTasks.value > 0)
const labels: Record<string, string> = { low: '轻', medium: '中', high: '高', xhigh: '极高', max: 'Max', ultra: 'Ultra' }
const status = codexStatusState
const modelId = computed(() => settings.config.codexModel || status.value?.defaultModel || status.value?.models.find(m => m.isDefault)?.model || '')
const model = computed(() => status.value?.models.find(m => m.model === modelId.value))
const efforts = computed(() => model.value?.supportedReasoningEfforts || [])
const inherited = computed(() => {
  const configured = status.value?.configuredEffort
  return configured && (!efforts.value.length || efforts.value.includes(configured)) ? configured : model.value?.defaultReasoningEffort
})
const selectedEffort = computed(() => preview.value || settings.config.codexEffort || inherited.value || '')
const effortLabel = computed(() => labels[selectedEffort.value] || '跟随配置')
const effortIndex = computed(() => Math.max(0, efforts.value.indexOf(selectedEffort.value)))
const fill = computed(() => efforts.value.length > 1 ? effortIndex.value / (efforts.value.length - 1) : 0)
function shortModel(id: string) {
  return id.replace(/^gpt-/, '').replace(/-/g, ' ').replace(/\b(sol|astra|terra|luna)\b/g, value => value[0].toUpperCase() + value.slice(1))
}
const modelLabel = computed(() => modelId.value ? shortModel(modelId.value) : '默认模型')
const modelOptions = computed(() => {
  const options = (status.value?.models || []).map(m => ({ id: m.model, label: /^gpt-/.test(m.model) ? shortModel(m.model) : m.name, saved: false }))
  if (settings.config.codexModel && !options.some(m => m.id === settings.config.codexModel)) options.unshift({ id: settings.config.codexModel, label: shortModel(settings.config.codexModel), saved: true })
  return options
})
function close(focus = false) {
  if (root.value) root.value.open = false
  page.value = 'effort'; preview.value = undefined
  if (focus) root.value?.querySelector('summary')?.focus()
}
async function save(patch: { codexModel?: string; codexEffort?: string }) {
  if (locked.value) return
  error.value = ''; settings.update(patch)
  try { await settings.flush() } catch (e: any) { error.value = e.message || '保存失败，请重试' }
}
async function refresh() {
  if (loading.value || locked.value) return
  loading.value = true; error.value = ''
  try { await readCodexStatus() } catch (e: any) { error.value = e.message }
  finally { loading.value = false }
}
async function showModels() {
  if (locked.value) return
  page.value = 'models'; preview.value = undefined
  await nextTick()
  root.value?.querySelector<HTMLButtonElement>('[role="menuitemradio"][aria-checked="true"]')?.focus()
}
function pickModel(id: string) {
  if (locked.value || loading.value) return
  const nextId = id || status.value?.defaultModel || status.value?.models.find(m => m.isDefault)?.model
  const next = status.value?.models.find(m => m.model === nextId)
  void save({ codexModel: id, codexEffort: next?.supportedReasoningEfforts?.includes(settings.config.codexEffort) ? settings.config.codexEffort : '' })
  close(true)
}
function slide(event: Event, commit = false) {
  if (locked.value || loading.value) return
  const value = efforts.value[Number((event.target as HTMLInputElement).value)]
  if (!value) return
  preview.value = value
  if (commit) { void save({ codexEffort: value }); preview.value = undefined }
}
function modelKeys(event: KeyboardEvent) {
  if (['Enter', ' '].includes(event.key)) {
    const item = (event.target as HTMLElement).closest<HTMLButtonElement>('[role="menuitemradio"]')
    if (item) { event.preventDefault(); event.stopPropagation(); item.click() }
    return
  }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const items = Array.from(root.value?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') || [])
  const current = items.indexOf(document.activeElement as HTMLButtonElement)
  const index = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
  items[index]?.focus()
}
watch(() => settings.config.codexModel, () => {
  preview.value = undefined
  if (!locked.value && settings.config.codexEffort && status.value && !efforts.value.includes(settings.config.codexEffort)) void save({ codexEffort: '' })
})
watch(locked, value => { if (value) close() })
function outside(event: PointerEvent) { if (root.value && !root.value.contains(event.target as Node)) close() }
onMounted(() => { document.addEventListener('pointerdown', outside); if (!status.value) void refresh() })
onBeforeUnmount(() => document.removeEventListener('pointerdown', outside))
</script>

<template>
  <details ref="root" class="codex-run-select" @keydown.esc.prevent.stop="close(true)" @toggle="!root?.open && close()">
    <summary class="run-summary" aria-label="Codex 模型与推理强度" :aria-disabled="locked" :title="`${modelId || '默认模型'} · ${effortLabel}`" @click="locked && $event.preventDefault()">
      <span>{{ modelLabel }}</span><b>{{ effortLabel }}</b><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m5 6 3 3 3-3" /></svg>
    </summary>
    <div class="run-panel" :class="{ 'model-page': page === 'models' }">
      <template v-if="page === 'effort'">
        <div class="effort-heading">
          <span class="effort-current" aria-live="polite">{{ loading ? '读取中…' : effortLabel }}</span>
          <button type="button" class="reset-effort icon-button" aria-label="恢复默认强度" :title="`恢复跟随配置${inherited ? `：${labels[inherited] || inherited}` : ''}`" :disabled="locked || loading || !settings.config.codexEffort" @click="preview = undefined; save({ codexEffort: '' })">
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 7a6 6 0 1 1-.3 5M4 3v4h4" /></svg>
          </button>
        </div>
        <button type="button" class="model-link" aria-label="选择 Codex 模型" :disabled="locked || loading" @click="showModels">{{ modelLabel }}<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 4 4 4-4 4" /></svg></button>
        <div v-if="efforts.length" class="effort-slider" :style="{ '--fill': `calc(14px + (100% - 28px) * ${fill})` }">
          <div class="effort-ticks" aria-hidden="true"><i v-for="(value, index) in efforts" :key="value" :class="{ passed: index <= effortIndex }" /></div>
          <input type="range" min="0" :max="efforts.length - 1" step="1" :value="effortIndex" aria-label="Codex 推理强度" :aria-valuetext="effortLabel" :disabled="locked || loading || efforts.length < 2" @input="slide($event)" @change="slide($event, true)" />
        </div>
        <p v-else-if="!loading" class="picker-note">接入未提供强度列表，沿用本机配置。</p>
        <p v-if="selectedEffort === 'ultra'" class="picker-note">此处调整强度，暂不提供桌面的多助手协作。</p>
      </template>
      <template v-else>
        <div class="model-heading"><button type="button" class="icon-button" aria-label="返回强度选择" @click="page = 'effort'"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m10 4-4 4 4 4" /></svg></button><span>选择模型</span><button type="button" class="icon-button refresh-models" aria-label="刷新 Codex 模型列表" :disabled="locked || loading" @click="refresh"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 7a6 6 0 1 1-.3 5M4 3v4h4" /></svg></button></div>
        <div class="model-list" role="menu" aria-label="Codex 对话模型" @keydown="modelKeys">
          <button type="button" role="menuitemradio" data-model="" :aria-checked="!settings.config.codexModel" :disabled="locked || loading" @click="pickModel('')"><span>默认<small>跟随接入配置</small></span><svg v-if="!settings.config.codexModel" class="check" viewBox="0 0 16 16" aria-hidden="true"><path d="m3 8 3 3 7-7" /></svg></button>
          <button v-for="item in modelOptions" :key="item.id" type="button" role="menuitemradio" :data-model="item.id" :aria-checked="settings.config.codexModel === item.id" :disabled="locked || loading" @click="pickModel(item.id)"><span>{{ item.label }}<small v-if="item.saved">已保存</small></span><svg v-if="settings.config.codexModel === item.id" class="check" viewBox="0 0 16 16" aria-hidden="true"><path d="m3 8 3 3 7-7" /></svg></button>
        </div>
      </template>
      <p v-if="error" class="picker-error" role="alert">{{ error }} <button type="button" :disabled="locked || loading" @click="refresh">重试</button></p>
    </div>
  </details>
</template>

<style scoped>
.codex-run-select{position:relative;margin-left:auto;min-width:0;font-size:11px;color:var(--color-text-2);flex-shrink:1}
.run-summary{list-style:none;display:flex;align-items:center;gap:5px;padding:5px 8px;cursor:pointer;border-radius:16px;white-space:nowrap;max-width:175px;background:var(--color-bg-2)}
.run-summary::-webkit-details-marker{display:none}.run-summary:hover{background:var(--color-fill)}.run-summary>span:first-child{overflow:hidden;text-overflow:ellipsis}.run-summary b{font-weight:400;color:var(--color-text-3)}.run-summary[aria-disabled=true]{opacity:.5;cursor:wait}
svg{width:15px;height:15px;flex-shrink:0;fill:none;stroke:currentColor;stroke-width:1.4;stroke-linecap:round;stroke-linejoin:round}
.run-panel{position:absolute;bottom:calc(100% + 9px);right:0;width:min(254px,calc(100vw - 36px));box-sizing:border-box;z-index:160;padding:13px 12px 12px;border:1px solid var(--color-border);border-radius:16px;background:var(--color-bg-1);box-shadow:0 10px 34px #0004;color:var(--color-text-1)}
button{font:inherit;color:inherit;cursor:pointer;border:0;background:transparent}button:disabled,input:disabled{opacity:.45;cursor:wait}button:focus-visible,summary:focus-visible{outline:2px solid var(--color-accent,#4b9fff);outline-offset:2px}
.effort-heading{position:relative;text-align:center;min-height:20px}.effort-current{font-size:14px;font-weight:500;color:var(--color-accent,#4b9fff)}.icon-button{display:flex;align-items:center;justify-content:center;width:24px;height:24px;padding:4px;border-radius:7px;color:var(--color-text-3)}.icon-button:hover:not(:disabled){background:var(--color-fill);color:var(--color-text-1)}.reset-effort{position:absolute;right:-3px;top:-3px}
.model-link{display:flex;align-items:center;justify-content:center;gap:1px;max-width:100%;margin:1px auto 11px;padding:1px 6px;color:var(--color-text-3);font-size:11px;border-radius:5px;overflow-wrap:anywhere}.model-link:hover{color:var(--color-text-1)}.model-link svg{width:12px;height:12px}
.effort-slider{position:relative;height:28px;border-radius:20px;background:linear-gradient(to right,var(--color-accent,#4b9fff) 0 var(--fill),var(--color-fill,#42424a) var(--fill) 100%)}.effort-ticks{position:absolute;inset:0 14px;display:flex;align-items:center;justify-content:space-between;pointer-events:none}.effort-ticks i{width:4px;height:4px;border-radius:50%;background:var(--color-text-3);opacity:.5}.effort-ticks i.passed{background:#fff}
.effort-slider input{appearance:none;-webkit-appearance:none;position:relative;display:block;z-index:1;margin:0;width:100%;height:28px;background:transparent;cursor:pointer;border-radius:20px}.effort-slider input::-webkit-slider-runnable-track{height:28px;background:transparent;border-radius:20px}.effort-slider input::-webkit-slider-thumb{appearance:none;-webkit-appearance:none;width:28px;height:28px;border:1px solid #00000012;border-radius:50%;background:#fff;box-shadow:0 1px 4px #0003}.effort-slider input::-moz-range-track{height:28px;background:transparent}.effort-slider input::-moz-range-thumb{width:27px;height:27px;border:1px solid #00000012;border-radius:50%;background:#fff;box-shadow:0 1px 4px #0003}.effort-slider input:focus-visible{outline:2px solid var(--color-accent,#4b9fff);outline-offset:4px}
.model-page{padding:8px 6px;max-height:min(430px,65vh);overflow:auto}.model-heading{display:flex;align-items:center;gap:4px;padding:0 3px 5px;color:var(--color-text-3)}.model-heading>span{flex:1;font-size:11px}.model-heading .refresh-models{margin-left:auto}.model-list{display:grid;gap:1px}.model-list button{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:32px;padding:7px 10px;text-align:left;border-radius:8px;font-size:12px}.model-list button:hover:not(:disabled),.model-list button:focus-visible{background:var(--color-fill)}.model-list button[aria-checked=true]{color:var(--color-text-1)}.model-list button>span{min-width:0;overflow-wrap:anywhere}.model-list small{display:block;font-size:10px;color:var(--color-text-3);margin-top:2px}.check{width:14px;height:14px;color:var(--color-text-2)}
.picker-note,.picker-error{font-size:10px;line-height:1.5;color:var(--color-text-3);margin:9px 1px 0}.picker-error{color:#f59a9a;overflow-wrap:anywhere}.picker-error button{text-decoration:underline}
@media(max-width:500px){.run-summary{max-width:120px;gap:3px;padding:4px 6px}.run-panel{right:-24px}}
</style>
