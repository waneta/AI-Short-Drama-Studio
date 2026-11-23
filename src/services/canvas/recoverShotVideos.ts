import { useAssetsStore, useProjectStore } from '@/stores'
import type { Project } from '@/types'
import { effectiveShotAudioMode } from '@/utils/shot'

/** Only offer disconnected TTS shots with an explicit video history; never overwrite a current choice. */
export function recoverableTtsVideoShots(project?: Project | null) {
  return project?.shots.filter(shot => !shot.videoAssetId && effectiveShotAudioMode(shot) === 'tts' && shot.videoHistoryIds?.length) || []
}

export async function recoverMissingTtsVideos() {
  const project = useProjectStore(), assets = useAssetsStore(), p = project.current
  if (!p) throw new Error('没有打开的项目')
  const candidates = recoverableTtsVideoShots(p).map(shot => ({ id: shot.id, history: [...shot.videoHistoryIds!] }))
  const ready: Array<{ shotId: string; assetId: string }> = [], missing: string[] = [], restored: string[] = []
  await assets.refresh()
  for (const shot of candidates) {
    let found = false
    // History stores the most recently used video first. Skip deleted/unreadable files.
    for (const id of shot.history) {
      const meta = assets.getMeta(id)
      if (meta && meta.kind !== 'video') continue
      const blob = await assets.getBlob(id).catch(() => undefined)
      if (!blob || !blob.size || (!meta && !blob.type.startsWith('video/'))) continue
      ready.push({ shotId: shot.id, assetId: id }); found = true; break
    }
    if (!found) missing.push(shot.id)
  }
  if (project.current !== p) throw new Error('当前项目已切换，未恢复视频')
  for (const item of ready) {
    const shot = p.shots.find(shot => shot.id === item.shotId)
    if (!shot || shot.videoAssetId || effectiveShotAudioMode(shot) !== 'tts' || !shot.videoHistoryIds?.includes(item.assetId)) continue
    project.assignShotVideo(item.shotId, item.assetId)
    restored.push(item.shotId)
  }
  // Audio, prompts, clip order, trims, speed and volumes are deliberately left intact.
  if (restored.length) await project.save()
  return { restored, missing }
}
