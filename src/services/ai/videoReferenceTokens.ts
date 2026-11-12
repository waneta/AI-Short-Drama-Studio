export interface VideoReferenceBinding {
  id: string
  kind: 'image' | 'audio'
  /** Visible mixed-material number; array order still determines the per-kind upload index. */
  number?: number
}
export const videoReferenceToken = (kind: VideoReferenceBinding['kind'], id: string) => `[[ref:${kind}:${encodeURIComponent(id)}]]`
export function videoReferenceParts(prompt: string): Array<{ text?: string; token?: string; id?: string; kind?: VideoReferenceBinding['kind'] }> {
  const out: ReturnType<typeof videoReferenceParts> = []
  const pattern = /\[\[ref:(image|audio):([^\]\n]+)\]\]/g
  let start = 0
  for (const match of prompt.matchAll(pattern)) {
    if (match.index! > start) out.push({ text: prompt.slice(start, match.index) })
    let id: string
    try { id = decodeURIComponent(match[2]) } catch { id = match[2] }
    out.push({ token: match[0], id, kind: match[1] as VideoReferenceBinding['kind'] })
    start = match.index! + match[0].length
  }
  if (start < prompt.length) out.push({ text: prompt.slice(start) })
  return out
}
/** Stable asset IDs prevent a deleted/reordered reference from silently changing identity. */
export function compileVideoReferenceTokens(prompt: string, refs: VideoReferenceBinding[], nativeH3: boolean): string {
  return videoReferenceParts(bindLegacyVideoReferences(prompt, refs)).map(part => {
    if (!part.token) {
      const missing = refs.length ? /@(\d+)/.exec(part.text || '') : null
      if (missing) throw new Error(`参考${refs.some(item => item.kind === 'audio') ? '素材' : '图'} @${missing[1]} 不存在，请按素材栏编号检查图片或音频引用。`)
      return part.text || ''
    }
    const items = refs.filter(item => item.kind === part.kind)
    const index = items.findIndex(item => item.id === part.id)
    if (index < 0) throw new Error(`提示词中的${part.kind === 'audio' ? '音频' : '图片'}参考已移除或不在本次输入中，请删除失效标签或重新选择素材。`)
    if (part.kind === 'audio' && !nativeH3) throw new Error('当前视频模型不支持音频参考标签，请选择原生H3参考图模式。')
    return nativeH3 ? `<${part.kind === 'audio' ? 'Audio' : 'Picture'} ${index + 1}>` : `参考图${index + 1}`
  }).join('')
}

/** @N follows the visible mixed strip; native Picture/Audio tags retain per-kind upload indexes. */
export function bindLegacyVideoReferences(prompt: string, refs: VideoReferenceBinding[]): string {
  return videoReferenceParts(prompt).map(part => part.token || (part.text || '').replace(/@(\d+)|<(Picture|Audio)\s+(\d+)>/g, (original, imageNumber, type, nativeNumber) => {
    const number = Number(imageNumber || nativeNumber)
    const item = imageNumber
      ? refs.find((item, index) => (item.number ?? index + 1) === number)
      : refs.filter(item => item.kind === (type === 'Audio' ? 'audio' : 'image'))[number - 1]
    return item ? videoReferenceToken(item.kind, item.id) : original
  })).join('')
}
export function displayVideoReferenceTokens(prompt: string, refs: VideoReferenceBinding[]): string {
  return videoReferenceParts(bindLegacyVideoReferences(prompt, refs)).map(part => {
    if (!part.token) return part.text || ''
    const items = refs.filter(item => item.kind === part.kind)
    const index = items.findIndex(item => item.id === part.id)
    return index < 0 ? '[失效参考]' : `${part.kind === 'audio' ? '音频' : '图片'} ${items[index].number ?? index + 1}`
  }).join('')
}
