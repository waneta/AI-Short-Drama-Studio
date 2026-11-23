<script setup lang="ts">
import { computed, ref } from 'vue'
import GenerationSettingsPopover from '@/components/common/GenerationSettingsPopover.vue'
import { imageModelCapabilities } from '@/services/ai/imageModelCapabilities'
import { comfyImageModelOption, comfyImageWorkflowModel } from '@/services/ai/comfyImageWorkflow'
import { resolvedCanvasReferenceAssetIds } from '@/services/canvas/references'
import { collectShotRefIds, collectShotBoardRefIds, collectShotKeyframeRefIds } from '@/utils/consistency'
import { videoRequiresStoryboard } from '@/utils/storyboardGate'
import { comfyImageReferenceIssue } from '@/services/ai/comfyImageReference'
import NativeH3ImageControls from '@/components/common/NativeH3ImageControls.vue'
import ParamSelect from '@/components/common/ParamSelect.vue'
import { llmChoiceKey, namedModelGroups, parseLlmChoiceKey, useSettingsStore, useProjectStore } from '@/stores'

const props = withDefaults(
  defineProps<{
    label?: string
    referenceCount?: number
    nodeId?: string
    menu?: boolean
  }>(),
  { label: '出图' }
)

const menuPanel = ref<InstanceType<typeof GenerationSettingsPopover>>()
const search = ref('')
const settings = useSettingsStore()
const project = useProjectStore()
const node = computed(() => project.current?.canvas?.nodes.find(n => n.id === props.nodeId))
const effectiveReferenceCount = computed(() => {
  if (props.referenceCount !== undefined) return props.referenceCount
  const current = project.current, item = node.value
  if (!current || !item) return 0
  if (item.type === 'imageGen') return resolvedCanvasReferenceAssetIds(current, item).length
  if (item.type === 'subject') {
    const subject = current.subjects?.find(s => s.id === item.data.subjectId)
    return (subject?.referenceAssetIds?.length || 0) +
      (subject && (subject.fromReference || subject.kind === 'other') ? current.script?.referenceAssetIds?.length || 0 : 0)
  }
  if (item.type === 'scene' || item.type === 'sceneProps') {
    const scene = current.scenes?.find(s => s.id === item.data.sceneId)
    return item.type === 'scene' ? scene?.referenceAssetIds?.length || 0
      : (scene?.propReferenceAssetIds?.length || 0) + (scene?.plateAssetId ? 1 : 0)
  }
  const shot = current.shots.find(s => s.id === item.data.shotId)
  if (!shot) return 0
  if (item.type === 'shotBoard') return collectShotBoardRefIds(shot, current).ids.length
  if (item.type === 'shotImage') return (videoRequiresStoryboard(current) ? collectShotRefIds(shot, current) : collectShotKeyframeRefIds(shot, current)).ids.length
  if (item.type === 'shotFrames') return collectShotRefIds(shot, current).ids.length
  return 0
})
const selectedProfile = computed(() => node.value?.data.imageProfileId
  ? settings.config.images.find(p => p.id === node.value?.data.imageProfileId) : settings.config.image)
const selectedModel = computed(() => node.value?.data.imageModel || selectedProfile.value?.model || '')
import { nodeImageResolution } from '@/services/canvas/nodeGeneration'
import { isNodeRunning } from '@/services/canvas/jobs'

const groups = computed(() => namedModelGroups(settings.config.images ?? []).map(group => {
  // A native Comfy workflow fixes its checkpoint; saved API model aliases do
  // not select different models and must not render as identical options.
  const fixedWorkflow = group.models.some(name => optionLabel(group.id, name) !== name)
  return fixedWorkflow ? { ...group, models: group.models.slice(0, 1) } : group
}))
function referenceIssue(profileId: string) {
  return comfyImageReferenceIssue(settings.config.images.find(profile => profile.id === profileId), effectiveReferenceCount.value)
}
function optionLabel(profileId: string, model: string) {
  return comfyImageModelOption(settings.config.images.find(profile => profile.id === profileId), model)
}

const h3Image = computed(() => {
  try { return comfyImageWorkflowModel(JSON.parse(selectedProfile.value?.adapter?.workflowTemplate || '{}')) === 'MiniMax H3 Image' }
  catch { return false }
})

