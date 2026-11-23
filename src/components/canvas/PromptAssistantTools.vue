<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useProjectStore, useToastStore } from '@/stores'
import { optimizeFreeformImagePrompt, optimizeFreeformVideoPrompt } from '@/services/canvas/runner'
import { resolvedCanvasReferenceAssetIds } from '@/services/canvas/references'
import { referenceAudioIds, videoReferenceBindings } from '@/services/canvas/videoReferences'
import { bindLegacyVideoReferences, videoReferenceParts } from '@/services/ai/videoReferenceTokens'
import { analyzePromptDensity, planPromptClips, translatePromptToEnglish, validatePromptClips, type PromptClip } from '@/services/ai/promptAssistance'
import { addPromptClipNodes } from '@/services/canvas/promptClips'

const props = defineProps<{ nodeId: string; isVideo: boolean; isH3: boolean; duration: number; minDuration: number; maxDuration: number; durationOptions?: number[]; disabled?: boolean }>()
const emit = defineEmits<{ busy: [value: boolean] }>()
const project = useProjectStore(), toast = useToastStore()
const node = computed(() => project.current?.canvas?.nodes.find(n => n.id === props.nodeId))
const source = computed(() => node.value?.data.prompt || '')
const bindings = computed(() => props.isVideo && node.value && project.current ? videoReferenceBindings(resolvedCanvasReferenceAssetIds(project.current, node.value), referenceAudioIds(node.value.data), node.value.data.videoReferenceOrder) : [])
const canonical = computed(() => bindLegacyVideoReferences(source.value, bindings.value))
const context = computed(() => JSON.stringify([project.current?.id, props.nodeId, node.value?.data, bindings.value]))
const density = computed(() => analyzePromptDensity(source.value, props.duration))
const busy = ref<'' | 'optimize' | 'translate' | 'split'>('')
const optimizeError = ref(''), optimizeStatus = ref('')
const dialog = ref<'' | 'translate' | 'check'>('')
const original = ref(''), translated = ref(''), reviewContext = ref(''), clips = ref<PromptClip[]>([]), error = ref('')
const previous = ref<{ before: string; after: string; key: string }>()
const canUndo = computed(() => previous.value?.after === source.value && previous.value.key === undoKey())
const panel = ref<HTMLElement>()
let controller: AbortController | undefined, priorFocus: HTMLElement | null = null
function undoKey() { const data = { ...node.value?.data, prompt: '' }; return JSON.stringify([project.current?.id, props.nodeId, data, bindings.value]) }
function readable(text: string) { if (!props.isVideo) return text; return videoReferenceParts(bindLegacyVideoReferences(text, bindings.value)).map(p => p.token ? `@${bindings.value.find(b => b.id === p.id && b.kind === p.kind)?.number || '?'}` : p.text || '').join('') }
function setBusy(value: typeof busy.value) { busy.value = value; emit('busy', Boolean(value)) }
function cancelRequest() { controller?.abort(); controller = undefined; setBusy('') }
function close() { cancelRequest(); dialog.value = ''; error.value = ''; void nextTick(() => priorFocus?.isConnected && priorFocus.focus({ preventScroll: true })) }
function open(kind: 'translate' | 'check') {
  priorFocus = document.activeElement as HTMLElement
  original.value = canonical.value; reviewContext.value = context.value
  translated.value = ''; clips.value = []; error.value = ''; dialog.value = kind
  void nextTick(() => panel.value?.focus({ preventScroll: true }))
}
function unchanged(snapshot: string) { if (snapshot !== context.value) throw new Error('节点内容、参数或素材已变化，请重新打开后操作。') }
async function optimize() {
  if (props.disabled || busy.value || (props.isVideo && !props.isH3)) return
  if (!source.value.trim()) { optimizeStatus.value = ''; optimizeError.value = '请先写提示词'; toast.warn('请先写提示词'); return }
  const before = source.value
  optimizeError.value = ''; optimizeStatus.value = ''
  controller = new AbortController(); const request = controller
  setBusy('optimize')
  try {
    const result = await (props.isVideo ? optimizeFreeformVideoPrompt : optimizeFreeformImagePrompt)(props.nodeId, request.signal)
    if (request.signal.aborted || request !== controller) return
    if (result === before) { optimizeStatus.value = '当前提示词已符合优化格式，无需修改'; return }
    previous.value = { before, after: result, key: undoKey() }
    optimizeStatus.value = '已优化提示词，可点击撤销恢复原文'
    toast.success(props.isVideo ? '已按 H3 格式优化提示词，可撤销' : '已优化图片提示词，可撤销')
  } catch (e) { if (!request.signal.aborted) { optimizeError.value = e instanceof Error ? e.message : '优化失败，请重试'; toast.error(optimizeError.value) } }
  finally { if (controller === request) { controller = undefined; setBusy('') } }
}
function cancelOptimization() { cancelRequest(); optimizeStatus.value = '已取消优化，原提示词保留'; optimizeError.value = '' }
async function translate() {
  if (props.disabled || busy.value) return
  if (!source.value.trim()) { toast.warn('请先写提示词'); return }
  optimizeError.value = ''; optimizeStatus.value = ''
  open('translate'); controller = new AbortController(); const request = controller
  setBusy('translate')
  try {
    const result = await translatePromptToEnglish(original.value, request.signal)
    if (request.signal.aborted || request !== controller) return
    unchanged(reviewContext.value); translated.value = result
  } catch (e) { if (!request.signal.aborted) error.value = e instanceof Error ? e.message : '翻译失败' }
  finally { if (controller === request) { controller = undefined; setBusy('') } }
}
async function applyTranslation() {
  if (props.disabled || busy.value || !translated.value) return
  try {
    unchanged(reviewContext.value)
    const before = source.value
    project.setCanvasNodePrompt(props.nodeId, translated.value)
    previous.value = { before, after: translated.value, key: undoKey() }
    await project.save(); close(); toast.success('已应用英文描述，中文对白和引用保持原样')
  } catch (e) { error.value = e instanceof Error ? e.message : '应用失败' }
}
async function undo() {
  if (props.disabled || busy.value || !canUndo.value || !previous.value) return
  project.setCanvasNodePrompt(props.nodeId, previous.value.before); previous.value = undefined
  await project.save(); toast.success('已恢复修改前的提示词')
}
async function split() {
  if (props.disabled || busy.value || !original.value.trim()) return
  controller = new AbortController(); const request = controller
  setBusy('split'); error.value = ''
  try {
    unchanged(reviewContext.value)
    const result = await planPromptClips(original.value, { min: props.minDuration, max: props.maxDuration, durations: props.durationOptions, target: density.value.suggestedClips }, request.signal)
    if (request.signal.aborted || request !== controller) return
    unchanged(reviewContext.value); clips.value = result
  } catch (e) { if (!request.signal.aborted) error.value = e instanceof Error ? e.message : '拆分草案生成失败' }
  finally { if (controller === request) { controller = undefined; setBusy('') } }
}
async function createClips() {
  if (props.disabled || busy.value || !clips.value.length) return
  try {
    unchanged(reviewContext.value)
    validatePromptClips(original.value, clips.value, { min: props.minDuration, max: props.maxDuration, durations: props.durationOptions })
    const result = addPromptClipNodes(project.current!.canvas!, props.nodeId, clips.value)
    project.setCanvas(result.graph); await project.save(); close(); toast.success(`已在原节点右侧创建 ${result.ids.length} 个片段，未开始生成`)
  } catch (e) { error.value = e instanceof Error ? e.message : '创建片段失败' }
}
function key(event: KeyboardEvent) {
  if (event.isComposing || event.keyCode === 229) return
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return }
  if (event.key !== 'Tab') return
  const items = [...panel.value!.querySelectorAll<HTMLElement>('button:not(:disabled),textarea,input,select')].filter(e => e.getClientRects().length)
  if (!items.length) { event.preventDefault(); return }
  if (event.shiftKey && (document.activeElement === items[0] || document.activeElement === panel.value)) { event.preventDefault(); items.at(-1)!.focus() }
  else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0].focus() }
}
watch(source, () => { if (!busy.value) { optimizeError.value = ''; optimizeStatus.value = '' } }, { flush: 'sync' })
watch(() => project.current?.id, () => { close(); previous.value = undefined; optimizeError.value = ''; optimizeStatus.value = '' })
onBeforeUnmount(cancelRequest)
defineExpose({ optimize })
</script>

