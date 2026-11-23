<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useAssetsStore, useProjectStore, useToastStore } from '@/stores'
import HomeIcon from '@/components/common/HomeIcon.vue'
import StudioAssetPanel from './StudioAssetPanel.vue'
import type { CanvasNode } from '@/types'

defineProps<{ selectedId: string | null }>()
const emit = defineEmits<{
  select: [id: string]
  add: []
  home: []
}>()
const project = useProjectStore()
const assets = useAssetsStore()
const toast = useToastStore()
const renamingProject = ref(false)
const savingProjectName = ref(false)
const projectNameDraft = ref('')
const renameProjectId = ref('')
const projectNameInput = ref<HTMLInputElement>()
const projectNameButton = ref<HTMLButtonElement>()

async function beginProjectRename() {
  if (!project.current || savingProjectName.value) return
  renameProjectId.value = project.current.id
  projectNameDraft.value = project.current.name
  renamingProject.value = true
  await nextTick()
  if (!renamingProject.value || renameProjectId.value !== project.current?.id) return
  projectNameInput.value?.focus()
  projectNameInput.value?.select()
}

function cancelProjectRename(restoreFocus = false) {
  renamingProject.value = false
  renameProjectId.value = ''
  projectNameDraft.value = ''
  if (restoreFocus) void nextTick(() => projectNameButton.value?.focus())
}

async function commitProjectRename(restoreFocus = false) {
  if (!renamingProject.value || savingProjectName.value) return
  const current = project.current
  if (!current || current.id !== renameProjectId.value) { cancelProjectRename(); return }
  const name = projectNameDraft.value.trim()
  if (!name) {
    toast.warn('项目名称不能为空，已保留原名称')
    cancelProjectRename(restoreFocus)
    return
  }
  if (name === current.name) { cancelProjectRename(restoreFocus); return }
  const oldName = current.name
  savingProjectName.value = true
  current.name = name
  current.updatedAt = Date.now()
  project.dirty = true
  try {
    await project.save()
    if (renameProjectId.value === current.id) cancelProjectRename(restoreFocus)
  } catch (error) {
    if (current.name === name) {
      current.name = oldName
      if (project.current?.id === current.id) { current.updatedAt = Date.now(); project.dirty = true }
    }
    toast.error(`项目名称保存失败：${error instanceof Error ? error.message : String(error)}`)
  } finally {
    savingProjectName.value = false
  }
}

function onProjectNameKeydown(event: KeyboardEvent) {
  if (event.isComposing || event.keyCode === 229 || savingProjectName.value) return
  if (event.key === 'Enter') { event.preventDefault(); void commitProjectRename(true) }
  if (event.key === 'Escape') { event.preventDefault(); cancelProjectRename(true) }
}

function onProjectTitleKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' || event.key === 'F2') {
    event.preventDefault()
    event.stopPropagation()
    void beginProjectRename()
  }
}
const tab = ref<'nodes' | 'assets'>('nodes')
const search = ref('')
const searchInput = ref<HTMLInputElement>()
async function focusNodeSearch() { tab.value = 'nodes'; await nextTick(); searchInput.value?.focus(); searchInput.value?.select() }
defineExpose({ focusNodeSearch })
const collapsed = ref(new Set<string>())
const thumbs = ref<Record<string, string>>({})
let thumbRequest = 0

const nodes = computed(() => project.current?.canvas?.nodes ?? [])
const nodeCount = computed(() => nodes.value.filter(n => n.type !== 'groupFrame').length)
// assets.all is global: sidebar resources must stay within the open project.
const resources = computed(() => project.current
  ? assets.all.filter(a => !a.library && a.projectId === project.current!.id).sort((a, b) => b.createdAt - a.createdAt)
  : [])
const query = computed(() => search.value.trim().toLocaleLowerCase())
const labels: Record<CanvasNode['type'], string> = {
  script: '剧本', subject: '角色', subjectProps: '角色道具', scene: '场景',
  sceneProps: '场景道具', shotBoard: '故事看板', shotImage: '分镜图片',
  shotFrames: '首尾帧', shotVideo: '分镜视频', audio: '声音', export: '剪辑',
  final: '成片', groupFrame: '分组', imageGen: '图片', videoGen: '视频'
}

