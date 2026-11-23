import type { Asset, GenerationRecord, Project } from '@/types'

export type StatisticsAsset = Asset & { statisticsProjectIds?: string[] }
export type StatisticsRow = {
  id: string; asset: Asset; record?: GenerationRecord; projectIds: string[]; projectLabel: string
  kind: 'image' | 'video'; createdAt: number; model: string; profile: string; modelKey: string
  mode: string; modeLabel: string; conditionKey: string; conditionLabel: string
  elapsedMs?: number; reasons: string[]; incomplete: string[]; eligible: boolean
}
export type StatisticsFilter = { kind: 'image' | 'video'; projectId?: string; from?: string; to?: string; modelKey?: string; mode?: string }
export type ModelRanking = { key: string; model: string; profile: string; count: number; mean: number; median: number; min: number; max: number; p90?: number; rows: StatisticsRow[] }
const MODES: Record<string, string> = { text: '文生视频', image: '首帧生视频', 'first-last': '首尾帧', reference: '图片参考', 'audio-sync': '数字人口播', omni: '全能参考', 'image-text': '文生图', 'image-edit': '参考图编辑', unknown: '模式未记录' }
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const positive = (v: unknown): v is number => finite(v) && v > 0
const integer = (v: unknown): v is number => finite(v) && Number.isInteger(v) && v >= 0
const known = (v: unknown) => v == null || v === '' ? '未记录' : v
const key = (v: unknown) => JSON.stringify(v)

