import type { CanvasGraph, CanvasNode } from '@/types'
import { bindLegacyVideoReferences } from '@/services/ai/videoReferenceTokens'
import { referenceAudioIds, videoReferenceBindings } from './videoReferences'
import { absoluteCanvasPosition } from './layout'
import { cloneGraph, customGroup, duplicateNodes, selectionMembers, selectionRoots, syncGroups } from './editing'

type ClipboardGraph = { format: 'juliu-canvas'; version: 1; projectId: string; graph: CanvasGraph; ids: string[] }
let localClipboard: ClipboardGraph | undefined
export function copyCanvasGraph(graph: CanvasGraph, ids: string[], projectId: string, output: (node?: CanvasNode) => string | undefined = node => node?.data.outputAssetId): ClipboardGraph {
  const roots = selectionRoots(graph, ids), members = selectionMembers(graph, roots.map(n => n.id))
  if (!members.length || members.some(n => !customGroup(n) && !['imageGen', 'videoGen'].includes(n.type))) throw new Error('请选择图片、视频或用户组合')
  const selected = new Set(members.map(n => n.id)), copied = cloneGraph(graph)
  copied.nodes = copied.nodes.filter(n => selected.has(n.id))
  for (const n of copied.nodes) {
    if (!n.parentGroupId || !selected.has(n.parentGroupId)) { n.position = absoluteCanvasPosition(graph.nodes, n); n.parentGroupId = undefined }
    const external = (n.data.referenceSourceNodeIds || []).filter(id => !selected.has(id))
    const originalImages = [...new Set([...(n.data.referenceSourceNodeIds || []).map(id => output(graph.nodes.find(s => s.id === id))).filter((id): id is string => Boolean(id)), ...(n.data.referenceAssetIds || [])])]
    const imageOrder = (n.data.referenceImageOrder || []).map(key => key.startsWith('node:') ? output(graph.nodes.find(s => s.id === key.slice(5))) : key.slice(6))
    const rank = (id: string) => { const index = imageOrder.indexOf(id); return index < 0 ? imageOrder.length : index }
    originalImages.sort((a, b) => rank(a) - rank(b))
    n.data.referenceImageOrder = n.data.referenceImageOrder?.map(key => {
      if (!key.startsWith('node:') || !external.includes(key.slice(5))) return key
      const assetId = output(graph.nodes.find(s => s.id === key.slice(5)))
      return assetId ? `asset:${assetId}` : ''
    }).filter(Boolean)
    const media = external.map(id => output(graph.nodes.find(s => s.id === id))).filter((id): id is string => Boolean(id))
    if (external.length > media.length) throw new Error('上游节点还没有生成结果，请将上游一起复制')
    n.data.referenceSourceNodeIds = (n.data.referenceSourceNodeIds || []).filter(id => selected.has(id))
    n.data.referenceAssetIds = [...new Set([...media, ...(n.data.referenceAssetIds || [])])]
    const nextImages = [...new Set([...(n.data.referenceSourceNodeIds || []).map(id => output(graph.nodes.find(s => s.id === id))).filter((id): id is string => Boolean(id)), ...n.data.referenceAssetIds])]
    nextImages.sort((a, b) => rank(a) - rank(b))
    if (n.type === 'imageGen' && n.data.prompt) n.data.prompt = n.data.prompt.replace(/@(\d+)/g, (token, digits: string) => { const id = originalImages[Number(digits) - 1], index = id ? nextImages.indexOf(id) : -1; return index >= 0 ? `@${index + 1}` : token })
    if (n.type === 'videoGen' && n.data.prompt) {
      const mode = n.data.videoGenerationMode
      const images = mode === 'image' ? [n.data.firstFrameAssetId].filter((id): id is string => Boolean(id)) : mode === 'first-last' ? [n.data.firstFrameAssetId, n.data.lastFrameAssetId].filter((id): id is string => Boolean(id)) : mode === 'text' ? [] : originalImages
      n.data.prompt = bindLegacyVideoReferences(n.data.prompt, videoReferenceBindings(images, mode && mode !== 'omni' ? [] : referenceAudioIds(n.data), n.data.videoReferenceOrder))
    }
    n.data.videoTaskId = undefined; n.error = undefined; n.status = n.data.outputAssetId ? 'success' : 'idle'
  }
  copied.edges = copied.edges.filter(e => selected.has(e.source) && selected.has(e.target))
  copied.viewport = { x: 0, y: 0, zoom: 1 }
  return { format: 'juliu-canvas', version: 1, projectId, graph: syncGroups(copied), ids: roots.map(n => n.id) }
}
export async function writeCanvasClipboard(payload: ClipboardGraph) {
  localClipboard = payload
  // The in-app clipboard works even where system clipboard access is unavailable.
  try { await navigator.clipboard.writeText(JSON.stringify(payload)) } catch { /* local copy remains available */ }
}
export async function readCanvasClipboard(): Promise<ClipboardGraph> {
  if (localClipboard) return JSON.parse(JSON.stringify(localClipboard))
  let text: string
  try { text = await navigator.clipboard.readText() } catch { throw new Error('请先在剧流中复制节点') }
  if (text.length > 2_000_000) throw new Error('节点剪贴板内容过大')
  let value: ClipboardGraph
  try { value = JSON.parse(text) } catch { throw new Error('剪贴板中没有剧流节点') }
  if (value?.format !== 'juliu-canvas' || value.version !== 1 || typeof value.projectId !== 'string' || !Array.isArray(value.ids) || !value.ids.every(id => typeof id === 'string') || !Array.isArray(value.graph?.nodes) || !Array.isArray(value.graph?.edges) || value.graph.nodes.length > 1000 || value.graph.edges.length > 5000) throw new Error('剪贴板节点格式无效')
  const ids = new Set<string>()
  for (const n of value.graph.nodes) {
    if (!n || typeof n.id !== 'string' || ids.has(n.id) || !n.data || typeof n.data !== 'object' || Array.isArray(n.data) || ![n.position?.x, n.position?.y].every(v => typeof v === 'number' && Number.isFinite(v)) || (!customGroup(n) && !['imageGen', 'videoGen'].includes(n.type))) throw new Error('剪贴板含无效节点')
    if (customGroup(n) && ![n.data.width, n.data.height].every(v => typeof v === 'number' && v > 0 && v < 100000)) throw new Error('组合尺寸无效')
    for (const key of ['referenceAssetIds', 'referenceImageOrder', 'referenceSourceNodeIds', 'referenceAudioAssetIds', 'videoReferenceOrder', 'outputAssetIds'] as const) if (n.data[key] !== undefined && (!Array.isArray(n.data[key]) || !n.data[key]!.every(id => typeof id === 'string'))) throw new Error('节点引用格式无效')
    const strings = ['subjectId','sceneId','shotId','label','kind','prompt','referenceAudioAssetId','outputAssetId','aspectRatio','imageProfileId','imageModel','imageQuality','imageResolution','videoGenerationMode','videoModel','videoProfileId','videoStillMode','videoResolution','h3GenMode','firstFrameAssetId','lastFrameAssetId','videoTaskId'] as const
    const numbers = ['width','height','rating','duration','imageCount','generationSeed','imageWidth','imageHeight','videoCount'] as const
    if (strings.some(key => n.data[key] !== undefined && typeof n.data[key] !== 'string') || numbers.some(key => n.data[key] !== undefined && (typeof n.data[key] !== 'number' || !Number.isFinite(n.data[key]))) || (n.data.videoAudioEnabled !== undefined && typeof n.data.videoAudioEnabled !== 'boolean')) throw new Error('剪贴板节点参数类型无效')
    ids.add(n.id)
  }
  if (!value.ids.length || value.ids.some(id => !ids.has(id)) || value.graph.nodes.some(n => n.parentGroupId && (!ids.has(n.parentGroupId) || !customGroup(value.graph.nodes.find(p => p.id === n.parentGroupId))))) throw new Error('剪贴板组合关系无效')
  for (const n of value.graph.nodes) { const seen = new Set([n.id]); let parent = n.parentGroupId; while (parent) { if (seen.has(parent)) throw new Error('剪贴板组合存在循环'); seen.add(parent); parent = value.graph.nodes.find(p => p.id === parent)?.parentGroupId } }
  if (value.graph.edges.some(e => !e || typeof e.id !== 'string' || !ids.has(e.source) || !ids.has(e.target))) throw new Error('剪贴板连线无效')
  return value
}
export function pasteCanvasGraph(current: CanvasGraph, payload: ClipboardGraph, projectId: string, point: { x: number; y: number }) {
  if (payload.projectId !== projectId) throw new Error('请在原项目粘贴节点；跨项目素材请通过公共资产库导入')
  const roots = selectionRoots(payload.graph, payload.ids)
  if (!roots.length) throw new Error('没有可粘贴的节点')
  const result = duplicateNodes(payload.graph, payload.ids, { x: point.x - Math.min(...roots.map(n => n.position.x)), y: point.y - Math.min(...roots.map(n => n.position.y)) })
  if (!result) throw new Error('剪贴板节点无法粘贴')
  const old = new Set(payload.graph.nodes.map(n => n.id)), copies = result.graph.nodes.filter(n => !old.has(n.id)), added = new Set(copies.map(n => n.id))
  const next = cloneGraph(current)
  next.nodes.push(...copies)
  next.edges.push(...result.graph.edges.filter(e => added.has(e.source) && added.has(e.target)))
  return { graph: syncGroups(next), ids: result.ids }
}
