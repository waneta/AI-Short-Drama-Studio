import { computed, onBeforeUnmount, ref, watch, type UnwrapNestedRefs } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import { useAssetsStore, useLibraryStore, useProjectStore, useToastStore } from '@/stores'
import { listProjects } from '@/services/storage'
import { openLightbox } from '@/composables/useLightbox'
import { pickLocalFiles } from '@/utils/pickLocalFiles'
import { ASSET_FOLDERS, ASSET_TAGS, assetFolder, organization, referencedAssets } from '@/services/assets/organization'
import { folderParent, folderTrail, folderDescendants, flattenFolders, validateFolderParent } from '@/services/assets/folderTree'
import { assetZip, downloadAssetBlob } from '@/services/assets/download'
import type { Asset } from '@/types'
import type { AssetFolder, AssetOrganization } from '@/types/assetOrganization'

export function useStudioAssets() {
  const project=useProjectStore(), assets=useAssetsStore(), library=useLibraryStore(), toast=useToastStore(), flow=useVueFlow()
  const manager=ref(false), scope=ref<'project'|'library'>('project'), source=ref<'all'|'generated'|'saved'|'uploaded'>('all')
  const search=ref(''), searchOpen=ref(false), folder=ref(''), kind=ref<'all'|Asset['kind']>('all'), filterTags=ref<string[]>([])
  const bulk=ref(false), selected=ref(new Set<string>()), busy=ref(false)
  const audio=ref<{id:string;url:string;name:string}|null>(null), thumbs=ref<Record<string,string>>({})
  const form=ref<{kind:'folder'|'tag'|'renameFolder';value:string;id?:string;parentId?:string}|null>(null)
  const deletion=ref<{items:Asset[];protectedCount:number;scope:'project'|'library';projectId:string}|null>(null)
  let previewRequest=0, thumbRequest=0
  const projectAssets=computed(()=>project.current?assets.all.filter(a=>!a.library && a.projectId===project.current!.id).sort((a,b)=>b.createdAt-a.createdAt):[])
  const all=computed(()=>scope.value==='library'?library.all:projectAssets.value)
  const config=computed(()=>organization(project.current))
  const folders=computed<AssetFolder[]>(()=>scope.value==='library'
    ? [...library.folders,{id:'public',name:'未分类',createdAt:0}]
    : [...ASSET_FOLDERS,...config.value.folders])
  function folderFor(a:Asset) { return scope.value==='library' ? (library.folders.some(f=>f.id===a.folderId)?a.folderId!:'public') : assetFolder(a,project.current) }
  function folderName(a:Asset) { return folders.value.find(f=>f.id===folderFor(a))?.name || '未分类' }
  function tagsFor(a:Asset) { return [...new Set(scope.value==='library' ? a.tags || [] : config.value.entries[a.id]?.tags || [])] }
  function isSaved(a:Asset) { return scope.value==='project' && Boolean(config.value.entries[a.id]?.saved) }
  const tags=computed(()=>[...new Set([...ASSET_TAGS,...(scope.value==='project'?config.value.tags:[]),...all.value.flatMap(tagsFor)])])
  const folderRows=computed(()=>flattenFolders(folders.value))
  const trail=computed(()=>folderTrail(folders.value,folder.value))
  const parentFolders=computed(()=>folderRows.value.filter(f=>f.id!=='public' && !(form.value?.id && folderDescendants(folders.value,form.value.id).has(f.id))))
  const filtered=computed(()=>all.value.filter(a=>(source.value==='all' || source.value==='generated' && a.source==='ai-generated' || source.value==='uploaded' && a.source==='uploaded' || source.value==='saved' && isSaved(a))
    && (kind.value==='all'||a.kind===kind.value)
    && (!search.value.trim() || `${a.filename} ${tagsFor(a).join(' ')}`.toLocaleLowerCase().includes(search.value.trim().toLocaleLowerCase()))
    && (!filterTags.value.length || filterTags.value.some(t=>tagsFor(a).includes(t)))))
  const browsing=computed(()=>!search.value.trim() && !activeFilters.value && source.value==='all')
  const visible=computed(()=>filtered.value.filter(a=>!manager.value || !folder.value || (browsing.value?folderFor(a)===folder.value:folderDescendants(folders.value,folder.value).has(folderFor(a)))))
  const groups=computed(()=>folders.value.map(f=>({...f,parentId:folderParent(f,folders.value),assets:filtered.value.filter(a=>folderFor(a)===f.id),allAssets:filtered.value.filter(a=>folderDescendants(folders.value,f.id).has(folderFor(a)))})))
  const roots=computed(()=>groups.value.filter(f=>!f.parentId))
  const childFolders=computed(()=>groups.value.filter(f=>f.parentId===(folder.value || undefined)))
  const selectedAssets=computed(()=>all.value.filter(a=>selected.value.has(a.id)))
  const activeFilters=computed(()=>Number(kind.value!=='all')+filterTags.value.length)
  function write(next:AssetOrganization) { project.setAssetOrganization(next) }
  function editEntries(ids:string[],patch:(entry:AssetOrganization['entries'][string])=>AssetOrganization['entries'][string]) {
    const next=JSON.parse(JSON.stringify(config.value)) as AssetOrganization
    const allowed=new Set(projectAssets.value.map(a=>a.id))
    for(const id of ids)if(allowed.has(id))next.entries[id]=patch(next.entries[id] || {})
    write(next)
  }
  function toggle(id:string) { const next=new Set(selected.value);next.has(id)?next.delete(id):next.add(id);selected.value=next }
  function selectItems(items:Asset[]) { const next=new Set(selected.value),checked=items.length>0 && items.every(a=>next.has(a.id));for(const a of items)checked?next.delete(a.id):next.add(a.id);selected.value=next }
  function clearSelection() { selected.value=new Set();bulk.value=false }
  function resetView() { search.value='';folder.value='';kind.value='all';filterTags.value=[];source.value='all';clearSelection();audio.value=null }
  watch(()=>project.current?.id,()=>{++previewRequest;scope.value='project';manager.value=false;form.value=null;deletion.value=null;resetView()})
  watch(scope,resetView)
  // A new filter or source must never leave invisible items queued for deletion.
  watch([search,kind,filterTags,source,folder],()=>{selected.value=new Set()}, {deep:true})
  watch(()=>visible.value.map(a=>a.id).join('|'),()=>{selected.value=new Set([...selected.value].filter(id=>visible.value.some(a=>a.id===id)))})
  watch(()=>[...projectAssets.value,...library.all].map(a=>a.id).join('|'),async()=>{
    const request=++thumbRequest, entries=await Promise.all([...projectAssets.value,...library.all].map(async a=>{
      try {return [a.id,a.kind==='audio'?'':a.library?(a.kind==='video'?await library.getThumbUrl(a.id):await library.getUrl(a.id)):a.kind==='image'?await assets.getUrl(a.id):await assets.getThumbUrl(a.id)] as const}
      catch {return [a.id,''] as const}
    }))
    if(request===thumbRequest)thumbs.value=Object.fromEntries(entries.map(([id,url])=>[id,url || '']))
  },{immediate:true})
  onBeforeUnmount(()=>{++previewRequest;++thumbRequest})
  async function run(action:()=>Promise<void>) {
    if(busy.value)return
    busy.value=true
    try{await action()}catch(error){toast.error(error instanceof Error?error.message:'操作失败，请重试')}finally{busy.value=false}
  }
  async function openManager() { manager.value=true;folder.value='';clearSelection();await run(()=>library.refresh()) }
  function closeManager() { manager.value=false;scope.value='project';resetView();form.value=null;deletion.value=null }
  async function preview(a:Asset) {
    const request=++previewRequest;audio.value=null
    try{const url=a.library?(a.kind==='video'?await library.getThumbUrl(a.id):await library.getUrl(a.id)):await assets.getUrl(a.id);if(request!==previewRequest)return;if(!url)throw new Error('素材文件暂时无法读取');if(a.kind==='audio')audio.value={id:a.id,url,name:a.filename};else openLightbox(url,a.kind,a.filename)}catch(error){if(request===previewRequest)toast.error(error instanceof Error?error.message:'素材读取失败')}
  }
  function favorite(ids:string[],saved:boolean) { editEntries(ids,e=>({...e,saved}));toast.success(saved?'已收藏到项目资产':'已取消收藏') }
  async function move(ids:string[],target:string) {
    await run(async()=>{if(!folders.value.some(f=>f.id===target))throw new Error('文件夹已不存在');if(scope.value==='library')await library.moveToFolder(ids,target==='public'?null:target);else editEntries(ids,e=>({...e,folderId:target}));selected.value=new Set();toast.success('已移动到文件夹')})
  }
  function tagSelected(tag:string) { return selectedAssets.value.length>0 && selectedAssets.value.every(a=>tagsFor(a).includes(tag)) }
  async function assignTag(ids:string[],tag:string) {
    const items=all.value.filter(a=>ids.includes(a.id)),remove=items.length>0 && items.every(a=>tagsFor(a).includes(tag))
    await run(async()=>{
      if(scope.value==='library')await library.setTags(ids,tag,remove)
      else editEntries(ids,e=>({...e,tags:remove?(e.tags || []).filter(t=>t!==tag):[...new Set([...(e.tags || []),tag])]}))
      toast.success(remove?'已移除标签':'已添加标签')
    })
  }
  function newFolder(parentId=folder.value) { form.value={kind:'folder',value:'',parentId:parentId==='public'?undefined:parentId || undefined} }
  function newTag() { form.value={kind:'tag',value:''} }
  function renameFolder(f:AssetFolder) { form.value={kind:'renameFolder',id:f.id,value:f.name,parentId:folderParent(f,folders.value)} }
  async function saveForm() {
    if(!form.value)return
    const draft={...form.value},value=draft.value.trim(),parentId=draft.parentId || undefined
    if(!value){toast.warn('请输入名称');return}
    await run(async()=>{
      if(value.length>40)throw new Error('名称最多40个字')
      if(draft.kind!=='tag'){
        validateFolderParent(folders.value,draft.id,parentId)
        if(/[\\/]/.test(value))throw new Error('文件夹名称不能包含路径分隔符')
      }
      const choices=draft.kind==='tag'?tags.value:folders.value.filter(f=>f.id!==draft.id && folderParent(f,folders.value)===parentId).map(f=>f.name)
      if(choices.some(n=>n.toLocaleLowerCase()===value.toLocaleLowerCase()))throw new Error('已有同名'+(draft.kind==='tag'?'标签':'文件夹'))
      if(draft.kind==='tag')write({...config.value,tags:[...config.value.tags,value]})
      else if(scope.value==='library') {
        if(draft.kind==='renameFolder'){await library.renameFolder(draft.id!,value,parentId || null);folder.value=draft.id!}
        else {const created=await library.createFolder(value,parentId);folder.value=created.id}
      }
      else if(draft.kind==='renameFolder') {write({...config.value,folders:config.value.folders.map(f=>f.id===draft.id?{...f,name:value,parentId}:f)});folder.value=draft.id!}
      else {const id=`asset-folder_${crypto.randomUUID()}`;write({...config.value,folders:[...config.value.folders,{id,name:value,parentId,createdAt:Date.now()}]});folder.value=id}
      form.value=null;toast.success(draft.kind==='renameFolder'?'文件夹已保存':draft.kind==='tag'?'标签已创建':'文件夹已创建')
    })
  }
  async function upload(media:Asset['kind']) {
    const pid=project.current?.id,targetScope=scope.value,targetFolder=folder.value
    if(!pid)return
    // Keep the native file picker directly in the user gesture.
    let files:File[]
    try{files=await pickLocalFiles({kind:media,multiple:true})}catch(error){toast.error(String(error));return}
    if(!files.length || pid!==project.current?.id)return
    await run(async()=>{
      let count=0
      for(const file of files){
        if(!file.type.startsWith(`${media}/`))throw new Error(`不支持的文件：${file.name}`)
        if(targetScope==='library'){
          await library.add(file,'uploaded',{kind:media,filename:file.name,folderId:targetFolder || undefined})
        }else{
          const a=await assets.add(file,media,'uploaded',{filename:file.name,projectId:pid})
          if(project.current?.id===pid && targetFolder)editEntries([a.id],e=>({...e,folderId:targetFolder}))
        }
        count++
      }
      if(project.current?.id===pid)toast.success(`已上传 ${count} 项素材`)
    })
  }
  async function importAssets(ids:string[]) {
    const pid=project.current?.id;if(!pid)return
    await run(async()=>{
      let count=0
      for(const id of ids){
        const a=library.getMeta(id);if(!a)continue
        const blob=await library.getBlob(id);if(!blob)throw new Error(`读不到 ${a.filename}`)
        if(project.current?.id!==pid)return
        const imported=await assets.add(blob,a.kind,a.source,{projectId:pid,filename:a.filename,prompt:a.prompt,generation:a.generation});if(project.current?.id===pid && a.tags?.length)editEntries([imported.id],e=>({...e,tags:[...a.tags!]}));count++
      }
      toast.success(`已添加 ${count} 项到当前项目`);clearSelection()
    })
  }
  function addToCanvas(ids:string[]) {
    const p=project.current;if(!p)return
    const items=projectAssets.value.filter(a=>ids.includes(a.id) && a.kind!=='audio')
    if(!items.length){toast.warn('声音可在视频节点的参考声音中选用');return}
    const vp=flow.getViewport(),rect=flow.vueFlowRef.value?.getBoundingClientRect(),x=((rect?.width || 1000)/2-vp.x)/vp.zoom,y=((rect?.height || 700)/2-vp.y)/vp.zoom
    items.forEach((a,i)=>{if(a.kind==='audio')return;project.addCanvasNode({id:`${a.kind}Gen_${crypto.randomUUID()}`,type:a.kind==='video'?'videoGen':'imageGen',position:{x:x+(i%3)*280,y:y+Math.floor(i/3)*250},status:'success',data:{label:a.filename,outputAssetId:a.id,prompt:a.generation?.userPrompt || a.prompt || '',aspectRatio:Math.abs(a.width-a.height)<2?'1:1':a.width>a.height?'16:9':'9:16'}})})
    toast.success(`已添加 ${items.length} 个节点到画布`)
  }
  async function download(ids:string[]) {
    const items=all.value.filter(a=>ids.includes(a.id))
    if(!items.length)return
    await run(async()=>{const files=[];for(const a of items){const blob=a.library?await library.getBlob(a.id):await assets.getBlob(a.id);if(!blob)throw new Error(`读不到 ${a.filename}，未开始下载`);files.push({name:a.filename,blob})}downloadAssetBlob(files.length===1?files[0].blob:await assetZip(files),files.length===1?files[0].name:`${project.current?.name || '项目'}-素材.zip`);toast.success(`已准备 ${files.length} 项下载`)})
  }
  async function requestDelete(ids:string[]) {
    const pid=project.current?.id,targetScope=scope.value,items=all.value.filter(a=>ids.includes(a.id));if(!pid||!items.length)return
    await run(async()=>{
      const projects=targetScope==='library'?await listProjects():[]
      if(project.current?.id!==pid)return
      const used=new Set([...referencedAssets(project.current),...projects.filter(p=>p.id!==pid).flatMap(p=>[...referencedAssets(p)])])
      deletion.value={items:items.filter(a=>!used.has(a.id)),protectedCount:items.filter(a=>used.has(a.id)).length,scope:targetScope,projectId:pid}
    })
  }
  async function confirmDelete() {
    const pending=deletion.value;if(!pending||pending.projectId!==project.current?.id)return
    await run(async()=>{
      const used=referencedAssets(project.current),ids=pending.items.filter(a=>!used.has(a.id)).map(a=>a.id)
      for(const id of ids)pending.scope==='library'?await library.remove(id):await assets.remove(id)
      if(pending.scope==='project' && project.current?.id===pending.projectId){const next=JSON.parse(JSON.stringify(config.value)) as AssetOrganization;ids.forEach(id=>delete next.entries[id]);write(next)}
      if(audio.value && ids.includes(audio.value.id)){++previewRequest;audio.value=null}
      deletion.value=null;selected.value=new Set();toast.success(`已删除 ${ids.length} 项未被引用的素材`)
    })
  }
  return {manager,scope,source,search,searchOpen,folder,kind,filterTags,bulk,selected,busy,audio,thumbs,form,deletion,projectAssets,all,folders,folderRows,trail,parentFolders,tags,filtered,visible,groups,roots,childFolders,browsing,selectedAssets,activeFilters,folderFor,folderName,tagsFor,isSaved,toggle,selectItems,clearSelection,resetView,openManager,closeManager,preview,favorite,move,assignTag,tagSelected,newFolder,newTag,renameFolder,saveForm,upload,importAssets,addToCanvas,download,requestDelete,confirmDelete}
}
export type StudioAssetModel=UnwrapNestedRefs<ReturnType<typeof useStudioAssets>>
