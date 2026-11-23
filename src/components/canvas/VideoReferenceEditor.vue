<script setup lang="ts">
import { stopNodeDragFromControls } from '@/utils/nodeDrag'
import { computed, nextTick, ref, watch } from 'vue'
import { useReferenceReorder } from '@/composables/useReferenceReorder'
import { useAssetsStore, useLibraryStore, useProjectStore, useSettingsStore, useToastStore } from '@/stores'
import { isNodeRunning } from '@/services/canvas/jobs'
import { referenceAudioIds, videoReferenceBindings } from '@/services/canvas/videoReferences'
import { canvasReferenceImageOrder, resolvedCanvasReferenceAssetIds } from '@/services/canvas/references'
import { videoRefSlots } from '@/utils/consistency'
import { bindLegacyVideoReferences, videoReferenceParts, videoReferenceToken } from '@/services/ai/videoReferenceTokens'
import { videoNodeCapabilities } from '@/services/ai/videoNodeCapabilities'
import { normalizeVideoGenModel, videoMaxRefImages } from '@/types'
import { openLightbox } from '@/composables/useLightbox'
import { pickLocalFiles } from '@/utils/pickLocalFiles'
import AssetPicker from '@/components/common/AssetPicker.vue'

const props = defineProps<{ nodeId: string; modelValue?: string; disabled?: boolean; audioOnly?: boolean; referencesOnly?: boolean; allowAudio?: boolean; audioSync?: boolean; maxAudios?: number; maxImages?: number; hideActions?: boolean; draggableBackground?: boolean; imageAssetIds?: string[]; audioAssetIds?: string[]; hideReferences?: boolean; placeholder?: string }>()
function onPointerStart(event: Event) {
  stopNodeDragFromControls(event, !props.draggableBackground)
}
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const project = useProjectStore(), assets = useAssetsStore(), library = useLibraryStore()
const settings = useSettingsStore(), toast = useToastStore()
const node = computed(() => project.current?.canvas?.nodes.find(item => item.id === props.nodeId))
const shot = computed(() => project.current?.shots.find(item => item.id === node.value?.data.shotId))
const audioIds = computed(() => props.audioAssetIds ?? referenceAudioIds(node.value?.data))
const imageIds = computed(() => {
  if (props.imageAssetIds) return props.imageAssetIds
  if (props.audioOnly) return []
  const p = project.current, n = node.value
  if (!p || !n) return []
  return n.type === 'shotVideo' && shot.value ? videoRefSlots(shot.value, p).map(item => item.id) : resolvedCanvasReferenceAssetIds(p, n)
})
const urls = ref<Record<string, string>>({}), activeAudio = ref<string>(), uploading = ref(false)
const busy = computed(() => !!props.disabled || uploading.value || isNodeRunning(props.nodeId))
const pickerKind = ref<'image' | 'audio'>('image'), pickerOpen = ref(false), pickerTab = ref<'page' | 'library'>('page')
const bindings = computed(() => videoReferenceBindings(imageIds.value, audioIds.value, props.hideReferences ? [] : node.value?.data.videoReferenceOrder))
const refs = computed(() => {
  return [...bindings.value].sort((a, b) => a.number! - b.number!).map(item => {
    const meta = assets.getMeta(item.id) || library.getMeta(item.id)
    return { ...item, number: item.number!, label: `${item.kind === 'audio' ? '音频' : '图片'} ${item.number}`, filename: meta?.filename || item.id, duration: meta && 'duration' in meta ? meta.duration : 0 }
  })
})
const referenceSort = useReferenceReorder({
  ids: () => refs.value.map(item => item.id),
  scope: () => `${project.current?.id}:${props.nodeId}`,
  disabled: () => busy.value,
  commit: async ids => {
    const n = node.value, p = project.current
    if (!n || !p) return
    // Bind numeric mentions against the OLD strip before its slot numbers change.
    const text = bindLegacyVideoReferences(props.referencesOnly ? n.data.prompt || '' : props.modelValue || '', bindings.value)
    const images = ids.filter(id => imageIds.value.includes(id))
    const audios = ids.filter(id => audioIds.value.includes(id))
    project.patchCanvasNode(n.id, {
      prompt: text, videoTaskId: undefined, videoReferenceOrder: ids,
      referenceAudioAssetIds: audios, referenceAudioAssetId: audios[0],
      ...(n.type === 'videoGen' ? { referenceImageOrder: canvasReferenceImageOrder(p, n, images) } : {})
    })
    if (!props.referencesOnly) emit('update:modelValue', text)
    if (n.data.shotId) project.updateShot(n.data.shotId, { videoTaskId: undefined })
    try { await project.save() } catch (error: any) { toast.error(error?.message || '参考素材顺序保存失败') }
  }
})
const issue = computed(() => {
  if (props.audioSync) return audioIds.value.length > 1 ? '数字人口播仅支持一段驱动音频，请移除多余音频。' : ''
  if (!audioIds.value.length) return ''
  const n = node.value
  const profile = n?.data.videoProfileId ? settings.config.videos?.find(item => item.id === n.data.videoProfileId) : settings.config.video
  const caps = videoNodeCapabilities(n?.data || {}, profile)
  if (!caps.audio) return '当前模型不支持参考声音，请选择支持声音的H3接入。'
  if (n?.data.h3GenMode === 'fl2va' || shot.value?.h3GenMode === 'fl2va' || (!caps.autodlWorkflow && n?.type === 'shotVideo' && project.current?.settings.h3ShotChainMode === 'fl2va')) return '参考声音需要 H3「参考图」模式，请切换模式或移除声音。'
  if (n?.type === 'shotVideo' && project.current?.pipelineMode === 'smart-speech' && project.current.speechWorkflow?.mode === 'digital-human') return '数字人口播模式使用口播音频，请改用普通H3参考图模式。'
  return ''
})
let loadSeq = 0
watch(() => refs.value.map(item => item.id).join(','), async () => {
  const seq = ++loadSeq, next: Record<string, string> = {}
  for (const item of refs.value) next[item.id] = (await assets.getUrl(item.id)) || (await library.getUrl(item.id)) || ''
  if (seq === loadSeq) urls.value = next
}, { immediate: true })
function saveOrder(newIds: string[]) { return [...new Set([...refs.value.map(item => item.id), ...newIds])] }
async function add(ids: string[], kind: 'image' | 'audio', uploadFiles?: File[]) {
  const n = node.value, p = project.current
  if (!n || !p || busy.value) return
  const old = kind === 'audio' ? audioIds.value : imageIds.value
  if (kind === 'audio' && props.allowAudio === false) { toast.warn('当前模式仅使用图片参考，请切换到全能参考添加声音。'); return }
  const limit = kind === 'audio' ? props.maxAudios ?? 3 : props.maxImages ?? videoMaxRefImages(normalizeVideoGenModel(n.data.videoModel))
  const unique = [...new Set(ids)].filter(id => !old.includes(id))
  const count = uploadFiles?.length ?? unique.length
  if (old.length + count > limit) { toast.warn(`最多支持 ${limit} ${kind === 'audio' ? '条参考声音' : '张参考图'}，请先移除多余素材。`); return }
  uploading.value = true
  try {
    const added: string[] = []
    for (const file of uploadFiles || []) {
      const asset = await assets.add(file, kind, 'uploaded', { filename: file.name, projectId: p.id, shotId: n.data.shotId }); added.push(asset.id)
    }
    for (const id of unique) {
      const asset = await assets.adopt(id, kind, { projectId: p.id, shotId: n.data.shotId }); added.push(asset.id)
    }
    if (node.value?.id !== n.id || project.current?.id !== p.id) return
    if (kind === 'audio') {
      const merged = [...new Set([...old, ...added])]
      project.patchCanvasNode(n.id, { referenceAudioAssetIds: merged, referenceAudioAssetId: merged[0], videoTaskId: undefined, videoReferenceOrder: saveOrder(added) })
    } else if (n.type === 'shotVideo' && shot.value) {
      project.updateShot(shot.value.id, { referenceAssetIds: [...new Set([...(shot.value.referenceAssetIds || []), ...added])], omittedRefAssetIds: (shot.value.omittedRefAssetIds || []).filter(id => !added.includes(id)), videoTaskId: undefined })
      project.patchCanvasNode(n.id, { videoReferenceOrder: saveOrder(added), videoTaskId: undefined })
    } else project.patchCanvasNode(n.id, { referenceAssetIds: [...new Set([...(n.data.referenceAssetIds || []), ...added])], videoReferenceOrder: saveOrder(added), videoTaskId: undefined })
    if (n.data.shotId) project.updateShot(n.data.shotId, { videoTaskId: undefined })
    await project.save()
  } catch (e: any) { toast.error(e?.message || '添加参考素材失败') }
  finally { uploading.value = false }
}
async function upload() {
  if (busy.value) return
  try {
    const files = (await pickLocalFiles({ kind: props.audioOnly ? 'audio' : props.allowAudio === false ? 'image' : 'media', multiple: true })).filter(file => file.type.startsWith('image/') || file.type.startsWith('audio/'))
    // Validate the whole selection before importing any files.
    if (audioIds.value.length + files.filter(f => f.type.startsWith('audio/')).length > (props.maxAudios ?? 3)) { toast.warn(`最多支持${props.maxAudios ?? 3}条声音，请减少音频素材。`); return }
    if (imageIds.value.length + files.filter(f => f.type.startsWith('image/')).length > (props.maxImages ?? videoMaxRefImages(normalizeVideoGenModel(node.value?.data.videoModel)))) { toast.warn('参考图超出模型上限，请减少图片。'); return }
    for (const file of files) await add([], file.type.startsWith('audio/') ? 'audio' : 'image', [file])
  } catch (e: any) { toast.error(e?.message || '读取素材失败') }
}
async function remove(id: string, kind: 'image' | 'audio') {
  const n = node.value
  if (!n || busy.value) return
  // Pin any legacy numeric references before removing a slot can change their meaning.
  if (!props.referencesOnly) commit(bindLegacyVideoReferences(props.modelValue || '', bindings.value))
  if (kind === 'audio') {
    const next = audioIds.value.filter(item => item !== id)
    project.patchCanvasNode(n.id, { referenceAudioAssetIds: next, referenceAudioAssetId: next[0], videoTaskId: undefined })
  } else if (n.type === 'shotVideo' && shot.value) project.updateShot(shot.value.id, { referenceAssetIds: (shot.value.referenceAssetIds || []).filter(item => item !== id), omittedRefAssetIds: [...new Set([...(shot.value.omittedRefAssetIds || []), id])], videoTaskId: undefined })
  else project.removeCanvasNodeRef(n.id, id)
  project.patchCanvasNode(n.id, { videoReferenceOrder: (n.data.videoReferenceOrder || []).filter(item => item !== id), videoTaskId: undefined })
  if (n.data.shotId) project.updateShot(n.data.shotId, { videoTaskId: undefined })
  if (activeAudio.value === id) activeAudio.value = undefined
  await project.save()
}
function pick(kind: 'image' | 'audio', tab: 'page' | 'library' = 'page') { if (busy.value || (kind === 'audio' && props.allowAudio === false)) return; pickerKind.value = kind; pickerTab.value = tab; pickerOpen.value = true }
function preview(id: string, kind: 'image' | 'audio') {
  if (kind === 'audio') activeAudio.value = activeAudio.value === id ? undefined : id
  else if (urls.value[id]) openLightbox(urls.value[id], 'image')
}

