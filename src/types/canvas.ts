import type { TaskStatus } from './pipeline'
// VideoStillMode is declared below and used on CanvasNode.data

export type CanvasNodeType =
  | 'script'
  | 'subject'
  | 'subjectProps'
  | 'scene'
  | 'sceneProps'
  | 'shotBoard'
  | 'shotImage'
  | 'shotFrames'
  | 'shotVideo'
  | 'audio'
  | 'export'
  | 'final'
  | 'groupFrame'
  | 'imageGen'
  | 'videoGen'

/** 图生视频节点模型。默认 H3 15s；h3-v5 为 10 秒且可选 1080p；万相走百炼同一套 Key。 */
export type VideoGenModel = 'h3' | 'h3-v5' | 'wan-prime'

export type H3ImageResolution = 'auto' | '1mp' | '4mp' | '480p' | '720p' | '1080p' | '1440p' | '2160p' | '8mp' | '12mp' | '16mp' | '20mp' | 'custom'

export type VideoResolution = '480p' | '720p' | '768p' | '1080p'

/** H3 出片方式。reference=多图参考（当前默认）；fl2va=首尾帧。 */
export type H3VideoGenMode = 'reference' | 'fl2va'

/**
 * 出视频前的参考图策略。必须在生成视频前按模型定好，画布是否铺「分镜关键帧」也跟它走。
 * identity：只传角色设计图 + 场景图（H3 默认，不经过看板/四宫格，减少多人物）
 * keyframe：人设 + 场景 + 四宫格关键帧（万相及其他模型）
 * storyboard：人设 + 场景 + 故事看板（短剧/电影章节可选）
 */
export type VideoStillMode = 'identity' | 'keyframe' | 'storyboard'

export const DEFAULT_VIDEO_GEN_MODEL: VideoGenModel = 'h3'
export const DEFAULT_H3_GEN_MODE: H3VideoGenMode = 'reference'
export const DEFAULT_VIDEO_STILL_MODE: VideoStillMode = 'identity'

export function normalizeVideoStillMode(value: unknown): VideoStillMode {
  if (value === 'keyframe' || value === 'storyboard') return value
  return 'identity'
}

export function videoStillNeedsCanvas(mode: VideoStillMode): boolean {
  return mode !== 'identity'
}

/** 内置 H3 走人设+场景；万相走关键帧；自定义接入看 profile.stillMode，否则按工作流推断。 */
export function stillModeForVideoModel(
  model: VideoGenModel,
  profile?: { stillMode?: unknown; workflowId?: string; provider?: string } | null
): VideoStillMode {
  if (model === 'wan-prime') return 'keyframe'
  if (model === 'h3-v5') return 'identity'
  const raw = profile?.stillMode
  if (raw === 'identity' || raw === 'keyframe' || raw === 'storyboard') return raw
  const workflow = String(profile?.workflowId || '').toLowerCase()
  const provider = String(profile?.provider || '').toLowerCase()
  if (provider === 'dashscope' || provider === 'dashscope-token-plan' || workflow.includes('wan') || workflow.startsWith('happyhorse-')) return 'keyframe'
  return 'identity'
}

export function normalizeVideoGenModel(value: unknown): VideoGenModel {
  if (value === 'wan-prime') return 'wan-prime'
  if (value === 'h3-v5') return 'h3-v5'
  return 'h3'
}

export function isH3VideoFamily(model: VideoGenModel): boolean {
  return model !== 'wan-prime'
}

export function videoMinSeconds(model: VideoGenModel): number {
  return model === 'wan-prime' ? 2 : 1
}

export function videoMaxSeconds(model: VideoGenModel): number {
  if (model === 'wan-prime') return 30
  if (model === 'h3-v5') return 10
  return 15
}

export function videoMaxRefImages(_model?: VideoGenModel): number {
  return 9
}

export function videoDurationOptions(model: VideoGenModel): number[] {
  const min = videoMinSeconds(model)
  const max = videoMaxSeconds(model)
  return Array.from({ length: max - min + 1 }, (_, i) => min + i)
}

export function videoAllows1080p(model: VideoGenModel): boolean {
  return model === 'h3-v5'
}

export function normalizeVideoResolution(value: unknown, model: VideoGenModel): VideoResolution {
  if (!videoAllows1080p(model)) return '768p'
  if (value === '768p') return '768p'
  return '1080p'
}

export function normalizeH3GenMode(value: unknown): H3VideoGenMode {
  return value === 'fl2va' ? 'fl2va' : 'reference'
}

export interface CanvasNode {
  id: string
  type: CanvasNodeType
  position: { x: number; y: number }
  data: {
    subjectId?: string
    sceneId?: string
    shotId?: string
    label?: string
    width?: number
    height?: number
    kind?: string
    prompt?: string
    referenceAssetIds?: string[]
    /** Optional standalone sound conditioning, independent of image slots and output audio. */
    referenceAudioAssetId?: string
    referenceAudioAssetIds?: string[]
    /** Stable display order across image and audio references. */
    videoReferenceOrder?: string[]
    /** 通过画布连线继承参考图的上游节点，顺序即图1、图2…… */
    referenceSourceNodeIds?: string[]
    outputAssetId?: string
    duration?: number
    /** 节点自己的画幅；为空时只继承项目默认值，不反向修改其他节点。 */
    aspectRatio?: import('./project').AspectRatio
    /** Node-bound image endpoint and API model; global settings only provide initial defaults. */
    imageProfileId?: string
    imageModel?: string
    generationSeed?: number
    /** Image output dimensions; H3 uses a minimum 4MP generation canvas before resizing. */
    imageResolution?: H3ImageResolution
    imageWidth?: number
    imageHeight?: number
    videoModel?: VideoGenModel
    /** 当前节点锁定的视频接入，避免不同供应商配置互相串用。 */
    videoProfileId?: string
    /** 这一镜出视频时用什么参考图；切模型时写入，决定画布是否铺分镜关键帧 */
    videoStillMode?: VideoStillMode
    /** 原生H3：480p/720p/1080p；云端h3-v5：768p/1080p。 */
    videoResolution?: VideoResolution
    /** 原生H3输出音轨；缺省开启。关闭不改变音视频联合采样。 */
    videoAudioEnabled?: boolean
    /** H3：参考图生成（默认）或首尾帧 */
    h3GenMode?: H3VideoGenMode
    firstFrameAssetId?: string
    lastFrameAssetId?: string
    /** AutoDL / 万相进行中任务，重试时先查结果 */
    videoTaskId?: string
  }
  status?: TaskStatus
  error?: string
  parentGroupId?: string
}

export interface CanvasEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string
  targetHandle?: string
}

export interface CanvasGroup {
  id: string
  label: string
  nodeIds: string[]
}

export interface CanvasViewport {
  x: number
  y: number
  zoom: number
}

export interface CanvasGraph {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  groups: CanvasGroup[]
  viewport: CanvasViewport
}

export function emptyCanvas(): CanvasGraph {
  return {
    nodes: [],
    edges: [],
    groups: [],
    viewport: { x: 0, y: 0, zoom: 0.85 }
  }
}
