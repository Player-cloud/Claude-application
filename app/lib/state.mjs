// What Workspace OS remembers about this PC. Kept in ~/.workspace-os/state.json, never in the toolkit folder,
// so the folder can move between PCs without carrying one PC's paths.

import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { home, readJson, appDir } from './sys.mjs'

export const stateDir = () => join(home(), '.workspace-os')
const stateFile = () => join(stateDir(), 'state.json')

export const PROFILES = ['personal', 'work']

export function loadState() {
  const s = readJson(stateFile(), {}) || {}
  return {
    setupDone: false,
    profiles: {},
    claudePath: '',
    lastTests: null,
    lastPack: null,
    lastCheck: null,
    ...s,
  }
}

export function saveState(patch) {
  const next = { ...loadState(), ...patch }
  mkdirSync(stateDir(), { recursive: true })
  writeFileSync(stateFile(), JSON.stringify(next, null, 2) + '\n')
  return next
}

export const MARKETPLACE = 'my-toolkit'
export const MODS_MARKETPLACE = 'local-mods'

// Plugins the toolkit offers, read from its own marketplace and manifests.
export function catalog() {
  const market = readJson(join(appDir, '.claude-plugin', 'marketplace.json'), { plugins: [] })
  return market.plugins.map((p) => {
    const manifest = readJson(join(appDir, p.source, '.claude-plugin', 'plugin.json'), {})
    return {
      name: p.name,
      description: p.description,
      version: manifest.version || '',
      options: Object.keys(manifest.userConfig || {}),
    }
  })
}

// The set a new PC gets when there is nothing else to go on (the laptop's set on 2026-10-27).
export const RECOMMENDED = ['workspace-os', 'secret-shield', 'handoff', 'nudges', 'control-center', 'learner']

export function conflictList() {
  return JSON.parse(readFileSync(join(appDir, 'app', 'conflicts.json'), 'utf8'))
}
