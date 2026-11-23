import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
const base = process.env.JULIU_TEST_URL || 'http://127.0.0.1:5177'
const folder = path.resolve('.cache/juliu-codex-private'), file = path.join(folder, 'transport-probe.txt')
await fs.mkdir(folder, { recursive: true, mode: 0o700 })
await fs.writeFile(file, 'fixture-secret-never-served', { mode: 0o600, flag: 'wx' })
const checks = []
try {
  for (const route of ['/.cache/juliu-codex-private/transport-probe.txt', '/@fs' + file]) {
    const response = await fetch(base + route), text = await response.text()
    assert.equal(response.status, 403); assert(!text.includes('fixture-secret-never-served'))
    checks.push({ name: '私有配置路径禁止静态读取：' + route, passed: true })
  }
  const out = process.env.JULIU_TEST_OUT || '/tmp/juliu-codex-settings-tests'
  await fs.mkdir(out, { recursive: true }); await fs.writeFile(path.join(out, 'static-file-validation.json'), JSON.stringify({ checks }, null, 2))
  console.log('Passed two private-file checks')
} finally { await fs.unlink(file) }
