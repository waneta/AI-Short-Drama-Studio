<script setup lang="ts">
import { stopNodeDragFromControls } from '@/utils/nodeDrag'
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import { useReferenceReorder } from '@/composables/useReferenceReorder'
import { usePromptEditorWindow } from '@/composables/usePromptEditorWindow'
import { useAssetsStore, useLibraryStore, useProjectStore, useSettingsStore, useToastStore } from '@/stores'
import { grabVideoLastFrameNode, runCanvasNode } from '@/services/canvas/runner'
import { applyShotVideoModel, applyShotVideoProfile } from '@/services/canvas/videoModel'
import { isNodeRunning, nodeJobStartedAt, canCancelNodeJob, cancelNodeJob, isNodeCancelling } from '@/services/canvas/jobs'
import { friendlyAiError, shouldToastAiError } from '@/services/ai/abort'
import { bindLegacyVideoReferences, compileVideoReferenceTokens, displayVideoReferenceTokens } from '@/services/ai/videoReferenceTokens'
import { imageReferenceMentionAt, insertImageReferenceMention } from '@/services/ai/imageReferenceMentions'
import { comfyImageModelOption } from '@/services/ai/comfyImageWorkflow'
import { comfyImageReferenceIssue } from '@/services/ai/comfyImageReference'
import { cssAspectRatio } from '@/services/canvas/layout'
import { openLightbox } from '@/composables/useLightbox'
import NodeConnectionHandles from '@/components/canvas/NodeConnectionHandles.vue'
import NodeBusyOverlay from '@/components/canvas/NodeBusyOverlay.vue'
import AssetPicker from '@/components/common/AssetPicker.vue'
import ImageModelSelect from '@/components/settings/ImageModelSelect.vue'
import VideoModelSelect from '@/components/settings/VideoModelSelect.vue'
import VideoGenerationModeSelect from '@/components/settings/VideoGenerationModeSelect.vue'
import { videoNodeCapabilities, videoNodeMode, videoNodeDuration, videoNodeInputIssue, videoNodeReferenceIds, videoBatchCount } from '@/services/ai/videoNodeCapabilities'
import AutoDlVideoInputs from '@/components/canvas/AutoDlVideoInputs.vue'
import FramePairSlots from '@/components/canvas/FramePairSlots.vue'
import CanvasToolbarIcon from '@/components/canvas/CanvasToolbarIcon.vue'
import GenerationDetails from '@/components/common/GenerationDetails.vue'
import VideoReferenceEditor from '@/components/canvas/VideoReferenceEditor.vue'
import PromptAssistantTools from '@/components/canvas/PromptAssistantTools.vue'
import { imageBatchCount } from '@/services/ai/imageModelCapabilities'
import NativeH3VideoControls from '@/components/common/NativeH3VideoControls.vue'
import { referenceAudioIds, videoReferenceBindings } from '@/services/canvas/videoReferences'
import { selectCanvasNode } from '@/services/canvas/canvasBridge'
import { pickLocalFiles } from '@/utils/pickLocalFiles'
import {
  canvasNodeOutputAssetId,
  canvasReferenceImageOrder,
  resolvedCanvasReferenceAssetIds
} from '@/services/canvas/references'
import type { AspectRatio, CanvasNodeType, ID, VideoGenModel } from '@/types'
import {
  normalizeVideoGenModel
} from '@/types'

const props = defineProps<{
  id: string
  selected?: boolean
  data: {
    label?: string
    prompt?: string
    referenceAssetIds?: string[]
    referenceSourceNodeIds?: string[]
    outputAssetId?: string
    duration?: number
    aspectRatio?: AspectRatio
    videoModel?: VideoGenModel
    nodeType?: CanvasNodeType
  }
}>()

const project = useProjectStore()
const assets = useAssetsStore()
const library = useLibraryStore()
const toast = useToastStore()
const mediaUrl = ref('')
const posterUrl = ref('')
const pickerOpen = ref(false)
const pickerMode = ref<'ref' | 'output'>('ref')
const panelOpen = ref(false)
const expanded = ref(false)
const editorWindow = usePromptEditorWindow(expanded)
const uploadOpen = ref(false)
const pickerTab = ref<'page' | 'library'>('page')
const resultUrls = ref<Record<string, string>>({})
const moreOpen = ref(false)
const busyLabel = ref('')
const extractingFrame = ref(false)
const assistingPrompt = ref(false)
let mediaSeq = 0

const { updateNodeData, connectionStartHandle, connectionClickStartHandle, getSelectedNodes } = useVueFlow()
const multiSelected = computed(() => getSelectedNodes.value.length > 1)
const connecting = computed(() => Boolean(connectionStartHandle.value || connectionClickStartHandle.value))
const contextMenuOpen = inject('canvasContextMenuOpen', ref(false))
const overlaysVisible = computed(() => !connecting.value && !multiSelected.value && !contextMenuOpen.value)

const type = computed(() => (props.data.nodeType === 'videoGen' ? 'videoGen' : 'imageGen'))
const isVideo = computed(() => type.value === 'videoGen')
const node = computed(() => project.current?.canvas?.nodes.find((n) => n.id === props.id))
const boundRefs = computed(() => {
  const p = project.current
  const n = node.value
  if (!p || !n) return []
  return (n.data.referenceSourceNodeIds ?? [])
    .map((id) => canvasNodeOutputAssetId(p, p.canvas?.nodes.find((item) => item.id === id)))
    .filter((id): id is ID => Boolean(id))
})
const refs = computed(() => {
  const p = project.current
  return p && node.value ? resolvedCanvasReferenceAssetIds(p, node.value) : []
})
const outputId = computed(() => node.value?.data.outputAssetId || props.data.outputAssetId)
const imageResults = computed(() => node.value?.data.outputAssetIds || [])
const videoEditor = ref<InstanceType<typeof VideoReferenceEditor>>()
const promptTools = ref<InstanceType<typeof PromptAssistantTools>>()
const imageMeta = computed(() => outputId.value ? assets.getMeta(outputId.value) || library.getMeta(outputId.value) : undefined)
const outputDimensions = computed(() => imageMeta.value && 'width' in imageMeta.value ? `${imageMeta.value.width} × ${imageMeta.value.height}` : '')
const imageCount = computed(() => imageBatchCount(node.value?.data.imageCount))
const hasAsset = computed(() => Boolean(outputId.value))
const generating = computed(() => isNodeRunning(props.id))
const title = computed(() => node.value?.data.label || (isVideo.value ? '视频' : '图片'))
const renaming = ref(false)
const nameDraft = ref('')
const nameInput = ref<HTMLInputElement>()
const nameLabel = ref<HTMLElement>()
let renameProjectId: string | undefined
async function beginRename() {
  if (renaming.value || !node.value || !project.current) return
  renameProjectId = project.current.id
  nameDraft.value = title.value
  renaming.value = true
  await nextTick()
  nameInput.value?.focus()
  nameInput.value?.select()
}
function finishRename(restoreFocus = false) {
  if (!renaming.value) return
  renaming.value = false
  const label = nameDraft.value.trim()
  if (label && label !== title.value && project.current?.id === renameProjectId) {
    project.patchCanvasNode(props.id, { label })
  }
  if (restoreFocus) void nextTick(() => nameLabel.value?.focus())
}
function onNameKeydown(event: KeyboardEvent) {
  if (event.isComposing || event.keyCode === 229) return
  if (event.key === 'Enter') {
    event.preventDefault()
    finishRename(true)
  } else if (event.key === 'Escape') {
    event.preventDefault()
    renaming.value = false
    void nextTick(() => nameLabel.value?.focus())
  }
}

const prompt = computed({
  get: () => node.value?.data.prompt ?? '',
  set: (v: string) => project.setCanvasNodePrompt(props.id, v)
})
const aspectRatio = computed({
  get: () => node.value?.data.aspectRatio ?? project.current?.settings.aspectRatio ?? '16:9',
  set: (v: AspectRatio) => project.patchCanvasNode(props.id, { aspectRatio: v, videoTaskId: undefined })
})
const firstFrameId = computed({
  get: () => node.value?.data.firstFrameAssetId || (!node.value?.data.videoGenerationMode ? refs.value[0] : undefined),
  set: (v: ID | undefined) => project.patchCanvasNode(props.id, { firstFrameAssetId: v, lastFrameAssetId: lastFrameId.value, videoGenerationMode: videoMode.value, videoTaskId: undefined })
})
const lastFrameId = computed({
  get: () => node.value?.data.lastFrameAssetId || (!node.value?.data.videoGenerationMode ? refs.value[1] : undefined),
  set: (v: ID | undefined) => project.patchCanvasNode(props.id, { lastFrameAssetId: v, firstFrameAssetId: firstFrameId.value, videoGenerationMode: videoMode.value, videoTaskId: undefined })
})
const videoModel = computed({
  get: () => normalizeVideoGenModel(node.value?.data.videoModel),
  set: (v: VideoGenModel) => applyShotVideoModel(props.id, v)
})
const isH3Video = computed(() => isVideo.value && (videoCaps.value.native || profileIsAutodl(effectiveVideoProfile.value)))

