import { computed, ref, watch } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import { useAssetsStore, useLibraryStore, useProjectStore, useToastStore } from '@/stores'
import { openLightbox } from './useLightbox'
import type { useCanvasEditing } from './useCanvasEditing'
import { customGroup, selectionMembers } from '@/services/canvas/editing'
import { canvasNodeOutputAssetId } from '@/services/canvas/references'
import { rebuildCanvasGraph } from '@/services/canvas/layout'
import { isNodeRunning } from '@/services/canvas/jobs'
import { downloadAssetBlob } from '@/services/assets/download'
import { probeMedia } from '@/services/ffmpeg'
import type { CanvasContextItem } from '@/components/canvas/CanvasNodeContextMenu.vue'
import type { Asset, CanvasNode, Subject } from '@/types'

export type SubjectDraft = { projectId: string; name: string; kind: Subject['kind']; description: string; assetId: string; video: boolean; preview: string }
export type Verification = { title: string; rows: { label: string; value: string; ok?: boolean }[] }
export function useCanvasContextActions(options: { nodeId: () => string | undefined; point: () => { x: number; y: number } | undefined; close: () => void; editing: ReturnType<typeof useCanvasEditing> }) {
  const project = useProjectStore(), assets = useAssetsStore(), library = useLibraryStore(), toast = useToastStore(), flow = useVueFlow()
  const busy = ref(false), subjectDraft = ref<SubjectDraft>(), verification = ref<Verification>()
  const node = computed(() => project.current?.canvas?.nodes.find(n => n.id === options.nodeId()))
  const group = computed(() => customGroup(node.value)), media = computed(() => output(node.value)), rating = computed(() => Number(node.value?.data.rating) || 0)
  const selected = computed(() => options.editing.selectedIds.value)
  function output(n?: CanvasNode): Asset | undefined {
    const p = project.current
    if (!p || !n) return
    const id = canvasNodeOutputAssetId(p, n)
    return id ? assets.getMeta(id) : undefined
  }
  const taskId = computed(() => media.value?.generation?.promptId || node.value?.data.videoTaskId)
  const items = computed<CanvasContextItem[]>(() => {
    const n = node.value, asset = media.value, isGroup = group.value, video = n?.type === 'videoGen' || n?.type === 'shotVideo'
    const members = project.current?.canvas ? selectionMembers(project.current.canvas, selected.value) : []
    const copyable = Boolean(members.length) && members.every(m => customGroup(m) || ['imageGen', 'videoGen'].includes(m.type))
    const running = members.some(m => isNodeRunning(m.id))
    const entries: CanvasContextItem[] = []
    if (!isGroup) entries.push({ id: 'compliance', label: 'Seedance 合规校验', disabled: true, title: '当前未接入 Seedance 专属合规校验服务' })
    entries.push({ id: 'publish', label: '保存到我的资产', disabled: !asset || isGroup, title: isGroup ? '请在具体图片或视频节点上保存素材' : '将当前结果复制到公共资产库，供其他项目复用' })
    if (!isGroup && !video) entries.push({ id: 'preview', label: '进入全景预览', disabled: !asset, title: '全屏查看当前图片' })
    if (!isGroup && video) entries.push({ id: 'preview', label: '播放视频', disabled: !asset })
    entries.push({ id: 'subject', label: '创建主体', disabled: !asset || isGroup, title: video ? '使用视频封面创建角色主体，提交前可编辑名称和描述' : '使用当前图片创建角色主体' })
    if (isGroup) entries.push({ id: 'ungroup', label: '解组', shortcut: 'Ctrl+Shift+G', disabled: running })
    if (video || isGroup) entries.push({ id: 'arrange', label: '优化工作流布局', title: isGroup ? '整理组合内节点' : '整理所在组合；独立节点整理当前画布', disabled: running })
    if (!isGroup) entries.push({ id: 'download', label: '下载', separator: true, disabled: !asset })
    entries.push({ id: 'copy', label: '复制节点', shortcut: 'Ctrl+C', separator: isGroup, disabled: !copyable, title: '复制所选节点和组合，使用粘贴放置；外部上游已生成图片转为素材引用' })
    if (asset?.kind === 'image') entries.push({ id: 'copy-image', label: '复制图片', title: '复制PNG图片到系统剪贴板' })
    entries.push({ id: 'duplicate', label: '创建副本', shortcut: 'Ctrl+D', disabled: !copyable || running, title: '立即创建所选节点、结果和入向连线的副本' }, { id: 'paste', label: '粘贴', shortcut: 'Ctrl+V', title: '在此处粘贴当前项目内复制的节点或组合' }, { id: 'delete', label: '删除', shortcut: 'Del', danger: true, disabled: running || members.some(m => (m.type === 'groupFrame' && !customGroup(m)) || ['export', 'final'].includes(m.type)) }, { id: 'copy-info', label: '复制到剪贴板', separator: true, title: '复制节点信息与生成参数，便于记录和排查' })
    if (!isGroup) entries.push({ id: 'task', label: '复制 TaskId', disabled: !taskId.value, title: taskId.value || '当前结果没有生成任务ID；上传素材不会虚构任务ID' })
    if (video) entries.push({ id: 'verify', label: '核验生成结果', disabled: !asset, title: '检查本地视频文件是否可读取，以及实际分辨率和时长' })
    return entries
  })
  function rate(value: number) {
    if (!node.value) return
    options.editing.history.begin(); project.patchCanvasNode(node.value.id, { rating: Math.max(0, Math.min(5, value)) }); options.editing.history.end()
  }
  async function run(job: () => Promise<void>) {
    if (busy.value) return
    busy.value = true
    try { await job() } catch (error) { toast.error(error instanceof Error ? error.message : '操作失败') } finally { busy.value = false }
  }
  async function action(id: string) {
    const n = node.value, asset = media.value, point = options.point(), projectId = project.current?.id, task = taskId.value
    if (!n || items.value.find(item => item.id === id)?.disabled || busy.value) return
    options.close()
    if (id === 'arrange' && selected.value.length === 1 && n.parentGroupId && customGroup(project.current?.canvas?.nodes.find(p => p.id === n.parentGroupId))) await options.editing.choose([n.parentGroupId])
    if (['duplicate', 'delete', 'ungroup', 'arrange'].includes(id)) { options.editing.execute(id as 'duplicate' | 'delete' | 'ungroup' | 'arrange'); return }
    if (id === 'copy') { await options.editing.copy(); return }
    if (id === 'paste') { await options.editing.paste(point); return }
    await run(async () => {
      if (id === 'copy-info') {
        const members = project.current?.canvas ? selectionMembers(project.current.canvas, selected.value) : [n]
        await navigator.clipboard.writeText(JSON.stringify({ name: n.data.label, nodes: members.map(m => ({ id: m.id, type: m.type, name: m.data.label, parameters: m.data, generation: output(m)?.generation })) }, null, 2)); toast.success('已复制节点信息与生成参数'); return
      }
      if (id === 'task' && task) { await navigator.clipboard.writeText(task); toast.success('已复制 TaskId'); return }
      if (!asset) throw new Error('节点还没有可用的生成结果')
      if (id === 'preview') { const url = await assets.getUrl(asset.id); if (!url) throw new Error('素材文件无法读取'); openLightbox(url, asset.kind === 'video' ? 'video' : 'image', n.data.label || asset.filename); return }
      if (id === 'publish') { await library.publishFrom(asset.id, { filename: asset.filename, prompt: asset.prompt || n.data.prompt, tags: project.current?.assetOrganization?.entries[asset.id]?.tags || asset.tags }); toast.success('已保存到公共资产库'); return }
      const blob = await assets.getBlob(asset.id)
      if (!blob) throw new Error('素材文件无法读取')
      if (id === 'download') { downloadAssetBlob(blob, asset.filename); return }
      if (id === 'copy-image') {
        if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error('当前浏览器不支持复制图片，请使用下载')
        const image = new Image(), url = URL.createObjectURL(blob)
        try {
          image.src = url; await image.decode()
          const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
          const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('无法读取图片'); ctx.drawImage(image, 0, 0)
          const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('图片转换失败')), 'image/png'))
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]); toast.success('已复制图片')
        } finally { URL.revokeObjectURL(url) }
        return
      }
      if (id === 'subject') {
        const video = asset.kind === 'video', preview = video ? await assets.ensureThumb(asset.id) : await assets.getUrl(asset.id)
        if (project.current?.id !== projectId) return
        if (!preview) throw new Error('无法读取主体参考图片或视频封面')
        subjectDraft.value = { projectId: projectId!, name: n.data.label || '新主体', kind: 'person', description: '', assetId: asset.id, video, preview }; return
      }
      if (id === 'verify') {
        try {
          const info = await probeMedia(blob)
          if (project.current?.id !== projectId) return
          const valid = asset.kind === 'video' && info.width > 0 && info.height > 0 && (info.duration || 0) > 0
          verification.value = { title: '视频结果核验', rows: [{ label: '本地文件', value: `${(blob.size / 1024 / 1024).toFixed(2)} MB · ${blob.type || asset.mimeType}`, ok: blob.size > 0 }, { label: '媒体读取', value: valid ? '可读取视频元数据' : '视频尺寸或时长异常', ok: valid }, { label: '实际分辨率', value: `${info.width} × ${info.height}`, ok: info.width > 0 && info.height > 0 }, { label: '实际时长', value: `${(info.duration || 0).toFixed(2)} 秒`, ok: (info.duration || 0) > 0 }, { label: '生成参数', value: asset.generation ? `${asset.generation.model} · ${asset.generation.duration ? `${asset.generation.duration} 秒` : '未记录请求时长'}` : '上传素材或未记录生成参数' }] }
        } catch (error) { verification.value = { title: '视频结果核验', rows: [{ label: '媒体读取', value: error instanceof Error ? error.message : '文件无法解码', ok: false }] } }
      }
    })
  }
  async function saveSubject() {
    const draft = subjectDraft.value
    if (!draft || !draft.name.trim() || project.current?.id !== draft.projectId) return
    await run(async () => {
      let assetId = draft.assetId
      if (draft.video) {
        const thumb = await (await fetch(draft.preview)).blob()
        const image = await assets.add(thumb, 'image', 'extracted', { filename: `${draft.name.trim()}-封面.${thumb.type.includes('png') ? 'png' : 'jpg'}`, projectId: draft.projectId }); assetId = image.id
      }
      if (project.current?.id !== draft.projectId) return
      const subject: Subject = { id: `sub_${crypto.randomUUID()}`, name: draft.name.trim(), kind: draft.kind, description: draft.description.trim(), designSheetAssetId: assetId, referenceAssetIds: [assetId], fromReference: true }
      options.editing.history.begin(); project.setSubjects([...(project.current.subjects || []), subject]); project.setCanvas(rebuildCanvasGraph(project.current, true)); options.editing.history.end()
      subjectDraft.value = undefined; await options.editing.choose([`subject:${subject.id}`]); void flow.fitView({ nodes: [`subject:${subject.id}`], padding: .5, duration: 250 }); toast.success('已创建角色主体')
    })
  }
  watch(() => project.current?.id, () => { subjectDraft.value = undefined; verification.value = undefined; options.close() })
  return { node, group, media, rating, taskId, items, busy, subjectDraft, verification, rate, action, saveSubject }
}
