<script setup lang="ts">
withDefaults(defineProps<{ size?: number; active?: boolean; busy?: boolean; paused?: boolean; variant?: 'default' | 'launcher' }>(), { size: 30, variant: 'default' })
</script>

<template>
  <span class="agent-orb" :class="[variant, { active, busy, paused }]" :style="{ width: `${size}px`, height: `${size}px` }" aria-hidden="true">
    <span class="orb-fluid" /><span class="orb-depth" />
    <template v-if="variant === 'launcher'"><span class="orb-aurora" /><span class="orb-caustic" /></template>
    <span class="orb-shine" />
  </span>
</template>

<style scoped>
.agent-orb { position:relative; display:inline-block; flex-shrink:0; overflow:hidden; border-radius:50%; isolation:isolate; background:radial-gradient(circle at 68% 72%,#0a6dc8 0%,#00b7df 38%,#61fff0 72%,#d6fff9 100%); box-shadow:inset 0 0 2px 1px #c8ffff9e,inset -3px -4px 8px #065baf65,0 0 14px #20d7df20; transform:translateZ(0); }
.orb-fluid { position:absolute; inset:-40%; border-radius:42%; background:conic-gradient(from 10deg,transparent 0deg,#00e5da 55deg,#17b9e4 105deg,#006bc773 145deg,#93ffe7 205deg,#05d7cf 260deg,transparent 335deg); filter:blur(3px); animation:orb-current 8s linear infinite; mix-blend-mode:screen; }
.orb-depth { position:absolute; inset:18%; border-radius:42% 58% 59% 41%; background:radial-gradient(ellipse at 65% 35%,#52ffff70,transparent 62%),radial-gradient(ellipse at 30% 65%,#0372bd80,transparent 67%); filter:blur(2px); animation:orb-drift 5s ease-in-out infinite alternate; }
.orb-shine { position:absolute; inset:0; border-radius:inherit; background:radial-gradient(ellipse at 30% 20%,#ffffffb0 0%,#cfffff35 15%,transparent 37%),radial-gradient(ellipse at 75% 82%,#a3fff75c,transparent 40%); box-shadow:inset 0 -1px 2px #002c8a45; }
.active { box-shadow:inset 0 0 2px 1px #e1ffffa1,0 0 17px #20d7df40; }
.busy .orb-fluid { animation-duration:2.8s; }
.busy .orb-depth { animation-duration:1.6s; }
/* The launcher gets a richer moving core; conversation avatars keep their quiet appearance. */
.launcher { background:radial-gradient(circle at 30% 20%,#c9fff7 0%,#5cf9ee 22%,#13cbdc 53%,#087fba 82%,#204f9f 100%); box-shadow:inset 0 0 2px 1px #e0fffdc2,inset -3px -4px 7px #075d9b70,0 0 12px #35e5db45; }
.launcher .orb-fluid { inset:-32%; background:conic-gradient(from 30deg,#83ffea0a,#b8fff7b8 55deg,#21d7ef2b 110deg,#0072b5b3 165deg,#798cff80 210deg,#1ee3d94d 265deg,#b2fff1ab 315deg,#83ffea0a); animation-duration:6.5s; }
.launcher .orb-depth { inset:8%; background:radial-gradient(ellipse at 30% 60%,#005bbab3,transparent 58%),radial-gradient(ellipse at 70% 30%,#acfffaba,transparent 62%); animation-duration:4.8s; }
.orb-aurora { position:absolute; inset:-15%; border-radius:40% 60% 64% 36%; background:radial-gradient(ellipse at 35% 40%,#d8fffbbf 0%,#6dffdc88 16%,transparent 46%),radial-gradient(ellipse at 68% 68%,#44baff8c,transparent 48%); filter:blur(2px); mix-blend-mode:screen; animation:orb-aurora-flow 7s ease-in-out infinite; }
.orb-caustic { position:absolute; inset:12%; border:1px solid #b8fff78a; border-top-color:transparent; border-left-color:transparent; border-radius:36% 64% 46% 54%; opacity:.6; filter:blur(.5px); animation:orb-caustic-flow 8s linear infinite; }
.launcher.busy .orb-fluid { animation-duration:2.6s; }
.launcher.busy .orb-depth { animation-duration:1.8s; }
.launcher.busy .orb-aurora { animation-duration:3s; }
.launcher.busy .orb-caustic { animation-duration:3.6s; }
@keyframes orb-aurora-flow {
  0%,100% { transform:translate(-8%,5%) rotate(0deg) scale(.9); opacity:.65; }
  40% { transform:translate(9%,-7%) rotate(125deg) scale(1.08); opacity:.95; }
  72% { transform:translate(-4%,-2%) rotate(245deg) scale(.96); opacity:.75; }
}
@keyframes orb-caustic-flow { from { transform:rotate(0deg) scale(.8); } 50% { transform:rotate(180deg) scale(1.08); } to { transform:rotate(360deg) scale(.8); } }
.paused span { animation-play-state:paused; }
@keyframes orb-current { to { transform:rotate(360deg); } }
@keyframes orb-drift { from { transform:translate(-12%,12%) rotate(-25deg) scale(.9); } to { transform:translate(14%,-8%) rotate(65deg) scale(1.2); } }
@media (prefers-reduced-motion:reduce) { .agent-orb span { animation:none; } }
</style>
