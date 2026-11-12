<script setup lang="ts">
import VideoReferenceEditor from './VideoReferenceEditor.vue'
defineProps<{ nodeId: string }>()
</script>
<template><VideoReferenceEditor :node-id="nodeId" audio-only references-only /></template>
