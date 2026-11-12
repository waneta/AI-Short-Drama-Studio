/** @N is a user-facing image number; the provider receives its own ordered reference notation. */
export function resolveImageReferenceMentions(prompt: string, count: number, nativeFormat: boolean | 'flux3' | 'h3' = false): string {
  return prompt.replace(/@(\d+)/g, (_match, digits: string) => {
    const number = Number(digits)
    if (!Number.isSafeInteger(number) || number < 1 || number > count) {
      throw new Error(`参考图 @${digits} 不存在，当前只有 ${count} 张参考图。请按缩略图编号检查引用。`)
    }
    return nativeFormat === 'h3' ? `<Picture ${number}>` : nativeFormat === 'flux3' ? `reference image ${number}` : nativeFormat ? `<image${number}>` : `参考图${number}`
  })
}

/** Only the token at the caret is replaced; later text and other references stay untouched. */
export function imageReferenceMentionAt(prompt: string, caret: number): { start: number; end: number; query: string } | undefined {
  const match = /@(\d*)$/.exec(prompt.slice(0, caret))
  return match ? { start: caret - match[0].length, end: caret, query: match[1] } : undefined
}

export function insertImageReferenceMention(prompt: string, start: number, end: number, number: number) {
  const token = `@${number} `
  return { prompt: prompt.slice(0, start) + token + prompt.slice(end), caret: start + token.length }
}