<template>
  <div class="prompt-assistant-tools" role="group" aria-label="提示词工具">
    <button v-if="!isVideo || isH3" type="button" class="prompt-assist-icon" :class="{ working: busy === 'optimize' }" :disabled="disabled || !!busy" :aria-busy="busy === 'optimize'" aria-label="优化提示词" :title="busy === 'optimize' ? '正在优化提示词…' : isVideo ? '优化提示词 · 整理画面和对白' : 'AI优化图片提示词 · 整理构图、人物关系和参考图用途'" @click="optimize"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M8 11h5M8 15h8M8 18h5M18 2v6M15 5h6" /></svg><span v-if="busy === 'optimize'">优化中…</span></button>
    <button type="button" class="prompt-assist-icon" :disabled="disabled || !!busy" aria-label="翻译提示词" title="翻译提示词 · 画面描述转英文，保留中文台词与素材引用" @click="translate"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h11M8 3v2M5 5c0 5 3 8 7 10M12 5c-1 5-4 8-9 10M13 21l4-11 4 11M14.5 17h5" /></svg></button>
    <button v-if="isVideo" type="button" class="prompt-assist-icon density-check" :class="{ warning: density.issues.length }" :disabled="disabled || !!busy" aria-label="检查提示词与拆分" :title="density.issues.length ? `${density.issues.length}项内容密度提示 · 点击查看拆分建议` : '检查提示词与拆分建议'" @click="open('check')"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14v16H5zM8 8h8M8 12h5M8 16h8" /><circle v-if="density.issues.length" cx="19" cy="5" r="3" fill="currentColor" stroke="none" /></svg></button>
    <button v-if="canUndo" type="button" class="prompt-assist-icon" :disabled="disabled || !!busy" aria-label="撤销提示词修改" title="撤销本次优化或翻译" @click="undo"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 4-5 5 5 5M3 9h11a6 6 0 0 1 0 12h-3" /></svg></button>
  </div>
  <div v-if="busy === 'optimize' || optimizeError || optimizeStatus" class="prompt-optimize-feedback" :class="{ failed: optimizeError }" :role="optimizeError ? 'alert' : 'status'" aria-live="polite">
    <span>{{ busy === 'optimize' ? '正在优化提示词，请稍候…' : optimizeError || optimizeStatus }}</span>
    <button v-if="busy === 'optimize'" type="button" aria-label="取消优化提示词" @click="cancelOptimization">取消</button>
    <button v-else-if="optimizeError" type="button" :disabled="disabled || !!busy" aria-label="重试优化提示词" @click="optimize">重试</button>
    <button v-if="busy !== 'optimize'" type="button" aria-label="关闭优化提示" @click="optimizeError = ''; optimizeStatus = ''">×</button>
  </div>
  <Teleport to="body">
    <div v-if="dialog" class="prompt-assist-mask" @pointerdown.self.prevent @click.self="close">
      <section ref="panel" class="prompt-assist-dialog nodrag nopan nokey" role="dialog" aria-modal="true" :aria-label="dialog === 'translate' ? '提示词翻译对照' : '提示词检查与拆分'" tabindex="-1" @pointerdown.stop @mousedown.stop @click.stop @keydown="key">
        <header><div><h3>{{ dialog === 'translate' ? '翻译提示词' : '提示词检查与拆分' }}</h3><p>{{ dialog === 'translate' ? '画面、动作和运镜转为英文，中文对白和素材引用保留原样。' : '密度为经验估算，拆分草案保留原剧情与对白，不自动生成视频。' }}</p></div><button class="assist-close" type="button" aria-label="关闭提示词工具" @click="close">×</button></header>
        <main>
          <template v-if="dialog === 'translate'">
            <div class="translation-columns"><section><h4>原文</h4><pre>{{ readable(original) }}</pre></section><section><h4>英文描述 · 中文对白保留</h4><pre v-if="translated">{{ readable(translated) }}</pre><div v-else class="assist-empty">{{ busy ? '正在翻译，请稍候…' : '暂无翻译结果' }}</div></section></div>
          </template>
          <template v-else>
            <div class="density-stats"><span>当前时长 <b>{{ duration }}秒</b></span><span>识别镜头 <b>{{ density.shots || '未编号' }}</b></span><span>对白 <b>{{ density.lines }}句</b></span><span>对白估时 <b>约{{ density.speechSeconds }}秒</b></span></div>
            <ul v-if="density.issues.length" class="density-issues"><li v-for="issue in density.issues" :key="issue">{{ issue }}</li></ul><p v-else class="density-ok">未发现明显的镜头或对白密度问题，仍建议生成后逐句试听。</p>
            <p class="assist-advice">优先每段安排1个主要事件、1–3个镜头，明确谁说话、谁倾听。参考声音不保证精确台词；逐字准确的对白可单独配音，再检查或处理口型同步。</p>
            <div v-if="clips.length" class="clip-plan"><article v-for="(clip, i) in clips" :key="i"><div><h4>{{ i + 1 }}. {{ clip.title }}</h4><label>时长 <select v-if="durationOptions?.length" v-model.number="clip.duration" aria-label="片段时长"><option v-for="n in durationOptions" :key="n" :value="n">{{ n }}秒</option></select><input v-else v-model.number="clip.duration" type="number" :min="minDuration" :max="maxDuration" step="1" aria-label="片段时长" /> 秒</label></div><pre>{{ readable(clip.prompt) }}</pre></article></div>
            <p v-else class="assist-empty">生成拆分草案后，核对剧情、台词和时长，再创建独立视频节点。</p>
          </template>
          <p v-if="error" class="assist-error" role="alert">{{ error }}</p>
          <p v-if="reviewContext !== context" class="assist-error" role="alert">原节点已变化，请关闭后重新打开，避免覆盖新的编辑。</p>
        </main>
        <footer><span>{{ busy ? busy === 'split' ? '正在整理拆分草案…' : '正在翻译…' : dialog === 'translate' ? '应用后可在底部撤销修改' : '原节点保留，新片段沿用模型和参考素材' }}</span><button type="button" @click="close">{{ busy ? '取消' : '关闭' }}</button><button v-if="dialog === 'translate'" class="assist-primary" type="button" :disabled="disabled || !!busy || !translated || reviewContext !== context" @click="applyTranslation">应用翻译</button><template v-else><button type="button" :disabled="disabled || !!busy || !original.trim() || reviewContext !== context" @click="split">{{ clips.length ? '重新生成草案' : '生成拆分草案' }}</button><button v-if="clips.length" class="assist-primary" type="button" :disabled="disabled || !!busy || reviewContext !== context" @click="createClips">创建 {{ clips.length }} 个视频节点</button></template></footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.prompt-assistant-tools { display:flex; align-items:center; gap:2px; flex-shrink:0; }
