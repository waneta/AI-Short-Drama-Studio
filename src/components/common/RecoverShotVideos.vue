<script setup lang="ts">
import { computed, ref } from 'vue'
import { useProjectStore, useToastStore } from '@/stores'
import { recoverableTtsVideoShots, recoverMissingTtsVideos } from '@/services/canvas/recoverShotVideos'
const props = defineProps<{ disabled?: boolean }>()
const emit = defineEmits<{ restored: [] }>()
const project = useProjectStore(), toast = useToastStore(), busy = ref(false)
const candidates = computed(() => recoverableTtsVideoShots(project.current))
async function restore() {
  if (busy.value || props.disabled) return
  busy.value = true
  try {
    const result = await recoverMissingTtsVideos()
    if (result.restored.length) { toast.success(`已恢复${result.restored.length}镜视频，现有TTS配音已保留。`); emit('restored') }
    if (result.missing.length) toast.warn(`${result.missing.length}镜的历史视频文件无法读取，请在AI视频页选择其他版本。`)
  } catch (error: any) { toast.error(error?.message || '恢复视频失败') }
  finally { busy.value = false }
}
</script>
<template>
  <div v-if="candidates.length" class="video-recovery" role="status">
    <span>{{ candidates.length }} 镜尚未选用视频，但保留了历史版本。可恢复最近可用的视频，保留现有配音和剪辑。</span>
    <button type="button" :disabled="disabled || busy" @click="restore">{{ busy ? '正在恢复…' : `恢复缺失视频（${candidates.length}镜）` }}</button>
  </div>
</template>
<style scoped>
.video-recovery{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 16px;margin:0 0 18px;border:1px solid color-mix(in srgb,var(--color-primary,#7fa7ff) 35%,transparent);border-radius:10px;background:color-mix(in srgb,var(--color-primary,#7fa7ff) 8%,transparent);color:var(--color-text-2);font-size:13px;line-height:1.6}.video-recovery button{flex-shrink:0;padding:8px 12px;border:1px solid var(--color-border);border-radius:8px;background:var(--color-bg-2);color:var(--color-text-1);cursor:pointer}.video-recovery button:disabled{opacity:.5;cursor:default}@media(max-width:700px){.video-recovery{align-items:flex-start;flex-direction:column}}
</style>
