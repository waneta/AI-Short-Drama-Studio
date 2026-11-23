<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, provide, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { VueFlow, useVueFlow, wheelDelta, SelectionMode, type Connection, type Edge, type EdgeChange, type Node, type NodeMouseEvent } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import { useProjectStore, useAssetsStore, useToastStore } from '@/stores'
import { rebuildCanvasGraph, NODE_W, nextFreeformPosition, rescueStrandedFreeformNodes } from '@/services/canvas/layout'
import { setCanvasReveal, setCanvasInspect, setCanvasSelect } from '@/services/canvas/canvasBridge'
import { rebindShotScenes, optimizeShotVideoPrompt, optimizeFreeformVideoPrompt } from '@/services/canvas/runner'
import {
  appendCanvasReferenceSource,
  canvasNodeProducesImage
} from '@/services/canvas/references'
import { isDesktop, desktop } from '@/services/desktop'
import PipelineNode from '@/components/canvas/PipelineNode.vue'
import AudioNode from '@/components/canvas/AudioNode.vue'
import ScriptDocNode from '@/components/canvas/ScriptDocNode.vue'
import { useCanvasContextActions } from '@/composables/useCanvasContextActions'
import CanvasNodeContextMenu from '@/components/canvas/CanvasNodeContextMenu.vue'
import CanvasContextDialog from '@/components/canvas/CanvasContextDialog.vue'
import { useCanvasEditing } from '@/composables/useCanvasEditing'
import { useCanvasViewport } from '@/composables/useCanvasViewport'
import CanvasShortcutPanel from '@/components/canvas/CanvasShortcutPanel.vue'
import GroupFrame from '@/components/canvas/GroupFrame.vue'
import FlowConnectionEdge from '@/components/canvas/FlowConnectionEdge.vue'
import FreeformGenNode from '@/components/canvas/FreeformGenNode.vue'
import AgentChat from '@/components/canvas/AgentChat.vue'
import AgentOrb from '@/components/canvas/AgentOrb.vue'
import StudioSidebar from '@/components/canvas/StudioSidebar.vue'
import CanvasGuide from '@/components/canvas/CanvasGuide.vue'
import NodeInspector from '@/components/canvas/NodeInspector.vue'
import CanvasToolbarIcon from '@/components/canvas/CanvasToolbarIcon.vue'
import { normalizeVideoGenModel, type CanvasNode, type Shot } from '@/types'

const project = useProjectStore()
const assets = useAssetsStore()
const toast = useToastStore()
const router = useRouter()
const agentOpen = ref(false)
const agentBusy = ref(false)
const workspaceMenu = ref<HTMLDetailsElement>()
const agentDocked = ref(false)
const studioRoot = ref<HTMLElement>()
const agentFloatHost = ref<HTMLElement>()
const agentDockHost = ref<HTMLElement>()
const sidebarOpen = ref(window.innerWidth > 760)
const viewportWidth = ref(window.innerWidth)
const flowWrap = ref<HTMLElement | null>(null)
const agentToggle = ref<HTMLButtonElement | null>(null)
const sidebarWidth = computed(() => !sidebarOpen.value ? 0 : viewportWidth.value <= 760 ? Math.min(300, viewportWidth.value - 56) : viewportWidth.value <= 1000 ? 260 : 300)
const GUIDE_KEY = 'aicut:guide:canvas'
const guideOpen = ref(localStorage.getItem(GUIDE_KEY) !== 'done')
function dismissGuide() {
  guideOpen.value = false
  try {
    localStorage.setItem(GUIDE_KEY, 'done')
  } catch {
    /* 本地存储不可用时，本次会话内也不再弹 */
  }
}

const agentWidth = ref(440)
const resizingAgent = ref(false)
const rightOpen = ref(false)
const optimizingAllVideos = ref(false)
const optimizeAllProgress = ref('')
// 合并模式：不再区分自由画布与创作模式，只有这一种画布
// （保留 img2video 只是老项目的历史字段，不再用于功能分叉）

const MIN_CANVAS_ZOOM = 0.2
const MAX_CANVAS_ZOOM = 2
const AGENT_WIDTH_KEY = 'aicut:agent-chat-width'
const AGENT_MIN_WIDTH = 300
const AGENT_MAX_WIDTH = 760
let resizeStartX = 0
let resizeStartWidth = 440
let previousBodyCursor = ''
let previousBodyUserSelect = ''

function maxAgentWidth() {
  const studioWidth = studioRoot.value?.clientWidth ?? window.innerWidth
  // Measure the whole studio when docked: the canvas has already given up this width.
  const canvasWidth = flowWrap.value?.clientWidth ?? studioWidth
  const available = agentDocked.value
    ? viewportWidth.value <= 760 ? studioWidth : studioWidth - sidebarWidth.value - 320
    : canvasWidth - (canvasWidth > 900 ? 320 : 24)
  return Math.max(0, Math.min(AGENT_MAX_WIDTH, available))
}

function clampAgentWidth(value: number) {
  return Math.round(Math.max(Math.min(AGENT_MIN_WIDTH, maxAgentWidth()), Math.min(maxAgentWidth(), value)))
}

function persistAgentWidth() {
  try {
    localStorage.setItem(AGENT_WIDTH_KEY, String(agentWidth.value))
  } catch {
    /* localStorage unavailable */
  }
}

function loadAgentWidth() {
  try {
    const saved = Number(localStorage.getItem(AGENT_WIDTH_KEY))
    if (Number.isFinite(saved) && saved > 0) agentWidth.value = clampAgentWidth(saved)
  } catch {
    agentWidth.value = clampAgentWidth(agentWidth.value)
  }
}

function onAgentResizeMove(event: PointerEvent) {
  if (!resizingAgent.value) return
  agentWidth.value = clampAgentWidth(resizeStartWidth - event.clientX + resizeStartX)
}

function stopAgentResize() {
  if (!resizingAgent.value) return
  resizingAgent.value = false
  window.removeEventListener('pointermove', onAgentResizeMove)
  window.removeEventListener('pointerup', stopAgentResize)
  window.removeEventListener('pointercancel', stopAgentResize)
  document.body.style.cursor = previousBodyCursor
  document.body.style.userSelect = previousBodyUserSelect
  persistAgentWidth()
}

function startAgentResize(event: PointerEvent) {
  if (event.button !== 0) return
  const handle = event.currentTarget as HTMLElement | null
  handle?.focus()
  event.preventDefault()
  resizeStartX = event.clientX
  resizeStartWidth = agentWidth.value
  resizingAgent.value = true
  previousBodyCursor = document.body.style.cursor
  previousBodyUserSelect = document.body.style.userSelect
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
  window.addEventListener('pointermove', onAgentResizeMove)
  window.addEventListener('pointerup', stopAgentResize)
  window.addEventListener('pointercancel', stopAgentResize)
}

function nudgeAgentWidth(delta: number) {
  agentWidth.value = clampAgentWidth(agentWidth.value + delta)
  persistAgentWidth()
}

function clampAgentToViewport() {
  viewportWidth.value = window.innerWidth
  if (agentOpen.value) {
    if (window.innerWidth <= 760) sidebarOpen.value = false
    if (window.innerWidth <= 1000 || agentDocked.value) rightOpen.value = false
    if (agentDocked.value && window.innerWidth - sidebarWidth.value < AGENT_MIN_WIDTH + 320) sidebarOpen.value = false
  }
  const next = clampAgentWidth(agentWidth.value)
  if (next !== agentWidth.value) agentWidth.value = next
}

watch([rightOpen, sidebarOpen, agentDocked], () => nextTick(clampAgentToViewport))

function toggleAgent() {
  stopAgentResize()
  agentOpen.value = !agentOpen.value
  if (agentOpen.value) {
    if (window.innerWidth <= 760) sidebarOpen.value = false
    if (window.innerWidth <= 1000) rightOpen.value = false
    nextTick(clampAgentToViewport)
  }
}

function toggleAgentDock() {
  stopAgentResize()
  agentDocked.value = !agentDocked.value
  if (agentDocked.value) rightOpen.value = false
  void nextTick(clampAgentToViewport)
}

function toggleSidebar() {
  sidebarOpen.value = !sidebarOpen.value
  if (sidebarOpen.value && window.innerWidth <= 760) {
    stopAgentResize()
    agentOpen.value = false
  }
}

watch(rightOpen, open => {
  if (open && agentOpen.value && (agentDocked.value || window.innerWidth <= 1000)) closeAgent()
})

function closeAgent() {
  stopAgentResize()
  agentOpen.value = false
  nextTick(() => agentToggle.value?.focus())
}

