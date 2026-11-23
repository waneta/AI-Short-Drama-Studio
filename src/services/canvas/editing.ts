import type { CanvasGraph, CanvasNode } from '@/types'
import { absoluteCanvasPosition } from './layout'

type Point = { x: number; y: number }
export type NodeSizes = Record<string, { width: number; height: number }>
export const cloneGraph = (graph: CanvasGraph): CanvasGraph => JSON.parse(JSON.stringify(graph))
export const customGroup = (node?: CanvasNode) => node?.type === 'groupFrame' && node.data.kind === 'custom'
export const editId = (prefix: string) => `${prefix}_${crypto.randomUUID()}`

export function selectionRoots(graph: CanvasGraph, ids: string[]): CanvasNode[] {
  const selected = new Set(ids)
  return graph.nodes.filter(node => {
    if (!selected.has(node.id)) return false
    let parent = node.parentGroupId
    const seen = new Set<string>()
    while (parent && !seen.has(parent)) {
      if (selected.has(parent)) return false
      seen.add(parent)
      parent = graph.nodes.find(n => n.id === parent)?.parentGroupId
    }
    return true
  })
}
export function selectionMembers(graph: CanvasGraph, ids: string[]): CanvasNode[] {
  const set = new Set(ids)
  for (let i = 0; i < graph.nodes.length; i++) {
    let changed = false
    for (const node of graph.nodes) if (node.parentGroupId && set.has(node.parentGroupId) && !set.has(node.id)) { set.add(node.id); changed = true }
    if (!changed) break
  }
  return graph.nodes.filter(n => set.has(n.id))
}
export function nodeSize(node: CanvasNode, sizes: NodeSizes = {}) {
  const ratio = String(node.data.aspectRatio || '16:9').split(':').map(Number)
  return sizes[node.id] || { width: node.data.width || 240, height: node.data.height || (240 / ((ratio[0] || 16) / (ratio[1] || 9)) + 46) }
}
export function nodeBounds(graph: CanvasGraph, nodes: CanvasNode[], sizes: NodeSizes = {}) {
  const rects = nodes.map(n => ({ ...absoluteCanvasPosition(graph.nodes, n), ...nodeSize(n, sizes) }))
  const x = Math.min(...rects.map(n => n.x)), y = Math.min(...rects.map(n => n.y))
  return { x, y, width: Math.max(...rects.map(n => n.x + n.width)) - x, height: Math.max(...rects.map(n => n.y + n.height)) - y }
}
export function syncGroups(graph: CanvasGraph) {
  graph.groups = graph.nodes.filter(n => n.type === 'groupFrame').map(n => ({ id: n.id, label: n.data.label || '组合', nodeIds: graph.nodes.filter(c => c.parentGroupId === n.id).map(c => c.id) }))
  // Vue Flow needs every parent to precede its children, including nested groups.
  const ordered: CanvasNode[] = [], pending = [...graph.nodes], included = new Set<string>()
  while (pending.length) {
    const index = pending.findIndex(n => !n.parentGroupId || included.has(n.parentGroupId) || !graph.nodes.some(p => p.id === n.parentGroupId))
    if (index < 0) { ordered.push(...pending); break }
    const [n] = pending.splice(index, 1); ordered.push(n); included.add(n.id)
  }
  graph.nodes = ordered
  return graph
}
// Fit only ancestors of moved nodes, from the innermost group outwards.
// Rebase every direct child together so changing the frame origin never moves
// stationary siblings (or their descendants) in canvas coordinates.
export function fitCustomGroupBounds(graph: CanvasGraph, movedIds: string[], sizes: NodeSizes = {}) {
  const nodes = new Map(graph.nodes.map(n => [n.id, n])), affected = new Set<string>()
  function ancestors(id: string) {
    const parents: string[] = [], seen = new Set([id])
    let parent = nodes.get(id)?.parentGroupId
    while (parent && !seen.has(parent)) {
      seen.add(parent); parents.push(parent); parent = nodes.get(parent)?.parentGroupId
    }
    return parents
  }
  for (const id of movedIds) for (const parent of ancestors(id)) if (customGroup(nodes.get(parent))) affected.add(parent)
  const groups = [...affected].sort((a, b) => ancestors(b).length - ancestors(a).length)
  for (const id of groups) {
    const group = nodes.get(id)!, children = graph.nodes.filter(n => n.parentGroupId === id)
    if (!children.length) continue
    const boxes = children.map(n => ({ ...n.position, ...(n.type === 'groupFrame' ? { width: n.data.width || 280, height: n.data.height || 240 } : nodeSize(n, sizes)) }))
    const left = Math.min(...boxes.map(b => b.x)) - 28, top = Math.min(...boxes.map(b => b.y)) - 46
    group.data.width = Math.max(...boxes.map(b => b.x + b.width)) + 28 - left
    group.data.height = Math.max(...boxes.map(b => b.y + b.height)) + 28 - top
    group.position = { x: group.position.x + left, y: group.position.y + top }
    for (const child of children) child.position = { x: child.position.x - left, y: child.position.y - top }
  }
  return graph
}
export function groupNodes(input: CanvasGraph, ids: string[], sizes: NodeSizes, merge = false) {
  const graph = cloneGraph(input)
  let roots = selectionRoots(graph, ids)
  if (roots.length < 2) return null
  if (merge) {
    const dissolve = selectionMembers(graph, roots.filter(customGroup).map(n => n.id)).filter(customGroup).map(n => n.id)
    if (dissolve.length) {
      const members = selectionMembers(graph, roots.map(n => n.id)).filter(n => !dissolve.includes(n.id))
      for (const n of members) { const p = absoluteCanvasPosition(graph.nodes, n); n.position = p; n.parentGroupId = undefined }
      graph.nodes = graph.nodes.filter(n => !dissolve.includes(n.id)); roots = members
    }
  }
  const box = nodeBounds(graph, roots, sizes), id = editId('group')
  const position = { x: box.x - 28, y: box.y - 46 }
  const frame: CanvasNode = { id, type: 'groupFrame', position, data: { kind: 'custom', label: `组合 ${graph.nodes.filter(customGroup).length + 1}`, width: box.width + 56, height: box.height + 74 }, status: 'idle' }
  for (const n of roots) { const p = absoluteCanvasPosition(graph.nodes, n); n.position = { x: p.x - position.x, y: p.y - position.y }; n.parentGroupId = id }
  graph.nodes.unshift(frame)
  return { graph: syncGroups(graph), ids: [id] }
}
export function ungroupNodes(input: CanvasGraph, ids: string[]) {
  const graph = cloneGraph(input)
  const groups = graph.nodes.filter(n => customGroup(n) && (ids.includes(n.id) || graph.nodes.some(c => ids.includes(c.id) && c.parentGroupId === n.id)))
  if (!groups.length) return null
  const drop = new Set(groups.map(n => n.id)), selected: string[] = []
  const positions = new Map(graph.nodes.map(n => [n.id, absoluteCanvasPosition(graph.nodes, n)]))
  for (const n of graph.nodes) {
    if (!n.parentGroupId || !drop.has(n.parentGroupId)) continue
    let parent = graph.nodes.find(g => g.id === n.parentGroupId)?.parentGroupId
    while (parent && drop.has(parent)) parent = graph.nodes.find(g => g.id === parent)?.parentGroupId
    const p = positions.get(n.id)!, pp = parent ? positions.get(parent)! : { x: 0, y: 0 }
    n.position = { x: p.x - pp.x, y: p.y - pp.y }; n.parentGroupId = parent
    if (!drop.has(n.id)) selected.push(n.id)
  }
  graph.nodes = graph.nodes.filter(n => !drop.has(n.id))
  return { graph: syncGroups(graph), ids: selected }
}
export function duplicateNodes(input: CanvasGraph, ids: string[], offset: Point = { x: 48, y: 48 }, withEdges = true) {
  const graph = cloneGraph(input), roots = selectionRoots(graph, ids)
  const members = selectionMembers(graph, roots.map(n => n.id))
  if (!members.length || members.some(n => !customGroup(n) && !['imageGen', 'videoGen'].includes(n.type))) return null
  const map = new Map(members.map(n => [n.id, editId(n.type)]))
  const copies = members.map(n => {
    const copy = JSON.parse(JSON.stringify(n)) as CanvasNode
    copy.id = map.get(n.id)!
    copy.data.label = `${n.data.label || (customGroup(n) ? '组合' : n.type === 'imageGen' ? '图片' : '视频')} 副本`
    copy.data.videoTaskId = undefined; copy.error = undefined
    copy.status = copy.data.outputAssetId ? 'success' : 'idle'
    if (n.parentGroupId && map.has(n.parentGroupId)) copy.parentGroupId = map.get(n.parentGroupId)
    else { const p = absoluteCanvasPosition(graph.nodes, n); copy.position = { x: p.x + offset.x, y: p.y + offset.y }; copy.parentGroupId = undefined }
    if (withEdges) copy.data.referenceSourceNodeIds = (n.data.referenceSourceNodeIds || []).map(id => map.get(id) || id)
    else {
      const incoming = (n.data.referenceSourceNodeIds || []).map(id => graph.nodes.find(s => s.id === id)?.data.outputAssetId).filter((id): id is string => Boolean(id))
      copy.data.referenceAssetIds = [...new Set([...incoming, ...(n.data.referenceAssetIds || [])])]
      copy.data.referenceSourceNodeIds = []
    }
    copy.data.referenceImageOrder = n.data.referenceImageOrder?.map(key => {
      if (!key.startsWith('node:')) return key
      const id = key.slice(5)
      if (withEdges) return `node:${map.get(id) || id}`
      const assetId = graph.nodes.find(source => source.id === id)?.data.outputAssetId
      return assetId ? `asset:${assetId}` : ''
    }).filter(Boolean)
    return copy
  })
  // Copy incoming references as well as internal edges; never add an outgoing
  // edge to an unselected target, which would change somebody else's inputs.
  if (withEdges) graph.edges.push(...input.edges.filter(e => map.has(e.target)).map(e => ({ ...e, id: editId('edge'), source: map.get(e.source) || e.source, target: map.get(e.target)! })))
  graph.nodes.push(...copies)
  return { graph: syncGroups(graph), ids: roots.map(n => map.get(n.id)!) }
}
export function deleteNodes(input: CanvasGraph, ids: string[]) {
  const graph = cloneGraph(input), drop = new Set(selectionMembers(graph, ids).map(n => n.id))
  graph.nodes = graph.nodes.filter(n => !drop.has(n.id))
  graph.edges = graph.edges.filter(e => !drop.has(e.source) && !drop.has(e.target))
  for (const n of graph.nodes) if (n.data.referenceSourceNodeIds) n.data.referenceSourceNodeIds = n.data.referenceSourceNodeIds.filter(id => !drop.has(id))
  return syncGroups(graph)
}
export function arrangeNodes(input: CanvasGraph, ids: string[], sizes: NodeSizes) {
  const graph = cloneGraph(input)
  let roots = selectionRoots(graph, ids)
  let container: CanvasNode | undefined
  if (roots.length === 1 && customGroup(roots[0])) { container = roots[0]; roots = graph.nodes.filter(n => n.parentGroupId === container!.id) }
  if (roots.length < 2 && !container) roots = graph.nodes.filter(n => !n.parentGroupId)
  if (roots.length < 2) return graph
  const box = nodeBounds(graph, roots, sizes), set = new Set(roots.map(n => n.id)), rank = new Map(roots.map(n => [n.id, 0]))
  // Bounded relaxation handles acyclic references, with stable fallback for cycles.
  for (let i = 0; i < roots.length; i++) {
    let changed = false
    for (const e of graph.edges) if (set.has(e.source) && set.has(e.target)) {
      const r = (rank.get(e.source) || 0) + 1
      if (r < roots.length && r > (rank.get(e.target) || 0)) { rank.set(e.target, r); changed = true }
    }
    if (!changed) break
  }
  const columns = new Map<number, CanvasNode[]>()
  for (const n of roots) { const r = rank.get(n.id)!; if (!columns.has(r)) columns.set(r, []); columns.get(r)!.push(n) }
  let x = container ? absoluteCanvasPosition(graph.nodes, container).x + 28 : box.x
  for (const [, nodes] of [...columns].sort((a,b) => a[0]-b[0])) {
    let y = container ? absoluteCanvasPosition(graph.nodes, container).y + 46 : box.y
    for (const n of nodes.sort((a,b) => a.position.y-b.position.y || a.position.x-b.position.x)) {
      const parent = graph.nodes.find(p => p.id === n.parentGroupId), p = parent ? absoluteCanvasPosition(graph.nodes, parent) : { x: 0, y: 0 }
      n.position = { x: x - p.x, y: y - p.y }; y += nodeSize(n,sizes).height + 54
    }
    x += Math.max(...nodes.map(n => nodeSize(n,sizes).width)) + 110
  }
  if (container) { const b = nodeBounds(graph, roots, sizes), p = absoluteCanvasPosition(graph.nodes, container); container.data.width = b.x + b.width - p.x + 28; container.data.height = b.y + b.height - p.y + 28 }
  return syncGroups(graph)
}
