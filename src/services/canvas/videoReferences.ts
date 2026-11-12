import type { CanvasNode } from '@/types'
import type { VideoReferenceBinding } from '@/services/ai/videoReferenceTokens'
export function referenceAudioIds(data?: CanvasNode['data']): string[] {
  return [...new Set(data?.referenceAudioAssetIds ?? (data?.referenceAudioAssetId ? [data.referenceAudioAssetId] : []))]
}
export function videoReferenceBindings(images: string[], audios: string[], order: string[] = []): VideoReferenceBinding[] {
  const refs = [...images.map(id => ({ id, kind: 'image' as const })), ...audios.map(id => ({ id, kind: 'audio' as const }))]
  const visibleIds = [...new Set([...order.filter(id => refs.some(item => item.id === id)), ...refs.map(item => item.id)])]
  // Keep actual image/audio upload order intact while carrying the visible mixed index.
  return refs.map(item => ({ ...item, number: visibleIds.indexOf(item.id) + 1 }))
}