/* ── 实际出视频的接入线路：节点自己选的优先，没选就用全局当前视频接入 ── */
const settings = useSettingsStore()
const VIDEO_PROFILES = computed(() => settings.config.videos ?? [])
const effectiveVideoProfile = computed(() => {
  const list = VIDEO_PROFILES.value
  const own = node.value?.data.videoProfileId
    ? list.find((p) => p.id === node.value?.data.videoProfileId)
    : undefined
  if (node.value?.data.videoProfileId) return own
  return list.find((p) => p.id === settings.config.activeVideoId) || undefined
})
function profileIsAutodl(p?: { provider?: string; baseUrl?: string; adapter?: { type?: string } }) {
  if (!p) return false
  const zealman = p.provider === 'zealman' || p.adapter?.type === 'zealman-workflow'
  if (zealman) return false
  return p.provider === 'autodl' || /autodl\.art/i.test(p.baseUrl || '')
}
const videoCaps = computed(() => videoNodeCapabilities(node.value?.data || {}, effectiveVideoProfile.value))
const videoMode = computed(() => videoNodeMode(node.value?.data || {}, videoCaps.value))
const frameMode = computed(() => isVideo.value && ['image', 'first-last'].includes(videoMode.value))
const referenceMode = computed(() => isVideo.value && ['omni', 'reference'].includes(videoMode.value))
const isH3Fl2va = computed(() => isVideo.value && videoMode.value === 'first-last')
const activeVideoRefs = computed(() => videoNodeReferenceIds(node.value?.data || {}, videoCaps.value, refs.value, referenceAudioIds(node.value?.data)))
const videoIssue = computed(() => {
  if (!isVideo.value) return ''
  const issue = videoNodeInputIssue(node.value?.data || {}, videoCaps.value, refs.value, referenceAudioIds(node.value?.data))
  if (issue) return issue
  if (videoCaps.value.audioSync) return ''
  const bindings = videoReferenceBindings(activeVideoRefs.value.images, activeVideoRefs.value.audios, referenceMode.value ? node.value?.data.videoReferenceOrder : [])
  const visible = referenceMode.value ? videoReferenceBindings(refs.value, referenceAudioIds(node.value?.data), node.value?.data.videoReferenceOrder) : bindings
  try { compileVideoReferenceTokens(bindLegacyVideoReferences(prompt.value, visible), bindings, videoCaps.value.nativeReferences); return '' }
  catch (error) { return (error as Error).message }
})
const preservedVideoRefs = computed(() => refs.value.length + referenceAudioIds(node.value?.data).length)
const videoCount = computed(() => videoBatchCount(node.value?.data.videoCount))
const duration = computed(() => videoNodeDuration(node.value?.data.duration, videoCaps.value))
const previewDuration = computed(() => isVideo.value && imageMeta.value && 'duration' in imageMeta.value ? Math.round(imageMeta.value.duration * 10) / 10 : duration.value)
const durOpen = ref<'' | 'bar' | 'foot'>('')

const genLabel = computed(() => (hasAsset.value ? '重绘' : isVideo.value ? '出视频' : '出图'))
const failMsg = computed(() =>
  node.value?.status === 'failed' ? node.value.error || '生成失败' : ''
)

const pageImageIds = computed(() => {
  const ids: ID[] = []
  const p = project.current
  if (!p) return ids
  for (const n of p.canvas?.nodes ?? []) {
    if (n.type === 'imageGen') {
      if (n.data.outputAssetId) ids.push(n.data.outputAssetId)
      ids.push(...(n.data.outputAssetIds || []))
    }
    for (const id of resolvedCanvasReferenceAssetIds(p, n)) ids.push(id)
  }
  return [...new Set(ids)]
})

const refUrls = ref<Record<string, string>>({})
const promptInput = ref<HTMLTextAreaElement>()
const mention = ref<{ start: number; end: number; query: string }>()
const mentionIndex = ref(0)
const mentionOptions = computed(() => mention.value ? refs.value.map((id, index) => ({ id, number: index + 1 }))
  .filter(item => String(item.number).startsWith(mention.value!.query)) : [])
const effectiveImageProfile = computed(() => node.value?.data.imageProfileId ? settings.config.images.find(p => p.id === node.value?.data.imageProfileId) : settings.config.image)
const selectedImageLabel = computed(() => comfyImageModelOption(effectiveImageProfile.value, node.value?.data.imageModel || effectiveImageProfile.value?.model || '当前接入'))

const imageReferenceIssue = computed(() => isVideo.value ? undefined : comfyImageReferenceIssue(effectiveImageProfile.value, refs.value.length))
const referenceModel = computed(() => {
  if (!imageReferenceIssue.value) return undefined
  const compatible = settings.config.images.filter(profile => profile.adapter?.type === 'comfyui-prompt' &&
    !comfyImageReferenceIssue(profile, refs.value.length))
  return compatible.find(profile => comfyImageModelOption(profile, profile.model).startsWith('Qwen-Image 2.1')) || compatible[0]
})
const referenceModelLabel = computed(() => referenceModel.value ? comfyImageModelOption(referenceModel.value, referenceModel.value.model).split(' · ')[0] : '')
function switchReferenceModel() {
  const profile = referenceModel.value
  if (!profile || generating.value) return
  project.patchCanvasNode(props.id, { imageProfileId: profile.id, imageModel: profile.model })
}


function updateMention() {
  if (isH3Fl2va.value || !refs.value.length || !promptInput.value) { mention.value = undefined; return }
  const next = imageReferenceMentionAt(prompt.value, promptInput.value.selectionStart)
  if (next?.start !== mention.value?.start || next?.query !== mention.value?.query) mentionIndex.value = 0
  mention.value = next
}

async function insertReference(number: number) {
  const input = promptInput.value
  const result = insertImageReferenceMention(prompt.value,
    mention.value?.start ?? input?.selectionStart ?? prompt.value.length,
    mention.value?.end ?? input?.selectionEnd ?? prompt.value.length, number)
  prompt.value = result.prompt
  mention.value = undefined
  await nextTick()
  input?.focus()
  input?.setSelectionRange(result.caret, result.caret)
}

function onPromptKeydown(event: KeyboardEvent) {
  if (event.isComposing) return
  if (event.key === 'Escape') { mention.value = undefined; return }
  const options = mentionOptions.value
  if (!options.length) return
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    mentionIndex.value = (mentionIndex.value + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length
  } else if (event.key === 'Enter') {
    event.preventDefault()
    void insertReference(options[mentionIndex.value]?.number || options[0].number)
  }
}


async function loadMedia() {
  const id = outputId.value
  const seq = ++mediaSeq
  if (!id) {
    mediaUrl.value = ''
    posterUrl.value = ''
    return
  }
  const url = (await assets.getUrl(id)) || (await library.getUrl(id)) || ''
  if (seq !== mediaSeq) return
  mediaUrl.value = url
  if (isVideo.value && url) {
    const thumb = await assets.ensureThumb(id).catch(() => '')
    if (seq !== mediaSeq) return
    posterUrl.value = thumb || ''
  } else {
    posterUrl.value = ''
  }
}

watch(
  () => outputId.value,
  () => {
    loadMedia().catch(() => {})
  },
  { immediate: true }
)

watch(
  () => generating.value,
  (on, was) => {
    if (was && !on) loadMedia().catch(() => {})
  }
)

watch(
  () => refs.value.join(','),
  async () => {
    const next: Record<string, string> = {}
    for (const id of refs.value) {
      next[id] = (await assets.getUrl(id)) || (await library.getUrl(id)) || ''
    }
    refUrls.value = next
  },
  { immediate: true }
)

watch(
  () => props.selected,
  (on) => {
    panelOpen.value = Boolean(on)
    if (!on) {
      expanded.value = false
      uploadOpen.value = false
      moreOpen.value = false
      durOpen.value = ''
    }
  },
  { immediate: true }
)

