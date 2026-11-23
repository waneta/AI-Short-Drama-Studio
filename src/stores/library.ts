import { folderParent, validateFolderParent } from '@/services/assets/folderTree'
import { defineStore } from 'pinia'
import { ref } from 'vue'
import {
  listLibraryAssets,
  loadAsset,
  saveLibraryAsset,
  loadLibraryAssetBlob,
  loadLibraryThumbBlob,
  deleteLibraryAsset,
  loadAssetBlob,
  listLibraryFolders,
  saveLibraryFolders,
  updateLibraryAssetMeta
} from '@/services/storage'
import { isDesktop, assetFileUrl } from '@/services/desktop'
import { libraryAssetAbsPath } from '@/services/storage'
import { probeMedia, ensurePlayableBlob, extractVideoThumbnail } from '@/services/ffmpeg'
import type { Asset, ID, LibraryFolder, GenerationRecord } from '@/types'

/** 公共资产（未分类）在 UI 里用这个 id */
export const LIBRARY_PUBLIC_ID = 'public'

export const useLibraryStore = defineStore('library', () => {
  const all = ref<Asset[]>([])
  const folders = ref<LibraryFolder[]>([])
  const urlCache = new Map<ID, string>()
  const ensureFolderJobs = new Map<string, Promise<LibraryFolder>>()

  async function refresh() {
    const [assets, list] = await Promise.all([listLibraryAssets(), listLibraryFolders()])
    all.value = assets
    folders.value = list.sort((a, b) => a.createdAt - b.createdAt)
  }

  function inFolder(folderId: string | null): Asset[] {
    if (!folderId || folderId === LIBRARY_PUBLIC_ID) {
      return all.value.filter((a) => !a.folderId)
    }
    return all.value.filter((a) => a.folderId === folderId)
  }

  function folderCount(folderId: string | null): number {
    return inFolder(folderId).length
  }

  function folderName(folderId?: string): string {
    if (!folderId) return '公共资产'
    return folders.value.find((f) => f.id === folderId)?.name ?? '公共资产'
  }

  async function add(
    blob: Blob,
    source: Asset['source'],
    options: { generation?: GenerationRecord; filename?: string; prompt?: string; folderId?: string; kind?: Asset['kind']; tags?: string[]; videoInfo?: { fps: number; hasAudio: boolean } } = {}
  ): Promise<Asset> {
    const kind = options.kind || (blob.type.startsWith('audio/') ? 'audio' : blob.type.startsWith('video/') ? 'video' : 'image')
    const typed = await ensurePlayableBlob(blob, kind)
    const info = await probeMedia(typed)
    const id = `${kind}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
    const folderId =
      options.folderId && options.folderId !== LIBRARY_PUBLIC_ID ? options.folderId : undefined
    const base = {
      id,
      mimeType: typed.type || (kind === 'audio' ? 'audio/wav' : 'image/png'),
      filename: options.filename ?? `library_${id}`,
      size: typed.size,
      createdAt: Date.now(),
      source,
      prompt: options.prompt,
      generation: options.generation ? JSON.parse(JSON.stringify(options.generation)) : undefined,
      library: true,
      tags: options.tags ? [...options.tags] : undefined,
      folderId
    }
    const asset: Asset = kind === 'audio'
      ? { ...base, kind, duration: info.duration ?? 0 }
      : kind === 'video'
        ? { ...base, kind, width: info.width, height: info.height, duration: info.duration ?? 0, fps: options.videoInfo?.fps || 30, hasAudio: options.videoInfo?.hasAudio ?? info.hasAudio ?? false }
        : { ...base, kind, width: info.width, height: info.height }
    const thumb = kind === 'video' ? await extractVideoThumbnail(typed).catch(() => undefined) : undefined
    await saveLibraryAsset(asset, typed, thumb)
    await refresh()
    return asset
  }

  async function publishFrom(
    assetId: ID,
    meta?: { generation?: GenerationRecord; filename?: string; prompt?: string; tags?: string[] }
  ): Promise<Asset> {
    const blob = await loadAssetBlob(assetId)
    if (!blob) throw new Error('读不到这份素材')
    const original = await loadAsset(assetId)
    return add(blob, original?.source || 'ai-generated', {
      kind: original?.kind || 'image',
      tags: meta?.tags || original?.tags,
      videoInfo: original?.kind === 'video' ? { fps: original.fps, hasAudio: original.hasAudio } : undefined,
      filename: meta?.filename || original?.filename,
      generation: meta?.generation || original?.generation,
      prompt: meta?.prompt || original?.prompt
    })
  }

  async function getUrl(id: ID): Promise<string | undefined> {
    const cached = urlCache.get(id)
    if (cached) return cached
    // Audio needs a blob URL for reliable playback and seeking on desktop too.
    if (isDesktop() && !['audio', 'video'].includes(getMeta(id)?.kind || '')) {
      const abs = await libraryAssetAbsPath(id)
      if (abs) {
        const url = assetFileUrl(abs)
        urlCache.set(id, url)
        return url
      }
    }
    const blob = await loadLibraryAssetBlob(id)
    if (!blob) return undefined
    const url = URL.createObjectURL(blob)
    urlCache.set(id, url)
    return url
  }

  async function getThumbUrl(id: ID): Promise<string | undefined> {
    const key = `thumb:${id}`, cached = urlCache.get(key)
    if (cached) return cached
    const blob = await loadLibraryThumbBlob(id)
    if (!blob) return undefined
    const url = URL.createObjectURL(blob); urlCache.set(key, url); return url
  }

  async function getBlob(id: ID): Promise<Blob | undefined> {
    return loadLibraryAssetBlob(id)
  }

  function getMeta(id: ID): Asset | undefined {
    return all.value.find((a) => a.id === id)
  }

  async function remove(id: ID) {
    await deleteLibraryAsset(id)
    const url = urlCache.get(id)
    if (url?.startsWith('blob:')) URL.revokeObjectURL(url)
    urlCache.delete(id)
    const thumb = urlCache.get(`thumb:${id}`); if (thumb) URL.revokeObjectURL(thumb)
    urlCache.delete(`thumb:${id}`)
    await refresh()
  }

  function assertFolderName(name: string, exceptId?: string, parentId?: string) {
    const trimmed = name.trim()
    if (!trimmed) throw new Error('请输入文件夹名称')
    if (trimmed === '公共资产' || trimmed === '公共资产库') {
      throw new Error('这个名字留给公共资产库用')
    }
    if (folders.value.some((f) => f.name.toLocaleLowerCase() === trimmed.toLocaleLowerCase() && f.id !== exceptId && folderParent(f, folders.value) === parentId)) {
      throw new Error('已有同名文件夹')
    }
    if (/[\\/]/.test(trimmed)) throw new Error('文件夹名称不能包含路径分隔符')
    return trimmed
  }

  async function createFolder(name: string, parentId?: string): Promise<LibraryFolder> {
    validateFolderParent(folders.value, undefined, parentId)
    const trimmed = assertFolderName(name, undefined, parentId)
    const folder: LibraryFolder = {
      id: `folder_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
      name: trimmed,
      parentId,
      createdAt: Date.now()
    }
    folders.value = [...folders.value, folder]
    await saveLibraryFolders(folders.value)
    return folder
  }

  /** 给节点自动归档使用；并发生成时同一分类只会创建一次。 */
  async function ensureFolder(name: string): Promise<LibraryFolder> {
    const trimmed = name.trim()
    const current = folders.value.find((folder) => folder.name === trimmed && !folderParent(folder, folders.value))
    if (current) return current
    const pending = ensureFolderJobs.get(trimmed)
    if (pending) return pending
    const job = (async () => {
      await refresh()
      return folders.value.find((folder) => folder.name === trimmed && !folderParent(folder, folders.value)) || createFolder(trimmed)
    })()
    ensureFolderJobs.set(trimmed, job)
    try {
      return await job
    } finally {
      ensureFolderJobs.delete(trimmed)
    }
  }

  async function addCategorized(
    blob: Blob,
    category: '角色' | '场景' | '道具' | '其他',
    source: Asset['source'],
    options: { generation?: GenerationRecord; filename?: string; prompt?: string } = {}
  ): Promise<Asset> {
    const folder = await ensureFolder(category)
    return add(blob, source, { ...options, folderId: folder.id })
  }

  async function renameFolder(id: string, name: string, parentId?: string | null): Promise<void> {
    const current = folders.value.find(f => f.id === id)
    if (!current) throw new Error('找不到这个文件夹')
    const target = parentId === undefined ? folderParent(current, folders.value) : parentId || undefined
    validateFolderParent(folders.value, id, target)
    const trimmed = assertFolderName(name, id, target)
    const next = folders.value.map(f => f.id === id ? { ...f, name: trimmed, parentId: target } : f)
    await saveLibraryFolders(next)
    folders.value = next
  }

  async function deleteFolder(id: string): Promise<void> {
    const current = folders.value.find(f => f.id === id)
    if (!current) return
    const parentId = folderParent(current, folders.value)
    for (const asset of all.value.filter(a => a.folderId === id)) {
      await updateLibraryAssetMeta(asset.id, { folderId: parentId || null })
    }
    // Retain children and their contents when the home library deletes a folder.
    const next = folders.value.filter(f => f.id !== id).map(f => f.parentId === id ? { ...f, parentId } : f)
    await saveLibraryFolders(next)
    await refresh()
  }

  async function setTags(ids: ID[], tag: string, remove = false): Promise<void> {
    for (const id of ids) {
      const asset = getMeta(id)
      if (!asset) continue
      const tags = remove ? (asset.tags || []).filter(t => t !== tag) : [...new Set([...(asset.tags || []), tag])]
      await updateLibraryAssetMeta(id, { tags })
    }
    await refresh()
  }

  async function moveToFolder(ids: ID[], folderId: string | null): Promise<void> {
    const target =
      !folderId || folderId === LIBRARY_PUBLIC_ID ? null : folderId
    for (const id of ids) {
      await updateLibraryAssetMeta(id, { folderId: target })
    }
    await refresh()
  }

  return {
    all,
    folders,
    refresh,
    add,
    publishFrom,
    getUrl,
    getBlob,
    getThumbUrl,
    getMeta,
    remove,
    inFolder,
    folderCount,
    folderName,
    createFolder,
    ensureFolder,
    addCategorized,
    renameFolder,
    deleteFolder,
    moveToFolder,
    setTags
  }
})
