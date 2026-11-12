import type { AppSettings, VideoProfile } from '@/stores/settings'

/** Add an explicitly configured local deployment profile once, after reading saved settings. */
export function applyStartupVideoProfile(settings: AppSettings, raw: string): AppSettings {
  if (!raw.trim()) return settings
  let profile: VideoProfile
  try {
    profile = JSON.parse(raw) as VideoProfile
    const address = new URL(profile.baseUrl)
    if (!profile.id?.trim() || !profile.name?.trim() ||
        !['http:', 'https:'].includes(address.protocol) || address.username || address.password ||
        profile.apiKey !== '' || profile.provider !== 'custom' ||
        profile.adapter?.type !== 'comfyui-prompt' || !profile.adapter.workflowTemplate?.trim() ||
        !profile.adapter.inputMap?.bindings?.length || !profile.workflowId?.trim() ||
        !['identity', 'keyframe', 'storyboard'].includes(profile.stillMode) ||
        !['scene-narrative', 'formatted'].includes(profile.promptStyle)) {
      throw new Error('Invalid startup video profile')
    }
    JSON.parse(profile.adapter.workflowTemplate)
  } catch {
    console.warn('[settings] Ignoring invalid startup video profile')
    return settings
  }
  const applied = Array.isArray(settings.appliedStartupVideoProfileIds)
    ? settings.appliedStartupVideoProfileIds : []
  if (applied.includes(profile.id)) return settings

  // Existing IDs belong to the user: never replace their name, workflow or credentials.
  const selected = settings.videos.find(item => item.id === profile.id) || profile
  const { id, name: _name, ...video } = selected
  return {
    ...settings,
    videos: settings.videos.some(item => item.id === id) ? settings.videos : [...settings.videos, selected],
    activeVideoId: id,
    video,
    defaultVideoModel: undefined,
    appliedStartupVideoProfileIds: [...applied, id]
  }
}
