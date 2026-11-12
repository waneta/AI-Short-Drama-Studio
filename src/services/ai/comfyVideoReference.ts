import type { AdapterConfig } from './adapters'
import { guessInputMap, validateInputMap, type ComfyInputMap } from './comfyInputMap'
import { nativeH3VideoSize } from './nativeH3VideoSettings'
import type { VideoResolution } from '@/types'

/** Follow saved-video dependencies, including V3 flattened autogrow image inputs. */
function videoAncestors(nodes: Record<string, any>): Set<string> {
  const active = new Set<string>()
  const visit = (id: string) => {
    if (active.has(id) || !nodes[id]) return
    active.add(id)
    for (const value of Object.values(nodes[id].inputs || {})) {
      if (Array.isArray(value) && value.length === 2 && Number.isInteger(value[1])) visit(String(value[0]))
    }
  }
  Object.keys(nodes).filter(id => /^(SaveVideo|VHS_VideoCombine|SaveAnimatedWEBP|SaveAnimatedPNG)$/.test(nodes[id]?.class_type)).forEach(visit)
  return active
}

/** Reject silent reference loss before uploading, including disconnected loaders. */
export function validateComfyVideoReferences(payload: any, map: ComfyInputMap, count: number, hasEnd: boolean, audioCount: number | boolean = 0) {
  const active = videoAncestors(payload?.prompt || payload)
  const images = map.bindings.filter(b => b.role === 'image')
  for (let index = 0; index < count; index++) {
    if (!images.some(b => (b.imageIndex ?? 0) === index && active.has(b.nodeId))) {
      throw new Error(`[comfyui] 视频工作流没有接入参考图 @${index + 1}，不能忽略该图片生成。请配置多参考图工作流和 imageIndex 映射；人物、场景参考不能当作首尾帧。`)
    }
  }
  if (images.some(b => active.has(b.nodeId) && (b.imageIndex ?? 0) >= count)) {
    throw new Error('[comfyui] 视频工作流需要更多参考图，不能沿用模板里的旧图片。')
  }
  const countAudio = Number(audioCount)
  const audio = map.bindings.filter(b => b.role === 'audio' && active.has(b.nodeId))
  for (let index = 0; index < countAudio; index++) {
    if (!audio.some(b => (b.audioIndex ?? 0) === index)) throw new Error(`[comfyui] 视频工作流没有接入参考声音 ${index + 1}，不能忽略声音生成。`)
  }
  if (audio.some(b => (b.audioIndex ?? 0) >= countAudio)) throw new Error('[comfyui] 当前工作流需要更多参考声音，不能沿用模板旧音频。')
  const end = map.bindings.some(b => b.role === 'imageEnd' && active.has(b.nodeId))
  if (hasEnd !== end) throw new Error(hasEnd
    ? '[comfyui] 视频工作流没有可用的尾帧输入，请切换首尾帧工作流。'
    : '[comfyui] 当前视频工作流需要尾帧，请选择首尾帧模式或配置参考图工作流。')
}

/**
 * Native H3 reference/first-last modes need different weights AND conditioning nodes.
 * Derive a detached request graph, so existing saved profiles gain both modes without a reset.
 * Automatic switching is restricted to the known matching BF16 pair.
 */