function outputId(node: CanvasNode): string | undefined {
  const p = project.current
  if (!p) return
  if (node.data.outputAssetId) return node.data.outputAssetId
  const subject = p.subjects?.find(s => s.id === node.data.subjectId)
  const scene = p.scenes?.find(s => s.id === node.data.sceneId)
  const shot = p.shots.find(s => s.id === node.data.shotId)
  switch (node.type) {
    case 'subject': return subject?.designSheetAssetId
    case 'scene': return scene?.plateAssetId
    case 'sceneProps': return scene?.propSheetAssetId
    case 'shotBoard': return shot?.boardAssetId
    case 'shotImage': return shot?.imageAssetId
    case 'shotFrames': return shot?.firstFrameAssetId || shot?.lastFrameAssetId
    case 'shotVideo': return shot?.videoAssetId
    case 'audio': return shot?.audioAssetId
    case 'final': return p.finalVideoAssetId
  }
}

function nodeIcon(node: CanvasNode): 'script' | 'image' | 'video' | 'mic' | 'canvas' {
  if (node.type === 'script') return 'script'
  if (node.type === 'audio') return 'mic'
  if (['videoGen', 'shotVideo', 'final', 'export'].includes(node.type)) return 'video'
  return 'image'
}

const groups = computed(() => {
  const result = new Map<string, { id: string; label: string; nodes: CanvasNode[] }>()
  const graph = project.current?.canvas
  for (const node of nodes.value) {
    if (node.type === 'groupFrame') continue
    const frame = nodes.value.find(n => n.id === node.parentGroupId && n.type === 'groupFrame')
    const group = graph?.groups.find(g => g.nodeIds.includes(node.id))
    const id = frame?.id || group?.id || `type:${node.type}`
    const label = frame?.data.label || group?.label || labels[node.type]
    if (query.value && !`${node.data.label || ''} ${labels[node.type]} ${label}`.toLocaleLowerCase().includes(query.value)) continue
    if (!result.has(id)) result.set(id, { id, label, nodes: [] })
    result.get(id)!.nodes.push(node)
  }
  return [...result.values()]
})

function toggleGroup(id: string) {
  const next = new Set(collapsed.value)
  next.has(id) ? next.delete(id) : next.add(id)
  collapsed.value = next
}

watch(() => [project.current?.id, ...resources.value.map(a => a.id), ...nodes.value.map(n => outputId(n))].join('|'), async () => {
  const request = ++thumbRequest
  const ids = [...new Set([...resources.value.map(a => a.id), ...nodes.value.map(outputId)].filter((id): id is string => !!id))]
  const entries = await Promise.all(ids.map(async id => {
    try {
      const meta = assets.getMeta(id)
      const url = meta?.kind === 'image' ? await assets.getUrl(id) : meta?.kind === 'video' ? await assets.getThumbUrl(id) : undefined
      return [id, url || ''] as const
    } catch { return [id, ''] as const }
  }))
  if (request === thumbRequest) thumbs.value = Object.fromEntries(entries)
}, { immediate: true })

watch(() => project.current?.id, () => {
  cancelProjectRename()
  search.value = ''
  collapsed.value = new Set()
})
onBeforeUnmount(() => { ++thumbRequest })
</script>

