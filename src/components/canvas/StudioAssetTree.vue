<script setup lang="ts">
import StudioAssetFolder from './StudioAssetFolder.vue'
import type { StudioAssetModel } from '@/composables/useStudioAssets'
defineProps<{model:StudioAssetModel}>()
</script>
<template>
  <div class="asset-tree" aria-label="资产文件夹">
    <p v-if="!model.filtered.length && (model.search || model.activeFilters)" class="asset-empty">没有匹配的资产<small>试试其他关键词或筛选条件</small><button type="button" class="asset-text-button" @click="model.search='';model.kind='all';model.filterTags=[]">清除筛选</button></p>
    <StudioAssetFolder v-for="group in model.roots.filter(g=>!(model.search || model.activeFilters) || g.allAssets.length)" :key="group.id" :model="model" :group="group" />
    <p v-if="!model.projectAssets.length" class="asset-empty">整理你的创作素材<small>点击上方 ＋ 上传图片、视频或声音</small></p>
  </div>
</template>
