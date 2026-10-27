// Takes a read-only snapshot of this PC: Claude's plugins and marketplaces, settings, profile env, packs, git.

import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { appDir, claudeDir, findClaude, claude, home, run, lastJson, readJson, isWin, isDir } from './sys.mjs'
import { catalog, conflictList } from './state.mjs'

export function splitId(id) {
  const at = id.lastIndexOf('@')
  return at > 0 ? { name: id.slice(0, at), market: id.slice(at + 1) } : { name: id, market: '' }
}

// Without the command line, read what Claude Code keeps on disk.
function installedFromDisk(settings) {
  const file = readJson(join(claudeDir(), 'plugins', 'installed_plugins.json'), { plugins: {} })
  const enabled = settings.enabledPlugins || {}
  const list = Object.entries(file.plugins || {}).flatMap(([id, entries]) =>
    (entries || []).map((e) => ({ id, version: e.version || '', scope: e.scope || 'user', enabled: enabled[id] === true })))
  // Enabled in settings but not installed yet: Claude installs these when it next starts.
  for (const [id, on] of Object.entries(enabled)) {
    if (!list.some((p) => p.id === id)) list.push({ id, version: '', scope: 'user', enabled: on === true, pending: true })
  }
  return list
}

function marketsFromDisk() {
  const file = readJson(join(claudeDir(), 'plugins', 'known_marketplaces.json'), {})
  return Object.entries(file).map(([name, m]) => ({ name, path: m?.source?.path || m?.installLocation || '' }))
}

async function envProfile(hive) {
  if (!isWin) return null
  const key = hive === 'user' ? 'HKCU\\Environment' : 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment'
  const r = await run('reg', ['query', key, '/v', 'WSOS_PROFILE'], { timeout: 10000 })
  if (r.code !== 0) return null
  const m = r.stdout.match(/WSOS_PROFILE\s+REG_\w+\s+(.*)/)
  return m ? m[1].trim() : null
}

export function listPacks() {
  const dir = join(appDir, 'pack')
  if (!isDir(dir)) return []
  return readdirSync(dir)
    .filter((n) => existsSync(join(dir, n, 'manifest.json')))
    .sort()
    .reverse()
    .map((n) => ({ name: n, dir: join(dir, n), manifest: readJson(join(dir, n, 'manifest.json'), {}) }))
}

export async function gitInfo() {
  if (!existsSync(join(appDir, '.git'))) return { repo: false }
  const git = (args) => run('git', args, { cwd: appDir, timeout: 60000 })
  const head = await git(['rev-parse', '--short', 'HEAD'])
  if (head.code !== 0) return { repo: true, available: false }
  const branch = (await git(['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim()
  const dirty = (await git(['status', '--porcelain', '--untracked-files=no'])).stdout.trim() !== ''
  return { repo: true, available: true, commit: head.stdout.trim(), branch, dirty }
}

export async function snapshot(state) {
  const tool = await findClaude(state.claudePath)
  const settings = readJson(join(claudeDir(), 'settings.json'), {}) || {}
  let installed = null
  let markets = null
  if (tool) {
    installed = lastJson((await claude(tool, ['plugin', 'list', '--json'], { timeout: 60000 })).stdout)
    markets = lastJson((await claude(tool, ['plugin', 'marketplace', 'list', '--json'], { timeout: 60000 })).stdout)
  }
  if (!Array.isArray(installed)) installed = installedFromDisk(settings)
  if (!Array.isArray(markets)) markets = marketsFromDisk()
  return {
    appDir,
    home: home(),
    claude: tool,
    settings,
    installed: installed.map((p) => ({ ...p, ...splitId(p.id) })),
    markets: markets.map((m) => ({ name: m.name, path: m.path || m.installLocation || m.url || m.repo || '' })),
    userEnvProfile: await envProfile('user'),
    machineEnvProfile: await envProfile('machine'),
    catalog: catalog(),
    conflicts: conflictList().plugins,
    packs: listPacks(),
    git: await gitInfo(),
    modSrc: join(claudeDir(), 'mod-src'),
  }
}
