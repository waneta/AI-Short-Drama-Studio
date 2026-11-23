import type { Asset, Project } from '@/types'
import type { AssetOrganization } from '@/types/assetOrganization'
export const ASSET_FOLDERS = [
  { id:'design', name:'人物设定' }, { id:'characters', name:'角色' },
  { id:'scenes', name:'场景' }, { id:'props', name:'物品' },
  { id:'style', name:'风格' }, { id:'audio', name:'音效' },
  { id:'video', name:'视频' }, { id:'other', name:'未分类' }
].map(f => ({ ...f, createdAt:0 }))
export const ASSET_TAGS = ['角色','场景','物品','风格','音效']
export function organization(project: Project | null): AssetOrganization {
  const value=project?.assetOrganization
  return { folders:value?.folders || [], tags:value?.tags || [], entries:value?.entries || {} }
}
export function assetFolder(asset: Asset, project: Project | null): string {
  const entry=organization(project).entries[asset.id]
  if(entry?.folderId && [...ASSET_FOLDERS,...organization(project).folders].some(f=>f.id===entry.folderId))return entry.folderId
  if(asset.kind==='audio')return 'audio'
  if(asset.kind==='video')return 'video'
  if(project?.subjects?.some(s=>s.designSheetAssetId===asset.id || s.designSheetHistoryIds?.includes(asset.id)))return 'design'
  if(project?.subjects?.some(s=>s.propSheetAssetId===asset.id || s.propSheetHistoryIds?.includes(asset.id)))return 'props'
  if(project?.scenes?.some(s=>s.plateAssetId===asset.id || s.plateHistoryIds?.includes(asset.id)))return 'scenes'
  if(project?.scenes?.some(s=>s.propSheetAssetId===asset.id || s.propSheetHistoryIds?.includes(asset.id)))return 'props'
  return 'other'
}
/** Compare exact IDs, including historical outputs, without treating organizer keys as usage. */
export function referencedAssets(project: Project | null): Set<string> {
  const ids=new Set<string>()
  function scan(value:unknown) {
    if(typeof value==='string')ids.add(value)
    else if(Array.isArray(value))value.forEach(scan)
    else if(value && typeof value==='object')for(const [key,v] of Object.entries(value))if(key!=='assetOrganization')scan(v)
  }
  scan(project);return ids
}
export function assetDetails(asset: Asset) {
  const kind={image:'图片',video:'视频',audio:'声音'}[asset.kind]
  const dimensions=asset.kind!=='audio' ? ` · ${asset.width} × ${asset.height}` : ''
  const duration=asset.kind!=='image' ? ` · ${Number(asset.duration || 0).toFixed(1)} 秒` : ''
  return kind+dimensions+duration
}
