import type { CanvasNode, H3ImageResolution } from '@/types'
import type { ComfyInputMap } from './comfyInputMap'

/** Align the requested inference canvas to the DiT grid without imposing a minimum generation area. */
export function nativeH3ImageSize(width: number, height: number, minimumArea = 1024): { width: number; height: number } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('[comfyui] H3 Image 需要有效的图片宽高。')
  }
  const scale = Math.max(1, Math.sqrt(minimumArea / (width * height)))
  return { width: Math.ceil(width * scale / 32) * 32, height: Math.ceil(height * scale / 32) * 32 }
}

export const H3_IMAGE_RESOLUTIONS: { value: H3ImageResolution; label: string }[] = [
  { value: '4mp', label: '4MP · 默认' },
  { value: '1mp', label: '1K · 约1MP' },
  { value: '480p', label: '480p' },
  { value: '720p', label: '720p' },
  { value: '1080p', label: '1080p' },
  { value: '1440p', label: '1440p · 2K' },
  { value: '2160p', label: '2160p · 4K' },
  { value: '8mp', label: '8MP' },
  { value: '12mp', label: '12MP' },
  { value: '16mp', label: '16MP · 官方推荐' },
  { value: '20mp', label: '20MP' },
  { value: 'custom', label: '自定义宽高' }
]

export function normalizeH3ImageResolution(value: unknown): H3ImageResolution {
  return H3_IMAGE_RESOLUTIONS.find(item => item.value === value)?.value || '4mp'
}

export function h3ImageNodeInput(data?: CanvasNode['data']) {
  return { h3Resolution: normalizeH3ImageResolution(data?.imageResolution),
    h3CustomWidth: data?.imageWidth, h3CustomHeight: data?.imageHeight }
}

/** p presets specify the short edge; MP presets specify area. Final output need not fit the DiT grid. */
export function h3ImageOutputSize(resolution: H3ImageResolution, width: number, height: number,
  customWidth?: number, customHeight?: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('[comfyui] H3 Image 需要有效的图片宽高。')
  }
  if (resolution === 'custom') {
    if (!Number.isInteger(customWidth) || !Number.isInteger(customHeight) ||
      customWidth! < 32 || customHeight! < 32 || customWidth! > 16384 || customHeight! > 16384 ||
      customWidth! * customHeight! > 20 * 1024 * 1024) {
      throw new Error('[comfyui] H3自定义宽高需为32–16384的整数，总像素不超过约20MP。')
    }
    const canvas = nativeH3ImageSize(customWidth!, customHeight!)
    if (Math.max(canvas.width, canvas.height) > 16384) throw new Error('[comfyui] H3自定义画幅过于狭长，请调整宽高比例。')
    return { width: customWidth!, height: customHeight! }
  }
  const shorts: Partial<Record<H3ImageResolution, number>> = { '480p': 480, '720p': 720, '1080p': 1080, '1440p': 1440, '2160p': 2160 }
  const short = shorts[resolution]
  const areas: Partial<Record<H3ImageResolution, number>> = { '1mp': 1, '4mp': 4, '8mp': 8, '12mp': 12, '16mp': 16, '20mp': 20 }
  const area = areas[resolution]
  if (short) {
    const scale = short / Math.min(width, height)
    return { width: Math.max(32, Math.round(width * scale / 2) * 2), height: Math.max(32, Math.round(height * scale / 2) * 2) }
  }
  if (!area) throw new Error('[comfyui] 未知H3图片分辨率。')
  const scale = Math.sqrt(area * 1024 * 1024 / (width * height))
  return { width: Math.ceil(width * scale / 32) * 32, height: Math.ceil(height * scale / 32) * 32 }
}

/** Resize after decoding so the Comfy output and the saved project asset have the requested pixels. */
export function withH3ImageOutputSize(nodes: Record<string, any>, width: number, height: number) {
  const saves = Object.values(nodes).filter(node => node?.class_type === 'SaveImage')
  if (!saves.length) throw new Error('[comfyui] H3输出分辨率需要连接SaveImage节点。')
  let id = 1
  for (const save of saves) {
    if (!Array.isArray(save.inputs?.images)) throw new Error('[comfyui] H3输出图片连线缺失。')
    while (nodes[String(id)]) id++
    const nodeId = String(id)
    nodes[nodeId] = { class_type: 'ImageScale', inputs: { image: save.inputs.images,
      upscale_method: 'lanczos', width, height, crop: 'disabled' } }
    save.inputs.images = [nodeId, 0]
  }
}

/** Both native H3 conditioning and its caption expander consume each ordered picture. */
export function withH3ImageReferences(nodes: Record<string, any>, map: ComfyInputMap, count: number, active?: Set<string>): ComfyInputMap {
  const connected = (type: string) => Object.entries(nodes).filter(([id, node]) => node?.class_type === type && (!active || active.has(id)))
  const conditions = connected('MiniMaxH3ImageConditioning')
  const generators = connected('TextGenerateV2')
  if (conditions.length !== 1 || generators.length !== 1 || !Array.isArray(conditions[0][1].inputs?.vae)) {
    throw new Error('[comfyui] H3 Image 多图编辑需要连接原生图像条件、VAE和提示词增强器，请使用对应工作流。')
  }
  const condition = conditions[0][1]
  const generator = generators[0][1]
  const images = map.bindings.filter(binding => binding.role === 'image')
  const expected = Math.max(0, ...images.map(binding => (binding.imageIndex ?? 0) + 1))
  if (expected > count) throw new Error(`[comfyui] 当前工作流需要${expected}张参考图，本次只提供${count}张。`)
  if (images.some(binding => active && !active.has(binding.nodeId))) {
    throw new Error('[comfyui] 参考图输入没有连接到出图节点，请检查工作流。')
  }
  const conditionImages = Object.keys(condition.inputs).filter(key => key.startsWith('images.'))
  const generationImages = Object.keys(generator.inputs).filter(key => key.startsWith('images.'))
  const indices = new Set(images.map(binding => binding.imageIndex ?? 0))
  if (indices.size !== images.length || conditionImages.length !== images.length || generationImages.length !== images.length ||
      images.some(binding => binding.field !== 'image' || nodes[binding.nodeId]?.class_type !== 'LoadImage' ||
        condition.inputs[`images.image_${(binding.imageIndex ?? 0) + 1}`]?.[0] !== binding.nodeId ||
        generator.inputs[`images.image${(binding.imageIndex ?? 0) + 1}`]?.[0] !== binding.nodeId)) {
    throw new Error('[comfyui] H3 Image 参考图与提示词增强器的图片顺序不一致，请检查 image 输入映射。')
  }
  const bindings = [...map.bindings]
  let id = 1
  for (let index = 0; index < count; index++) {
    if (indices.has(index)) continue
    while (nodes[String(id)]) id++
    const nodeId = String(id)
    nodes[nodeId] = { class_type: 'LoadImage', inputs: { image: '' } }
    condition.inputs[`images.image_${index + 1}`] = [nodeId, 0]
    generator.inputs[`images.image${index + 1}`] = [nodeId, 0]
    bindings.push({ role: 'image', nodeId, field: 'image', mediaMode: 'upload', imageIndex: index })
  }
  return { ...map, kind: 'image-to-image', bindings }
}