onMounted(() => {
  document.querySelectorAll('body > input[type="file"]').forEach((el) => el.remove())
})

onBeforeUnmount(() => {
  mediaSeq += 1
  mediaUrl.value = ''
  posterUrl.value = ''
})

watch(() => imageResults.value.join(','), async () => {
  const ids = [...imageResults.value]
  const urls: Record<string, string> = {}
  for (const id of ids) urls[id] = isVideo.value ? (await assets.ensureThumb(id).catch(() => '')) || '' : (await assets.getUrl(id)) || (await library.getUrl(id)) || ''
  if (ids.join(',') === imageResults.value.join(',')) resultUrls.value = urls
}, { immediate: true })
function chooseImageResult(id: string) { if (!generating.value) project.patchCanvasNode(props.id, { outputAssetId: id }) }
async function toggleExpanded() {
  expanded.value = !expanded.value
  uploadOpen.value = false
  await nextTick()
  if (isVideo.value) videoEditor.value?.focus()
  else promptInput.value?.focus()
}
function onComposerGenerateKeydown(event: KeyboardEvent) {
  if (!event.defaultPrevented && !event.isComposing && event.keyCode !== 229 && (event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault(); event.stopPropagation(); void generate()
  }
}
function onComposerKeydown(event: KeyboardEvent) {
  if (!expanded.value || event.defaultPrevented || event.isComposing || event.keyCode === 229) return
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); void toggleExpanded(); return }
  if (event.key !== 'Tab') return
  const panel = (event.currentTarget as HTMLElement)
  const items = [...panel.querySelectorAll<HTMLElement>('button:not(:disabled), textarea:not(:disabled), input:not(:disabled), select:not(:disabled), [contenteditable=true], [tabindex="0"]')]
    .filter(e => e.getClientRects().length)
  if (!items.length) return
  const first = items[0], last = items[items.length - 1]
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
}
const promptCharacterCount = computed(() => {
  const text = isVideo.value ? displayVideoReferenceTokens(prompt.value, videoReferenceBindings(activeVideoRefs.value.images, activeVideoRefs.value.audios, referenceMode.value ? node.value?.data.videoReferenceOrder : [])) : prompt.value
  return Array.from(text).length
})

function closeUpload(event: PointerEvent) {
  if (!(event.target as Element)?.closest('.composer-upload')) uploadOpen.value = false
}
onMounted(() => document.addEventListener('pointerdown', closeUpload, true))
onBeforeUnmount(() => document.removeEventListener('pointerdown', closeUpload, true))

function setRefs(ids: ID[]) {
  const max = videoModel.value === 'wan-prime' ? 10 : 9
  const inherited = new Set(boundRefs.value)
  const manual = [...new Set(ids)].filter((id) => !inherited.has(id))
  const next = manual.slice(0, Math.max(0, max - inherited.size))
  project.patchCanvasNode(props.id, {
    referenceAssetIds: next
  })
  updateNodeData(props.id, {
    ...props.data,
    referenceAssetIds: next,
    nodeType: type.value
  })
}

function previewRef(id: ID) {
  const url = refUrls.value[id]
  if (url) openLightbox(url, 'image')
}

function removeRef(id: ID, ev?: Event) {
  ev?.preventDefault()
  ev?.stopPropagation()
  project.removeCanvasNodeRef(props.id, id)
  const n = project.current?.canvas?.nodes.find((item) => item.id === props.id)
  updateNodeData(props.id, {
    ...props.data,
    referenceSourceNodeIds: n?.data.referenceSourceNodeIds ?? [],
    referenceAssetIds: n?.data.referenceAssetIds ?? [],
    nodeType: type.value
  })
  toast.success('已移除这张参考图')
}

async function onPickerConfirm(ids: ID[]) {
  pickerOpen.value = false
  if (!ids.length) return
  try {
    if (pickerMode.value === 'output') {
      const kind = isVideo.value ? 'video' : 'image'
      const asset = await assets.adopt(ids[0], kind, { projectId: project.current?.id })
      project.assignCanvasNodeAsset(props.id, asset.id)
      updateNodeData(props.id, {
        ...props.data,
        outputAssetId: asset.id,
        nodeType: type.value
      })
      await loadMedia()
      toast.success(isVideo.value ? '已选用该视频' : '已选用该图片')
      return
    }
    const resolved: ID[] = []
    for (const id of ids) {
      try {
        const copied = await assets.adopt(id, 'image', { projectId: project.current?.id })
        resolved.push(copied.id)
      } catch {
        resolved.push(id)
      }
    }
    if (isVideo.value && frameMode.value) assignFrames(resolved)
    else setRefs([...refs.value, ...resolved])
  } catch (e: any) {
    toast.error(e?.message || '选用失败')
  }
}

function openRefPicker() {
  if (isVideo.value && referenceMode.value) { videoEditor.value?.pick('image'); return }
  uploadOpen.value = false
  pickerTab.value = 'page'
  pickerMode.value = 'ref'
  pickerOpen.value = true
}

function openOutputPicker() {
  pickerMode.value = 'output'
  pickerOpen.value = true
}

function onEmptyClick() {
  if (generating.value) return
  if (props.selected && panelOpen.value) openOutputPicker()
}

function openLibraryRefs() {
  uploadOpen.value = false
  if (isVideo.value && referenceMode.value) { videoEditor.value?.pick('image', 'library'); return }
  openRefPicker()
  pickerTab.value = 'library'
}

function uploadRefs() {
  uploadOpen.value = false
  if (isVideo.value && referenceMode.value) { void videoEditor.value?.upload(); return }
  void pickAndAddRefs()
}

function assignFrames(ids: ID[]) {
  const limit = videoMode.value === 'first-last' ? 2 : 1
  if (ids.length > limit) { toast.warn(`此模式最多选择${limit}张帧图片，请重新选择。`); return }
  if (limit === 2 && ids.length === 1 && firstFrameId.value && !lastFrameId.value) { lastFrameId.value = ids[0]; return }
  if (ids[0]) firstFrameId.value = ids[0]
  if (limit === 2 && ids[1]) lastFrameId.value = ids[1]
}
async function pickAndAddRefs() {
  let files: File[]
  try {
    files = await pickLocalFiles({ kind: 'image', multiple: true })
  } catch (err: any) {
    toast.error(err?.message || '读取参考图失败')
    return
  }
  if (isVideo.value && frameMode.value && files.length > (isH3Fl2va.value ? 2 : 1)) { toast.warn('所选图片超过当前帧槽数量，请重新选择。'); return }
  const added: ID[] = []
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue
    const asset = await assets.add(file, 'image', 'uploaded', {
      filename: file.name,
      projectId: project.current?.id
    })
    added.push(asset.id)
  }
  if (added.length) { if (isVideo.value && frameMode.value) assignFrames(added); else setRefs([...refs.value, ...added]) }
}

function togglePlay() {
  previewFull()
}

function previewFull() {
  if (!mediaUrl.value) return
  openLightbox(mediaUrl.value, isVideo.value ? 'video' : 'image', title.value)
}

function cancelGeneration() {
  cancelNodeJob(props.id)
}

async function generate() {
  if (generating.value || assistingPrompt.value || extractingFrame.value) return
  if (imageReferenceIssue.value) {
    panelOpen.value = true
    toast.warn(`当前模型无法使用这${refs.value.length}张参考图，请先切换到支持参考编辑的模型。`)
    return
  }
  if (!prompt.value.trim() && !(isVideo.value && videoCaps.value.audioSync)) {
    toast.warn('请先写提示词')
    return
  }
  if (videoIssue.value) { panelOpen.value = true; toast.warn(videoIssue.value); return }
  moreOpen.value = false
  durOpen.value = ''
  busyLabel.value = isVideo.value ? '出视频…' : '出图…'
  try {
    await runCanvasNode(props.id, (_id, msg) => {
      busyLabel.value = msg
    })
    if (outputId.value) {
      const n = project.current?.canvas?.nodes.find((item) => item.id === props.id)
      updateNodeData(props.id, {
        ...(n?.data ?? props.data),
        outputAssetId: outputId.value,
        nodeType: type.value
      })
    }
    await loadMedia()
    if (isVideo.value && !outputId.value) {
      toast.error('生成结束，但视频没有写进节点。请看节点上的红字错误。', 10000)
    } else {
      toast.success(isVideo.value ? videoCount.value > 1 ? `${videoCount.value}条视频已生成` : '视频已生成' : imageCount.value > 1 ? `${imageCount.value}张图片已生成` : '图片已生成')
    }
  } catch (e: unknown) {
    if (shouldToastAiError(e)) toast.error(friendlyAiError(e) || '生成失败', 10000)
  } finally {
    busyLabel.value = ''
  }
}

