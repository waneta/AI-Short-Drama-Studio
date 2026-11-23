/** qwen-audio-3.0-tts-flash 系统音色（百炼音色列表） */
export const TTS_VOICES: { id: string; label: string }[] = [
  { id: 'longanlingxin', label: '龙安灵心（女·TTS Plus）' },
  { id: 'longanlufeng', label: '龙安鲁风（男·TTS Plus）' },
  { id: 'Cherry', label: 'Cherry（Qwen3-TTS）' },
  { id: 'longanhuan_v3.6', label: '龙安欢（女·自然普通话）' },
  { id: 'longjielidou_v3.6', label: '龙杰力豆（男童）' },
  { id: 'longpaopao_v3.6', label: '龙泡泡（女童）' },
  { id: 'longhuohuo_v3.6', label: '龙火火（顽皮少年）' },
  { id: 'longchuanshu_v3.6', label: '龙川叔（男）' },
  { id: 'loongeva_v3.6', label: 'loongeva（女·美音）' }
]

export const VOLC_TTS_VOICES = [
  { id: 'zh_female_vv_uranus_bigtts', label: 'Vivi 2.0（女）' },
  { id: 'zh_female_xiaohe_uranus_bigtts', label: '小何 2.0（女）' },
  { id: 'zh_male_m191_uranus_bigtts', label: '云舟 2.0（男）' },
  { id: 'zh_male_taocheng_uranus_bigtts', label: '小天 2.0（男）' },
  { id: 'zh_female_gaolengyujie_uranus_bigtts', label: '高冷御姐 2.0（女）' }
]

export function isVolcTtsModel(model: string): boolean {
  return /^(?:doubao-)?seed-tts-2\.0$/i.test(model.trim())
}

export function ttsVoicesForModel(model: string) {
  return isVolcTtsModel(model) ? VOLC_TTS_VOICES : TTS_VOICES
}

/** Project voice overrides from another provider must not leak into this request. */
export function ttsVoiceForModel(model: string, requested?: string, fallback?: string): string {
  const voices = ttsVoicesForModel(model)
  return [requested, fallback].find(v => voices.some(item => item.id === v)) || voices[0].id
}
