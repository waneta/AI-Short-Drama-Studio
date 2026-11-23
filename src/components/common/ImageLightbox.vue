<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { useLightbox } from '@/composables/useLightbox'

const { src, kind, caption, close } = useLightbox()
const video = ref<HTMLVideoElement>()
const loading = ref(false)
const playBlocked = ref(false)
const playbackError = ref('')
const playbackTimedOut = ref(false)
const diagnosticNotice = ref('')
let playbackTimer: number | undefined

function clearPlaybackTimer() {
  if (playbackTimer !== undefined) window.clearTimeout(playbackTimer)
  playbackTimer = undefined
}

function watchPlaybackStart(player: HTMLVideoElement, url: string) {
  clearPlaybackTimer()
  const timer = window.setTimeout(() => {
    if (playbackTimer !== timer) return
    playbackTimer = undefined
    if (video.value !== player || src.value !== url || player.currentTime > 0 || player.ended) return
    loading.value = false
    playbackTimedOut.value = true
    playbackError.value = '视频加载或解码超时，尚未开始播放。可以重试，或复制诊断信息继续排查。'
  }, 8000)
  playbackTimer = timer
}

async function copyPlaybackDiagnostic() {
  const player = video.value
  if (!player) return
  const finite = (value: number) => Number.isFinite(value) ? value : null
  const buffered = Array.from({ length: player.buffered.length }, (_, i) => [player.buffered.start(i), player.buffered.end(i)])
  const diagnostic = {
    caption: caption.value,
    browser: navigator.userAgent,
    hasSource: Boolean(player.currentSrc || src.value),
    sourceScheme: (player.currentSrc || src.value).split(':')[0],
    readyState: player.readyState,
    networkState: player.networkState,
    paused: player.paused,
    currentTime: finite(player.currentTime),
    duration: finite(player.duration),
    width: player.videoWidth,
    height: player.videoHeight,
    buffered,
    mediaErrorCode: player.error?.code ?? null,
    timedOut: playbackTimedOut.value,
    codecSupport: {
      h264HighAac: player.canPlayType('video/mp4; codecs="avc1.64001f, mp4a.40.2"'),
      h264BaselineAac: player.canPlayType('video/mp4; codecs="avc1.42E01E, mp4a.40.2"'),
      vp9Opus: player.canPlayType('video/webm; codecs="vp9, opus"')
    }
  }
  try {
    await navigator.clipboard.writeText(JSON.stringify(diagnostic, null, 2))
    diagnosticNotice.value = '诊断已复制，可以粘贴给我排查。'
  } catch {
    diagnosticNotice.value = `复制失败；就绪状态 ${player.readyState}，网络状态 ${player.networkState}，媒体错误 ${player.error?.code ?? '无'}。`
  }
}

function onVideoError() {
  clearPlaybackTimer()
  playbackTimedOut.value = false
  const code = video.value?.error?.code
  const messages: Record<number, string> = {
    1: '视频播放已中断，请点击重试。',
    2: '视频文件读取失败，请重试或下载原视频检查。',
    3: '浏览器无法解码这条视频，可能是编码不兼容或文件不完整。',
    4: '浏览器不支持此视频格式，或视频文件无法读取。'
  }
  playbackError.value = `${messages[code || 0] || '视频无法播放，请重试或下载原视频检查。'}${code ? `（错误代码 ${code}）` : ''}`
  loading.value = false
  playBlocked.value = false
}

async function playVideo() {
  const player = video.value
  const url = src.value
  if (!player || !src.value || kind.value !== 'video') return
  playBlocked.value = false
  watchPlaybackStart(player, url)
  try {
    await player.play()
  } catch (error) {
    // Closing or replacing the preview can reject its old play() promise.
    if (video.value !== player || src.value !== url || !src.value || (error as Error)?.name === 'AbortError') return
    clearPlaybackTimer()
    loading.value = false
    if ((error as Error)?.name === 'NotAllowedError') {
      playBlocked.value = true
    } else if (player.error) {
      onVideoError()
    } else {
      playbackError.value = '视频未能开始播放，请重试或下载原视频检查。'
    }
  }
}

function retryVideo() {
  const player = video.value
  if (!player) return
  playbackError.value = ''
  playbackTimedOut.value = false
  diagnosticNotice.value = ''
  playBlocked.value = false
  loading.value = true
  player.load()
  void playVideo()
}