function focusSidebarNode(id: string) {
  selectedId.value = id
  if (findNode(id)) void editing.choose([id])
  if (window.innerWidth <= 760) sidebarOpen.value = false
  nextTick(() => fitView({ nodes: [id], padding: 0.5, minZoom: 1, maxZoom: 1, duration: 350 }))
}

// Screen coordinates are kept independently of canvas zoom/pan. Tab uses the
// latest hover position; toolbar/sidebar buttons retain their default placement.
let canvasPointer: { x: number; y: number } | null = null
const blankContextMenu = ref<HTMLElement | null>(null)

function rememberCanvasPointer(event: PointerEvent) {
  canvasPointer = { x: event.clientX, y: event.clientY }
}

function showAddMenu(point: { x: number; y: number }, flow = screenToFlowCoordinate(point)) {
  ctxMenu.value = { ...point, flow }
  const menu = ctxMenu.value
  void nextTick(() => {
    if (ctxMenu.value !== menu || !blankContextMenu.value) return
    const rect = blankContextMenu.value.getBoundingClientRect()
    menu.x = Math.max(8, Math.min(point.x, window.innerWidth - rect.width - 8))
    menu.y = Math.max(8, Math.min(point.y, window.innerHeight - rect.height - 8))
  })
}

function openAddMenuAtPointer() {
  const rect = flowWrap.value?.getBoundingClientRect()
  const point = canvasPointer
  if (rect && point && point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom) {
    showAddMenu(point)
  } else {
    openAddMenu()
  }
}

function openAddMenu() {
  const rect = flowWrap.value?.getBoundingClientRect()
  if (!rect) return
  showAddMenu(
    { x: rect.left + rect.width / 2 - 108, y: Math.max(rect.top + 8, rect.bottom - 340) },
    screenToFlowCoordinate({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
  )
}

const nodeTypes = {
  script: ScriptDocNode,
  subject: PipelineNode,
  subjectProps: PipelineNode,
  scene: PipelineNode,
  sceneProps: PipelineNode,
  shotBoard: PipelineNode,
  shotImage: PipelineNode,
  shotVideo: PipelineNode,
  audio: AudioNode,
  export: PipelineNode,
  final: PipelineNode,
  groupFrame: GroupFrame,
  imageGen: FreeformGenNode,
  videoGen: FreeformGenNode
}

const edgeTypes = { connection: FlowConnectionEdge }

const { connectionClickStartHandle, startConnection, updateConnection, endConnection, vueFlowRef, onConnect, onNodeDragStart, onNodeDrag, onNodeDragStop, fitView, screenToFlowCoordinate, findNode, addSelectedNodes, removeSelectedNodes, getSelectedNodes, getSelectedEdges, getViewport, setViewport, viewport, zoomIn, zoomOut } = useVueFlow()
const canvasViewport = useCanvasViewport({ viewport, getViewport })
// Vue Flow measures the drag threshold in canvas coordinates. Keep a 6px
// screen-space dead zone so selecting a node does not turn hand jitter into a drag.
const nodeDragThreshold = computed(() => 6 / viewport.value.zoom)
const zoomPercent = computed(() => Math.round(viewport.value.zoom * 100))

function closeWorkspaceMenu(event: PointerEvent) {
  if (workspaceMenu.value?.open && !workspaceMenu.value.contains(event.target as HTMLElement)) workspaceMenu.value.open = false
}

// Vue Flow supports click-to-connect but only draws the drag preview by default.
// Share its preview while a click connection is pending, using the same real ports.
watch(connectionClickStartHandle, (handle, previous) => {
  if (handle) {
    const node = findNode(handle.nodeId)
    const port = node?.handleBounds[handle.type]?.find((item) => item.id === handle.id)
    const rect = vueFlowRef.value?.getBoundingClientRect()
    startConnection({ ...handle, position: port?.position || handle.position }, rect ? { x: handle.x - rect.left, y: handle.y - rect.top } : undefined)
  } else if (previous) endConnection()
})
function moveClickConnection(event: MouseEvent) {
  if (!connectionClickStartHandle.value) return
  const rect = vueFlowRef.value?.getBoundingClientRect()
  if (rect) updateConnection({ x: event.clientX - rect.left, y: event.clientY - rect.top })
}
function cancelClickConnection() {
  if (!connectionClickStartHandle.value) return
  endConnection(undefined, true)
  endConnection()
}
function onCanvasClickCapture(event: MouseEvent) {
  if (!(event.target as Element).closest('.vue-flow__handle')) cancelClickConnection()
}
function onConnectionKey(event: KeyboardEvent) {
  if (event.key === 'Escape') { cancelClickConnection(); closeCtxMenu() }
}
function onEdgesChange(changes: EdgeChange[]) {
  project.removeCanvasEdges(changes.filter((change) => change.type === 'remove').map((change) => change.id))
}

function onStudioWheel(event: WheelEvent) {
  if (!event.ctrlKey) return
  // Capture with passive:false so node editors, floating panels and zoom limits
  // cannot fall back to browser page zoom. Plain wheel scrolling is unchanged.
  event.preventDefault()
  const flow = flowWrap.value?.querySelector<HTMLElement>('.vue-flow')
  const target = event.target
  if (!flow || !(target instanceof Element) || !flow.contains(target)) return
  if (target.closest('.vue-flow__controls')) return

  // Handle Ctrl+wheel before Vue Flow's nowheel filter (node media/editors),
  // and prevent its own wheel handler from applying the zoom a second time.
  event.stopPropagation()
  const current = getViewport()
  const zoom = Math.max(MIN_CANVAS_ZOOM, Math.min(MAX_CANVAS_ZOOM, current.zoom * 2 ** wheelDelta(event)))
  if (zoom === current.zoom) return
  const rect = flow.getBoundingClientRect()
  const x = event.clientX - rect.left
  const y = event.clientY - rect.top
  const ratio = zoom / current.zoom
  void setViewport({ x: x - (x - current.x) * ratio, y: y - (y - current.y) * ratio, zoom })
}

const ctxMenu = ref<{
  x: number
  y: number
  flow: { x: number; y: number }
  nodeId?: string
  onNode?: boolean
} | null>(null)

provide('canvasContextMenuOpen', computed(() => Boolean(ctxMenu.value)))

const flowNodes = computed<Node[]>(() => {
  const graph = project.current?.canvas
  if (!graph) return []
  return graph.nodes.map((n) => {
    if (n.type === 'groupFrame') {
      return {
        id: n.id,
        type: 'groupFrame',
        position: n.position,
        data: { ...n.data, nodeType: n.type },
        style: {
          pointerEvents: 'none',
          width: `${n.data.width ?? 280}px`,
          height: `${n.data.height ?? 240}px`
        },
        draggable: true,
        selectable: n.data.kind === 'custom',
        parentNode: n.parentGroupId,
        expandParent: false,
        zIndex: 0
      }
    }
    if (n.type === 'script') {
      return {
        id: n.id,
        type: 'script',
        position: n.position,
        data: { ...n.data, nodeType: n.type },
        style: {
          width: `${n.data.width ?? 460}px`,
          height: `${n.data.height ?? 720}px`
        },
        draggable: true,
        zIndex: 2
      }
    }
    const mapped: Node = {
      id: n.id,
      type: n.type,
      position: n.position,
      data: { ...n.data, nodeType: n.type },
      draggable: true,
      zIndex: n.type === 'imageGen' || n.type === 'videoGen' ? 12 : 1
    }
    if (n.parentGroupId) {
      mapped.parentNode = n.parentGroupId
      mapped.expandParent = false
    }
    return mapped
  })
})

const flowEdges = computed<Edge[]>(() => {
  const graph = project.current?.canvas
  if (!graph) return []
  return graph.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle,
    targetHandle: e.targetHandle,
    type: 'connection',
    animated: false,
    class: 'pipe-edge'
  }))
})

const selected = computed<CanvasNode | null>(() => {
  const id = selectedId.value
  if (!id || !project.current?.canvas) return null
  return project.current.canvas.nodes.find((n) => n.id === id) ?? null
})
const selectedId = ref<string | null>(null)

const studioSidebar = ref<InstanceType<typeof StudioSidebar>>()
const editing = useCanvasEditing({
  select: ids => { selectedId.value = ids.length === 1 ? ids[0] : null },
  add: openAddMenuAtPointer,
  search: async () => { sidebarOpen.value = true; await nextTick(); await studioSidebar.value?.focusNodeSearch() },
  connect: connectNodes,
  deleteEntity: deleteCtxNode
})

