// Runs the actions a person ticked. Each op type is a small, fixed operation; nothing here runs a shell.

import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, sep } from 'node:path'
import { appDir, claude, claudeDir, readJson, run } from './sys.mjs'
import { keepInPack } from './plan.mjs'
import { MODS_MARKETPLACE } from './state.mjs'

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 23)
}

// Copies ~/.claude/settings.json aside once before a batch of changes.
export function backupSettings() {
  const file = join(claudeDir(), 'settings.json')
  if (!existsSync(file)) return null
  const to = `${file}.bak-wsos-${stamp()}`
  copyFileSync(file, to)
  return to
}

export function deepMerge(base, patch) {
  const out = { ...(base && typeof base === 'object' && !Array.isArray(base) ? base : {}) }
  for (const [k, v] of Object.entries(patch)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) ? deepMerge(out[k], v) : v
  }
  return out
}

function copyTree(from, to, skipExisting) {
  let copied = 0
  let kept = 0
  const skipped = []
  const walk = (src, dst) => {
    mkdirSync(dst, { recursive: true })
    for (const entry of readdirSync(src, { withFileTypes: true })) {
      const s = join(src, entry.name)
      const d = join(dst, entry.name)
      if (!keepInPack(entry.name)) {
        skipped.push(s)
        continue
      }
      if (entry.isDirectory()) walk(s, d)
      else if (entry.isFile()) {
        if (skipExisting && existsSync(d)) kept++
        else { copyFileSync(s, d); copied++ }
      }
    }
  }
  walk(from, to)
  return { copied, kept, skipped }
}

// Adds mods to the local mods marketplace.json. Entries already listed stay as they are.
export function mergeModsMarket(dir, add) {
  const file = join(dir, '.claude-plugin', 'marketplace.json')
  const old = readJson(file, null) || { name: MODS_MARKETPLACE, owner: { name: 'local' }, plugins: [] }
  const plugins = [...(old.plugins || [])]
  const added = []
  for (const name of add) {
    if (plugins.some((p) => p.name === name)) continue
    const m = readJson(join(dir, name, '.claude-plugin', 'plugin.json'), {})
    plugins.push({ name: m.name || name, source: `./${name}`, description: m.description || '' })
    added.push(name)
  }
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify({ ...old, name: old.name || MODS_MARKETPLACE, plugins }, null, 2) + '\n')
  return added
}

export async function runOp(op, tool) {
  switch (op.type) {
    case 'mkdir':
      mkdirSync(op.path, { recursive: true })
      return { ok: true }
    case 'copyFile':
      mkdirSync(dirname(op.to), { recursive: true })
      if (existsSync(op.to)) return { ok: true, note: 'Already there, left as it is.' }
      copyFileSync(op.from, op.to)
      return { ok: true }
    case 'copyTree': {
      if (!existsSync(op.from)) return { ok: false, note: `${op.from} is missing.` }
      const r = copyTree(op.from, op.to, op.skipExisting)
      const parts = [`${r.copied} file${r.copied === 1 ? '' : 's'} copied`]
      if (r.kept) parts.push(`${r.kept} already there, kept`)
      if (r.skipped.length) parts.push(`skipped ${r.skipped.map((s) => basename(s)).join(', ')}`)
      return { ok: true, note: parts.join('; ') }
    }
    case 'mergeJson': {
      const current = readJson(op.path, {}) || {}
      mkdirSync(dirname(op.path), { recursive: true })
      writeFileSync(op.path, JSON.stringify(deepMerge(current, op.set), null, 2) + '\n')
      return { ok: true, note: op.note }
    }
    case 'writeJson':
      mkdirSync(dirname(op.path), { recursive: true })
      writeFileSync(op.path, JSON.stringify(op.value, null, 2) + '\n')
      return { ok: true }
    case 'node': {
      const r = await run(process.execPath, [op.script, ...(op.args || [])], { cwd: op.cwd, timeout: 120000 })
      return { ok: r.code === 0, note: (r.code === 0 ? r.stdout : r.stderr || r.stdout).trim().slice(-500) }
    }
    case 'git': {
      const r = await run('git', op.args, { cwd: appDir, timeout: 300000 })
      return { ok: r.code === 0, note: (r.stdout + r.stderr).trim().slice(-800) }
    }
    case 'claude': {
      const r = await claude(tool, op.args, { input: op.stdin, timeout: 300000 })
      return { ok: r.code === 0, note: (r.code === 0 ? r.stdout : r.stderr || r.stdout).trim().slice(-800) }
    }
    case 'regDelete': {
      const r = await run('reg', ['delete', 'HKCU\\Environment', '/v', op.name, '/f'], { timeout: 20000 })
      return { ok: r.code === 0, note: r.code === 0 ? 'Open programs keep the old value until they restart.' : (r.stderr || r.stdout).trim() }
    }
    case 'modsMarket': {
      const added = mergeModsMarket(op.dir, op.add || [])
      const note = added.length ? `Added ${added.join(', ')}` : 'Already listed.'
      if (!op.viaCli) {
        const file = join(claudeDir(), 'settings.json')
        const current = readJson(file, {}) || {}
        writeFileSync(file, JSON.stringify(deepMerge(current, { extraKnownMarketplaces: { [MODS_MARKETPLACE]: { source: { source: 'directory', path: op.dir } } } }), null, 2) + '\n')
        return { ok: true, note }
      }
      const r = await claude(tool, ['plugin', 'marketplace', 'add', op.dir], { timeout: 120000 })
      return { ok: r.code === 0, note: r.code === 0 ? note : (r.stderr || r.stdout).trim() }
    }
    default:
      return { ok: false, note: `Unknown change type ${op.type}` }
  }
}

// Runs the picked actions in order. Stops at the first failure so later steps don't build on a broken one.
export async function applyActions(actions, ids, tool) {
  const picked = actions.filter((a) => ids.includes(a.id))
  const results = []
  const touchesClaude = picked.some((a) => ['claude', 'regDelete', 'modsMarket'].includes(a.op.type) || (a.op.type === 'mergeJson' && a.op.path.endsWith(`.claude${sep}settings.json`)))
  const backup = touchesClaude ? backupSettings() : null
  for (const a of picked) {
    let r
    try {
      r = await runOp(a.op, tool)
    } catch (e) {
      r = { ok: false, note: String(e.message || e) }
    }
    results.push({ id: a.id, label: a.label, ...r })
    if (!r.ok) break
  }
  const notRun = picked.slice(results.length).map((a) => ({ id: a.id, label: a.label, ok: null, note: 'Not run because an earlier change failed.' }))
  return { backup, results: [...results, ...notRun] }
}
