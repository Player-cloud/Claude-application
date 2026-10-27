// Builds the list of changes each step would make. Pure: it reads only the snapshot and the person's choices,
// so the same list is shown before applying and rebuilt on the server when the person presses Apply.
// Each action: { id, group, label, detail, op }. The op says exactly what apply.mjs does.
// Ids are "<kind>:<subject>" (e.g. "install:nudges", "mark:work"), stable for the same snapshot and choices.

import { join, resolve } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { MARKETPLACE, MODS_MARKETPLACE, PROFILES } from './state.mjs'

export const STUDIO_FILES = ['index.html', 'STUDIO.md', 'types.md', 'build-library.mjs']
export const PROFILE_NAMES = { personal: 'Personal', work: 'Work' }
export const PACK_VERSION = 1

const norm = (p) => resolve(p).replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase()
export function samePath(a, b) {
  return !!a && !!b && norm(a) === norm(b)
}
export function inside(child, parent) {
  if (!child || !parent) return false
  const c = norm(child)
  const p = norm(parent)
  return c === p || c.startsWith(p + '/')
}

const settingsFile = (snap) => join(snap.home, '.claude', 'settings.json')

// With Claude Code's command line, use it. Without it, write the same keys into settings.json;
// Claude Code installs what settings.json enables when it next starts.
function viaSettings(snap, set, note) {
  return { type: 'mergeJson', path: settingsFile(snap), set, note }
}

function uninstallOp(snap, p) {
  if (snap.claude) return { type: 'claude', args: ['plugin', 'uninstall', p.id, '--scope', p.scope || 'user'] }
  return viaSettings(snap, { enabledPlugins: { [p.id]: false } }, 'Claude Code was not found, so this turns it off instead of uninstalling it.')
}

function marketplaceOp(snap, name, dir) {
  if (snap.claude) return { type: 'claude', args: ['plugin', 'marketplace', 'add', dir] }
  return viaSettings(snap, { extraKnownMarketplaces: { [name]: { source: { source: 'directory', path: dir } } } })
}

// 2 · Clear old installs. A conflict is: a plugin named in conflicts.json from any marketplace;
// a toolkit plugin name installed from a marketplace other than my-toolkit; a user-level WSOS_PROFILE;
// or the my-toolkit marketplace pointing at another folder.
export function planConflicts(snap) {
  const actions = []
  const catalogNames = new Set(snap.catalog.map((p) => p.name))
  const conflictByName = new Map(snap.conflicts.map((c) => [c.name, c]))
  for (const p of snap.installed) {
    const known = conflictByName.get(p.name)
    if (known) {
      actions.push({ id: `remove:${p.id}`, group: 'conflicts', label: `Remove ${p.name}`, detail: known.why, op: uninstallOp(snap, p) })
    } else if (catalogNames.has(p.name) && p.market !== MARKETPLACE) {
      actions.push({
        id: `remove:${p.id}`, group: 'conflicts',
        label: `Remove the second copy of ${p.name}`,
        detail: `It comes from "${p.market}". Two copies would run the same hooks twice; the toolkit's copy stays.`,
        op: uninstallOp(snap, p),
      })
    }
  }
  if (snap.userEnvProfile) {
    actions.push({
      id: 'remove:env-user', group: 'conflicts',
      label: 'Remove the Windows-wide WSOS_PROFILE setting',
      detail: `It is set to "${snap.userEnvProfile}" for every program, which overrides each folder's own profile.`,
      op: { type: 'regDelete', name: 'WSOS_PROFILE' },
    })
  }
  const market = snap.markets.find((m) => m.name === MARKETPLACE)
  if (!market || !samePath(market.path, snap.appDir)) {
    actions.push({
      id: 'toolkit:here', group: 'toolkit',
      label: market ? 'Switch the toolkit to this folder' : 'Add the toolkit to Claude',
      detail: market
        ? `Claude installs the toolkit from ${market.path || 'somewhere else'}. Plugins will come from ${snap.appDir} instead. The old folder is not deleted.`
        : `Claude will install the toolkit's plugins from ${snap.appDir}.`,
      op: marketplaceOp(snap, MARKETPLACE, snap.appDir),
    })
  }
  const notes = []
  if (snap.machineEnvProfile) notes.push(`WSOS_PROFILE is also set for all users of this PC ("${snap.machineEnvProfile}"). Removing that needs an administrator, so it is left alone.`)
  return { actions, notes }
}

