<script setup lang="ts">
import { computed, ref } from 'vue'
import { isNodeRunning } from '@/services/canvas/jobs'
import { autodlWorkflowForProfile } from '@/services/ai/autodl'
import { VIDEO_DEFAULT_WORKFLOW_ID, VIDEO_H3_V5_10S_WORKFLOW_ID } from '@/services/ai/env'
import { autodlVideoProfileId } from '@/services/ai/runtime'
import GenerationSettingsPopover from '@/components/common/GenerationSettingsPopover.vue'
import ParamSelect from '@/components/common/ParamSelect.vue'
import { normalizeVideoGenModel, stillModeForVideoModel, type VideoGenModel } from '@/types'
import { useSettingsStore } from '@/stores'

const props = withDefaults(
  defineProps<{
    nodeId?: string
    modelValue?: VideoGenModel | string
    profileId?: string
    label?: string
    menu?: boolean
  }>(),
  { label: '模型' }
)

const emit = defineEmits<{
  'update:modelValue': [value: VideoGenModel]
  'selectProfile': [profileId: string]
}>()
const settings = useSettingsStore()

const value = computed(() => {
  const m = normalizeVideoGenModel(props.modelValue)
  if (props.profileId && autodlWorkflowForProfile(settings.config.videos.find(p => p.id === props.profileId))) return props.profileId
  if (m === 'wan-prime' || m === 'h3-v5') return m
  if (props.profileId && settings.config.videos.some((profile) => profile.id === props.profileId)) {
    return props.profileId
  }
  if (props.profileId) return props.profileId
  return 'h3'
})

function profileLabel(profile: { name: string; provider?: string; baseUrl?: string; adapter?: { type?: string } }) {
  const zealman = profile.provider === 'zealman' || profile.adapter?.type === 'zealman-workflow'
  const autodl = !zealman && (profile.provider === 'autodl' || /autodl\.art/i.test(profile.baseUrl || ''))
  const tag = zealman ? 'Zealman' : autodl ? 'AutoDL' : ''
  return tag ? `${tag} · ${profile.name}` : profile.name
}

const panel = ref<InstanceType<typeof GenerationSettingsPopover>>()
const search = ref('')
const options = computed(() => [
  ...settings.config.videos.map(p => ({ value: p.id, label: p.name, detail: `${profileLabel(p)} · ${p.workflowId || '自定义工作流'}`, disabled: false })),
  { value: 'h3', label: 'H3 v5 · 15秒', detail: 'AutoDL · 多图参考 · 最长15秒', disabled: !autodlVideoProfileId(VIDEO_DEFAULT_WORKFLOW_ID) },
  { value: 'h3-v5', label: 'H3 v5 · 10秒 1080p', detail: 'AutoDL · 多图参考 · 最长10秒', disabled: !autodlVideoProfileId(VIDEO_H3_V5_10S_WORKFLOW_ID) },
  { value: 'wan-prime', label: '万相 3.0 Prime', detail: '百炼 · 单张首帧 / 最多10图参考', disabled: false }
])
const filtered = computed(() => options.value.filter(item => `${item.label} ${item.detail}`.toLowerCase().includes(search.value.trim().toLowerCase())))
const summary = computed(() => options.value.find(item => item.value === value.value)?.label || '原接入已删除，请选择模型')

function onPick(v: string) {
  if (props.nodeId && isNodeRunning(props.nodeId)) return
  panel.value?.close(true)
  if (v === 'wan-prime' || v === 'h3-v5' || v === 'h3') {
    emit('update:modelValue', v)
    return
  }
  emit('selectProfile', v)
}
</script>

<template>
  <GenerationSettingsPopover v-if="menu" ref="panel" label="选择视频模型" :summary="summary" icon="✧" :disabled="Boolean(nodeId && isNodeRunning(nodeId))">
    <input v-model="search" class="settings-input video-model-search" type="search" aria-label="搜索视频模型" placeholder="搜索模型或接入" />
    <div role="listbox" aria-label="视频模型">
      <button v-for="item in filtered" :key="item.value" class="video-model-option" type="button" role="option"
        :aria-selected="value === item.value" :disabled="item.disabled" @click="onPick(item.value)">
        <span class="model-symbol">▶</span><span><strong>{{ item.label }}</strong><small>{{ item.disabled ? '请先配置AutoDL接入' : item.detail }}</small></span><span v-if="value === item.value">✓</span>
      </button>
      <p v-if="!filtered.length" class="settings-note">没有匹配的模型</p>
    </div>
  </GenerationSettingsPopover>
  <ParamSelect v-else :disabled="Boolean(nodeId && isNodeRunning(nodeId))" :label="label" max-width="260px" :model-value="value" @update:model-value="onPick">
    <option v-if="profileId && !settings.config.videos.some(p => p.id === profileId)" :value="profileId" disabled>原视频接入已删除，请重新选择</option>
    <optgroup v-if="settings.config.videos.length" label="已配置的视频接入">
      <option v-for="p in settings.config.videos" :key="p.id" :value="p.id">
        {{ profileLabel(p) }}{{ stillModeForVideoModel('h3', p) === 'keyframe' ? ' · 关键帧' : stillModeForVideoModel('h3', p) === 'storyboard' ? ' · 看板' : '' }}
      </option>
    </optgroup>
    <optgroup label="工作流（用设置里的 AutoDL 令牌）">
      <option value="h3" :disabled="!autodlVideoProfileId(VIDEO_DEFAULT_WORKFLOW_ID)">
        H3 v5 · 15秒（AutoDL 快捷选择）
      </option>
      <option value="h3-v5" :disabled="!autodlVideoProfileId(VIDEO_H3_V5_10S_WORKFLOW_ID)">H3 v5 · 10秒 1080p（人设+场景）</option>
      <option value="wan-prime">万相 3.0 Prime（需关键帧）</option>
    </optgroup>
  </ParamSelect>
</template>

<style scoped>
.video-model-search { margin-bottom:10px; }
.video-model-option { width:100%; display:flex; align-items:center; gap:10px; border:0; border-radius:10px; padding:10px 8px; color:var(--color-text-1); background:transparent; text-align:left; cursor:pointer; }
.video-model-option:hover:not(:disabled), .video-model-option[aria-selected=true] { background:var(--color-bg-3); }
.video-model-option:disabled { opacity:.4; cursor:default; }
.video-model-option > span:nth-child(2) { flex:1; min-width:0; }
.video-model-option strong { display:block; font-size:12px; font-weight:500; }
.video-model-option small { display:block; margin-top:3px; color:var(--color-text-3); font-size:10px; overflow-wrap:anywhere; }
.model-symbol { display:grid; place-items:center; width:32px; height:32px; flex:0 0 32px; border-radius:9px; background:var(--color-bg-2); }
</style>
