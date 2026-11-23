import { isWan3VideoModel, WAN3_VIDEO_RATIOS } from './wan3VideoSettings'
import type { AspectRatio, CanvasNode, VideoGenerationMode } from '@/types'
import type { VideoEndpoint } from '@/stores/settings'
import { isNativeH3VideoProfile } from './nativeH3VideoSettings'
import { prepareComfyVideoWorkflow } from './comfyVideoReference'
import { guessInputMap } from './comfyInputMap'
import { zealmanWorkflowById } from './zealman'
import { isDashScopeEndpoint } from './dashscopeMedia'
import { isAutodlProfile, autodlWorkflowForProfile } from './autodl'

export const VIDEO_GENERATION_MODES: Array<{ value: VideoGenerationMode; label: string; icon: string; description: string }> = [
  { value: 'audio-sync', label: '数字人口播', icon: '♫', description: '一张人物图配合一段音频，按音频驱动口型' },
  { value: 'text', label: '文生视频', icon: 'T', description: '通过文字描述生成视频' },
  { value: 'omni', label: '全能参考', icon: '✧', description: '混合图片和声音，使用 @ 指定素材用途' },
  { value: 'image', label: '图生视频', icon: '▧', description: '以一张图片作为视频首帧' },
  { value: 'first-last', label: '首尾帧', icon: '◫', description: '指定开始和结束画面，生成中间过程' },
  { value: 'reference', label: '图片参考', icon: '▦', description: '参考图片中的人物、场景与风格' }
]
const RATIOS: AspectRatio[] = ['16:9', '9:16', '1:1', '4:3', '3:4']
export function videoNodeCapabilities(data: CanvasNode['data'], profile?: Partial<VideoEndpoint>) {
  let modes: VideoGenerationMode[] = [], maxImages = 9, min = 1, max = data.videoModel === 'h3-v5' ? 10 : 15
  let durations: number[] | undefined, ratios = [...RATIOS], audio = false, audioOutput = false, aspectControl = true, adaptiveAspect = false, durationControl = true, note = ''
  const reasons: Partial<Record<VideoGenerationMode, string>> = {}
  const autodlWorkflow = autodlWorkflowForProfile(profile)
  const audioSync = autodlWorkflow?.mode === 'audio-sync'
  const native = !isAutodlProfile(profile) && data.videoModel !== 'wan-prime' && data.videoModel !== 'h3-v5' && isNativeH3VideoProfile(profile)
  if (isAutodlProfile(profile)) {
    if (autodlWorkflow) {
      modes = [audioSync ? 'audio-sync' : autodlWorkflow.mode === 'fl2va' ? 'first-last' : autodlWorkflow.maxAudios ? 'omni' : 'reference']
      maxImages = autodlWorkflow.maxImages; min = autodlWorkflow.minDuration; max = autodlWorkflow.maxDuration
      ratios = [...autodlWorkflow.ratios]; audio = audioSync || !!autodlWorkflow.maxAudios; durationControl = !audioSync
      note = audioSync ? '人物图＋一段驱动音频；时长按音频确定，短音频补至5秒，超过15秒截取前15秒。此工作流不读取提示词。'
        : `${autodlWorkflow.note}。音轨由云端工作流决定。`
    } else note = '当前AutoDL工作流尚未适配，请选择设置页提供的H3接入。'
  } else if (data.videoModel === 'wan-prime') {
    modes = ['image', 'reference']; maxImages = 10; min = 2; max = 30
  } else if (!profile) {
    note = '视频接入已删除或尚未配置，请重新选择模型。'
  } else if (native) {
    for (const [mode, workflowMode] of [['reference', 'reference'], ['image', 'first'], ['first-last', 'fl2va']] as const) {
      try {
        prepareComfyVideoWorkflow(profile.adapter!, { mode: workflowMode, count: 1, width: 864, height: 480, duration: 5 })
        modes.push(mode)
      } catch (error) { reasons[mode] = String((error as Error).message) }
    }
    if (modes.includes('reference')) {
      try {
        prepareComfyVideoWorkflow(profile.adapter!, { mode: 'reference', count: 1, width: 864, height: 480, duration: 5, referenceAudioCount: 1 })
        audio = true; modes.push('omni')
      } catch (error) { reasons.omni = String((error as Error).message) }
    }
    try {
      const mode = modes.includes('reference') ? 'reference' : modes.includes('image') ? 'first' : 'fl2va'
      prepareComfyVideoWorkflow(profile.adapter!, { mode, count: 1, width: 864, height: 480, duration: 5, audioEnabled: false })
      audioOutput = true
    } catch { /* Keep fixed audio workflows read-only. */ }
    reasons.text = '当前H3工作流需要图片或参考声音，暂不支持纯文字生成。'
  } else if (data.videoModel !== 'h3-v5' && isDashScopeEndpoint(profile) && !profile.adapter?.type) {
    const id = profile.workflowId || ''
    if (isWan3VideoModel(id)) { modes = ['text', 'image', 'reference', 'first-last']; maxImages = 10; min = 2; max = 30; ratios = [...WAN3_VIDEO_RATIOS]; adaptiveAspect = true }
    else if (/^(wan2\.6-|happyhorse-1\.1-)/.test(id)) {
      modes = id.includes('t2v') ? ['text'] : id.endsWith('r2v') ? ['reference'] : ['image']
      maxImages = modes[0] === 'image' ? 1 : 9
      if (id.startsWith('wan2.6-')) { durations = [5, 10, 15]; min = 5 }
      else min = 3
      // Legacy text adapter submits a fixed 1280*720 canvas.
      if (id.startsWith('wan2.6-t2v')) ratios = ['16:9']
    } else note = '当前百炼模型尚未受视频适配器支持。'
  } else if (profile.provider === 'apimart' || /apimart/i.test(profile.baseUrl || '')) {
    modes = ['text', 'image']; maxImages = 1
    ratios = ['16:9', '9:16', '1:1', '3:2', '2:3']
    if (/grok-imagine-1\.5/i.test(profile.workflowId || '')) min = 6
  } else if (profile.provider === 'zealman' || profile.adapter?.type === 'zealman-workflow') {
    const workflow = zealmanWorkflowById(profile.workflowId || '')
    if (workflow) { modes = workflow.mode === 'fl2va' ? ['first-last'] : ['reference']; maxImages = workflow.maxImages; max = workflow.maxDuration }
    else note = '请配置已支持的Zealman视频工作流。'
  } else if (profile.adapter?.type === 'comfyui-prompt') {
    try {
      const graph = JSON.parse(profile.adapter.workflowTemplate || '{}')
      const map = profile.adapter.inputMap?.bindings?.length ? profile.adapter.inputMap : guessInputMap(graph)
      aspectControl = ['width', 'height'].every(role => map.bindings.some(b => b.role === role))
      durationControl = map.bindings.some(b => b.role === 'length')
      const images = map.bindings.filter(b => b.role === 'image')
      maxImages = new Set(images.map(b => b.imageIndex ?? 0)).size
      modes = map.bindings.some(b => b.role === 'imageEnd') ? ['first-last'] : maxImages > 1 ? ['reference'] : maxImages ? ['image'] : ['text']
      note = '参数以已配置工作流及输入映射为准。'
    } catch { note = '工作流配置无效，请检查视频接入。' }
  } else if (profile.adapter?.type === 'http-custom') {
    modes = ['image']; maxImages = 1
    note = '自定义接口当前按单张首帧提交。'
  } else {
    modes = ['reference', 'first-last']
    note = 'AutoDL工作流支持图片参考与首尾帧。'
  }
  for (const option of VIDEO_GENERATION_MODES) {
    if (!modes.includes(option.value) && !reasons[option.value]) reasons[option.value] = note || '当前模型或接入不支持此生成模式，请切换模型。'
  }
  return { modes, reasons, maxImages, min, max, durations, ratios, audio, audioOutput, aspectControl, durationControl, native, adaptiveAspect, note, audioSync, autodlWorkflow, nativeReferences: native || !!autodlWorkflow?.maxAudios }
}
export type VideoNodeCapabilities = ReturnType<typeof videoNodeCapabilities>
export function videoNodeMode(data: CanvasNode['data'], capabilities: VideoNodeCapabilities): VideoGenerationMode {
  if (data.videoGenerationMode) return data.videoGenerationMode
  if (capabilities.audioSync) return 'audio-sync'
  if (data.h3GenMode === 'fl2va') return 'first-last'
  if (data.referenceAudioAssetIds?.length || data.referenceAudioAssetId) return 'omni'
  return capabilities.modes.includes('reference') ? 'reference' : capabilities.modes[0] || 'reference'
}
export function videoNodeDuration(raw: unknown, capabilities: VideoNodeCapabilities) {
  const value = Math.min(capabilities.max, Math.max(capabilities.min, Math.round(Number(raw) || 8)))
  return capabilities.durations?.reduce((best, next) => Math.abs(next - value) < Math.abs(best - value) ? next : best) ?? value
}
export function videoBatchCount(raw: unknown) { return [1, 2, 4].includes(Number(raw)) ? Number(raw) : 1 }
export function videoModeLabel(mode: VideoGenerationMode) { return VIDEO_GENERATION_MODES.find(item => item.value === mode)?.label || '选择模式' }
export function videoNodeInputIssue(data: CanvasNode['data'], caps: VideoNodeCapabilities, imageIds: string[], audioIds: string[]) {
  const mode = videoNodeMode(data, caps)
  if (!caps.modes.includes(mode)) return caps.reasons[mode] || '当前模型不支持此模式'
  if (mode === 'text') return ''
  if (mode === 'audio-sync') {
    if (!data.firstFrameAssetId && !(!data.videoGenerationMode && imageIds[0])) return '请先选择一张人物图片'
    if (audioIds.length !== 1) return '数字人口播需要且仅支持一段驱动音频，请上传或选用一段配音'
    return ''
  }
  if (mode === 'image' || mode === 'first-last') {
    if (!data.firstFrameAssetId && !(!data.videoGenerationMode && imageIds[0])) return '请先选择首帧图片'
    if (mode === 'first-last' && !data.lastFrameAssetId && !(!data.videoGenerationMode && imageIds[1])) return '请先选择尾帧图片'
    return ''
  }
  if (imageIds.length > caps.maxImages) return `当前模型最多支持${caps.maxImages}张参考图，请移除多余图片。`
  if (mode === 'omni' && audioIds.length > 3) return '最多支持3条参考声音，请移除多余音频。'
  if (!imageIds.length && caps.autodlWorkflow) return '当前AutoDL工作流至少需要一张参考图片'
  if (!imageIds.length && !(mode === 'omni' && caps.audio && audioIds.length)) return mode === 'omni' ? '请添加参考图片或声音' : '请添加至少一张参考图片'
  return ''
}

/** Hidden inputs remain saved but never become active implicitly after a mode change. */
export function videoNodeReferenceIds(data: CanvasNode['data'], caps: VideoNodeCapabilities, images: string[], audios: string[]) {
  const mode = videoNodeMode(data, caps)
  const first = data.firstFrameAssetId || (!data.videoGenerationMode ? images[0] : undefined)
  const last = data.lastFrameAssetId || (!data.videoGenerationMode ? images[1] : undefined)
  return {
    images: mode === 'text' ? [] : (mode === 'image' || mode === 'audio-sync') ? [first].filter((id): id is string => !!id)
      : mode === 'first-last' ? [first, last].filter((id): id is string => !!id) : images,
    audios: mode === 'omni' || mode === 'audio-sync' ? audios : []
  }
}
