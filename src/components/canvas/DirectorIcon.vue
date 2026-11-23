<script setup lang="ts">
withDefaults(defineProps<{ name: string; size?: number }>(), { size: 17 })
const paths: Record<string, string> = {
  canvas: 'M7 4h10v5H7z M4 15h6v5H4z M15 15h5v5h-5z M12 9v3M7 12h11M7 12v3M18 12v3',
  script: 'M5 3h10l4 4v14H5z M14 3v5h5M8 12h8M8 16h6',
  adapt: 'm14 4 6 6M4 20l2-6L17 3l4 4L10 18z M3 5h5M5 3v5',
  polish: 'm5 18 10-10 3 3L8 21z M14 3v3M19 5h3M20 16v4M18 18h4M4 8v4M2 10h4',
  add: 'M12 5v14M5 12h14',
  export: 'M12 15V3m-4 4 4-4 4 4M5 13v7h14v-7',
  expand: 'M8 3H3v5M16 3h5v5M21 16v5h-5M3 16v5h5',
  restore: 'M8 8V3h13v13h-5M3 8h13v13H3z',
  dock: 'M3 4h18v16H3z M15 4v16',
  undock: 'M8 4h13v13h-4M3 9h13v12H3z M11 4h10v10',
  chevron: 'm8 10 4 4 4-4',
  arrow: 'M5 12h14m-5-5 5 5-5 5',
  reference: 'M9 7H6v10h3M15 7h3v10h-3M10 12h4',
  close: 'm6 6 12 12M18 6 6 18'
}
</script>
<template><svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="paths[name] || paths.script" /></svg></template>
