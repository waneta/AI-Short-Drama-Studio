<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import HomeIcon from '@/components/common/HomeIcon.vue'
import type { StudioAssetModel } from '@/composables/useStudioAssets'
const props=defineProps<{model:StudioAssetModel}>()
const menu=ref(false),root=ref<HTMLElement>()
function outside(e:PointerEvent){if(!root.value?.contains(e.target as Node))menu.value=false}
onMounted(()=>document.addEventListener('pointerdown',outside));onBeforeUnmount(()=>document.removeEventListener('pointerdown',outside))
function add(){const ids=[...props.model.selected];if(props.model.scope==='library')void props.model.importAssets(ids);else props.model.addToCanvas(ids)}
</script>
<template>
  <div v-if="model.bulk" ref="root" class="asset-batch" role="toolbar" aria-label="资产批量操作" @keydown.esc.stop="menu?menu=false:model.clearSelection()">
    <button type="button" class="asset-icon compact" title="退出批量操作" aria-label="退出批量操作" @click="model.clearSelection()"><HomeIcon name="close" :size="14" /></button>
    <label class="asset-select-all" title="选择所有筛选结果"><input type="checkbox" aria-label="选择所有资产" :checked="model.visible.length>0 && model.visible.every(a=>model.selected.has(a.id))" :indeterminate="model.selected.size>0 && !model.visible.every(a=>model.selected.has(a.id))" @change="model.selectItems(model.visible)" /><span>已选 {{ model.selected.size }} 项</span></label>
    <button type="button" class="asset-icon compact" :disabled="!model.selected.size || model.busy" :title="model.scope==='library'?'添加到当前项目':'添加到画布（图片和视频）'" :aria-label="model.scope==='library'?'添加所选资产到项目':'添加所选资产到画布'" @click="add"><HomeIcon name="canvas" :size="16" /></button>
    <button type="button" class="asset-icon compact" :disabled="!model.selected.size || model.busy" title="文件夹与标签" aria-label="批量文件夹与标签" :aria-expanded="menu" @click="menu=!menu"><HomeIcon name="folder" :size="16" /></button>
    <button type="button" class="asset-icon compact" :disabled="!model.selected.size || model.busy" title="下载所选资产" aria-label="下载所选资产" @click="model.download([...model.selected])"><HomeIcon name="download" :size="16" /></button>
    <button type="button" class="asset-icon compact danger" :disabled="!model.selected.size || model.busy" title="删除所选资产" aria-label="删除所选资产" @click="model.requestDelete([...model.selected])"><HomeIcon name="trash" :size="15" /></button>
    <div v-if="menu" class="asset-popover asset-batch-menu" role="menu" aria-label="批量文件夹与标签">
      <template v-if="model.scope==='project'"><button type="button" role="menuitem" @click="model.favorite([...model.selected],true);menu=false"><HomeIcon name="star" :size="15" />收藏所选资产</button><button type="button" role="menuitem" @click="model.favorite([...model.selected],false);menu=false">取消收藏</button><hr /></template>
      <span class="asset-field-label">移动到文件夹</span><div class="asset-menu-scroll"><button v-for="folder in model.folderRows" :key="folder.id" type="button" role="menuitem" @click="model.move([...model.selected],folder.id);menu=false"><HomeIcon name="folder" :size="15" />{{ folder.path }}</button></div>
      <hr /><span class="asset-field-label">标签（可多选，已选标签再次点击可移除）</span><div class="asset-chips"><button v-for="tag in model.tags" :key="tag" type="button" :class="{active:model.tagSelected(tag)}" :aria-pressed="model.tagSelected(tag)" :disabled="model.busy" @click="model.assignTag([...model.selected],tag)">{{ tag }}</button></div>
    </div>
  </div>
</template>
