<script setup lang="ts">
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { runAssistantTurn } from '@/services/assistant/codexEngine'
import AssistantEngineSelect from './AssistantEngineSelect.vue'
import CodexRunSelect from './CodexRunSelect.vue'
import CodexChatHistory from './CodexChatHistory.vue'
import { type AgentEvent, type AgentMessage } from '@/services/canvas/agent'
import { friendlyAiError, isAbortError, isTimeoutAbort } from '@/services/ai/abort'
import { agentConversations, appendAgentMessage, getAgentState, renameAgentConversation, setAgentAutonomy, startAgentConversation, switchAgentConversation } from '@/services/canvas/taskStore'
import { estimateRequestText, estimateToolActions } from '@/services/canvas/toolRegistry'
import { onCanvasActivity, type CanvasActivity } from '@/services/canvas/canvasBridge'
import { nextPipelineStep } from '@/services/canvas/pipeline'
import { useAssetsStore, useProjectStore, useSettingsStore, useToastStore } from '@/stores'
import { desktop, isDesktop } from '@/services/desktop'
import { autodlVideoProfileId } from '@/services/ai/runtime'
import type { VideoGenModel } from '@/types'
import type { AgentAttachment } from '@/services/canvas/attachments'
import type { TraceRow, TraceStatus } from '@/services/canvas/agentTrace'
import type { AgentAutonomy, AspectRatio, CanvasNode } from '@/types'
import AgentMemoryPanel from './AgentMemoryPanel.vue'
import AgentRichText from './AgentRichText.vue'
import AgentTraceList from './AgentTraceList.vue'
import AgentOrb from './AgentOrb.vue'
import DirectorIcon from './DirectorIcon.vue'
import { createReferencePickerScroll } from './referencePickerScroll'

const props = withDefaults(
  defineProps<{
    selectedNode?: CanvasNode | null
    active?: boolean
    expanded?: boolean
    docked?: boolean
  }>(),
  { selectedNode: null, active: true }
)

const emit = defineEmits<{ close: []; expand: []; dock: []; activity: [busy: boolean] }>()

type StepStatus = TraceStatus

type FeedItem =
  | { id: string; type: 'msg'; role: 'user' | 'assistant'; content: string }
  | { id: string; type: 'run'; rows: TraceRow[]; durationMs?: number }

const feed = ref<FeedItem[]>([])
const messages = computed<AgentMessage[]>(() =>
  feed.value
    .filter((item): item is Extract<FeedItem, { type: 'msg' }> => item.type === 'msg')
    .map((item) => ({ role: item.role, content: item.content }))
)
const input = ref('')
const busy = ref(false)
const approval = ref<{ text: string; resolve: (accepted: boolean) => void } | null>(null)
function requestToolApproval(text: string): Promise<boolean> {
  return new Promise(resolve => {
    const signal = controller?.signal
    const abort = () => { approval.value = null; resolve(false) }
    const finish = (accepted: boolean) => { signal?.removeEventListener('abort', abort); approval.value = null; resolve(accepted) }
    if (signal?.aborted) return resolve(false)
    approval.value = { text, resolve: finish }
    signal?.addEventListener('abort', abort, { once: true })
  })
}
const thinking = ref(false)
const log = ref('')
const trace = ref<TraceRow[]>([])
const chips = ref<{ label: string; text: string }[]>([
  { label: '拆剧本', text: '拆剧本' },
  { label: '帮我画一张图', text: '帮我创建一个图片节点并生成：' },
  { label: '看看进度', text: '现在画布什么情况' }
])
const box = ref<HTMLElement | null>(null)
const messageScroll = createReferencePickerScroll(() => box.value, 72)
const messagesReady = ref(false), followLatest = ref(true)
const scrollPositions = new Map<string, { top: number; following: boolean }>()
let scrollRevision = 0, lastMessageScrollTop = 0
const autonomy = ref<AgentAutonomy>('gated')
const modeOpen = ref(false)
const memoryOpen = ref(false)
const canvasLive = ref(false)
const canvasTrace = ref<TraceRow[]>([])
const project = useProjectStore()
const assets = useAssetsStore()
let offActivity: (() => void) | undefined
const hoverMode = ref<AgentAutonomy | null>(null)
const settings = useSettingsStore()
const toast = useToastStore()
/** 本轮要带上的本地文件附件（文本内容已在选择时读入） */
const attachments = ref<AgentAttachment[]>([])
const attachmentInput = ref<HTMLInputElement>()
const composerInput = ref<HTMLTextAreaElement>()
const TEXT_ATTACH_FILTERS = [
  { name: '文本文件', extensions: ['txt', 'md', 'markdown', 'fountain', 'srt', 'ass', 'lrc', 'json', 'csv'] }
]

async function pickAttachments() {
  if (!isDesktop()) {
    attachmentInput.value?.click()
    return
  }
  try {
    const files = await desktop().pickFiles(TEXT_ATTACH_FILTERS)
    if (!files?.length) return
    for (const p of files) {
      if (attachments.value.some((a) => a.path === p)) continue
      try {
        const raw = await desktop().readText(p)
        const content = raw.length > 200_000
          ? `${raw.slice(0, 200_000)}\n\n【内容过长，已截取前 200,000 个字符】`
          : raw
        attachments.value.push({ name: p.split(/[\\/]/).pop() || p, path: p, content })
      } catch (e) {
        toast.error(`读取失败：${p.split(/[\\/]/).pop() || p}`)
        console.warn('[agent] 附件读取失败', e)
      }
    }
  } catch (e) {
    toast.error('选择文件失败')
    console.warn('[agent] pickFiles 失败', e)
  }
}

async function addTextFiles(files: File[]) {
  if (busy.value) return
  const projectId = project.current?.id, sourceConversation = project.current?.agentState?.activeConversationId || 'legacy'
  for (const file of files) {
    if (!/\.(txt|md|markdown|fountain|srt|ass|lrc|json|csv)$/i.test(file.name)) { toast.warn(`「${file.name}」请先转为文本或 Markdown`); continue }
    if (file.size > 5 * 1024 * 1024) { toast.warn(`「${file.name}」超过 5 MB，请缩小后上传`); continue }
    const path = `browser:${file.name}:${file.size}:${file.lastModified}`
    if (attachments.value.some(a => a.path === path)) continue
    try {
      const raw = await file.text()
      if (project.current?.id !== projectId || (project.current?.agentState?.activeConversationId || 'legacy') !== sourceConversation) return
      attachments.value.push({ name: file.name, path, content: raw.length > 200_000 ? `${raw.slice(0, 200_000)}\n【内容已截取前200,000字符】` : raw })
    } catch { toast.error(`读取「${file.name}」失败`) }
  }
}

async function onAttachmentFiles(event: Event) {
  const el = event.target as HTMLInputElement
  await addTextFiles(Array.from(el.files || [])); el.value = ''
}

function removeAttachment(index: number) {
  attachments.value.splice(index, 1)
}

/** 出片生成模式：自动（默认）/ 首尾帧链（第 2 镜起取上一镜视频末帧作首帧） */
const shotChainMode = computed<'auto' | 'fl2va'>(
  () => project.current?.settings.h3ShotChainMode || 'auto'
)
const genModeOpen = ref(false)

function chooseShotChainMode(v: 'auto' | 'fl2va') {
  genModeOpen.value = false
  const p = project.current
  if (!p) return
  p.settings = { ...p.settings, h3ShotChainMode: v }
  void project.save()
  toast.success(
    v === 'fl2va'
      ? '已切换到首尾帧链：第 2 镜起会自动取上一镜视频末帧往下生成，镜头间保持连续。'
      : '已切换到自动模式：按每镜自己的参考图出片。'
  )
}

let controller: AbortController | null = null

/* ── 生成配置：比例 / 图像模型 / 视频模型，选好即生效，智能体照此执行 ── */
const currentMode = computed(() => MODES.find((m) => m.id === autonomy.value) || MODES[1])
const modeTip = computed(() => {
  const id = hoverMode.value || autonomy.value
  return MODES.find((m) => m.id === id)?.desc || ''
})
const ASPECT_OPTIONS: { value: AspectRatio; label: string }[] = [
  { value: '16:9', label: '横版 16:9' },
  { value: '9:16', label: '竖版 9:16' },
  { value: '1:1', label: '方形 1:1' },
  { value: '4:3', label: '传统 4:3' },
  { value: '21:9', label: '影院 21:9' }
]
/* 创作偏好弹窗：比例 + 图像/视频模型收进一个面板 */
const prefOpen = ref(false)
const prefTab = ref<'video' | 'image'>('video')
/* 父容器 overflow 会裁剪浮层，所以传送到 body 按按钮位置定位 */
const prefBtn = ref<HTMLElement | null>(null)
const prefPanel = ref<HTMLElement | null>(null)
const PANEL_WIDTH = 480
const prefStyle = ref<Record<string, string>>({})

function placePrefPanel() {
  if (!prefOpen.value) return
  const rect = prefBtn.value?.getBoundingClientRect()
  if (!rect) return
  const vw = window.innerWidth
  const vh = window.innerHeight
  const width = Math.min(PANEL_WIDTH, vw - 24)
  const left = Math.max(12, Math.min(rect.left, vw - width - 12))
  const spaceAbove = rect.top - 12
  const spaceBelow = vh - rect.bottom - 12
  const style: Record<string, string> = { left: `${Math.round(left)}px`, width: `${Math.round(width)}px` }
  // 上下哪边空间大就往哪边展开，不够时压缩高度并内部滚动
  if (spaceAbove >= 260 || spaceAbove >= spaceBelow) {
    style.bottom = `${Math.round(vh - rect.top + 6)}px`
    style.maxHeight = `${Math.round(Math.max(180, Math.min(spaceAbove, 460)))}px`
  } else {
    style.top = `${Math.round(rect.bottom + 6)}px`
    style.maxHeight = `${Math.round(Math.max(180, Math.min(spaceBelow, 460)))}px`
  }
  prefStyle.value = style
}

function togglePrefPanel() {
  prefOpen.value = !prefOpen.value
  if (prefOpen.value) {
    prefStyle.value = {}
    nextTick(placePrefPanel)
  }
  modeOpen.value = false
}

function closePrefPanel() {
  prefOpen.value = false
}

const currentAspectRatio = computed<AspectRatio>(
  () => project.current?.settings?.aspectRatio || '16:9'
)
const imageProfiles = computed(() => settings.config.images ?? [])
const videoProfiles = computed(() => settings.config.videos ?? [])
const activeImage = computed(
  () =>
    imageProfiles.value.find((p) => p.id === settings.config.activeImageId) ||
    imageProfiles.value[0]
)
const activeVideo = computed(
  () =>
    videoProfiles.value.find((p) => p.id === settings.config.activeVideoId) ||
    videoProfiles.value[0]
)
const activeImageLabel = computed(() => {
  const p = activeImage.value
  return p ? `${p.name} · ${p.model}` : '图像模型'
})
const activeVideoLabel = computed(() => {
  const d = videoDefault.value
  if (d) return VIDEO_WORKFLOW_OPTIONS.find((w) => w.value === d)?.name || '视频模型'
  const p = activeVideo.value
  return p ? p.name : '视频模型'
})

/** 比例小图标的内框尺寸（外框固定 40×26 居中） */
function ratioBoxStyle(value: AspectRatio) {
  const map: Partial<Record<AspectRatio, [number, number]>> = {
    '16:9': [30, 17],
    '9:16': [13, 23],
    '1:1': [19, 19],
    '4:3': [24, 18],
    '21:9': [34, 15]
  }
  const [w, h] = map[value] ?? [30, 17]
  return { width: `${w}px`, height: `${h}px` }
}

/** 视频端点没有模型名，副标题显示服务商或域名 */
function videoSub(p: { provider?: string; baseUrl: string }): string {
  if (p.provider) return p.provider
  try {
    return new URL(p.baseUrl).host
  } catch {
    return p.baseUrl
  }
}

/* 选中后不关面板，方便连续调整 */
function pickAspectRatio(value: AspectRatio) {
  project.setAspectRatio(value)
}

function pickImage(id: string) {
  settings.selectImage(id)
}

