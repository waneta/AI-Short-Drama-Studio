<script setup lang="ts">
import { computed, ref } from 'vue'
import { useProjectStore, useToastStore } from '@/stores'
import { effectiveShotAudioMode, isDigitalHumanSpeechProject } from '@/utils/shot'
const props = defineProps<{ shotId: string; disabled?: boolean }>()
const project = useProjectStore(), toast = useToastStore(), saving = ref(false)
const shot = computed(() => project.current?.shots.find(s => s.id === props.shotId))
const visible = computed(() => !!shot.value && !isDigitalHumanSpeechProject(project.current) && effectiveShotAudioMode(shot.value) === 'tts')
const mode = computed(() => shot.value?.ttsSourceAudioMode === 'mute' ? 'mute' : 'keep')
async function change(event: Event) {
  if (!shot.value || props.disabled || saving.value) return
  const value = (event.target as HTMLSelectElement).value
  if (value !== 'keep' && value !== 'mute') return
  saving.value = true
  try {
    // Export-only preference: retain the clip, TTS, prompt, generation task and edits.
    project.updateShot(shot.value.id, { ttsSourceAudioMode: value })
    await project.save()
  } catch (error: any) { toast.error(error?.message || '原声选项保存失败') }
  finally { saving.value = false }
}
</script>
<template>
  <div v-if="visible" class="tts-source-audio">
    <label :for="`tts-source-audio-${shotId}`">TTS 原声</label>
    <select :id="`tts-source-audio-${shotId}`" :value="mode" :disabled="disabled || saving" @change="change">
      <option value="keep">保留视频原声＋TTS（默认）</option>
      <option value="mute">去掉全部原声，仅TTS（导出时）</option>
    </select>
    <p v-if="mode === 'keep'">保留环境音及原声中的其他声音，再叠加TTS；不会自动分离旧对白。若有重复人声，可切到“仅TTS”。</p>
    <p v-else>仅导出时静音视频原声，环境音也会去掉；本页预览仍播放原视频文件，TTS配音也保留，可随时改回。</p>
  </div>
</template>
<style scoped>
.tts-source-audio{display:grid;grid-template-columns:auto minmax(0,1fr);align-items:center;gap:6px 10px;margin:9px 0;font-size:12px}.tts-source-audio label{color:var(--color-text-3);white-space:nowrap}.tts-source-audio select{width:100%;min-width:0;height:30px;padding:0 8px;border:1px solid var(--color-border);border-radius:7px;background:var(--color-bg-2);color:var(--color-text-1);font:inherit}.tts-source-audio p{grid-column:1/-1;margin:0;color:var(--color-text-3);font-size:11px;line-height:1.6}.tts-source-audio select:disabled{opacity:.55}
</style>
