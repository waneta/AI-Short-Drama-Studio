import { useProjectStore, useSettingsStore } from '@/stores'
import type {
  AgentAutonomy,
  AgentChatMessage,
  AgentConversation,
  AgentTaskRecord,
  AgentWorkspaceState
} from '@/types'

const MAX_TASKS = 40

function id(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function defaults(): AgentWorkspaceState {
  return { autonomy: 'gated', messages: [], tasks: [], callBudget: 24 }
}

export function getAgentState(): AgentWorkspaceState {
  return useProjectStore().current?.agentState ?? defaults()
}

export function agentConversations(state = getAgentState()): AgentConversation[] {
  const activeId = state.activeConversationId || 'legacy'
  const active = state.conversations?.find(c => c.id === activeId)
  const title = state.messages.find(m => m.role === 'user')?.content.replace(/\s+/g, ' ').slice(0, 28) || '新对话'
  const current: AgentConversation = { id: activeId, title: active?.customTitle || title, ...(active?.customTitle ? { customTitle: active.customTitle } : {}), messages: state.messages, createdAt: active?.createdAt || state.messages[0]?.createdAt || Date.now(), updatedAt: state.messages.at(-1)?.createdAt || active?.updatedAt || Date.now() }
  return [current, ...(state.conversations || []).filter(c => c.id !== activeId)].sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function startAgentConversation(): Promise<void> {
  const state = getAgentState(), now = Date.now(), activeId = id('conversation')
  const next: AgentConversation = { id: activeId, title: '新对话', messages: [], createdAt: now, updatedAt: now }
  await commit({ ...state, activeConversationId: activeId, messages: [], conversations: [next, ...agentConversations(state)] })
}

export async function switchAgentConversation(conversationId: string): Promise<void> {
  const state = getAgentState(), conversations = agentConversations(state)
  const target = conversations.find(c => c.id === conversationId)
  if (target) await commit({ ...state, activeConversationId: target.id, messages: [...target.messages], conversations })
}

export async function renameAgentConversation(conversationId: string, name: string): Promise<void> {
  const title = name.replace(/\s+/g, ' ').trim().slice(0, 60)
  if (!title) throw new Error('请输入对话名称')
  const state = getAgentState(), conversations = agentConversations(state)
  if (!conversations.some(c => c.id === conversationId)) throw new Error('找不到当前项目的对话')
  await commit({ ...state, conversations: conversations.map(c => c.id === conversationId ? { ...c, title, customTitle: title } : c) })
}

async function commit(state: AgentWorkspaceState) {
  const project = useProjectStore()
  if (!project.current) return
  project.setAgentState(state)
  await project.save()
}

export async function setAgentAutonomy(autonomy: AgentAutonomy) {
  await commit({ ...getAgentState(), autonomy })
}

export async function appendAgentMessage(
  role: AgentChatMessage['role'],
  content: string
): Promise<AgentChatMessage> {
  const message: AgentChatMessage = {
    id: id('msg'),
    role,
    engine: useSettingsStore().config.assistantEngine || 'api',
    model: useSettingsStore().config.assistantEngine === 'codex' ? useSettingsStore().config.codexModel || 'codex-default' : useSettingsStore().config.llm.model,
    content,
    createdAt: Date.now()
  }
  const state = getAgentState()
  await commit({ ...state, messages: [...state.messages, message] })
  return message
}

export async function replaceAgentMessages(messages: AgentChatMessage[]) {
  await commit({ ...getAgentState(), messages: [...messages] })
}

export async function beginAgentTask(
  request: string,
  estimate?: { calls: number; seconds: number }
): Promise<AgentTaskRecord> {
  const task: AgentTaskRecord = {
    id: id('task'),
    request,
    engine: useSettingsStore().config.assistantEngine || 'api',
    model: useSettingsStore().config.assistantEngine === 'codex' ? useSettingsStore().config.codexModel || 'codex-default' : useSettingsStore().config.llm.model,
    status: 'planned',
    completedTools: [],
    estimatedCalls: estimate?.calls,
    estimatedSeconds: estimate?.seconds,
    startedAt: Date.now()
  }
  const state = getAgentState()
  await commit({ ...state, tasks: [...state.tasks, task].slice(-MAX_TASKS) })
  return task
}

export async function patchAgentTask(id: string, patch: Partial<AgentTaskRecord>) {
  const state = getAgentState()
  const tasks = state.tasks.map((task) => (task.id === id ? { ...task, ...patch } : task))
  await commit({ ...state, tasks })
}

export function latestAgentTask(): AgentTaskRecord | undefined {
  return getAgentState().tasks.at(-1)
}

