<script setup lang="ts">
import { computed } from 'vue'
import { useProjectStore } from '@/stores'
import { resolvedCanvasReferenceAssetIds } from '@/services/canvas/references'
import FramePairSlots from './FramePairSlots.vue'
import VideoReferenceEditor from './VideoReferenceEditor.vue'
const props = defineProps<{ nodeId: string; disabled?: boolean }>()
const project = useProjectStore()
const node = computed(() => project.current?.canvas?.nodes.find(n => n.id === props.nodeId))
const shot = computed(() => project.current?.shots.find(s => s.id === node.value?.data.shotId))
const image = computed({
  get: () => node.value?.data.firstFrameAssetId || shot.value?.firstFrameAssetId || shot.value?.imageAssetId || (!node.value?.data.videoGenerationMode && project.current ? resolvedCanvasReferenceAssetIds(project.current, node.value)[0] : undefined),
  set: (value: string | undefined) => {
    project.patchCanvasNode(props.nodeId, { firstFrameAssetId: value, videoTaskId: undefined })
    if (shot.value) project.updateShot(shot.value.id, { firstFrameAssetId: value, videoTaskId: undefined })
  }
})
</script>
<template>
  <section class="audio-sync-inputs">
    <p>人物图片</p>
    <FramePairSlots single compact v-model:first-id="image" first-hint="选择人物图片" :disabled="disabled" />
    <p>驱动配音（仅一段）</p>
    <VideoReferenceEditor :node-id="nodeId" audio-only references-only audio-sync :max-audios="1" :allow-audio="true" :disabled="disabled" />
    <p class="audio-sync-note">按上传音频驱动口型；时长按音频确定，短音频补至5秒，超过15秒截取前15秒。此工作流不读取提示词。</p>
  </section>
</template>
<style scoped>
.audio-sync-inputs { display:grid; gap:8px; }
.audio-sync-inputs p { margin:0; color:var(--color-text-3); font-size:11px; line-height:1.6; }
</style>
