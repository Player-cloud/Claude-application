// Starts the real server against a throwaway home folder and drives the API like the page does.
// The end-to-end part uses Claude Code's own plugin commands, so it is skipped where `claude` isn't installed.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const server = join(dirname(fileURLToPath(import.meta.url)), '..', 'server.mjs')
const home = mkdtempSync(join(tmpdir(), 'wsos-home-'))
const port = 47000 + Math.floor(Math.random() * 900)
const base = `http://127.0.0.1:${port}`
const hasClaude = process.platform !== 'win32' && spawnSync('claude', ['--version']).status === 0
let child
let token

before(async () => {
  child = spawn(process.execPath, [server, '--port', String(port)], { env: { ...process.env, HOME: home, USERPROFILE: home }, stdio: ['ignore', 'pipe', 'pipe'] })
  for (let i = 0; i < 100; i++) {
    try {
      const html = await (await fetch(base + '/')).text()
      token = html.match(/name="wsos-token" content="([0-9a-f]+)"/)[1]
      return
    } catch { await new Promise((r) => setTimeout(r, 100)) }
  }
  throw new Error('server did not start')
})
after(() => child?.kill())

const api = async (method, path, body, headers = {}) => {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-WSOS-Token': token, Origin: base, ...headers },
    body: body ? JSON.stringify(body) : undefined,
  })
  return { status: res.status, body: await res.json().catch(() => null) }
}

test('the API needs the page token, the right host and, for changes, the page origin', async () => {
  assert.equal((await api('GET', '/api/state', null, { 'X-WSOS-Token': 'nope' })).status, 403)
  assert.equal((await api('POST', '/api/plan', { step: 'conflicts' }, { Origin: 'https://evil.example' })).status, 403)
  const wrongHost = spawnSync('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', '-H', 'Host: evil.example', base + '/'], { encoding: 'utf8' })
  if (wrongHost.status === 0) assert.equal(wrongHost.stdout, '403')
  assert.equal((await api('GET', '/api/state')).status, 200)
  assert.equal((await fetch(base + '/whoami')).status, 403)
})

test('state lives in the home folder, not the toolkit', async () => {
  const { body } = await api('GET', '/api/state')
  assert.equal(body.state.setupDone, false)
  assert.ok(existsSync(join(home, '.workspace-os', 'state.json')))
  assert.ok(existsSync(join(home, '.workspace-os', 'server.json')))
})

test('end to end: conflicts, profiles and plugins through Claude Code', { skip: !hasClaude && 'claude CLI not installed' }, async () => {
  const check = (await api('GET', '/api/check')).body
  assert.ok(check.claude, 'claude found')
  assert.equal(check.catalog.length, 8)

  // An old copy of control-panel and an old toolkit marketplace elsewhere.
  const old = mkdtempSync(join(tmpdir(), 'old-toolkit-'))
  spawnSync('cp', ['-r', join(check.appDir, '.claude-plugin'), join(check.appDir, 'plugins'), old])
  mkdirSync(join(old, 'plugins', 'control-panel', '.claude-plugin'), { recursive: true })
  writeFileSync(join(old, 'plugins', 'control-panel', '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'control-panel', version: '1.0.0', description: 'old' }))
  const market = JSON.parse(readFileSync(join(old, '.claude-plugin', 'marketplace.json'), 'utf8'))
  market.plugins.push({ name: 'control-panel', source: './plugins/control-panel', description: 'old' })
  writeFileSync(join(old, '.claude-plugin', 'marketplace.json'), JSON.stringify(market))
  const env = { ...process.env, HOME: home }
  assert.equal(spawnSync('claude', ['plugin', 'marketplace', 'add', old], { env }).status, 0)
  assert.equal(spawnSync('claude', ['plugin', 'install', 'control-panel@my-toolkit'], { env }).status, 0)

  const conflicts = (await api('POST', '/api/plan', { step: 'conflicts', input: {} })).body
  const ids = conflicts.actions.map((a) => a.id)
  assert.deepEqual(ids, ['remove:control-panel@my-toolkit', 'toolkit:here'])
  const applied = (await api('POST', '/api/apply', { step: 'conflicts', input: {}, ids })).body
  assert.ok(applied.results.every((r) => r.ok), JSON.stringify(applied.results))
  assert.ok(applied.backup && existsSync(applied.backup))

  const profiles = { personal: { on: true, root: join(home, 'Code', 'personal') }, work: { on: true, root: join(home, 'Code', 'work') } }
  const pplan = (await api('POST', '/api/plan', { step: 'profiles', input: { profiles } })).body
  const papplied = (await api('POST', '/api/apply', { step: 'profiles', input: { profiles }, ids: pplan.actions.map((a) => a.id) })).body
  assert.ok(papplied.results.every((r) => r.ok), JSON.stringify(papplied.results))
  assert.ok(existsSync(join(profiles.work.root, 'Studio', 'library.js')))
  assert.equal(JSON.parse(readFileSync(join(profiles.work.root, '.claude', 'settings.local.json'), 'utf8')).env.WSOS_PROFILE, 'work')

  const input = { plugins: ['workspace-os', 'learner', 'nudges'], profiles }
  const plplan = (await api('POST', '/api/plan', { step: 'plugins', input })).body
  const plapplied = (await api('POST', '/api/apply', { step: 'plugins', input, ids: plplan.actions.map((a) => a.id) })).body
  assert.ok(plapplied.results.every((r) => r.ok), JSON.stringify(plapplied.results))
  const settings = JSON.parse(readFileSync(join(home, '.claude', 'settings.json'), 'utf8'))
  assert.equal(settings.enabledPlugins['workspace-os@my-toolkit'], true)
  assert.equal(settings.pluginConfigs['workspace-os@my-toolkit'].options.workRoots, profiles.work.root)
  assert.equal(settings.extraKnownMarketplaces['my-toolkit'].source.path, check.appDir)

  const verify = (await api('GET', '/api/verify')).body.items
  assert.ok(verify.every((i) => i.ok), JSON.stringify(verify.filter((i) => !i.ok)))
  const again = (await api('POST', '/api/plan', { step: 'plugins', input })).body
  assert.equal(again.actions.length, 0, 'second run has nothing to change')

  const health = (await api('GET', '/api/health')).body
  assert.equal(health.plugins.filter((p) => p.on).length, 3)
})