// Profile roots must not overlap each other or sit inside the toolkit folder (where packs live).
export function checkRoots(profiles, appDir) {
  const errors = []
  const on = PROFILES.filter((p) => profiles?.[p]?.on)
  for (const p of on) {
    const root = profiles[p].root
    if (!root) { errors.push(`Give the ${PROFILE_NAMES[p]} profile a folder.`); continue }
    if (inside(root, appDir) || inside(appDir, root)) errors.push(`The ${PROFILE_NAMES[p]} folder can't be inside the toolkit folder or contain it.`)
  }
  if (on.length === 2 && profiles.personal.root && profiles.work.root) {
    const [a, b] = [profiles.personal.root, profiles.work.root]
    if (inside(a, b) || inside(b, a)) errors.push('The Personal and Work folders overlap. Pick two separate folders.')
  }
  return errors
}

export const driveOf = (p) => (/^[a-z]:/i.test(p || '') ? p.slice(0, 2).toUpperCase() : '')

// 3 · Profiles. The profile mark is env.WSOS_PROFILE in <root>\.claude\settings.local.json; only that key is
// merged in, so permissions, hooks and other env values already there stay.
export function planProfiles(snap, input) {
  const actions = []
  const notes = []
  const profiles = input?.profiles || input
  const errors = checkRoots(profiles, snap.appDir)
  if (errors.length) return { actions, notes: errors, blocked: true }
  for (const p of PROFILES) {
    const choice = profiles?.[p]
    if (!choice?.on) continue
    const root = choice.root
    const name = PROFILE_NAMES[p]
    const group = p
    if (driveOf(root) && driveOf(root) !== 'C:') notes.push(`The ${name} folder is on ${driveOf(root)}. If that is a USB stick, its letter can change on another PC; the dashboard will say if the folder goes missing.`)
    for (const sub of ['', 'Preferences', join('Vault', '_inbox'), join('Studio', 'inbox')]) {
      const dir = sub ? join(root, sub) : root
      if (!existsSync(dir)) actions.push({ id: `mkdir:${p}:${sub || 'root'}`, group, label: `Create ${dir}`, detail: '', op: { type: 'mkdir', path: dir } })
    }
    const studio = join(root, 'Studio')
    for (const f of STUDIO_FILES) {
      const to = join(studio, f)
      if (!existsSync(to)) actions.push({ id: `studio:${p}:${f}`, group, label: `Add Studio ${f}`, detail: 'From the toolkit\'s studio/template folder.', op: { type: 'copyFile', from: join(snap.appDir, 'studio', 'template', f), to } })
    }
    if (!existsSync(join(studio, 'library.js'))) {
      actions.push({ id: `studio:${p}:build`, group, label: `Build the ${name} Studio index`, detail: 'Runs build-library.mjs once so the viewer opens.', op: { type: 'node', script: join(studio, 'build-library.mjs'), cwd: studio } })
    }
    actions.push({
      id: `mark:${p}`, group,
      label: `Mark ${root} as ${name}`,
      detail: `Sets WSOS_PROFILE=${p} in ${join(root, '.claude', 'settings.local.json')}, keeping everything else in that file. Sessions opened in this folder start in the ${name} profile${p === 'work' ? ', where the Friday update nudge can show' : ''}.`,
      op: { type: 'mergeJson', path: join(root, '.claude', 'settings.local.json'), set: { env: { WSOS_PROFILE: p } } },
    })
  }
  return { actions, notes }
}

// Every root already in the settings is kept, found or not (an unplugged USB stick must not shrink the
// profile boundary). Only roots the person unticks (drop) are removed. This PC's root goes first.
export function mergeRoots(root, current, drop = []) {
  const rest = String(current || '').split(';').map((s) => s.trim())
    .filter((s) => s && !samePath(s, root) && !drop.some((d) => samePath(d, s)))
  return [root, ...new Set(rest)].join(';')
}

export function currentRoots(snap) {
  const opts = snap.settings.pluginConfigs?.[`workspace-os@${MARKETPLACE}`]?.options || {}
  const list = (v) => String(v || '').split(';').map((s) => s.trim()).filter(Boolean).map((path) => ({ path, exists: existsSync(path) }))
  return { personal: list(opts.personalRoots), work: list(opts.workRoots) }
}

