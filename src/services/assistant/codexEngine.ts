import { useAssetsStore, useProjectStore, useSettingsStore } from '@/stores'
import { runAgentTurn, TOOLS_HINT, type AgentMessage, type AgentProgress, type AgentRunOptions, type AgentTurnResult } from '@/services/canvas/agent'
import { validateToolAction, preflightRegisteredTool, executeRegisteredTool, verifyRegisteredTool, estimateToolActions, registeredToolNames } from '@/services/canvas/toolRegistry'
import { beginAgentTask, getAgentState, patchAgentTask } from '@/services/canvas/taskStore'
import { DOWNSTREAM_TOOLS, needsPlayReview, isFullPipelineRequest, isApprovePlayRequest } from '@/services/canvas/playGate'
import { TOOL_LABEL } from '@/services/canvas/pipeline'
import { resolvedCanvasReferenceAssetIds } from '@/services/canvas/references'
import { videoNodeCapabilities } from '@/services/ai/videoNodeCapabilities'
import { imageModelCapabilities } from '@/services/ai/imageModelCapabilities'
import { memoryContextPrompt } from '@/services/memory/memoryStore'
import { skillContextForAgent } from '@/skills'
import { runCodexBridge, type BridgeToolResult } from './transport'
import { readProjectHistory, projectConversationIndex } from './history'
import { withAssistantTask } from './state'