// Contenteditable contains only plain text and atomic, escaped DOM chips. Never render pasted HTML.
const editor = ref<HTMLDivElement>(), composing = ref(false), menu = ref<{ start: number; end: number; query: string }>(), menuIndex = ref(0)
let selection = { start: 0, end: 0 }
function serialize(root: Node): string {
  if (root.nodeType === Node.TEXT_NODE) return root.textContent || ''
  if (root instanceof HTMLElement && root.dataset.referenceToken) return root.dataset.referenceToken
  if (root.nodeName === 'BR') return '\n'
  return Array.from(root.childNodes).map((child, i) => `${i > 0 && (child.nodeName === 'DIV' || child.nodeName === 'P') ? '\n' : ''}${serialize(child)}`).join('')
}
function remember() {
  const el = editor.value, sel = window.getSelection()
  if (!el || !sel?.rangeCount || !el.contains(sel.anchorNode) || !el.contains(sel.focusNode)) return
  const range = sel.getRangeAt(0), before = range.cloneRange(); before.selectNodeContents(el); before.setEnd(range.startContainer, range.startOffset)
  const start = serialize(before.cloneContents()); selection = { start: start.length, end: start.length + serialize(range.cloneContents()).length }
  const match = /@([^\s@\[\]（）(),，。；;：:！？!?]*)$/.exec(start)
  menu.value = match ? { start: start.length - match[0].length, end: start.length, query: match[1] } : undefined
  menuIndex.value = 0
}
function placeCaret(offset: number) {
  const el = editor.value
  if (!el) return
  const range = document.createRange(); range.selectNodeContents(el); range.collapse(false)
  let left = offset
  for (const child of Array.from(el.childNodes)) {
    const length = serialize(child).length
    if (left <= length) {
      if (child.nodeType === Node.TEXT_NODE) range.setStart(child, Math.min(left, length))
      else if (left === 0) range.setStartBefore(child)
      else range.setStartAfter(child)
      range.collapse(true); break
    }
    left -= length
  }
  const sel = window.getSelection(); sel?.removeAllRanges(); sel?.addRange(range)
}
function render() {
  const el = editor.value
  if (!el || composing.value) return
  const focused = document.activeElement === el
  if (focused) {
    remember()
    const raw = serialize(el)
    // Pasted numeric mentions expand into ID tokens; keep the caret after the same text.
    selection = {
      start: bindLegacyVideoReferences(raw.slice(0, selection.start), bindings.value).length,
      end: bindLegacyVideoReferences(raw.slice(0, selection.end), bindings.value).length
    }
  }
  el.replaceChildren()
  for (const part of videoReferenceParts(bindLegacyVideoReferences(props.modelValue || '', bindings.value))) {
    if (!part.token) { el.append(document.createTextNode(part.text || '')); continue }
    const item = refs.value.find(item => item.id === part.id && item.kind === part.kind)
    const chip = document.createElement('span'); chip.className = `reference-chip${item ? '' : ' missing'}`; chip.contentEditable = 'false'; chip.dataset.referenceToken = part.token
    chip.title = item?.filename || '参考素材已移除，请删除标签或重新选择'
    if (item?.kind === 'image' && urls.value[item.id]) { const img = document.createElement('img'); img.src = urls.value[item.id]; img.alt = ''; chip.append(img) }
    chip.append(document.createTextNode(item ? `${item.kind === 'audio' ? '♫ ' : ''}${item.label}` : '失效参考')); el.append(chip)
  }
  if (!el.lastChild || el.lastChild.nodeType !== Node.TEXT_NODE) el.append(document.createTextNode(''))
  if (focused) { placeCaret(selection.end); remember() }
}
watch(() => props.modelValue, () => { if (editor.value && serialize(editor.value) !== (props.modelValue || '')) render() }, { flush: 'post' })
watch([() => refs.value.map(item => `${item.id}:${item.number}`).join(','), urls], () => render(), { flush: 'post' })
watch(editor, () => render())
const options = computed(() => {
  const query = menu.value?.query || ''
  return refs.value.filter(item => (props.allowAudio !== false || item.kind !== 'audio')).filter(item => /^\d+$/.test(query)
    ? item.number === Number(query)
    : !query || `${item.label} ${item.filename}`.toLowerCase().includes(query.toLowerCase()))
})
const undo: string[] = [], redo: string[] = []
watch(() => props.nodeId, () => {
  undo.length = 0; redo.length = 0; selection = { start: 0, end: 0 }
  menu.value = undefined; activeAudio.value = undefined; pickerOpen.value = false
  void nextTick(render)
})
function commit(value: string) {
  if (value === (props.modelValue || '')) return
  undo.push(props.modelValue || ''); if (undo.length > 100) undo.shift(); redo.length = 0
  emit('update:modelValue', value)
}
function copy(event: ClipboardEvent, cut = false) {
  const sel = window.getSelection()
  if (!sel?.rangeCount || !event.clipboardData) return
  const range = sel.getRangeAt(0)
  event.preventDefault(); event.clipboardData.setData('text/plain', sel.toString())
  event.clipboardData.setData('application/x-juliu-references', serialize(range.cloneContents()))
  if (cut && !busy.value) { range.deleteContents(); changed() }
}
function changed() {
  if (!editor.value || composing.value) return
  remember()
  const text = serialize(editor.value), active = menu.value
  // While typing @10, keep @1 open until the number is completed or explicitly selected.
  const value = active
    ? bindLegacyVideoReferences(text.slice(0, active.start), bindings.value) + text.slice(active.start, active.end) + bindLegacyVideoReferences(text.slice(active.end), bindings.value)
    : bindLegacyVideoReferences(text, bindings.value)
  commit(value)
}
function blur() {
  menu.value = undefined
  if (editor.value && !busy.value && !composing.value) commit(bindLegacyVideoReferences(serialize(editor.value), bindings.value))
}
async function insert(item: typeof refs.value[number]) {
  if (busy.value || props.referencesOnly) return
  const text = bindLegacyVideoReferences(props.modelValue || '', bindings.value)
  const start = menu.value?.start ?? selection.start, end = menu.value?.end ?? selection.end
  const token = videoReferenceToken(item.kind, item.id) + ' '
  commit(text.slice(0, start) + token + text.slice(end)); menu.value = undefined
  await nextTick(); editor.value?.focus(); render(); selection = { start: start + token.length, end: start + token.length }; placeCaret(selection.end)
}
function paste(event: ClipboardEvent) {
  event.preventDefault()
  if (busy.value) return
  const text = event.clipboardData?.getData('application/x-juliu-references') || event.clipboardData?.getData('text/plain') || ''
  const sel = window.getSelection(); if (!sel?.rangeCount) return
  const range = sel.getRangeAt(0); range.deleteContents(); const node = document.createTextNode(text); range.insertNode(node); range.setStartAfter(node); range.collapse(true); sel.removeAllRanges(); sel.addRange(range); changed(); void nextTick(render)
}
function keydown(event: KeyboardEvent) {
  if (event.isComposing || composing.value) return
  if ((event.ctrlKey || event.metaKey) && (event.key.toLowerCase() === 'z' || event.key.toLowerCase() === 'y')) {
    event.preventDefault(); const forwards = event.shiftKey || event.key.toLowerCase() === 'y'
    const from = forwards ? redo : undo, to = forwards ? undo : redo
    if (from.length) { to.push(props.modelValue || ''); emit('update:modelValue', from.pop()!); menu.value = undefined }
    return
  }
  if (event.key === 'Escape' && menu.value) { event.preventDefault(); event.stopPropagation(); menu.value = undefined; return }
  if (menu.value && options.value.length) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); menuIndex.value = (menuIndex.value + (event.key === 'ArrowDown' ? 1 : -1) + options.value.length) % options.value.length; return }
    if (event.key === 'Enter') { event.preventDefault(); void insert(options.value[menuIndex.value] || options.value[0]); return }
  }
  if (event.key === 'Enter') { event.preventDefault(); const sel = window.getSelection(); if (!sel?.rangeCount) return; const range = sel.getRangeAt(0);range.deleteContents(); const text = document.createTextNode('\n'); range.insertNode(text);range.setStartAfter(text);range.collapse(true);sel.removeAllRanges();sel.addRange(range);changed() }
}
defineExpose({ upload, pick, focus: () => editor.value?.focus() })
</script>

