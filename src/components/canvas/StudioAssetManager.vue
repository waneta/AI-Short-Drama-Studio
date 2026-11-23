<script setup lang="ts">
import HomeIcon from '@/components/common/HomeIcon.vue'
import StudioAssetDialog from './StudioAssetDialog.vue'
import StudioAssetToolbar from './StudioAssetToolbar.vue'
import StudioAssetBatch from './StudioAssetBatch.vue'
import { assetDetails, ASSET_FOLDERS } from '@/services/assets/organization'
import type { StudioAssetModel } from '@/composables/useStudioAssets'
defineProps<{model:StudioAssetModel}>()
</script>
<template>
  <StudioAssetDialog v-if="model.manager" label="资产管理" wide :busy="model.busy" @close="model.closeManager()">
    <nav class="asset-manager-nav" aria-label="资产来源"><h2>资产库</h2><button v-for="item in [{id:'all',label:'全部资产',icon:'library'},{id:'generated',label:'生成历史',icon:'history'},{id:'saved',label:'我收藏的',icon:'star'},{id:'uploaded',label:'我上传的',icon:'upload'}] as const" :key="item.id" type="button" :class="{active:model.source===item.id}" :disabled="model.scope==='library' && item.id==='saved'" @click="model.source=item.id;model.folder=''"><HomeIcon :name="item.icon" :size="17" />{{ item.label }}</button><p>素材保存在本地<br />文件夹不会改变画布引用</p></nav>
    <main class="asset-manager-main">
      <header class="asset-manager-head"><div class="asset-scope-tabs" role="tablist" aria-label="资产范围"><button type="button" role="tab" :aria-selected="model.scope==='project'" :class="{active:model.scope==='project'}" @click="model.scope='project'">项目资产 <small>{{ model.projectAssets.length }}</small></button><button type="button" role="tab" :aria-selected="model.scope==='library'" :class="{active:model.scope==='library'}" @click="model.scope='library'">公共资产库</button></div><button type="button" class="asset-icon" title="关闭资产管理" aria-label="关闭资产管理" :disabled="model.busy" @click="model.closeManager()"><HomeIcon name="close" :size="18" /></button></header>
      <div class="asset-manager-controls"><div class="asset-manager-categories" aria-label="资产文件夹筛选"><button type="button" :class="{active:!model.folder}" @click="model.folder=''">全部</button><button v-for="f in model.roots" :key="f.id" type="button" :class="{active:model.folder===f.id}" @click="model.folder=f.id">{{ f.name }}</button></div><StudioAssetToolbar :model="model" manage /></div>
      <nav class="asset-breadcrumb" aria-label="文件夹路径"><button type="button" @click="model.folder=''">全部资产</button><template v-for="(f,index) in model.trail" :key="f.id"><span> / </span><strong v-if="index===model.trail.length-1">{{ f.name }}</strong><button v-else type="button" @click="model.folder=f.id">{{ f.name }}</button></template><button v-if="model.folder && model.folder!=='public'" type="button" class="asset-text-button asset-create-child" @click="model.newFolder()">＋ 新建子文件夹</button></nav>
      <div class="asset-manager-scroll">
        <div v-if="model.browsing && model.childFolders.length" class="asset-folder-grid">
          <article v-for="f in model.childFolders" :key="f.id" class="asset-folder-card" :data-manage-folder="f.id"><button type="button" class="asset-folder-card-main" @click="model.folder=f.id"><span><HomeIcon name="folder" :size="48" /></span><b>{{ f.name }}</b><small>{{ f.allAssets.length }} 项资产</small></button><button v-if="model.scope==='library'?f.id!=='public':!ASSET_FOLDERS.some(b=>b.id===f.id)" type="button" class="asset-icon asset-folder-rename" :aria-label="`重命名文件夹 ${f.name}`" @click="model.renameFolder(f)"><HomeIcon name="edit" :size="14" /></button></article>
        </div>
        <p v-if="!model.visible.length && (!model.browsing || !model.childFolders.length)" class="asset-empty manager-empty"><HomeIcon name="folder" :size="36" />{{ model.search || model.activeFilters?'没有匹配的资产':'这里还没有资产' }}<small>点击 ＋ 上传素材，或切换其他文件夹</small></p>
        <div v-if="model.visible.length && (model.folder || !model.browsing)" class="asset-card-grid">
          <article v-for="asset in model.visible" :key="asset.id" class="asset-card" :class="{checked:model.selected.has(asset.id)}" :data-manage-asset="asset.id"><button type="button" class="asset-card-main" :title="model.bulk?`选择 ${asset.filename}`:`预览 ${asset.filename}`" @click="model.bulk?model.toggle(asset.id):model.preview(asset)"><span class="asset-card-preview"><img v-if="model.thumbs[asset.id]" :src="model.thumbs[asset.id]" :draggable="false" alt="" loading="lazy" /><HomeIcon v-else :name="asset.kind==='audio'?'mic':asset.kind" :size="36" /><span v-if="asset.kind==='video'" class="asset-play-badge">▶</span></span><b>{{ asset.filename }}</b><small>{{ assetDetails(asset) }}</small></button><input v-if="model.bulk" class="asset-card-check" type="checkbox" :aria-label="`选择 ${asset.filename}`" :checked="model.selected.has(asset.id)" @change="model.toggle(asset.id)" /><button v-else-if="model.scope==='project'" type="button" class="asset-icon asset-card-save" :class="{saved:model.isSaved(asset)}" :title="model.isSaved(asset)?'取消收藏':'收藏资产'" :aria-label="`${model.isSaved(asset)?'取消收藏':'收藏'} ${asset.filename}`" @click="model.favorite([asset.id],!model.isSaved(asset))"><HomeIcon name="star" :size="16" /></button><div class="asset-card-tags"><span v-for="tag in model.tagsFor(asset)" :key="tag">{{ tag }}</span></div><button v-if="model.scope==='library' && !model.bulk" type="button" class="asset-import" :disabled="model.busy" @click="model.importAssets([asset.id])">＋ 添加到项目</button></article>
        </div>
      </div>
      <div v-if="model.audio" class="asset-audio"><span>{{ model.audio.name }}</span><audio :key="model.audio.id" :src="model.audio.url" controls autoplay /><button type="button" class="asset-icon" aria-label="关闭声音预览" @click="model.audio=null"><HomeIcon name="close" :size="15" /></button></div>
      <footer class="asset-manager-footer"><span>{{ model.busy?'正在处理…':`共 ${model.visible.length} 项资产` }}</span><StudioAssetBatch :model="model" /><span v-if="model.scope==='library'">可跨项目复用图片、视频和声音</span></footer>
    </main>
  </StudioAssetDialog>
</template>