const contextActions = useCanvasContextActions({ nodeId: () => ctxMenu.value?.nodeId, point: () => ctxMenu.value?.flow, close: closeCtxMenu, editing })

onMounted(async () => {
  if (!project.current) {
    toast.warn('请先打开项目')
    router.push('/')
    return
  }
  window.addEventListener('wheel', onStudioWheel, { capture: true, passive: false })
  loadAgentWidth()
  const hasPipeline =
    (project.current.subjects?.length || 0) > 0 ||
    (project.current.scenes?.length || 0) > 0 ||
    project.current.shots.length > 0 ||
    Boolean(project.current.canvas?.nodes.some((n) => n.type === 'groupFrame'))
  // 合并模式：项目里还没有剧本 / 人物 / 场景 / 分镜时，画布保持空白，由智能体或右键添加来起头
  const hasGroupFrame = project.current.canvas?.nodes.some((n) => n.type === 'groupFrame')
  if (hasPipeline || hasGroupFrame) {
    project.setCanvas(rebuildCanvasGraph(project.current, Boolean(hasGroupFrame)))
  }
  rebindShotScenes()
  pullStrandedFreeformIntoView()
  await assets.refresh()
  document.querySelectorAll('body > input[type="file"]').forEach((el) => el.remove())
  setCanvasReveal((nodeId, options) => {
    setTimeout(() => {
      if (nodeId && options?.preserveZoom) {
        const zoom = getViewport().zoom
        void fitView({ nodes: [nodeId], minZoom: zoom, maxZoom: zoom, duration: 450 })
      } else if (nodeId) fitView({ nodes: [nodeId], padding: 0.28, duration: 450 })
      else fitView({ padding: 0.2, duration: 400 })
    }, 120)
  })
  setCanvasInspect((nodeId) => {
    selectedId.value = nodeId
    rightOpen.value = true
  })
  setCanvasSelect((nodeId) => {
    selectedId.value = nodeId
  })
  window.addEventListener('keydown', onConnectionKey)
  window.addEventListener('resize', clampAgentToViewport)
})

onUnmounted(() => {
  stopAgentResize()
  window.removeEventListener('wheel', onStudioWheel, true)
  window.removeEventListener('keydown', onConnectionKey)
  cancelClickConnection()
  window.removeEventListener('resize', clampAgentToViewport)
  setCanvasReveal(null)
  setCanvasInspect(null)
  setCanvasSelect(null)
})

function connectNodes(c: Connection) {
  if (c.source === c.target) return
  if (!project.current?.canvas) return
  const source = project.current.canvas.nodes.find((node) => node.id === c.source)
  const target = project.current.canvas.nodes.find((node) => node.id === c.target)
  if (
    source &&
    target &&
    canvasNodeProducesImage(source) &&
    (target.type === 'imageGen' || target.type === 'videoGen') &&
    !appendCanvasReferenceSource(project.current, target.id, source.id)
  ) {
    toast.warn('参考图数量已达到当前模型上限')
    return
  }
  const id = `e-${c.source}-${c.target}-${c.targetHandle || 'in'}`
  const edges = [
    ...project.current.canvas.edges.filter((e) => e.id !== id),
    {
      id,
      source: c.source,
      target: c.target,
      sourceHandle: c.sourceHandle || undefined,
      targetHandle: c.targetHandle || undefined
    }
  ]
  project.setCanvas({ ...project.current.canvas, edges })
}

onConnect(connectNodes)
onNodeDragStart(editing.startDrag)
onNodeDrag(editing.moveDrag)
onNodeDragStop(editing.finishDrag)


function onNodeClick(ev: { node: Node }) {
  selectedId.value = ev.node.id
  if (ev.node.type === 'export' || ev.node.type === 'final') rightOpen.value = true
}

function onCanvasPaneClick(event: MouseEvent) {
  selectedId.value = null
  if (editing.pan.value || !project.current?.canvas) return
  const frame = editing.groupAtPoint(event.clientX, event.clientY)
  if (frame) void editing.choose([frame.id])
}

function openSettings() {
  router.push('/settings')
}

async function relayout() {
  if (!project.current) return
  project.setCanvas(rebuildCanvasGraph(project.current, false))
  setTimeout(() => fitView({ padding: 0.2 }), 40)
}

async function optimizeAllVideoPrompts() {
  const p = project.current
  if (!p?.canvas || optimizingAllVideos.value) return
  const nodes = p.canvas.nodes
    .filter((node) =>
      (node.type === 'shotVideo' || node.type === 'videoGen') &&
      normalizeVideoGenModel(node.data.videoModel) !== 'wan-prime'
    )
    .sort((a, b) => {
      const ai = a.data.shotId ? p.shots.find((shot) => shot.id === a.data.shotId)?.index ?? 9999 : 9999
      const bi = b.data.shotId ? p.shots.find((shot) => shot.id === b.data.shotId)?.index ?? 9999 : 9999
      return ai - bi || a.position.y - b.position.y || a.position.x - b.position.x
    })
  if (!nodes.length) {
    toast.warn('画布上没有可优化的 H3 视频节点')
    return
  }
  optimizingAllVideos.value = true
  const failed: string[] = []
  let processed = 0
  let stoppedByAuth = false
  const concurrency = 5
  try {
    for (let offset = 0; offset < nodes.length; offset += concurrency) {
      const batch = nodes.slice(offset, offset + concurrency)
      optimizeAllProgress.value = `${processed}/${nodes.length} · 本批 ${batch.length} 个`
      const results = await Promise.all(
        batch.map(async (node) => {
          try {
            if (node.type === 'shotVideo' && node.data.shotId) {
              const shot = project.current?.shots.find((item) => item.id === node.data.shotId)
              if (!shot) throw new Error('找不到分镜')
              await optimizeShotVideoPrompt(shot)
            } else {
              await optimizeFreeformVideoPrompt(node.id)
            }
            return { node, ok: true as const, message: '' }
          } catch (error) {
            return {
              node,
              ok: false as const,
              message: error instanceof Error ? error.message : String(error)
            }
          }
        })
      )
      processed += batch.length
      optimizeAllProgress.value = `${processed}/${nodes.length}`
      for (const result of results) {
        if (result.ok) continue
        failed.push(`${result.node.data.label || result.node.id}：${result.message}`)
        if (/401|鉴权失败|Authentication Fails|invalid.*api.?key/i.test(result.message)) {
          stoppedByAuth = true
        }
      }
      if (stoppedByAuth) {
        const authMessage = results.find((result) => !result.ok && /401|鉴权失败|Authentication Fails|invalid.*api.?key/i.test(result.message))?.message || ''
        toast.error(`语言模型鉴权失败，当前批完成后已停止队列。${authMessage}`, 12000)
        break
      }
    }
    if (failed.length) {
      const succeeded = processed - failed.length
      const stopped = processed < nodes.length ? `；已停止，剩余 ${nodes.length - processed} 个未请求` : ''
      toast.warn(`已完成 ${succeeded}/${nodes.length} 个；${failed.length} 个失败${stopped}：${failed.slice(0, 2).join('；')}`, 10000)
    } else {
      toast.success(`已按每批最多 ${concurrency} 个完成全部 ${nodes.length} 个视频提示词`)
    }
  } finally {
    optimizingAllVideos.value = false
    optimizeAllProgress.value = ''
  }
}

function eventFromCtx(
  ev: MouseEvent | TouchEvent | { event: MouseEvent | TouchEvent }
): MouseEvent | TouchEvent | null {
  if (ev instanceof MouseEvent || ev instanceof TouchEvent) return ev
  if (ev && typeof ev === 'object' && ev.event) return ev.event
  return null
}

function pointerClient(ev: MouseEvent | TouchEvent): { x: number; y: number } | null {
  if (ev instanceof MouseEvent) return { x: ev.clientX, y: ev.clientY }
  const t = ev.changedTouches[0] || ev.touches[0]
  if (!t) return null
  return { x: t.clientX, y: t.clientY }
}

function canDuplicate(id: string | null | undefined): boolean {
  if (!id) return false
  const n = project.current?.canvas?.nodes.find((x) => x.id === id)
  return n?.type === 'imageGen' || n?.type === 'videoGen'
}

function canDeleteNode(id: string | null | undefined): boolean {
  if (!id) return false
  const n = project.current?.canvas?.nodes.find((x) => x.id === id)
  if (!n) return false
  return n.type !== 'groupFrame' && n.type !== 'export' && n.type !== 'final'
}

