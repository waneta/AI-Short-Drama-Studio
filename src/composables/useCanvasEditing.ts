import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { Position, useVueFlow, type Connection, type NodeDragEvent, type GraphNode } from '@vue-flow/core'
import { useProjectStore, useToastStore } from '@/stores'
import { arrangeNodes, cloneGraph, customGroup, deleteNodes, duplicateNodes, fitCustomGroupBounds, groupNodes, selectionMembers, selectionRoots, syncGroups, ungroupNodes, type NodeSizes } from '@/services/canvas/editing'
import { absoluteCanvasPosition } from '@/services/canvas/layout'
import { canvasCommand, type CanvasCommand } from '@/services/canvas/shortcuts'
import { runCanvasNode } from '@/services/canvas/runner'
import { runningNodeIds } from '@/services/canvas/jobs'
import { friendlyAiError } from '@/services/ai/abort'
import { useCanvasHistory } from './useCanvasHistory'
import { canvasNodeOutputAssetId } from '@/services/canvas/references'
import { copyCanvasGraph, pasteCanvasGraph, readCanvasClipboard, writeCanvasClipboard } from '@/services/canvas/clipboard'
import type { CanvasGraph } from '@/types'

export function useCanvasEditing(options: { select: (ids: string[]) => void; add: () => void; search: () => void; connect: (connection: Connection) => void; deleteEntity: (id: string, confirmed?: boolean) => void }) {
  const project = useProjectStore(), toast = useToastStore()
  const flow = useVueFlow()
  const tool = ref<'select' | 'hand'>('select'), space = ref(false), shortcutsOpen = ref(false), generating = ref(false)
  const pan = computed(() => tool.value === 'hand' || space.value)
  const selectedIds = computed(() => flow.getSelectedNodes.value.map(n => n.id))
  const roots = computed(() => project.current?.canvas ? selectionRoots(project.current.canvas, selectedIds.value) : [])
  const selectedGroup = computed(() => roots.value.length === 1 && customGroup(roots.value[0]) ? roots.value[0] : undefined)
  const showToolbar = computed(() => !flow.userSelectionActive.value && !flow.connectionStartHandle.value && !flow.connectionClickStartHandle.value && (roots.value.length > 1 || Boolean(selectedGroup.value)))
  const sizes = (): NodeSizes => Object.fromEntries((project.current?.canvas?.nodes || []).map(n => { const f = flow.findNode(n.id); return [n.id, { width: f?.dimensions.width || n.data.width || 240, height: f?.dimensions.height || n.data.height || 180 }] }))
  const toolbarStyle = computed(() => {
    const graph = project.current?.canvas, vp = flow.viewport.value
    if (!graph || !roots.value.length) return {}
    // computedPosition/dimensions track live drags without waiting for persistence.
    const boxes = roots.value.map(n => { const f = flow.findNode(n.id), p = f?.computedPosition || absoluteCanvasPosition(graph.nodes,n); return { x:p.x, y:p.y, width:f?.dimensions.width || n.data.width || 240, height:f?.dimensions.height || n.data.height || 180 } })
    const x = Math.min(...boxes.map(n => n.x)), y = Math.min(...boxes.map(n => n.y)), width = flow.vueFlowRef.value?.clientWidth || 1000
    return { left: `${Math.max(8, Math.min(width - 365, x * vp.zoom + vp.x))}px`, top: `${Math.max(8, y * vp.zoom + vp.y - 68)}px` }
  })
  function clearSelection() { flow.removeSelectedNodes(flow.getSelectedNodes.value); flow.removeSelectedEdges(flow.getSelectedEdges.value); flow.nodesSelectionActive.value = false; options.select([]) }
  async function choose(ids: string[]) { await nextTick(); clearSelection(); flow.addSelectedNodes(ids.map(id => flow.findNode(id)).filter((n): n is NonNullable<typeof n> => Boolean(n))); flow.nodesSelectionActive.value = ids.length > 1; options.select(ids) }
  const history = useCanvasHistory(clearSelection)
  function apply(result: { graph: CanvasGraph; ids: string[] } | null) {
    if (!result) return false
    history.begin(); project.setCanvas(result.graph); history.end(); void choose(result.ids); return true
  }
  function group(merge = false) {
    const graph = project.current?.canvas
    if (!graph) return
    if (merge && roots.value.filter(customGroup).length < 2) { toast.warn('请选中至少两个用户组合再合并'); return }
    if (!apply(groupNodes(graph, selectedIds.value, sizes(), merge))) toast.warn('请先框选至少两个节点')
  }
  function ungroup() { if (project.current?.canvas && !apply(ungroupNodes(project.current.canvas, selectedIds.value))) toast.warn('请选择用户组合或其中的节点') }
  function duplicate() { if (project.current?.canvas && !apply(duplicateNodes(project.current.canvas, selectedIds.value))) toast.warn('请选择图片、视频或由它们组成的用户组合') }
  async function copy() {
    const p = project.current
    if (!p?.canvas) return
    try { await writeCanvasClipboard(copyCanvasGraph(p.canvas, selectedIds.value, p.id, node => canvasNodeOutputAssetId(p, node))); toast.success('已复制节点，可用 Ctrl+V 粘贴') }
    catch (error) { toast.error(error instanceof Error ? error.message : '复制失败') }
  }
  async function paste(point?: { x: number; y: number }) {
    const projectId = project.current?.id
    try {
      const payload = await readCanvasClipboard(), p = project.current
      if (!p?.canvas || p.id !== projectId) return
      const rect = flow.vueFlowRef.value?.getBoundingClientRect()
      const target = point || flow.screenToFlowCoordinate({ x: (rect?.left || 0) + (rect?.width || 800) / 2, y: (rect?.top || 0) + (rect?.height || 600) / 2 })
      if (apply(pasteCanvasGraph(p.canvas, payload, p.id, target))) toast.success('已粘贴节点')
    } catch (error) { toast.error(error instanceof Error ? error.message : '粘贴失败') }
  }
  function arrange() { const g=project.current?.canvas; if (!g) return; history.begin(); project.setCanvas(arrangeNodes(g, selectedIds.value, sizes())); history.end() }
  function remove() {
    const graph = project.current?.canvas
    if (!graph) return
    if (selectedIds.value.length) {
      const members = selectionMembers(graph, selectedIds.value)
      if (members.some(n => (n.type === 'groupFrame' && !customGroup(n)) || ['export','final'].includes(n.type))) { toast.warn('固定流程分组和导出节点不能删除'); return }
      if (members.some(n => runningNodeIds.value.includes(n.id))) { toast.warn('请等待所选节点生成完成后再删除'); return }
      const entities = members.filter(n => n.type !== 'groupFrame' && !['imageGen','videoGen'].includes(n.type))
      if (entities.length && !confirm('删除所选流程节点及对应数据？可用撤销恢复。')) return
      history.begin()
      for (const n of members) if (n.type !== 'groupFrame' && !['imageGen','videoGen'].includes(n.type)) options.deleteEntity(n.id, true)
      // Fixed entity deletion handles its own confirmation and persistence.
      const removed = members.filter(n => customGroup(n) || ['imageGen','videoGen'].includes(n.type)).map(n => n.id)
      project.setCanvas(deleteNodes(project.current!.canvas!, removed)); history.end(); clearSelection()
    } else if (flow.getSelectedEdges.value.length) { history.begin(); project.removeCanvasEdges(flow.getSelectedEdges.value.map(e => e.id)); history.end() }
  }
  async function generate() {
    const g = project.current?.canvas
    if (!g || generating.value) return
    const nodes = selectionMembers(g, selectedIds.value).filter(n => n.type !== 'groupFrame' && !['script','export','final'].includes(n.type))
    if (!nodes.length) { toast.warn('请选择要生成的图片、视频或组合'); return }
    const ordered: typeof nodes = [], visited = new Set<string>(), pending = new Set<string>()
    function visit(id: string) { if (visited.has(id) || pending.has(id)) return; pending.add(id); for (const e of g!.edges.filter(e => e.target === id)) if (nodes.some(n => n.id === e.source)) visit(e.source); pending.delete(id); visited.add(id); const n=nodes.find(n=>n.id===id); if(n) ordered.push(n) }
    nodes.forEach(n => visit(n.id)); generating.value = true
    try { for (const n of ordered) { if (runningNodeIds.value.includes(n.id)) continue; await runCanvasNode(n.id) } }
    catch (error) { toast.error(friendlyAiError(error)) }
    finally { generating.value = false }
  }
  function connect() {
    const nodes = roots.value.filter(n => n.type !== 'groupFrame')
    if (nodes.length === 2) { options.connect({ source:nodes[0].id,target:nodes[1].id,sourceHandle:'out',targetHandle:'in' }); return }
    const n=nodes[0], port= n && flow.findNode(n.id)?.handleBounds.source?.[0]
    if (!n || !port) { toast.warn('请选择一个源节点或两个待连线节点'); return }
    const f=flow.findNode(n.id)!, p=f.computedPosition, vp=flow.viewport.value, rect=flow.vueFlowRef.value!.getBoundingClientRect()
    flow.startConnection({ nodeId:n.id,id:port.id,type:'source',position:Position.Right,x:(p.x+port.x+port.width/2)*vp.zoom+vp.x+rect.left,y:(p.y+port.y+port.height/2)*vp.zoom+vp.y+rect.top },undefined,true)
  }
  function focusSelected() {
    const nodes = selectedIds.value.filter(id => Boolean(flow.findNode(id)))
    if (!nodes.length) return
    void flow.fitView({ nodes, minZoom: 1, maxZoom: 1, duration: 350 })
  }
  function zoom(factor:number) { const vp=flow.getViewport(), rect=flow.vueFlowRef.value?.getBoundingClientRect(); if (!rect) return; const zoom=Math.max(.2,Math.min(2,vp.zoom*factor)), ratio=zoom/vp.zoom; void flow.setViewport({ x:rect.width/2-(rect.width/2-vp.x)*ratio,y:rect.height/2-(rect.height/2-vp.y)*ratio,zoom }) }
  const commands: Record<CanvasCommand, () => void> = { group:()=>group(),merge:()=>group(true),ungroup,connect,copy:()=>void copy(),paste:()=>void paste(),duplicate,generate:()=>void generate(),add:options.add,'zoom-in':()=>zoom(1.2),'zoom-out':()=>zoom(1/1.2),fit:()=>void flow.fitView({padding:.2,duration:180}),focus:focusSelected,select:()=>{tool.value='select'},hand:()=>{tool.value='hand'},arrange,undo:history.undo,redo:history.redo,search:options.search,delete:remove }
  function execute(command: CanvasCommand) { shortcutsOpen.value=false; commands[command]() }
  function keydown(event:KeyboardEvent) {
    if (event.defaultPrevented || event.isComposing || event.keyCode===229) return
    const target=event.target as HTMLElement | null
    if (target?.closest('input,textarea,select,[contenteditable="true"],.agent-shell,[role="dialog"],[role="menu"],[role="listbox"],.ctx-menu')) return
    if (event.key==='Escape') { if(shortcutsOpen.value){shortcutsOpen.value=false;return} clearSelection(); return }
    if (shortcutsOpen.value) return
    if (event.code==='Space' && !event.ctrlKey && !event.altKey && !event.metaKey) { event.preventDefault(); space.value=true; return }
    if ((event.ctrlKey||event.metaKey) && event.key.toLowerCase()==='a') { event.preventDefault(); const g=project.current?.canvas; if(g) void choose(g.nodes.filter(n=>!n.parentGroupId && (n.type!=='groupFrame'||customGroup(n))).map(n=>n.id)); return }
    const command=canvasCommand(event)
    if (command) { event.preventDefault(); if(!event.repeat || command==='zoom-in' || command==='zoom-out') execute(command) }
  }
  function spaceDown(event: KeyboardEvent) {
    const target = event.target as HTMLElement | null
    if (event.code !== 'Space' || event.ctrlKey || event.altKey || event.metaKey || target?.closest('input,textarea,select,button,a,[contenteditable="true"],.agent-shell,[role="dialog"],[role="menu"],[role="listbox"],.ctx-menu')) return
    event.preventDefault(); space.value = true
  }
  function keyup(event:KeyboardEvent) { if(event.code==='Space')space.value=false }
  function blur() { space.value=false; endGroupBackgroundDrag() }
  let copyDrag: { graph:CanvasGraph; ids:string[]; primary:string; withEdges:boolean } | undefined
  function startDrag(event:NodeDragEvent) {
    history.begin()
    if (event.event.altKey && project.current?.canvas && !runningNodeIds.value.length) {
      copyDrag={graph:cloneGraph(project.current.canvas),ids:selectedIds.value.includes(event.node.id)?[...selectedIds.value]:[event.node.id],primary:event.node.id,withEdges:event.event.ctrlKey||event.event.metaKey}
    }
  }
  function liveDragGraph(graph: CanvasGraph) {
    const next = cloneGraph(graph)
    for (const node of next.nodes) {
      const live = flow.findNode(node.id)
      if (!live) continue
      node.position = { ...live.position }
      if (customGroup(node)) {
        node.data.width = live.data.width
        node.data.height = live.data.height
      }
    }
    return next
  }
  function moveDrag(event: NodeDragEvent) {
    const graph = project.current?.canvas
    // Alt-drag previews a copy; the original group must retain its geometry.
    if (!graph || copyDrag) return
    const next = fitCustomGroupBounds(liveDragGraph(graph), (event.nodes.length ? event.nodes : [event.node]).map(n => n.id), sizes())
    for (const node of next.nodes) {
      const live = flow.findNode(node.id)
      if (!live) continue
      if (live.position.x !== node.position.x || live.position.y !== node.position.y) flow.updateNode(node.id, { position: { ...node.position } })
      if (customGroup(node) && (live.data.width !== node.data.width || live.data.height !== node.data.height)) {
        flow.updateNode(node.id, { data: { ...live.data, width: node.data.width, height: node.data.height }, style: { pointerEvents: 'none', width: `${node.data.width}px`, height: `${node.data.height}px` } })
      }
    }
  }
  function finishDrag(event:NodeDragEvent) {
    const graph=project.current?.canvas
    if(!graph) {history.end();return}
    if(copyDrag) {
      const drag=copyDrag;copyDrag=undefined
      const old=drag.graph.nodes.find(n=>n.id===drag.primary)!, current=event.nodes.find(n=>n.id===drag.primary)||event.node
      const result=duplicateNodes(drag.graph,drag.ids,{x:current.position.x-old.position.x,y:current.position.y-old.position.y},drag.withEdges)
      if(result) {project.setCanvas(result.graph);void choose(result.ids)} else {project.setCanvas(drag.graph);toast.warn('只能拖动复制图片、视频及用户组合')}
      history.end();return
    }
    const next=liveDragGraph(graph), moved=event.nodes.length?event.nodes:[event.node]
    for(const dragged of moved) {
      const n=next.nodes.find(n=>n.id===dragged.id);if(!n)continue
      const parent=next.nodes.find(p=>p.id===n.parentGroupId)
      if(parent && !customGroup(parent) && !moved.some(d=>d.id===parent.id)) {
        const s=sizes()[n.id], inside=n.position.x+s.width/2>=0 && n.position.y+s.height/2>=0 && n.position.x+s.width/2<=(parent.data.width||0) && n.position.y+s.height/2<=(parent.data.height||0)
        if(!inside) {const p=absoluteCanvasPosition(next.nodes,parent);n.position={x:p.x+n.position.x,y:p.y+n.position.y};n.parentGroupId=undefined}
      }
    }
    project.setCanvas(syncGroups(fitCustomGroupBounds(next,moved.map(n=>n.id),sizes())));history.end()
  }
  // Keep group backgrounds transparent so internal wires remain interactive.
  // Claim only pointer gestures that start on the pane inside a custom group.
  const groupBackgroundHover = ref(false), groupBackgroundDragging = ref(false)
  let backgroundDrag: { node: GraphNode; pointerId: number; projectId: string; host: HTMLElement; start: { x: number; y: number }; position: { x: number; y: number }; zoom: number; down: PointerEvent; last: PointerEvent } | undefined
  function groupAtPoint(x: number, y: number) {
    const point = flow.screenToFlowCoordinate({ x, y })
    return (project.current?.canvas?.nodes || []).filter(customGroup).map(n => flow.findNode(n.id)).filter((n): n is GraphNode => {
      if (!n) return false
      const p = n.computedPosition
      return point.x >= p.x && point.y >= p.y && point.x <= p.x + n.dimensions.width && point.y <= p.y + n.dimensions.height
    }).sort((a, b) => a.dimensions.width * a.dimensions.height - b.dimensions.width * b.dimensions.height)[0]
  }
  function startGroupBackgroundDrag(event: PointerEvent) {
    if (event.button !== 0 || pan.value || !project.current || flow.connectionStartHandle.value || flow.connectionClickStartHandle.value) return
    if (!(event.target instanceof Element) || !event.target.matches('.vue-flow__pane')) return
    const node = groupAtPoint(event.clientX, event.clientY)
    if (!node) return
    event.preventDefault(); event.stopPropagation()
    clearSelection(); flow.addSelectedNodes([node]); options.select([node.id])
    const host = event.currentTarget as HTMLElement
    backgroundDrag = { node, pointerId: event.pointerId, projectId: project.current.id, host, start: { x: event.clientX, y: event.clientY }, position: { x: node.computedPosition.x, y: node.computedPosition.y }, zoom: flow.viewport.value.zoom, down: event, last: event }
    groupBackgroundHover.value = true
    host.setPointerCapture(event.pointerId)
    window.addEventListener('pointermove', moveGroupBackgroundDrag, true)
    window.addEventListener('pointerup', endGroupBackgroundDrag, true)
    window.addEventListener('pointercancel', endGroupBackgroundDrag, true)
  }
  function moveGroupBackgroundDrag(event: PointerEvent) {
    const drag = backgroundDrag
    if (!drag) {
      groupBackgroundHover.value = !pan.value && event.target instanceof Element && event.target.matches('.vue-flow__pane') && Boolean(groupAtPoint(event.clientX, event.clientY))
      return
    }
    if (drag.pointerId !== event.pointerId) return
    event.preventDefault(); event.stopPropagation(); drag.last = event
    if (project.current?.id !== drag.projectId) { endGroupBackgroundDrag(); return }
    const dx = event.clientX - drag.start.x, dy = event.clientY - drag.start.y
    if (!groupBackgroundDragging.value && Math.hypot(dx, dy) < 3) return
    if (!groupBackgroundDragging.value) {
      startDrag({ event: drag.down, node: drag.node, nodes: [drag.node] })
      groupBackgroundDragging.value = true
    }
    flow.updateNodePositions([{ id: drag.node.id, parentNode: drag.node.parentNode, from: drag.position, position: { x: drag.position.x + dx / drag.zoom, y: drag.position.y + dy / drag.zoom }, distance: { x: dx / drag.zoom, y: dy / drag.zoom }, dimensions: drag.node.dimensions }], true, true)
    moveDrag({ event, node: drag.node, nodes: [drag.node] })
  }
  function endGroupBackgroundDrag(event?: PointerEvent) {
    const drag = backgroundDrag
    if (!drag || (event && event.pointerId !== drag.pointerId)) return
    event?.preventDefault(); event?.stopPropagation()
    backgroundDrag = undefined
    window.removeEventListener('pointermove', moveGroupBackgroundDrag, true)
    window.removeEventListener('pointerup', endGroupBackgroundDrag, true)
    window.removeEventListener('pointercancel', endGroupBackgroundDrag, true)
    const moved = groupBackgroundDragging.value
    groupBackgroundDragging.value = false; groupBackgroundHover.value = false
    flow.updateNodePositions([{ id: drag.node.id, from: drag.position, position: { ...drag.node.position }, distance: { x: 0, y: 0 }, dimensions: drag.node.dimensions }], false, false)
    if (moved && project.current?.id === drag.projectId) finishDrag({ event: event || drag.last, node: drag.node, nodes: [drag.node] })
    else if (moved) { copyDrag = undefined; history.end() }
    if (drag.host.hasPointerCapture(drag.pointerId)) drag.host.releasePointerCapture(drag.pointerId)
  }
  function selectionEnd() {
    // A zero-distance marquee also emits paneClick. Leave its queued group selection intact.
    if (!selectedIds.value.length) { flow.nodesSelectionActive.value = false; options.select([]); return }
    const g=project.current?.canvas
    if(g)void choose(selectionRoots(g,selectedIds.value).map(n=>n.id))
  }
  onMounted(()=>{window.addEventListener('keydown',spaceDown,true);window.addEventListener('keydown',keydown);window.addEventListener('keyup',keyup);window.addEventListener('blur',blur)})
  onBeforeUnmount(()=>{endGroupBackgroundDrag();window.removeEventListener('keydown',spaceDown,true);window.removeEventListener('keydown',keydown);window.removeEventListener('keyup',keyup);window.removeEventListener('blur',blur)})
  return { copy,paste,groupAtPoint,groupBackgroundHover,groupBackgroundDragging,startGroupBackgroundDrag,moveGroupBackgroundDrag,endGroupBackgroundDrag,tool,space,pan,shortcutsOpen,selectedIds,selectedGroup,showToolbar,toolbarStyle,generating,history,execute,choose,clearSelection,startDrag,moveDrag,finishDrag,selectionEnd }
}
