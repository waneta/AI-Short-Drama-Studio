<script setup lang="ts">
import { imageModelCapabilities, imageFixedSize, seedreamRequestSize, imageBatchCount, IMAGE_QUALITY_LABELS } from '@/services/ai/imageModelCapabilities'
import { computed, watchEffect } from 'vue'
import { useProjectStore, useSettingsStore } from '@/stores'
import { isNodeRunning } from '@/services/canvas/jobs'
import { h3ImageOutputSize } from '@/services/ai/comfyH3Image'
import { seedream5OutputSize } from '@/services/ai/seedream5ImageSize'
import { gptImageOutputSize, GPT_IMAGE_STANDARD_RATIOS } from '@/services/ai/gptImageSize'
import { wan27ImageLimits, wan27ImageSizeIssue } from '@/services/ai/wan27ImageSize'
import { aspectToSize } from '@/utils/aspect'
import type { AspectRatio, CanvasNode, H3ImageResolution } from '@/types'
import GenerationSettingsPopover from './GenerationSettingsPopover.vue'
import GenerationAspectGrid from './GenerationAspectGrid.vue'

const props = withDefaults(defineProps<{ nodeId: string; referenceCount?: number; includeBatch?: boolean }>(), { referenceCount: 0 })
const project = useProjectStore()
const settings = useSettingsStore()
import { nativeH3Image, nodeImageResolution, imageResolutionOptions, wan27ImageProfile } from '@/services/canvas/nodeGeneration'
const node = computed(() => project.current?.canvas?.nodes.find(item => item.id === props.nodeId))
const busy = computed(() => isNodeRunning(props.nodeId))
const profile = computed(() => node.value?.data.imageProfileId ? settings.config.images.find(p => p.id === node.value?.data.imageProfileId) : settings.config.image)
const h3 = computed(() => nativeH3Image(profile.value))
const model = computed(() => node.value?.data.imageModel || profile.value?.model || '')
const capability = computed(() => imageModelCapabilities(profile.value, model.value))
const gptPrimaryRatios = [...GPT_IMAGE_STANDARD_RATIOS]
const gptMoreRatios = computed(() => capability.value.ratios.filter(ratio => !gptPrimaryRatios.some(value => value === ratio)))
const quality = computed(() => capability.value.qualities.includes(node.value?.data.imageQuality || '') ? node.value!.data.imageQuality! : 'auto')
const count = computed(() => imageBatchCount(node.value?.data.imageCount))
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
    if (capability.value.seedream5) return {
      size: seedream5OutputSize(resolution.value, ratio, { width: item?.data.imageWidth, height: item?.data.imageHeight }), error: ''
    }
    if (capability.value.mode === 'gpt') return {
      size: gptImageOutputSize(model.value, ratio, resolution.value === 'custom'
        ? { width: item?.data.imageWidth, height: item?.data.imageHeight } : undefined), error: ''
    }
    if (wan.value && resolution.value === 'custom') {
      const issue = wan27ImageSizeIssue(model.value, item?.data.imageWidth!, item?.data.imageHeight!, props.referenceCount)
      if (issue) return { size: undefined, error: issue }
    }
    if (capability.value.mode === 'relay') return { size: undefined, error: '' }
    const fixedSize = imageFixedSize(profile.value, model.value, ratio)
    if (fixedSize) return { size: fixedSize, error: '' }
    const size = resolution.value === 'auto' ? base : h3ImageOutputSize(resolution.value, base.width, base.height,
      item?.data.imageWidth, item?.data.imageHeight)
    return { size: capability.value.mode === 'seedream' ? seedreamRequestSize(size.width, size.height) : size, error: wan.value ? wan27ImageSizeIssue(model.value, size.width, size.height, props.referenceCount) : '' }
  } catch (error) { return { size: undefined, error: (error as Error).message.replace('[comfyui] ', '') } }
})
const small = computed(() => dimensions.value.size && dimensions.value.size.width * dimensions.value.size.height < 2048 * 2048)
const large = computed(() => dimensions.value.size && dimensions.value.size.width * dimensions.value.size.height > 8 * 1024 * 1024)
const fixedAspect = computed(() => !!node.value && ['subject', 'scene', 'sceneProps'].includes(node.value.type))
const mainOptions = computed(() => {
  if (wan.value || capability.value.seedream5) return options.value.filter(option => option.value !== 'custom')
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
const summary = computed(() => [resolution.value === 'custom' ? '自定义' : aspectRatio.value, ...(capability.value.qualities.length ? [IMAGE_QUALITY_LABELS[quality.value]] : []),
  capability.value.mode === 'gpt' ? dimensions.value.size ? `${dimensions.value.size.width}×${dimensions.value.size.height}` : '尺寸待调整' : resolutionLabel.value,
  ...(props.includeBatch ? [`${count.value}张`] : [])].join(' · '))
function change(patch: Partial<CanvasNode['data']>) {
  if (node.value && !busy.value) project.patchCanvasNode(node.value.id, patch)
}
function selectResolution(value: H3ImageResolution) {
  change({ imageResolution: value, ...(value === 'custom' ? {
    imageWidth: node.value?.data.imageWidth ?? dimensions.value.size?.width ?? 2048,
    imageHeight: node.value?.data.imageHeight ?? dimensions.value.size?.height ?? 2048
  } : {}) })
}
function selectAspect(value: AspectRatio) {
  change({ aspectRatio: value, ...(capability.value.mode === 'gpt' ? { imageResolution: 'auto' as const } : {}) })
}
function customSize(field: 'imageWidth' | 'imageHeight', event: Event) {
  const raw = (event.target as HTMLInputElement).value
  if (capability.value.gptCustomSize || capability.value.seedream5) { change({ [field]: raw && Number.isFinite(Number(raw)) ? Number(raw) : undefined }); return }
  if (raw && Number.isFinite(Number(raw))) change({ [field]: Number(raw) })
}
</script>

<template>
  <GenerationSettingsPopover v-if="node" label="图片参数" :summary="summary" :disabled="busy">
    <div v-if="capability.qualities.length" class="settings-section image-quality-section">
      <div class="settings-label">画质</div>
      <div class="settings-grid"><button v-for="value in capability.qualities" :key="value" type="button" class="settings-option" :class="{ on: quality === value }" :aria-pressed="quality === value" @click="change({ imageQuality: value })">{{ IMAGE_QUALITY_LABELS[value] }}</button></div>
    </div>
    <div class="settings-section">
      <div class="settings-label">{{ ['gpt', 'fixed', 'legacy'].includes(capability.mode) ? '输出尺寸' : '清晰度' }}</div>
      <div v-if="options.length > 1 && capability.mode !== 'gpt'" class="settings-grid">
        <button v-for="option in mainOptions" :key="option.value" type="button" class="settings-option"
          :class="{ on: resolution === option.value }" :aria-pressed="resolution === option.value" :disabled="busy"
          @click="selectResolution(option.value as H3ImageResolution)">{{ option.label }}</button>
      </div>
      <p v-if="capability.mode !== 'relay' && !capability.seedream5 && mainOptions.some(option => option.value === '1mp')" class="settings-note">按总像素分档：1K≈1MP，2K≈4MP<span v-if="h3">，4K≈16MP</span>；宽高随比例变化。</p>
      <p v-if="dimensions.size" class="settings-note image-output-size" aria-label="图片输出尺寸">{{ dimensions.size.width }}×{{ dimensions.size.height }} · {{ (dimensions.size.width * dimensions.size.height / 1000000).toFixed(1) }}MP</p>
    </div>
    <p v-if="capability.mode === 'relay'" class="settings-note">清晰度按当前中转接入的1K / 2K / 4K规格提交。</p>
    <p v-if="capability.note" class="settings-note">{{ capability.note }}</p>
    <GenerationAspectGrid :ratios="capability.gptCustomSize ? gptPrimaryRatios : capability.ratios" :model-value="(capability.mode === 'gpt' && resolution === 'custom' ? '' : aspectRatio) as AspectRatio"
      :disabled="busy || (resolution === 'custom' && capability.mode !== 'gpt')" :fixed="fixedAspect" @update:model-value="selectAspect" />
    <details v-if="capability.gptCustomSize" class="settings-section gpt-more-sizes"
      :open="resolution === 'custom' || gptMoreRatios.includes(aspectRatio as AspectRatio)">
      <summary>更多 · 比例与自定义尺寸</summary>
      <div class="gpt-more-content">
        <GenerationAspectGrid :ratios="gptMoreRatios" :model-value="(capability.mode === 'gpt' && resolution === 'custom' ? '' : aspectRatio) as AspectRatio" :disabled="busy" :fixed="fixedAspect" @update:model-value="selectAspect" />
        <button type="button" class="settings-option gpt-custom-size" :class="{ on: resolution === 'custom' }" :aria-pressed="resolution === 'custom'" :disabled="busy" @click="selectResolution('custom')">手动输入宽高</button>
        <div v-if="resolution === 'custom'" class="custom-size">
          <label>宽<input class="settings-input" type="number" aria-label="图片宽度" min="16" max="3840" step="16" :disabled="busy" :value="node.data.imageWidth" @change="customSize('imageWidth', $event)" /></label><span>×</span>
          <label>高<input class="settings-input" type="number" aria-label="图片高度" min="16" max="3840" step="16" :disabled="busy" :value="node.data.imageHeight" @change="customSize('imageHeight', $event)" /></label>
        </div>
        <p class="settings-note">宽高均为16的倍数，单边≤3840，比例1:3–3:1，总像素约0.66–8.29MP。预设比例自动填入符合要求的尺寸。</p>
      </div>
    </details>
    <div v-if="includeBatch" class="settings-section image-count-section">
      <div class="settings-label">生成数量</div>
      <div class="settings-grid"><button v-for="value in [1, 2, 4]" :key="value" type="button" class="settings-option" :class="{ on: count === value }" :aria-pressed="count === value" @click="change({ imageCount: value })">{{ value }}张</button></div>
      <p v-if="count > 1" class="settings-note">每张单独生成，全部保存在本节点；用时与用量随张数增加。</p>
    </div>
    <div v-if="capability.seed" class="settings-section">
      <label class="settings-label" :for="`image-seed-${nodeId}`">种子</label>
      <input :id="`image-seed-${nodeId}`" class="settings-input" type="number" min="0" step="1" aria-label="图片种子" placeholder="自动随机" :disabled="busy"
        :value="node.data.generationSeed" @change="change({ generationSeed: ($event.target as HTMLInputElement).value === '' ? undefined : Number(($event.target as HTMLInputElement).value) })" />
    </div>
    <details v-if="legacyOptions.length && capability.mode !== 'gpt'" class="settings-section" :open="resolution === 'custom' || !mainOptions.some(option => option.value === resolution)">
      <summary>{{ capability.seedream5 ? '自定义尺寸' : '高级尺寸 / 兼容旧档位' }}</summary>
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
      <p v-if="capability.seedream5" class="settings-note">自定义宽高决定画幅；宽高为正整数，总像素约0.92–4.62MP，比例1:16–16:1。</p>
      <p v-else class="settings-note">p 档位按短边计算；自定义宽高决定画幅。</p>
    </details>
    <p v-if="dimensions.error" class="settings-note error" role="alert">{{ dimensions.error }}</p>
    <p v-else-if="capability.gptCustomSize && dimensions.size && dimensions.size.width * dimensions.size.height > 3686400" class="settings-note">超过2560×1440总像素的尺寸属于实验范围，生成时间和费用可能增加。</p>
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
.gpt-more-content { margin-top:12px; }.gpt-custom-size { width:100%; }.custom-size label { flex:1; min-width:0; font-size:11px; color:var(--color-text-3); }.custom-size label input { display:block; margin-top:5px; }
</style>