function duplicateNode(id: string | null | undefined) {
  if (!id) {
    toast.warn('请先选中要复制的图片或视频节点')
    return
  }
  const nid = project.duplicateCanvasNode(id)
  closeCtxMenu()
  if (!nid) {
    toast.warn('只能复制图片或视频节点')
    return
  }
  selectedId.value = nid
  toast.success('已复制节点')
  nextTick(() => {
    fitView({ nodes: [nid], padding: 0.35, duration: 280 })
  })
}

function deleteCtxNode(id: string | null | undefined, confirmed = false) {
  if (!id || !project.current) return
  const n = project.current.canvas?.nodes.find((x) => x.id === id)
  if (!n || !canDeleteNode(id)) {
    closeCtxMenu()
    return
  }
  if (!confirmed && !confirm('删除这个节点？')) {
    closeCtxMenu()
    return
  }
  const p = project.current
  if (n.type === 'subject' || n.type === 'subjectProps') {
    const sid = n.data.subjectId
    if (sid) {
      project.setSubjects((p.subjects ?? []).filter((s) => s.id !== sid))
      project.setShots(
        p.shots.map((shot) => ({
          ...shot,
          subjectIds: (shot.subjectIds ?? []).filter((item) => item !== sid)
        }))
      )
      project.setCanvas(rebuildCanvasGraph(project.current, true))
    } else {
      project.removeCanvasNode(id)
    }
  } else if (n.type === 'scene' || n.type === 'sceneProps') {
    const scid = n.data.sceneId
    if (scid) {
      project.setScenes((p.scenes ?? []).filter((s) => s.id !== scid))
      project.setShots(p.shots.map((shot) => (shot.sceneId === scid ? { ...shot, sceneId: undefined } : shot)))
      project.setCanvas(rebuildCanvasGraph(project.current, true))
    } else {
      project.removeCanvasNode(id)
    }
  } else if (n.type === 'shotImage' || n.type === 'shotBoard' || n.type === 'shotVideo' || n.type === 'audio') {
    const shotId = n.data.shotId
    if (shotId) {
      project.setShots(p.shots.filter((shot) => shot.id !== shotId).map((shot, index) => ({ ...shot, index })))
      project.setCanvas(rebuildCanvasGraph(project.current, true))
    } else {
      project.removeCanvasNode(id)
    }
  } else {
    project.removeCanvasNode(id)
  }
  if (selectedId.value === id) selectedId.value = null
  closeCtxMenu()
  toast.success('已删除节点')
}


function openSelectionContextMenu(ev: { event: NodeMouseEvent['event']; nodes: NodeMouseEvent['node'][] }) {
  const pt = pointerClient(ev.event)
  if (!pt || !ev.nodes.length) return
  const point = screenToFlowCoordinate(pt)
  const target = ev.nodes.find(n => point.x >= n.computedPosition.x && point.y >= n.computedPosition.y && point.x <= n.computedPosition.x + n.dimensions.width && point.y <= n.computedPosition.y + n.dimensions.height) || ev.nodes[0]
  void openCtxMenu({ event: ev.event, node: target })
}

async function openCtxMenu(ev: MouseEvent | NodeMouseEvent) {
  const event = eventFromCtx(ev)
  if (!event) return
  event.preventDefault()
  event.stopPropagation()
  const pt = pointerClient(event)
  if (!pt) return
  const flow = screenToFlowCoordinate({ x: pt.x, y: pt.y })
  const clickedId = 'node' in ev && ev.node ? String(ev.node.id) : editing.groupAtPoint(pt.x, pt.y)?.id
  if (clickedId) {
    // Retain a multi-selection only when the clicked item belongs to it.
    if (!getSelectedNodes.value.some(n => n.id === clickedId)) await editing.choose([clickedId])
    selectedId.value = getSelectedNodes.value.length === 1 ? clickedId : null
  }
  if (clickedId) {
    ctxMenu.value = { x: pt.x, y: pt.y, flow, nodeId: clickedId, onNode: true }
  } else {
    showAddMenu(pt, flow)
  }
}

function pasteAtContext() {
  const point = ctxMenu.value?.flow
  closeCtxMenu()
  void editing.paste(point)
}

function closeCtxMenu() {
  ctxMenu.value = null
}

function pullStrandedFreeformIntoView() {
  const canvas = project.current?.canvas
  if (!canvas) return
  const rescued = rescueStrandedFreeformNodes(canvas.nodes)
  if (!rescued) return
  project.setCanvas({ ...canvas, nodes: rescued })
}

