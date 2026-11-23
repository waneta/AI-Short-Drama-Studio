import {
  VIDEO_AUTODL_ROOT,
  VIDEO_DEFAULT_WORKFLOW_ID,
  VIDEO_DIGITAL_HUMAN_WORKFLOW_ID,
  VIDEO_FL2VA_WORKFLOW_ID,
  VIDEO_H3_V5_10S_WORKFLOW_ID
} from './env'

/** AutoDL 固定网关地址，用户只填 Token，不需要碰地址。 */
export const AUTODL_BASE_URL = VIDEO_AUTODL_ROOT

export interface AutodlWorkflow {
  id: string
  name: string
  mode: 'standard' | 'fl2va' | 'audio-sync'
  minDuration: number
  maxDuration: number
  maxImages: number
  /** Public API reference-audio slots; absent means no reference audio. */
  maxAudios?: number
  resolutions: Array<'480p' | '736p' | '768p' | '1080p'>
  ratios: Array<'16:9' | '9:16' | '1:1'>
  note: string
}

/**
 * AutoDL 内置 H3 系列工作流。全部对应 autodl.art 上的现成工作流，
 * 用户只需要在设置里填一次 AutoDL Token。
 */
export const AUTODL_WORKFLOWS: AutodlWorkflow[] = [
  {
    id: VIDEO_DEFAULT_WORKFLOW_ID,
    name: 'H3 图生视频 · 15 秒',
    mode: 'standard',
    minDuration: 1, maxImages: 9, resolutions: ['480p', '768p'], ratios: ['16:9', '9:16', '1:1'],
    maxDuration: 15,
    note: '默认出视频工作流，人设 + 场景参考图直接生成'
  },
  {
    id: VIDEO_H3_V5_10S_WORKFLOW_ID,
    name: 'H3 v5 · 10 秒（可选 1080p）',
    mode: 'standard',
    minDuration: 1, maxImages: 9, resolutions: ['480p', '768p', '1080p'], ratios: ['16:9', '9:16', '1:1'],
    maxDuration: 10,
    note: '画质升级版，支持 1080p 分辨率'
  },
  {
    id: VIDEO_FL2VA_WORKFLOW_ID,
    name: 'H3 首尾帧 · 736p',
    mode: 'fl2va',
    minDuration: 1, maxImages: 2, resolutions: ['736p'], ratios: ['16:9', '9:16', '1:1'],
    maxDuration: 10,
    note: '首帧 + 尾帧两张图中间补运动，镜头衔接用'
  },
  {
    id: VIDEO_DIGITAL_HUMAN_WORKFLOW_ID,
    name: '数字人口播 · 图 + 音频',
    mode: 'audio-sync',
    minDuration: 5, maxImages: 1, resolutions: ['480p', '768p', '1080p'], ratios: ['16:9', '9:16'],
    maxDuration: 15,
    note: '人物图 + 配音音频同步驱动，口播镜头用'
  },
  {
    id: 'minimax_h3_lightx2v',
    name: 'H3 首尾帧 · 15 秒（480p / 768p）',
    mode: 'fl2va',
    minDuration: 1, maxDuration: 15, maxImages: 2,
    resolutions: ['480p', '768p'], ratios: ['16:9', '9:16', '1:1'],
    note: '指定首帧和尾帧，生成两帧间的运动与镜头衔接'
  },
  {
    id: 'minimax_h3_zm_u24',
    name: 'H3 多图多音频 · 升级画质',
    mode: 'standard',
    minDuration: 1, maxDuration: 15, maxImages: 9, maxAudios: 3,
    resolutions: ['480p', '768p'], ratios: ['16:9', '9:16', '1:1'],
    note: '至少1张图，最多9张图＋3段MP3/WAV/FLAC参考声音；使用 @ 按素材栏顺序引用'
  }
]

export function missingAutodlProfiles(profiles: Array<{ id: string; provider?: string; workflowId: string }>, token: string) {
  if (!token.trim()) return []
  return AUTODL_WORKFLOWS.filter(workflow => ['minimax_h3_lightx2v', 'minimax_h3_zm_u24'].includes(workflow.id)
    && !profiles.some(profile => isAutodlProfile(profile) && profile.workflowId === workflow.id))
    .map(workflow => {
      let id = `autodl-${workflow.id}`
      while (profiles.some(profile => profile.id === id)) id += '-new'
      return { id, name: workflow.name, provider: 'autodl', baseUrl: AUTODL_BASE_URL, apiKey: token.trim(),
        workflowId: workflow.id, stillMode: 'identity' as const, promptStyle: 'scene-narrative' as const,
        adapter: { type: 'comfyui-workflow' as const } }
    })
}

export function autodlWorkflowById(id: string): AutodlWorkflow | undefined {
  return AUTODL_WORKFLOWS.find((workflow) => workflow.id === id)
}

export function isAutodlProfile(profile?: { provider?: string; baseUrl?: string; adapter?: { type?: string } }): boolean {
  if (!profile || profile.provider === 'zealman' || profile.adapter?.type === 'zealman-workflow') return false
  try { return profile.provider === 'autodl' || /^(?:www\.)?autodl\.art$/i.test(new URL(profile.baseUrl || '').hostname) }
  catch { return profile.provider === 'autodl' }
}

export function autodlWorkflowForProfile(profile?: { provider?: string; baseUrl?: string; workflowId?: string; adapter?: { type?: string } }) {
  return isAutodlProfile(profile) ? autodlWorkflowById(profile?.workflowId || '') : undefined
}

export function autodlVideoResolution(value: unknown, workflow: AutodlWorkflow) {
  return workflow.resolutions.find(item => item === value) || (workflow.resolutions.includes('768p') ? '768p' : workflow.resolutions[0])
}

export function autodlVideoResolutionValue(value: unknown, ratio: string, workflow: AutodlWorkflow) {
  if (!workflow.ratios.includes(ratio as '16:9')) throw new Error(`[AutoDL] ${workflow.name}不支持比例${ratio}，请重新选择。`)
  const quality = autodlVideoResolution(value, workflow)
  return ratio === '1:1' ? `${quality}(1:1)` : `${quality}${ratio === '9:16' ? '竖' : '横'}`
}
