<script setup lang="ts">
import { computed } from 'vue'
import { useAssetsStore, useLibraryStore } from '@/stores'
const props = withDefaults(defineProps<{ assetId?: string; label?: string }>(), { label: '本次结果参数' })
const assets = useAssetsStore()
const library = useLibraryStore()
const asset = computed(() => props.assetId ? assets.getMeta(props.assetId) || library.getMeta(props.assetId) : undefined)
const record = computed(() => asset.value?.generation)
const known = computed(() => record.value && !record.value.parametersUnknown)
const elapsed = computed(() => {
  const ms = record.value?.elapsedMs
  if (ms == null || !Number.isFinite(ms) || ms < 0) return ''
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${(ms / 1000).toFixed(1)}秒`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}分${seconds % 60}秒`
  return `${Math.floor(minutes / 60)}小时${minutes % 60}分${seconds % 60}秒`
})
const size = computed(() => {
  const a = asset.value
  return a && 'width' in a ? `${a.width}×${a.height}` : ''
})
const rows = computed(() => {
  const r = record.value
  if (!r || !known.value) return []
  return [
    ['模型', r.model], ['模型接入', r.profileName], ['分辨率档位', r.resolution],
    ['请求宽高', r.requestedWidth && r.requestedHeight ? `${r.requestedWidth}×${r.requestedHeight}` : undefined],
    ['生成画布', r.generationWidth && r.generationHeight ? `${r.generationWidth}×${r.generationHeight}` : undefined],
    ['画幅', r.aspectRatio], ['风格', r.style], ['种子', r.seed], ['采样步数', r.steps], ['CFG', r.cfg],
    ['生成帧率', r.fps], ['采样器', r.sampler], ['调度器', r.scheduler], ['去噪', r.denoise], ['请求时长', r.duration != null ? `${r.duration}秒` : undefined],
    ['生成模式', r.mode], ['请求音轨', r.audioEnabled == null ? undefined : r.audioEnabled ? '开启' : '关闭'],
    ['参考声音', r.referenceAudios?.map(item => item.filename || item.assetId).join('、') || r.referenceAudio?.filename || r.referenceAudio?.assetId], ['参考图数', r.referenceCount], ['权重', r.checkpoints?.join('、')], ['任务编号', r.promptId],
    ['生成时间', new Date(r.createdAt).toLocaleString()]
  ].filter(([, value]) => value !== undefined && value !== '')
})
</script>

<template>
  <details v-if="assetId" class="generation-details nodrag nowheel" @pointerdown.stop @mousedown.stop @click.stop @wheel.stop>
    <summary>{{ label }}<span v-if="known"> · {{ record?.model }} · {{ size }}</span><span v-else> · {{ size || '旧素材' }} · 参数未记录</span><span v-if="elapsed"> · 耗时 {{ elapsed }}</span></summary>
    <p class="generation-note">这里显示当前素材生成时的记录；修改下方或其他节点的设置，不会改写这份记录。</p>
    <dl>
      <template v-if="size"><dt>实际输出</dt><dd>{{ size }}</dd></template>
      <template v-if="asset && 'duration' in asset"><dt>实际时长</dt><dd>{{ asset.duration.toFixed(2) }}秒</dd></template>
      <template v-if="asset?.kind === 'video'"><dt>实际音轨</dt><dd>{{ asset.hasAudio ? '有' : '无' }}</dd></template>
      <template v-for="[label, value] in rows" :key="String(label)"><dt>{{ label }}</dt><dd>{{ value }}</dd></template>
    </dl>
    <p v-if="!known" class="generation-note">这份素材没有保存原始生成参数，无法可靠还原当时的模型、种子和设置。重新生成后会自动记录。</p>
    <template v-else>
      <details v-if="record?.samplers?.length"><summary>各采样阶段</summary><pre>{{ JSON.stringify(record.samplers, null, 2) }}</pre></details>
      <label>提交提示词</label><pre>{{ record?.prompt }}</pre>
      <template v-if="record?.userPrompt && record.userPrompt !== record.prompt"><label>输入提示词</label><pre>{{ record.userPrompt }}</pre></template>
    </template>
    <dl class="generation-elapsed"><dt>耗时</dt><dd title="从开始提交到结果取回，包含上传、排队、生成和下载。">{{ elapsed || '未记录' }}</dd></dl>
  </details>
</template>

<style scoped>
.generation-details { box-sizing: border-box; flex: 1 0 100%; max-width: 100%; padding: 7px 9px; color: var(--color-text-2); border-top: 1px solid var(--color-border); font-size: 10px; line-height: 1.5; }
summary { cursor: pointer; overflow-wrap: anywhere; }
summary span { color: var(--color-text-3); }
dl { display: grid; grid-template-columns: 70px minmax(0, 1fr); gap: 4px 8px; margin: 6px 0; }
dt { color: var(--color-text-3); } dd { margin: 0; overflow-wrap: anywhere; user-select: text; }
.generation-note { color: var(--color-text-3); margin: 5px 0; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; max-height: 200px; overflow-y: auto; user-select: text; }
</style>
