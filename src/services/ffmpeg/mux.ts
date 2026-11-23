import { clearFS, getFFmpeg, readFile, toBlob, writeFile } from './client'
import { probeMedia } from './probe'

function extension(mime: string, fallback: string): string {
  if (mime.includes('webm')) return 'webm'
  if (mime.includes('wav')) return 'wav'
  if (mime.includes('mp4') || mime.includes('m4a')) return 'm4a'
  if (mime.includes('mpeg') || mime.includes('mp3')) return 'mp3'
  return fallback
}

/** 删除生成视频的临时声音，换成最终克隆语音，让剪辑台预览和导出听到同一音轨。 */
export async function replaceVideoAudio(
  video: Blob,
  audio: Blob,
  onProgress?: (message: string) => void
): Promise<Blob> {
  const ffmpeg = await getFFmpeg(onProgress)
  await clearFS(ffmpeg)
  const videoName = `talking.${extension(video.type, 'mp4')}`
  const audioName = `cloned.${extension(audio.type, 'mp3')}`
  const outputName = 'talking_cloned.mp4'
  await writeFile(ffmpeg, videoName, video)
  await writeFile(ffmpeg, audioName, audio)
  onProgress?.('正在把克隆语音写入人物视频…')
  const exitCode = await ffmpeg.exec([
    '-i', videoName,
    '-i', audioName,
    '-map', '0:v:0',
    '-map', '1:a:0',
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-b:a', '160k',
    '-ar', '44100',
    '-shortest',
    '-movflags', '+faststart',
    '-y', outputName
  ])
  if (exitCode !== 0) throw new Error(`替换数字人音轨失败（FFmpeg ${exitCode}）`)
  return toBlob((await readFile(ffmpeg, outputName)) as Uint8Array, 'video/mp4')
}

/** 按秒从整段口播里切出这一镜的音频，交给 H3 音画同步。 */
export async function sliceAudio(
  audio: Blob,
  start: number,
  duration: number,
  onProgress?: (message: string) => void
): Promise<Blob> {
  const ffmpeg = await getFFmpeg(onProgress)
  await clearFS(ffmpeg)
  const inputName = `src.${extension(audio.type, 'mp3')}`
  const outputName = 'slice.m4a'
  await writeFile(ffmpeg, inputName, audio)
  onProgress?.('正在按台词时长切开播音频…')
  const exitCode = await ffmpeg.exec([
    '-ss', String(Math.max(0, start)),
    '-t', String(Math.max(0.4, duration)),
    '-i', inputName,
    '-c:a', 'aac',
    '-b:a', '160k',
    '-ar', '44100',
    '-y',
    outputName
  ])
  if (exitCode !== 0) throw new Error(`切音频失败（FFmpeg ${exitCode}）`)
  return toBlob((await readFile(ffmpeg, outputName)) as Uint8Array, 'audio/mp4')
}

/**
 * 数字人音画同步只要 WAV/MP3，时长 5–15 秒。
 * 切片若是 AAC/m4a 或不足 5 秒，提交会被判「参数值非法」。
 */
export async function toDigitalHumanWav(
  audio: Blob,
  onProgress?: (message: string) => void
): Promise<{ blob: Blob; duration: number }> {
  if ((audio.type || '').includes('wav')) {
    const info = await probeMedia(audio).catch(() => ({ duration: 0 }))
    const duration = Number(info.duration) || 0
    if (duration >= 4.8 && duration <= 15.2) {
      return { blob: audio, duration: Math.max(5, Math.min(15, Math.round(duration))) }
    }
  }
  const ffmpeg = await getFFmpeg(onProgress)
  await clearFS(ffmpeg)
  const inputName = `src.${extension(audio.type, 'mp3')}`
  await writeFile(ffmpeg, inputName, audio)
  onProgress?.('正在把口播音频转成 WAV，并对齐到 5–15 秒…')
  const exitCode = await ffmpeg.exec([
    '-i', inputName,
    '-af', 'apad=whole_dur=5',
    '-t', '15',
    '-c:a', 'pcm_s16le',
    '-ar', '44100',
    '-ac', '1',
    '-y',
    'out.wav'
  ])
  if (exitCode !== 0) throw new Error(`口播音频转码失败（FFmpeg ${exitCode}）`)
  const blob = toBlob((await readFile(ffmpeg, 'out.wav')) as Uint8Array, 'audio/wav')
  const info = await probeMedia(blob).catch(() => ({ duration: 5 }))
  const duration = Math.max(5, Math.min(15, Math.round(info.duration || 5)))
  return { blob, duration }
}


let removeAudioQueue: Promise<unknown> = Promise.resolve()

/** Drop the generated source audio with video stream copy; never edit an existing asset. */
export function removeVideoAudio(video: Blob, onProgress?: (message: string) => void, signal?: AbortSignal): Promise<Blob> {
  const run = async () => {
    const check = () => { if (signal?.aborted) throw new DOMException('任务已取消', 'AbortError') }
    check()
    const ffmpeg = await getFFmpeg(onProgress)
    check()
    const tag = `tts_silent_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`
    const inputName = `${tag}.input`, outputName = `${tag}.mp4`
    try {
      await writeFile(ffmpeg, inputName, video)
      onProgress?.('后期TTS：正在去除生成视频原声（画面不重编码）…')
      const code = await ffmpeg.exec(['-i', inputName, '-map', '0:v:0', '-c:v', 'copy', '-an', '-movflags', '+faststart', '-y', outputName])
      check()
      if (code !== 0) throw new Error(`视频去除原声失败（FFmpeg ${code}）`)
      const bytes = await readFile(ffmpeg, outputName)
      if (!bytes.byteLength) throw new Error('视频去除原声后文件为空')
      return toBlob(bytes, 'video/mp4')
    } finally {
      await ffmpeg.deleteFile(inputName).catch(() => {})
      await ffmpeg.deleteFile(outputName).catch(() => {})
    }
  }
  // Independent concurrent generations share a worker; use unique files and serialize this operation.
  const next = removeAudioQueue.then(run, run)
  removeAudioQueue = next.then(() => undefined, () => undefined)
  return next
}
