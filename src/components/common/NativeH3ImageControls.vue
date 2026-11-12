<script setup lang="ts">
import { computed, watchEffect } from 'vue'
import { useProjectStore, useSettingsStore } from '@/stores'
import { isNodeRunning } from '@/services/canvas/jobs'
import { h3ImageOutputSize } from '@/services/ai/comfyH3Image'
import { wan27ImageLimits, wan27ImageSizeIssue } from '@/services/ai/wan27ImageSize'
import { aspectToSize } from '@/utils/aspect'
import type { AspectRatio, CanvasNode, H3ImageResolution } from '@/types'
import GenerationSettingsPopover from './GenerationSettingsPopover.vue'
import GenerationAspectGrid from './GenerationAspectGrid.vue'

const props = withDefaults(defineProps<{ nodeId: string; referenceCount?: number }>(), { referenceCount: 0 })
const project = useProjectStore()
const settings = useSettingsStore()
import { nativeH3Image, nodeImageResolution, imageResolutionOptions, wan27ImageProfile } from '@/services/canvas/nodeGeneration'
const node = computed(() => project.current?.canvas?.nodes.find(item => item.id === props.nodeId))
const busy = computed(() => isNodeRunning(props.nodeId))
const profile = computed(() => node.value?.data.imageProfileId ? settings.config.images.find(p => p.id === node.value?.data.imageProfileId) : settings.config.image)
const h3 = computed(() => nativeH3Image(profile.value))
const model = computed(() => node.value?.data.imageModel || profile.value?.model || '')
const wan = computed(() => wan27ImageProfile({ ...profile.value, model: model.value }))
const limits = computed(() => wan.value ? wan27ImageLimits(model.value, props.referenceCount) : undefined)
const aspectRatio = computed(() => node.value && ['subject', 'scene', 'sceneProps'].includes(node.value.type)
  ? '16:9' : node.value?.data.aspectRatio || project.current?.settings.aspectRatio || '16:9')
const options = computed(() => imageResolutionOptions(profile.value, model.value, aspectRatio.value, props.referenceCount))
const resolution = computed(() => nodeImageResolution(node.value?.data, profile.value, aspectRatio.value, props.referenceCount))
watchEffect(() => {
  if (wan.value && node.value && !busy.value && node.value.data.imageResolution !== resolution.value) {
    project.patchCanvasNode(node.value.id, { imageResolution: resolution.value })
  }
})
const dimensions = computed(() => {
  const item = node.value
  const ratio = aspectRatio.value
  const base = item && ['subject', 'scene', 'sceneProps'].includes(item.type) && resolution.value === 'auto'
    ? { width: 1792, height: 1024 } : aspectToSize(ratio)
  try {
    if (wan.value && resolution.value === 'custom') {
      const issue = wan27ImageSizeIssue(model.value, item?.data.imageWidth!, item?.data.imageHeight!, props.referenceCount)
      if (issue) return { size: undefined, error: issue }
    }
    const size = resolution.value === 'auto' ? base : h3ImageOutputSize(resolution.value, base.width, base.height,
      item?.data.imageWidth, item?.data.imageHeight)
    return { size, error: wan.value ? wan27ImageSizeIssue(model.value, size.width, size.height, props.referenceCount) : '' }
  } catch (error) { return { size: undefined, error: (error as Error).message.replace('[comfyui] ', '') } }
})
const small = computed(() => dimensions.value.size && dimensions.value.size.width * dimensions.value.size.height < 2048 * 2048)
const large = computed(() => dimensions.value.size && dimensions.value.size.width * dimensions.value.size.height > 8 * 1024 * 1024)
const fixedAspect = computed(() => !!node.value && ['subject', 'scene', 'sceneProps'].includes(node.value.type))
const mainOptions = computed(() => {
  const presets = [
    { value: 'auto', label: '默认' }, { value: '1mp', label: '1K' },
    { value: '4mp', label: '2K' }, { value: '16mp', label: '4K' },
    ...(h3.value ? [{ value: '20mp', label: '超4K · 20MP' }] : [])
  ]
  return presets.filter(preset => options.value.some(option => option.value === preset.value))
})
const legacyOptions = computed(() => options.value.filter(option => !mainOptions.value.some(preset => preset.value === option.value)))
const resolutionLabel = computed(() => mainOptions.value.find(option => option.value === resolution.value)?.label
  || options.value.find(option => option.value === resolution.value)?.label || resolution.value)
