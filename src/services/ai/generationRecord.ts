import { displayVideoReferenceTokens, type VideoReferenceBinding } from './videoReferenceTokens'
import type { GenerationRecord } from '@/types'

/** Whitelist generation facts; never persist endpoints, authentication, headers or whole profiles. */
export function generationRecord(kind: 'image' | 'video', cfg: { id?: string; name?: string; model?: string; workflowId?: string; provider?: string; adapter?: { type?: string } }, input: {
  prompt: string; width: number; height: number; aspectRatio?: string; seed?: number;
  style?: string; duration?: number; videoResolution?: string; h3Resolution?: string; videoAudioEnabled?: boolean;
  referenceAudio?: { assetId?: string; filename?: string };
  referenceAudios?: Array<{ assetId?: string; filename?: string }>;
  referenceBindings?: VideoReferenceBinding[];
  h3GenMode?: string; videoModel?: string; referenceImages?: Blob[]; imageBlob?: Blob; lastFrameBlob?: Blob
}): GenerationRecord {
  return { version: 1, kind, createdAt: Date.now(), profileId: cfg.id, profileName: cfg.name,
    model: cfg.model || cfg.workflowId || input.videoModel || '未记录', provider: cfg.provider,
    adapter: cfg.adapter?.type, prompt: input.prompt, userPrompt: kind === 'video' ? displayVideoReferenceTokens(input.prompt, input.referenceBindings || []) : input.prompt,
    requestedWidth: input.width, requestedHeight: input.height, aspectRatio: input.aspectRatio,
    resolution: kind === 'image' ? input.h3Resolution : input.videoResolution,
    seed: input.seed, style: input.style, duration: input.duration,
    mode: input.h3GenMode, audioEnabled: input.videoAudioEnabled,
    referenceAudio: input.referenceAudio ? { ...input.referenceAudio } : undefined,
    referenceAudios: input.referenceAudios?.map(item => ({ ...item })),
    referenceCount: (input.referenceImages?.length || 0) + (input.imageBlob ? 1 : 0) + (input.lastFrameBlob ? 1 : 0) }
}

/** Read the injected API graph, including its actual sampler seeds rather than the UI draft. */
export function comfyGenerationRecord(payload: any): Partial<GenerationRecord> {
  const graph = payload.prompt || payload
  const roots = Object.keys(graph).filter(id => /SaveImage|SaveVideo|VideoCombine/.test(graph[id]?.class_type || ''))
  const active = new Set<string>()
  const visit = (id: string) => {
    if (active.has(id) || !graph[id]) return
    active.add(id)
    const scan = (value: any) => {
      if (Array.isArray(value) && typeof value[0] === 'string' && graph[value[0]] && typeof value[1] === 'number') visit(value[0])
      else if (value && typeof value === 'object') Object.values(value).forEach(scan)
    }
    scan(graph[id].inputs)
  }
  roots.forEach(visit)
  const nodes: any[] = roots.length ? [...active].map(id => graph[id]) : Object.values(graph)
  const samplers = nodes.filter(n => /KSampler|SamplerCustom|RandomNoise|BasicScheduler|CFGGuider/.test(n?.class_type || '')).map(n => {
    const fields: Record<string, string | number | boolean> = {}
    for (const key of ['seed', 'noise_seed', 'steps', 'cfg', 'sampler_name', 'scheduler', 'denoise']) {
      const value = n.inputs?.[key]
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') fields[key] = value
    }
    return { type: String(n.class_type), ...fields } as Record<string, string | number | boolean>
  }).filter(item => Object.keys(item).length > 1)
  const scalar = (key: string) => samplers.find(item => item[key] != null)?.[key]
  const checkpoints = [...new Set(nodes.flatMap(n => ['ckpt_name', 'unet_name', 'model_name', 'clip_name', 'vae_name'].map(key => n?.inputs?.[key]).filter(value => typeof value === 'string' && /\.(safetensors|ckpt|gguf|pt)$/.test(value))))] as string[]
  const canvases = nodes.filter(n => /Empty.*Latent|MiniMaxH3.*Conditioning|MiniMaxH3.*ToVideo/.test(n?.class_type || '') && typeof n.inputs?.width === 'number' && typeof n.inputs?.height === 'number')
  const canvas = canvases[0]?.inputs
  return { samplers, checkpoints, seed: scalar('seed') as number | undefined ?? scalar('noise_seed') as number | undefined,
    steps: scalar('steps') as number | undefined, cfg: scalar('cfg') as number | undefined,
    sampler: scalar('sampler_name') as string | undefined, scheduler: scalar('scheduler') as string | undefined,
    denoise: scalar('denoise') as number | undefined,
    generationWidth: canvas?.width, generationHeight: canvas?.height,
    fps: nodes.find(n => n.class_type === 'CreateVideo')?.inputs?.fps }
}