const model = computed({
  get() {
    const id = node.value?.data.imageProfileId || settings.config.activeImageId
    const name = selectedModel.value
    return id && name ? llmChoiceKey(id, name) : ''
  },
  set(v: string) {
    const parsed = parseLlmChoiceKey(v)
    if (!parsed || referenceIssue(parsed.profileId) || (props.nodeId && isNodeRunning(props.nodeId))) return
    if (node.value) {
      const profile = settings.config.images.find(p => p.id === parsed.profileId)
      const ratios = imageModelCapabilities(profile, parsed.model).ratios
      const currentRatio = node.value.data.aspectRatio || project.current?.settings.aspectRatio || '16:9'
      const [w, h] = currentRatio.split(':').map(Number)
      const ratio = ratios.includes(currentRatio) ? currentRatio : ratios.find(r => { const [a, b] = r.split(':').map(Number); return Math.sign(a - b) === Math.sign(w - h) }) || ratios[0]
      project.patchCanvasNode(node.value.id, { ...(node.value.type === 'imageGen' ? { aspectRatio: ratio } : {}), imageProfileId: parsed.profileId, imageModel: parsed.model,
        imageResolution: nodeImageResolution({ ...node.value.data, imageModel: parsed.model }, profile,
          ['subject', 'scene', 'sceneProps'].includes(node.value.type) ? '16:9' : node.value.type === 'imageGen' ? ratio : currentRatio, effectiveReferenceCount.value) })
    } else if (!props.nodeId) settings.selectImageModel(parsed.profileId, parsed.model)
  }
})
const filteredGroups = computed(() => groups.value.map(g => ({ ...g, models: g.models.filter(m => `${g.name} ${optionLabel(g.id, m)}`.toLowerCase().includes(search.value.trim().toLowerCase())) })).filter(g => g.models.length))
function choose(value: string) { model.value = value; menuPanel.value?.close(true) }
const menuSummary = computed(() => optionLabel(node.value?.data.imageProfileId || settings.config.activeImageId || '', selectedModel.value).replace(/ · (多图编辑|图生图|文生图)$/, '') || '选择模型')
</script>

<template>
  <GenerationSettingsPopover v-if="menu" ref="menuPanel" label="选择图片模型" :summary="menuSummary" icon="✧" :disabled="Boolean(nodeId && isNodeRunning(nodeId))">
    <input v-model="search" class="settings-input image-model-search" type="search" placeholder="搜索模型或接入" aria-label="搜索图片模型" />
    <div class="image-model-list" role="listbox" aria-label="图片模型">
      <div v-for="g in filteredGroups" :key="g.id" class="image-model-group">
        <div class="image-model-group-title">{{ g.name }}</div>
        <button v-for="m in g.models" :key="m" type="button" class="image-model-option" role="option" :aria-selected="model === llmChoiceKey(g.id, m)"
          :disabled="Boolean(referenceIssue(g.id))" :title="referenceIssue(g.id) || optionLabel(g.id, m)" @click="choose(llmChoiceKey(g.id, m))">
          <span class="model-symbol">✧</span><span><strong>{{ optionLabel(g.id, m) }}</strong><small>{{ referenceIssue(g.id) || g.name }}</small></span><span v-if="model === llmChoiceKey(g.id, m)">✓</span>
        </button>
      </div>
      <p v-if="!filteredGroups.length" class="settings-note">{{ groups.length ? '没有匹配的模型' : '请先在设置中添加出图模型' }}</p>
    </div>
  </GenerationSettingsPopover>
  <ParamSelect v-else :disabled="Boolean(nodeId && isNodeRunning(nodeId))" :label="label" :title="optionLabel(node?.data.imageProfileId || settings.config.activeImageId || '', selectedModel)" :model-value="model" @update:model-value="model = $event">
    <option v-if="node?.data.imageProfileId && !selectedProfile" :value="model" disabled>原模型接入已删除，请重新选择</option>
    <option v-if="!groups.some((g) => g.models.length)" value="">请先在设置里添加出图模型</option>
    <optgroup v-for="g in groups" :key="g.id" :label="g.name">
      <option v-for="m in g.models" :key="g.id + m" :value="llmChoiceKey(g.id, m)" :disabled="Boolean(referenceIssue(g.id))">{{ optionLabel(g.id, m) }}{{ referenceIssue(g.id) ? `（不支持本次${effectiveReferenceCount}张参考图）` : '' }}</option>
    </optgroup>
  </ParamSelect>
  <NativeH3ImageControls v-if="nodeId" :include-batch="menu" :node-id="nodeId" :reference-count="effectiveReferenceCount" />
  <span v-else-if="h3Image" class="h3-image-hint">H3 默认约4MP；图片节点可选输出分辨率。</span>
</template>

<style scoped>
.h3-image-hint { color: var(--color-text-3); font-size: 11px; line-height: 1.5; }
.image-model-search { margin-bottom:12px; }
.image-model-group-title { padding:6px 4px; color:var(--color-text-3); font-size:11px; }
.image-model-option { width:100%; display:flex; align-items:center; gap:10px; border:0; border-radius:10px; padding:10px 8px; color:var(--color-text-1); background:transparent; text-align:left; cursor:pointer; }
.image-model-option:hover, .image-model-option[aria-selected=true] { background:var(--color-bg-3); }
.image-model-option > span:nth-child(2) { flex:1; min-width:0; }
.image-model-option strong { display:block; font-size:12px; font-weight:500; overflow-wrap:anywhere; }
.image-model-option small { display:block; margin-top:3px; color:var(--color-text-3); font-size:10px; }
.model-symbol { display:grid; place-items:center; width:32px; height:32px; flex:0 0 32px; border-radius:9px; background:var(--color-bg-2); font-size:19px; }
</style>
