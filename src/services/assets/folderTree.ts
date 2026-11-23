export interface FolderLike { id:string; name:string; parentId?:string }
/** Old root folders need no migration. Invalid parents and cycles recover at root. */
export function folderParent(folder:FolderLike,folders:FolderLike[]):string|undefined {
  if(!folder.parentId || !folders.some(f=>f.id===folder.parentId))return
  const seen=new Set([folder.id]);let id:string|undefined=folder.parentId
  while(id){if(seen.has(id))return;seen.add(id);id=folders.find(f=>f.id===id)?.parentId}
  return folder.parentId
}
export function folderTrail<T extends FolderLike>(folders:T[],id:string):T[] {
  const result:T[]=[],seen=new Set<string>();let current=folders.find(f=>f.id===id)
  while(current && !seen.has(current.id)){result.unshift(current);seen.add(current.id);current=folders.find(f=>f.id===folderParent(current!,folders))}
  return result
}
export function folderDescendants(folders:FolderLike[],id:string):Set<string> {
  const ids=new Set([id]);let changed=true
  while(changed){changed=false;for(const f of folders){const parent=folderParent(f,folders);if(parent && ids.has(parent) && !ids.has(f.id)){ids.add(f.id);changed=true}}}
  return ids
}
export function flattenFolders<T extends FolderLike>(folders:T[]) {
  const rows:Array<T & {depth:number;path:string}>=[]
  function visit(parentId?:string,depth=0){for(const f of folders.filter(f=>folderParent(f,folders)===parentId)){rows.push({...f,depth,path:folderTrail(folders,f.id).map(p=>p.name).join(' / ')});visit(f.id,depth+1)}}
  visit();return rows
}
export function validateFolderParent(folders:FolderLike[],id:string|undefined,parentId?:string) {
  if(parentId && !folders.some(f=>f.id===parentId))throw new Error('父文件夹已不存在')
  if(id && parentId && folderDescendants(folders,id).has(parentId))throw new Error('不能将文件夹放进自身或子文件夹')
}