<template>
  <aside id="studio-project-sidebar" class="studio-sidebar" aria-label="项目节点和资源">
    <header class="side-head">
      <button class="workspace-home" type="button" :disabled="savingProjectName" title="返回项目列表" aria-label="返回项目列表" @click="emit('home')"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m14 6-6 6 6 6" /></svg></button>
      <input v-if="renamingProject" ref="projectNameInput" v-model="projectNameDraft" class="project-name-input" aria-label="项目名称" :readonly="savingProjectName" :aria-busy="savingProjectName" title="回车保存，Esc取消" autocomplete="off" @keydown.stop="onProjectNameKeydown" @blur="commitProjectRename()" />
      <button v-else ref="projectNameButton" class="project-name" type="button" :disabled="!project.current || savingProjectName" :title="`${project.current?.name || '未命名工作区'}\n双击修改项目名称`" aria-label="项目名称，双击重命名" @dblclick.stop="beginProjectRename" @keydown="onProjectTitleKeydown">{{ project.current?.name || '未命名工作区' }}</button>
    </header>
    <div class="side-tabs" role="tablist" aria-label="项目内容">
      <button id="studio-nodes-tab" type="button" role="tab" :aria-selected="tab === 'nodes'" aria-controls="studio-nodes-panel" :class="{ on: tab === 'nodes' }" @click="tab = 'nodes'">画布</button>
      <button id="studio-assets-tab" type="button" role="tab" :aria-selected="tab === 'assets'" aria-controls="studio-assets-panel" :class="{ on: tab === 'assets' }" @click="tab = 'assets'">资产</button>
    </div>
    <div v-if="tab === 'nodes'" class="side-tools">
      <label class="search-box">
        <HomeIcon name="search" :size="15" />
        <input ref="searchInput" v-model="search" :placeholder="tab === 'nodes' ? '搜索节点' : '搜索资源'" :aria-label="tab === 'nodes' ? '搜索节点' : '搜索资源'" />
      </label>
      <button class="small-btn add-node" type="button" title="添加节点" aria-label="添加节点" @click="emit('add')"><HomeIcon name="plus" :size="17" /></button>
    </div>
    <div v-if="tab === 'nodes'" id="studio-nodes-panel" class="side-list" role="tabpanel" aria-labelledby="studio-nodes-tab">
      <p v-if="!groups.length" class="side-empty">{{ query ? '没有匹配的节点' : '还没有节点' }}<small v-if="!query">点击 ＋ 添加节点，或打开底部 AI 助手开始创作</small></p>
      <section v-for="group in groups" :key="group.id" class="node-group">
        <button class="group-title" type="button" :aria-expanded="!collapsed.has(group.id) || !!query" @click="toggleGroup(group.id)">
          <span class="chevron" :class="{ expanded: !collapsed.has(group.id) || query }">›</span><HomeIcon name="folder" :size="18" /><span>{{ group.label }}</span><em>{{ group.nodes.length }}</em>
        </button>
        <div v-show="!collapsed.has(group.id) || query">
          <button v-for="node in group.nodes" :key="node.id" class="node-row" :class="{ selected: selectedId === node.id }" :data-node-id="node.id" :aria-pressed="selectedId === node.id" :title="`定位：${node.data.label || labels[node.type]}`" type="button" @click="emit('select', node.id)">
            <span class="row-thumb"><img v-if="thumbs[outputId(node) || '']" :src="thumbs[outputId(node) || '']" alt="" loading="lazy" /><HomeIcon v-else :name="nodeIcon(node)" :size="19" /></span>
            <span class="row-text"><b>{{ node.data.label || labels[node.type] }}</b><small>{{ labels[node.type] }}</small></span>
            <span v-if="node.status === 'running' || node.status === 'failed'" class="node-status" :class="node.status" :title="node.status === 'running' ? '生成中' : '生成失败'" />
          </button>
        </div>
      </section>
    </div>
    <StudioAssetPanel v-else id="studio-assets-panel" role="tabpanel" aria-labelledby="studio-assets-tab" />
    <footer><span>{{ tab === 'nodes' ? `共 ${nodeCount} 个节点` : `共 ${resources.length} 项资产` }}</span></footer>
  </aside>
</template>