function addFreeform(type: 'imageGen' | 'videoGen') {
  if (!project.current) return
  pullStrandedFreeformIntoView()
  const all = project.current.canvas?.nodes ?? []
  const count = all.filter((n) => n.type === type).length + 1
  const id = `${type}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
  const sourceId = ctxMenu.value?.onNode ? ctxMenu.value.nodeId : undefined
  const source = sourceId ? all.find((node) => node.id === sourceId) : undefined
  const inheritsSource = canvasNodeProducesImage(source)
  const pos = nextFreeformPosition(all, {
    source,
    click: ctxMenu.value?.flow
  })
  project.addCanvasNode({
    id,
    type,
    position: { x: pos.x, y: pos.y },
    data: {
      label: type === 'imageGen' ? `图片 ${count}` : `视频 ${count}`,
      prompt: '',
      referenceAssetIds: [],
      referenceSourceNodeIds: inheritsSource && sourceId ? [sourceId] : [],
      duration: 8,
      aspectRatio: project.current.settings.aspectRatio,
      ...(type === 'videoGen' ? { videoModel: 'h3' as const } : {})
    },
    status: 'idle'
  })
  if (inheritsSource && sourceId && project.current.canvas) {
    const edge = {
      id: `e-${sourceId}-${id}-in`,
      source: sourceId,
      target: id,
      sourceHandle: 'out',
      targetHandle: 'in'
    }
    project.setCanvas({
      ...project.current.canvas,
      edges: [...project.current.canvas.edges.filter((item) => item.id !== edge.id), edge]
    })
  }
  selectedId.value = id
  closeCtxMenu()
  toast.success(type === 'videoGen' ? '已添加视频节点' : '已添加图片节点')
  nextTick(() => {
    fitView({ nodes: [id], padding: 0.35, duration: 280 })
  })
}

function addScriptNode() {
  if (!project.current) return
  const existing = project.current.canvas?.nodes.find((n) => n.type === 'script')
  if (existing) {
    selectedId.value = existing.id
    closeCtxMenu()
    toast.warn('已经有剧本节点')
    return
  }
  const pos = ctxMenu.value?.flow ?? { x: 120, y: 120 }
  project.addCanvasNode({
    id: 'script',
    type: 'script',
    position: pos,
    data: {
      label: project.current.script?.topic || project.current.name || '剧本',
      width: 460,
      height: 720,
      kind: 'scriptDoc'
    },
    status: 'idle'
  })
  selectedId.value = 'script'
  closeCtxMenu()
}

function addPipelineEntity(kind: 'subject' | 'scene' | 'shot') {
  if (!project.current) return
  const flow = ctxMenu.value?.flow ?? { x: 120, y: 120 }
  const before = new Set((project.current.canvas?.nodes ?? []).map((n) => n.id))
  const stamp = Date.now().toString(36)
  let selectId = ''
  if (kind === 'subject') {
    const n = (project.current.subjects ?? []).length + 1
    const id = `sub_${stamp}`
    project.setSubjects([
      ...(project.current.subjects ?? []),
      { id, name: `角色 ${n}`, kind: 'person', description: '' }
    ])
    selectId = `subject:${id}`
  } else if (kind === 'scene') {
    const n = (project.current.scenes ?? []).length + 1
    const id = `scn_${stamp}`
    project.setScenes([
      ...(project.current.scenes ?? []),
      { id, name: `场景 ${n}`, description: '' }
    ])
    selectId = `scene:${id}`
  } else {
    const shots = project.current.shots
    const n = shots.length + 1
    const id = `shot_${stamp}`
    const shot: Shot = {
      id,
      index: shots.length,
      title: `镜头 ${n}`,
      visualPrompt: '',
      audioDescription: '',
      voiceover: '',
      duration: project.current.settings.defaultShotDuration || 5,
      cameraMovement: 'static',
      status: 'draft'
    }
    project.setShots([...shots, shot])
    selectId = `shotImage:${id}`
  }
  project.setCanvas(rebuildCanvasGraph(project.current, true))
  const groupId = kind === 'subject' ? 'group-subjects' : kind === 'scene' ? 'group-scenes' : 'group-shots'
  if (project.current.canvas && !before.has(groupId)) {
    project.setCanvas({
      ...project.current.canvas,
      nodes: project.current.canvas.nodes.map((node) =>
        node.id === groupId ? { ...node, position: flow } : node
      )
    })
  }
  selectedId.value = selectId
  closeCtxMenu()
}

async function openFolder() {
  const dir = project.current?.folderPath
  if (dir && isDesktop()) await desktop().openPath(dir)
}

function goClassic() {
  router.push('/script')
}
</script>

<template>
  <div ref="studioRoot" class="studio" :class="{ 'agent-is-docked': agentOpen && agentDocked }" :style="{ '--agent-dock-width': `${agentWidth}px`, '--studio-sidebar-width': `${viewportWidth > 760 ? sidebarWidth : 0}px`, '--agent-floating-width': `${agentWidth}px` }" @pointerdown="closeWorkspaceMenu">
    <StudioSidebar
      ref="studioSidebar"
      v-show="sidebarOpen"
      :key="project.current?.id"
      :selected-id="selectedId"
      @select="focusSidebarNode"
      @add="openAddMenu"
      @home="router.push('/')"
    />
    <CanvasGuide
      v-if="guideOpen"
      :sidebar-width="sidebarWidth"
      :right-width="(agentOpen && agentDocked ? agentWidth : 0) + (rightOpen ? 300 : 0)"
      @done="dismissGuide"
    />
    <div class="body">
      <div ref="flowWrap" class="flow-wrap" :class="{ 'agent-floating-open': agentOpen && !agentDocked, 'hand-tool': editing.pan.value, 'group-background-hover': editing.groupBackgroundHover.value, 'group-background-dragging': editing.groupBackgroundDragging.value }" @pointerdown.capture="rememberCanvasPointer($event); editing.startGroupBackgroundDrag($event)" @pointermove.capture="rememberCanvasPointer($event); editing.moveGroupBackgroundDrag($event)" @pointerup.capture="editing.endGroupBackgroundDrag" @pointercancel.capture="editing.endGroupBackgroundDrag" @pointerleave="canvasPointer = null; editing.groupBackgroundHover.value = false" @mousemove="moveClickConnection" @click.capture="onCanvasClickCapture">
        <header class="bar" aria-label="工作区操作">
          <button class="icon-btn" type="button" title="设置" aria-label="设置" @click="openSettings"><CanvasToolbarIcon name="settings" /></button>
          <details ref="workspaceMenu" class="workspace-menu" @keydown.esc.stop.prevent="workspaceMenu && (workspaceMenu.open = false)">
            <summary class="icon-btn" title="更多工作区操作" aria-label="更多工作区操作"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg></summary>
            <div class="workspace-menu-panel" @click="workspaceMenu && (workspaceMenu.open = false)">
              <p class="workspace-menu-title" :title="project.current?.name">{{ project.current?.name || '当前项目' }}</p>
              <button type="button" @click="router.push('/scripts')"><CanvasToolbarIcon name="script" :size="16" />剧本库</button>
              <button type="button" @click="router.push({ name: 'generation-stats', query: { project: project.current?.id, returnTo: 'studio' } })"><CanvasToolbarIcon name="steps" :size="16" />生成统计</button>
              <button type="button" @click="goClassic"><CanvasToolbarIcon name="steps" :size="16" />经典步骤</button>
              <button type="button" :disabled="optimizingAllVideos" @click="optimizeAllVideoPrompts"><CanvasToolbarIcon name="sparkles" :size="16" />{{ optimizingAllVideos ? `优化中 ${optimizeAllProgress}` : '一键优化全部视频提示词' }}</button>
              <button type="button" @click="relayout"><CanvasToolbarIcon name="layout" :size="16" />重整布局</button>
              <button v-if="isDesktop()" type="button" @click="openFolder"><CanvasToolbarIcon name="folder" :size="16" />打开文件夹</button>
              <button type="button" @click="guideOpen = true"><span class="guide-mark">?</span>新手引导</button>
              <button type="button" @click="router.push('/')"><CanvasToolbarIcon name="back" :size="16" />返回项目</button>
              <p v-if="project.current?.folderPath" class="workspace-path" :title="project.current.folderPath">{{ project.current.folderPath }}</p>
            </div>
          </details>
        </header>
        <VueFlow
          :nodes="flowNodes"
          :edges="flowEdges"
          :edge-types="edgeTypes"
          :connect-on-click="true"
          :selection-key-code="true"
          :selection-mode="SelectionMode.Partial"
          :multi-selection-key-code="['Shift', 'Control', 'Meta']"
          :pan-on-drag="editing.pan.value ? true : [1]"
          :nodes-draggable="!editing.pan.value"
          :node-drag-threshold="nodeDragThreshold"
          :nodes-connectable="!editing.pan.value"
          :pan-on-scroll="true"
          :zoom-on-scroll="false"
          :zoom-on-double-click="false"
          :delete-key-code="null"
          @selection-end="editing.selectionEnd"
          @edges-change="onEdgesChange"
          :node-types="(nodeTypes as any)"
          :default-viewport="canvasViewport.initialViewport"
          @pane-ready="canvasViewport.ready"
          :min-zoom="MIN_CANVAS_ZOOM"
          :max-zoom="MAX_CANVAS_ZOOM"
          :fit-view-on-init="false"
          @node-click="onNodeClick"
          @edge-click="selectedId = null"
          @pane-click="onCanvasPaneClick"
          @pane-context-menu="openCtxMenu"
          @node-context-menu="openCtxMenu"
          @selection-context-menu="openSelectionContextMenu"
        >
          <Background :gap="22" color="rgba(255,255,255,0.08)" />
        </VueFlow>
        <div v-if="editing.showToolbar.value && !ctxMenu" class="selection-toolbar nodrag nopan nokey" :style="editing.toolbarStyle.value" role="toolbar" aria-label="所选节点操作" @pointerdown.stop @mousedown.stop @click.stop>
          <span class="selection-count">{{ editing.selectedGroup.value ? '组合' : `${editing.selectedIds.value.length} 个节点` }}</span>
          <button v-if="!editing.selectedGroup.value" type="button" title="打组 Ctrl/Alt+G" @click="editing.execute('group')">▱ 打组</button>
          <button v-if="editing.selectedGroup.value" type="button" title="解组 Ctrl/Alt+Shift+G" @click="editing.execute('ungroup')">▱ 解组</button>
          <button type="button" title="复制节点和连线 Ctrl+D" @click="editing.execute('duplicate')">❐ 复制</button>
          <button type="button" :disabled="editing.generating.value" title="生成所选节点 Ctrl+Enter" @click="editing.execute('generate')">▷ {{ editing.generating.value ? '生成中' : '生成' }}</button>
          <button type="button" title="整理所选节点 Alt+Shift+F" @click="editing.execute('arrange')">▦ 整理</button>
          <button type="button" class="selection-delete" title="删除 Del" @click="editing.execute('delete')">删除</button>
        </div>
        <CanvasShortcutPanel v-if="editing.shortcutsOpen.value" @close="editing.shortcutsOpen.value = false" @command="editing.execute" />
        <div v-if="!project.current?.canvas?.nodes.length" class="empty-hint">
          点击右下角 AI 助手开始创作，或点击 ＋ / 在画布空白处右键添加节点
        </div>
        <div class="canvas-bottom-tools" role="toolbar" aria-label="画布工具">
          <div class="canvas-tool-strip">
          <button class="icon-btn sidebar-toggle" type="button" :aria-pressed="sidebarOpen" :aria-expanded="sidebarOpen" aria-controls="studio-project-sidebar" :title="sidebarOpen ? '收起节点和资源面板' : '打开节点和资源面板'" aria-label="节点和资源面板" @click="toggleSidebar"><CanvasToolbarIcon name="panel" /></button>
          <span class="tool-divider" />
          <button class="icon-btn add-tool" type="button" title="添加节点" aria-label="添加节点" @click="openAddMenu"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18M3 12h18" /></svg></button>
          <span class="tool-divider" />
          <button class="icon-btn tool-select" type="button" :aria-pressed="editing.tool.value === 'select'" title="选择 / 框选 V" aria-label="选择工具" @click="editing.execute('select')"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="m5 3 14 9-7 1-3 7Z"/></svg></button>
          <button class="icon-btn tool-hand" type="button" :aria-pressed="editing.tool.value === 'hand'" title="抓手 H / 按住Space" aria-label="抓手工具" @click="editing.execute('hand')"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 12V6a1.5 1.5 0 0 1 3 0v5-7a1.5 1.5 0 0 1 3 0v7-6a1.5 1.5 0 0 1 3 0v7-4a1.5 1.5 0 0 1 3 0v7c0 5-3 7-7 7-3 0-5-2-7-5l-2-3a1.5 1.5 0 0 1 2-2l2 2Z"/></svg></button>
          <button class="icon-btn" type="button" title="适应全部节点" aria-label="适应全部节点" @click="fitView({ padding: 0.2, duration: 300 })"><CanvasToolbarIcon name="expand" /></button>
          <button class="icon-btn shortcut-toggle" type="button" :aria-expanded="editing.shortcutsOpen.value" title="画布快捷键" aria-label="画布快捷键" @click="editing.shortcutsOpen.value = !editing.shortcutsOpen.value"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="2" y="5" width="20" height="14" rx="3"/><path d="M6 9h1m4 0h1m4 0h1M6 12h1m4 0h1m4 0h1M7 16h10"/></svg></button>
          <button class="icon-btn" type="button" title="画布使用帮助" aria-label="画布使用帮助" @click="guideOpen = true"><span class="guide-mark">?</span></button>
          </div>
        </div>
        <div class="canvas-zoom" role="toolbar" aria-label="画布缩放">
          <button class="icon-btn" type="button" aria-label="缩小画布" title="缩小画布" :disabled="zoomPercent <= 20" @click="zoomOut({ duration: 150 })">−</button>
          <button class="zoom-value" type="button" aria-label="重置画布为100%" title="重置为100%" @click="setViewport({ ...getViewport(), zoom: 1 }, { duration: 200 })">{{ zoomPercent }}%</button>
          <button class="icon-btn" type="button" aria-label="放大画布" title="放大画布" :disabled="zoomPercent >= 200" @click="zoomIn({ duration: 150 })">＋</button>
        </div>
        <button v-show="!agentOpen" ref="agentToggle" class="agent-toggle" :class="{ on: agentOpen, busy: agentBusy }" type="button" :aria-expanded="agentOpen" aria-controls="studio-agent-dialog" :aria-label="agentOpen ? '收起 AI 助手' : '打开 AI 助手'" @click="toggleAgent">
          <AgentOrb :size="28" variant="launcher" :active="agentOpen" :busy="agentBusy" :paused="agentOpen" /><span class="agent-tooltip">剧流 AI 导演</span><i v-if="agentBusy" class="activity-dot" />
        </button>
        <div ref="agentFloatHost" class="agent-float-host" />
      </div>
      <CanvasContextDialog v-if="contextActions.subjectDraft.value || contextActions.verification.value" :draft="contextActions.subjectDraft.value" :verification="contextActions.verification.value" :busy="contextActions.busy.value" @close="contextActions.subjectDraft.value = undefined; contextActions.verification.value = undefined" @submit="contextActions.saveSubject" />
      <Teleport to="body">
        <CanvasNodeContextMenu v-if="ctxMenu?.onNode && contextActions.node.value" :key="ctxMenu.nodeId" :x="ctxMenu.x" :y="ctxMenu.y" :label="contextActions.group.value ? '组合' : contextActions.node.value.type === 'videoGen' ? '视频节点' : '图片节点'" :rating="contextActions.rating.value" :show-rating="contextActions.group.value || ['imageGen','videoGen'].includes(contextActions.node.value.type)" :busy="contextActions.busy.value" :items="contextActions.items.value" @close="closeCtxMenu" @action="contextActions.action" @rate="contextActions.rate" />
        <div
          v-if="ctxMenu && !ctxMenu.onNode"
          class="ctx-mask"
          @click="closeCtxMenu"
          @contextmenu.prevent="openCtxMenu"
        />
        <div
          v-if="ctxMenu && !ctxMenu.onNode"
          ref="blankContextMenu"
          class="ctx-menu"
          :style="{ left: `${ctxMenu.x}px`, top: `${ctxMenu.y}px` }"
          @mousedown.stop
        >
          <button type="button" @mousedown.prevent.stop="addFreeform('imageGen')">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
              <path d="M8 13.5 10.2 11l3.3 3.2 2-1.8L20 16" />
              <circle cx="9" cy="9" r="1.1" />
            </svg>
            {{ ctxMenu.nodeId ? '追加图片节点' : '添加图片节点' }}
          </button>
          <button type="button" @mousedown.prevent.stop="addFreeform('videoGen')">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
              <path d="M10 9.5v5l5-2.5-5-2.5Z" />
            </svg>
            {{ ctxMenu.nodeId ? '追加视频节点' : '添加视频节点' }}
          </button>
          <div class="ctx-sep" />
          <button type="button" @mousedown.prevent.stop="addScriptNode">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M7 4.5h7l4 4V19.5H7V4.5Z" />
              <path d="M14 4.5V9h4.5" />
              <path d="M9.5 12.5h5M9.5 15.5h5" />
            </svg>
            {{ ctxMenu.nodeId ? '追加剧本节点' : '添加剧本节点' }}
          </button>
          <button type="button" @mousedown.prevent.stop="addPipelineEntity('subject')">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="8" r="2.6" />
              <path d="M6.5 18.5c.8-3.2 2.8-4.8 5.5-4.8s4.7 1.6 5.5 4.8" />
            </svg>
            {{ ctxMenu.nodeId ? '追加角色节点' : '添加角色节点' }}
          </button>
          <button type="button" @mousedown.prevent.stop="addPipelineEntity('scene')">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 16.5 9 11l3.2 3.2 2.3-2.2L20 16.8" />
              <path d="M4.5 6.5h15v12h-15z" />
              <path d="M4.5 18.5h15" />
            </svg>
            {{ ctxMenu.nodeId ? '追加场景节点' : '添加场景节点' }}
          </button>
          <button type="button" @mousedown.prevent.stop="addPipelineEntity('shot')">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="4" y="6.5" width="16" height="11" rx="1.5" />
              <path d="M8 6.5v11M16 6.5v11M4 10.5h16M4 13.5h16" />
            </svg>
            {{ ctxMenu.nodeId ? '追加分镜节点' : '添加分镜节点' }}
          </button>
          <div class="ctx-sep" />
          <button type="button" @click="pasteAtContext">粘贴节点 <span style="margin-left:auto;color:var(--color-text-3);font-size:11px">Ctrl+V</span></button>
          <template v-if="ctxMenu.onNode && (canDuplicate(ctxMenu.nodeId) || canDeleteNode(ctxMenu.nodeId))">
            <div class="ctx-sep" />
            <button
              v-if="canDuplicate(ctxMenu.nodeId)"
              type="button"
              @mousedown.prevent.stop="duplicateNode(ctxMenu.nodeId)"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <rect x="8" y="8" width="11" height="11" rx="1.5" />
                <path d="M6 16V5.5A1.5 1.5 0 0 1 7.5 4H16" />
              </svg>
              复制此节点
            </button>
            <button
              v-if="canDeleteNode(ctxMenu.nodeId)"
              type="button"
              class="danger"
              @mousedown.prevent.stop="deleteCtxNode(ctxMenu.nodeId)"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 7.5h14" />
                <path d="M10 7.5V5.5h4v2" />
                <path d="M8 7.5V18a1.5 1.5 0 0 0 1.5 1.5h5A1.5 1.5 0 0 0 16 18V7.5" />
                <path d="M10.5 11v5M13.5 11v5" />
              </svg>
              删除此节点
            </button>
          </template>
        </div>
      </Teleport>
      <aside v-if="rightOpen" class="dock">
        <div class="dock-title"><span>节点</span><button class="icon-btn" type="button" title="收起节点检查器" aria-label="收起节点检查器" @click="rightOpen = false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg></button></div>
        <NodeInspector :node="selected" />
      </aside>
    </div>
    <div ref="agentDockHost" v-show="agentOpen && agentDocked" class="agent-dock-host" />
    <Teleport v-if="agentFloatHost && agentDockHost" :to="agentDocked ? agentDockHost : agentFloatHost">
        <section
          v-show="agentOpen"
          id="studio-agent-dialog"
          class="agent-shell"
          :class="{ resizing: resizingAgent, docked: agentDocked }"
          :style="{ width: `${agentWidth}px` }"
          role="region"
          aria-label="AI 助手对话"
        >
          <AgentChat :key="project.current?.id" :selected-node="selected" :active="agentOpen" :docked="agentDocked" @dock="toggleAgentDock" @close="closeAgent" @activity="agentBusy = $event" />
          <div
            class="agent-resizer"
            role="separator"
            aria-label="调整 AI 对话框宽度"
            aria-orientation="vertical"
            :aria-valuemin="Math.min(AGENT_MIN_WIDTH, maxAgentWidth())"
            :aria-valuemax="maxAgentWidth()"
            :aria-valuenow="agentWidth"
            tabindex="0"
            title="拖动左边缘调整对话框宽度"
            @pointerdown="startAgentResize"
            @keydown.left.prevent="nudgeAgentWidth(24)"
            @keydown.right.prevent="nudgeAgentWidth(-24)"
            @dblclick="agentWidth = clampAgentWidth(440); persistAgentWidth()"
          />
        </section>
    </Teleport>
  </div>
</template>

<style scoped>
.studio { height:100%; width:100%; display:grid; grid-template-columns:var(--studio-sidebar-width,300px) minmax(0,1fr) 0px; grid-template-rows:minmax(0,1fr); position:relative; background:var(--color-bg-0); min-width:0; min-height:0; overflow:hidden; }
.studio.agent-is-docked { grid-template-columns:var(--studio-sidebar-width,300px) minmax(0,1fr) var(--agent-dock-width); }
.studio > .studio-sidebar { grid-column:1; grid-row:1; }
.studio > .body { grid-column:2; grid-row:1; min-width:0; }
.agent-dock-host { grid-column:3; grid-row:1; position:relative; min-width:0; min-height:0; border-left:1px solid var(--color-border-strong); background:var(--color-bg-1); }
.bar { position:absolute; top:12px; z-index:10; display:flex; align-items:center; gap:3px; padding:3px; border:1px solid var(--color-border); border-radius:10px; background:color-mix(in srgb,var(--color-bg-1) 94%,transparent); box-shadow:var(--shadow-sm); backdrop-filter:blur(14px); }
.bar { right:12px; }
.bar > .icon-btn,.workspace-menu > summary { width:28px; height:28px; }
.workspace-menu { position:relative; }
.workspace-menu > summary { list-style:none; }
.workspace-menu > summary::-webkit-details-marker { display:none; }
.workspace-menu[open] > summary { background:var(--color-fill-hover); }
.workspace-menu-panel { position:absolute; right:0; top:calc(100% + 9px); width:min(248px,calc(100vw - 36px)); box-sizing:border-box; padding:6px; border:1px solid var(--color-border-strong); border-radius:12px; background:var(--color-bg-1); box-shadow:var(--shadow-lg); max-height:calc(100dvh - 80px); overflow:auto; }
.workspace-menu-panel > button { width:100%; display:flex; align-items:center; gap:10px; border:0; border-radius:7px; padding:9px; color:var(--color-text-2); background:transparent; font:inherit; font-size:12px; text-align:left; cursor:pointer; }
.workspace-menu-panel > button:hover { background:var(--color-fill-hover); color:var(--color-text-1); }
.workspace-menu-panel > button:disabled { opacity:.5; cursor:wait; }
.workspace-menu-title,.workspace-path { padding:7px 9px; margin:0; color:var(--color-text-4); font-size:11px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.workspace-menu-title { border-bottom:1px solid var(--color-border); margin-bottom:4px; color:var(--color-text-2); }
.icon-btn { width:28px; height:28px; }
.bar .dim {
  color: var(--color-text-4);
  font-size: 11px;
}
.bar .path {
  max-width: 160px;
  min-width: 0;
  flex-shrink: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.spacer {
  flex: 1;
}
.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  margin: 0;
  padding: 0;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--color-text-2);
  flex-shrink: 0;
  cursor: pointer;
  -webkit-app-region: no-drag;
  app-region: no-drag;
}
.icon-btn svg {
  width: 17px;
  height: 17px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.7;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.icon-btn:hover {
  background: var(--color-bg-3);
  color: var(--color-text-1);
}
.icon-btn.on {
  background: var(--color-bg-3);
  color: var(--color-accent);
}
.empty-hint {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  color: var(--color-text-4);
  font-size: 13px;
  padding: 24px;
  text-align: center;
  letter-spacing: 0.04em;
}
.ctx-mask {
  position: fixed;
  inset: 0;
  z-index: 9000;
}
.ctx-menu {
  position: fixed;
  z-index: 9001;
  min-width: 200px;
  padding: 6px;
  border-radius: 10px;
  border: 1px solid var(--color-border);
  background: var(--color-bg-1);
  box-shadow: var(--shadow-lg);
}
.ctx-menu button {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  margin: 0;
  padding: 7px 10px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--color-text-1);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}
.ctx-menu button svg {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.7;
  stroke-linecap: round;
  stroke-linejoin: round;
  color: var(--color-text-3);
}
.ctx-menu button:hover {
  background: var(--color-fill);
}
.ctx-menu button:hover svg {
  color: var(--color-accent);
}
.ctx-menu button.danger {
  color: var(--color-error, #f87171);
}
.ctx-menu button.danger svg {
  color: var(--color-error, #f87171);
}
.ctx-menu button.danger:hover {
  background: rgba(248, 113, 113, 0.12);
}
.ctx-sep {
  height: 1px;
  margin: 4px 6px;
  background: var(--color-border);
}
.dock {
  width: 300px;
  flex-shrink: 0;
  border-left: 1px solid var(--color-border);
  background: var(--color-bg-1);
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.dock-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
  font-size: 12px;
  padding: 10px;
  color: var(--color-text-1);
  font-weight: 600;
}
.dock :deep(.insp) {
  width: auto;
  border-left: none;
  flex: 1;
  min-height: 0;
}
.body {
  flex: 1;
  display: flex;
  min-height: 0;
  position: relative;
}
.guide-mark {
  display: grid;
  place-items: center;
  width: 17px;
  height: 17px;
  border: 1.4px solid currentColor;
  border-radius: 50%;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
}
.canvas-bottom-tools { position:absolute; bottom:max(12px,env(safe-area-inset-bottom)); left:50%; transform:translateX(-50%); display:flex; align-items:center; max-width:calc(100% - 24px); z-index:9; }
.canvas-tool-strip { display:flex; align-items:center; gap:3px; padding:3px; border:1px solid var(--color-border-strong); border-radius:11px; background:color-mix(in srgb,var(--color-bg-1) 94%,transparent); box-shadow:0 4px 20px #0003,0 1px 2px #0002; backdrop-filter:blur(14px); }
.canvas-tool-strip .icon-btn { width:28px; height:28px; border-radius:7px; }
.tool-divider { width:1px; height:16px; background:var(--color-border); flex-shrink:0; margin-inline:1px; }
.add-tool { background:var(--color-text-1); color:var(--color-bg-1); }
.add-tool:hover { background:var(--color-text-2); color:var(--color-bg-1); }
.agent-toggle { position:absolute; right:max(12px,env(safe-area-inset-right)); bottom:max(12px,env(safe-area-inset-bottom)); z-index:9; display:grid; place-items:center; flex-shrink:0; width:40px; height:40px; padding:0; border:1px solid #94d6dd36; border-radius:50%; background:linear-gradient(145deg,#253238,#151c23 70%); box-shadow:inset 0 1px 1px #dbffff12,0 4px 18px #0005; isolation:isolate; cursor:pointer; transition:box-shadow .25s,transform .25s,border-color .25s; }
/* Soft glow breathes outside the button while a fine highlight travels around its rim. */
.agent-toggle::before,.agent-toggle::after { content:''; position:absolute; border-radius:50%; pointer-events:none; }
.agent-toggle::before { inset:-9px; z-index:-1; background:radial-gradient(circle,#32e8dc38 16%,#1ccfdd20 42%,transparent 70%); opacity:.45; animation:agent-launcher-breathe 4.8s ease-in-out infinite; }
.agent-toggle::after { inset:-1px; padding:1px; background:conic-gradient(from 0deg,transparent 0deg,#87fff257 35deg,#d3fffbe6 64deg,#43e7ec87 84deg,transparent 120deg,transparent 215deg,#8da9ff75 255deg,transparent 292deg); -webkit-mask:linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0); mask:linear-gradient(#fff 0 0) content-box,linear-gradient(#fff 0 0); -webkit-mask-composite:xor; mask-composite:exclude; opacity:.7; animation:agent-launcher-orbit 9s linear infinite; }
.agent-toggle:hover,.agent-toggle:focus-visible { transform:translateY(-2px) scale(1.06); border-color:#80f4e880; box-shadow:inset 0 1px 1px #dbffff26,0 5px 22px #19cbd438,0 0 18px #48e8e01f; }
.agent-toggle:hover::after,.agent-toggle:focus-visible::after { opacity:1; animation-duration:4.5s; }
.agent-toggle:active { transform:translateY(0) scale(.96); transition-duration:.12s; }
.agent-toggle.busy { border-color:#74f4e18c; }
.agent-toggle.busy::before { animation-duration:2.4s; }
.agent-toggle.busy::after { opacity:1; animation-duration:2.6s; }
.agent-toggle[aria-expanded=true]::before,.agent-toggle[aria-expanded=true]::after { animation-play-state:paused; }
.agent-toggle:focus-visible { outline:2px solid #8bf7ee; outline-offset:5px; }
@keyframes agent-launcher-breathe { 0%,100% { transform:scale(.86); opacity:.35; } 50% { transform:scale(1.15); opacity:.8; } }
@keyframes agent-launcher-orbit { to { transform:rotate(360deg); } }
.agent-tooltip { position:absolute; bottom:calc(100% + 10px); right:0; transform:translateY(4px); padding:6px 10px; border:1px solid var(--color-border); border-radius:8px; background:var(--color-bg-1); color:var(--color-text-1); font-size:11px; font-weight:500; white-space:nowrap; opacity:0; visibility:hidden; pointer-events:none; transition:opacity .15s,transform .15s; box-shadow:0 4px 12px #0003; }
.agent-toggle:hover .agent-tooltip,.agent-toggle:focus-visible .agent-tooltip { opacity:1; visibility:visible; transform:translateY(0); }
.activity-dot { position:absolute; right:0; top:1px; width:7px; height:7px; border:2px solid var(--color-bg-1); border-radius:50%; background:#55e6c1; }
.agent-shell { position:absolute; right:max(12px,env(safe-area-inset-right)); bottom:max(12px,env(safe-area-inset-bottom)); box-sizing:border-box; height:min(520px,calc(100% - 72px)); max-width:calc(100% - 24px); min-width:0; min-height:0; z-index:8; border:1px solid var(--color-border-strong); border-radius:24px; background:var(--color-bg-1); box-shadow:0 12px 56px #0005,0 1px 4px #0003; }
.agent-shell.docked { position:relative; inset:auto; width:100% !important; max-width:none; height:100%; border:0; border-radius:0; box-shadow:none; }
.agent-shell :deep(.agent) { width:100%; height:100%; border:none; border-radius:inherit; }
.agent-resizer { position: absolute; top: 14px; left: -5px; bottom: 14px; width: 10px; z-index: 8; cursor: col-resize; touch-action: none; outline: none; }
.agent-resizer::after { content: ''; position: absolute; inset: 0 auto 0 4px; width: 2px; background: transparent; transition: background .15s; }
.agent-resizer:hover::after, .agent-resizer:focus-visible::after, .agent-shell.resizing .agent-resizer::after { background: var(--color-accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-accent) 16%, transparent); }
@media (prefers-reduced-motion:reduce) {
  .agent-toggle,.agent-tooltip { transition:none; }
  .agent-toggle::before,.agent-toggle::after { animation:none; }
  .agent-toggle::before { opacity:.4; }
  .agent-toggle:hover,.agent-toggle:focus-visible,.agent-toggle:active { transform:none; }
}
@media (max-width: 1000px) {
  .dock { position: absolute; right: 0; top: 0; bottom: 80px; z-index: 10; border-bottom: 1px solid var(--color-border); border-radius: 0 0 0 12px; box-shadow: -8px 0 30px #0004; }
}
@media (max-width:760px) {
  .studio.agent-is-docked { grid-template-columns:0px minmax(0,1fr) 0px; }
  .agent-dock-host { grid-column:1 / -1; grid-row:1 / -1; position:absolute; inset:0 0 0 auto; width:min(100%,var(--agent-dock-width)); z-index:40; box-shadow:-8px 0 30px #0004; }
  .studio > .studio-sidebar { grid-column:1 / -1; grid-row:1 / -1; position:absolute; inset:0 auto 60px 0; height:auto; z-index:30; }
}
.flow-wrap {
  flex: 1;
  min-width: 0;
  position: relative;
  container-type:inline-size;
}
.flow-wrap :deep(.vue-flow) {
  background: var(--color-canvas);
}
.canvas-zoom { position:absolute; left:12px; bottom:max(12px,env(safe-area-inset-bottom)); z-index:9; display:flex; align-items:center; gap:2px; padding:3px; border:1px solid var(--color-border); border-radius:10px; background:var(--color-bg-1); box-shadow:var(--shadow-sm); }
.agent-floating-open .canvas-zoom { bottom:56px; }
.canvas-zoom .icon-btn { width:26px; height:26px; font-size:17px; }
.canvas-zoom .icon-btn:disabled { opacity:.3; cursor:default; }
.zoom-value { min-width:48px; height:26px; padding:0 4px; border:0; border-radius:6px; background:transparent; color:var(--color-text-2); font:inherit; font-size:11px; cursor:pointer; }
.zoom-value:hover { background:var(--color-fill-hover); }
@container (min-width:901px) {
  .agent-floating-open .canvas-bottom-tools { left:calc((100% - var(--agent-floating-width)) / 2); }
}
@container (max-width:900px) {
  .agent-shell:not(.docked) { bottom:60px; height:min(520px,calc(100% - 120px)); }
  .canvas-tool-strip { gap:2px; }
}
@container (max-width:600px) {
  .canvas-zoom { bottom:56px; }
  .agent-floating-open .canvas-zoom { display:none; }
  .canvas-bottom-tools { max-width:calc(100% - 72px); left:12px; right:60px; width:max-content; margin-inline:auto; transform:none; }
  .canvas-tool-strip { gap:1px; padding:3px; }
  .canvas-tool-strip .icon-btn { width:27px; height:28px; }
}

.flow-wrap :deep(.vue-flow__node) {
  overflow: visible !important;
  padding: 0;
  background: transparent;
  border: none;
  box-shadow: none;
}
.flow-wrap :deep(.vue-flow__node-groupFrame) {
  overflow: visible !important;
  margin: 0;
  width: auto;
  height: auto;
}
.flow-wrap :deep(.vue-flow__node-subject),
.flow-wrap :deep(.vue-flow__node-subjectProps),
.flow-wrap :deep(.vue-flow__node-scene),
.flow-wrap :deep(.vue-flow__node-sceneProps),
.flow-wrap :deep(.vue-flow__node-shotBoard),
.flow-wrap :deep(.vue-flow__node-shotImage),
.flow-wrap :deep(.vue-flow__node-shotVideo),
.flow-wrap :deep(.vue-flow__node-audio),
.flow-wrap :deep(.vue-flow__node-export),
.flow-wrap :deep(.vue-flow__node-final),
.flow-wrap :deep(.vue-flow__node-imageGen),
.flow-wrap :deep(.vue-flow__node-videoGen) {
  width: auto;
  height: auto;
}
.flow-wrap :deep(.vue-flow__connection-path) {
  stroke:var(--color-text-2);
  stroke-width:1.4;
  opacity:.8;
  vector-effect:non-scaling-stroke;
}
.selection-toolbar { position:absolute; z-index:30; display:flex; align-items:center; gap:3px; padding:6px; box-sizing:border-box; max-width:calc(100% - 16px); border:1px solid var(--color-border); border-radius:12px; background:var(--color-bg-1); box-shadow:0 5px 22px #0004; white-space:nowrap; }
.selection-toolbar button { border:0; border-radius:7px; background:transparent; color:var(--color-text-1); padding:7px 9px; font:inherit; font-size:11px; cursor:pointer; }
.selection-toolbar button:hover { background:var(--color-bg-3); }
.selection-toolbar button:disabled { opacity:.4; cursor:default; }
.selection-toolbar .selection-delete { color:var(--color-text-3); }
.selection-count { color:var(--color-text-3); padding:0 8px; font-size:10px; border-right:1px solid var(--color-border); }
.canvas-bottom-tools .icon-btn[aria-pressed=true] { background:var(--color-bg-3); color:var(--color-accent); }
.flow-wrap :deep(.vue-flow__selection), .flow-wrap :deep(.vue-flow__nodesselection-rect) { background:color-mix(in srgb,var(--color-accent) 7%,transparent); border:1px dashed var(--color-accent); border-radius:6px; }
.group-background-hover :deep(.vue-flow__pane) { cursor:grab; }
.group-background-dragging, .group-background-dragging :deep(.vue-flow__pane) { cursor:grabbing; }
.hand-tool :deep(.vue-flow__pane), .hand-tool :deep(.vue-flow__node) { cursor:grab !important; }
.hand-tool :deep(.vue-flow__pane.dragging) { cursor:grabbing !important; }
</style>
