/** Conservative, documented custom-size support; unknown GPT aliases keep standard sizes. */
export function gptImageCustomSizeSupported(model: string) {
  return /^gpt-image-(?:2|2\.[56]-(?:sunburst|flare))(?:-\d{4}-\d{2}-\d{2})?$/.test(model.trim().toLowerCase().replace(/_/g, '-'))
}

export const GPT_IMAGE_STANDARD_RATIOS = ['1:1', '2:3', '3:2'] as const

/** Every preset keeps its exact ratio and satisfies the 16-pixel grid and pixel budget. */
const presets: Record<string, { width: number; height: number }> = {
  '1:1': { width: 1024, height: 1024 },
  '2:3': { width: 1024, height: 1536 },
  '3:2': { width: 1536, height: 1024 },
  '16:9': { width: 1536, height: 864 },
  '9:16': { width: 864, height: 1536 },
  '4:3': { width: 1536, height: 1152 },
  '3:4': { width: 1152, height: 1536 },
  '5:4': { width: 1280, height: 1024 },
  '4:5': { width: 1024, height: 1280 },
  '2:1': { width: 2048, height: 1024 },
  '1:2': { width: 1024, height: 2048 },
  '21:9': { width: 1792, height: 768 },
  '9:21': { width: 768, height: 1792 }
}

export function gptImageSizeIssue(width?: number, height?: number): string {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width! <= 0 || height! <= 0) return 'GPT Image 宽高需为正整数。'
  if (width! % 16 || height! % 16) return 'GPT Image 宽高都需为16的倍数，例如1536×864。'
  if (width! > 3840 || height! > 3840) return 'GPT Image 单边不能超过3840像素。'
  if (Math.max(width!, height!) > Math.min(width!, height!) * 3) return 'GPT Image 宽高比需在1:3到3:1之间。'
  const pixels = width! * height!
  if (pixels < 655360 || pixels > 8294400) return 'GPT Image 总像素需在655,360–8,294,400之间（约0.66–8.29MP）。'
  return ''
}

export function gptImageOutputSize(model: string, ratio: string, custom?: { width?: number; height?: number }) {
  const flexible = gptImageCustomSizeSupported(model)
  if (custom) {
    if (!flexible) throw new Error('[image] 当前GPT Image模型仅支持标准尺寸，请重新选择比例。')
    const issue = gptImageSizeIssue(custom.width, custom.height)
    if (issue) throw new Error(`[image] ${issue}`)
    return { width: custom.width!, height: custom.height! }
  }
  if (flexible && presets[ratio]) return { ...presets[ratio] }
  const [width, height] = ratio.split(':').map(Number)
  return { ...presets[width === height ? '1:1' : width > height ? '3:2' : '2:3'] }
}