<style scoped>
.studio-sidebar { width: 100%; height:100%; box-sizing:border-box; min-width:0; flex: 0 0 auto; min-height: 0; display: flex; flex-direction: column; border-right: 1px solid var(--color-border); background: var(--color-bg-1); color: var(--color-text-1); }
.side-head { height:44px; box-sizing:border-box; padding:8px 12px; display:flex; align-items:center; gap:7px; flex-shrink:0; min-width:0; }
.workspace-home { display:inline-flex; align-items:center; justify-content:center; flex-shrink:0; width:28px; height:28px; border:0; padding:0; border-radius:7px; background:transparent; color:var(--color-text-3); }
.workspace-home:hover { background:var(--color-fill-hover); color:var(--color-text-1); }
.project-name,.project-name-input { min-width:0; flex:1; height:28px; box-sizing:border-box; font:inherit; font-size:12px; font-weight:500; color:var(--color-text-2); }
.project-name { overflow:hidden; white-space:nowrap; text-overflow:ellipsis; border:1px solid transparent; border-radius:5px; background:transparent; padding:0 4px; text-align:left; cursor:text; }
.project-name:hover { background:var(--color-fill); color:var(--color-text-1); }
.project-name-input { width:0; border:1px solid var(--color-accent); border-radius:5px; background:var(--color-bg-0); padding:0 4px; outline:none; color:var(--color-text-1); }
.project-name-input[readonly] { opacity:.65; }
.workspace-home:disabled,.project-name:disabled { opacity:.5; cursor:default; }
button { font: inherit; cursor: pointer; color: inherit; }
.small-btn { display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; width: 28px; height: 28px; padding: 0; border: none; border-radius: 7px; background: transparent; color: var(--color-text-3); font-size: 21px; }
.small-btn:hover { background: var(--color-fill-hover); color: var(--color-text-1); }
.side-tabs { display: flex; gap: 7px; padding: 8px 12px 10px; border-bottom: 1px solid var(--color-border); }
.side-tabs button { flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; gap: 7px; padding: 6px 12px; border: 1px solid transparent; border-radius: 8px; background: transparent; color: var(--color-text-3); font-size: 12px; }
.side-tabs button.on { background:var(--color-fill-hover); color:var(--color-text-1); }
em { font-style: normal; font-size: 10px; color: var(--color-text-4); }
.side-tools { display: flex; align-items: center; gap: 6px; padding: 6px 12px; }
.search-box { flex: 1; min-width: 0; height:30px; box-sizing:border-box; display: flex; align-items: center; gap: 7px; color: var(--color-text-4); background: var(--color-bg-0); border: 1px solid var(--color-border); border-radius: 7px; padding: 4px 8px; }
.search-box:focus-within { border-color: var(--color-accent); }
.search-box input { min-width: 0; width: 100%; padding: 0; background: transparent; border: none; outline: none; font: inherit; font-size: 12px; color: var(--color-text-1); }
select { max-width: 66px; padding: 7px 2px; border: 1px solid var(--color-border); border-radius: 6px; background: var(--color-bg-1); color: var(--color-text-2); font-size: 11px; }
.side-list { flex: 1; overflow-y: auto; min-height: 0; padding: 0 8px 12px; }
.side-empty { padding: 26px 14px; text-align: center; color: var(--color-text-3); font-size: 12px; line-height: 1.7; }
.side-empty small { display: block; margin-top: 9px; font-size: 11px; color: var(--color-text-4); }
.group-title { display: flex; align-items: center; gap: 7px; width: 100%; padding: 6px 5px; background: transparent; border: none; color: var(--color-text-2); font-size: 12px; line-height:18px; text-align: left; }
.group-title > span:not(.chevron) { flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.chevron { display: inline-block; font-size: 17px; transition: transform .15s; }
.chevron.expanded { transform: rotate(90deg); }
.node-row, .asset-row { width: 100%; display: flex; align-items: center; gap: 10px; padding: 7px 8px; border: 1px solid transparent; border-radius: 9px; background: transparent; text-align: left; }
.node-row { height:44px; box-sizing:border-box; gap:8px; padding:5px 8px 5px 20px; border-radius:7px; }
.node-row:hover, .asset-row:hover { background: var(--color-fill-hover); }
.node-row.selected { border-color: color-mix(in srgb, var(--color-accent) 40%, transparent); background: color-mix(in srgb, var(--color-accent) 12%, transparent); }
.row-thumb { display: flex; align-items: center; justify-content: center; width: 32px; height: 32px; box-sizing:border-box; flex-shrink: 0; overflow: hidden; border: 1px solid var(--color-border); border-radius: 7px; background: var(--color-bg-0); color: var(--color-text-3); }
.row-thumb img { width: 100%; height: 100%; object-fit: contain; }
.row-text { flex: 1; min-width: 0; }
.row-text b { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; font-weight: 500; line-height:16px; }
.row-text small { display: block; margin-top: 2px; font-size: 10px; line-height:12px; color: var(--color-text-4); }
.node-status { width: 6px; height: 6px; flex-shrink: 0; border-radius: 50%; background: #7eb4ff; }
.node-status.failed { background: #f87171; }
.audio-preview { padding: 10px 12px; border-top: 1px solid var(--color-border); }
.audio-preview > div { display: flex; align-items: center; font-size: 11px; }
.audio-preview span { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.audio-preview audio { width: 100%; height: 32px; margin-top: 6px; }
.preview-note { padding: 0 14px; font-size: 11px; color: var(--color-text-3); }
footer { display:flex; align-items:center; justify-content:flex-end; height:28px; box-sizing:border-box; flex-shrink:0; padding:4px 12px; border-top: 1px solid var(--color-border); color: var(--color-text-4); font-size: 10px; }
button:focus-visible, select:focus-visible { outline: 2px solid var(--color-accent); outline-offset: -2px; }
@media (max-width: 760px) { .studio-sidebar { position: absolute; inset: 0 auto 0 0; width:min(300px, calc(100% - 56px)); z-index: 15; box-shadow: 10px 0 32px #0004; } }
</style>
