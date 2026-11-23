<script setup lang="ts">
import { reactive } from 'vue'
import HomeIcon from '@/components/common/HomeIcon.vue'
import { useStudioAssets } from '@/composables/useStudioAssets'
import StudioAssetToolbar from './StudioAssetToolbar.vue'
import StudioAssetTree from './StudioAssetTree.vue'
import StudioAssetBatch from './StudioAssetBatch.vue'
import StudioAssetManager from './StudioAssetManager.vue'
import StudioAssetDialog from './StudioAssetDialog.vue'
import './studioAssets.css'
const model=reactive(useStudioAssets())
function keys(e:KeyboardEvent){e.stopPropagation();if(e.key==='Escape' && model.bulk){e.preventDefault();model.clearSelection()}}
</script>
<template>
  <section class="studio-asset-panel studio-asset-surface" @keydown="keys">
    <StudioAssetToolbar :model="model" />
    <div v-if="model.activeFilters" class="asset-filter-summary"><span>已筛选 {{ model.activeFilters }} 个条件</span><button type="button" class="asset-text-button" @click="model.kind='all';model.filterTags=[]">清除</button></div>
    <StudioAssetTree :model="model" />
    <div v-if="model.audio && !model.manager" class="asset-audio"><div><span>{{ model.audio.name }}</span><button type="button" class="asset-icon" aria-label="关闭声音预览" @click="model.audio=null"><HomeIcon name="close" :size="14" /></button></div><audio :key="model.audio.id" :src="model.audio.url" controls autoplay /></div>
    <StudioAssetBatch v-if="!model.manager" :model="model" />
    <footer class="asset-panel-footer">{{ model.busy?'正在处理…':`共 ${model.projectAssets.length} 项资产 · 点击预览` }}</footer>
    <StudioAssetManager :model="model" />
    <StudioAssetDialog v-if="model.form" :label="model.form.kind==='tag'?'新建标签':model.form.kind==='renameFolder'?'编辑文件夹':'新建文件夹'" :busy="model.busy" @close="model.form=null">
      <form class="asset-name-form" @submit.prevent="model.saveForm()" @keydown.enter.capture="event => { if (event.isComposing || event.keyCode === 229) { event.preventDefault(); event.stopPropagation() } }"><h3>{{ model.form.kind==='tag'?'新建标签':model.form.kind==='renameFolder'?'编辑文件夹':'新建文件夹' }}</h3><p>{{ model.form.kind==='tag'?'为资产添加标签，方便搜索和筛选。':'将素材整理到文件夹，画布中的引用会保留。' }}</p><label>{{ model.form.kind==='tag'?'标签名称':'文件夹名称' }}<input v-model="model.form.value" :aria-label="model.form.kind==='tag'?'标签名称':'文件夹名称'" maxlength="40" autocomplete="off" placeholder="输入名称" /></label><label v-if="model.form.kind!=='tag'" class="asset-parent-field">父文件夹<select v-model="model.form.parentId" aria-label="父文件夹"><option :value="undefined">根目录</option><option v-for="f in model.parentFolders" :key="f.id" :value="f.id">{{ f.path }}</option></select></label><footer><button type="button" class="asset-button" :disabled="model.busy" @click="model.form=null">取消</button><button type="submit" class="asset-button primary" :disabled="model.busy || !model.form.value.trim()">{{ model.form.kind==='renameFolder'?'保存':'创建' }}</button></footer></form>
    </StudioAssetDialog>
    <StudioAssetDialog v-if="model.deletion" label="删除资产确认" :busy="model.busy" @close="model.deletion=null">
      <div class="asset-delete-confirm"><h3>{{ model.deletion.items.length?'删除所选资产？':'所选资产正在使用' }}</h3><p v-if="model.deletion.protectedCount">{{ model.deletion.protectedCount }} 项仍被节点、分镜或历史结果引用，将保留。</p><p v-if="model.deletion.items.length">将永久删除 {{ model.deletion.items.length }} 项素材文件。此操作无法撤销。</p><ul><li v-for="item in model.deletion.items.slice(0,5)" :key="item.id">{{ item.filename }}</li></ul><footer><button type="button" class="asset-button" :disabled="model.busy" @click="model.deletion=null">{{ model.deletion.items.length?'取消':'知道了' }}</button><button v-if="model.deletion.items.length" type="button" class="asset-button delete" :disabled="model.busy" @click="model.confirmDelete()">删除 {{ model.deletion.items.length }} 项</button></footer></div>
    </StudioAssetDialog>
  </section>
</template>