function onVideoReady() {
  loading.value = false
}

function onVideoPlaying() {
  clearPlaybackTimer()
  loading.value = false
  if (playbackTimedOut.value) playbackError.value = ''
  playbackTimedOut.value = false
}

watch([src, kind], ([url, type], _previous, onCleanup) => {
  clearPlaybackTimer()
  playbackTimedOut.value = false
  diagnosticNotice.value = ''
  playbackError.value = ''
  playBlocked.value = false
  loading.value = Boolean(url && type === 'video')
  const player = video.value
  if (!url || type !== 'video' || !player) return
  onCleanup(() => { clearPlaybackTimer(); player.pause() })
  void playVideo()
}, { flush: 'post' })

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') close()
}

watch(src, (url) => {
  document.body.style.overflow = url ? 'hidden' : ''
})

onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => {
  clearPlaybackTimer()
  window.removeEventListener('keydown', onKey)
  document.body.style.overflow = ''
})
</script>

<template>
  <Teleport to="body">
    <div v-if="src" class="lb" role="dialog" aria-modal="true" :aria-label="caption || '媒体预览'" @click.self="close">
      <button class="lb-close" type="button" title="关闭" aria-label="关闭预览" @click="close">×</button>
      <img v-if="kind === 'image'" :src="src" :alt="caption" class="lb-media" @click.stop />
      <div v-else class="lb-video-stage" @click.stop>
        <video
          ref="video"
          :src="src"
          class="lb-media"
          controls
          autoplay
          playsinline
          preload="auto"
          @loadeddata="onVideoReady"
          @canplay="onVideoReady"
          @playing="onVideoPlaying"
          @error="onVideoError"
        />
        <div v-if="loading && !playBlocked && !playbackError" class="lb-loading" role="status">正在读取视频…</div>
        <div v-if="playBlocked || playbackError" class="lb-playback-message" role="status">
          <p>{{ playbackError || '浏览器暂停了自动播放，请点击播放。' }}</p>
          <div class="lb-playback-actions">
            <button v-if="playBlocked" type="button" @click="playVideo">播放视频</button>
            <button v-else type="button" @click="retryVideo">重试播放</button>
            <a :href="src" :download="caption || '视频'">下载原视频</a>
            <button type="button" @click="copyPlaybackDiagnostic">复制播放诊断</button>
          </div>
          <p v-if="diagnosticNotice" class="lb-diagnostic-notice">{{ diagnosticNotice }}</p>
        </div>
      </div>
      <p v-if="caption" class="lb-cap">{{ caption }}</p>
    </div>
  </Teleport>
</template>

<style scoped>
.lb {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(6, 6, 12, 0.88);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 24px 28px;
  cursor: zoom-out;
}
.lb-close {
  position: absolute;
  top: 12px;
  right: 16px;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
  font-size: 22px;
  line-height: 1;
  padding: 0;
}
.lb-close:hover {
  background: rgba(255, 255, 255, 0.22);
}
.lb-media {
  max-width: min(96vw, 1400px);
  max-height: calc(100vh - 88px);
  object-fit: contain;
  border-radius: 8px;
  cursor: default;
  box-shadow: 0 16px 60px rgba(0, 0, 0, 0.45);
}
.lb-video-stage { position:relative; display:flex; align-items:center; justify-content:center; min-width:min(400px,90vw); min-height:200px; max-width:100%; max-height:calc(100vh - 88px); border-radius:8px; background:#050508; cursor:default; }
.lb-loading { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; pointer-events:none; color:#d0d0da; font-size:13px; }
.lb-playback-message { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:24px; gap:16px; border-radius:8px; background:rgba(12,12,18,.94); color:#eeeef2; text-align:center; }
.lb-playback-message p { margin:0; max-width:480px; font-size:13px; line-height:1.7; }
.lb-playback-actions { display:flex; justify-content:center; flex-wrap:wrap; gap:10px; }
.lb-playback-actions button,.lb-playback-actions a { display:inline-flex; align-items:center; justify-content:center; padding:8px 14px; border:1px solid #ffffff30; border-radius:7px; background:#ffffff0c; color:#eeeef2; font:inherit; font-size:12px; text-decoration:none; cursor:pointer; }
.lb-playback-actions button:hover,.lb-playback-actions a:hover { background:#ffffff20; }
.lb-cap {
  margin: 12px 0 0;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.72);
}
</style>