function pickVideo(id: string) {
  // 选了具体接入就回到「跟随接入」模式，清掉内置工作流默认
  settings.selectVideoModelDefault(undefined)
  settings.selectVideo(id)
}

/** 与视频节点下拉同款的内置工作流（用设置里的 AutoDL 令牌），创作偏好里也能直接选 */
const VIDEO_WORKFLOW_OPTIONS: { value: VideoGenModel; name: string; desc: string }[] = [
  { value: 'h3', name: 'H3 v5 · 15 秒', desc: 'AutoDL · 人设+场景参考图直接生成' },
  { value: 'h3-v5', name: 'H3 v5 · 10 秒 · 1080p', desc: 'AutoDL · 画质升级版' },
  { value: 'wan-prime', name: '万相 3.0 Prime', desc: '需四宫格关键帧' }
]
const videoDefault = computed(() => settings.config.defaultVideoModel)

function pickVideoWorkflow(model: VideoGenModel) {
  settings.selectVideoModelDefault(model)
  // H3 系列内置工作流用 AutoDL 令牌：顺手把当前接入切到 AutoDL，免得提交时还指着别家
  if (model !== 'wan-prime') {
    const autodlId = autodlVideoProfileId()
    if (autodlId) settings.selectVideo(autodlId)
  }
}

/** 与节点下拉一致：给接入线路带上服务商标签 */
function videoProfileTag(p: { provider?: string; baseUrl?: string; adapter?: { type?: string } }): string {
  const zealman = p.provider === 'zealman' || p.adapter?.type === 'zealman-workflow'
  const autodl = !zealman && (p.provider === 'autodl' || /autodl\.art/i.test(p.baseUrl || ''))
  return zealman ? 'Zealman' : autodl ? 'AutoDL' : ''
}

const MODES: { id: AgentAutonomy; label: string; desc: string }[] = [
  {
    id: 'assist',
    label: '陪我做',
    desc: '每一步都先问你再动手，适合一起磨剧本、分镜和提示词。'
  },
  {
    id: 'gated',
    label: '关键确认',
    desc: '能连续做几步，但写完剧本、拆人物/场景/分镜、验收这些关键点会停下来问你。'
  },
  {
    id: 'autopilot',
    label: '全自动',
    desc: '按你这句话尽量一路做完，中途失败才停。要出片仍需说「全流程」。'
  }
]

const estimate = computed(() => {
  if (!batchPromptMode.value) return estimateRequestText(input.value)
  const picked = references.value.filter(r => r.kind === 'node' && mediaNodes.value.some(n => n.id === r.id)).map(r => r.id)
  return estimateToolActions((picked.length ? picked : mediaNodes.value.map(n => n.id)).map(nodeId => ({ tool: 'optimize_node_prompt', nodeId })))
})
const statusText = computed(() => {
  if (busy.value) {
    if (thinking.value) return '思考中'
    return log.value || '执行中'
  }
  if (canvasLive.value) return log.value || '画布生成中'
  return currentMode.value.label
})
const statusLive = computed(() => busy.value || canvasLive.value)
watch(statusLive, value => emit('activity', value), { immediate: true })
watch(() => props.active, async active => {
  if (!active) {
    messageScroll.stop()
    rememberScrollPosition()
    modeOpen.value = false
    genModeOpen.value = false
    memoryOpen.value = false
    conversationOpen.value = false
    referenceOpen.value = false
    closePrefPanel()
  } else {
    await restoreMessagePosition()
    composerInput.value?.focus({ preventScroll: true })
  }
})

/** 自由画布：当前选中节点卡片 */
const selectedGenNode = computed(() => {
  const n = props.selectedNode
  if (!n || (n.type !== 'imageGen' && n.type !== 'videoGen')) return null
  return n
})
const selectedKindLabel = computed(() =>
  selectedGenNode.value?.type === 'videoGen' ? '图生视频' : '生图'
)
const polishChips = [
  { label: '更有画面感', text: '更有画面感：补构图、光影、材质和空气感，不改原文格式' },
  { label: '写清动作表情', text: '把眉眼嘴、手和身体怎么动写具体，不改原文格式' },
  { label: '按剧情对齐', text: '对照剧本，只写这一镜该发生的事，不改原文格式' }
]

const welcome = computed(() => !feed.value.length && !statusLive.value)
const conversationOpen = ref(false), changingConversation = ref(false)
const conversations = computed(() => agentConversations(project.current?.agentState))
const conversationId = computed(() => project.current?.agentState?.activeConversationId || 'legacy')
const conversationTitle = computed(() => conversations.value.find(c => c.id === conversationId.value)?.title || '新对话')
const codexMode = computed(() => settings.config.assistantEngine === 'codex')
function savedCodexPage(): 'home' | 'chat' {
  try { return localStorage.getItem(`juliu:codex-page:${project.current?.id}`) === 'chat' && getAgentState().messages.length ? 'chat' : 'home' } catch { return 'home' }
}
const codexPage = ref<'home' | 'chat'>(savedCodexPage())
const codexHome = computed(() => codexMode.value && codexPage.value === 'home')
const historyPanel = ref<InstanceType<typeof CodexChatHistory>>()
const codexMore = ref<HTMLDetailsElement>(), codexAddOpen = ref(false)
watch([conversationId, codexHome], () => messageScroll.stop())
watch(codexPage, page => { try { localStorage.setItem(`juliu:codex-page:${project.current?.id}`, page) } catch {} })
watch(codexMode, enabled => {
  if (enabled) { saveSessionDraft(conversationId.value); codexPage.value = savedCodexPage(); if (codexHome.value) restoreSessionDraft('__new__') }
  else { if (codexPage.value === 'home') { saveSessionDraft('__new__'); restoreSessionDraft(conversationId.value) }; restoreFeed() }
  void restoreMessagePosition()
})
async function showCodexHome(fresh = false) {
  if (statusLive.value || changingConversation.value) return
  rememberScrollPosition(); saveSessionDraft(); codexPage.value = 'home'; conversationOpen.value = false
  if (codexMore.value) codexMore.value.open = false
  if (fresh) sessionDrafts.delete('__new__')
  restoreSessionDraft('__new__'); referenceOpen.value = false; codexAddOpen.value = false
  await nextTick(); composerInput.value?.focus()
}
async function renameCurrentCodexChat() {
  await showCodexHome()
  await nextTick(); await historyPanel.value?.rename(conversationId.value)
}
function closeCodexMore() { if (codexMore.value) codexMore.value.open = false }
function workLabel(rows: TraceRow[], durationMs?: number) {
  const failed = rows.some(row => row.status === 'fail')
  const seconds = durationMs ? Math.max(1, Math.round(durationMs / 1000)) : 0
  const duration = seconds ? (seconds < 60 ? `${seconds}秒` : `${Math.floor(seconds / 60)}分${seconds % 60}秒`) : ''
  return `${failed ? '过程记录 · 有步骤失败' : '过程记录'}${duration ? ` · ${duration}` : ''}`
}

const renameId = ref(''), renameDraft = ref(''), renameError = ref(''), renameSaving = ref(false)
async function beginConversationRename(id: string) {
  if (statusLive.value || changingConversation.value || renameSaving.value) return
  const conversation = conversations.value.find(c => c.id === id)
  if (!conversation) return
  renameId.value = id; renameDraft.value = conversation.title; renameError.value = ''
  await nextTick()
  const input = document.querySelector<HTMLInputElement>('.conversation-rename-form input')
  input?.focus(); input?.select()
}
async function cancelConversationRename(focus = false) {
  const id = renameId.value
  renameId.value = ''; renameDraft.value = ''; renameError.value = ''
  if (focus && id) {
    await nextTick()
    document.querySelector<HTMLButtonElement>(`[data-conversation-id="${CSS.escape(id)}"] .conversation-rename`)?.focus()
  }
}
async function saveConversationName() {
  if (!renameId.value || renameSaving.value || statusLive.value) return
  if (!renameDraft.value.trim()) { renameError.value = '请输入对话名称'; return }
  renameSaving.value = true; renameError.value = ''
  try { await renameAgentConversation(renameId.value, renameDraft.value); await cancelConversationRename(true) }
  catch (error: any) { renameError.value = error.message || '保存失败，请重试' }
  finally { renameSaving.value = false }
}
watch([conversationOpen, () => project.current?.id, statusLive], ([open, projectId, live], [, oldProjectId]) => {
  if (!open || live || projectId !== oldProjectId) void cancelConversationRename()
})
type DirectorReference = { key: string; id: string; kind: 'node' | 'asset'; label: string; detail: string }
const references = ref<DirectorReference[]>([]), referenceOpen = ref(false), referenceSearch = ref(''), referenceIndex = ref(0)
const referenceList = ref<HTMLElement | null>(null)
const referenceScroll = createReferencePickerScroll(() => referenceList.value)
watch([referenceOpen, referenceSearch], async () => {
  referenceScroll.stop()
  await nextTick()
  if (referenceList.value) referenceList.value.scrollTop = 0
})
const batchPromptMode = ref(false)
let mentionRange: { start: number; end: number } | undefined
const availableReferences = computed<DirectorReference[]>(() => [
  ...(project.current?.canvas?.nodes || []).map(n => ({ key: `node:${n.id}`, id: n.id, kind: 'node' as const, label: n.data.label || n.id, detail: n.type === 'groupFrame' ? '组合' : n.type === 'imageGen' ? '图片节点' : n.type === 'videoGen' ? '视频节点' : '流程节点' })),
  ...assets.all.filter(a => a.projectId === project.current?.id).map(a => ({ key: `asset:${a.id}`, id: a.id, kind: 'asset' as const, label: a.filename || a.id, detail: a.kind === 'image' ? '图片资源' : a.kind === 'video' ? '视频资源' : '声音资源' }))
])
const filteredReferences = computed(() => availableReferences.value.filter(r => !references.value.some(p => p.key === r.key) && `${r.label} ${r.id} ${r.detail}`.toLowerCase().includes(referenceSearch.value.toLowerCase())).slice(0, 60))
const mediaNodes = computed(() => (project.current?.canvas?.nodes || []).filter(n => ['imageGen', 'videoGen'].includes(n.type)))
watch(referenceSearch, () => { referenceIndex.value = 0 })
const sessionDrafts = new Map<string, { text: string; attachments: AgentAttachment[]; references: DirectorReference[]; batch: boolean }>()
function saveSessionDraft(key = codexHome.value ? '__new__' : conversationId.value) { sessionDrafts.set(key, { text: input.value, attachments: [...attachments.value], references: [...references.value], batch: batchPromptMode.value }) }
function restoreSessionDraft(key: string) {
  const draft = sessionDrafts.get(key)
  input.value = draft?.text || ''; attachments.value = draft?.attachments || []; references.value = draft?.references || []; batchPromptMode.value = draft?.batch || false
}
async function changeConversation(id?: string) {
  if (statusLive.value || changingConversation.value) return
  if (codexMode.value && !id) { await showCodexHome(true); return }
  messageScroll.stop(); rememberScrollPosition(); messagesReady.value = false
  changingConversation.value = true; conversationOpen.value = false; saveSessionDraft()
  try {
    if (id) await switchAgentConversation(id)
    else await startAgentConversation()
    if (codexMode.value) codexPage.value = 'chat'
    restoreFeed()
    restoreSessionDraft(conversationId.value)
    referenceOpen.value = false; chips.value = []; trace.value = []; canvasTrace.value = []
    await restoreMessagePosition(); composerInput.value?.focus({ preventScroll: true })
  } catch { toast.error('切换对话失败，请稍后重试'); await restoreMessagePosition() }
  finally { changingConversation.value = false }
}
function restoreFeed() {
  const saved = getAgentState()
  autonomy.value = saved.autonomy
  feed.value = saved.messages.filter(m => m.role === 'user' || m.role === 'assistant').map(m => ({ id: m.id, type: 'msg' as const, role: m.role as 'user' | 'assistant', content: m.content }))
}
function exportConversation() {
  const content = `# ${conversationTitle.value}\n\n` + messages.value.map(m => `## ${m.role === 'user' ? '我' : '剧流 AI 导演'}\n\n${m.content}`).join('\n\n')
  const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown;charset=utf-8' })), a = document.createElement('a')
  a.href = url; a.download = `${conversationTitle.value.replace(/[\\/:*?"<>|]/g, '_')}.md`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}