.prompt-assist-icon { display:grid; place-items:center; width:28px; height:30px; padding:5px; border:0; border-radius:6px; background:transparent; color:var(--color-text-2); cursor:pointer; }
.prompt-assist-icon svg { width:18px; height:18px; fill:none; stroke:currentColor; stroke-width:1.6; stroke-linecap:round; stroke-linejoin:round; }
.prompt-assist-icon:hover:not(:disabled) { background:var(--color-bg-3); color:var(--color-text-1); }
.prompt-assist-icon:disabled { opacity:.4; cursor:default; }
.prompt-assist-icon.warning { color:#dba94d; }
.prompt-assist-icon.working { display:flex; width:auto; gap:5px; color:var(--color-accent); white-space:nowrap; font-size:11px; }
.prompt-assist-icon.working svg { animation:assist-spin 1.5s linear infinite; }
.prompt-optimize-feedback { display:flex; align-items:flex-start; flex:1 0 100%; order:1; gap:8px; min-width:0; padding:8px 10px; box-sizing:border-box; border-radius:7px; background:var(--color-bg-2); color:var(--color-text-2); font-size:12px; line-height:1.7; }
.prompt-optimize-feedback > span { flex:1; min-width:0; white-space:pre-wrap; overflow-wrap:anywhere; }
.prompt-optimize-feedback.failed { color:#ef9b85; }
.prompt-optimize-feedback button { flex-shrink:0; padding:1px 4px; border:0; border-radius:4px; background:transparent; color:inherit; font:inherit; cursor:pointer; }
.prompt-optimize-feedback button:hover { background:var(--color-bg-3); }
.prompt-optimize-feedback button:disabled { opacity:.4; cursor:default; }
.prompt-assist-mask { position:fixed; inset:0; z-index:12000; display:grid; place-items:center; background:#0003; padding:20px; box-sizing:border-box; }
.prompt-assist-dialog { display:flex; flex-direction:column; width:min(1100px,100%); max-height:calc(100dvh - 40px); border:1px solid var(--color-border); border-radius:16px; background:var(--color-bg-1); color:var(--color-text-1); box-shadow:0 24px 80px #0005; outline:none; }
header { display:flex; align-items:flex-start; gap:12px; padding:20px 24px; border-bottom:1px solid var(--color-border); }
h3 { font-size:17px; margin:0 0 7px; } header p { margin:0; font-size:12px; line-height:1.6; color:var(--color-text-3); }
.assist-close { margin-left:auto; width:28px; flex-shrink:0; height:28px; border:0; border-radius:5px; background:transparent; color:var(--color-text-2); font-size:23px; cursor:pointer; }
main { padding:20px 24px; overflow:auto; min-height:0; }
.translation-columns { display:grid; grid-template-columns:1fr 1fr; gap:18px; min-height:280px; }
.translation-columns > section { min-width:0; border:1px solid var(--color-border); border-radius:10px; padding:14px 16px; }
h4 { font-size:13px; margin:0 0 12px; }
pre { white-space:pre-wrap; overflow-wrap:anywhere; font:inherit; font-size:13px; line-height:1.9; margin:0; user-select:text; }
.assist-empty { font-size:12px; color:var(--color-text-3); line-height:1.8; padding:18px 0; }
.density-stats { display:flex; flex-wrap:wrap; gap:12px 24px; font-size:12px; color:var(--color-text-3); }
.density-stats b { font-size:14px; color:var(--color-text-1); margin-left:5px; }
.density-issues { font-size:13px; line-height:1.9; padding-left:20px; color:#dba94d; }
.density-ok,.assist-advice { font-size:12px; line-height:1.9; color:var(--color-text-2); }
.assist-advice { padding:12px 16px; border-radius:8px; background:var(--color-bg-2); }
.clip-plan { display:flex; flex-direction:column; gap:14px; margin-top:18px; }
.clip-plan article { padding:16px; border:1px solid var(--color-border); border-radius:10px; }
.clip-plan article > div { display:flex; align-items:center; justify-content:space-between; gap:10px; }
.clip-plan label { white-space:nowrap; font-size:12px; color:var(--color-text-3); }
.clip-plan input,.clip-plan select { width:65px; padding:4px; margin:0 4px; border:1px solid var(--color-border); border-radius:5px; background:var(--color-bg-2); color:var(--color-text-1); }
.assist-error { font-size:12px; line-height:1.7; color:#ef9b85; }
footer { display:flex; align-items:center; flex-wrap:wrap; gap:8px; padding:14px 24px; border-top:1px solid var(--color-border); }
footer > span { flex:1; min-width:100px; font-size:11px; color:var(--color-text-3); }
footer button { border:1px solid var(--color-border); border-radius:7px; padding:8px 12px; background:var(--color-bg-2); color:var(--color-text-1); font:inherit; font-size:12px; cursor:pointer; }
footer button.assist-primary { background:var(--color-accent); color:var(--color-on-accent,#fff); border-color:transparent; }
footer button:disabled { opacity:.4; cursor:default; }
@keyframes assist-spin { to { transform:rotate(360deg); } }
@media(prefers-reduced-motion:reduce) { .prompt-assist-icon.working svg { animation:none; } }
@media(max-width:650px) { .prompt-assist-mask { padding:12px; } .prompt-assist-dialog { max-height:calc(100dvh - 24px); } header,main { padding:16px; } footer { padding:12px 16px; } .translation-columns { grid-template-columns:1fr; min-height:0; } }
</style>