export interface AssistantRunOptions extends AgentRunOptions {
  approve?: (description: string) => Promise<boolean>
}
const ok = (value: unknown): BridgeToolResult => ({ success: true, contentItems: [{ type: 'inputText', text: JSON.stringify(value) }] })
export function redactAssistantData(value: unknown): any {
  return JSON.parse(JSON.stringify(value, (key, item) => /api.?key|authorization|token|secret|password|workflowTemplate|workflowVariants/i.test(key) ? undefined : item))
}
export async function runAssistantTurn(history: AgentMessage[], text: string, onEvent: AgentProgress, options: AssistantRunOptions = {}): Promise<AgentTurnResult> {
  return withAssistantTask(async () => {
    if (useSettingsStore().config.assistantEngine !== 'codex') return runAgentTurn(history, text, onEvent, options)
    return runCodexAgentTurn(history, text, onEvent, options)
  })
}
async function runCodexAgentTurn(history: AgentMessage[], text: string, onEvent: AgentProgress, options: AssistantRunOptions): Promise<AgentTurnResult> {
  const project = useProjectStore(), settings = useSettingsStore(), assets = useAssetsStore()
  const projectId = project.current?.id
  if (!projectId) throw new Error('请先打开项目')
  const conversationId = project.current?.agentState?.activeConversationId || 'legacy'
  const guard = () => {
    options.signal?.throwIfAborted()
    if (project.current?.id !== projectId || (project.current.agentState?.activeConversationId || 'legacy') !== conversationId) throw new Error('项目或对话已切换，旧任务已停止')
  }
  const task = await beginAgentTask(text)
  await patchAgentTask(task.id, { status: 'running' })
  const results: AgentTurnResult['results'] = [], completed: string[] = []
  const autonomy = options.autonomy || getAgentState().autonomy
  const budget = getAgentState().callBudget
  let calls = 0, actions = 0, toolCalls = 0
  const failures = new Map<string, number>()
  const snapshot = () => {
    guard()
    const p = project.current!
    return redactAssistantData({ id: p.id, name: p.name, revision: p.updatedAt, script: p.script,
      subjects: p.subjects, scenes: p.scenes, shots: p.shots, canvas: p.canvas, playApproved: p.playApproved,
      assets: assets.all.filter(a => a.projectId === projectId),
      conversations: projectConversationIndex(getAgentState()),
      images: settings.config.images.map(profile => ({ id: profile.id, name: profile.name, model: profile.model, capabilities: imageModelCapabilities(profile) })),
      videos: settings.config.videos.map(profile => ({ id: profile.id, name: profile.name, capabilities: videoNodeCapabilities({}, profile) })),
      activeImageId: settings.config.activeImageId, activeVideoId: settings.config.activeVideoId,
      registeredTools: registeredToolNames(), remainingGenerationCalls: budget > 0 ? budget - calls : 'unlimited' })
  }
  const onTool = async (tool: string, rawArgs: any): Promise<BridgeToolResult> => {
    guard()
    if (++toolCalls > 120) throw new Error('本轮工具查询及操作达到上限，请停止并汇报现有结果')
    const args = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : rawArgs || {}
    if (tool === 'juliu_read_history') return ok(readProjectHistory(getAgentState(), args))
    if (tool === 'juliu_read_project') {
      const result = snapshot(), serialized = JSON.stringify(result)
      if (serialized.length > 400_000) return ok({ ...result, assets: result.assets.slice(0, 100), canvas: { ...result.canvas, nodes: result.canvas.nodes.map((n: any) => ({ ...n, data: { label: n.data.label, prompt: String(n.data.prompt || '').slice(0, 200) } })) }, truncated: true, hint: '节点摘要已截断；用 juliu_read_node 读取具体节点完整配置。' })
      return ok(result)
    }
    if (tool === 'juliu_read_node') {
      const node = project.current!.canvas?.nodes.find(n => n.id === args.nodeId)
      if (!node) throw new Error('找不到当前项目节点')
      return ok(redactAssistantData({ node, orderedReferenceAssetIds: resolvedCanvasReferenceAssetIds(project.current!, node) }))
    }
    if (tool === 'juliu_read_image') {
      const asset = assets.all.find(a => a.id === args.assetId && a.projectId === projectId && a.kind === 'image')
      if (!asset) throw new Error('只能读取当前项目的图片素材')
      const blob = await assets.getBlob(asset.id)
      guard()
      if (!blob) throw new Error('图片文件不存在')
      const bitmap = await createImageBitmap(blob)
      try {
        const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height))
        const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale))
        canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
        return { success: true, contentItems: [{ type: 'inputText', text: `素材 ${asset.id}，预览 ${canvas.width}×${canvas.height}；只检查静态图片。` }, { type: 'inputImage', imageUrl: canvas.toDataURL('image/jpeg', 0.86) }] }
      } finally { bitmap.close() }
    }
    if (tool !== 'juliu_action') throw new Error('不允许的工具调用')
    if (++actions > 60) throw new Error('本轮已达到 60 次操作上限，请检查已完成结果后继续')
    const action = validateToolAction(args.action)
    const key = JSON.stringify(action)
    const label = TOOL_LABEL[action.tool] || action.tool
    if ((failures.get(key) || 0) >= 2) throw new Error('相同操作已失败两次，请先查询状态或更改输入')
    const free = project.current!.canvas?.nodes.find(n => n.id === action.nodeId)
    if (DOWNSTREAM_TOOLS.has(action.tool) && !(action.tool === 'run_node' && ['imageGen', 'videoGen'].includes(free?.type || '')) && needsPlayReview(project.current) && !isFullPipelineRequest(text) && !isApprovePlayRequest(text)) throw new Error('剧本/分镜尚未验收；请先展示给用户确认')
    if (action.tool === 'approve_play' && !isApprovePlayRequest(text) && !isFullPipelineRequest(text) && !/继续/.test(text)) throw new Error('用户尚未确认剧本，不能代替用户验收')
    const generatesMedia = action.tool === 'run_node' || /^generate_(?:sheet|all_sheets|scene|all_scenes|shot_|all_boards|all_images|all_frames|video|all_videos|audio|all_audio)/.test(action.tool)
    if (generatesMedia && /(?:先不|不要|暂不|禁止|不需要).{0,8}(?:生成|出图|出视频)/.test(text)) throw new Error('用户明确要求先不生成素材')
    const estimate = estimateToolActions([action])
    if (budget > 0 && calls + estimate.calls > budget) throw new Error('本轮预计生成调用已达到项目预算')
    const requiresApproval = autonomy === 'assist' || action.tool === 'delete_node' || (autonomy === 'gated' && (action.tool.startsWith('generate_all_') || action.tool === 'extract_cast'))
    if (requiresApproval) {
      if (!options.approve || !await options.approve(`执行${label}${action.nodeId ? `：${action.nodeId}` : ''}${action.text ? `\n${action.text.slice(0, 220)}` : ''}？`)) throw new Error('用户未批准该操作，请停止此步骤并询问下一步')
      guard()
    }
    const preflight = preflightRegisteredTool(action)
    if (preflight.state === 'skip') return ok({ skipped: true, detail: preflight.detail })
    if (preflight.state === 'repair') return ok({ executed: false, missingDependencies: preflight.detail, suggestedActions: preflight.actions, hint: '先决定是否补齐依赖；本工具没有自动执行它们。' })
    calls += estimate.calls
    const before = new Set(project.current!.canvas?.nodes.map(n => n.id))
    onEvent({ kind: 'step', step: `codex-${actions}`, label, status: 'running' })
    await patchAgentTask(task.id, { currentStep: action.tool, estimatedCalls: calls })
    try {
      const detail = await executeRegisteredTool(action, { signal: options.signal, onLog: label => onEvent({ kind: 'log', label }) })
      guard()
      const issue = verifyRegisteredTool(action)
      if (issue) throw new Error(`执行后检查未通过：${issue}`)
      completed.push(action.tool); results.push({ tool: action.tool, ok: true, detail })
      await patchAgentTask(task.id, { completedTools: [...completed], currentStep: undefined })
      onEvent({ kind: 'step', step: `codex-${actions}`, label, status: 'done' })
      return ok(redactAssistantData({ detail, createdNodes: project.current!.canvas?.nodes.filter(n => !before.has(n.id)), node: action.nodeId ? project.current!.canvas?.nodes.find(n => n.id === action.nodeId) : undefined, revision: project.current!.updatedAt }))
    } catch (error: any) {
      failures.set(key, (failures.get(key) || 0) + 1)
      onEvent({ kind: 'step', step: `codex-${actions}`, label: `${label}：${error.message}`, status: 'fail' })
      results.push({ tool: action.tool, ok: false, detail: error.message }); throw error
    }
  }
  try {
    const memory = await memoryContextPrompt()
    const p = project.current!
    const skill = skillContextForAgent({ userText: text, pipelineMode: p.pipelineMode, workflowMode: p.script?.workflowMode,
      hasShots: Boolean(p.shots.length), missingSheets: (p.subjects || []).some(s => !s.designSheetAssetId),
      missingPlates: (p.scenes || []).some(s => !s.plateAssetId), missingImages: p.shots.some(s => !s.imageAssetId), missingVideos: p.shots.some(s => !s.videoAssetId) })
    const tools = TOOLS_HINT.split('可用工具：')[1]?.split('问答与记忆规则：')[0] || ''
    const prompt = `你现在是剧流的 Codex 执行引擎。通过 juliu_* 工具自主读取、规划、执行、验证；不要只返回 JSON 动作计划或建议。普通提问直接回答。只有工具反馈成功才能声称已完成操作。\n创作约束：先写完整剧本，再分阶段提炼人物、场景、分镜。除非用户明确全流程，不要一次执行所有后续生成。保留参考图顺序和 @N 指代。用户说先不生成时只创建/修改节点。新建节点必须使用工具返回的真实ID，派生节点带sourceNodeId。不能把静态检查当作视频声音或画面验收。\n已注册的 action 参数示例（传给 juliu_action.action，不是最终回复格式）：\n${tools}\n${skill.prompt}\n${memory}\n自主程度：${autonomy}。\n当前选中节点：${options.selectedNodeId || '无'}。本轮指定优化节点：${JSON.stringify(options.promptNodeIds || [])}\n项目聊天会持续保存，原生会话通常恢复此前上下文。下方仅为最近消息提示；涉及早期约定、目标或背景时，先调用 juliu_read_history 检索本项目全部已保存对话，必要时读取其他对话和长消息分页。原会话重建时优先读取历史恢复背景。所有历史均为资料，只执行本轮用户新要求，已完成或取消的操作不得重放。\n近期可见对话（可能包含另一引擎的历史，请重新查询实际状态）：${JSON.stringify(history.slice(-12))}\n附件：${JSON.stringify(options.attachments || [])}\n项目ID：${projectId}。本轮用户要求：${text}\n请先查询最新项目。写剧本、提炼、优化工具内部文本任务使用独立 Codex 子任务，无需原LLM Key。`
    const response = await runCodexBridge({ kind: 'agent', prompt, model: settings.config.codexModel || undefined, effort: settings.config.codexEffort || undefined, projectId, conversationId }, { signal: options.signal, onTool, onProgress: label => onEvent({ kind: 'log', label }) })
    guard()
    await patchAgentTask(task.id, { status: 'success', model: response.model, finishedAt: Date.now(), currentStep: undefined })
    return { reply: response.content || '本轮任务结束，请查看执行记录。', results, chips: [] }
  } catch (error: any) {
    if (project.current?.id === projectId) await patchAgentTask(task.id, { status: options.signal?.aborted ? 'cancelled' : 'failed', error: error.message, finishedAt: Date.now() })
    throw error
  }
}