type CreativeIntent = 'canvas' | 'original' | 'adapt' | 'polish'
const creativeIntents: { id: CreativeIntent; label: string; description: string; icon: string }[] = [
  { id: 'canvas', label: '感知画布，接着创作', description: '梳理节点与参考关系，找到下一步', icon: 'canvas' },
  { id: 'original', label: '从一个灵感开始原创', description: '把故事想法写成可拍摄的剧本', icon: 'script' },
  { id: 'adapt', label: '上传故事，改编成剧本', description: '带上文本材料，保留故事的核心', icon: 'adapt' },
  { id: 'polish', label: '批量优化画布提示词', description: '细化画面与镜头，不重新生成素材', icon: 'polish' }
]
async function useCreativeIntent(intent: CreativeIntent) {
  if (busy.value) return
  batchPromptMode.value = intent === 'polish'
  if (intent === 'polish' && !mediaNodes.value.length) { batchPromptMode.value = false; toast.warn('先在画布添加图片或视频节点'); return }
  const prompts: Record<CreativeIntent, string> = {
    canvas: '请先查看当前画布的节点、连线和已有产物，概括当前进度，并建议下一步创作。先不要生成素材。',
    original: '我想创作一个短剧。请先和我确认故事题材、主角、核心冲突、时长和画面风格，再一起打磨剧本。',
    adapt: '请根据我上传的故事改编短剧剧本，先梳理人物、冲突和剧情主线，再和我确认改编方向。',
    polish: '批量优化画布中图片和视频节点的提示词，补充构图、光影、动作与镜头细节，保持每个节点原本的含义和格式，只更新提示词，不重新生成素材。'
  }
  input.value = prompts[intent]; await nextTick(); composerInput.value?.focus()
  if (intent === 'adapt') void pickAttachments()
}
function openReferences() { referenceOpen.value = !referenceOpen.value; referenceSearch.value = ''; referenceIndex.value = 0; mentionRange = undefined }
function onComposerInput() {
  const caret = composerInput.value?.selectionStart || 0, before = input.value.slice(0, caret), match = /(?:^|\s)@([^\s@]*)$/.exec(before)
  if (match) { referenceOpen.value = true; referenceSearch.value = match[1]; mentionRange = { start: before.lastIndexOf('@'), end: caret } }
  else { referenceOpen.value = false; mentionRange = undefined }
}
async function addReference(item: DirectorReference) {
  if (!references.value.some(r => r.key === item.key)) references.value.push(item)
  const caret = mentionRange?.start
  if (mentionRange) input.value = input.value.slice(0, mentionRange.start) + input.value.slice(mentionRange.end)
  referenceOpen.value = false; mentionRange = undefined; await nextTick(); composerInput.value?.focus()
  if (caret !== undefined) composerInput.value?.setSelectionRange(caret, caret)
}
function composerKeydown(event: KeyboardEvent) {
  if (event.isComposing || event.keyCode === 229) return
  if (referenceOpen.value && ['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(event.key)) {
    event.preventDefault(); event.stopPropagation()
    if (event.key === 'Escape') referenceOpen.value = false
    else if (event.key === 'Enter') { const item = filteredReferences.value[referenceIndex.value]; if (item) void addReference(item) }
    else referenceIndex.value = (referenceIndex.value + (event.key === 'ArrowUp' ? -1 : 1) + Math.max(1, filteredReferences.value.length)) % Math.max(1, filteredReferences.value.length)
    return
  }
  if (event.key === 'Enter' && !event.shiftKey && !event.altKey) { event.preventDefault(); event.stopPropagation(); void send() }
}
function referenceMaterials(items: DirectorReference[]): AgentAttachment[] {
  return items.flatMap(item => {
    const value = item.kind === 'node' ? project.current?.canvas?.nodes.find(n => n.id === item.id) : assets.all.find(a => a.id === item.id && a.projectId === project.current?.id)
    return value ? [{ name: `${item.detail} · ${item.label}`, content: `用户引用的${item.detail}（仅作为本轮材料；操作范围以用户消息为准）：\n${JSON.stringify(value, null, 2)}` }] : []
  })
}

onMounted(() => {
  restoreFeed()
  if (props.active) void restoreMessagePosition()
  window.addEventListener('pointerdown', onDocPointer, true)
  window.addEventListener('resize', placePrefPanel)
  window.addEventListener('scroll', placePrefPanel, true)
  window.addEventListener('keydown', onGlobalKey, true)
  offActivity = onCanvasActivity(applyCanvasActivity)
})

onBeforeUnmount(() => {
  messageScroll.stop()
  referenceScroll.stop()
  controller?.abort()
  if (msgTimer) clearTimeout(msgTimer)
  window.removeEventListener('pointerdown', onDocPointer, true)
  window.removeEventListener('resize', placePrefPanel)
  window.removeEventListener('scroll', placePrefPanel, true)
  window.removeEventListener('keydown', onGlobalKey, true)
  offActivity?.()
})

function onGlobalKey(ev: KeyboardEvent) {
  if (!props.active || ev.key !== 'Escape') return
  const picker = document.querySelector<HTMLDetailsElement>('.assistant-engine[open], .codex-run-select[open]')
  if (picker) { ev.preventDefault(); ev.stopImmediatePropagation(); picker.open = false; picker.querySelector('summary')?.focus(); return }
  if ((ev.target as HTMLElement | null)?.closest('.codex-history')) return
  if (codexMore.value?.open) { ev.preventDefault(); ev.stopImmediatePropagation(); closeCodexMore(); return }
  if (codexAddOpen.value) { ev.preventDefault(); ev.stopImmediatePropagation(); codexAddOpen.value = false; return }
  if (renameId.value) { ev.preventDefault(); ev.stopImmediatePropagation(); if (!renameSaving.value) void cancelConversationRename(true); return }
  if (conversationOpen.value || referenceOpen.value) { conversationOpen.value = false; referenceOpen.value = false; ev.preventDefault(); ev.stopImmediatePropagation() }
  else if (prefOpen.value) closePrefPanel()
  else if (memoryOpen.value || modeOpen.value || genModeOpen.value) {
    memoryOpen.value = false
    modeOpen.value = false
    genModeOpen.value = false
  } else emit('close')
}

function onDocPointer(ev: PointerEvent) {
  const el = ev.target as HTMLElement | null
  const inPref = !!el && (!!el.closest('.pref-pop') || !!prefPanel.value?.contains(el))
  if (!el?.closest('.bar-pop') && !inPref) {
    modeOpen.value = false
    genModeOpen.value = false
    codexAddOpen.value = false
    closePrefPanel()
  }
  if (!el?.closest('.mem-pop')) memoryOpen.value = false
  if (!el?.closest('.conversation-pop')) conversationOpen.value = false
  if (!el?.closest('.codex-chat-more')) closeCodexMore()
  if (!el?.closest('.reference-picker,.reference-trigger,textarea')) referenceOpen.value = false
}

async function chooseAutonomy(mode: AgentAutonomy) {
  autonomy.value = mode
  modeOpen.value = false
  hoverMode.value = null
  await setAgentAutonomy(mode)
}

function rememberScrollPosition() {
  const el = box.value
  if (!messagesReady.value || !el?.clientHeight || codexHome.value) return
  scrollPositions.set(conversationId.value, { top: el.scrollTop, following: followLatest.value })
}
function onMessagesWheel(event: WheelEvent) {
  // Nested scrollable output (e.g. code blocks) keeps its own native scrolling.
  let target = event.target instanceof Element ? event.target : null
  while (target && target !== box.value) {
    if (target instanceof HTMLElement && target.scrollHeight > target.clientHeight && /^(auto|scroll)$/.test(getComputedStyle(target).overflowY)) {
      messageScroll.stop(); event.stopPropagation(); return
    }
    target = target.parentElement
  }
  // Leave follow mode before the first animated frame, even near the bottom.
  if (!event.ctrlKey && !event.metaKey && !event.shiftKey && event.deltaY < 0 && Math.abs(event.deltaY) >= Math.abs(event.deltaX) && (box.value?.scrollTop || 0) > 0) {
    followLatest.value = false
    rememberScrollPosition()
  }
  messageScroll.onWheel(event)
}
function onMessagesScroll() {
  const el = box.value
  if (!messagesReady.value || !el?.clientHeight) return
  const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= 64
  // Layout changes can emit a delayed scroll event after new content arrives.
  // Only upward movement leaves follow mode; our own positioning is recorded below.
  if (el.scrollTop < lastMessageScrollTop - 1) followLatest.value = false
  else if (nearBottom && el.scrollTop > lastMessageScrollTop) followLatest.value = true
  lastMessageScrollTop = el.scrollTop
  rememberScrollPosition()
}
async function restoreMessagePosition() {
  messageScroll.stop()
  const revision = ++scrollRevision, id = conversationId.value
  messagesReady.value = false
  await nextTick()
  const el = box.value
  if (revision !== scrollRevision || id !== conversationId.value || !props.active || codexHome.value || !el?.clientHeight) return
  const saved = scrollPositions.get(id)
  followLatest.value = saved?.following ?? true
  el.scrollTo({ top: followLatest.value ? el.scrollHeight : saved!.top, behavior: 'instant' })
  lastMessageScrollTop = el.scrollTop
  messagesReady.value = true
}
async function scrollToEnd(force = false) {
  const id = conversationId.value
  if (force) { messageScroll.stop(); followLatest.value = true }
  await nextTick()
  const el = box.value
  if (id !== conversationId.value || !props.active || codexHome.value || !el?.clientHeight || !followLatest.value || messageScroll.isScrolling()) return
  el.scrollTo({ top: el.scrollHeight, behavior: 'instant' })
  lastMessageScrollTop = el.scrollTop
  messagesReady.value = true
  rememberScrollPosition()
}

function upsertStep(key: string, patch: Partial<TraceRow>) {
  const i = trace.value.findIndex((s) => s.key === key)
  if (i >= 0) {
    trace.value[i] = { ...trace.value[i], ...patch }
  } else {
    trace.value = [...trace.value, { key, kind: 'step', label: patch.label || key, ...patch }]
  }
}

function upsertCanvasStep(key: string, patch: Partial<TraceRow>) {
  const i = canvasTrace.value.findIndex((s) => s.key === key)
  if (i >= 0) {
    canvasTrace.value[i] = { ...canvasTrace.value[i], ...patch }
  } else {
    canvasTrace.value = [...canvasTrace.value, { key, kind: 'step', label: patch.label || key, ...patch }]
  }
}

/** 计划卡片与执行步骤的状态同步 */
function syncPlanSteps(stepKey: string, status: StepStatus) {
  for (const row of trace.value) {
    if (row.kind !== 'plan' || !row.plan) continue
    const step = row.plan.steps.find((s) => s.key === stepKey)
    if (step) step.status = status
  }
}

function onProgress(ev: AgentEvent) {
  log.value = ev.label
  if (ev.kind === 'intent') {
    trace.value = [
      { key: 'intent', kind: 'intent', label: ev.label },
      ...trace.value.filter((r) => r.kind !== 'intent')
    ]
  } else if (ev.kind === 'plan' && ev.plan) {
    const i = trace.value.findIndex((s) => s.kind === 'plan')
    const row: TraceRow = { key: 'plan', kind: 'plan', label: ev.label, plan: ev.plan }
    if (i >= 0) trace.value[i] = row
    else trace.value = [...trace.value.filter((r) => r.kind !== 'plan'), row]
  } else if (ev.kind === 'think') {
    thinking.value = true
    const i = trace.value.findIndex((s) => s.kind === 'think')
    const row: TraceRow = { key: 'think', kind: 'think', label: ev.label, status: 'running' }
    if (i >= 0) trace.value[i] = row
    else trace.value = [row, ...trace.value]
  } else if (ev.kind === 'step' && ev.step) {
    thinking.value = false
    const think = trace.value.find((s) => s.kind === 'think' && s.status === 'running')
    if (think) think.status = 'done'
    upsertStep(ev.step, {
      kind: 'step',
      label: ev.label,
      status: ev.status || 'running'
    })
    syncPlanSteps(ev.step, ev.status || 'running')
  } else if (ev.kind === 'log') {
    thinking.value = ev.label.includes('想')
    const running = [...trace.value].reverse().find((s) => s.kind === 'step' && s.status === 'running')
    const landed = /已上画布|已写入画布|已交付 \d+ 个可编辑分镜/.test(ev.label)
    if (running && (ev.step === running.key || !ev.step)) {
      running.detail = ev.label
      if (landed) {
        running.status = 'done'
        running.label = ev.label
      }
    } else {
      trace.value = [
        ...trace.value,
        { key: `log-${trace.value.length}`, kind: 'log', label: ev.label }
      ]
    }
  }
  void scrollToEnd()
}

function applyCanvasActivity(ev: CanvasActivity) {
  if (ev.source === 'agent' && busy.value) return
  canvasLive.value = true
  if (!busy.value) log.value = ev.message || ev.label
  const landed = /已上画布|已写入画布/.test(ev.message || ev.label || '')
  upsertCanvasStep(ev.nodeId, {
    kind: 'step',
    label: landed && ev.message ? ev.message : ev.label,
    status:
      ev.kind === 'done' || landed ? 'done' : ev.kind === 'error' ? 'fail' : 'running',
    detail: ev.message
  })
  if (ev.kind === 'done' || ev.kind === 'error') {
    void finishCanvasRun(ev)
  }
  void scrollToEnd()
}

async function finishCanvasRun(ev: CanvasActivity) {
  const stillRunning = canvasTrace.value.some(
    (row) => row.kind === 'step' && row.status === 'running' && row.key !== ev.nodeId
  )
  if (stillRunning) return
  if (canvasTrace.value.length) {
    feed.value.push({
      id: `canvas-${Date.now()}`,
      type: 'run',
      rows: canvasTrace.value.map((row) => ({ ...row }))
    })
  }
  const next = nextPipelineStep(project.current)
  const content =
    ev.kind === 'error'
      ? `画布上的「${ev.label}」失败了。\n原因：${ev.message || '未知错误'}\n可以改提示词后在右侧重试，或让我来处理。`
      : `画布上的「${ev.label}」已完成。${ev.message ? `\n${ev.message}` : ''}\n${
          next ? `下一步是「${next.label}」。回「继续」只做这一步。` : '需要继续就直接说下一步。'
        }`
  feed.value.push({ id: `a-${Date.now()}`, type: 'msg', role: 'assistant', content })
  await appendAgentMessage('assistant', content)
  if (!busy.value) {
    chips.value = next
      ? [
          { label: `继续：${next.label}`, text: '继续' },
          { label: '先看看', text: '先看看' }
        ]
      : []
  }
  canvasLive.value = false
  canvasTrace.value = []
  if (!busy.value) log.value = ''
  await scrollToEnd()
}

async function sendText(text: string) {
  const t = text.trim(), projectId = project.current?.id
  if (!t || busy.value || changingConversation.value || !projectId) return
  if (codexHome.value) {
    if (statusLive.value) return
    changingConversation.value = true
    try {
      await startAgentConversation()
      if (project.current?.id !== projectId) return
      codexPage.value = 'chat'; restoreFeed(); followLatest.value = true; sessionDrafts.delete('__new__')
    } catch { toast.error('创建对话失败，请重试'); return }
    finally { changingConversation.value = false }
  }
  const turnStarted = Date.now()
  const savedAttachments = [...attachments.value], savedReferences = [...references.value]
  const isBatch = batchPromptMode.value && text === input.value
  const explicitNodes = savedReferences.filter(r => r.kind === 'node' && mediaNodes.value.some(n => n.id === r.id)).map(r => r.id)
  const promptNodeIds = isBatch ? (explicitNodes.length ? explicitNodes : mediaNodes.value.map(n => n.id)) : undefined
  const selectedNodeId = isBatch ? undefined : explicitNodes.length === 1 ? explicitNodes[0] : savedReferences.length ? undefined : selectedGenNode.value?.id
  input.value = ''; referenceOpen.value = false; references.value = []; batchPromptMode.value = false
  const attachedNames = savedAttachments.map(a => a.name)
  const display = t + (attachedNames.length ? `\n\n📎 ${attachedNames.join('、')}` : '') + (savedReferences.length ? `\n\n引用：${savedReferences.map(r => r.label).join('、')}` : '')
  const attachOptions = [...savedAttachments, ...referenceMaterials(savedReferences)]
  feed.value.push({ id: `u-${Date.now()}`, type: 'msg', role: 'user', content: display })
  attachments.value = []
  busy.value = true
  thinking.value = true
  log.value = attachedNames.length ? `读取附件 ${attachedNames.join('、')}…` : '开始…'
  trace.value = [{ key: 'think', kind: 'think', label: '在想怎么做…', status: 'running' }]
  chips.value = []
  const turnController = new AbortController()
  controller = turnController
  await scrollToEnd(true)
  try {
    await appendAgentMessage('user', display)
    const result = await runAssistantTurn(messages.value, t, event => { if (project.current?.id === projectId) onProgress(event) }, {
      signal: turnController.signal,
      autonomy: autonomy.value,
      selectedNodeId,
      promptNodeIds,
      attachments: attachOptions,
      approve: requestToolApproval
    })
    if (project.current?.id !== projectId) return
    thinking.value = false
    const think = trace.value.find((s) => s.kind === 'think' && s.status === 'running')
    if (think) think.status = 'done'
    for (const row of trace.value) {
      if (row.kind === 'plan' && row.plan) {
        for (const step of row.plan.steps) {
          if (step.status === 'running') step.status = 'done'
        }
      }
    }
    if (trace.value.length) {
      feed.value.push({ id: `run-${Date.now()}`, type: 'run', durationMs: Date.now() - turnStarted, rows: trace.value.map((row) => ({ ...row, plan: row.plan ? { ...row.plan, steps: row.plan.steps.map((s) => ({ ...s })) } : undefined })) })
    }
    feed.value.push({ id: `a-${Date.now()}`, type: 'msg', role: 'assistant', content: result.reply })
    await appendAgentMessage('assistant', result.reply)
    chips.value = result.chips
  } catch (e: any) {
    if (project.current?.id !== projectId) return
    thinking.value = false
    attachments.value = savedAttachments
    references.value = savedReferences
    batchPromptMode.value = isBatch
    const cancelled = turnController.signal.aborted || (isAbortError(e) && !isTimeoutAbort(e))
    const content = cancelled
      ? '已停止。已完成的产物会保留，未开始的步骤不会继续。'
      : '失败：' + friendlyAiError(e)
    feed.value.push({ id: `a-${Date.now()}`, type: 'msg', role: 'assistant', content })
    await appendAgentMessage('assistant', content)
  } finally {
    busy.value = false
    thinking.value = false
    trace.value = []
    controller = null
    await scrollToEnd()
  }
}

function cancel() {
  controller?.abort()
  log.value = '正在停止…'
}

const copiedMsg = ref('')
let msgTimer: ReturnType<typeof setTimeout> | undefined

async function copyMsg(id: string, text: string) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    } catch {
      return
    }
  }
  copiedMsg.value = id
  if (msgTimer) clearTimeout(msgTimer)
  msgTimer = setTimeout(() => (copiedMsg.value = ''), 1500)
}

