<script setup lang="ts">
import { computed } from 'vue'
import { useProjectStore, useSettingsStore } from '@/stores'
import { isNodeRunning } from '@/services/canvas/jobs'
import { nativeH3VideoSize, normalizeNativeH3Resolution } from '@/services/ai/nativeH3VideoSettings'
import { aspectToSize } from '@/utils/aspect'
import { normalizeVideoGenModel, videoMinSeconds, videoMaxSeconds, type CanvasNode, type VideoResolution } from '@/types'
import { videoResolutionOptions } from '@/services/canvas/nodeGeneration'
import GenerationSettingsPopover from './GenerationSettingsPopover.vue'
import GenerationAspectGrid from './GenerationAspectGrid.vue'

const props = defineProps<{ nodeId?: string }>()
const project = useProjectStore()
const settings = useSettingsStore()
const node = computed(() => project.current?.canvas?.nodes.find(item => item.id === props.nodeId))
const profile = computed(() => {
  const id = node.value?.data.videoProfileId
  return id ? settings.config.videos?.find(item => item.id === id) : settings.config.video
})
const available = computed(() => Boolean(node.value && ['videoGen', 'shotVideo'].includes(node.value.type)))
const capabilities = computed(() => videoResolutionOptions(node.value?.data || {}, profile.value))
const resolution = computed(() => capabilities.value.value)
const audioEnabled = computed(() => node.value?.data.videoAudioEnabled !== false)
const busy = computed(() => Boolean(props.nodeId && isNodeRunning(props.nodeId)))
const aspect = computed(() => node.value?.data.aspectRatio || project.current?.settings.aspectRatio || '16:9')
const shot = computed(() => project.current?.shots.find(item => item.id === node.value?.data.shotId))
const model = computed(() => normalizeVideoGenModel(node.value?.data.videoModel))
const min = computed(() => videoMinSeconds(model.value))
const max = computed(() => videoMaxSeconds(model.value))
const duration = computed(() => Math.min(max.value, Math.max(min.value, Math.round(Number(
  node.value?.type === 'shotVideo' ? shot.value?.duration : node.value?.data.duration) || 8))))
const size = computed(() => {
  const base = aspectToSize(aspect.value)
  return nativeH3VideoSize(normalizeNativeH3Resolution(resolution.value), base.width, base.height)
})
const summary = computed(() => `${aspect.value} · ${resolution.value === 'workflow' ? '工作流尺寸' : resolution.value.toUpperCase()} · ${duration.value}s${capabilities.value.native ? audioEnabled.value ? ' · 有声' : ' · 无声' : ''}`)
function change(patch: Partial<CanvasNode['data']>) {
  if (!node.value || busy.value) return
  project.patchCanvasNode(node.value.id, { ...patch, videoTaskId: undefined })
  if (shot.value) project.updateShot(shot.value.id, { videoTaskId: undefined })
}
function setDuration(raw: string) {
  if (busy.value || !node.value) return
  const value = Math.min(max.value, Math.max(min.value, Math.round(Number(raw) || min.value)))
  if (node.value.type === 'shotVideo' && shot.value) project.updateShot(shot.value.id, { duration: value, videoTaskId: undefined })
  else change({ duration: value })
}
</script>

<template>
  <GenerationSettingsPopover v-if="available" label="视频参数" :summary="summary" :disabled="busy">
    <GenerationAspectGrid :model-value="aspect" :disabled="busy" @update:model-value="change({ aspectRatio: $event })" />
    <div class="settings-section">
      <div class="settings-label">清晰度</div>
      <div class="settings-grid">
        <button v-for="option in capabilities.options" :key="option" type="button" class="settings-option"
          :class="{ on: resolution === option }" :aria-pressed="resolution === option" :disabled="busy || capabilities.options.length < 2"
          @click="change({ videoResolution: option as VideoResolution })">{{ option === 'workflow' ? '工作流尺寸' : option.toUpperCase() }}</button>
      </div>
      <p v-if="capabilities.native" class="settings-note">{{ size.width }}×{{ size.height }} · 按模型32像素网格对齐</p>
      <p v-if="capabilities.note" class="settings-note">{{ capabilities.note }}</p>
    </div>
    <div class="settings-section">
      <label class="settings-label" :for="`video-duration-${nodeId}`"><span>视频时长</span><span>{{ duration }}s</span></label>
      <input :id="`video-duration-${nodeId}`" class="duration-range" type="range" aria-label="视频时长" :min="min" :max="max" step="1"
        :value="duration" :disabled="busy" @input="setDuration(($event.target as HTMLInputElement).value)" />
      <div class="duration-bounds"><span>{{ min }}s</span><span>{{ max }}s</span></div>
    </div>
    <div v-if="capabilities.native" class="settings-section">
      <div class="settings-label">生成音频</div>
      <div class="settings-grid two">
        <button v-for="value in [true, false]" :key="String(value)" class="settings-option" type="button"
          :class="{ on: audioEnabled === value }" :aria-pressed="audioEnabled === value" :disabled="busy"
          @click="change({ videoAudioEnabled: value })">{{ value ? '开启' : '关闭' }}</button>
      </div>
      <p class="settings-note">关闭后成片不带音轨，H3仍执行音视频联合采样。</p>
    </div>
  </GenerationSettingsPopover>
</template>

<style scoped>
.duration-range { width:100%; height:20px; margin:5px 0; accent-color:var(--color-accent, #94b9ff); cursor:pointer; }
.duration-bounds { display:flex; justify-content:space-between; color:var(--color-text-3); font-size:10px; }
</style>
