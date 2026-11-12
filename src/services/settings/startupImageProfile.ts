import type { AppSettings, NamedEndpoint } from '@/stores/settings'

/** Apply explicit local deployments once. An array selects its first profile only. */
export function applyStartupImageProfile(settings: AppSettings, raw: string): AppSettings {
  if (!raw.trim()) return settings
  let profiles: NamedEndpoint[]
  try {
    const parsed = JSON.parse(raw)
    profiles = Array.isArray(parsed) ? parsed : [parsed]
    const ids = new Set<string>()
    for (const profile of profiles) {
      const address = new URL(profile.baseUrl)
      if (!profile.id?.trim() || !profile.name?.trim() || !profile.model?.trim() ||
          ids.has(profile.id) || !Array.isArray(profile.models) || !profile.models.includes(profile.model) ||
          !['http:', 'https:'].includes(address.protocol) || address.username || address.password ||
          profile.apiKey !== '' || profile.provider !== 'custom' ||
          profile.adapter?.type !== 'comfyui-prompt' || !profile.adapter.workflowTemplate?.trim() ||
          !profile.adapter.inputMap?.bindings?.length) {
        throw new Error('Invalid startup image profile')
      }
      JSON.parse(profile.adapter.workflowTemplate)
      ids.add(profile.id)
    }
  } catch {
    console.warn('[settings] Ignoring invalid startup image profile')
    return settings
  }
  let result = settings
  profiles.filter(profile => !isRetiredImageProfile(profile)).forEach((profile, index) => {
    const applied = Array.isArray(result.appliedStartupImageProfileIds) ? result.appliedStartupImageProfileIds : []
    if (applied.includes(profile.id)) return
    const selected = result.images.find(item => item.id === profile.id) || profile
    const { id, name: _name, ...image } = selected
    result = {
      ...result,
      images: result.images.some(item => item.id === id) ? result.images : [...result.images, selected],
      ...(index === 0 ? { activeImageId: id, image } : {}),
      appliedStartupImageProfileIds: [...applied, id]
    }
  })
  return result
}

/** Remove uninstalled local models and saved copies of their workflows. */
function isRetiredImageProfile(profile: Partial<NamedEndpoint>): boolean {
  if (profile.id === 'local-flux3-image-klein-int8-20261107') return true
  if (profile.id === 'local-noobai-xl-v1-20261106' || /^noobai-xl(?:$|[-.])/i.test(profile.model || '')) return true
  let local = false
  try {
    const address = new URL(profile.baseUrl || '')
    local = ['127.0.0.1', 'localhost', '[::1]'].includes(address.hostname) && address.port === '8188'
  } catch { /* Profiles without a valid address are not local deployments. */ }
  if (local && /^(?:flux[-_]?3[-_]?(?:image[-_]?)?klein|z[-_]?image[-_]?turbo|sd[-_]?1[._]?5|stable[-_ ]diffusion[-_ ]1[._]5)(?:$|[-_.])/i.test(profile.model || '')) return true
  try {
    const graph = JSON.parse(profile.adapter?.workflowTemplate || '{}')
    return Object.values(graph.prompt || graph).some((node: any) => {
      const inputs = node?.inputs || {}
      if (/(?:^|[/\\])NoobAI-XL[^/\\]*\.safetensors$/i.test(inputs.ckpt_name || '')) return true
      return local && [inputs.unet_name, inputs.ckpt_name, inputs.clip_name, inputs.vae_name].some(file =>
        /(?:^|[/\\])(?:flux3-image-klein-int8-convrot|qwen3vl_4b_int8_convrot|qwen3\.5_9b_flux3_prompt_upsampler_w4a8|flux2-vae|z_image_turbo_bf16|v1-5-pruned-emaonly)\.safetensors$/i.test(file || ''))
    })
  } catch { return false }
}

/** Preserve all other settings and selection; provide a usable endpoint if none remain. */
export function retireUninstalledImageProfiles(settings: AppSettings, fallback: () => NamedEndpoint): AppSettings {
  const kept = settings.images.filter(profile => !isRetiredImageProfile(profile))
  const removedIds = new Set(settings.images.filter(isRetiredImageProfile).map(profile => profile.id))
  removedIds.add('local-noobai-xl-v1-20261106')
  removedIds.add('local-flux3-image-klein-int8-20261107')
  const applied = settings.appliedStartupImageProfileIds?.filter(id => !removedIds.has(id))
  if (kept.length === settings.images.length && !isRetiredImageProfile(settings.image) &&
      applied?.length === settings.appliedStartupImageProfileIds?.length) return settings
  const images = kept.length ? kept : [fallback()]
  const selected = images.find(profile => profile.id === settings.activeImageId) ||
    images.find(profile => /qwen/i.test(profile.model)) || images[0]!
  const { id, name: _name, ...image } = selected
  return { ...settings, images, activeImageId: id, image, appliedStartupImageProfileIds: applied }
}
