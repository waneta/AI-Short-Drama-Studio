<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { getBezierPath, useVueFlow, type EdgeProps } from '@vue-flow/core'
import { useProjectStore } from '@/stores'

const props = defineProps<EdgeProps>()
const project = useProjectStore()
const { viewport, getSelectedNodes } = useVueFlow()
const reducedMotion = ref(false)
const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)')
function syncMotionPreference() { reducedMotion.value = motionPreference.matches }
syncMotionPreference()
onMounted(() => motionPreference.addEventListener('change', syncMotionPreference))
const curve = computed(() => getBezierPath({ sourceX: props.sourceX, sourceY: props.sourceY, sourcePosition: props.sourcePosition, targetX: props.targetX, targetY: props.targetY, targetPosition: props.targetPosition, curvature: .32 }))
const hovering = ref(false)
const showDelete = ref(false)
const buttonPoint = ref({ x: 0, y: 0 })
const incidentNodeSelected = computed(() => getSelectedNodes.value.some(node => node.id === props.source || node.id === props.target))
const active = computed(() => hovering.value || props.selected || incidentNodeSelected.value)
const zoom = computed(() => Math.max(.1, viewport.value.zoom))
// Repeat a fixed screen-space pattern along the curve, independent of its length.
// Offset every layer by the same distance per second; inverse zoom keeps the
// white crests, cyan gaps and line widths stable while the canvas is scaled.
const FLOW_SPEED = 240
const FLOW_SPACING = 200
const flowCycle = FLOW_SPACING / FLOW_SPEED
const flowLayers = [
  { length: 64, width: 2.8, opacity: .08 },
  { length: 54, width: 2.6, opacity: .12 },
  { length: 44, width: 2.4, opacity: .18 },
  { length: 34, width: 2.2, opacity: .3 },
  { length: 24, width: 1.9, opacity: .5 },
  { length: 16, width: 1.6, opacity: .96 }
]
const buttonSize = computed(() => 30 / viewport.value.zoom)
let timer: ReturnType<typeof setTimeout> | undefined
function locate(event: MouseEvent) {
  if (showDelete.value) return
  const matrix = (event.currentTarget as SVGGElement).getScreenCTM()
  if (!matrix) return
  const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
  buttonPoint.value = { x: p.x, y: p.y }
}
function enter(event: MouseEvent) {
  hovering.value = true
  locate(event)
  clearTimeout(timer)
  timer = setTimeout(() => { if (hovering.value) showDelete.value = true }, 1000)
}
function leave() {
  hovering.value = false
  showDelete.value = false
  clearTimeout(timer)
}
function remove() { project.removeCanvasEdges([props.id]) }
onBeforeUnmount(() => {
  clearTimeout(timer)
  motionPreference.removeEventListener('change', syncMotionPreference)
})
</script>

<template>
  <g class="connection-edge" :class="{ 'is-active': active }" @mouseenter="enter" @mousemove="locate" @mouseleave="leave">
    <path :id="id" class="vue-flow__edge-path connection-stroke" :d="curve[0]" fill="none" vector-effect="non-scaling-stroke" />
    <g v-if="active" class="connection-flow" aria-hidden="true">
      <path class="water-halo" :d="curve[0]" fill="none" vector-effect="non-scaling-stroke" />
      <path class="water-channel" :d="curve[0]" fill="none" vector-effect="non-scaling-stroke" />
      <g v-if="!reducedMotion" class="water-reflections">
        <path v-for="layer in flowLayers" :key="layer.length" class="water-crest"
          :d="curve[0]" fill="none" stroke="#ffffff" stroke-linecap="round"
          :stroke-width="layer.width / zoom" :opacity="layer.opacity"
          :stroke-dasharray="`${layer.length / zoom} ${(FLOW_SPACING - layer.length) / zoom}`"
          :stroke-dashoffset="layer.length / (2 * zoom)">
          <animate attributeName="stroke-dashoffset"
            :from="layer.length / (2 * zoom)" :to="(layer.length / 2 - FLOW_SPACING) / zoom"
            :dur="`${flowCycle}s`" calcMode="linear" repeatCount="indefinite" />
        </path>
      </g>
    </g>
    <path class="connection-hit" :d="curve[0]" fill="none" vector-effect="non-scaling-stroke" />
    <foreignObject v-if="showDelete" :x="buttonPoint.x - buttonSize / 2" :y="buttonPoint.y - buttonSize / 2" :width="buttonSize" :height="buttonSize" class="connection-delete-wrap">
      <div :style="{ width:'30px', height:'30px', transform:`scale(${1 / viewport.zoom})`, transformOrigin:'top left' }">
        <button type="button" class="connection-delete nodrag nopan nokey" aria-label="删除连线" title="删除连线" @pointerdown.stop @mousedown.stop @click.stop.prevent="remove" @dblclick.stop @keydown.stop>
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="m8.2 8.2 11.3 11.3M8.2 15.8 19.5 4.5M14 14l-3-3"/></svg>
        </button>
      </div>
    </foreignObject>
  </g>
</template>

<style scoped>
.connection-stroke { stroke:var(--color-text-3); stroke-width:1.1; opacity:.58; transition:stroke-width .16s ease, opacity .16s ease; pointer-events:none; }
.is-active .connection-stroke { stroke:#176687; stroke-width:1.4; opacity:.65; }
.connection-flow { pointer-events:none; }
.water-halo { stroke:#168fb9; stroke-width:5; opacity:.07; }
.water-channel { stroke:#168db6; stroke-width:1.6; opacity:.7; stroke-linecap:round; }
.connection-hit { stroke:transparent; stroke-width:18; cursor:pointer; pointer-events:stroke; }
.connection-delete-wrap { overflow:visible; pointer-events:all; }
.connection-delete { display:grid; place-items:center; width:30px; height:30px; padding:6px; border:1px solid var(--color-border); border-radius:50%; background:var(--color-text-1); color:var(--color-bg-1); box-shadow:0 2px 8px #0004; cursor:pointer; }
.connection-delete:hover { background:var(--color-accent); color:white; }
.connection-delete:focus-visible { outline:2px solid var(--color-accent); outline-offset:2px; }
.connection-delete svg { width:17px; height:17px; fill:none; stroke:currentColor; stroke-width:1.6; stroke-linecap:round; stroke-linejoin:round; }
@media (prefers-reduced-motion:reduce) { .water-reflections { display:none; } }
</style>