<template>
  <section class="video-reference-editor nowheel" :class="{ nodrag: !draggableBackground, nopan: !draggableBackground }" @pointerdown="onPointerStart" @mousedown="onPointerStart" @click.stop @wheel.stop>
    <div v-if="!hideActions" class="reference-actions">
      <button type="button" :disabled="busy" @click="upload">＋ {{ uploading ? '上传中…' : '上传' }}</button>
      <button v-if="!audioOnly" type="button" :disabled="busy" @click="pick('image')">▧ 选图片</button>
      <button v-if="allowAudio !== false" type="button" :disabled="busy" @click="pick('audio')">♫ 选声音</button>
      <span class="limit">{{ audioOnly ? '' : `${imageIds.length} 图 · ` }}{{ audioIds.length }}/3 音频</span>
    </div>
    <div v-if="!hideReferences" class="reference-strip" role="list" aria-label="参考素材，可拖拽排序">
      <div v-for="item in refs" :key="item.id" class="reference-tile nodrag nopan" role="listitem" tabindex="0"
        :draggable="!busy" :aria-label="`${item.label}，拖拽或按 Alt 加左右方向键排序`"
        :class="[item.kind, { inactive: item.kind === 'audio' && allowAudio === false, 'ref-dragging': referenceSort.dragging.value === item.id, 'ref-drop-before': referenceSort.target.value === item.id && !referenceSort.after.value, 'ref-drop-after': referenceSort.target.value === item.id && referenceSort.after.value }]"
        :title="`${item.filename} · 拖拽排序；Alt + ← / → 调整顺序`"
        @dragstart.stop="referenceSort.start($event, item.id)" @dragover.stop="referenceSort.over($event, item.id)" @dragleave.stop="referenceSort.leave" @drop.stop="referenceSort.drop($event, item.id)" @dragend.stop="referenceSort.end" @keydown="referenceSort.key($event, item.id)">
        <button type="button" class="reference-preview" :aria-label="`${item.kind === 'audio' ? '试听' : '预览'} ${item.label}`" @click="preview(item.id, item.kind)">
          <img v-if="item.kind === 'image' && urls[item.id]" :src="urls[item.id]" :draggable="false" alt="" /><span v-else class="music">♫</span>
          <span class="reference-number">{{ item.number }}</span><span v-if="item.kind === 'audio'" class="reference-duration">{{ item.duration.toFixed(1) }}s</span>
        </button>
        <button type="button" class="reference-remove" :aria-label="`移除 ${item.label}`" :disabled="busy" @click="remove(item.id, item.kind)">×</button>
        <button type="button" class="reference-insert" :title="item.filename" :disabled="busy || referencesOnly || (item.kind === 'audio' && allowAudio === false)" @pointerdown.prevent @click="insert(item)">{{ item.label }}</button>
      </div>
      <p v-if="!refs.length" class="reference-empty">{{ audioOnly ? '上传或选用参考声音' : '添加图片、声音，在提示词中指定各自的用途' }}</p>
    </div>
    <div v-if="activeAudio && urls[activeAudio]" class="audio-audition"><span>{{ refs.find(item => item.id === activeAudio)?.filename }}</span><audio :key="activeAudio" :src="urls[activeAudio]" controls autoplay preload="metadata" /></div>
    <template v-if="!referencesOnly">
      <div ref="editor" class="reference-prompt" :contenteditable="!busy" role="textbox" aria-multiline="true" aria-label="视频提示词" :data-placeholder="placeholder || '描述动作、镜头和声音；输入 @ 选择图片或音频参考…'"
        @input="changed" @blur="blur" @click="remember" @keyup="event => { if (!['ArrowDown','ArrowUp','Enter','Escape'].includes(event.key)) remember() }" @keydown="keydown" @copy="copy($event)" @cut="copy($event, true)" @paste="paste" @compositionstart="composing = true" @compositionend="composing = false; changed()" />
      <div v-if="menu && options.length" class="reference-menu" role="listbox" aria-label="选择图片或音频引用">
        <button v-for="(item, i) in options" :key="item.id" type="button" role="option" :aria-selected="i === menuIndex" :class="{ active: i === menuIndex }" @pointerdown.prevent @click="insert(item)"><img v-if="item.kind === 'image' && urls[item.id]" :src="urls[item.id]" alt="" /><span v-else>♫</span><b>{{ item.label }}</b><span>{{ item.filename }}</span></button>
      </div>
      <p v-if="!hideReferences" class="reference-tip">拖拽图片或声音调整顺序；点击名称或输入 @ 插入引用。已有标签跟随原素材，编号同步更新。</p>
    </template>
    <p v-if="allowAudio === false && audioIds.length" class="reference-tip">参考声音已保留；此模式不提交声音，使用声音请切换到全能参考。</p>
    <p v-if="issue && allowAudio !== false" class="reference-warning" role="alert">{{ issue }}</p>
    <AssetPicker :open="pickerOpen" :kind="pickerKind" :default-tab="pickerTab" multiple show-library :title="pickerKind === 'audio' ? `选择${audioSync ? '驱动音频' : '参考声音'}（最多${maxAudios ?? 3}条）` : '选择参考图片'" :selected-ids="[]" @close="pickerOpen = false" @confirm="ids => add(ids, pickerKind)" />
  </section>
