import { listProjects, listLibraryAssets } from '@/services/storage'
import { listAssetMetadata } from '@/services/storage/idb'
import { listAssetMetadataInDir } from '@/services/storage/fs'
import { isDesktop, desktop, blobFromPath } from '@/services/desktop'
import { loadAssetBlob } from '@/services/storage/idb'
import type { Asset, Project } from '@/types'
import type { StatisticsAsset } from './generationStats'

export async function loadStatisticsHistory(): Promise<{ assets: StatisticsAsset[]; projects: Project[]; warnings: string[] }> {
  const projects = await listProjects(), warnings: string[] = []
  const assets: StatisticsAsset[] = []
  if (!isDesktop()) return { assets: await listAssetMetadata(), projects, warnings }
  for (const p of projects) {
    if (!p.folderPath) { warnings.push(`项目“${p.name}”缺少素材目录，未读取。`); continue }
    try {
      const records = await listAssetMetadataInDir(p.folderPath)
      assets.push(...records.map(a => ({ ...a, statisticsProjectIds: [p.id] })))
    } catch { warnings.push(`项目“${p.name}”的素材清单无法读取，未计入。`) }
  }
  try { assets.push(...await listLibraryAssets()) } catch { warnings.push('共享资产库无法读取，未计入。') }
  return { assets, projects, warnings }
}

/** Called only on explicit preview; never changes the active project directory or asset store. */
export async function statisticsPreviewBlob(asset: Asset, projects: Pick<Project, 'id' | 'folderPath'>[], projectIds: string[]) {
  if (!isDesktop()) return loadAssetBlob(asset.id)
  if (!asset.fileRelPath) return undefined
  const api = desktop()
  const dir = asset.library ? await api.join(await api.getRoot(), '_library') : projects.find(p => projectIds.includes(p.id))?.folderPath
  if (!dir) return undefined
  // Metadata can be imported. A preview may only read under its known assets directory.
  const rel = asset.fileRelPath.replace(/\\/g,'/')
  if (!/^assets\//.test(rel) || rel.split('/').some(p => p === '..') || rel.includes(':')) throw new Error('素材路径无效')
  return blobFromPath(await api.join(dir, rel))
}
