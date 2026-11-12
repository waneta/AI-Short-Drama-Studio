import type { ComfyInputMap } from './comfyInputMap'

const IMAGE_LATENTS = new Set(['EmptyLatentImage', 'EmptySD3LatentImage', 'EmptyFlux2LatentImage'])

/** Support old single-canvas image templates without overriding explicit size bindings. */
export function withComfyImageSizeMap(payload: any, map: ComfyInputMap): ComfyInputMap {
  const roles = ['width', 'height'] as const
  const missing = roles.filter(role => !map.bindings.some(binding => binding.role === role))
  if (!missing.length) return map
  const nodes = payload?.prompt && typeof payload.prompt === 'object' ? payload.prompt : payload
  const candidates = Object.entries(nodes || {}).filter(([, raw]) => {
    const node = raw as any
    return IMAGE_LATENTS.has(node?.class_type) &&
      Number.isFinite(node?.inputs?.width) && Number.isFinite(node?.inputs?.height)
  })
  // Unknown/edit workflows retain their explicit mapping; do not guess resize nodes.
  if (!candidates.length) return map
  const explicit = map.bindings.filter(binding => roles.some(role => role === binding.role))
  const compatible = candidates.filter(([id]) => explicit.every(binding => binding.nodeId === id && binding.field === binding.role))
  if (!compatible.length) return map
  if (compatible.length > 1) {
    throw new Error('[comfyui] 工作流包含多个图像画布，请在输入映射中明确指定 width 和 height，避免比例写入错误节点。')
  }
  return {
    ...map,
    bindings: [...map.bindings, ...missing.map(role => ({ role, nodeId: compatible[0][0], field: role }))]
  }
}
