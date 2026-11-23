import { normalizeWan3VideoResolution } from '@/services/ai/wan3VideoSettings'
import { isWan3VideoProfile } from '@/services/ai/dashscopeMedia'
import { videoNodeCapabilities, videoNodeMode, videoNodeDuration } from '@/services/ai/videoNodeCapabilities'
import { autodlWorkflowForProfile, autodlVideoResolution } from '@/services/ai/autodl'
import { VIDEO_DEFAULT_WORKFLOW_ID, VIDEO_H3_V5_10S_WORKFLOW_ID } from '@/services/ai/env'
import { autodlVideoProfileId } from '@/services/ai/runtime'
import { useProjectStore } from '@/stores/project'
import { useSettingsStore } from '@/stores/settings'
import {
  normalizeVideoGenModel,
  normalizeVideoResolution,
  stillModeForVideoModel,
  videoMaxSeconds,
  videoMinSeconds,
  videoStillNeedsCanvas,
  type VideoGenModel,
  type VideoStillMode
} from '@/types/canvas'
import { stillModeFromNode } from '@/utils/videoStill'
import { rebuildCanvasGraph } from './layout'
import { canvasReferenceImageOrder, resolvedCanvasReferenceAssetIds } from './references'
import { isNativeH3VideoProfile, normalizeNativeH3Resolution } from '@/services/ai/nativeH3VideoSettings'

