<script setup lang="ts">
import { computed, ref } from 'vue'
import { useProjectStore, useSettingsStore } from '@/stores'
import { isNodeRunning } from '@/services/canvas/jobs'
import { resolvedCanvasReferenceAssetIds } from '@/services/canvas/references'
import { VIDEO_GENERATION_MODES, videoNodeCapabilities, videoNodeMode, videoNodeReferenceIds, videoModeLabel } from '@/services/ai/videoNodeCapabilities'
import { bindLegacyVideoReferences } from '@/services/ai/videoReferenceTokens'
import { referenceAudioIds, videoReferenceBindings } from '@/services/canvas/videoReferences'
import type { VideoGenerationMode } from '@/types'
import GenerationSettingsPopover from '@/components/common/GenerationSettingsPopover.vue'
const props = defineProps<{ nodeId: string }>()
const project = useProjectStore(), settings = useSettingsStore()
const panel = ref<InstanceType<typeof GenerationSettingsPopover>>()
const node = computed(() => project.current?.canvas?.nodes.find(n => n.id === props.nodeId))
const profile = computed(() => node.value?.data.videoProfileId ? settings.config.videos.find(p => p.id === node.value?.data.videoProfileId) : settings.config.video)
const caps = computed(() => videoNodeCapabilities(node.value?.data || {}, profile.value))
const mode = computed(() => videoNodeMode(node.value?.data || {}, caps.value))
const busy = computed(() => isNodeRunning(props.nodeId))
function choose(value: VideoGenerationMode) {
  if (!node.value || busy.value || !caps.value.modes.includes(value) || !project.current) return
  const refs = resolvedCanvasReferenceAssetIds(project.current, node.value)
  const currentRefs = videoNodeReferenceIds(node.value.data, caps.value, refs, referenceAudioIds(node.value.data))
  const boundPrompt = bindLegacyVideoReferences(node.value.data.prompt || '', videoReferenceBindings(currentRefs.images, currentRefs.audios, ['image', 'first-last', 'text'].includes(mode.value) ? [] : node.value.data.videoReferenceOrder))
  project.patchCanvasNode(props.nodeId, { prompt: boundPrompt, videoGenerationMode: value, h3GenMode: value === 'first-last' ? 'fl2va' : 'reference', videoTaskId: undefined,
    ...((value === 'image' || value === 'first-last' || value === 'audio-sync') ? { firstFrameAssetId: node.value.data.firstFrameAssetId || refs[0] } : {}),
    ...(value === 'first-last' ? { lastFrameAssetId: node.value.data.lastFrameAssetId || refs[1] } : {}) })
  panel.value?.close(true)
}
</script>
<template>
  <GenerationSettingsPopover ref="panel" label="视频生成模式" :summary="videoModeLabel(mode)" icon="◫" :disabled="busy">
    <div role="listbox" aria-label="视频生成模式">
      <button v-for="item in VIDEO_GENERATION_MODES" :key="item.value" type="button" class="video-mode-option" role="option"
        :aria-selected="mode === item.value" :disabled="!caps.modes.includes(item.value)" :title="caps.reasons[item.value] || item.description" @click="choose(item.value)">
        <span class="mode-symbol">{{ item.icon }}</span><span><strong>{{ item.label }}</strong><small>{{ caps.reasons[item.value] || item.description }}</small></span><span v-if="mode === item.value">✓</span>
      </button>
    </div>
  </GenerationSettingsPopover>
</template>
<style scoped>
.video-mode-option { display:flex; align-items:center; gap:12px; width:100%; padding:12px 8px; border:0; border-radius:10px; background:transparent; color:var(--color-text-1); text-align:left; cursor:pointer; }
.video-mode-option:hover:not(:disabled), .video-mode-option[aria-selected=true] { background:var(--color-bg-3); }
.video-mode-option:disabled { opacity:.4; cursor:default; }
.video-mode-option > span:nth-child(2) { flex:1; min-width:0; }
.video-mode-option strong { display:block; font-size:12px; font-weight:500; }
.video-mode-option small { display:block; margin-top:4px; font-size:10px; color:var(--color-text-3); line-height:1.5; }
.mode-symbol { width:26px; text-align:center; font-size:19px; }
</style>
