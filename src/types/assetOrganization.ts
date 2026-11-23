export interface AssetFolder { id: string; name: string; createdAt: number; parentId?: string }
/** Project-owned organization; media bytes and reference IDs never change. */
export interface AssetOrganization {
  folders: AssetFolder[]
  tags: string[]
  entries: Record<string, { folderId?: string; tags?: string[]; saved?: boolean }>
}