/** 节点切视频模型时同时写入参考图策略，必要时重铺「分镜关键帧」分组。 */
export function applyShotVideoModel(nodeId: string, model: VideoGenModel, profileId?: string) {
  const project = useProjectStore()
  const settings = useSettingsStore()
  const node = project.current?.canvas?.nodes.find((n) => n.id === nodeId)
  if (!node) return
  // 「H3 v5」这组选项写明走 AutoDL 令牌。没点具体接入时不能回落到当前 Zealman。
  const selectedProfileId = profileId
    || (model === 'h3' || model === 'h3-v5' ? autodlVideoProfileId(model === 'h3-v5' ? VIDEO_H3_V5_10S_WORKFLOW_ID : VIDEO_DEFAULT_WORKFLOW_ID) : undefined)
  if (!selectedProfileId && (model === 'h3' || model === 'h3-v5')) throw new Error('内置H3需要已配置的AutoDL接入，请选择具体视频接入或先配置AutoDL。')
  const selectedProfile = selectedProfileId
    ? settings.config.videos.find((profile) => profile.id === selectedProfileId)
    : undefined
  const autodlWorkflow = autodlWorkflowForProfile(selectedProfile)
  const previousFirst = node.data.firstFrameAssetId
  const previousMode = node.data.videoGenerationMode
  const prevStill = stillModeFromNode(node)
  const nextStill = stillModeForVideoModel(model, selectedProfile || settings.config.video)
  const nextH3Mode = selectedProfile?.provider === 'zealman' && selectedProfile.workflowId.startsWith('U02-')
    ? 'fl2va'
    : node.data.h3GenMode
  const min = videoMinSeconds(model)
  const max = videoMaxSeconds(model)
  project.patchCanvasNode(nodeId, {
    videoModel: model,
    videoProfileId: selectedProfileId,
    videoStillMode: nextStill,
    videoTaskId: undefined,
    h3GenMode: nextH3Mode,
    videoResolution: autodlWorkflow ? autodlVideoResolution(node.data.videoResolution, autodlWorkflow) : model === 'h3' && isWan3VideoProfile(selectedProfile || settings.config.video)
      ? normalizeWan3VideoResolution(node.data.videoResolution)
      : model === 'h3' && isNativeH3VideoProfile(selectedProfile || settings.config.video)
      ? normalizeNativeH3Resolution(node.data.videoResolution) : normalizeVideoResolution(node.data.videoResolution, model),
    ...(node.type === 'videoGen'
      ? { duration: Math.min(max, Math.max(min, Math.round(node.data.duration || min))) }
      : {})
  })
  if (node.type === 'videoGen') {
    const caps = videoNodeCapabilities(node.data, selectedProfile || settings.config.video)
    const previous = videoNodeMode(node.data, caps)
    const mode = caps.modes.includes(previous) ? previous : caps.modes[0]
    let refs = project.current ? resolvedCanvasReferenceAssetIds(project.current, node) : []
    if ((mode === 'reference' || mode === 'omni') && previousFirst && ['image', 'first-last', 'audio-sync'].includes(previousMode || '')) {
      project.patchCanvasNode(nodeId, { referenceAssetIds: [...new Set([previousFirst, ...(node.data.referenceAssetIds || [])])], videoTaskId: undefined })
      refs = [...new Set([previousFirst, ...refs])]
      if (project.current) project.patchCanvasNode(nodeId, { referenceImageOrder: canvasReferenceImageOrder(project.current, node, refs) })
    }
    const ratio = node.data.aspectRatio || project.current?.settings.aspectRatio || '16:9'
    project.patchCanvasNode(nodeId, {
      ...((mode === 'image' || mode === 'first-last' || mode === 'audio-sync') ? { firstFrameAssetId: node.data.firstFrameAssetId || refs[0] } : {}),
      ...(mode === 'first-last' ? { lastFrameAssetId: node.data.lastFrameAssetId || refs[1] } : {}),
      videoGenerationMode: mode, h3GenMode: mode === 'first-last' ? 'fl2va' : 'reference',
      duration: videoNodeDuration(node.data.duration, caps),
      aspectRatio: caps.ratios.includes(ratio) ? ratio : caps.ratios[0]
    })
  }
  const shotId = node.data.shotId
  if (node.type === 'shotVideo' && shotId) {
    const shot = project.current?.shots.find((s) => s.id === shotId)
    if (shot) {
      const wfCaps = videoNodeCapabilities(node.data, selectedProfile || settings.config.video)
      if (autodlWorkflow) project.patchCanvasNode(nodeId, { h3GenMode: autodlWorkflow.mode === 'fl2va' ? 'fl2va' : 'reference', videoGenerationMode: wfCaps.modes[0], firstFrameAssetId: node.data.firstFrameAssetId || shot.firstFrameAssetId || shot.imageAssetId, aspectRatio: wfCaps.ratios.includes(node.data.aspectRatio || project.current?.settings.aspectRatio || '16:9') ? node.data.aspectRatio || project.current?.settings.aspectRatio || '16:9' : wfCaps.ratios[0] })
      project.updateShot(shot.id, {
        duration: autodlWorkflow ? videoNodeDuration(shot.duration, wfCaps) : Math.min(max, Math.max(min, Math.round(shot.duration || min))),
        videoProfileId: selectedProfileId,
        videoTaskId: undefined,
        h3GenMode: autodlWorkflow ? autodlWorkflow.mode === 'fl2va' ? 'fl2va' : 'reference' : nextH3Mode,
        ...(autodlWorkflow && autodlWorkflow.mode !== 'standard' ? { firstFrameAssetId: node.data.firstFrameAssetId || shot.firstFrameAssetId || shot.imageAssetId } : {})
      })
    }
  }
  if (
    node.type === 'shotVideo' &&
    videoStillNeedsCanvas(prevStill) !== videoStillNeedsCanvas(nextStill) &&
    project.current
  ) {
    project.setCanvas(rebuildCanvasGraph(project.current, true))
  }
}

/** 节点明确选择某条接入线路；不能只改全局当前项，否则 UI 与实际提交线路会分叉。 */
export function applyShotVideoProfile(nodeId: string, profileId: string) {
  const settings = useSettingsStore()
  if (!settings.config.videos.some((profile) => profile.id === profileId)) return
  applyShotVideoModel(nodeId, 'h3', profileId)
}

/** 设置里改当前视频接入的参考图方式后，同步所有走该接入的分镜节点。 */
export function syncH3ShotStillModes(stillMode: VideoStillMode) {
  const project = useProjectStore()
  const p = project.current
  const activeProfileId = useSettingsStore().config.activeVideoId
  if (!p?.canvas) return
  for (const node of p.canvas.nodes) {
    if (node.type !== 'shotVideo') continue
    if (node.data.videoProfileId && node.data.videoProfileId !== activeProfileId) continue
    const model = normalizeVideoGenModel(node.data.videoModel)
    if (model === 'h3-v5' || model === 'wan-prime') continue
    project.patchCanvasNode(node.id, { videoStillMode: stillMode })
  }
  if (project.current) project.setCanvas(rebuildCanvasGraph(project.current, true))
}
