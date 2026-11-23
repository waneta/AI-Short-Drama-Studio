import { throwIfAborted } from './abort'

// Leave room for Base64 expansion (4/3), including its data URI header.
// Qwen image references have a 10 MB limit; Wan retains its 20 MB budget.
export const DASHSCOPE_REFERENCE_MAX_BYTES = 14_000_000
export const QWEN_REFERENCE_MAX_BYTES = 7_000_000

export function dashscopeReferenceMaxBytes(model: string): number {
  return /^qwen-image(?:-|$)/.test(model) ? QWEN_REFERENCE_MAX_BYTES : DASHSCOPE_REFERENCE_MAX_BYTES
}

/** A transmission copy only: keep the source asset, image order and aspect ratio intact. */
export async function prepareDashscopeReferenceImage(
  source: Blob,
  index: number,
  signal?: AbortSignal,
  onProgress?: (message: string) => void,
  maxBytes = DASHSCOPE_REFERENCE_MAX_BYTES
): Promise<Blob> {
  throwIfAborted(signal)
  if (source.size <= maxBytes) return source
  onProgress?.(`正在适配第${index}张参考图（${(source.size / 1_000_000).toFixed(1)}MB），保留画布原图…`)
  let bitmap: ImageBitmap
  try { bitmap = await createImageBitmap(source) }
  catch {
    throwIfAborted(signal)
    throw new Error(`[百炼] 第${index}张参考图过大且无法解码，请重新选择图片。`)
  }
  let canvas: HTMLCanvasElement | undefined
  try {
    throwIfAborted(signal)
    if (!bitmap.width || !bitmap.height) throw new Error(`[百炼] 第${index}张参考图没有有效尺寸`)
    canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    if (!context) throw new Error(`[百炼] 无法处理第${index}张参考图，请刷新页面后重试`)
    // Bound the temporary canvas allocation for exceptionally large imported assets.
    let scale = Math.min(1, 8192 / Math.max(bitmap.width, bitmap.height), Math.sqrt(32_000_000 / (bitmap.width * bitmap.height)))
    const mime = /^image\/jpe?g$/i.test(source.type) ? 'image/jpeg' : 'image/png'
    let quality = 0.95
    for (let attempt = 0; attempt < 8; attempt++) {
      throwIfAborted(signal)
      canvas.width = Math.max(1, Math.round(bitmap.width * scale))
      canvas.height = Math.max(1, Math.round(bitmap.height * scale))
      context.imageSmoothingEnabled = true
      context.imageSmoothingQuality = 'high'
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      const encoded = await new Promise<Blob>((resolve, reject) => {
        canvas!.toBlob(blob => blob ? resolve(blob) : reject(new Error(`[百炼] 第${index}张参考图编码失败`)), mime, quality)
      })
      throwIfAborted(signal)
      if (encoded.size > 0 && encoded.size <= maxBytes) {
        onProgress?.(`第${index}张参考图已适配为${canvas.width}×${canvas.height}，${(encoded.size / 1_000_000).toFixed(1)}MB`)
        return encoded
      }
      if (!encoded.size) throw new Error(`[百炼] 第${index}张参考图处理结果为空`)
      // JPEG can retain all pixels while reducing quality first. PNG keeps transparency.
      if (mime === 'image/jpeg' && quality > 0.8) { quality -= 0.1; continue }
      scale *= Math.min(0.85, Math.sqrt(maxBytes / encoded.size) * 0.95)
    }
    throw new Error(`[百炼] 第${index}张参考图仍超过上传限制，请手动缩小后重试；未提交生成。`)
  } finally {
    bitmap.close()
    if (canvas) { canvas.width = 0; canvas.height = 0 }
  }
}
