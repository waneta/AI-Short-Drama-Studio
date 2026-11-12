import type { AppSettings, ServiceEndpoint } from '@/stores/settings'
import { IMAGE_PROVIDERS, matchProviderId } from '@/services/ai/providers'
import { comfyImageWorkflowModel } from '@/services/ai/comfyImageWorkflow'

/** Older hydration copied the active local workflow into unrelated cloud profiles. */
export function repairImageEndpoint<T extends ServiceEndpoint>(profile: T): T {
  if (profile.adapter?.type !== 'comfyui-prompt' ||
      matchProviderId(profile.baseUrl, IMAGE_PROVIDERS) === 'custom') return profile
  try {
    // Only repair recognized local workflows on built-in cloud API hosts. Custom
    // Comfy servers and other explicitly configured adapters retain their settings.
    if (!comfyImageWorkflowModel(JSON.parse(profile.adapter.workflowTemplate || ''))) return profile
    return { ...profile, adapter: undefined }
  } catch {
    return profile
  }
}

export function repairImageProfiles(settings: AppSettings): AppSettings {
  const images = settings.images.map(repairImageEndpoint)
  const image = repairImageEndpoint(settings.image)
  if (image === settings.image && images.every((profile, i) => profile === settings.images[i])) return settings
  return { ...settings, images, image }
}