async function send() {
  await sendText(input.value)
}

function visibleRows(rows: TraceRow[]) {
  return rows.filter((row) => row.kind !== 'think')
}
</script>

<template>
  <aside class="agent director" :class="{ 'is-welcome': welcome, 'codex-layout': codexMode, 'codex-home': codexHome }" :data-codex-view="codexMode ? codexPage : undefined">
    <header class="head">
      <div v-if="codexMode" class="codex-nav">
        <button v-if="!codexHome" type="button" class="head-btn codex-back" aria-label="返回会话列表" :disabled="statusLive || changingConversation" @click="showCodexHome()"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m10 6-6 6 6 6M4 12h16" /></svg></button>
        <h2 :title="codexHome ? '当前项目的会话' : conversationTitle">{{ codexHome ? '会话' : conversationTitle }}</h2>
      </div>
      <div v-else class="conversation-pop head-id">
        <button class="conversation-toggle" type="button" :disabled="statusLive || changingConversation" :aria-expanded="conversationOpen" aria-label="切换对话" @click="conversationOpen = !conversationOpen">
          <span>{{ conversationTitle }}</span><DirectorIcon name="chevron" :size="13" />
        </button>
        <span v-if="statusLive" class="director-status" role="status"><i />{{ statusText }}</span>
        <span v-else-if="settings.config.assistantEngine === 'codex'" class="context-note" title="重新打开本项目后可接着聊，需要时助手会检索更早的记录。">项目对话持续保存</span>
        <div v-if="conversationOpen" class="conversation-menu" role="menu" aria-label="项目对话记录">
          <button type="button" class="new-conversation-row" role="menuitem" :disabled="statusLive || changingConversation || renameSaving" @click="changeConversation()"><DirectorIcon name="add" />新对话</button>
          <p>当前项目的对话</p>
          <div v-for="conversation in conversations" :key="conversation.id" class="conversation-entry" :data-conversation-id="conversation.id" :class="{ current: conversation.id === conversationId }">
            <form v-if="renameId === conversation.id" class="conversation-rename-form" @submit.prevent="saveConversationName">
              <input v-model="renameDraft" aria-label="对话名称" maxlength="60" :disabled="renameSaving" autocomplete="off" @input="renameError = ''" @keydown.enter.prevent="!$event.isComposing && saveConversationName()" />
              <div class="rename-actions"><span v-if="renameError" class="rename-error" role="alert">{{ renameError }}</span><button type="button" :disabled="renameSaving" @click="cancelConversationRename(true)">取消</button><button type="submit" :disabled="renameSaving">{{ renameSaving ? '保存中…' : '保存' }}</button></div>
            </form>
            <template v-else>
              <button type="button" class="conversation-select" role="menuitemradio" :aria-checked="conversation.id === conversationId" :disabled="statusLive || changingConversation || renameSaving" @click="changeConversation(conversation.id)"><span :title="conversation.title">{{ conversation.title }}</span><small>{{ conversation.messages.length }} 条</small></button>
              <button type="button" class="conversation-rename" :aria-label="`重命名对话 ${conversation.title}`" title="重命名" :disabled="statusLive || changingConversation || renameSaving" @click="beginConversationRename(conversation.id)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 5 4 4M4 20l2-6L17 3l4 4L10 18z" /></svg></button>
            </template>
          </div>
        </div>
      </div>
      <div class="head-actions">
        <AssistantEngineSelect :active="active" :disabled="busy || statusLive || changingConversation" />
        <details v-if="codexMode && !codexHome" ref="codexMore" class="codex-chat-more">
          <summary class="head-btn" aria-label="会话操作"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg></summary>
          <div class="codex-more-menu"><button type="button" :disabled="statusLive" @click="renameCurrentCodexChat">重命名</button><button type="button" :disabled="busy || !messages.length" @click="exportConversation(); closeCodexMore()">导出对话</button><button type="button" @click="memoryOpen = true; closeCodexMore()">本地记忆</button></div>
        </details>
        <button v-if="codexMode && !codexHome" class="head-btn" type="button" aria-label="查看会话历史" :disabled="statusLive || changingConversation" @click="showCodexHome()"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8a8 8 0 1 1-1 7M4 3v5h5M12 7v5l3 2" /></svg></button>
        <button class="head-btn new-conversation" type="button" :disabled="statusLive || changingConversation" title="新对话" aria-label="新对话" @click="changeConversation()"><svg v-if="codexMode" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-7M14 5l4 4M10 16l1-5L19 3l3 3-8 9z" /></svg><DirectorIcon v-else name="add" /></button>
        <button v-if="!codexMode" class="head-btn" type="button" :disabled="!messages.length || busy" title="导出当前对话" aria-label="导出当前对话" @click="exportConversation"><DirectorIcon name="export" /></button>
          <div class="head-pref pref-pop">
            <button
              ref="prefBtn"
              type="button"
              class="head-btn pref-btn" aria-label="创作偏好"
              :disabled="busy || changingConversation"
              :title="`创作偏好：比例 ${currentAspectRatio} · 图像 ${activeImageLabel} · 视频 ${activeVideoLabel}`"
              @click.stop="togglePrefPanel"
            >
              <svg viewBox="0 0 24 24" class="pref-icon" aria-hidden="true">
                <path d="M4 8h10M18 8h2M4 16h2M10 16h10" />
                <circle cx="16" cy="8" r="2.2" />
                <circle cx="8" cy="16" r="2.2" />
              </svg>
              <span class="sr-only">创作偏好</span>
            </button>
            <Teleport to="body">
              <div
                v-if="prefOpen"
                ref="prefPanel"
                class="pref-panel"
                :class="{ floating: true }"
                :style="prefStyle"
                @click.stop
              >
              <div class="pref-tabs">
                <button
                  type="button"
                  :class="{ on: prefTab === 'video' }"
                  @click="prefTab = 'video'"
                >
                  视频偏好
                </button>
                <button
                  type="button"
                  :class="{ on: prefTab === 'image' }"
                  @click="prefTab = 'image'"
                >
                  图片偏好
                </button>
              </div>
              <div class="pref-body">
                <div class="pref-models">
                  <p class="pref-k">模型选择</p>
                  <template v-if="prefTab === 'video'">
                    <p class="pref-g">工作流（用设置里的 AutoDL 令牌）</p>
                    <button
                      v-for="w in VIDEO_WORKFLOW_OPTIONS"
                      :key="w.value"
                      type="button"
                      class="pref-model"
                      :class="{ on: videoDefault === w.value }"
                      @click="pickVideoWorkflow(w.value)"
                    >
                      <span class="pref-radio" />
                      <span class="pref-model-text">
                        <b>{{ w.name }}</b>
                        <small>{{ w.desc }}</small>
                      </span>
                    </button>
                    <p class="pref-g">已配置的视频接入</p>
                    <p v-if="!videoProfiles.length" class="pref-empty">
                      还没有视频模型，去「设置」里添加一个
                    </p>
                    <button
                      v-for="p in videoProfiles"
                      :key="p.id"
                      type="button"
                      class="pref-model"
                      :class="{ on: !videoDefault && p.id === activeVideo?.id }"
                      @click="pickVideo(p.id)"
                    >
                      <span class="pref-radio" />
                      <span class="pref-model-text">
                        <b>{{ videoProfileTag(p) ? `${videoProfileTag(p)} · ${p.name}` : p.name }}</b>
                        <small>{{ videoSub(p) }}</small>
                      </span>
                    </button>
                  </template>
                  <template v-else>
                    <p v-if="!imageProfiles.length" class="pref-empty">
                      还没有图像模型，去「设置」里添加一个
                    </p>
                    <button
                      v-for="p in imageProfiles"
                      :key="p.id"
                      type="button"
                      class="pref-model"
                      :class="{ on: p.id === activeImage?.id }"
                      @click="pickImage(p.id)"
                    >
                      <span class="pref-radio" />
                      <span class="pref-model-text">
                        <b>{{ p.name }}</b>
                        <small>{{ p.model }}</small>
                      </span>
                    </button>
                  </template>
                </div>
                <div class="pref-ratios">
                  <p class="pref-k">画面比例</p>
                  <div class="ratio-grid">
                    <button
                      v-for="a in ASPECT_OPTIONS"
                      :key="a.value"
                      type="button"
                      class="ratio-item"
                      :class="{ on: currentAspectRatio === a.value }"
                      @click="pickAspectRatio(a.value)"
                    >
                      <span class="ratio-box" :style="ratioBoxStyle(a.value)" />
                      <span class="ratio-label">{{ a.value }}</span>
                    </button>
                  </div>
                  <p class="pref-hint">选好即生效，智能体生成图片和视频都会照此执行；单个节点仍可单独指定模型。</p>
                </div>
              </div>
              </div>
            </Teleport>
          </div>
        <div class="mem-pop">
          <button
            type="button"
            v-if="!codexMode" class="head-btn"
            :class="{ on: memoryOpen }"
            title="本地记忆" aria-label="本地记忆"
            @click.stop="memoryOpen = !memoryOpen"
          >
            <svg viewBox="0 0 24 24">
              <path d="M12 4a4 4 0 0 1 4 4c1.8.6 3 2.2 3 4.2A4.3 4.3 0 0 1 14.7 16H9.3A4.3 4.3 0 0 1 5 12.2c0-2 1.2-3.6 3-4.2a4 4 0 0 1 4-4z" />
              <path d="M9 16v2.5M15 16v2.5M12 16V20" />
            </svg>
          </button>
          <AgentMemoryPanel v-if="memoryOpen" @close="memoryOpen = false" />
        </div>
        <button class="head-btn dock-agent" type="button" :title="docked ? '切回浮动窗口' : '停靠到右侧'" :aria-label="docked ? '切回浮动窗口' : '停靠到右侧'" :aria-pressed="!!docked" @click="emit('dock')"><DirectorIcon :name="docked ? 'undock' : 'dock'" /></button>
        <button type="button" class="head-btn minimize-btn" title="收起 AI 助手" aria-label="收起 AI 助手" @click="emit('close')"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" /></svg></button>
      </div>
    </header>

    <section v-if="selectedGenNode && !codexHome" class="target">
      <p class="k">当前选中</p>
      <p v-if="selectedGenNode" class="name">
        {{ selectedGenNode.data.label || selectedGenNode.id }}
        <small>{{ selectedKindLabel }}</small>
      </p>
      <p v-else class="name dim">还没选节点。点画布上的图片或视频节点，我来改它的提示词。</p>
      <p v-if="selectedGenNode?.data.prompt" class="preview">{{ selectedGenNode.data.prompt }}</p>
      <div v-if="selectedGenNode && !busy" class="target-chips">
        <button v-for="c in polishChips" :key="c.label" type="button" @click="sendText(c.text)">
          {{ c.label }}
        </button>
      </div>
    </section>

    <div v-if="approval" class="tool-approval" role="alertdialog" aria-label="确认助手操作">
      <p>{{ approval.text }}</p>
      <button type="button" @click="approval?.resolve(true)">允许本步</button>
      <button type="button" @click="approval?.resolve(false)">拒绝</button>
    </div>
    <CodexChatHistory v-if="codexHome" ref="historyPanel" :key="project.current?.id" :conversations="conversations" :active-id="conversationId" :disabled="statusLive || changingConversation" @open="changeConversation" />
    <div v-show="!codexHome" ref="box" class="msgs" :class="{ 'welcome-scroll': welcome, positioning: !messagesReady }" aria-live="polite" :aria-busy="busy || !messagesReady" @scroll="onMessagesScroll" @wheel="onMessagesWheel" @pointerdown="messageScroll.stop" @keydown="messageScroll.stop">
      <section v-if="welcome && !codexMode" class="director-welcome" aria-label="AI 创作起点">
        <div class="welcome-identity"><AgentOrb :size="50" :paused="!active" /><h2>让 <strong>剧流 AI 导演</strong><br />接住你的每一个灵感</h2><p>从故事到画面，一起把创意变成作品</p></div>
        <div class="welcome-actions"><button v-for="intent in creativeIntents" :key="intent.id" type="button" :data-creative-intent="intent.id" @click="useCreativeIntent(intent.id)"><DirectorIcon :name="intent.icon" :size="18" /><span><b>{{ intent.label }}</b><small>{{ intent.description }}</small></span><DirectorIcon name="arrow" :size="15" /></button></div>
      </section>
      <template v-for="item in feed" :key="item.id">
        <div v-if="item.type === 'msg'" class="msg" :class="item.role">
          <AgentOrb v-if="item.role === 'assistant' && !codexMode" class="msg-orb" :size="22" :paused="true" />
          <div class="bubble">
            <AgentRichText :content="item.content" />
            <button
              v-if="item.role === 'assistant'"
              type="button"
              class="bubble-copy"
              :class="{ ok: copiedMsg === item.id }"
              :title="copiedMsg === item.id ? '已复制' : '复制这条回复'"
              @click="copyMsg(item.id, item.content)"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <rect x="9" y="9" width="11" height="11" rx="2" />
                <path d="M5 15V5a2 2 0 0 1 2-2h8" />
              </svg>
            </button>
          </div>
        </div>
        <div v-else class="turn">
          <details v-if="codexMode" class="codex-work"><summary>{{ workLabel(item.rows, item.durationMs) }}<DirectorIcon name="chevron" :size="12" /></summary><AgentTraceList :rows="visibleRows(item.rows)" /></details>
          <AgentTraceList v-else :rows="visibleRows(item.rows)" />
        </div>
      </template>

      <div v-if="canvasLive && canvasTrace.length" class="turn">
        <AgentTraceList :rows="canvasTrace" />
      </div>

      <div v-if="busy" class="turn">
        <div v-if="thinking" class="think">
          <span class="dot-pulse"><i /><i /><i /></span>
          <span>思考中</span>
        </div>
        <AgentTraceList :rows="visibleRows(trace)" />
      </div>
    </div>

    <div v-if="!codexHome && messagesReady && !followLatest" class="latest-shortcut"><button type="button" aria-label="回到最新消息" @click="scrollToEnd(true)">↓ 回到最新</button></div>
    <div v-if="!codexHome && !welcome && chips.length && !busy && !canvasLive" class="chips">
      <button v-for="c in chips" :key="c.text + c.label" type="button" @click="sendText(c.text)">
        {{ c.label }}
      </button>
    </div>

    <div v-if="!codexMode" class="creative-tabs" aria-label="创作快捷入口"><button v-for="intent in creativeIntents.filter(i => i.id !== 'canvas')" :key="intent.id" type="button" :disabled="busy || changingConversation" @click="useCreativeIntent(intent.id)"><DirectorIcon :name="intent.icon" :size="13" />{{ intent.id === 'original' ? '剧本原创' : intent.id === 'adapt' ? '剧本改编' : '提示词优化' }}</button></div>
    <div v-if="codexMode" class="codex-workspace" :title="project.current?.name"><DirectorIcon name="canvas" :size="13" /><span>{{ selectedGenNode ? `当前选中 · ${selectedGenNode.data.label || selectedGenNode.id}` : project.current?.name || '当前项目画布' }}</span><span v-if="statusLive" class="codex-live" role="status">{{ statusText }}</span><span v-else class="context-note">项目对话持续保存</span></div>
    <input ref="attachmentInput" type="file" hidden multiple accept=".txt,.md,.markdown,.fountain,.srt,.ass,.lrc,.json,.csv" aria-label="上传故事文本" @change="onAttachmentFiles" />
    <form class="composer" @submit.prevent="send" @dragover.prevent @drop.prevent="addTextFiles(Array.from($event.dataTransfer?.files || []))">
      <p v-if="input.trim() && estimate.calls" class="estimate">
        预计 {{ estimate.calls }} 次调用 · 约 {{ Math.max(1, Math.ceil(estimate.seconds / 60)) }} 分钟
      </p>
      <div class="box" :class="{ busy }">
        <div v-if="referenceOpen" class="reference-picker nodrag nowheel" role="dialog" aria-label="引用画布内容" @wheel.stop @pointerdown.stop>
          <div class="reference-picker-head"><strong>引用节点或资源</strong><button type="button" aria-label="关闭引用选择" @click="referenceOpen = false"><DirectorIcon name="close" :size="14" /></button></div>
          <input v-model="referenceSearch" aria-label="搜索节点或资源" placeholder="搜索当前项目…" @keydown.esc.stop="referenceOpen = false" />
          <div ref="referenceList" role="listbox" aria-label="可引用内容" @wheel="referenceScroll.onWheel" @pointerdown="referenceScroll.stop" @keydown="referenceScroll.stop"><button v-for="(item, index) in filteredReferences" :key="item.key" type="button" role="option" :aria-selected="index === referenceIndex" :class="{ highlighted: index === referenceIndex }" :data-reference-id="item.key" @pointerdown.prevent @click="addReference(item)"><DirectorIcon :name="item.kind === 'node' ? 'canvas' : 'reference'" :size="15" /><span>{{ item.label }}</span><small>{{ item.detail }}</small></button><p v-if="!filteredReferences.length" class="reference-empty">没有可引用的内容，试试其他名称</p></div>
        </div>
        <div v-if="batchPromptMode || references.length" class="context-chips">
          <span v-if="batchPromptMode" class="context-chip batch-context">批量优化 · {{ references.filter(r => r.kind === 'node' && mediaNodes.some(n => n.id === r.id)).length || mediaNodes.length }} 个节点<button type="button" aria-label="取消批量优化" @click="batchPromptMode = false">×</button></span>
          <span v-for="item in references" :key="item.key" class="context-chip" :title="item.detail + ' · ' + item.id">@ {{ item.label }}<button type="button" :aria-label="`移除引用 ${item.label}`" @click="references = references.filter(r => r.key !== item.key)">×</button></span>
        </div>
        <div v-if="attachments.length" class="attach-chips">
          <span v-for="(a, i) in attachments" :key="a.path || a.name" class="attach-chip">
            📎 {{ a.name }}
            <button type="button" :disabled="busy || changingConversation" title="移除附件" @click="removeAttachment(i)">×</button>
          </span>
        </div>
        <textarea
          ref="composerInput"
          v-model="input"
          rows="3"
          :disabled="busy || changingConversation"
          :placeholder="codexMode ? codexHome ? '描述你想做的事…' : '继续对话，或者 @ 引用画布内容…' : '开始你的创作，或者 @ 引用节点 / 资源…'"
          aria-label="和 AI 导演对话"
          @input="onComposerInput"
          @keydown="composerKeydown"
        />
        <div class="bar">
          <div class="bar-pop">
            <button
              type="button"
              class="bar-btn attach-btn"
              :disabled="busy || changingConversation"
              :title="codexMode ? '附件与创作' : '上传故事或剧本文本'" :aria-label="codexMode ? '附件与创作' : '上传文本附件'"
              @click.stop="codexMode ? codexAddOpen = !codexAddOpen : pickAttachments()"
            >
              <svg v-if="codexMode" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
              <svg v-else viewBox="0 0 24 24" aria-hidden="true">
                <path d="M21 12.5l-8.2 8.2a5.6 5.6 0 0 1-7.9-7.9L13 4.7a3.8 3.8 0 0 1 5.4 5.4l-8.1 8.1a1.9 1.9 0 0 1-2.7-2.7l7.5-7.5" />
              </svg>
              <span class="sr-only">附件与创作</span>
            </button>
            <div v-if="codexMode && codexAddOpen" class="menu codex-add-menu"><button type="button" @click="codexAddOpen = false; pickAttachments()">上传文本附件</button><button v-for="intent in creativeIntents" :key="intent.id" type="button" @click="codexAddOpen = false; useCreativeIntent(intent.id)">{{ intent.label }}</button><p class="menu-g">出片模式</p><button type="button" :class="{ on: shotChainMode === 'auto' }" @click="chooseShotChainMode('auto'); codexAddOpen = false">自动出片</button><button type="button" :class="{ on: shotChainMode === 'fl2va' }" @click="chooseShotChainMode('fl2va'); codexAddOpen = false">首尾帧链</button><button type="button" @click="memoryOpen = true; codexAddOpen = false">本地记忆</button></div>
          </div>
          <button type="button" class="bar-btn reference-trigger" :disabled="busy || changingConversation" :aria-expanded="referenceOpen" title="引用画布节点或项目资源" aria-label="引用节点或资源" @click="openReferences">@</button>
          <div v-if="!codexMode" class="bar-pop">
            <button
              type="button"
              class="bar-btn"
              :disabled="busy || changingConversation"
              title="出片生成模式：自动按参考图；首尾帧链取上一镜末帧保证镜头连续"
              @click.stop="genModeOpen = !genModeOpen; modeOpen = false"
            >
              {{ shotChainMode === 'fl2va' ? '首尾帧链' : '自动出片' }}
              <i />
            </button>
            <div v-if="genModeOpen" class="menu" @click.stop>
              <button
                type="button"
                :class="{ on: shotChainMode === 'auto' }"
                @click="chooseShotChainMode('auto')"
              >
                自动模式
              </button>
              <button
                type="button"
                :class="{ on: shotChainMode === 'fl2va' }"
                @click="chooseShotChainMode('fl2va')"
              >
                首尾帧模式
              </button>
              <p class="tip">
                {{
                  shotChainMode === 'fl2va'
                    ? '首尾帧链：第 1 镜用本镜配图起手；第 2 镜起自动截取上一镜视频的最后一帧作首帧，下一镜的配图作尾帧，镜头间画面连续。因为下一镜要等上一镜出片，批量出片会自动改成按镜号串行（一次一镜）。凑不齐首尾帧的镜头会自动退回常规出片，不会卡住生成。'
                    : '每镜按自己的参考图 / 关键帧出片（默认）。想要镜头之间画面连续就选首尾帧模式。'
                }}
              </p>
            </div>
          </div>
          <div class="bar-pop">
            <button
              type="button"
              class="bar-btn"
              :disabled="busy || changingConversation"
              :title="currentMode.desc"
              @click.stop="modeOpen = !modeOpen; prefOpen = false"
            >
              {{ currentMode.label }}
              <i />
            </button>
            <div v-if="modeOpen" class="menu" @click.stop>
              <button
                v-for="m in MODES"
                :key="m.id"
                type="button"
                :class="{ on: autonomy === m.id }"
                @mouseenter="hoverMode = m.id"
                @mouseleave="hoverMode = null"
                @click="chooseAutonomy(m.id)"
              >
                {{ m.label }}
              </button>
              <p class="tip">{{ modeTip }}</p>
            </div>
          </div>

          <CodexRunSelect v-if="settings.config.assistantEngine === 'codex'" :disabled="busy || statusLive || changingConversation" />
          <button
            v-if="busy"
            type="button"
            class="icon-act stop"
            title="停止"
            @click="cancel"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="7" y="7" width="10" height="10" rx="1.5" />
            </svg>
          </button>
          <button
            v-else
            type="submit"
            class="icon-act send"
            title="发送 · Enter（Shift+Enter 换行）" aria-label="发送消息"
            :disabled="!input.trim() || changingConversation"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 19V5m-6 6 6-6 6 6" />
            </svg>
          </button>
        </div>
      </div>
    </form>
  </aside>
