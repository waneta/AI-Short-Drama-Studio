import { guessInputMap, validateInputMap, type ComfyInputMap } from './comfyInputMap'
import { comfyImageWorkflowModel } from './comfyImageWorkflow'
import { withFlux3References } from './comfyFlux3Reference'
import { withH3ImageReferences } from './comfyH3Image'

/** Nodes actually feeding a saved image; disconnected loaders cannot consume a reference. */
function imageOutputAncestors(nodes: Record<string, any>): Set<string> | undefined {
  const roots = Object.keys(nodes).filter(id => ['SaveImage', 'PreviewImage'].includes(nodes[id]?.class_type))
  if (!roots.length) return undefined
  const active = new Set<string>()
  const visit = (id: string) => {
    if (active.has(id) || !nodes[id]) return
    active.add(id)
    for (const value of Object.values(nodes[id].inputs || {})) {
      if (Array.isArray(value) && value.length === 2 && Number.isInteger(value[1])) visit(String(value[0]))
    }
  }
  roots.forEach(visit)
  return active
}

/** Upgrade the native Qwen 2.1 text template only when this request includes a reference. */
export function withComfyImageReference(payload: any, map: ComfyInputMap, count = 1): ComfyInputMap {
  const model = comfyImageWorkflowModel(payload)
  const limit = model === 'FLUX 3 Image Klein' ? 10 : 16
  if (!Number.isInteger(count) || count < 1 || count > limit) {
    throw new Error(`[comfyui] ${model || '当前工作流'}参考编辑需要1到${limit}张图片，请减少参考图数量。`)
  }
  const nodes = payload?.prompt && typeof payload.prompt === 'object' ? payload.prompt : payload
  const active = imageOutputAncestors(nodes || {})
  if (model === 'MiniMax H3 Image') return withH3ImageReferences(nodes, map, count, active)
  if (model === 'FLUX 3 Image Klein') return withFlux3References(nodes, map, count, active)
  const imageBindings = map.bindings.filter(binding => binding.role === 'image')
  const encoders = Object.entries(nodes || {}).filter(([id, node]: [string, any]) =>
    node?.class_type === 'TextEncodeQwenImage21' && (!active || active.has(id)))
  if (imageBindings.length) {
    if (active && imageBindings.some(binding => !active.has(binding.nodeId))) {
      throw new Error('[comfyui] 参考图输入没有连接到出图节点，请修正工作流连线和 image 输入映射。')
    }
    const expected = Math.max(...imageBindings.map(binding => (binding.imageIndex ?? 0) + 1))
    if (expected > count) throw new Error(`[comfyui] 当前工作流需要${expected}张参考图，本次只提供${count}张。`)
    if (Array.from({ length: count }, (_, index) => index).every(index => imageBindings.some(binding => (binding.imageIndex ?? 0) === index))) return map
  }
  if (encoders.length !== 1) {
    const model = comfyImageWorkflowModel(payload)
    throw new Error(`[comfyui] 当前${model ? model + '工作流' : '工作流'}没有可用的${count > 1 ? '多图' : ''}参考输入，不能执行本次图生图。请在「出图」中选择 Qwen-Image 2.1，或配置相应的 image 输入映射。相同ComfyUI地址不会自动切换模型工作流。`)
  }
  const encoder = encoders[0][1] as any
  const existing = Object.keys(encoder.inputs || {}).filter(key => key.startsWith('images.'))
  // Extend an explicit one-image native workflow only when its first loader is unambiguous.
  const first = imageBindings.length === 1 ? imageBindings[0] : undefined
  const canExtend = first && first.field === 'image' && (first.imageIndex ?? 0) === 0 &&
    nodes[first.nodeId]?.class_type === 'LoadImage' && existing.length === 1 &&
    encoder.inputs['images.image_1']?.[0] === first.nodeId
  if (!Array.isArray(encoder.inputs?.vae) || (existing.length && !canExtend)) {
    throw new Error('[comfyui] Qwen 参考图编辑需要 VAE 和明确的 image 输入映射，请检查现有编辑工作流。')
  }
  const bindings = [...map.bindings]
  let id = 1
  for (let imageIndex = canExtend ? 1 : 0; imageIndex < count; imageIndex++) {
    while (nodes[String(id)]) id++
    const nodeId = String(id)
    nodes[nodeId] = { class_type: 'LoadImage', inputs: { image: '' } }
    // Comfy V3 autogrow: image numbers must match the visible reference order.
    encoder.inputs[`images.image_${imageIndex + 1}`] = [nodeId, 0]
    bindings.push({ role: 'image', nodeId, field: 'image', mediaMode: 'upload', imageIndex })
  }
  return { ...map, kind: 'image-to-image', bindings }
}

/** Preview the same reference validation used at submission, on a detached graph. */
export function comfyImageReferenceIssue(profile: { adapter?: { type?: string; workflowTemplate?: string; inputMap?: ComfyInputMap } } | undefined, count: number): string | undefined {
  const adapter = profile?.adapter
  if (!count || adapter?.type !== 'comfyui-prompt') return undefined
  try {
    const payload = JSON.parse(adapter.workflowTemplate || '')
    let map = adapter.inputMap?.bindings?.length ? adapter.inputMap : guessInputMap(payload)
    map = validateInputMap(payload, map)
    // Legacy templates explicitly mark their upload slot with {{image}}.
    const bindings = [...map.bindings]
    for (const [nodeId, node] of Object.entries(payload.prompt || payload) as [string, any][]) {
      for (const [field, value] of Object.entries(node?.inputs || {})) {
        if (value === '{{image}}' && !bindings.some(binding => binding.nodeId === nodeId && binding.field === field)) {
          bindings.push({ role: 'image', nodeId, field, mediaMode: 'upload' })
        }
      }
    }
    withComfyImageReference(payload, { ...map, bindings }, count)
    return undefined
  } catch (error: unknown) {
    return error instanceof Error ? error.message : '当前工作流无法使用这些参考图。'
  }
}
