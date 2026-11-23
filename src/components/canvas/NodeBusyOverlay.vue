<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps<{
  label?: string
  startedAt?: number
  cancelable?: boolean
  cancelling?: boolean
}>()

const emit = defineEmits<{ cancel: [] }>()

const now = ref(performance.now())
let timer: ReturnType<typeof setInterval> | undefined
function stopTimer() {
  if (timer !== undefined) clearInterval(timer)
  timer = undefined
}
watch(() => props.startedAt, (startedAt) => {
  stopTimer()
  now.value = performance.now()
  if (startedAt != null && Number.isFinite(startedAt)) {
    timer = setInterval(() => { now.value = performance.now() }, 1000)
  }
}, { immediate: true })
onBeforeUnmount(stopTimer)

const elapsed = computed(() => {
  if (props.startedAt == null || !Number.isFinite(props.startedAt)) return ''
  const seconds = Math.max(0, Math.floor((now.value - props.startedAt) / 1000))
  if (seconds < 60) return `${seconds}秒`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}分${seconds % 60}秒`
  return `${Math.floor(minutes / 60)}小时${minutes % 60}分${seconds % 60}秒`
})
</script>

<template>
  <div class="busy-ov nodrag nowheel">
    <i class="bar" />
    <i class="scan" />
    <i class="ring" />
    <span role="status" aria-live="polite">{{ cancelling ? '正在取消本次生成…' : label || '生成中' }}<span v-if="elapsed" class="elapsed"> · 已耗时 {{ elapsed }}</span></span>
    <button v-if="cancelable" type="button" class="cancel-job nodrag nowheel"
      :disabled="cancelling" @pointerdown.stop @mousedown.stop @dblclick.stop @click.stop="emit('cancel')">
      {{ cancelling ? '正在取消…' : '取消本次' }}
    </button>
  </div>
</template>

<style scoped>
.busy-ov {
  position: absolute;
  inset: 0;
  z-index: 6;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  overflow: hidden;
  border-radius: inherit;
  background: rgba(18, 18, 22, 0.88);
  pointer-events: none;
  color: var(--color-text-1);
  font-size: 12px;
  font-weight: 750;
  letter-spacing: 0.04em;
}
.busy-ov > span {
  position: relative;
  z-index: 1;
  max-width: 92%;
  padding: 0 8px;
  text-align: center;
  line-height: 1.35;
  word-break: break-word;
}
.cancel-job {
  position: relative;
  z-index: 1;
  pointer-events: auto;
  padding: 5px 12px;
  border: 1px solid rgba(255, 255, 255, 0.28);
  border-radius: 6px;
  color: inherit;
  background: rgba(255, 255, 255, 0.08);
  font: inherit;
  cursor: pointer;
}
.cancel-job:hover:not(:disabled) { background: rgba(255, 255, 255, 0.16); }
.cancel-job:focus-visible { outline: 2px solid #7eb4ff; outline-offset: 2px; }
.cancel-job:disabled { opacity: 0.6; cursor: wait; }
.bar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: rgba(255, 255, 255, 0.12);
}
.bar::after {
  content: '';
  position: absolute;
  top: 0;
  left: -40%;
  width: 40%;
  height: 100%;
  background: linear-gradient(90deg, transparent, #7eb4ff, transparent);
  animation: bar 1.05s ease-in-out infinite;
}
.scan {
  position: absolute;
  left: 0;
  right: 0;
  height: 38%;
  background: linear-gradient(180deg, transparent, rgba(126, 180, 255, 0.12), transparent);
  animation: scan 1.7s ease-in-out infinite;
}
.ring {
  position: relative;
  width: 34px;
  height: 34px;
  border: 3px solid rgba(255, 255, 255, 0.16);
  border-top-color: #7eb4ff;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
@keyframes bar {
  to {
    left: 100%;
  }
}
@keyframes scan {
  0% {
    top: -40%;
  }
  100% {
    top: 100%;
  }
}
</style>
