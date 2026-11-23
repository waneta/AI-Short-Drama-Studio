<script setup lang="ts">
import { ASPECT_PRESETS } from '@/utils/aspect'
import type { AspectRatio } from '@/types'
defineProps<{ modelValue: AspectRatio; disabled?: boolean; fixed?: boolean; ratios?: AspectRatio[]; allowAuto?: boolean; autoSelected?: boolean }>()
defineEmits<{ 'update:modelValue': [value: AspectRatio]; selectAuto: [] }>()
const box = (value: string) => {
  const [w, h] = value.split(':').map(Number)
  return { width: `${22 * w / Math.max(w, h)}px`, height: `${22 * h / Math.max(w, h)}px` }
}
</script>
<template>
  <div class="settings-section">
    <div class="settings-label">比例 <span v-if="fixed">设计板固定横版</span></div>
    <div class="aspect-options">
      <button v-if="allowAuto" class="settings-option aspect-option" type="button" :class="{ on: autoSelected }"
        aria-label="比例 自适应" :aria-pressed="!!autoSelected" :disabled="disabled || fixed" @click="$emit('selectAuto')">
        <span class="aspect-icon-wrap"><i style="width:18px;height:14px;border-style:dashed" /></span><span>自适应</span>
      </button>
      <button v-for="item in (ratios ? ratios.map(value => ({ value })) : ASPECT_PRESETS)" :key="item.value" class="settings-option aspect-option" type="button"
        :class="{ on: !autoSelected && modelValue === item.value }" :aria-label="`比例 ${item.value}`" :aria-pressed="!autoSelected && modelValue === item.value"
        :disabled="disabled || fixed" @click="$emit('update:modelValue', item.value)">
        <span class="aspect-icon-wrap"><i :style="box(item.value)" /></span><span>{{ item.value }}</span>
      </button>
    </div>
  </div>
</template>
<style scoped>
.aspect-options { display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); gap:7px; }
.aspect-option { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:7px; height:62px; font-size:11px; }
.aspect-icon-wrap { display:flex; align-items:center; justify-content:center; height:24px; }
.aspect-icon-wrap i { display:block; box-sizing:border-box; border:1.3px solid currentColor; border-radius:2px; }
</style>
