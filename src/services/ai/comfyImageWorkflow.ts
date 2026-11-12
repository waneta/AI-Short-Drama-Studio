/** The submitted graph determines the model, even when a saved display name is just "comfyui". */
export function comfyImageWorkflowModel(payload: any): string | undefined {
  const nodes: any[] = Object.values(payload?.prompt || payload || {})
  if (nodes.some(node => node?.class_type === 'MiniMaxH3ImageConditioning')) return 'MiniMax H3 Image'
  if (nodes.some(node => node?.class_type === 'TextEncodeQwenImage21')) return 'Qwen-Image 2.1'
  const files = nodes.flatMap(node => [node?.inputs?.unet_name, node?.inputs?.ckpt_name]).filter(Boolean).join(' ')
  if (/flux3[-_]image[-_]klein/i.test(files)) return 'FLUX 3 Image Klein'
  if (/z[_-]?image.*turbo/i.test(files)) return 'Z-Image-Turbo'
  return undefined
}

export function comfyImageModelOption(profile: any, model: string): string {
  if (profile?.adapter?.type !== 'comfyui-prompt') return model
  try {
    const payload = JSON.parse(profile?.adapter?.workflowTemplate || '')
    const actual = comfyImageWorkflowModel(payload)
    if (!actual) return model
    const mapped = profile?.adapter?.inputMap?.bindings?.some((binding: any) => binding.role === 'image')
    const nativeFlux = actual === 'FLUX 3 Image Klein' && Object.values(payload.prompt || payload).some((node: any) => node?.class_type === 'ReferenceMultiLatent' && Array.isArray(node.inputs?.vae))
    const capability = actual === 'Qwen-Image 2.1' || actual === 'MiniMax H3 Image' || nativeFlux ? '多图编辑' : mapped ? '图生图' : '文生图'
    const bf16Image = actual === 'MiniMax H3 Image' && Object.values(payload.prompt || payload).some((node: any) => /minimax_h3_image.*_bf16\.safetensors$/.test(node?.inputs?.unet_name || ''))
    return `${actual}${bf16Image ? ' · BF16' : ''} · ${capability}`
  } catch {
    return model
  }
}
