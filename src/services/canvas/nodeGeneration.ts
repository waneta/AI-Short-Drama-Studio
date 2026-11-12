import { isDashScopeEndpoint } from '@/services/ai/dashscopeMedia'
import { wan27ImageLimits, wan27ImageResolution, wan27ImageResolutionOptions } from '@/services/ai/wan27ImageSize'
import type { CanvasNode, H3ImageResolution } from '@/types'
import type { AppSettings } from '@/stores/settings'
import { comfyImageWorkflowModel } from '@/services/ai/comfyImageWorkflow'
import { H3_IMAGE_RESOLUTIONS } from '@/services/ai/comfyH3Image'
import { isNativeH3VideoProfile, normalizeNativeH3Resolution } from '@/services/ai/nativeH3VideoSettings'

export const IMAGE_NODE_TYPES = ['imageGen', 'subject', 'scene', 'sceneProps', 'shotBoard', 'shotImage', 'shotFrames']
export function nativeH3Image(profile?: { adapter?: { workflowTemplate?: string } }) {
  try { return comfyImageWorkflowModel(JSON.parse(profile?.adapter?.workflowTemplate || '{}')) === 'MiniMax H3 Image' }
  catch { return false }
}
type ImageProfile = { model?: string; provider?: string; baseUrl?: string; adapter?: { type?: string; workflowTemplate?: string } }
export function wan27ImageProfile(profile?: ImageProfile) {
  return !!profile && isDashScopeEndpoint(profile) && !profile.adapter?.type && !!wan27ImageLimits(profile.model)
}
export function imageResolutionOptions(profile?: ImageProfile, model = profile?.model, aspectRatio = '16:9', referenceCount = 0) {
  if (wan27ImageProfile({ ...profile, model })) {
    const [width, height] = aspectRatio.split(':').map(Number)
    return wan27ImageResolutionOptions(model!, width || 16, height || 9, referenceCount)
  }
  return nativeH3Image(profile) ? H3_IMAGE_RESOLUTIONS : [
    { value: 'auto' as const, label: '默认尺寸' },
    ...H3_IMAGE_RESOLUTIONS.filter(item => ['480p', '720p', '1080p', '1440p', '2160p', 'custom', ...(profile?.adapter?.type === 'comfyui-prompt' ? ['1mp', '4mp'] : [])].includes(item.value))
  ]
}
export function nodeImageResolution(data: CanvasNode['data'] | undefined, profile?: ImageProfile, aspectRatio = data?.aspectRatio || '16:9', referenceCount = 0): H3ImageResolution {
  const model = data?.imageModel || profile?.model
  if (wan27ImageProfile({ ...profile, model })) {
    const [width, height] = aspectRatio.split(':').map(Number)
    return wan27ImageResolution(model!, data?.imageResolution || 'auto', width || 16, height || 9, referenceCount)!
  }
  const options = imageResolutionOptions(profile)
  return options.find(item => item.value === data?.imageResolution)?.value || options[0].value
}

/** Bind once when a canvas is loaded/created. Later global choices only affect new nodes. */
export function pinCanvasGenerationSettings(nodes: CanvasNode[], settings: AppSettings) {
  for (const node of nodes) {
    if (IMAGE_NODE_TYPES.includes(node.type)) {
      if (!node.data.imageProfileId && settings.activeImageId) node.data.imageProfileId = settings.activeImageId
      const profile = node.data.imageProfileId ? settings.images.find(p => p.id === node.data.imageProfileId) : settings.image
      if (!node.data.imageModel && profile?.model) node.data.imageModel = profile.model
      if (!node.data.imageResolution) node.data.imageResolution = nodeImageResolution(node.data, profile)
    }
    if (node.type === 'videoGen' || node.type === 'shotVideo') {
      const model = node.data.videoModel || settings.defaultVideoModel || 'h3'
      node.data.videoModel = model
      if (!node.data.videoProfileId && model === 'h3-v5') node.data.videoProfileId = settings.videos?.find(p => p.provider === 'autodl' || /autodl\.art/i.test(p.baseUrl))?.id
      if (!node.data.videoProfileId && model === 'h3' && settings.activeVideoId) node.data.videoProfileId = settings.activeVideoId
    }
  }
}

/** Display only controls the corresponding adapter actually consumes. Fixed workflows stay visible. */
export function videoResolutionOptions(data: CanvasNode['data'], profile?: AppSettings['video']) {
  if ((data.videoModel || 'h3') === 'h3' && isNativeH3VideoProfile(profile)) {
    return { native: true, value: normalizeNativeH3Resolution(data.videoResolution), options: ['480p', '720p', '1080p'], note: '' }
  }
  if (data.videoModel === 'wan-prime' || /dashscope|aliyuncs\.com/.test(`${profile?.provider} ${profile?.baseUrl}`)) {
    return { native: false, value: '720p', options: ['720p'], note: '当前适配器使用固定720p' }
  }
  if (profile?.adapter?.type === 'comfyui-prompt') {
    return { native: false, value: 'workflow', options: ['workflow'], note: '尺寸由已配置工作流决定' }
  }
  if (profile?.provider === 'zealman' || profile?.adapter?.type === 'zealman-workflow') {
    return { native: false, value: 'workflow', options: ['workflow'], note: '尺寸由所选工作流决定' }
  }
  if (data.h3GenMode === 'fl2va') return { native: false, value: '736p', options: ['736p'], note: '当前首尾帧工作流固定736p' }
  if (data.videoModel === 'h3-v5') return { native: false, value: data.videoResolution === '768p' ? '768p' : '1080p', options: ['768p', '1080p'], note: '' }
  if (profile?.provider === 'apimart' || /apimart/.test(profile?.baseUrl || '')) return { native: false, value: data.videoResolution === '1080p' ? '1080p' : '720p', options: ['720p', '1080p'], note: '' }
  return { native: false, value: '768p', options: ['768p'], note: '当前工作流固定768p' }
}