</template>

<style scoped>
.reference-tile.inactive { opacity:.45; }
.reference-tile[draggable="true"] { cursor:grab; }
.reference-tile.ref-dragging { opacity:.4; }
.reference-tile.ref-drop-before::before,.reference-tile.ref-drop-after::after { content:''; position:absolute; top:0; bottom:0; width:3px; background:var(--color-text-1); border-radius:2px; pointer-events:none; }
.reference-tile.ref-drop-before::before { left:-5px; }
.reference-tile.ref-drop-after::after { right:-5px; }
.reference-tile:focus-visible { outline:2px solid var(--color-text-1); outline-offset:2px; }
.video-reference-editor { width:100%; min-width:0; position:relative; color:var(--color-text-1); font-size:12px; }
.reference-actions { display:flex; align-items:center; gap:5px; margin-bottom:8px; flex-wrap:wrap; }
.reference-actions button { border:1px solid var(--color-border); background:var(--color-fill-hover); color:var(--color-text-2); border-radius:6px; padding:4px 7px; cursor:pointer; font:inherit; }
.limit { margin-left:auto; font-size:10px; color:var(--color-text-3); }
.reference-strip { display:flex; gap:7px; overflow-x:auto; padding:2px 3px 8px; align-items:flex-start; }
.reference-tile { width:56px; flex:0 0 56px; position:relative; }
.reference-preview { width:56px; height:54px; position:relative; padding:0; border:1px solid var(--color-border); border-radius:7px; overflow:hidden; background:var(--color-bg-2); color:var(--color-text-2); cursor:pointer; }
.reference-preview img { width:100%; height:100%; object-fit:contain; }
.music { font-size:28px; color:#9ca3b4; }
.reference-number { position:absolute; left:2px; top:2px; border-radius:4px; background:#12141cce; color:white; font-size:10px; padding:0 3px; }
.reference-duration { position:absolute; bottom:1px; left:1px; font-size:9px; background:#12141cbb; color:white; padding:0 2px; border-radius:3px; }
.reference-remove { position:absolute; top:-3px; right:-3px; width:16px; height:16px; padding:0; border:0; border-radius:50%; background:#303440; color:white; cursor:pointer; font-size:12px; }
.reference-insert { display:block; width:100%; border:0; padding:3px 0; background:transparent; color:var(--color-text-2); font:inherit; font-size:10px; cursor:pointer; }
.reference-empty,.reference-tip { color:var(--color-text-3); font-size:10px; margin:5px 0; line-height:1.5; }
.reference-prompt { white-space:pre-wrap; overflow-wrap:anywhere; min-height:144px; max-height:380px; overflow-y:auto; outline:none; padding:9px 4px; line-height:2; cursor:text; user-select:text; }
.reference-prompt:empty::before { content:attr(data-placeholder); color:var(--color-text-3); pointer-events:none; }
.reference-prompt:deep(.reference-chip) { display:inline-flex; align-items:center; vertical-align:middle; gap:4px; height:24px; padding:0 5px; margin:0 2px; border:1px solid var(--color-border); border-radius:5px; background:var(--color-fill-hover); color:var(--color-text-1); white-space:nowrap; line-height:1; user-select:all; }
.reference-prompt:deep(.reference-chip img) { width:17px; height:17px; object-fit:contain; border-radius:3px; }
.reference-prompt:deep(.reference-chip.missing) { color:#fbbf24; border-color:#a16207; }
.reference-menu { max-height:200px; overflow-y:auto; border:1px solid var(--color-border); border-radius:7px; padding:4px; background:var(--color-bg-1); }
.reference-menu button { display:flex; align-items:center; gap:7px; width:100%; padding:6px; border:0; border-radius:5px; background:transparent; color:var(--color-text-2); cursor:pointer; text-align:left; font:inherit; }
.reference-menu button.active { background:var(--color-fill-hover); }
.reference-menu img { width:24px; height:24px; object-fit:contain; }
.reference-menu button>span:last-child { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:10px; }
.audio-audition { display:flex; flex-direction:column; gap:4px; margin:4px 0; font-size:10px; color:var(--color-text-3); }
.audio-audition audio { width:100%; height:32px; }
.reference-warning { color:#fbbf24; font-size:11px; line-height:1.5; }
button:disabled { opacity:.5; cursor:default; }
</style>
