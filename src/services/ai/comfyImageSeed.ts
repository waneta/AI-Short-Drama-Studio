/** Default redraws vary; an explicit seed makes comparisons reproducible. */
export function comfyImageSeed(seed?: number): number {
  if (seed !== undefined) {
    if (!Number.isSafeInteger(seed) || seed < 0) throw new Error('[comfyui] 图片随机种子必须是非负安全整数。')
    return seed
  }
  return Math.floor(Math.random() * 2_147_483_647)
}