// Option keys, from each plugin's manifest: workspace-os personalRoots, workRoots, personalVault, workVault;
// learner personalRoots, workRoots. Roots are ;-separated.
export function pluginOptions(name, profiles, current = {}, drop = []) {
  const on = (p) => profiles?.[p]?.on && profiles[p].root
  const set = {}
  if (name === 'workspace-os' || name === 'learner') {
    if (on('personal')) set.personalRoots = mergeRoots(profiles.personal.root, current.personalRoots, drop)
    if (on('work')) set.workRoots = mergeRoots(profiles.work.root, current.workRoots, drop)
  }
  if (name === 'workspace-os') {
    if (on('personal')) set.personalVault = join(profiles.personal.root, 'Vault')
    if (on('work')) set.workVault = join(profiles.work.root, 'Vault')
  }
  return set
}

// 4 · Plugins: install, update, configure or turn off the toolkit's plugins (the 8 in .claude-plugin/marketplace.json).
export function planPlugins(snap, input, profiles) {
  const actions = []
  const notes = []
  const chosen = new Set(input?.plugins || [])
  const drop = input?.dropRoots || []
  const configs = snap.settings.pluginConfigs || {}
  for (const p of snap.catalog) {
    const id = `${p.name}@${MARKETPLACE}`
    const inst = snap.installed.find((i) => i.id === id)
    const current = configs[id]?.options || {}
    const opts = pluginOptions(p.name, profiles, current, drop)
    const changed = Object.fromEntries(Object.entries(opts).filter(([k, v]) => current[k] !== v))
    const optText = Object.entries(changed).map(([k, v]) => `${k} = ${v}`).join('\n')
    if (chosen.has(p.name)) {
      if (!inst) {
        const args = ['plugin', 'install', id]
        for (const [k, v] of Object.entries(opts)) args.push('--config', `${k}=${v}`)
        const op = snap.claude ? { type: 'claude', args } : viaSettings(snap, { enabledPlugins: { [id]: true }, ...(Object.keys(opts).length ? { pluginConfigs: { [id]: { options: opts } } } : {}) })
        actions.push({ id: `install:${p.name}`, group: 'plugins', label: `Install ${p.name}`, detail: [p.description, optText].filter(Boolean).join('\n'), op })
        continue
      }
      if (!inst.enabled) {
        actions.push({ id: `enable:${p.name}`, group: 'plugins', label: `Turn on ${p.name}`, detail: '', op: snap.claude ? { type: 'claude', args: ['plugin', 'enable', id] } : viaSettings(snap, { enabledPlugins: { [id]: true } }) })
      }
      if (p.version && inst.version && inst.version !== p.version && snap.claude) {
        actions.push({ id: `update:${p.name}`, group: 'plugins', label: `Update ${p.name} ${inst.version} → ${p.version}`, detail: '', op: { type: 'claude', args: ['plugin', 'update', id] } })
      }
      if (Object.keys(changed).length) {
        actions.push({
          id: `config:${p.name}`, group: 'plugins',
          label: `Set ${p.name}'s profile folders`,
          detail: optText,
          op: snap.claude
            ? { type: 'claude', args: ['plugin', 'configure', id, '--values-stdin'], stdin: JSON.stringify(changed) }
            : viaSettings(snap, { pluginConfigs: { [id]: { options: changed } } }),
        })
      }
    } else if (inst?.enabled) {
      actions.push({ id: `disable:${p.name}`, group: 'plugins', label: `Turn off ${p.name}`, detail: 'Not picked. It stays installed, so you can turn it back on here.', op: snap.claude ? { type: 'claude', args: ['plugin', 'disable', id] } : viaSettings(snap, { enabledPlugins: { [id]: false } }) })
    }
  }
  if (!snap.claude) notes.push('Claude Code was not found, so these changes are written into Claude\'s settings file. Claude installs them the next time it starts.')
  return { actions, notes }
}

// Pack contents: per profile Preferences, Vault, Studio (+ Learning\videos when asked); never these names.
const SECRETISH = /^(\.env(\..*)?|.*\.(pem|key|pfx|p12)|id_(rsa|ed25519|ecdsa)(\.pub)?)$/i
export const keepInPack = (name) => !SECRETISH.test(name) && name !== 'node_modules' && name !== '.git'
const PACK_ITEMS = ['Preferences', 'Vault', 'Studio']