export function formatElapsed(ms?: number) {
  if (!finite(ms) || ms < 0) return '未记录'
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}秒`
  const seconds = Math.round(ms / 1000)
  return seconds >= 3600 ? `${Math.floor(seconds / 3600)}小时${Math.floor(seconds % 3600 / 60)}分${seconds % 60}秒` : `${Math.floor(seconds / 60)}分${seconds % 60}秒`
}
function modeFor(asset: Asset, r?: GenerationRecord) {
  if (asset.kind === 'image') return integer(r?.referenceCount) ? r!.referenceCount! > 0 ? 'image-edit' : 'image-text' : 'unknown'
  const mode = r?.mode === 'fl2va' ? 'first-last' : r?.mode
  return mode && ['text', 'image', 'first-last', 'reference', 'omni', 'audio-sync'].includes(mode) ? mode : 'unknown'
}

/** One row per asset id. Merge project/library references before deduplicating actual runs. */
export function buildStatisticsRows(assets: StatisticsAsset[], projects: Pick<Project, 'id' | 'name'>[], strict = false): StatisticsRow[] {
  const names = new Map(projects.map(p => [p.id, p.name]))
  const merged = new Map<string, StatisticsAsset>()
  for (const asset of assets) {
    if (!['image', 'video'].includes(asset.kind) || (!asset.generation && asset.source !== 'ai-generated')) continue
    const old = merged.get(asset.id)
    const projectIds = [...new Set([...(old?.statisticsProjectIds || []), ...(asset.statisticsProjectIds || []), ...(asset.projectId ? [asset.projectId] : [])])]
    // Prefer the metadata copy with a generation record; never use current node settings.
    merged.set(asset.id, { ...(old?.generation && (!asset.generation || (!old.library && asset.library)) ? old : asset), statisticsProjectIds: projectIds })
  }
  const rows: StatisticsRow[] = []
  for (const asset of merged.values()) {
    if (asset.kind !== 'image' && asset.kind !== 'video') continue
    const r = asset.generation, reasons: string[] = [], incomplete: string[] = []
    const createdAt = positive(r?.createdAt) ? r!.createdAt : asset.createdAt
    if (!positive(createdAt) || !Number.isFinite(new Date(createdAt).getTime())) reasons.push('生成时间未记录')
    if (!r) reasons.push('原始生成参数未记录')
    if (r?.parametersUnknown) reasons.push('续查旧任务，原始参数或完整计时未知')
    if (r?.simulated) reasons.push('模拟生成')
    if (r && r.kind !== asset.kind) reasons.push('记录与素材类型不一致')
    if (!positive(r?.elapsedMs)) reasons.push('缺少有效耗时')
    if (!r?.model?.trim() || r.model === '未记录') reasons.push('模型未记录')
    if (!positive(asset.width) || !positive(asset.height)) reasons.push('实际输出宽高未记录')
    const mode = modeFor(asset, r)
    if (mode === 'unknown') reasons.push('生成模式未记录')
    if (!integer(r?.referenceCount)) reasons.push('参考图数量未记录')
    if (asset.kind === 'video' && !positive(r?.duration)) reasons.push('请求时长未记录')
    if (r?.simulated == null) incomplete.push('历史运行模式未记录')
    if (r?.outputCount !== 1) incomplete.push(r?.outputCount ? '多输出请求，按请求计时' : '单次输出数未记录')
    if (!r?.profileId && !r?.profileName) incomplete.push('接入未记录')
    if (asset.kind === 'image' && !r?.quality) incomplete.push('质量档位未记录或未公开')
    if (asset.kind === 'video' && !r?.resolution) incomplete.push('清晰度档位未记录')
    const referenceAudioCount = r?.referenceAudios?.length ?? (r?.referenceAudio ? 1 : 0)
    const audio = asset.kind === 'video' ? typeof asset.hasAudio === 'boolean' ? asset.hasAudio ? '有音轨' : '无音轨' : '音轨未记录' : ''
    const conditions: Record<string, unknown> = {
      kind: asset.kind, mode, width: asset.width, height: asset.height,
      references: known(r?.referenceCount), outputCount: known(r?.outputCount), quality: known(r?.quality), style: known(r?.style)
    }
    if (asset.kind === 'video') Object.assign(conditions, { resolution: known(r?.resolution), aspectRatio: known(r?.aspectRatio), duration: known(r?.duration), referenceAudioCount, audio, requestedAudio: known(r?.audioEnabled) })
    if (strict) {
      for (const field of ['steps', 'cfg', 'sampler', 'scheduler', 'denoise', 'fps'] as const) {
        conditions[field] = known(r?.[field])
        if (r?.[field] == null) incomplete.push(`${field}未记录或未公开`)
      }
    }
    const parts = [MODES[mode], `${asset.width || '?'}×${asset.height || '?'}`, `${r?.referenceCount ?? '?'}张参考`]
    if (asset.kind === 'image') parts.push(r?.quality ? `质量 ${r.quality}` : '质量未记录/未公开')
    else parts.push(r?.resolution || '档位未记录', r?.aspectRatio || '比例未记录', `${r?.duration ?? '?'}秒`, audio, `${referenceAudioCount}条参考声音`, `请求音频${r?.audioEnabled == null ? '未记录' : r.audioEnabled ? '开' : '关'}`)
    parts.push(r?.outputCount == null ? '输出数未记录' : `每请求${r.outputCount}个输出`)
    if (r?.style) parts.push(`风格 ${r.style}`)
    if (strict) parts.push(...['steps', 'cfg', 'sampler', 'scheduler', 'denoise', 'fps'].map(field => `${field}=${known(r?.[field as keyof GenerationRecord])}`))
    const model = r?.model || '模型未记录'
    const profile = r?.profileName || r?.provider || '接入未记录'
    const modelKey = key([model, r?.provider || '', r?.profileId || '', r?.profileName || '', r?.adapter || '', [...(r?.checkpoints || [])].sort()])
    const projectIds = asset.statisticsProjectIds || []
    rows.push({ id: asset.id, asset, record: r, projectIds,
      projectLabel: projectIds.map(id => names.get(id) || `已删除/未知项目 ${id}`).join('、') || '共享库 / 未关联项目',
      kind: asset.kind, createdAt,
      model, profile, modelKey, mode, modeLabel: MODES[mode], conditionKey: key(conditions), conditionLabel: parts.join(' · '),
      elapsedMs: r?.elapsedMs, reasons, incomplete, eligible: !reasons.length })
  }
  // Prefer an original project result to a shared-library mirror. Never infer equality from timestamps/prompts.
  rows.sort((a, b) => Number(Boolean(a.asset.library)) - Number(Boolean(b.asset.library)) || a.createdAt - b.createdAt || a.id.localeCompare(b.id))
  const runs = new Map<string, StatisticsRow>()
  for (const row of rows) {
    const r = row.record
    const identity = r?.runId ? key([row.kind, 'run', r.runId]) : r?.promptId ? key([row.kind, r.provider, r.profileId || r.profileName, 'task', r.promptId]) : undefined
    if (identity && row.eligible) {
      const original = runs.get(identity)
      if (original) {
        original.projectIds = [...new Set([...original.projectIds, ...row.projectIds])]
        original.projectLabel = original.projectIds.map(id=>names.get(id)||`已删除/未知项目 ${id}`).join('、') || original.projectLabel
        row.reasons.push('同一生成请求的重复结果'); row.eligible = false
      } else runs.set(identity, row)
    } else if (row.asset.library && !identity && row.eligible) {
      row.reasons.push('共享库副本缺少请求关联，无法可靠去重'); row.eligible = false
    }
  }
  return rows.sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id))
}

export function filterStatisticsRows(rows: StatisticsRow[], filter: StatisticsFilter) {
  const from = filter.from ? new Date(`${filter.from}T00:00:00`).getTime() : -Infinity
  const to = filter.to ? new Date(`${filter.to}T00:00:00`).getTime() : Infinity
  // The end date is inclusive; use the next local calendar day, including DST boundaries.
  const end = filter.to ? (() => { const d = new Date(to); d.setDate(d.getDate() + 1); return d.getTime() })() : Infinity
  return rows.filter(row => row.kind === filter.kind && (!filter.projectId || row.projectIds.includes(filter.projectId)) && (!filter.modelKey || row.modelKey === filter.modelKey) && (!filter.mode || row.mode === filter.mode) && row.createdAt >= from && row.createdAt < end)
}
export function comparisonConditions(rows: StatisticsRow[]) {
  const map = new Map<string, { key: string; label: string; count: number; models: Set<string> }>()
  for (const row of rows.filter(r => r.eligible)) {
    let group = map.get(row.conditionKey)
    if (!group) { group = { key: row.conditionKey, label: row.conditionLabel, count: 0, models: new Set() }; map.set(row.conditionKey, group) }
    group.count++; group.models.add(row.modelKey)
  }
  return [...map.values()].sort((a, b) => b.models.size - a.models.size || b.count - a.count || a.label.localeCompare(b.label))
}
export function rankModels(rows: StatisticsRow[]): ModelRanking[] {
  if (new Set(rows.filter(r => r.eligible).map(r => r.conditionKey)).size > 1) throw new Error('请选择同一组比较条件后再计算排行')
  const groups = new Map<string, StatisticsRow[]>()
  for (const row of rows.filter(r => r.eligible)) {
    const group = groups.get(row.modelKey)
    if (group) group.push(row)
    else groups.set(row.modelKey, [row])
  }
  return [...groups.entries()].map(([key, group]) => {
    const times = group.map(r => r.elapsedMs!).sort((a, b) => a - b), count = times.length
    return { key, model: group[0].model, profile: group[0].profile, count, mean: times.reduce((a,b) => a+b,0)/count,
      median: count % 2 ? times[Math.floor(count/2)] : (times[count/2-1]+times[count/2])/2,
      min: times[0], max: times[count-1], p90: count >= 10 ? times[Math.ceil(count*.9)-1] : undefined, rows: group }
  }).sort((a,b) => a.mean-b.mean || a.model.localeCompare(b.model))
}

/** CSV cells are quoted and spreadsheet formulas are neutralized; prompts are intentionally omitted. */
export function csvTable(rows: unknown[][]) {
  const cell = (v: unknown) => { let text = v == null ? '' : String(v); if (/^\s*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text; return '"' + text.replace(/"/g,'""') + '"' }
  return '\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n')
}
export function statisticsCsv(rows: StatisticsRow[], ranking: ModelRanking[], mode: 'records' | 'ranking', minimumSamples = 3) {
  return mode === 'ranking' ? csvTable([
    ['排名','模型','接入','样本数','样本状态','平均耗时秒','中位数秒','最快秒','最慢秒','P90秒','比较条件'],
    ...ranking.map((g,i) => [g.count >= minimumSamples ? i+1 : '',g.model,g.profile,g.count,g.count >= minimumSamples ? '参与排名' : '样本不足',g.mean/1000,g.median/1000,g.min/1000,g.max/1000,g.p90 == null ? '' : g.p90/1000,g.rows[0]?.conditionLabel])
  ]) : csvTable([
    ['记录ID','生成时间','类型','模型','接入','项目','模式','输出宽','输出高','耗时秒','参与排行','排除原因','参数缺失说明','比较条件'],
    ...rows.map(r => [r.id,Number.isFinite(new Date(r.createdAt).getTime()) ? new Date(r.createdAt).toISOString() : '',r.kind,r.model,r.profile,r.projectLabel,r.modeLabel,'width' in r.asset ? r.asset.width : '', 'height' in r.asset ? r.asset.height : '',positive(r.elapsedMs) ? r.elapsedMs/1000 : '',r.eligible?'是':'否',r.reasons.join('；'),r.incomplete.join('；'),r.conditionLabel])
  ])
}
