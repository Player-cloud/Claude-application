#!/usr/bin/env node
// Workspace OS: a local page for setting up and checking the toolkit on this PC.
// Listens on 127.0.0.1 only and never calls Claude; changes go through Claude Code's own plugin commands.
// Usage: node app/server.mjs [--open] [--port 47821]

import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { copyFileSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, extname } from 'node:path'
import { appDir, claudeDir, findClaude, home, isWin, openThing, readJson, run } from './lib/sys.mjs'
import { loadState, saveState, stateDir, RECOMMENDED, MARKETPLACE, PROFILES } from './lib/state.mjs'
import { snapshot } from './lib/inspect.mjs'
import { planConflicts, planProfiles, planPlugins, planRestore, planUpdate, planPack, packName, currentRoots, samePath, verify } from './lib/plan.mjs'
import { applyActions } from './lib/apply.mjs'
import { health } from './lib/health.mjs'

const args = process.argv.slice(2)
const port = Number(args[args.indexOf('--port') + 1]) || Number(process.env.WSOS_PORT) || 47821
const token = randomBytes(24).toString('hex')
const uiDir = join(appDir, 'app', 'ui')
// The Workspace OS Handbook: the help guide for the whole system, a claude.ai page.
const HANDBOOK = 'https://claude.ai/artifact/J1eS7PTyp1EbUhuyqo9NCb'

// Set when this folder runs from a different place than last time (for example a new USB drive letter).
const recorded = loadState().appDir
const movedFrom = recorded && !samePath(recorded, appDir) ? recorded : null
if (!recorded) saveState({ appDir })

const steps = {
  conflicts: (snap) => planConflicts(snap),
  profiles: (snap, input) => planProfiles(snap, input),
  plugins: (snap, input, state) => planPlugins(snap, input, input.profiles || state.profiles),
  restore: (snap, input, state) => planRestore(snap, input, input.profiles || state.profiles),
  update: (snap) => planUpdate(snap),
  pack: (snap, input, state) => planPack(snap, input, state.profiles),
}

// Wizard defaults. Folder paths never come from a pack: they belong to the PC the pack was made on.
function defaults(snap, state) {
  const pack = snap.packs[0]?.manifest
  const inPack = Array.isArray(pack?.profiles) ? pack.profiles : Object.keys(pack?.profiles || {})
  const profiles = {}
  for (const p of PROFILES) {
    const saved = state.profiles?.[p]
    profiles[p] = saved?.root ? saved : { on: p === 'personal' || inPack.includes(p), root: join(home(), 'Code', p) }
  }
  const on = snap.installed.filter((i) => i.market === MARKETPLACE && i.enabled).map((i) => i.name)
  const plugins = pack?.plugins?.length ? pack.plugins : on.length ? on : RECOMMENDED
  return { profiles, plugins, pack: snap.packs[0]?.name || null }
}

async function api(method, path, body) {
  const state = loadState()
  if (method === 'GET' && path === '/api/state') return { state, appDir, isWin, movedFrom }
  if (method === 'GET' && path === '/api/check') {
    const snap = await snapshot(state)
    const gitv = await run('git', ['--version'], { timeout: 10000 })
    return {
      node: process.version,
      git: gitv.code === 0 ? gitv.stdout.trim() : null,
      claude: snap.claude ? { path: snap.claude.path, version: snap.claude.version } : null,
      appDir,
      movedFrom,
      removable: isWin && !/^c:/i.test(appDir),
      catalog: snap.catalog,
      roots: currentRoots(snap),
      defaults: defaults(snap, state),
      packs: snap.packs.map((p) => ({ name: p.name, createdAt: p.manifest.createdAt, profiles: Array.isArray(p.manifest.profiles) ? p.manifest.profiles : Object.keys(p.manifest.profiles || {}), mods: p.manifest.mods || [] })),
    }
  }
  if (method === 'GET' && path === '/api/health') return health(await snapshot(state), state, movedFrom)
  if (method === 'GET' && path === '/api/verify') return { items: verify(await snapshot(state), state.profiles) }
  if (method === 'POST' && (path === '/api/plan' || path === '/api/apply')) {
    const build = steps[body?.step]
    if (!build) throw Object.assign(new Error('Unknown step'), { status: 400 })
    const input = body.input || {}
    if (body.step === 'pack' && !input.name) input.name = packName()
    const snap = await snapshot(state)
    const plan = build(snap, input, state)
    if (path === '/api/plan') return { ...plan, actions: plan.actions.map(({ op, ...a }) => a), input }
    const ids = Array.isArray(body.ids) ? body.ids.map(String) : []
    const out = await applyActions(plan.actions, ids, snap.claude)
    const allOk = out.results.every((r) => r.ok)
    // Every apply is recorded, so a half-finished one can be resumed or its settings backup put back.
    const patch = { lastApply: { step: body.step, at: new Date().toISOString(), backup: out.backup, results: out.results } }
    if (body.step === 'profiles' && allOk) patch.profiles = input.profiles
    if (body.step === 'conflicts' && allOk) patch.appDir = appDir
    if (body.step === 'pack' && allOk) patch.lastPack = { name: plan.name, at: new Date().toISOString() }
    saveState(patch)
    return out
  }
  if (method === 'POST' && path === '/api/restore-backup') {
    const backup = state.lastApply?.backup
    if (!backup || !existsSync(backup)) return { ok: false, note: 'There is no backup from the last change.' }
    copyFileSync(backup, join(claudeDir(), 'settings.json'))
    saveState({ lastApply: { ...state.lastApply, restored: new Date().toISOString(), results: [] } })
    return { ok: true, note: `Claude's settings are back as they were before the last change (${backup}). Restart Claude Desktop.` }
  }
  if (method === 'POST' && path === '/api/setup-done') return { state: saveState({ setupDone: true, appDir }) }
  if (method === 'POST' && path === '/api/settings') {
    const claudePath = String(body?.claudePath || '').trim()
    const tool = claudePath ? await findClaude(claudePath) : null
    if (claudePath && (!tool || tool.path !== claudePath)) return { ok: false, note: 'That file did not answer as Claude Code.' }
    saveState({ claudePath })
    return { ok: true }
  }
  if (method === 'POST' && path === '/api/open') {
    const t = String(body?.target || '')
    const [kind, p] = t.split(':')
    let target = null
    if (t === 'handbook') target = HANDBOOK
    else if (t === 'cowork') target = 'https://claude.ai'
    else if (t === 'toolkit') target = appDir
    else if (t === 'claude-desktop') {
      const exe = join(process.env.LOCALAPPDATA || join(home(), 'AppData', 'Local'), 'AnthropicClaude', 'claude.exe')
      target = existsSync(exe) ? exe : 'https://claude.ai/download'
    } else if ((kind === 'studio' || kind === 'folder') && PROFILES.includes(p) && state.profiles?.[p]?.root) {
      target = kind === 'studio' ? join(state.profiles[p].root, 'Studio', 'index.html') : state.profiles[p].root
    }
    if (!target) throw Object.assign(new Error('Unknown place to open'), { status: 400 })
    if (!/^https:/.test(target) && !existsSync(target)) return { ok: false, note: `${target} is missing.` }
    return { ok: openThing(target) }
  }
  throw Object.assign(new Error('Not found'), { status: 404 })
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' }

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' })
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body))
}