</template>

<style scoped>
.tool-approval{padding:10px 14px;border-bottom:1px solid #69613c;background:#493e242e;font-size:12px;white-space:pre-wrap}.tool-approval p{margin:0 0 8px}.tool-approval button{margin-right:8px;padding:5px 12px;border:1px solid #777;border-radius:6px;background:#303036;color:#eee}
.agent {
  position: relative;
  width: 100%;
  height: 100%;
  flex-shrink: 0;
  min-width: 0;
  background: var(--color-bg-1);
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.head-actions { display: flex; align-items: center; gap: 3px; }
.head, .target, .chips, .composer { flex-shrink: 0; }
/* ── 头部 ── */
.head {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 12px 10px 16px;
}
.head-id {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.avatar {
  position: relative;
  width: 26px;
  height: 26px;
  border-radius: 9px;
  background: linear-gradient(135deg, #7eb4ff 0%, #a78bfa 60%, #f0abfc 100%);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.avatar i {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: rgba(16, 19, 26, 0.85);
  transition: background 0.25s;
}
.avatar.live i {
  background: #4ade80;
  box-shadow: 0 0 0 3px rgba(74, 222, 128, 0.25);
  animation: breathe 1.6s ease-in-out infinite;
}
@keyframes breathe {
  0%, 100% { box-shadow: 0 0 0 2px rgba(74, 222, 128, 0.18); }
  50% { box-shadow: 0 0 0 5px rgba(74, 222, 128, 0.1); }
}
.head-txt {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.head-txt strong {
  font-size: 13px;
  font-weight: 650;
  letter-spacing: 0.02em;
}
.head-txt .sub {
  font-size: 10px;
  color: var(--color-text-4);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 220px;
}
.head-txt .sub.live {
  color: var(--color-accent);
}
.head-btn {
  width: 28px;
  height: 28px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--color-text-3);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
}
.head-btn:hover {
  background: var(--color-fill);
  color: var(--color-text-1);
}
.head-btn.on {
  background: rgba(126, 180, 255, 0.14);
  border-color: rgba(126, 180, 255, 0.4);
  color: var(--color-accent);
}
.head-btn svg {
  width: 15px;
  height: 15px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.7;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.mem-pop {
  position: relative;
  flex-shrink: 0;
}

/* ── 选中节点卡片（自由画布） ── */
.target {
  margin: 0 14px 8px;
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: linear-gradient(180deg, rgba(126, 180, 255, 0.06), rgba(126, 180, 255, 0.02));
}
.target.empty {
  border-style: dashed;
  background: none;
}
.k {
  margin: 0;
  font-size: 10px;
  font-weight: 650;
  letter-spacing: 0.06em;
  color: var(--color-text-4);
}
.name {
  margin: 4px 0 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-1);
}
.name small {
  margin-left: 8px;
  font-weight: 400;
  color: var(--color-text-3);
}
.name.dim,
.preview.dim {
  font-weight: 400;
  color: var(--color-text-4);
}
.preview {
  margin: 6px 0 0;
  max-height: 60px;
  overflow: hidden;
  font-size: 11px;
  line-height: 1.55;
  color: var(--color-text-3);
  white-space: pre-wrap;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
}
.target-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 8px;
}
.target-chips button {
  margin: 0;
  padding: 3px 9px;
  border: 1px solid rgba(126, 180, 255, 0.3);
  border-radius: 99px;
  background: rgba(126, 180, 255, 0.08);
  color: var(--color-accent);
  font-size: 11px;
  cursor: pointer;
}
.target-chips button:hover {
  background: rgba(126, 180, 255, 0.16);
}

/* ── 消息流 ── */
.msgs {
  flex: 1;
  min-height: 0;
  min-width: 0;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 8px 16px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.msg {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  max-width: 100%;
  min-width: 0;
  animation: msg-in 0.24s ease;
}
@keyframes msg-in {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: none; }
}
.msg.user {
  justify-content: flex-end;
}
.msg-avatar {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  margin-top: 2px;
  border-radius: 8px;
  background: linear-gradient(135deg, #7eb4ff 0%, #a78bfa 60%, #f0abfc 100%);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.msg-avatar i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: rgba(16, 19, 26, 0.8);
}
.bubble {
  min-width: 0;
  max-width: 100%;
  padding: 9px 12px;
  border-radius: 12px;
  font-size: 13px;
  line-height: 1.7;
  overflow-wrap: anywhere;
  word-break: break-word;
}
.msg.user .bubble {
  max-width: 88%;
  padding: 8px 12px;
  border-radius: 14px 14px 4px 14px;
  background: linear-gradient(135deg, rgba(126, 180, 255, 0.22), rgba(167, 139, 250, 0.18));
  border: 1px solid rgba(126, 180, 255, 0.25);
  color: var(--color-text-1);
}
.msg.assistant .bubble {
  position: relative;
  flex: 1;
  border: 1px solid var(--color-border);
  border-radius: 4px 12px 12px 12px;
  background: var(--color-bg-2);
}
.bubble-copy {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 22px;
  height: 22px;
  margin: 0;
  padding: 0;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-bg-1);
  color: var(--color-text-4);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s, color 0.15s, border-color 0.15s;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.msg:hover .bubble-copy {
  opacity: 1;
}
.bubble-copy:hover {
  color: var(--color-text-1);
  border-color: rgba(126, 180, 255, 0.5);
}
.bubble-copy.ok {
  opacity: 1;
  color: var(--color-success);
  border-color: rgba(74, 222, 128, 0.5);
}
.bubble-copy svg {
  width: 12px;
  height: 12px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.turn {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 0 2px;
  border-top: 1px solid var(--color-border);
  min-width: 0;
}

/* ── 执行轨迹 ── */
.think {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--color-text-3);
}
.dot-pulse {
  display: inline-flex;
  gap: 4px;
}
.dot-pulse i {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--color-text-1);
  animation: dot-bounce 1s ease-in-out infinite;
}
.dot-pulse i:nth-child(2) { animation-delay: 0.15s; }
.dot-pulse i:nth-child(3) { animation-delay: 0.3s; }
@keyframes dot-bounce {
  0%, 100% { opacity: 0.3; transform: translateY(0); }
  50% { opacity: 1; transform: translateY(-2px); }
}
/* ── 快捷指令 ── */
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 0 16px 10px;
  min-width: 0;
  overflow-x: hidden;
}
.chips button {
  margin: 0;
  padding: 5px 12px;
  border: none;
  border-radius: 99px;
  background: transparent;
  color: var(--color-text-3);
  font-size: 11px;
  cursor: pointer;
  transition: background-color 0.15s, color 0.15s;
}
.chips button:hover {
  background: var(--color-fill-hover);
  color: var(--color-text-1);
}

/* ── 输入区 ── */
.composer {
  padding: 10px 12px 12px;
  border-top: 1px solid var(--color-border);
  min-width: 0;
}
.estimate {
  margin: 0 0 6px;
  font-size: 11px;
  color: var(--color-text-4);
}
.box {
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: var(--color-bg-2);
  border: 1px solid var(--color-border);
  border-radius: 14px;
  padding: 8px 8px 6px;
  transition: border-color 0.2s, box-shadow 0.2s;
}
.box:focus-within {
  border-color: rgba(126, 180, 255, 0.5);
  box-shadow: 0 0 0 3px rgba(126, 180, 255, 0.1);
}
textarea {
  width: 100%;
  min-height: 72px;
  resize: none;
  background: transparent;
  border: none;
  outline: none;
  color: var(--color-text-1);
  padding: 4px 6px 8px;
  font: inherit;
  font-size: 13px;
  line-height: 1.55;
}
.bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  min-width: 0;
}
.bar-pop {
  position: relative;
  flex-shrink: 0;
}
.attach-btn svg {
  width: 12px;
  height: 12px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.attach-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 2px 6px 6px;
}
.attach-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  padding: 3px 8px;
  border-radius: 999px;
  background: rgba(126, 180, 255, 0.12);
  color: #9db9ff;
  font-size: 11px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.attach-chip button {
  border: none;
  background: transparent;
  color: inherit;
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
  padding: 0 1px;
}
.bar-btn {
  height: 28px;
  margin: 0;
  min-width: 0;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--color-text-3);
  font-size: 11px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0 8px;
  white-space: nowrap;
  overflow: hidden;
  transition: background-color 0.15s, color 0.15s;
}
.bar-btn:hover:not(:disabled) {
  background: var(--color-fill-hover);
  color: var(--color-text-1);
}
.bar-btn:active:not(:disabled) {
  background: var(--color-fill-strong);
}
.bar-btn:disabled {
  opacity: 0.45;
  cursor: default;
}
.bar-btn i {
  width: 0;
  height: 0;
  border-left: 3.5px solid transparent;
  border-right: 3.5px solid transparent;
  border-top: 4px solid currentColor;
  opacity: 0.7;
}
.menu {
  position: absolute;
  left: 0;
  bottom: calc(100% + 6px);
  z-index: 8;
  width: 220px;
  padding: 6px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-bg-1);
  box-shadow: var(--shadow-md);
}
.model-menu {
  width: 248px;
  max-height: 280px;
  overflow: auto;
  right: 0;
  left: auto;
}
/* ── 创作偏好弹窗 ── */
.pref-btn {
  gap: 5px;
  padding: 0 10px;
}
.pref-icon {
  width: 14px;
  height: 14px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.7;
  stroke-linecap: round;
}
.pref-panel {
  position: fixed;
  z-index: 2000;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-bg-1);
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.28);
  overflow: auto;
  animation: pref-pop 0.12s ease-out;
}
@keyframes pref-pop {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
.pref-tabs {
  display: flex;
  gap: 4px;
  padding: 8px 10px 0;
}
.pref-tabs button {
  margin: 0;
  padding: 6px 14px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--color-text-3);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.pref-tabs button.on {
  background: var(--color-fill);
  color: var(--color-text-1);
}
.pref-body {
  display: grid;
  grid-template-columns: 1fr 190px;
  gap: 0;
  padding: 10px;
}
.pref-models {
  min-width: 0;
  padding-right: 10px;
  border-right: 1px solid var(--color-border);
  max-height: 260px;
  overflow: auto;
}
.pref-k {
  margin: 2px 4px 8px;
  font-size: 10px;
  font-weight: 650;
  letter-spacing: 0.04em;
  color: var(--color-text-4);
}

/* 偏好面板里的分组小标题（视频工作流 / 已配置接入） */
.pref-g {
  margin: 10px 4px 4px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.03em;
  color: var(--color-text-4);
}
.pref-g:first-child {
  margin-top: 2px;
}
.pref-empty {
  margin: 4px;
  padding: 10px;
  font-size: 11px;
  color: var(--color-text-4);
}
.pref-model {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  width: 100%;
  margin: 0 0 2px;
  padding: 8px;
  border: none;
  border-radius: 8px;
  background: transparent;
  text-align: left;
  cursor: pointer;
}
.pref-model:hover {
  background: var(--color-fill);
}
.pref-model.on {
  background: var(--color-fill);
}
.pref-radio {
  flex-shrink: 0;
  width: 12px;
  height: 12px;
  margin-top: 2px;
  border: 1.5px solid var(--color-text-4);
  border-radius: 50%;
}
.pref-model.on .pref-radio {
  border-color: var(--color-primary, #7c6cff);
  background: var(--color-primary, #7c6cff);
  box-shadow: inset 0 0 0 2.5px var(--color-bg-1);
}
.pref-model-text {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.pref-model-text b {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pref-model-text small {
  font-size: 10.5px;
  color: var(--color-text-4);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pref-ratios {
  padding-left: 12px;
}
.ratio-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.ratio-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  width: 56px;
  height: 56px;
  margin: 0;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: transparent;
  color: var(--color-text-3);
  cursor: pointer;
}
.ratio-item:hover {
  background: var(--color-fill);
}
.ratio-item.on {
  border-color: var(--color-primary, #7c6cff);
  background: var(--color-fill);
  color: var(--color-text-1);
}
.ratio-box {
  border: 1.5px solid currentColor;
  border-radius: 3px;
}
.ratio-label {
  font-size: 10px;
}
.pref-hint {
  margin: 10px 2px 2px;
  font-size: 10.5px;
  line-height: 1.6;
  color: var(--color-text-4);
}
.menu-g {
  margin: 8px 8px 4px;
  font-size: 10px;
  font-weight: 650;
  letter-spacing: 0.04em;
  color: var(--color-text-4);
}
.menu-g:first-of-type {
  margin-top: 2px;
}
.empty {
  margin: 0 8px 8px;
  font-size: 11px;
  color: var(--color-text-4);
}
.menu > button,
.model-item {
  display: block;
  width: 100%;
  margin: 0;
  padding: 7px 8px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--color-text-2);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.model-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.model-item span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.menu > button.on,
.menu > button:hover,
.model-item.on,
.model-item:hover {
  background: var(--color-fill);
  color: var(--color-text-1);
}
.tip {
  margin: 6px 2px 2px;
  padding-top: 6px;
  border-top: 1px solid var(--color-border);
  font-size: 11px;
  line-height: 1.45;
  color: var(--color-text-4);
}
.icon-act {
  flex-shrink: 0;
  width: 30px;
  height: 30px;
  margin: 0 0 0 auto;
  padding: 0;
  border: none;
  border-radius: 50%;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.icon-act svg {
  width: 15px;
  height: 15px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.send {
  background: linear-gradient(135deg, #7eb4ff, #a78bfa);
  color: #fff;
  transition: transform 0.12s, box-shadow 0.2s;
}
.send:hover:not(:disabled) {
  box-shadow: 0 4px 14px rgba(126, 180, 255, 0.35);
  transform: translateY(-1px);
}
.send:disabled {
  opacity: 0.35;
  cursor: default;
}
.stop {
  background: transparent;
  color: var(--color-error);
  border: 1px solid rgba(185, 28, 28, 0.35);
  border-radius: 10px;
}
.stop svg {
  fill: currentColor;
  stroke: none;
}
@media (max-height: 740px) {
  .target .preview, .target-chips { display: none; }
  .target { padding: 7px 10px; margin-bottom: 4px; }
  .chips { padding-bottom: 4px; }
  .head { padding-block: 8px; }
  .composer { padding: 6px 8px 8px; }
  textarea { min-height: 54px; height: 54px; }
}

/* Director panel: quiet chrome, a spacious start screen, and one composer. */
.director { background:var(--color-bg-1); }
.director .head { padding:12px 12px 10px 16px; min-height:54px; gap:6px; }
.director .head-actions { gap:1px; flex-shrink:0; }
.director .head-btn { width:27px; height:28px; padding:5px; border-radius:7px; }
.director .head-btn:disabled { opacity:.3; cursor:default; }
.director .head-btn:focus-visible,.conversation-toggle:focus-visible,.welcome-actions button:focus-visible,.creative-tabs button:focus-visible { outline:2px solid var(--color-accent); outline-offset:2px; }
.director .head-btn.pref-btn { padding:5px; }
.sr-only { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
.context-note { font-size:10px; color:var(--color-text-4); padding-left:1px; }
.conversation-pop { position:relative; display:flex; align-items:flex-start; flex-direction:column; gap:3px; flex:1; min-width:0; }
.conversation-toggle { display:flex; align-items:center; gap:6px; max-width:100%; padding:4px 1px; color:var(--color-text-2); background:transparent; border:0; font:inherit; font-size:12px; cursor:pointer; }
.conversation-toggle span { overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
.conversation-toggle:disabled { cursor:default; }
.director-status { display:flex; align-items:center; gap:5px; width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:#5ddad1; font-size:10px; }
.director-status i { width:5px; height:5px; flex-shrink:0; border-radius:50%; background:currentColor; }
.conversation-menu { position:absolute; top:calc(100% + 10px); left:0; width:min(290px,calc(100vw - 72px)); max-height:280px; overflow:auto; padding:6px; border:1px solid var(--color-border-strong); border-radius:12px; background:var(--color-bg-2); box-shadow:0 8px 32px #0005; z-index:30; }
.conversation-menu > p { margin:8px 9px 4px; color:var(--color-text-4); font-size:10px; }
.conversation-menu button { display:flex; align-items:center; gap:7px; width:100%; padding:9px; border:0; border-radius:7px; background:transparent; color:var(--color-text-2); font:inherit; font-size:12px; text-align:left; cursor:pointer; }
.conversation-menu button span { overflow:hidden; white-space:nowrap; text-overflow:ellipsis; flex:1; }
.conversation-menu button small { color:var(--color-text-4); font-size:10px; flex-shrink:0; }
.conversation-menu button:hover:not(:disabled),.conversation-entry.current { background:var(--color-fill-hover); color:var(--color-text-1); }
.conversation-entry { display:flex; align-items:center; border-radius:7px; min-width:0; }
.conversation-menu .conversation-select { flex:1; min-width:0; }
.conversation-entry.current .conversation-select { color:var(--color-text-1); }
.conversation-menu .conversation-rename { flex:0 0 28px; width:28px; height:28px; padding:6px; margin-right:3px; justify-content:center; color:var(--color-text-3); }
.conversation-menu button:disabled { opacity:.5; cursor:default; }
.conversation-menu button:focus-visible { outline:2px solid var(--color-accent); outline-offset:-2px; }
.conversation-rename-form { flex:1; min-width:0; padding:6px; }
.conversation-rename-form input { box-sizing:border-box; width:100%; min-width:0; padding:7px 8px; border:1px solid var(--color-accent); border-radius:6px; background:var(--color-bg-1); color:var(--color-text-1); font:inherit; font-size:12px; }
.rename-actions { display:flex; align-items:center; justify-content:flex-end; gap:4px; margin-top:5px; }
.conversation-menu .rename-actions button { width:auto; padding:4px 8px; font-size:11px; }
.rename-actions button[type=submit] { color:var(--color-accent); }
.rename-error { flex:1; font-size:10px; line-height:1.4; color:#f59a9a; }
.director .target { padding:9px 11px; margin:0 14px 6px; background:var(--color-fill); border-radius:10px; }
.director .target .k { font-size:9px; font-weight:500; }
.director .target .name { font-size:12px; font-weight:500; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.director .target .preview { -webkit-line-clamp:2; max-height:34px; margin-top:4px; }
.director .target-chips { margin-top:6px; }
.director .target-chips button { background:transparent; border-color:var(--color-border); border-radius:6px; color:var(--color-text-3); padding:3px 6px; font-size:10px; }
.director .msgs { padding:10px 16px 14px; gap:16px; }
.director .msgs.welcome-scroll { padding:0 18px 12px; }
.director-welcome { display:flex; flex-direction:column; flex:1; justify-content:center; min-height:min-content; }
.welcome-identity { display:flex; flex-direction:column; align-items:center; text-align:center; padding:24px 0 20px; }
.welcome-identity h2 { margin:17px 0 7px; color:var(--color-text-1); font-size:18px; line-height:1.65; font-weight:400; letter-spacing:.01em; }
.welcome-identity h2 strong { font-weight:600; }
.welcome-identity p { margin:0; color:var(--color-text-4); font-size:11px; }
.welcome-actions { display:flex; flex-direction:column; gap:3px; padding:0 2px; }
.welcome-actions > button { display:flex; align-items:center; gap:11px; width:100%; min-height:52px; padding:9px 11px; border:1px solid transparent; border-radius:11px; background:transparent; color:var(--color-text-3); text-align:left; cursor:pointer; transition:background .15s,color .15s; }
.welcome-actions > button:hover { border-color:var(--color-border); background:var(--color-fill); color:var(--color-text-1); }
.welcome-actions button > svg { flex-shrink:0; }
.welcome-actions button > svg:last-child { margin-left:auto; opacity:.6; }
.welcome-actions button > span { display:flex; flex-direction:column; gap:4px; min-width:0; }
.welcome-actions b { font-size:12px; font-weight:400; }
.welcome-actions small { color:var(--color-text-4); font-size:10px; font-weight:400; }
.msg-orb { margin-top:5px; }
.director .msg.assistant .bubble { background:transparent; border:0; padding:4px 3px; }
.director .msg.user .bubble { background:var(--color-bg-3); border:1px solid var(--color-border); }
.director .bubble { font-size:12px; }
.director .bubble-copy { top:auto; bottom:-18px; right:0; }
.director .creative-tabs { display:flex; flex-shrink:0; gap:6px; padding:8px 13px 7px; }
.creative-tabs button { display:flex; align-items:center; gap:5px; padding:5px 7px; border:1px solid var(--color-border); border-radius:7px; background:var(--color-fill); color:var(--color-text-3); font:inherit; font-size:10px; cursor:pointer; white-space:nowrap; }
.creative-tabs button:hover:not(:disabled) { color:var(--color-text-1); background:var(--color-fill-hover); }
.creative-tabs button:disabled { opacity:.4; cursor:default; }
.director .composer { padding:0 10px 10px; border-top:0; position:relative; }
.director .composer .box { position:relative; padding:10px 10px 8px; border-radius:17px; background:color-mix(in srgb,var(--color-bg-1) 70%,var(--color-bg-2)); border-color:var(--color-border-strong); }
.director .box:focus-within { border-color:color-mix(in srgb,#43d4d9 50%,var(--color-border)); box-shadow:0 0 0 2px #2cd8d808; }
.director textarea { box-sizing:border-box; min-height:76px; max-height:180px; padding:2px 2px 10px; font-size:12px; line-height:1.7; }
.director textarea::placeholder { color:var(--color-text-4); }
.director .bar { gap:3px; flex-wrap:nowrap; position:relative; }
.director .bar-pop { position:static; }
.director .bar-btn { padding:0 6px; font-size:10px; height:29px; }
.director .attach-btn { width:27px; padding:5px; justify-content:center; }
.director .attach-btn svg { width:16px; height:16px; }
.reference-trigger { font-size:16px !important; width:27px; justify-content:center; }
.director .menu { left:0; right:auto; bottom:calc(100% + 10px); width:100%; max-height:270px; overflow:auto; box-sizing:border-box; }
.director .icon-act { width:30px; height:30px; border-radius:10px; margin-left:auto; }
.director .send { background:var(--color-text-1); color:var(--color-bg-1); }
.director .send:disabled { background:var(--color-fill-strong); color:var(--color-text-4); opacity:1; }
.director .estimate { font-size:10px; padding-inline:5px; }
.context-chips { display:flex; flex-wrap:wrap; gap:5px; padding:0 0 8px; }
.context-chip { display:inline-flex; align-items:center; max-width:100%; gap:5px; padding:4px 6px; border:1px solid var(--color-border); border-radius:6px; font-size:10px; color:var(--color-text-2); background:var(--color-fill); overflow-wrap:anywhere; }
.context-chip button { display:grid; place-items:center; padding:0 1px; border:0; background:transparent; color:var(--color-text-4); cursor:pointer; font-size:13px; }
.batch-context { color:#5bd9d1; border-color:#47d3cf30; }
.reference-picker { display:flex; flex-direction:column; position:absolute; bottom:calc(100% + 8px); left:0; width:100%; max-height:min(300px,36vh); padding:7px; box-sizing:border-box; border:1px solid var(--color-border-strong); border-radius:12px; background:var(--color-bg-2); box-shadow:0 8px 30px #0006; z-index:20; }
.reference-picker-head { flex-shrink:0; display:flex; align-items:center; justify-content:space-between; padding:3px 3px 8px; color:var(--color-text-2); font-size:11px; }
.reference-picker-head strong { font-weight:500; }
.reference-picker-head button { border:0; padding:2px; background:transparent; color:var(--color-text-3); cursor:pointer; }
.reference-picker > input { flex-shrink:0; width:100%; padding:7px; box-sizing:border-box; border:1px solid var(--color-border); border-radius:6px; color:var(--color-text-1); background:var(--color-bg-1); font:inherit; font-size:11px; outline:none; }
.reference-picker > [role=listbox] { flex:1 1 auto; overflow-y:auto; overflow-x:hidden; min-height:0; padding-top:5px; overscroll-behavior:contain; overflow-anchor:none; scrollbar-gutter:stable; scroll-behavior:auto; }
.reference-picker [role=option] { display:flex; align-items:center; gap:7px; width:100%; padding:8px 6px; background:transparent; color:var(--color-text-2); font:inherit; font-size:11px; border:0; border-radius:6px; text-align:left; cursor:pointer; }
.reference-picker [role=option].highlighted,.reference-picker [role=option]:hover { background:var(--color-fill-hover); }
.reference-picker [role=option] span { flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.reference-picker [role=option] small { font-size:9px; color:var(--color-text-4); white-space:nowrap; }
.reference-empty { padding:8px; margin:0; color:var(--color-text-4); font-size:11px; }
@media (max-height:740px) { .welcome-identity { padding:14px 0 12px; } .welcome-identity h2 { font-size:16px; margin-top:12px; } .welcome-actions > button { min-height:44px; padding-block:7px; } .welcome-actions small { display:none; } .director textarea { min-height:64px; height:64px; } }
@media (max-width:480px) { .director .head { padding-inline:11px; } .director .head-btn { width:25px; padding:4px; } .director .head-actions { gap:0; } .director .creative-tabs { gap:4px; padding-inline:11px; } .creative-tabs button { padding-inline:6px; } .director .bar-btn { padding-inline:4px; } }
@media (prefers-reduced-motion:reduce) { .director *, .director *::before,.director *::after { animation:none !important; transition:none !important; scroll-behavior:auto !important; } }
</style>

<style scoped>
.codex-layout .head{padding:8px 10px 7px;min-height:36px;box-sizing:border-box;align-items:center;gap:4px}
.codex-nav{display:flex;align-items:center;gap:4px;flex:1;min-width:0}.codex-nav h2{margin:0;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;font-weight:400;color:var(--color-text-2)}.codex-home .codex-nav h2{color:var(--color-text-3)}.codex-nav .codex-back{flex-shrink:0;width:22px;padding:3px}
.codex-layout .head-actions{gap:0}.codex-layout .head-btn{width:24px;height:25px;padding:4px;flex-shrink:0}.codex-layout :deep(.assistant-engine>summary){font-size:10px;border:0;padding:4px;max-width:83px;overflow:hidden;text-overflow:ellipsis}.codex-layout .head-actions>.mem-pop:empty{display:none}
.codex-chat-more{position:relative}.codex-chat-more>summary{cursor:pointer;list-style:none}.codex-chat-more>summary::-webkit-details-marker{display:none}.codex-more-menu{position:absolute;right:0;top:calc(100% + 7px);z-index:150;width:130px;padding:5px;border:1px solid var(--color-border);border-radius:9px;background:var(--color-bg-2);box-shadow:0 8px 25px #0003}.codex-more-menu button{width:100%;text-align:left;padding:8px;border:0;border-radius:5px;background:transparent;color:var(--color-text-2);font:inherit;font-size:11px;cursor:pointer}.codex-more-menu button:hover{background:var(--color-fill)}.codex-more-menu button:disabled{opacity:.4;cursor:default}
.codex-layout .msgs{padding:16px 14px 18px;gap:20px}.codex-layout .msgs.welcome-scroll{padding:16px 14px 18px}.codex-layout .msg.assistant{width:100%}.codex-layout .msg.assistant .bubble{padding:0;max-width:100%;width:100%;font-size:12px;line-height:1.8}.codex-layout .msg.user .bubble{background:var(--color-fill);border:0;border-radius:14px;padding:10px 12px;max-width:88%;font-size:12px}.codex-layout .turn{margin:0;padding:0;border-top:0}.codex-work{color:var(--color-text-3);font-size:11px}.codex-work>summary{list-style:none;display:flex;align-items:center;gap:5px;cursor:pointer;padding:4px 0}.codex-work>summary::-webkit-details-marker{display:none}.codex-work[open]>summary{margin-bottom:8px}.codex-work:not([open])>summary svg{transform:rotate(-90deg)}
.codex-layout .think{padding:3px 0;font-size:11px}.codex-layout :deep(.trace-list){gap:6px}.codex-layout :deep(.trace-list .row){background:transparent;border:0;padding:3px 0}.codex-workspace{display:flex;align-items:center;gap:6px;padding:6px 14px 8px;flex-shrink:0;color:var(--color-text-3);font-size:10px;min-width:0}.codex-workspace>span:first-of-type{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}.codex-workspace>.context-note{font-size:9px;white-space:nowrap}.codex-live{max-width:50%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--color-accent)}
/* Let the model picker consume the free space; keep Send/Stop beside it. */
.codex-layout .bar > .icon-act { margin-left:3px; }
.codex-layout .composer{padding:0 9px 9px}.codex-layout .composer .box{border-radius:18px;padding:10px 10px 7px;background:var(--color-bg-1);box-shadow:0 2px 8px #00000008}.codex-layout .composer textarea{min-height:56px;height:56px;padding:2px 2px 9px;line-height:1.7}.codex-layout .bar{gap:3px}.codex-layout .send{background:var(--color-accent);color:#fff;border-radius:50%;width:28px;height:28px}.codex-layout .send:disabled{background:var(--color-fill-strong);color:var(--color-text-4)}.codex-layout .stop{border-radius:50%;width:28px;height:28px}.codex-layout .chips{padding:0 14px 8px}.codex-layout .target{margin-top:4px;padding:6px 9px;flex-shrink:0}.codex-layout .target .preview,.codex-layout .target .target-chips{display:none}.codex-layout .target .k{display:none}.codex-layout .target .name{margin:0;font-size:10px;color:var(--color-text-3)}
@media(max-width:500px){.codex-layout .head{padding-inline:8px}.codex-layout .head-btn{width:22px}.codex-layout :deep(.assistant-engine>summary){max-width:68px;font-size:9px}.codex-layout .codex-workspace>.context-note{display:none}.codex-layout .msgs{padding-inline:12px}}
</style>

<style scoped>
.msgs{scroll-behavior:auto;overscroll-behavior:contain;scrollbar-gutter:stable}.msgs.positioning{visibility:hidden}.msgs .msg{animation:none}
.latest-shortcut{position:relative;height:0;flex-shrink:0;z-index:4}.latest-shortcut button{position:absolute;bottom:8px;left:50%;transform:translateX(-50%);padding:6px 12px;border:1px solid var(--color-border-strong);border-radius:18px;background:var(--color-bg-2);color:var(--color-text-2);box-shadow:0 2px 10px #0002;font:inherit;font-size:11px;cursor:pointer;white-space:nowrap}.latest-shortcut button:hover{color:var(--color-text-1);background:var(--color-fill-hover)}.latest-shortcut button:focus-visible{outline:2px solid var(--color-accent);outline-offset:2px}
</style>
