import type { ComfyInputMap } from './comfyInputMap'

/** Feed the same ordered references to native FLUX3 conditioning and prompt upsampling. */
export function withFlux3References(nodes: Record<string, any>, map: ComfyInputMap, count: number, active?: Set<string>): ComfyInputMap {
  const connected = (type: string) => Object.entries(nodes).filter(([id, node]) => node?.class_type === type && (!active || active.has(id)))
  const references = connected('ReferenceMultiLatent')
  const generators = connected('TextGenerateV2')
  if (references.length !== 1 || generators.length !== 1 || !Array.isArray(references[0][1].inputs?.vae)) {
    throw new Error('[comfyui] FLUX 3 Image Klein 多图编辑需要连接参考图条件、VAE和本地提示词增强器，请使用对应工作流。')
  }
  const reference = references[0][1]
  const generator = generators[0][1]
  const imageBindings = map.bindings.filter(binding => binding.role === 'image')
  const expected = Math.max(0, ...imageBindings.map(binding => (binding.imageIndex ?? 0) + 1))
  if (expected > count) throw new Error(`[comfyui] 当前工作流需要${expected}张参考图，本次只提供${count}张。`)
  if (imageBindings.some(binding => active && !active.has(binding.nodeId))) {
    throw new Error('[comfyui] 参考图输入没有连接到出图节点，请检查工作流。')
  }
  // Extend only an unambiguous native map. Never overwrite custom image connections.
  const existing = Object.keys(reference.inputs).filter(key => key.startsWith('images.'))
  const generationImages = Object.keys(generator.inputs).filter(key => key.startsWith('images.'))
  if (existing.length !== imageBindings.length || generationImages.length !== imageBindings.length ||
      imageBindings.some(binding => binding.field !== 'image' || nodes[binding.nodeId]?.class_type !== 'LoadImage' ||
        reference.inputs[`images.image${binding.imageIndex ?? 0}`]?.[0] !== binding.nodeId ||
        generator.inputs[`images.image${(binding.imageIndex ?? 0) + 1}`]?.[0] !== binding.nodeId)) {
    throw new Error('[comfyui] FLUX 3 参考图与提示词增强器的图片顺序不一致，请检查 image 输入映射。')
  }
  const bindings = [...map.bindings]
  let id = 1
  for (let index = 0; index < count; index++) {
    if (imageBindings.some(binding => (binding.imageIndex ?? 0) === index)) continue
    while (nodes[String(id)]) id++
    const nodeId = String(id)
    nodes[nodeId] = { class_type: 'LoadImage', inputs: { image: '' } }
    reference.inputs[`images.image${index}`] = [nodeId, 0]
    generator.inputs[`images.image${index + 1}`] = [nodeId, 0]
    bindings.push({ role: 'image', nodeId, field: 'image', mediaMode: 'upload', imageIndex: index })
  }
  return { ...map, kind: 'image-to-image', bindings }
}

/** Older default INT8 graphs must also avoid checkpoint-forced CUDA-13 attention. */
export function withFlux3Attention(payload: any): void {
  const nodes = payload?.prompt || payload
  if (!nodes || typeof nodes !== 'object') return
  const loaders = new Set(Object.entries(nodes).filter(([, node]: [string, any]) =>
    node?.class_type === 'UNETLoader' && /(?:^|[/\\])flux3-image-klein-int8-convrot\.safetensors$/i.test(node.inputs?.unet_name || '')).map(([id]) => id))
  const patched = new Map<string, string>()
  let id = 1
  for (const node of Object.values(nodes) as any[]) {
    const link = node?.inputs?.model
    if (!['KSampler', 'KSamplerAdvanced'].includes(node?.class_type) || !Array.isArray(link) || link[1] !== 0 || !loaders.has(String(link[0]))) continue
    const loader = String(link[0])
    let backend = patched.get(loader)
    if (!backend) {
      while (nodes[String(id)]) id++
      backend = String(id)
      nodes[backend] = { class_type: 'ModelAttentionBackend', inputs: { model: [loader, 0], attention: 'pytorch attention' } }
      patched.set(loader, backend)
    }
    node.inputs.model = [backend, 0]
  }
}
