<script setup lang="ts">
import { isWan3VideoProfile } from '@/services/ai/dashscopeMedia'
import { computed } from 'vue'
import { useProjectStore, useSettingsStore } from '@/stores'
import { videoNodeCapabilities, videoNodeDuration, videoBatchCount } from '@/services/ai/videoNodeCapabilities'
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
const modeCaps = computed(() => videoNodeCapabilities(node.value?.data || {}, profile.value))
const wan3 = computed(() => model.value === 'h3' && isWan3VideoProfile(profile.value))
const autoAspect = computed(() => wan3.value && node.value?.data.videoAspectAuto === true)
const standalone = computed(() => node.value?.type === 'videoGen')
const count = computed(() => videoBatchCount(node.value?.data.videoCount))
const min = computed(() => standalone.value || modeCaps.value.autodlWorkflow ? modeCaps.value.min : videoMinSeconds(model.value))
const max = computed(() => standalone.value || modeCaps.value.autodlWorkflow ? modeCaps.value.max : videoMaxSeconds(model.value))
const duration = computed(() => standalone.value ? videoNodeDuration(node.value?.data.duration, modeCaps.value) : Math.min(max.value, Math.max(min.value, Math.round(Number(
  node.value?.type === 'shotVideo' ? shot.value?.duration : node.value?.data.duration) || 8))))
const size = computed(() => {
  const base = aspectToSize(aspect.value)
  return nativeH3VideoSize(normalizeNativeH3Resolution(resolution.value), base.width, base.height)
})
const summary = computed(() => `${standalone.value && !modeCaps.value.aspectControl ? '工作流比例' : autoAspect.value ? '自适应' : aspect.value} · ${resolution.value === 'workflow' ? '工作流尺寸' : resolution.value.toUpperCase()} · ${modeCaps.value.audioSync ? '音频驱动' : standalone.value && !modeCaps.value.durationControl ? '工作流时长' : `${duration.value}s`}${capabilities.value.native && (!standalone.value || modeCaps.value.audioOutput) ? audioEnabled.value ? ' · 有声' : ' · 无声' : ''}${standalone.value && count.value > 1 ? ` · ${count.value}条` : ''}`)
function change(patch: Partial<CanvasNode['data']>) {
  if (!node.value || busy.value) return
  project.patchCanvasNode(node.value.id, { ...patch, videoTaskId: undefined })
  if (shot.value) project.updateShot(shot.value.id, { videoTaskId: undefined })
}
function setDuration(raw: string) {
  if (busy.value || !node.value) return
  const value = standalone.value ? videoNodeDuration(raw, modeCaps.value) : Math.min(max.value, Math.max(min.value, Math.round(Number(raw) || min.value)))
  if (node.value.type === 'shotVideo' && shot.value) project.updateShot(shot.value.id, { duration: value, videoTaskId: undefined })
  else change({ duration: value })
}
</script>

<template>
  <GenerationSettingsPopover v-if="available" label="视频参数" :summary="summary" :disabled="busy">
    <GenerationAspectGrid v-if="!standalone || modeCaps.aspectControl" :model-value="aspect" :ratios="standalone || wan3 || modeCaps.autodlWorkflow ? modeCaps.ratios : undefined" :allow-auto="wan3" :auto-selected="autoAspect" :disabled="busy" @select-auto="change({ videoAspectAuto: true })" @update:model-value="change({ aspectRatio: $event, videoAspectAuto: false })" />
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
    <div v-if="(!standalone || modeCaps.durationControl) && !modeCaps.audioSync" class="settings-section">
      <label class="settings-label" :for="`video-duration-${nodeId}`"><span>视频时长</span><span>{{ duration }}s</span></label>
      <input v-if="!standalone || !modeCaps.durations" :id="`video-duration-${nodeId}`" class="duration-range" type="range" aria-label="视频时长" :min="min" :max="max" step="1"
        :value="duration" :disabled="busy" @input="setDuration(($event.target as HTMLInputElement).value)" />
      <div v-if="standalone && modeCaps.durations" class="settings-grid video-duration-options">
        <button v-for="seconds in modeCaps.durations" :key="seconds" type="button" class="settings-option" :class="{ on: duration === seconds }" :aria-pressed="duration === seconds" :disabled="busy" @click="setDuration(String(seconds))">{{ seconds }}s</button>
      </div>
      <div v-else class="duration-bounds"><span>{{ min }}s</span><span>{{ max }}s</span></div>
    </div>
    <div v-if="capabilities.native && (!standalone || modeCaps.audioOutput)" class="settings-section">
      <div class="settings-label">生成音频</div>
      <div class="settings-grid two">
        <button v-for="value in [true, false]" :key="String(value)" class="settings-option" type="button"
          :class="{ on: audioEnabled === value }" :aria-pressed="audioEnabled === value" :disabled="busy"
          @click="change({ videoAudioEnabled: value })">{{ value ? '开启' : '关闭' }}</button>
      </div>
      <p class="settings-note">关闭后成片不带音轨，H3仍执行音视频联合采样。</p>
    </div>
    <p v-if="(standalone || modeCaps.autodlWorkflow) && modeCaps.note" class="settings-note">{{ modeCaps.note }}</p>
    <div v-if="standalone" class="settings-section video-count-section">
      <div class="settings-label">生成数量</div>
      <div class="settings-grid"><button v-for="value in [1, 2, 4]" :key="value" type="button" class="settings-option" :class="{ on: count === value }" :aria-pressed="count === value" :disabled="busy" @click="change({ videoCount: value })">{{ value }}条</button></div>
      <p class="settings-note">逐条生成并保存，所需时间及用量随数量增加。</p>
    </div>
  </GenerationSettingsPopover>
</template>

<style scoped>
.duration-range { width:100%; height:20px; margin:5px 0; accent-color:var(--color-accent, #94b9ff); cursor:pointer; }
.duration-bounds { display:flex; justify-content:space-between; color:var(--color-text-3); font-size:10px; }
</style>
