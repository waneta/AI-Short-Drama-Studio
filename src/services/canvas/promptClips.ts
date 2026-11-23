import type { CanvasGraph, CanvasNode } from '@/types'
import type { PromptClip } from '@/services/ai/promptAssistance'
import { absoluteCanvasPosition } from './layout'
import { cloneGraph } from './editing'

/** Keep the original and all input bindings; new clips do not inherit old results/jobs. */
export function addPromptClipNodes(input: CanvasGraph, sourceId: string, clips: PromptClip[]) {
  const graph = cloneGraph(input), source = graph.nodes.find(n => n.id === sourceId)
  if (!source || source.type !== 'videoGen') throw new Error('原视频节点已不存在。')
  const original = absoluteCanvasPosition(graph.nodes, source)
  const right = Math.max(...graph.nodes.map(n => absoluteCanvasPosition(graph.nodes, n).x + (n.data.width || 240))) + 100
  const ids: string[] = []
  const incoming = graph.edges.filter(edge => edge.target === sourceId)
  clips.forEach((clip, i) => {
    const id = `videoGen_${crypto.randomUUID()}`
    const data = JSON.parse(JSON.stringify(source.data)) as CanvasNode['data']
    for (const key of ['outputAssetId', 'outputAssetIds', 'videoTaskId', 'rating', 'shotId', 'subjectId', 'sceneId'] as const) delete data[key]
    data.label = `${source.data.label || '视频'} · ${i + 1} ${clip.title.trim()}`
    data.prompt = clip.prompt
    data.duration = clip.duration
    data.videoCount = 1
    graph.nodes.push({ id, type: 'videoGen', position: { x: right, y: original.y + i * 300 }, data, status: 'idle' })
    for (const edge of incoming) graph.edges.push({ ...edge, id: `e_${crypto.randomUUID()}`, target: id })
    ids.push(id)
  })
  return { graph, ids }
}