async function publish() {
  if (!outputId.value) return
  moreOpen.value = false
  try {
    await library.publishFrom(outputId.value, {
      filename: title.value,
      prompt: prompt.value
    })
    toast.success('已加入公共资产库')
  } catch (e: any) {
    toast.error(e?.message || '入库失败')
  }
}

async function downloadAsset() {
  if (!outputId.value) return
  const blob = await assets.getBlob(outputId.value)
  if (!blob) {
    toast.error('素材读取失败')
    return
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${title.value}.${isVideo.value ? 'mp4' : 'png'}`
  a.click()
  URL.revokeObjectURL(url)
}

function copyPrompt() {
  const t = isVideo.value ? displayVideoReferenceTokens(prompt.value.trim(), videoReferenceBindings(activeVideoRefs.value.images, activeVideoRefs.value.audios, referenceMode.value ? node.value?.data.videoReferenceOrder : [])) : prompt.value.trim()
  if (!t) {
    toast.warn('没有提示词')
    return
  }
  navigator.clipboard.writeText(t).then(
    () => toast.success('已复制提示词'),
    () => toast.error('复制失败')
  )
  moreOpen.value = false
}


function duplicateSelf() {
  moreOpen.value = false
  durOpen.value = ''
  const nid = project.duplicateCanvasNode(props.id)
  if (!nid) {
    toast.warn('复制失败')
    return
  }
  toast.success('已复制节点')
  selectCanvasNode(nid)
}

async function grabLastFrame() {
  if (!isVideo.value || !outputId.value || generating.value || extractingFrame.value) return
  moreOpen.value = false
  extractingFrame.value = true
  try {
    await grabVideoLastFrameNode(props.id)
    toast.success('尾帧已截出，可在下一条视频的首帧中选择这张图片')
  } catch (error: any) {
    toast.error(error?.message || '截取尾帧失败')
  } finally {
    extractingFrame.value = false
  }
}

function removeSelf() {
  moreOpen.value = false
  if (!confirm('删除这个节点？')) return
  project.removeCanvasNode(props.id)
}
function onPanelPointerStart(event: Event) {
  stopNodeDragFromControls(event, expanded.value)
}

const imageReferenceSort = useReferenceReorder({
  ids: () => refs.value,
  scope: () => `${project.current?.id}:${props.id}`,
  disabled: () => generating.value || assistingPrompt.value,
  commit: async ids => {
    const p = project.current, n = node.value
    if (!p || !n) return
    project.patchCanvasNode(props.id, { referenceImageOrder: canvasReferenceImageOrder(p, n, ids), videoTaskId: undefined })
    mention.value = undefined
    try { await project.save() } catch (error: any) { toast.error(error?.message || '参考图顺序保存失败') }
  }
})
</script>

<template>
  <div class="fnode" :class="[`kind-${type}`, { on: selected && panelOpen, empty: !hasAsset, busy: generating }]">
    <NodeConnectionHandles />

    <transition name="float-up" :css="!contextMenuOpen">
      <div v-if="selected && panelOpen" v-show="overlaysVisible" class="toolbar-wrap nowheel" @pointerdown="onPanelPointerStart" @mousedown="onPanelPointerStart" @click.stop>
        <div class="toolbar">
          <button type="button" :disabled="generating || assistingPrompt || extractingFrame" @click="generate">
            <span>↺</span>{{ genLabel }}
          </button>
          <button v-if="!isVideo" type="button" :disabled="generating || assistingPrompt" title="通过AI优化当前图片提示词，可撤销" @click="promptTools?.optimize()">
            <span>✦</span>{{ assistingPrompt ? '处理中…' : '优化提示词' }}
          </button>
          <button type="button" :disabled="generating" title="选用已有资源，不重新生成" @click="openOutputPicker">
            <span>▣</span>选用
          </button>
          <button type="button" @click="duplicateSelf">
            <span>❐</span>复制
          </button>
          <button v-if="isVideo && hasAsset" type="button" :disabled="generating || extractingFrame" title="截取视频末尾画面，生成可供下一条视频选择的图片节点" @click="grabLastFrame">
            <span>◫</span>{{ extractingFrame ? '截取中…' : '截取尾帧' }}
          </button>
          <button v-if="hasAsset" type="button" @click="downloadAsset">
            <span>⬇</span>下载
          </button>
          <button type="button" class="icon" title="更多" @click="moreOpen = !moreOpen"><CanvasToolbarIcon name="more" :size="17" /></button>
          <button v-if="hasAsset" type="button" class="icon" :title="isVideo ? '播放视频' : '查看大图'" @click="previewFull"><CanvasToolbarIcon name="expand" :size="17" /></button>
          <div v-if="moreOpen" class="more">
            <button type="button" @click="copyPrompt">复制提示词</button>
            <button type="button" @click="duplicateSelf">复制节点</button>
            <button v-if="!isVideo && hasAsset" type="button" @click="publish">加入公共资产库</button>
            <button type="button" @click="removeSelf">删除节点</button>
          </div>
        </div>
      </div>
    </transition>

    <div class="image-node-heading">
      <span ref="nameLabel" class="node-title nokey" role="button" :tabindex="renaming ? -1 : 0" :title="`${title}（双击重命名）`" :aria-label="`重命名${isVideo ? '视频' : '图片'}节点：${title}`"
        @dblclick.stop.prevent="beginRename" @keydown.enter.prevent.stop="beginRename" @keydown.f2.prevent.stop="beginRename">
        <span aria-hidden="true">{{ isVideo ? '▶' : '▧' }}</span>
        <input v-if="renaming" ref="nameInput" v-model="nameDraft" class="node-title-input nodrag nopan nowheel nokey" aria-label="节点名称" autocomplete="off"
          @pointerdown.stop @mousedown.stop @click.stop @dblclick.stop @keydown.stop="onNameKeydown" @blur="finishRename()" />
        <span v-else class="node-title-text">{{ title }}</span>
      </span>
      <span>{{ outputDimensions }}</span>
    </div>
    <div class="media" :style="{ aspectRatio: cssAspectRatio(aspectRatio) }">
      <template v-if="isVideo && mediaUrl">
        <img
          v-if="posterUrl"
          class="nowheel frame"
          :draggable="false"
          :src="posterUrl"
          alt=""
        />
        <div v-else class="ready">视频已生成</div>
        <button
          class="play-btn nodrag"
          type="button"
          title="播放"
          @click.stop="previewFull"
          @mousedown.stop
        >
          ▶
        </button>
      </template>
      <img
        v-else-if="mediaUrl"
        class="nowheel"
        :draggable="false"
        :src="mediaUrl"
        alt=""
      />
      <div
        v-else
        class="ph pick"
        :title="isVideo ? '选用已有视频' : '选用已有图片'"
        @click="onEmptyClick"
      >
        {{ isVideo ? '▶' : '＋' }}
      </div>
      <span v-if="isVideo && previewDuration" class="dur-tag">{{ previewDuration }}s</span>
      <NodeBusyOverlay v-if="generating" :label="busyLabel || (isVideo ? '出视频…' : '出图…')" :started-at="nodeJobStartedAt(props.id)"
        :cancelable="isVideo && canCancelNodeJob(props.id)" :cancelling="isNodeCancelling(props.id)" @cancel="cancelGeneration" />
      <div v-if="node?.status === 'cancelled' && !generating" class="cancel-note" role="status">{{ node.error || '已取消本次生成，可修改参数后重新生成' }}</div>
      <div v-if="failMsg && !generating" class="fail" :title="failMsg">{{ failMsg }}</div>
    </div>

    <div v-if="imageResults.length > 1" class="image-results nowheel" aria-label="本次生成结果" @pointerdown="onPanelPointerStart" @mousedown="onPanelPointerStart" @click.stop>
      <button v-for="(id, index) in imageResults" :key="id" type="button" :aria-label="`查看第${index + 1}${isVideo ? '条' : '张'}结果`" :aria-pressed="outputId === id" :disabled="generating" @click="chooseImageResult(id)">
        <img v-if="resultUrls[id]" :src="resultUrls[id]" :draggable="false" alt="" /><span>{{ index + 1 }}</span>
      </button>
    </div>
    <Teleport to="body"><div v-if="expanded && overlaysVisible" class="image-composer-mask" :style="editorWindow.maskStyle.value" @pointerdown.prevent @click="toggleExpanded" /></Teleport>
    <Teleport to="body" :disabled="!expanded">
      <div
        v-if="selected && panelOpen"
        v-show="overlaysVisible"
        class="prompt nowheel"
        :class="{ 'image-composer': true, 'video-composer': isVideo, 'is-expanded': expanded, nodrag: expanded, 'is-window-dragging': editorWindow.dragging.value }"
        :style="editorWindow.style.value"
        :role="expanded ? 'dialog' : undefined" :aria-modal="expanded || undefined" :aria-label="expanded ? isVideo ? '编辑视频提示词' : '编辑图片提示词' : undefined"
        @keydown.capture="onComposerGenerateKeydown"
        @keydown="onComposerKeydown"
        @pointerdown="onPanelPointerStart"
        @mousedown="onPanelPointerStart"
        @click.stop
      >
        <header v-if="expanded" class="editor-window-header">
          <div class="editor-window-drag" role="button" tabindex="0" aria-label="移动提示词编辑窗口" title="拖动以移动窗口；方向键微调，Shift加速；双击居中" @pointerdown="editorWindow.startDrag" @keydown="editorWindow.moveByKey" @dblclick="editorWindow.center">
            <svg viewBox="0 0 20 20" width="20" height="20" fill="currentColor" aria-hidden="true"><circle v-for="(point, i) in [[7,5],[13,5],[7,10],[13,10],[7,15],[13,15]]" :key="i" :cx="point[0]" :cy="point[1]" r="1" /></svg>
            <div class="editor-document-title"><strong>{{ title }}</strong><span>{{ isVideo ? '视频' : '图片' }}提示词 · 输入同步到节点</span></div>
            <span class="editor-drag-tip">拖动窗口，查看画布</span>
          </div>
          <div class="editor-window-actions">
            <button type="button" class="editor-window-icon" aria-label="居中提示词窗口" title="恢复默认大小并居中" @click="editorWindow.center"><svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="4" y="4" width="12" height="12" rx="2" /><path d="M1 10h4m10 0h4M10 1v4m0 10v4" /></svg></button>
            <button type="button" class="editor-window-icon" :aria-label="editorWindow.maximized.value ? '还原提示词窗口' : '最大化提示词窗口'" :title="editorWindow.maximized.value ? '还原窗口' : '最大化编辑'" @click="editorWindow.toggleMaximized"><CanvasToolbarIcon name="expand" :size="17" /></button>
            <button type="button" class="editor-window-icon editor-window-close" aria-label="收起提示词编辑" title="收起编辑 · Esc" @click="toggleExpanded"><svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" /></svg></button>
          </div>
        </header>
        <div class="composer-tools">
          <div v-if="!isVideo || videoMode !== 'text'" class="composer-upload">
            <button class="composer-tool" type="button" :disabled="generating" :aria-expanded="uploadOpen" aria-haspopup="menu" @click="uploadOpen = !uploadOpen">＋ 上传</button>
            <div v-if="uploadOpen" class="composer-upload-menu" role="menu" @keydown.esc.stop="uploadOpen = false">
              <button type="button" role="menuitem" @click="uploadRefs">本地上传</button>
              <button type="button" role="menuitem" @click="openLibraryRefs">资产库上传</button>
            </div>
          </div>
          <button v-if="!isVideo || videoMode !== 'text'" class="composer-tool" type="button" :disabled="generating" title="从本页图片节点选择参考图" @click="openRefPicker">▧ 画布参考</button>
          <button v-if="isVideo && videoMode === 'omni'" class="composer-tool" type="button" :disabled="generating" @click="videoEditor?.pick('audio')">♫ 参考声音</button>
          <span v-if="!isVideo && refs.length" class="composer-ref-count">{{ refs.length }}张参考图</span>
          <div v-if="expanded" class="editor-reading-tools">
            <div class="editor-font-controls" role="group" aria-label="编辑字号">
              <button type="button" aria-label="缩小文字" title="缩小文字" :disabled="editorWindow.fontSize.value <= 14" @pointerdown.prevent @click="editorWindow.fontSize.value--">A−</button>
              <output aria-label="当前字号">{{ editorWindow.fontSize.value }}</output>
              <button type="button" aria-label="放大文字" title="放大文字" :disabled="editorWindow.fontSize.value >= 22" @pointerdown.prevent @click="editorWindow.fontSize.value++">A＋</button>
            </div>
            <label class="editor-backdrop-control"><span>背景</span><input type="range" v-model.number="editorWindow.backdrop.value" min="0" max="30" step="2" aria-label="背景遮罩深度" title="向左更清晰，向右更暗" /></label>
          </div>
          <button v-else class="composer-expand" type="button" :aria-label="expanded ? '收起提示词编辑' : '放大提示词编辑'" :title="expanded ? '收起编辑' : '放大编辑提示词'" @click="toggleExpanded"><CanvasToolbarIcon name="expand" :size="17" /></button>
        </div>
        <AutoDlVideoInputs v-if="isVideo && videoCaps.audioSync" :node-id="props.id" :disabled="generating" />
        <FramePairSlots
          v-else-if="frameMode"
          compact
          draggable-background
          :single="videoMode === 'image'"
          :disabled="generating"
          v-model:first-id="firstFrameId"
          v-model:last-id="lastFrameId"
        />
        <div v-else-if="!isVideo && refs.length" class="refs" role="list" aria-label="参考图，可拖拽排序">
          <div v-for="(id, index) in refs" :key="id" class="thumb nodrag nopan nowheel" role="listitem" tabindex="0"
            :aria-label="`参考图 @${index + 1}，拖拽或按 Alt 加左右方向键排序`" title="拖拽排序；Alt + ← / → 调整顺序"
            :draggable="!generating && !assistingPrompt"
            :class="{ 'ref-dragging': imageReferenceSort.dragging.value === id, 'ref-drop-before': imageReferenceSort.target.value === id && !imageReferenceSort.after.value, 'ref-drop-after': imageReferenceSort.target.value === id && imageReferenceSort.after.value }"
            @dragstart.stop="imageReferenceSort.start($event, id)" @dragover.stop="imageReferenceSort.over($event, id)" @dragleave.stop="imageReferenceSort.leave" @drop.stop="imageReferenceSort.drop($event, id)" @dragend.stop="imageReferenceSort.end" @keydown="imageReferenceSort.key($event, id)">
            <button type="button" class="thumb-preview nodrag" title="查看大图" @pointerdown.stop @click.stop="previewRef(id)">
              <img v-if="refUrls[id]" :src="refUrls[id]" :draggable="false" alt="" />
            </button>
            <button type="button" class="thumb-ref-number" :title="`在提示词插入 @${index + 1}`"
              @pointerdown.prevent.stop @click.stop="insertReference(index + 1)">@{{ index + 1 }}</button>
            <button
              type="button"
              class="thumb-del nodrag nopan nowheel"
              title="移除这张参考图"
              @pointerdown.stop.prevent="removeRef(id, $event)"
            >
              ×
            </button>
          </div>

        </div>
        <p v-if="isVideo && !referenceMode && preservedVideoRefs" class="ref-hint">{{ videoMode === 'text' ? '此模式仅使用文字' : '此模式仅使用上方帧图片' }}。已保留的其他图片和声音不参与本次生成。</p>
        <p v-if="videoIssue" class="ref-model-warning" role="alert">{{ videoIssue }}</p>
        <div v-if="refs.length && !isH3Fl2va && !isVideo" class="ref-hint">拖拽缩略图调整顺序，@1、@2 按新顺序对应。当前：{{ isVideo ? effectiveVideoProfile?.name || '视频接入' : selectedImageLabel }}</div>
        <div v-if="imageReferenceIssue" class="ref-model-warning" role="alert">
          <span>已连接{{ refs.length }}张参考图，当前模型无法执行本次参考图编辑。</span>
          <button v-if="referenceModel" type="button" class="switch-ref-model" :disabled="generating"
            @click.stop="switchReferenceModel">切换到 {{ referenceModelLabel }}</button>
          <span v-else>请在「出图」中选择支持这些参考图的模型，或在设置中添加接入。</span>
        </div>
        <VideoReferenceEditor v-if="isVideo && !videoCaps.audioSync" ref="videoEditor" draggable-background :node-id="props.id" v-model="prompt" hide-actions :max-images="videoCaps.maxImages" :hide-references="!referenceMode" :image-asset-ids="referenceMode ? undefined : activeVideoRefs.images" :audio-asset-ids="referenceMode ? undefined : []" :placeholder="videoMode === 'text' ? '描述你想生成的画面、动作、镜头和声音…' : frameMode ? '描述帧图片之间的动作、镜头和声音…' : undefined" :allow-audio="videoMode === 'omni'" :disabled="generating || assistingPrompt" />
        <textarea v-else-if="!isVideo"
          :disabled="generating || assistingPrompt"
          ref="promptInput"
          v-model="prompt"
          @input="updateMention"
          @click="updateMention"
          @keyup="event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) updateMention() }"
          @keydown="onPromptKeydown"
          @blur="mention = undefined"
          rows="6"
          :placeholder="
            isVideo
              ? isH3Fl2va
                ? '写首尾帧视频提示词，描述两帧之间的动作、镜头和声音…'
                : videoMode === 'text' ? '描述你想生成的画面、动作、镜头和声音…' : '描述首帧之后的动作、镜头运动和声音…'
              : '写提示词，输入 @ 选择参考图，例如 @1 的人物手持 @2 的武器…'
          "
        />
        <div v-if="!isVideo && !isH3Fl2va && mention && mentionOptions.length" class="ref-mention-menu" role="listbox" aria-label="选择参考图">
          <button v-for="(item, index) in mentionOptions" :key="item.id" type="button" role="option"
            :aria-selected="index === mentionIndex" :class="{ active: index === mentionIndex }"
            @pointerdown.prevent.stop @click.stop="insertReference(item.number)">
            <img v-if="refUrls[item.id]" :src="refUrls[item.id]" alt="" />
            <span>@{{ item.number }} 参考图 {{ item.number }}</span>
          </button>
        </div>
        <div v-if="expanded" class="editor-document-status"><span>{{ promptCharacterCount.toLocaleString() }} 字符</span><span>Enter 换行<span class="editor-shortcut-hint"> · Ctrl / ⌘ + Enter 生成</span> · Esc 收起</span></div>
        <div class="prompt-foot">
          <ImageModelSelect v-if="!isVideo" menu :reference-count="refs.length" :node-id="props.id" />
          <VideoModelSelect
          :node-id="props.id"
            v-else
            menu
            v-model="videoModel"
            :profile-id="node?.data.videoProfileId"
            @select-profile="(id) => applyShotVideoProfile(props.id, id)"
          />
          <VideoGenerationModeSelect v-if="isVideo" :node-id="props.id" />
          <!-- 比例和模型同排：一眼看到「用什么模型、出什么画幅」 -->
          <NativeH3VideoControls v-if="isVideo" :node-id="props.id" />
          <PromptAssistantTools v-if="!isVideo || !videoCaps.audioSync" ref="promptTools" :node-id="props.id" :is-video="isVideo" :is-h3="isH3Video" :duration="duration" :min-duration="videoCaps.min" :max-duration="videoCaps.max" :duration-options="videoCaps.durations" :disabled="generating" @busy="assistingPrompt = $event" />
          <button class="go" type="button" :disabled="generating || assistingPrompt || Boolean(imageReferenceIssue) || Boolean(videoIssue)" :title="videoIssue || (imageReferenceIssue ? '请先切换到支持参考图的模型' : genLabel)" @click="generate">↑</button>
        </div>
      </div>
    </Teleport>

    <GenerationDetails :asset-id="outputId" draggable-header />

    <AssetPicker
      :open="pickerOpen"
      :kind="pickerMode === 'output' && isVideo ? 'video' : 'image'"
      :multiple="pickerMode === 'ref'"
      :title="
        pickerMode === 'output'
          ? isVideo
            ? '选用已有视频作为本节点结果'
            : '选用已有图片作为本节点结果'
          : isVideo
            ? videoModel === 'wan-prime'
              ? '选择参考图（最多 10 张，提示词里可用图1、图2）'
              : '选择参考图（本页或公共库）'
            : '选择参考图'
      "
      :page-ids="pickerMode === 'ref' ? pageImageIds : undefined"
      :show-library="pickerMode === 'ref' || !isVideo"
      :default-tab="pickerMode === 'output' ? 'page' : pickerTab"
      :selected-ids="pickerMode === 'output' && outputId ? [outputId] : []"
      @close="pickerOpen = false"
      @confirm="onPickerConfirm"
    />
  </div>
</template>

<style scoped>
.cancel-note { position: absolute; bottom: 6px; left: 6px; right: 6px; padding: 5px 7px; border-radius: 5px; background: rgba(18, 18, 22, .9); color: #ddd; font-size: 11px; z-index: 5; }
.fnode {
  position: relative;
  width: 240px;
  background: var(--color-bg-1);
  border: 1px solid var(--color-node-border);
  border-radius: 12px;
  overflow: visible;
  color: var(--color-text-1);
  box-shadow: var(--shadow-node);
}
.fnode.on {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 1px rgba(126, 180, 255, 0.35), var(--shadow-md);
  z-index: 4;
}
.fnode.busy {
  border-color: var(--color-accent);
  z-index: 5;
}
.toolbar-wrap {
  position: absolute;
  left: 50%;
  bottom: calc(100% + 8px);
  transform: translateX(-50%);
  z-index: 6;
  transform-origin: 50% 100%;
}
.toolbar {
  position: relative;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px;
  border-radius: 10px;
  background: #2a2a32;
  color: var(--color-text-1);
  border: 1px solid var(--color-border);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.45);
  white-space: nowrap;
}
.toolbar > button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin: 0;
  padding: 6px 8px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--color-text-1);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.toolbar > button span {
  font-size: 11px;
  opacity: 0.7;
}
.toolbar > button:hover:not(:disabled) {
  background: var(--color-fill-hover);
}
.toolbar > button:disabled {
  opacity: 0.35;
  cursor: default;
}
.toolbar > button.icon {
  width: 30px;
  justify-content: center;
  padding: 6px 0;
}
.more {
  position: absolute;
  top: calc(100% + 4px);
  right: 4px;
  min-width: 148px;
  padding: 4px;
  border-radius: 8px;
  background: var(--color-bg-2);
  border: 1px solid var(--color-border);
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.45);
}
.more button {
  display: block;
  width: 100%;
  margin: 0;
  padding: 7px 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  text-align: left;
  font-size: 12px;
  color: var(--color-text-1);
  cursor: pointer;
}
.more button:hover {
  background: var(--color-fill-hover);
}
.media {
  position: relative;
  width: 100%;
  background: var(--color-node-well);
  overflow: hidden;
  border-radius: 12px 12px 0 0;
}
.media img,
.media video,
.media .frame {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}
.ready {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-3);
  font-size: 12px;
  font-weight: 650;
}
.fail {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 7;
  padding: 6px 8px;
  background: rgba(180, 40, 40, 0.92);
  color: #fff;
  font-size: 11px;
  line-height: 1.35;
  font-weight: 650;
  max-height: 46%;
  overflow: auto;
}
.play-btn {
  position: absolute;
  left: 50%;
  top: 50%;
  z-index: 2;
  width: 44px;
  height: 44px;
  margin: 0;
  padding: 0 0 2px 3px;
  border: none;
  border-radius: 50%;
  transform: translate(-50%, -50%);
  background: rgba(0, 0, 0, 0.62);
  color: #fff;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
}
.play-btn:hover {
  background: var(--color-accent);
}
.ph {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-4);
  font-size: 18px;
}
.ph.pick {
  cursor: pointer;
}
.dur-tag {
  position: absolute;
  right: 8px;
  bottom: 8px;
  padding: 2px 6px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 10px;
}
.name {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  padding: 0 10px;
}
.kind {
  font-size: 10px;
  font-weight: 700;
  color: var(--color-text-4);
  letter-spacing: 0.04em;
}
.title {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  font-weight: 650;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.prompt {
  position: absolute;
  left: 0;
  top: calc(100% + 8px);
  z-index: 5;
  width: 420px;
  min-width: 280px;
  transform-origin: 0 0;
  overflow: visible;
  background: linear-gradient(155deg, rgba(126, 180, 255, 0.04), transparent 55%), var(--color-node-editor);
  border: 1px solid var(--color-node-editor-border);
  border-radius: 12px;
  padding: 10px 12px;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05), var(--shadow-node-editor);
}
.prompt:focus-within {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 2px rgba(126, 180, 255, 0.14), var(--shadow-node-editor);
}
.prompt textarea::placeholder { color: var(--color-text-3); opacity: 1; }
.prompt:not(.is-expanded) .prompt-foot { border-top: 1px solid rgba(255, 255, 255, 0.09); padding-top: 8px; }

.refs {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 8px;
  margin: 0 0 8px;
  padding-top: 2px;
  overflow: visible;
}
.thumb {
  position: relative;
  width: 48px;
  height: 48px;
  flex-shrink: 0;
  z-index: 2;
  overflow: visible;
  pointer-events: auto;
}
.thumb[draggable="true"] { cursor:grab; }
.thumb.ref-dragging { opacity:.4; }
.thumb.ref-drop-before::before,.thumb.ref-drop-after::after { content:''; position:absolute; top:0; bottom:0; width:3px; background:var(--color-text-1); border-radius:2px; pointer-events:none; }
.thumb.ref-drop-before::before { left:-5px; }
.thumb.ref-drop-after::after { right:-5px; }
.thumb:focus-visible { outline:2px solid var(--color-text-1); outline-offset:3px; }
.thumb-preview,
.add {
  width: 48px;
  height: 48px;
  margin: 0;
  padding: 0;
  border-radius: 8px;
  border: 1px solid var(--color-border);
  overflow: hidden;
  background: var(--color-bg-2);
  color: var(--color-text-3);
  cursor: pointer;
  pointer-events: auto;
}
.add {
  width: 36px;
  height: 36px;
  font-size: 16px;
  align-self: flex-start;
}
.thumb-preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  pointer-events: none;
}
.thumb-ref-number {
  position: absolute; left: 0; bottom: 0; z-index: 4; padding: 1px 4px; border: none;
  border-radius: 4px; background: #191919d9; color: white; font-size: 11px; cursor: pointer;
}
.ref-model-warning { margin: 4px 0 8px; padding: 8px; border: 1px solid var(--color-border); border-radius: 8px; color: var(--color-text-1); font-size: 11px; line-height: 1.5; display: grid; gap: 6px; }
.switch-ref-model { padding: 6px 8px; border: 1px solid var(--color-accent); border-radius: 6px; background: var(--color-bg-2); color: var(--color-accent); cursor: pointer; font: inherit; }
.switch-ref-model:disabled { opacity: .5; cursor: default; }
.ref-hint { margin: 2px 0 6px; color: var(--color-text-3); font-size: 11px; line-height: 1.5; }
.ref-mention-menu {
  max-height: 180px; overflow-y: auto; padding: 4px; margin-bottom: 6px;
  border: 1px solid var(--color-border); border-radius: 8px; background: var(--color-bg-2);
}
.ref-mention-menu button {
  display: flex; align-items: center; gap: 8px; width: 100%; padding: 5px; border: none;
  background: transparent; color: var(--color-text-1); text-align: left; cursor: pointer;
}
.ref-mention-menu button.active, .ref-mention-menu button:hover { background: var(--color-fill-hover); }
.ref-mention-menu img { width: 28px; height: 28px; border-radius: 4px; object-fit: cover; }
.thumb-del {
  position: absolute;
  top: -6px;
  right: -6px;
  z-index: 8;
  box-sizing: border-box;
  width: 20px;
  height: 20px;
  margin: 0;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1.5px solid #fff;
  border-radius: 50%;
  background: #e5484d;
  color: #fff !important;
  font-size: 14px;
  font-weight: 800;
  line-height: 1;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.55);
  cursor: pointer;
  pointer-events: auto;
}
.thumb-del:hover {
  background: #c63c41;
}
.prompt textarea {
  width: 100%;
  min-height: 120px;
  resize: vertical;
  border: none;
  outline: none;
  background: transparent;
  color: var(--color-text-1);
  font-size: 13px;
  line-height: 1.55;
  font-family: inherit;
}
.prompt-tools {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 4px;
}
.opt {
  margin: 0;
  padding: 0;
  border: none;
  background: none;
  color: var(--color-accent);
  font-size: 11px;
  font-weight: 650;
  cursor: pointer;
}
.opt:disabled {
  opacity: 0.4;
  cursor: default;
}
.prompt-foot {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}
.prompt-foot > :deep(.psel:first-child) {
  flex: 1 1 140px;
}
.prompt-foot > .go {
  margin-left: auto;
}
.dur-edit {
  position: relative;
  flex: 0 0 auto;
}
.dur-btn {
  display: block;
  height: 28px;
  min-width: 76px;
  margin: 0;
  padding: 0 26px 0 10px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background-color: var(--color-bg-2);
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'><path d='M1.4 2.2L6 6.2l4.6-4' fill='none' stroke='%2394a3b8' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/></svg>");
  background-repeat: no-repeat;
  background-position: right 8px center;
  background-size: 10px;
  color: var(--color-text-1);
  font-size: 12px;
  font-weight: 650;
  cursor: pointer;
  outline: none;
  transition: border-color 0.15s, background-color 0.15s;
}
.dur-btn:hover {
  border-color: var(--color-text-4, #64748b);
  background-color: var(--color-bg-3);
}
.dur-menu {
  position: absolute;
  right: 0;
  bottom: calc(100% + 4px);
  z-index: 8;
  min-width: 88px;
  max-height: 220px;
  overflow: auto;
  padding: 4px;
  border-radius: 8px;
  background: var(--color-bg-2);
  border: 1px solid var(--color-border);
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.45);
}
.dur-menu button {
  display: block;
  width: 100%;
  margin: 0;
  padding: 6px 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  text-align: left;
  font-size: 12px;
  font-weight: 650;
  color: var(--color-text-1);
  cursor: pointer;
}
.dur-menu button:hover,
.dur-menu button.on {
  background: var(--color-fill-hover);
}
.dur-menu-down {
  bottom: auto;
  top: calc(100% + 4px);
}
.go {
  width: 28px;
  height: 28px;
  margin-left: auto;
  border: none;
  border-radius: 50%;
  background: #ececef;
  color: #111;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
}
.go:disabled {
  opacity: 0.4;
}
.float-up-enter-active,
.float-up-leave-active,
.float-down-enter-active,
.float-down-leave-active {
  transition: opacity 0.2s ease, transform 0.22s cubic-bezier(0.22, 1, 0.36, 1);
}
.float-up-enter-from,
.float-up-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(6px);
}
.float-down-enter-from,
.float-down-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
.image-node-heading { position:absolute; bottom:calc(100% + 8px); left:0; width:100%; display:flex; align-items:center; justify-content:space-between; gap:8px; color:var(--color-text-2); font-size:10px; white-space:nowrap; }
.image-node-heading > span:first-child { overflow:hidden; text-overflow:ellipsis; }
.image-node-heading > span:last-child { flex-shrink:0; color:var(--color-text-3); font-variant-numeric:tabular-nums; }
.node-title { display:flex; align-items:center; gap:4px; flex:1; min-width:0; cursor:grab; }
.node-title:active { cursor:grabbing; }
.node-title:focus-visible { outline:1px solid var(--color-accent); outline-offset:2px; border-radius:3px; }
.node-title > span:first-child { flex-shrink:0; }
.node-title-text { min-width:0; overflow:hidden; text-overflow:ellipsis; }
.node-title-input { flex:1; width:0; min-width:0; height:20px; box-sizing:border-box; padding:1px 4px; border:1px solid var(--color-accent); border-radius:4px; outline:none; background:var(--color-bg-1); color:var(--color-text-1); font:inherit; cursor:text; user-select:text; }
.fnode .toolbar-wrap { bottom:calc(100% + 34px); }
.kind-imageGen .name { display:none; }
.toolbar-wrap, .image-results, .prompt.image-composer:not(.is-expanded) { cursor:grab; }
.prompt textarea, .prompt :deep([contenteditable]) { cursor:text; }
.prompt.image-composer { width:620px; left:50%; transform:translateX(-50%); padding:14px 16px; border-radius:18px; display:flex; flex-direction:column; gap:10px; }
.image-composer .composer-tools { display:flex; align-items:center; gap:7px; }
.composer-tool { display:flex; align-items:center; gap:5px; border:0; border-radius:7px; background:var(--color-bg-2); color:var(--color-text-2); padding:5px 8px; font:inherit; font-size:11px; cursor:pointer; }
.composer-tool:hover { background:var(--color-bg-3); color:var(--color-text-1); }
.composer-expand { display:grid; place-items:center; margin-left:auto; padding:4px; border:0; border-radius:6px; background:transparent; color:var(--color-text-3); cursor:pointer; }
.composer-expand:hover { background:var(--color-bg-3); color:var(--color-text-1); }
.composer-ref-count { color:var(--color-text-3); font-size:10px; }
.composer-upload { position:relative; }
.composer-upload-menu { position:absolute; left:0; top:calc(100% + 6px); z-index:10; min-width:150px; border:1px solid var(--color-border); border-radius:10px; padding:5px; background:var(--color-bg-1); box-shadow:var(--shadow-md); }
.composer-upload-menu button { display:block; width:100%; padding:9px 10px; border:0; border-radius:6px; background:transparent; color:var(--color-text-1); text-align:left; font:inherit; font-size:12px; cursor:pointer; }
.composer-upload-menu button:hover { background:var(--color-bg-3); }
.image-composer textarea { min-height:134px; flex:1; resize:vertical; padding:2px 0; font-size:13px; line-height:1.9; box-sizing:border-box; }
.image-composer .refs { margin:0; padding:0; }
.image-composer .prompt-foot { margin-top:0; gap:8px; flex-wrap:wrap; }
.image-composer .prompt-foot > :deep(.prompt-assistant-tools) { margin-left:auto; }
.image-composer .prompt-foot > .go { margin-left:0; }
.image-composer .prompt-foot :deep(.generation-settings-trigger) { background:transparent; border-color:transparent; padding:0 5px; height:30px; font-size:11px; }
.image-composer .prompt-foot :deep(.generation-settings-trigger:first-child) { max-width:225px; }
.image-composer .prompt-foot .go { width:32px; height:32px; flex:0 0 32px; border-radius:50%; background:var(--color-text-1); color:var(--color-bg-1); }
.image-results { display:flex; justify-content:center; gap:6px; padding:8px; }
.image-results button { position:relative; border:1px solid var(--color-border); border-radius:5px; padding:0; width:42px; height:36px; overflow:hidden; background:var(--color-bg-2); color:var(--color-text-1); cursor:pointer; }
.image-results button[aria-pressed=true] { border:2px solid var(--color-accent); }
.image-results img { display:block; width:100%; height:100%; object-fit:cover; }
.image-results span { position:absolute; bottom:1px; right:2px; padding:0 3px; border-radius:3px; background:#0008; color:white; font-size:9px; }
.image-composer-mask { position:fixed; inset:0; z-index:9000; background:rgba(0,0,0,.12); }
.prompt.image-composer.is-expanded { position:fixed; z-index:9001; transform:none; min-width:0; max-height:calc(100dvh - 24px); box-sizing:border-box; color:var(--color-text-1); padding:0; gap:0; border-radius:16px; box-shadow:0 24px 80px #0004,0 2px 8px #0002; }
.image-composer.is-expanded textarea { resize:none; min-height:0; width:100%; margin:0; padding:28px clamp(20px,5vw,72px); border:0; border-radius:0; background:var(--color-bg-1); font-size:var(--prompt-editor-font-size,16px); line-height:2; letter-spacing:.02em; outline:none; overflow-y:auto; scrollbar-gutter:stable; }
.editor-window-header { display:flex; align-items:center; min-height:68px; flex-shrink:0; padding:0 14px 0 18px; border-bottom:1px solid var(--color-border); }
.editor-window-drag { display:flex; align-items:center; gap:12px; flex:1; min-width:0; min-height:66px; cursor:grab; touch-action:none; user-select:none; border-radius:8px; outline-offset:-4px; }
.editor-window-drag > svg { color:var(--color-text-3); flex-shrink:0; }
.editor-document-title { display:flex; flex-direction:column; min-width:0; gap:5px; }
.editor-document-title strong { font-size:15px; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.editor-document-title > span { color:var(--color-text-3); font-size:11px; }
.editor-drag-tip { margin-left:auto; padding:0 18px; color:var(--color-text-3); font-size:11px; white-space:nowrap; }
.editor-window-actions { display:flex; align-items:center; gap:4px; padding-left:8px; }
.editor-window-icon { display:grid; place-items:center; width:32px; height:32px; padding:0; border:0; border-radius:7px; background:transparent; color:var(--color-text-2); cursor:pointer; }
.editor-window-icon:hover { background:var(--color-bg-3); color:var(--color-text-1); }
.is-window-dragging .editor-window-drag { cursor:grabbing; }
.image-composer.is-expanded .composer-tools { padding:10px 22px; border-bottom:1px solid var(--color-border); min-height:34px; flex-shrink:0; flex-wrap:wrap; }
.editor-reading-tools { display:flex; align-items:center; gap:16px; margin-left:auto; }
.editor-font-controls { display:flex; align-items:center; gap:6px; }
.editor-font-controls button { border:0; border-radius:5px; padding:3px 6px; background:transparent; color:var(--color-text-2); cursor:pointer; font:inherit; font-size:12px; }
.editor-font-controls button:hover:not(:disabled) { background:var(--color-bg-3); }
.editor-font-controls button:disabled { opacity:.35; cursor:default; }
.editor-font-controls output { color:var(--color-text-3); font-size:11px; min-width:16px; text-align:center; }
.editor-backdrop-control { display:flex; align-items:center; gap:7px; color:var(--color-text-3); font-size:11px; }
.editor-backdrop-control input { width:72px; accent-color:var(--color-accent); cursor:pointer; }
.editor-document-status { display:flex; justify-content:space-between; gap:12px; padding:8px 24px; flex-shrink:0; font-size:11px; color:var(--color-text-3); }
.image-composer.is-expanded .prompt-foot { border-top:1px solid var(--color-border); padding:12px 22px; }
.image-composer.is-expanded > .refs { padding:10px 24px 0; }
.image-composer.is-expanded > .frames { padding:8px 22px 0; }
.image-composer.is-expanded > .ref-hint,.image-composer.is-expanded > .ref-model-warning { margin:6px 24px; flex-shrink:0; }
@media (max-width:760px) {
  .editor-window-header { min-height:60px; padding:0 8px; }
  .editor-window-drag { min-height:58px; gap:6px; }
  .editor-document-title strong { font-size:13px; }
  .editor-drag-tip { display:none; }
  .editor-window-actions { gap:0; padding-left:4px; }
  .editor-window-icon { width:28px; }
  .image-composer.is-expanded .composer-tools { padding:8px 12px; gap:6px; }
  .editor-reading-tools { gap:8px; }
  .editor-backdrop-control { gap:4px; }
  .editor-backdrop-control input { width:44px; }
  .image-composer.is-expanded textarea { padding:18px 20px; }
  .editor-document-status { padding:8px 14px; font-size:10px; }
  .editor-shortcut-hint { display:none; }
  .image-composer.is-expanded .prompt-foot { padding:10px 12px; }
}
.image-composer.is-expanded .refs { max-height:110px; overflow:auto; flex-shrink:0; }
.image-composer.is-expanded .prompt-foot { flex-shrink:0; }
@media (max-width:760px) { .prompt.image-composer { width:500px; } .image-composer .prompt-foot { flex-wrap:wrap; gap:6px; } .image-composer .prompt-foot :deep(.generation-settings-trigger:first-child) { max-width:200px; } }
.prompt.video-composer { width:680px; }
.video-composer .prompt-foot :deep(.generation-settings-trigger) { min-width:0; max-width:220px; }
.video-composer .prompt-foot :deep(.generation-settings-trigger:first-child) { max-width:190px; }
.video-composer :deep(.reference-prompt) { min-height:128px; padding:0; font-size:13px; line-height:1.9; }
.video-composer :deep(.reference-strip) { padding-bottom:6px; }
.video-composer.is-expanded :deep(.video-reference-editor) { display:flex; flex-direction:column; flex:1; min-height:0; }
.video-composer.is-expanded :deep(.reference-prompt) { flex:1; min-height:0; max-height:none; box-sizing:border-box; padding:28px clamp(20px,5vw,72px); font-size:var(--prompt-editor-font-size,16px); line-height:2; letter-spacing:.02em; scrollbar-gutter:stable; }
.video-composer.is-expanded :deep(.reference-strip) { padding:8px 24px; }
.video-composer.is-expanded :deep(.reference-tip),.video-composer.is-expanded :deep(.reference-warning) { margin:4px 24px; flex-shrink:0; }
@media (max-width:760px) { .video-composer.is-expanded :deep(.reference-prompt) { padding:18px 20px; } }
.video-composer.is-expanded :deep(.reference-strip) { flex-shrink:0; max-height:100px; }
.video-composer.is-expanded .frames { flex-shrink:0; }
@media (max-width:760px) { .prompt.video-composer { width:540px; } }
</style>
