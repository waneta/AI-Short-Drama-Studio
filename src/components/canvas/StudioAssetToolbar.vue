<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import HomeIcon from '@/components/common/HomeIcon.vue'
import type { StudioAssetModel } from '@/composables/useStudioAssets'
const props=defineProps<{model:StudioAssetModel;manage?:boolean}>()
const popup=ref<'filter'|'add'|null>(null),root=ref<HTMLElement>(),input=ref<HTMLInputElement>()
const draftKind=ref<StudioAssetModel['kind']>('all'),draftTags=ref<string[]>([])
async function search(){props.model.searchOpen=true;popup.value=null;await nextTick();input.value?.focus()}
function openFilter(){if(popup.value==='filter'){popup.value=null;return}draftKind.value=props.model.kind;draftTags.value=[...props.model.filterTags];popup.value='filter'}
function toggleTag(tag:string){draftTags.value=draftTags.value.includes(tag)?draftTags.value.filter(t=>t!==tag):[...draftTags.value,tag]}
function apply(){props.model.kind=draftKind.value;props.model.filterTags=[...draftTags.value];popup.value=null}
function outside(event:PointerEvent){if(!root.value?.contains(event.target as Node))popup.value=null}
function keys(event:KeyboardEvent){if(event.key==='Escape' && (popup.value || props.model.searchOpen)){event.preventDefault();event.stopPropagation();if(popup.value)popup.value=null;else{props.model.search='';props.model.searchOpen=false}}}
onMounted(()=>document.addEventListener('pointerdown',outside));onBeforeUnmount(()=>document.removeEventListener('pointerdown',outside))
</script>
<template>
  <div ref="root" class="asset-tools" @keydown="keys">
    <template v-if="model.searchOpen">
      <label class="asset-search"><HomeIcon name="search" :size="15" /><input ref="input" v-model="model.search" placeholder="搜索资产" aria-label="搜索资产" /></label>
      <button type="button" class="asset-icon" title="关闭搜索" aria-label="关闭资产搜索" @click="model.search='';model.searchOpen=false"><HomeIcon name="close" :size="15" /></button>
    </template>
    <template v-else>
      <button type="button" class="asset-icon" title="搜索资产" aria-label="搜索资产" @click="search"><HomeIcon name="search" :size="17" /></button>
      <button type="button" class="asset-icon" :class="{active:model.bulk}" title="批量操作" aria-label="批量操作" :aria-pressed="model.bulk" @click="model.bulk?model.clearSelection():model.bulk=true"><HomeIcon name="batch" :size="18" /></button>
      <button type="button" class="asset-icon" :class="{active:popup==='filter' || model.activeFilters}" title="筛选资产" aria-label="筛选资产" :aria-expanded="popup==='filter'" @click="openFilter"><HomeIcon name="filter" :size="18" /><i v-if="model.activeFilters" class="asset-dot" /></button>
      <span class="asset-tools-space" />
      <button type="button" class="asset-icon" title="添加资产" aria-label="添加资产" :disabled="model.busy" :aria-expanded="popup==='add'" @click="popup=popup==='add'?null:'add'"><HomeIcon name="plus" :size="18" /></button>
      <button v-if="!manage" type="button" class="asset-manage-button" :disabled="model.busy" @click="model.openManager()"><HomeIcon name="folder" :size="16" />管理</button>
    </template>
    <div v-if="popup==='filter'" class="asset-popover asset-filter" role="dialog" aria-label="资产筛选">
      <header><strong>筛选</strong><button type="button" class="asset-text-button" @click="draftKind='all';draftTags=[]">重置</button></header>
      <span class="asset-field-label">类型</span><div class="asset-chips"><button v-for="option in [{value:'all',label:'全部'},{value:'image',label:'图片'},{value:'video',label:'视频'},{value:'audio',label:'声音'}] as const" :key="option.value" type="button" :class="{active:draftKind===option.value}" :aria-pressed="draftKind===option.value" @click="draftKind=option.value">{{ option.label }}</button></div>
      <span class="asset-field-label">标签 <small>匹配任一标签 · 不改变文件夹</small></span><div class="asset-chips"><button v-if="model.scope==='project'" type="button" @click="model.newTag();popup=null">＋ 新建标签</button><button v-for="tag in model.tags" :key="tag" type="button" :class="{active:draftTags.includes(tag)}" :aria-pressed="draftTags.includes(tag)" @click="toggleTag(tag)">{{ tag }}</button></div>
      <footer><button type="button" class="asset-button" @click="popup=null">取消</button><button type="button" class="asset-button primary" @click="apply">应用</button></footer>
    </div>
    <div v-if="popup==='add'" class="asset-popover asset-add-menu" role="menu" aria-label="添加资产">
      <button v-for="option in [{kind:'image',label:'上传图片',icon:'image'},{kind:'video',label:'上传视频',icon:'video'},{kind:'audio',label:'上传声音',icon:'mic'}] as const" v-show="model.scope!=='library' || option.kind!=='video'" :key="option.kind" type="button" role="menuitem" @click="popup=null;model.upload(option.kind)"><HomeIcon :name="option.icon" :size="17" />{{ option.label }}</button>
      <hr /><button type="button" role="menuitem" @click="popup=null;model.newFolder()"><HomeIcon name="folder" :size="17" />新建文件夹</button>
      <button v-if="model.scope==='project'" type="button" role="menuitem" @click="popup=null;model.newTag()"><HomeIcon name="tag" :size="17" />新建标签</button>
      <button v-if="!manage" type="button" role="menuitem" @click="popup=null;model.openManager().then(()=>model.scope='library')"><HomeIcon name="library" :size="17" />从公共资产库添加</button>
    </div>
  </div>
</template>