export function prepareComfyVideoWorkflow(adapter: AdapterConfig, input: {
  mode: 'reference' | 'fl2va' | 'first'; count: number; width: number; height: number; duration: number
  resolution?: VideoResolution
  audioEnabled?: boolean
  referenceAudio?: boolean
  referenceAudioCount?: number
}): { adapter: AdapterConfig; nativeH3: boolean } {
  const audioCount = input.referenceAudioCount ?? Number(Boolean(input.referenceAudio))
  if (!Number.isInteger(audioCount) || audioCount < 0 || audioCount > 3) throw new Error('[comfyui] H3最多支持3条参考声音，不会丢弃多余声音。')
  const payload = JSON.parse(adapter.workflowTemplate || '{}')
  const nodes = payload.prompt || payload
  const active = videoAncestors(nodes)
  const h3 = Object.entries(nodes).filter(([id, n]: [string, any]) => active.has(id) &&
    ['MiniMaxH3ImageToVideo', 'MiniMaxH3ReferenceToVideo'].includes(n?.class_type)) as [string, any][]
  if (audioCount && input.mode !== 'reference') throw new Error('[comfyui] 参考声音需要 H3「参考图」模式，首尾帧模式不支持；请切换模式或移除参考声音。')
  if (!h3.length) return { adapter, nativeH3: false }
  if (h3.length !== 1) throw new Error('[comfyui] H3 工作流有多个生成入口，请为本次模式配置独立工作流。')
  const [id, condition] = h3[0]
  if (!Number.isInteger(input.count) || input.count < (audioCount ? 0 : 1) || input.count > 9) throw new Error('[comfyui] H3 参考图需要1到9张图片。')
  if (input.mode !== 'reference' && input.count !== 1) throw new Error('[comfyui] 首帧模式只接收一张首帧，其他图片请选择参考图模式。')
  let map = validateInputMap(payload, adapter.inputMap?.bindings?.length ? adapter.inputMap : guessInputMap(payload))
  const target = input.mode === 'reference' ? 'MiniMaxH3ReferenceToVideo' : 'MiniMaxH3ImageToVideo'
  const unets = Object.entries(nodes).filter(([key, n]: [string, any]) => active.has(key) && n?.class_type === 'UNETLoader') as [string, any][]
  const variant = input.mode === 'reference' ? 'ref2va' : 'fl2va'
  if (unets.length !== 1) throw new Error('[comfyui] 无法确定 H3 主模型，请配置明确的参考图/首尾帧工作流。')
  const model = String(unets[0][1].inputs.unet_name || '')
  const pair = /minimax_h3_(fl2va|ref2va)_pruned_bf16\.safetensors$/
  if (condition.class_type !== target || (pair.test(model) && !model.endsWith(`minimax_h3_${variant}_pruned_bf16.safetensors`))) {
    if (!pair.test(model)) throw new Error('[comfyui] 当前 H3 权重不能自动切换模式，请配置与参考图/首尾帧匹配的模型工作流。')
    unets[0][1].inputs.unet_name = model.replace(pair, `minimax_h3_${variant}_pruned_bf16.safetensors`)
  }
  if (!Array.isArray(condition.inputs.clip) || !Array.isArray(condition.inputs.vae)) throw new Error('[comfyui] H3 参考图必须连接文本编码器和视频 VAE。')
  // Rebuild simple image slots only; arbitrary preprocessors require an explicit workflow.
  const oldSlots = Object.entries(condition.inputs).filter(([key]) => ['first_frame', 'last_frame'].includes(key) || key.startsWith('ref_images.'))
  const oldLoaders = oldSlots.map(([, value]) => Array.isArray(value) ? String(value[0]) : '')
  if (oldLoaders.some(key => nodes[key]?.class_type !== 'LoadImage')) throw new Error('[comfyui] H3 图片输入含自定义预处理，请配置独立的参考图工作流。')
  const imageIds = [...new Set(oldLoaders)]
  const stale = new Set(imageIds)
  map = { ...map, bindings: map.bindings.filter(b => !((b.role === 'image' || b.role === 'imageEnd') && stale.has(b.nodeId))) }
  for (const [key] of oldSlots) delete condition.inputs[key]
  condition.class_type = target
  if (input.mode === 'reference') condition.inputs.ref_image_size ??= 'match'
  else delete condition.inputs.ref_image_size
  for (let index = 0; index < (input.mode === 'fl2va' ? 2 : input.count); index++) {
    let loaderId = imageIds[index]
    if (!loaderId) {
      let next = 1
      while (nodes[String(next)]) next++
      loaderId = String(next)
      nodes[loaderId] = { class_type: 'LoadImage', inputs: { image: '' } }
    }
    const field = input.mode === 'reference' ? `ref_images.ref_image_${index}` : index === 0 ? 'first_frame' : 'last_frame'
    condition.inputs[field] = [loaderId, 0]
    map.bindings.push({ role: input.mode === 'fl2va' && index === 1 ? 'imageEnd' : 'image',
      nodeId: loaderId, field: 'image', mediaMode: 'upload', ...(input.mode === 'reference' ? { imageIndex: index } : {}) })
  }
  const oldAudio = Object.entries(condition.inputs).filter(([key]) => key.startsWith('ref_audios.'))
  const audioIds = new Set(oldAudio.map(([, value]) => Array.isArray(value) ? String(value[0]) : ''))
  map.bindings = map.bindings.filter(b => !(b.role === 'audio' && audioIds.has(b.nodeId)))
  for (const [key] of oldAudio) delete condition.inputs[key]
  if (audioCount) {
    let audioVae = condition.inputs.audio_vae
    if (!Array.isArray(audioVae)) {
      const decoder = Object.entries(nodes).find(([key, n]: [string, any]) => active.has(key) && n.class_type === 'VAEDecodeAudio')?.[1] as any
      audioVae = decoder?.inputs?.vae
    }
    if (!Array.isArray(audioVae)) throw new Error('[comfyui] H3参考声音需要音频VAE，请配置完整音视频工作流。')
    condition.inputs.audio_vae = audioVae
    for (let index = 0; index < audioCount; index++) {
      let next = 1
      while (nodes[String(next)]) next++
      const audioId = String(next)
      nodes[audioId] = { class_type: 'LoadAudio', inputs: { audio: '' } }
      condition.inputs[`ref_audios.ref_audio_${index}`] = [audioId, 0]
      map.bindings.push({ role: 'audio', nodeId: audioId, field: 'audio', mediaMode: 'upload', audioIndex: index })
    }
  } else if (input.mode !== 'reference') delete condition.inputs.audio_vae
  // Native 32px canvas and 17k+5 / 24fps grid replace the template's fixed 5s values.
  const size = nativeH3VideoSize(input.resolution, input.width, input.height)
  condition.inputs.width = size.width
  condition.inputs.height = size.height
  condition.inputs.length = 5 + 17 * Math.max(0, Math.ceil((Math.round(input.duration * 24) - 5) / 17))
  for (const field of ['prompt', 'width', 'height', 'length']) {
    map.bindings = map.bindings.filter(b => !(b.nodeId === id && b.field === field))
  }
  map.bindings.push({ role: 'prompt', nodeId: id, field: 'prompt' })
  if (input.audioEnabled !== undefined) {
    const composers = Object.entries(nodes).filter(([key, n]: [string, any]) => active.has(key) && n?.class_type === 'CreateVideo') as [string, any][]
    if (!composers.length) throw new Error('[comfyui] 当前 H3 工作流没有可控制的音轨封装节点。')
    for (const [, composer] of composers) {
      if (input.audioEnabled) {
        if (!Array.isArray(composer.inputs.audio)) throw new Error('[comfyui] 当前 H3 工作流未连接音频解码器，无法开启输出音轨。')
      } else delete composer.inputs.audio
    }
  }
  return { nativeH3: true, adapter: { ...adapter, workflowTemplate: JSON.stringify(payload), inputMap: map } }
}