// A secret kept in the per-PC state folder lets a second launch recognise the running copy.
const instanceSecret = randomBytes(24).toString('hex')

const server = createServer(async (req, res) => {
  const host = (req.headers.host || '').toLowerCase()
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return send(res, 403, { error: 'Wrong host' })
  const url = new URL(req.url, `http://${host}`)
  if (url.pathname === '/whoami') {
    return send(res, req.headers['x-wsos-secret'] === instanceSecret ? 200 : 403, { app: 'workspace-os' })
  }
  if (url.pathname.startsWith('/api/')) {
    if (req.headers['x-wsos-token'] !== token) return send(res, 403, { error: 'Missing token' })
    let body = null
    if (req.method === 'POST') {
      // Changes are accepted only from this page itself.
      if (req.headers.origin !== `http://${host}`) return send(res, 403, { error: 'Wrong origin' })
      let raw = ''
      for await (const chunk of req) {
        raw += chunk
        if (raw.length > 1e6) return send(res, 413, { error: 'Too large' })
      }
      try { body = raw ? JSON.parse(raw) : {} } catch { return send(res, 400, { error: 'Bad JSON' }) }
    } else if (req.method !== 'GET') {
      return send(res, 405, { error: 'Method not allowed' })
    }
    try {
      return send(res, 200, await api(req.method, url.pathname, body))
    } catch (e) {
      return send(res, e.status || 500, { error: String(e.message || e) })
    }
  }
  const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1)
  if (!/^[a-z0-9-]+\.(html|css|js)$/.test(file) || !existsSync(join(uiDir, file))) return send(res, 404, 'Not found', 'text/plain')
  let content = readFileSync(join(uiDir, file), 'utf8')
  if (file === 'index.html') content = content.replace('%%TOKEN%%', token)
  return send(res, 200, content, TYPES[extname(file)])
})

const address = `http://127.0.0.1:${port}/`
const serverFile = join(stateDir(), 'server.json')

async function isOurs() {
  const running = readJson(serverFile, null)
  if (!running?.secret || running.port !== port) return false
  try {
    const r = await fetch(`${address}whoami`, { headers: { 'x-wsos-secret': running.secret } })
    return r.status === 200
  } catch {
    return false
  }
}

server.on('error', async (e) => {
  if (e.code === 'EADDRINUSE') {
    if (await isOurs()) {
      console.log(`Workspace OS is already running at ${address}`)
      if (args.includes('--open')) openThing(address)
      process.exit(0)
    }
    console.error(`Port ${port} is used by another program. Start with a different port, for example: node app\\server.mjs --open --port ${port + 1}`)
    process.exit(1)
  }
  console.error(e.message)
  process.exit(1)
})

server.listen(port, '127.0.0.1', () => {
  mkdirSync(stateDir(), { recursive: true })
  writeFileSync(serverFile, JSON.stringify({ port, pid: process.pid, secret: instanceSecret }) + '\n')
  console.log(`Workspace OS is running at ${address}`)
  console.log('Leave this window open while you use it. Close it to stop.')
  if (args.includes('--open')) openThing(address)
})
