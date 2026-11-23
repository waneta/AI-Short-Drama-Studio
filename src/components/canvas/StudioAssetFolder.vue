<script setup lang="ts">
import { computed, ref } from 'vue'
import HomeIcon from '@/components/common/HomeIcon.vue'
import { assetDetails } from '@/services/assets/organization'
import type { StudioAssetModel } from '@/composables/useStudioAssets'
const props=defineProps<{model:StudioAssetModel;group:StudioAssetModel['groups'][number];depth?:number}>()
const expanded=ref(false)
const children=computed(()=>props.model.groups.filter(g=>g.parentId===props.group.id && (!props.model.search && !props.model.activeFilters || g.allAssets.length)))
const open=computed(()=>expanded.value || !!props.model.search || !!props.model.activeFilters || props.model.trail.slice(0,-1).some(f=>f.id===props.group.id))
function toggle(){props.model.folder=props.group.id;expanded.value=!expanded.value}
</script>
<template>
  <section class="asset-folder" :data-folder-id="group.id" :style="{'--folder-depth':Math.min(depth || 0,6)}">
    <div class="asset-folder-line" :class="{current:model.folder===group.id}">
      <button type="button" class="asset-folder-title" :aria-expanded="open" @click="toggle"><span class="asset-chevron" :class="{open}">›</span><HomeIcon name="folder" :size="23" /><span>{{ group.name }}</span><small>{{ group.allAssets.length || '' }}</small></button>
      <button v-if="!model.bulk && group.id!=='public'" type="button" class="asset-icon asset-new-child" :aria-label="`在${group.name}中新建子文件夹`" title="新建子文件夹" @click="model.newFolder(group.id)"><HomeIcon name="plus" :size="14" /></button>
      <input v-if="model.bulk" type="checkbox" :aria-label="`选择${group.name}文件夹`" :disabled="!group.allAssets.length" :checked="group.allAssets.length>0 && group.allAssets.every(a=>model.selected.has(a.id))" :indeterminate="group.allAssets.some(a=>model.selected.has(a.id)) && !group.allAssets.every(a=>model.selected.has(a.id))" @change="model.selectItems(group.allAssets)" />
    </div>
    <div v-if="open" class="asset-folder-contents">
      <StudioAssetFolder v-for="child in children" :key="child.id" :model="model" :group="child" :depth="(depth || 0)+1" />
      <div class="asset-folder-children">
        <p v-if="!group.assets.length && !children.length" class="asset-folder-empty">空文件夹</p>
        <div v-for="asset in group.assets" :key="asset.id" class="asset-item" :class="{checked:model.selected.has(asset.id)}" :data-asset-id="asset.id">
          <button type="button" class="asset-item-main" :title="model.bulk?`选择 ${asset.filename}`:`预览 ${asset.filename}`" @click="model.bulk?model.toggle(asset.id):model.preview(asset)"><span class="asset-thumb"><img v-if="model.thumbs[asset.id]" :src="model.thumbs[asset.id]" :draggable="false" alt="" loading="lazy" /><HomeIcon v-else :name="asset.kind==='audio'?'mic':asset.kind" :size="19" /></span><span class="asset-item-text"><b>{{ asset.filename }}</b><small>{{ assetDetails(asset) }}</small></span></button>
          <input v-if="model.bulk" type="checkbox" :aria-label="`选择 ${asset.filename}`" :checked="model.selected.has(asset.id)" @change="model.toggle(asset.id)" />
          <button v-else-if="model.scope==='project'" type="button" class="asset-icon asset-save" :class="{saved:model.isSaved(asset)}" :title="model.isSaved(asset)?'取消收藏':'收藏资产'" :aria-label="`${model.isSaved(asset)?'取消收藏':'收藏'} ${asset.filename}`" @click="model.favorite([asset.id],!model.isSaved(asset))"><HomeIcon name="star" :size="14" /></button>
        </div>
      </div>
    </div>
  </section>
</template>
