import type { Project, Shot, ShotAudioMode } from '@/types'
import { effectiveShotAudioMode, isDigitalHumanSpeechProject } from '@/utils/shot'
import { spokenTextOnly } from './dialogue'

export interface VideoSpeechPolicy { mode: ShotAudioMode; speech?: string }
const END = '【剧流人声控制结束】'
const LEGACY_TTS = '【人声控制：后期TTS】\n人物不说话、不做说话口型；保留剧情需要的动作，以及与场景和动作对应的环境声、脚步声、衣物摩擦等音效。提示词中的台词仅供后期配音，不得生成对白、旁白、口播或演唱。No spoken dialogue, no voiceover, no singing. Do not animate speaking lip movements. Preserve scene ambience and action sound effects.'
const AMBIENT_ONLY = '音轨仅包含与场景和动作对应的环境声及音效；人物通过目光、表情和肢体动作完成表演，保留吃东西、呼吸等剧情需要的自然动作。Audio consists exclusively of scene ambience and physical action effects. Preserve the visual performance and all story-required actions.'
export const TTS_VIDEO_DIRECTIVE = `【人声控制：后期TTS】\n${AMBIENT_ONLY}\n${END}`

/** Trust the dedicated speech field first, or explicit d tags / speech declarations in the prompt. */
export function trustedShotSpeech(shot: Pick<Shot, 'voiceover' | 'compiledVideoPrompt' | 'videoPrompt'>): string {
  const clean = (text: string) => String(text || '').split(/\r?\n/).map(line => {
    const body = spokenTextOnly(line.replace(/^[A-Za-z][A-Za-z .'-]{0,40}[：:]\s*/, ''))
    if (!body) return ''
    const prefix = line.trim().match(/^([^：:\n]{1,24})[：:]/)?.[1]?.replace(/[“”「」]/g, '').trim()
    return prefix ? `${prefix}：${body}` : body
  }).filter(Boolean).join('\n')
  if (String(shot.voiceover || '').trim()) return clean(shot.voiceover)
  const raw = String(shot.compiledVideoPrompt || shot.videoPrompt || '').replace(/【人声控制：(后期TTS|H3出镜对白|H3画外口播|无口播)】[\s\S]*?【剧流人声控制结束】/g, '')
  const tagged = [...raw.matchAll(/<d>\s*(?:\[[^\]]*\]\s*)?([\s\S]*?)<\/d>/gi)].map(m => spokenTextOnly(m[1])).filter(Boolean)
  if (tagged.length) return tagged.join('\n')
  const lines: string[] = []
  for (const m of raw.matchAll(/(?:^|\n)\s*(?:台词|对白|旁白|口播)\s*[：:]\s*(.+)$/gm)) {
    const line = clean(m[1]); if (line) lines.push(line)
  }
  if (lines.length) return lines.join('\n')
  for (const m of raw.matchAll(/([\u3400-\u9fffA-Za-z][\u3400-\u9fffA-Za-z _-]{0,15}?)\s*(?:说道|轻声说|小声说|喊道|问道|回答|说|问|答|says?|asks?)\s*[：:]?\s*[“「"'‘]([^”」"'’\n]+)[”」"'’]/gi)) {
    const body = spokenTextOnly(m[2]); if (body) lines.push(`${m[1].trim()}：${body}`)
  }
  return lines.join('\n')
}

export function shotSpeechPolicy(shot: Shot, project?: Project | null, audioSync = false): VideoSpeechPolicy | undefined {
  if (audioSync || isDigitalHumanSpeechProject(project)) return undefined
  let mode = effectiveShotAudioMode(shot)
  const speech = mode === 'h3-dialogue' || mode === 'h3-voiceover' ? trustedShotSpeech(shot) : ''
  // Old unlabelled, silent shots must not acquire invented dialogue just because dialogue was the UI default.
  if (!shot.audioMode && !speech && mode === 'h3-dialogue') mode = 'none'
  return { mode, speech }
}

export function suppressShotSpeech(shot: Shot, project?: Project | null, audioSync = false): boolean {
  return shotSpeechPolicy(shot, project, audioSync)?.mode === 'tts'
}

export function videoSpeechDirective(policy?: boolean | VideoSpeechPolicy): string {
  if (!policy) return ''
  const value = policy === true ? { mode: 'tts' as const } : policy
  if (value.mode === 'tts') return TTS_VIDEO_DIRECTIVE
  if (value.mode === 'none') return `【人声控制：无口播】\n${AMBIENT_ONLY}\n${END}`
  const speech = value.speech?.trim() || ''
  const shared = `只使用下列明确台词，严格按序，不自行新增、重复或改写台词。角色名和表演说明不朗读。\n台词原文：\n${speech || '（尚未填写有效台词，请先补充）'}\n保留与场景动作对应的环境声和音效。`
  return value.mode === 'h3-voiceover'
    ? `【人声控制：H3画外口播】\n下列台词全部作为画外旁白，不由画面人物开口朗读。所有可见人物不做旁白的说话口型；保留吃东西等剧情所需动作。Off-screen voiceover only; no on-screen speaking lip movements.\n${shared}\n${END}`
    : `【人声控制：H3出镜对白】\n下列台词由对应的出镜角色说出，嘴部动作与本人台词自然同步。其他角色只作反应，不抢话、不同时对口型；不要改为画外旁白。On-screen dialogue with natural lip synchronization; no off-screen narration.\n${shared}\n${END}`
}

function stripGeneratedControl(prompt: string): string {
  let text = prompt.replace(/(?:\n\n)?【人声控制：(后期TTS|H3出镜对白|H3画外口播|无口播)】[\s\S]*?【剧流人声控制结束】/g, '').trimEnd()
  if (text.endsWith(LEGACY_TTS)) text = text.slice(0, -LEGACY_TTS.length).trimEnd()
  return text
}

/** Remove explicit spoken content from a request copy; never rewrite the saved screenplay. */
export function ambientVideoPrompt(prompt: string): string {
  // A private marker lets speech leads be removed without consuming neighbouring physical actions.
  let marker = '__JULIU_SPOKEN_WORDS__'
  while (prompt.includes(marker)) marker += '_'
  let body = prompt.replace(/<d>\s*(?:\[[^\]]*\])?\s*[\s\S]*?<\/d>/gi, marker)
  // Quoted prop names and visible signs are kept; only speech verbs/labels qualify.
  const quoted = /(?:说道|说出|念出|说着|轻声说|小声说|低声说|喊道|问道|答道|回答|说|问|答|朗读|念道|旁白|画外音|口播)\s*[：:]?\s*[“「『"‘']([^”」』"’'\n]*)[”」』"’']/g
  body = body.replace(quoted, '作出反应。')
  body = body.replace(/\b(?:says?|asks?|repl(?:y|ies)|shouts?|whispers?|narrates?)\s*(?:in (?:an? )?off-screen voiceover\s*)?[:：]?\s*[“"‘']([^”"’'\n]*)[”"’']/gi, 'pauses')
  // Standalone, explicitly labelled lines: do not treat arbitrary quoted objects as dialogue.
  body = body.replace(/(^|\n)[ \t]*(?:台词|对白|旁白|画外音|口播|声线|音色|Dialogue|Voiceover|Spoken words|Speaker voice|Voice roster)\s*[：:][^\n]*/gi, '$1')
  body = body.replace(/(^|\n)([ \t]*\(S\d+\))[：:][ \t]*[“「『"‘'][^”」』"’'\n]*[”」』"’']/g, '$1$2 pauses')
  const esc = marker
  body = body.replace(new RegExp(String.raw`\b(?:says?|asks?|repl(?:y|ies)|shouts?|whispers?|narrates?|speaks?)\b[^.\n]{0,180}?` + esc, 'gi'), 'pauses')
  body = body.replace(new RegExp(String.raw`(?:说道|说出|念出|说着|轻声说|小声说|低声说|喊道|问道|答道|回答|说|问|答|朗读|旁白|画外音|口播)[^。\n]{0,60}?` + esc, 'g'), '停顿')
  body = body.split(marker).join('')
  // Remove precise speech/voice instructions, leaving eating, hand-to-mouth actions and ambience intact.
  body = body.replace(/\bOnly\s+\(S\d+\)\s+speaks?(?: in this shot)?\.?/gi, '')
    .replace(/\b(?:No|no)\s+(?:spoken dialogue|dialogue|voiceover|singing|voices|speaking lip movements|lips moving)\.?/g, '')
    .replace(/\b(?:accurate|natural)\s+lip[- ]sync(?:hronization)?\.?/gi, '')
    .replace(/\b(?:synchronized|speaking)\s+lip movements\.?/gi, '')
    .replace(/\b(?:Spoken words appear only inside the d tag|Only the words inside the d tag are heard)\.?/gi, '')
    .replace(/\b(?:says?|speaks?)\s+in (?:an? )?off-screen voiceover\s*[:：]?/gi, 'pauses')
    .replace(/(?:逐字|完整|清楚地?|大声|轻声|小声|低声)?(?:说出|念出|朗读)(?:下列|以下|本镜|原有|原文|所有)?(?:台词|对白|旁白|口播|原词)[^，,。；;\n]*[，,。；;]?/g, '')
    .replace(/(?:嘴部动作|嘴形|口型)(?:与|和)?(?:本人)?(?:台词|对白|语音)?(?:自然)?(?:同步|清晰|准确|对齐)[^，,。；;\n]*[，,。；;]?/g, '')
    .replace(/(^|[，,。；;！？!?\n])[ \t]*(?:前半句|后半句|首句|末句|最后一句|第一句|第二句|这句|本句|每句|整句)[^，,。；;！？!?\n]*/g, '$1')
    .replace(/(?:台词|对白|旁白|口播)(?:说完|结束|念完)(后|时)?/g, '表情变化结束$1')
    .replace(/说完(后|时)?/g, '作出反应$1')
    .replace(/(?:开口说(?:话)?|张嘴说话)/g, '作出反应')
    .replace(/\b(?:speaks?|talks?)(?:\s+(?:angrily|softly|quietly|loudly))?\b/gi, 'reacts')
    .replace(/\bafter (?:finishing|delivering) (?:his|her|their|the) (?:line|dialogue)\b/gi, 'after the reaction')
    .replace(/[，,][ \t]*[。]/g, '。').replace(/[。][ \t]*[，,。]/g, '。')
    .replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
  return body
}

/** Shared by preview and submit. Clean only the outgoing copy for ambience-only plans. */
export function videoPromptWithSpeechPolicy(prompt: string, policy?: boolean | VideoSpeechPolicy): string {
  const directive = videoSpeechDirective(policy)
  if (!directive) return prompt
  const value = policy === true ? { mode: 'tts' as const } : policy
  const source = stripGeneratedControl(prompt)
  const body = value && (value.mode === 'tts' || value.mode === 'none') ? ambientVideoPrompt(source) : source
  return `${body}\n\n${directive}`
}

export function speechPolicyIssue(policy?: VideoSpeechPolicy, audioDisabled = false): string {
  if (!policy || policy.mode === 'none' || policy.mode === 'tts') return ''
  if (!policy.speech?.trim()) return '当前人声方案需要有效台词。请在字幕页填写本镜台词，或在提示词中用“角色说：‘台词’”明确填写。'
  if (audioDisabled) return '当前人声方案需要H3生成人声，但视频参数中的“生成音频”已关闭。请开启音频，或改用后期TTS/无口播。'
  return ''
}

export function limitVideoSpeechPrompt(prompt: string, policy?: boolean | VideoSpeechPolicy, limit = 10000): string {
  if (prompt.length <= limit) return prompt
  const directive = videoSpeechDirective(policy)
  if (directive.length + 2 >= limit) throw new Error('本镜台词和人声控制超过接口长度限制，请缩短台词后再生成。')
  return directive ? videoPromptWithSpeechPolicy(stripGeneratedControl(prompt).slice(0, limit - directive.length - 2), policy) : prompt.slice(0, limit)
}
