/** Copy the lockfile-pinned FFmpeg core; no CDN request is needed. */
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '..')
const source = path.join(root, 'node_modules', '@ffmpeg', 'core', 'dist', 'esm')
const target = path.join(root, 'src', 'assets', 'ffmpeg')
fs.mkdirSync(target, { recursive: true })
for (const [from, to] of [['ffmpeg-core.js', 'ffmpeg-core.esm.js'], ['ffmpeg-core.wasm', 'ffmpeg-core.wasm']]) {
  const input = path.join(source, from)
  if (!fs.existsSync(input)) throw new Error('缺少 @ffmpeg/core，请先运行 npm ci')
  const output = path.join(target, to)
  fs.copyFileSync(input, output + '.tmp')
  fs.renameSync(output + '.tmp', output)
  console.log(`${to}: ${fs.statSync(output).size} bytes`)
}
console.log('本地剪辑核心已准备好，可以运行 npm run web 或 npm run build:web')