// YYYY-MM-DD_HHmm: no ":" so it is a valid Windows folder name.
export function packName(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`
}

// Kept mods: plugins installed from the local-mods marketplace (~/.claude/mod-src, one folder per mod with its
// own .claude-plugin/plugin.json, listed in mod-src/.claude-plugin/marketplace.json) that are not in conflicts.json.
export function keptMods(snap) {
  const bad = new Set(snap.conflicts.map((c) => c.name))
  return snap.installed.filter((p) => p.market === MODS_MARKETPLACE && !bad.has(p.name)).map((p) => p.name)
}

// Pack for another PC: copies into <toolkit>\pack\<name>\<profile>\... (pack/ is git-ignored).
// Work is opt-in per pack. Secrets are filtered by file name only.
export function planPack(snap, input, profiles) {
  const name = input?.name || packName()
  const dir = join(snap.appDir, 'pack', name)
  const actions = []
  const picked = []
  for (const p of PROFILES) {
    if (!input?.profiles?.includes(p) || !profiles?.[p]?.root) continue
    picked.push(p)
    const items = [...PACK_ITEMS, ...(input.videos ? [join('Learning', 'videos')] : [])]
    for (const item of items) {
      const from = join(profiles[p].root, item)
      if (!existsSync(from)) continue
      actions.push({ id: `pack:${p}:${item}`, group: p, label: `${PROFILE_NAMES[p]} ${item.replace(/\\/g, '/')}`, detail: from, op: { type: 'copyTree', from, to: join(dir, p, item) } })
    }
  }
  const mods = input?.mods ? keptMods(snap).filter((m) => existsSync(join(snap.modSrc, m))) : []
  for (const m of mods) {
    actions.push({ id: `pack:mod:${m}`, group: 'mods', label: `Mod ${m}`, detail: join(snap.modSrc, m), op: { type: 'copyTree', from: join(snap.modSrc, m), to: join(dir, 'mods', m) } })
  }
  const enabled = snap.installed.filter((i) => i.market === MARKETPLACE && i.enabled).map((i) => i.name)
  const options = {}
  for (const [id, cfg] of Object.entries(snap.settings.pluginConfigs || {})) {
    // Folder options are asked again on the new PC; only on/off choices travel.
    const plain = Object.fromEntries(Object.entries(cfg?.options || {}).filter(([, v]) => typeof v === 'boolean'))
    if (id.endsWith(`@${MARKETPLACE}`) && Object.keys(plain).length) options[id] = plain
  }
  const manifest = { version: PACK_VERSION, createdAt: new Date().toISOString(), toolkitCommit: snap.git?.commit || null, profiles: picked, plugins: enabled, options, mods }
  actions.push({ id: 'pack:manifest', group: 'pack', label: 'Write the pack list (manifest.json)', detail: 'Which profiles, plugins and mods are in this pack.', op: { type: 'writeJson', path: join(dir, 'manifest.json'), value: manifest } })
  const notes = [`Saved to ${dir}. This folder is never uploaded to GitHub.`, 'Files named like .env, keys and certificates are skipped. The check is by file name only, so keep passwords out of your notes.']
  if (picked.includes('work')) notes.unshift('This pack includes Work notes. Only carry it where your workplace allows.')
  return { actions, notes, name }
}

// 5 · Restore: each profile in the pack goes only into the same profile on this PC, without replacing files.
export function planRestore(snap, input, profiles) {
  const pack = snap.packs.find((p) => p.name === input?.pack) || snap.packs[0] || null
  if (!pack) return { actions: [], notes: ['No pack found in this folder, so there is nothing to restore.'] }
  if ((pack.manifest.version || 0) > PACK_VERSION) return { actions: [], notes: [`Pack ${pack.name} was made by a newer Workspace OS. Update the toolkit first.`] }
  const actions = []
  const inPack = Array.isArray(pack.manifest.profiles) ? pack.manifest.profiles : Object.keys(pack.manifest.profiles || {})
  for (const p of PROFILES) {
    if (!inPack.includes(p) || !profiles?.[p]?.on || !profiles[p].root) continue
    for (const item of [...PACK_ITEMS, join('Learning', 'videos')]) {
      const from = join(pack.dir, p, item)
      if (!existsSync(from)) continue
      actions.push({ id: `restore:${p}:${item}`, group: p, label: `${PROFILE_NAMES[p]} ${item.replace(/\\/g, '/')}`, detail: `Into ${join(profiles[p].root, item)}; files already there are kept.`, op: { type: 'copyTree', from, to: join(profiles[p].root, item), skipExisting: true } })
    }
  }
  const have = new Set(snap.installed.map((i) => i.id))
  const mods = (pack.manifest.mods || []).filter((m) => !have.has(`${m}@${MODS_MARKETPLACE}`) && existsSync(join(pack.dir, 'mods', m)))
  if (mods.length) {
    for (const m of mods) {
      actions.push({ id: `restore:mod:${m}`, group: 'mods', label: `Copy mod ${m}`, detail: `Into ${join(snap.modSrc, m)}`, op: { type: 'copyTree', from: join(pack.dir, 'mods', m), to: join(snap.modSrc, m), skipExisting: true } })
    }
    actions.push({
      id: 'restore:mods-market', group: 'mods', label: 'Add these mods to the local mods list',
      detail: `Adds ${mods.join(', ')} to ${join(snap.modSrc, '.claude-plugin', 'marketplace.json')}. Mods already listed there stay.`,
      op: { type: 'modsMarket', dir: snap.modSrc, add: mods, viaCli: !!snap.claude },
    })
    for (const m of mods) {
      const id = `${m}@${MODS_MARKETPLACE}`
      actions.push({ id: `restore:mod-install:${m}`, group: 'mods', label: `Install mod ${m}`, detail: '', op: snap.claude ? { type: 'claude', args: ['plugin', 'install', id] } : viaSettings(snap, { enabledPlugins: { [id]: true } }) })
    }
  }
  const notes = [`From the pack made ${pack.manifest.createdAt ? pack.manifest.createdAt.slice(0, 16).replace('T', ' ') : pack.name}.`]
  return { actions, notes, pack: pack.name }
}

// Update toolkit: git pull --ff-only in the toolkit folder, then refresh Claude's copy of the marketplace and plugins.
export function planUpdate(snap) {
  const g = snap.git || {}
  if (!g.repo || !g.available) return { actions: [], notes: ['This folder is not a Git copy of the toolkit, so it cannot update itself. Download the new version from GitHub instead.'] }
  const actions = [{ id: 'update:pull', group: 'update', label: 'Get the latest toolkit from GitHub', detail: 'git pull --ff-only (stops rather than overwrite local edits)', op: { type: 'git', args: ['pull', '--ff-only'] } }]
  if (snap.claude) {
    actions.push({ id: 'update:market', group: 'update', label: 'Refresh the toolkit list in Claude', detail: `claude plugin marketplace update ${MARKETPLACE}`, op: { type: 'claude', args: ['plugin', 'marketplace', 'update', MARKETPLACE] } })
    for (const i of snap.installed.filter((p) => p.market === MARKETPLACE)) {
      actions.push({ id: `update:${i.name}`, group: 'update', label: `Refresh ${i.name}`, detail: '', op: { type: 'claude', args: ['plugin', 'update', i.id] } })
    }
  }
  return { actions, notes: ['Restart Claude Desktop afterwards so it loads the new versions.'] }
}

// 6 · Check the install: is this PC set up the way the steps intended? Read-only.
function markOf(root) {
  try { return JSON.parse(readFileSync(join(root, '.claude', 'settings.local.json'), 'utf8').replace(/^\uFEFF/, ''))?.env?.WSOS_PROFILE || null } catch { return null }
}

export function verify(snap, profiles) {
  const items = []
  const add = (ok, label, detail = '') => items.push({ ok, label, detail })
  const market = snap.markets.find((m) => m.name === MARKETPLACE)
  add(!!market && samePath(market.path, snap.appDir), 'Claude installs the toolkit from this folder', market ? market.path : 'not added')
  add(planConflicts(snap).actions.every((a) => a.group !== 'conflicts'), 'No conflicting installs left')
  for (const p of snap.catalog) {
    const inst = snap.installed.find((i) => i.id === `${p.name}@${MARKETPLACE}`)
    if (!inst?.enabled) continue
    add(!inst.version || inst.version === p.version, `${p.name} is on and current`, inst.version === p.version ? inst.version : `${inst.version} in Claude, ${p.version} in the toolkit`)
  }
  for (const p of PROFILES) {
    const c = profiles?.[p]
    if (!c?.on) continue
    const name = PROFILE_NAMES[p]
    add(existsSync(c.root), `${name} folder exists`, c.root)
    add(markOf(c.root) === p, `${name} folder is marked ${name}`, join(c.root, '.claude', 'settings.local.json'))
    add(existsSync(join(c.root, 'Studio', 'library.js')), `${name} Studio is built`, join(c.root, 'Studio'))
  }
  return items
}