const summary = computed(() => `${resolution.value === 'custom' ? '自定义' : aspectRatio.value} · ${resolutionLabel.value}`)
function change(patch: Partial<CanvasNode['data']>) {
  if (node.value && !busy.value) project.patchCanvasNode(node.value.id, patch)
}
function selectResolution(value: H3ImageResolution) {
  change({ imageResolution: value, ...(value === 'custom' ? {
    imageWidth: node.value?.data.imageWidth ?? dimensions.value.size?.width ?? 2048,
    imageHeight: node.value?.data.imageHeight ?? dimensions.value.size?.height ?? 2048
  } : {}) })
}
function customSize(field: 'imageWidth' | 'imageHeight', event: Event) {
  const raw = (event.target as HTMLInputElement).value
  if (raw && Number.isFinite(Number(raw))) change({ [field]: Number(raw) })
}
</script>

<template>
  <GenerationSettingsPopover v-if="node" label="图片参数" :summary="summary" :disabled="busy">
    <div class="settings-section">
      <div class="settings-label">清晰度</div>
      <div class="settings-grid">
        <button v-for="option in mainOptions" :key="option.value" type="button" class="settings-option"
          :class="{ on: resolution === option.value }" :aria-pressed="resolution === option.value" :disabled="busy"
          @click="selectResolution(option.value as H3ImageResolution)">{{ option.label }}</button>
      </div>
      <p v-if="mainOptions.some(option => option.value === '1mp')" class="settings-note">按总像素分档：1K≈1MP，2K≈4MP<span v-if="h3">，4K≈16MP</span>；宽高随比例变化。</p>
      <p v-if="dimensions.size" class="settings-note image-output-size" aria-label="图片输出尺寸">{{ dimensions.size.width }}×{{ dimensions.size.height }} · {{ (dimensions.size.width * dimensions.size.height / 1000000).toFixed(1) }}MP</p>
    </div>
    <GenerationAspectGrid :model-value="aspectRatio as AspectRatio" :disabled="busy || resolution === 'custom'" :fixed="fixedAspect"
      @update:model-value="change({ aspectRatio: $event })" />
    <div class="settings-section">
      <label class="settings-label" :for="`image-seed-${nodeId}`">种子</label>
      <input :id="`image-seed-${nodeId}`" class="settings-input" type="number" min="0" step="1" aria-label="图片种子" placeholder="自动随机" :disabled="busy"
        :value="node.data.generationSeed" @change="change({ generationSeed: ($event.target as HTMLInputElement).value === '' ? undefined : Number(($event.target as HTMLInputElement).value) })" />
    </div>
    <details class="settings-section" :open="resolution === 'custom' || !mainOptions.some(option => option.value === resolution)">
      <summary>高级尺寸 / 兼容旧档位</summary>
      <div class="settings-grid advanced-sizes">
        <button v-for="option in legacyOptions" :key="option.value" type="button" class="settings-option"
          :class="{ on: resolution === option.value }" :aria-pressed="resolution === option.value" :disabled="busy"
          @click="selectResolution(option.value)">{{ option.label.replace(' · 2K', '').replace(' · 4K', '') }}</button>
      </div>
      <div v-if="resolution === 'custom'" class="custom-size">
        <input class="settings-input" type="number" aria-label="图片宽度" min="32" max="16384" step="1" :disabled="busy"
          :value="node.data.imageWidth" @change="customSize('imageWidth', $event)" /><span>×</span>
        <input class="settings-input" type="number" aria-label="图片高度" min="32" max="16384" step="1" :disabled="busy"
          :value="node.data.imageHeight" @change="customSize('imageHeight', $event)" />
      </div>
      <p class="settings-note">p 档位按短边计算；自定义宽高决定画幅。</p>
    </details>
    <p v-if="dimensions.error" class="settings-note error" role="alert">{{ dimensions.error }}</p>
    <p v-else-if="limits" class="settings-note">当前模型总像素范围768²–{{ limits.maxPixels === 4096 * 4096 ? '4096²（Pro文生图）' : '2048²' }}，仅显示可用档位。</p>
    <p v-else-if="h3 && small" class="settings-note">H3 低于4MP时细节和构图质量可能下降。</p>
    <p v-else-if="h3 && large" class="settings-note">大图需要更多显存和时间，4K / 20MP尚未在本机实测。</p>
  </GenerationSettingsPopover>
</template>

<style scoped>
.advanced-sizes { margin-top:9px; }
summary { color:var(--color-text-3); cursor:pointer; font-size:11px; }
.custom-size { display:flex; align-items:center; gap:7px; margin-top:9px; }
.custom-size input { min-width:0; }
.image-output-size { font-variant-numeric:tabular-nums; }
</style>
