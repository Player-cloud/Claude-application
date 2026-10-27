// The dashboard's view of this PC.

import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { MARKETPLACE, PROFILES } from './state.mjs'
import { planConflicts, samePath, verify, PROFILE_NAMES } from './plan.mjs'

function countFiles(dir) {
  try { return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile() && !e.name.startsWith('.')).length } catch { return 0 }
}

// movedFrom: the toolkit folder recorded last time, when it differs from where it runs now (a USB letter change).
export function health(snap, state, movedFrom = null) {
  const plugins = snap.catalog.map((p) => {
    const inst = snap.installed.find((i) => i.id === `${p.name}@${MARKETPLACE}`)
    return { name: p.name, installed: !!inst, on: !!inst?.enabled, version: inst?.version || '', folderVersion: p.version }
  })
  const market = snap.markets.find((m) => m.name === MARKETPLACE)
  const conflicts = planConflicts(snap).actions.filter((a) => a.group === 'conflicts')
  const checks = verify(snap, state.profiles)
  const profiles = {}
  for (const p of PROFILES) {
    const cfg = state.profiles?.[p]
    if (!cfg?.on || !cfg.root) { profiles[p] = { on: false }; continue }
    profiles[p] = {
      on: true,
      root: cfg.root,
      exists: existsSync(cfg.root),
      marked: checks.some((c) => c.ok && c.label === `${PROFILE_NAMES[p]} folder is marked ${PROFILE_NAMES[p]}`),
      studio: existsSync(join(cfg.root, 'Studio', 'index.html')),
      inbox: countFiles(join(cfg.root, 'Studio', 'inbox')),
    }
  }
  const needs = []
  const last = state.lastApply
  if (last && last.results?.some((r) => r.ok === false)) needs.push({ text: `The last change (${last.step}) stopped at "${last.results.find((r) => r.ok === false).label}". Resume it, or put Claude's settings back as they were before it.`, resume: last.step, restore: !!last.backup })
  if (movedFrom) needs.push({ text: `This toolkit folder moved from ${movedFrom} to ${snap.appDir}. Point Claude at the new place in setup step 2.`, step: 2 })
  if (!snap.claude) needs.push({ text: 'Claude Code was not found. Changes are written into Claude\'s settings file instead; set its path in setup step 1 to use Claude\'s own commands.', step: 1 })
  if (!movedFrom && (!market || !samePath(market.path, snap.appDir))) needs.push({ text: 'Claude installs the toolkit from another folder. Switch it here in setup step 2.', step: 2 })
  if (conflicts.length) needs.push({ text: `${conflicts.length} conflicting install${conflicts.length === 1 ? '' : 's'} found. Remove ${conflicts.length === 1 ? 'it' : 'them'} in setup step 2.`, step: 2 })
  const stale = plugins.filter((p) => p.on && p.version && p.folderVersion && p.version !== p.folderVersion)
  if (stale.length) needs.push({ text: `${stale.map((p) => p.name).join(', ')} ${stale.length === 1 ? 'is' : 'are'} older in Claude than in the toolkit. Setup step 4 updates them.`, step: 4 })
  for (const p of PROFILES) {
    const h = profiles[p]
    const name = PROFILE_NAMES[p]
    if (!h.on) needs.push({ text: `${name} profile is not set up on this PC. Add it when you need it.`, step: 3 })
    else if (!h.exists) needs.push({ text: `${name} folder ${h.root} is missing. If it is on a USB stick, plug it in or pick the new folder.`, step: 3 })
    else if (!h.marked) needs.push({ text: `${name} folder is not marked, so sessions there start with no profile.`, step: 3 })
    else if (h.inbox) needs.push({ text: `${h.inbox} new file${h.inbox === 1 ? '' : 's'} in the ${name} Studio inbox. Ask Claude to sort them.`, open: `studio:${p}` })
  }
  return {
    appDir: snap.appDir,
    claude: snap.claude ? { path: snap.claude.path, version: snap.claude.version } : null,
    node: process.version,
    git: snap.git,
    plugins,
    market: { here: !!market && samePath(market.path, snap.appDir), path: market?.path || '' },
    checks,
    profiles,
    lastPack: state.lastPack,
    packs: snap.packs.map((p) => p.name),
    needs,
  }
}
