import { ref } from 'vue'

export type AssistantEngine = 'api' | 'codex'
/** All text/agent callers share this lock; switching is allowed only between tasks. */
export const assistantActiveTasks = ref(0)
export async function withAssistantTask<T>(run: () => Promise<T>): Promise<T> {
  assistantActiveTasks.value++
  try { return await run() } finally { assistantActiveTasks.value-- }
}
