import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  planConflicts, planProfiles, planPlugins, planPack, planRestore, planUpdate, verify,
  mergeRoots, pluginOptions, checkRoots, packName, keepInPack, keptMods, samePath, inside,
} from '../lib/plan.mjs'

const tmp = () => mkdtempSync(join(tmpdir(), 'wsos-'))

function snap(over = {}) {
  const appDir = over.appDir || tmp()
  return {
    appDir,
    home: over.home || tmp(),
    claude: { cmd: 'claude', pre: [], path: 'claude', version: '2.1.0' },
    settings: {},
    installed: [],
    markets: [{ name: 'my-toolkit', path: appDir }],
    userEnvProfile: null,
    machineEnvProfile: null,
    catalog: [
      { name: 'workspace-os', version: '0.3.0', description: 'profiles', options: ['personalRoots', 'workRoots', 'personalVault', 'workVault'] },
      { name: 'nudges', version: '1.6.0', description: 'nudges', options: ['workFridayUpdate'] },
      { name: 'learner', version: '2.0.0', description: 'learner', options: ['personalRoots', 'workRoots'] },
    ],
    conflicts: [{ name: 'control-panel', why: 'retired' }, { name: 'reflect-mod', why: 'global CLAUDE.md' }],
    packs: [],
    git: { repo: true, available: true, commit: 'abc1234', branch: 'main', dirty: false },
    modSrc: join(tmp(), 'mod-src'),
    ...over,
  }
}

const inst = (id, more = {}) => {
  const at = id.lastIndexOf('@')
  return { id, name: id.slice(0, at), market: id.slice(at + 1), version: '', scope: 'user', enabled: true, ...more }
}

test('conflicts: listed plugins, second copies, user env and an old toolkit folder are found', () => {
  const s = snap({
    installed: [inst('control-panel@my-toolkit'), inst('reflect-mod@local-mods'), inst('nudges@old-market'), inst('nudges@my-toolkit'), inst('filetree@local-mods')],
    markets: [{ name: 'my-toolkit', path: 'C:\\Users\\me\\Code\\my-toolkit' }],
    userEnvProfile: 'personal',
    machineEnvProfile: 'work',
  })
  const { actions, notes } = planConflicts(s)
  const ids = actions.map((a) => a.id)
  assert.deepEqual(ids, ['remove:control-panel@my-toolkit:user', 'remove:reflect-mod@local-mods:user', 'remove:nudges@old-market:user', 'remove:env-user', 'toolkit:here'])
  assert.deepEqual(actions[0].op.args, ['plugin', 'uninstall', 'control-panel@my-toolkit', '--scope', 'user'])
  assert.deepEqual(actions.at(-1).op.args, ['plugin', 'marketplace', 'add', s.appDir])
  assert.match(notes[0], /administrator/)
})

test('conflicts: the same plugin at two scopes gets two separate ticks', () => {
  const s = snap({ installed: [inst('control-panel@my-toolkit'), inst('control-panel@my-toolkit', { scope: 'project' })] })
  const ids = planConflicts(s).actions.map((a) => a.id)
  assert.deepEqual(ids, ['remove:control-panel@my-toolkit:user', 'remove:control-panel@my-toolkit:project'])
})

test('conflicts: nothing to do on a clean PC', () => {
  assert.deepEqual(planConflicts(snap({ installed: [inst('nudges@my-toolkit')] })).actions, [])
})

test('conflicts without the CLI turn plugins off and add the marketplace through settings.json', () => {
  const s = snap({ claude: null, installed: [inst('blast-radius@local-mods')], conflicts: [{ name: 'blast-radius', why: 'x' }], markets: [] })
  const [off, add] = planConflicts(s).actions
  assert.equal(off.op.type, 'mergeJson')
  assert.deepEqual(off.op.set, { enabledPlugins: { 'blast-radius@local-mods': false } })
  assert.deepEqual(add.op.set, { extraKnownMarketplaces: { 'my-toolkit': { source: { source: 'directory', path: s.appDir } } } })
  assert.equal(add.op.path, join(s.home, '.claude', 'settings.json'))
})

test('profiles: folders, Studio template and the profile mark for each picked profile only', () => {
  const s = snap()
  const root = join(tmp(), 'personal')
  const { actions } = planProfiles(s, { profiles: { personal: { on: true, root }, work: { on: false, root: join(tmp(), 'work') } } })
  const ids = actions.map((a) => a.id)
  assert.ok(ids.includes('mkdir:personal:root'))
  assert.ok(ids.includes(`mkdir:personal:${join('Vault', '_inbox')}`))
  for (const f of ['index.html', 'STUDIO.md', 'types.md', 'build-library.mjs']) assert.ok(ids.includes(`studio:personal:${f}`))
  assert.ok(ids.includes('studio:personal:build'))
  const mark = actions.find((a) => a.id === 'mark:personal')
  assert.deepEqual(mark.op.set, { env: { WSOS_PROFILE: 'personal' } })
  assert.ok(!ids.some((i) => i.includes('work')))
})

test('profiles: overlapping roots or roots inside the toolkit are refused', () => {
  const base = tmp()
  const s = snap({ appDir: join(base, 'toolkit') })
  assert.ok(planProfiles(s, { profiles: { personal: { on: true, root: base }, work: { on: true, root: join(base, 'work') } } }).blocked)
  assert.ok(planProfiles(s, { profiles: { personal: { on: true, root: join(base, 'toolkit', 'me') } } }).blocked)
  assert.deepEqual(checkRoots({ personal: { on: true, root: join(base, 'a') }, work: { on: true, root: join(base, 'b') } }, s.appDir), [])
})

test('roots: every existing root is kept, found or not; only dropped ones go', () => {
  assert.equal(mergeRoots('C:\\p', 'D:\\usb\\p;C:\\p;E:\\gone'), 'C:\\p;D:\\usb\\p;E:\\gone')
  assert.equal(mergeRoots('C:\\p', 'D:\\usb\\p;E:\\gone', ['E:\\gone']), 'C:\\p;D:\\usb\\p')
  assert.equal(mergeRoots('C:\\p', ''), 'C:\\p')
})

test('plugin options use the manifests\' keys', () => {
  const profiles = { personal: { on: true, root: '/p' }, work: { on: true, root: '/w' } }
  assert.deepEqual(pluginOptions('learner', profiles), { personalRoots: '/p', workRoots: '/w' })
  assert.deepEqual(pluginOptions('workspace-os', profiles), { personalRoots: '/p', workRoots: '/w', personalVault: join('/p', 'Vault'), workVault: join('/w', 'Vault') })
  assert.deepEqual(pluginOptions('nudges', profiles), {})
  assert.deepEqual(pluginOptions('learner', { personal: { on: true, root: '/p' }, work: { on: false, root: '/w' } }), { personalRoots: '/p' })
})

test('plugins: install new, update stale, configure changed, turn off unpicked', () => {
  const s = snap({
    installed: [inst('nudges@my-toolkit', { version: '1.5.0' }), inst('learner@my-toolkit', { version: '2.0.0' })],
    settings: { pluginConfigs: { 'learner@my-toolkit': { options: { personalRoots: '/old' } } } },
  })
  const profiles = { personal: { on: true, root: '/p' }, work: { on: false } }
  const { actions } = planPlugins(s, { plugins: ['workspace-os', 'nudges'] }, profiles)
  const byId = Object.fromEntries(actions.map((a) => [a.id, a]))
  assert.deepEqual(Object.keys(byId), ['install:workspace-os', 'update:nudges', 'disable:learner'])
  assert.deepEqual(byId['install:workspace-os'].op.args, ['plugin', 'install', 'workspace-os@my-toolkit', '--config', 'personalRoots=/p', '--config', `personalVault=${join('/p', 'Vault')}`])
  const again = planPlugins(s, { plugins: ['learner'] }, profiles).actions
  const cfg = again.find((a) => a.id === 'config:learner')
  assert.deepEqual(JSON.parse(cfg.op.stdin), { personalRoots: '/p;/old' })
})

test('plugins without the CLI are enabled and configured in settings.json', () => {
  const s = snap({ claude: null })
  const { actions, notes } = planPlugins(s, { plugins: ['learner'] }, { personal: { on: true, root: '/p' } })
  assert.equal(actions[0].op.type, 'mergeJson')
  assert.deepEqual(actions[0].op.set, { enabledPlugins: { 'learner@my-toolkit': true }, pluginConfigs: { 'learner@my-toolkit': { options: { personalRoots: '/p' } } } })
  assert.match(notes.at(-1), /next time it starts/)
  const stale = planPlugins(snap({ claude: null, installed: [inst('learner@my-toolkit', { version: '1.0.0' })] }), { plugins: ['learner'] }, {})
  assert.match(stale.notes[0], /needs Claude Code/)
})

test('pack: per-profile folders, Work only when picked, manifest with version, no colon in the name', () => {
  const root = tmp()
  for (const d of ['Preferences', 'Vault', 'Studio']) mkdirSync(join(root, d))
  const s = snap({ installed: [inst('nudges@my-toolkit'), inst('filetree@local-mods'), inst('reflect-mod@local-mods')] })
  mkdirSync(join(s.modSrc, 'filetree-src', '.claude-plugin'), { recursive: true })
  writeFileSync(join(s.modSrc, 'filetree-src', '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'filetree' }))
  const plan = planPack(s, { name: '2026-10-27_1100', profiles: ['personal'], mods: true }, { personal: { on: true, root }, work: { on: true, root: tmp() } })
  const ids = plan.actions.map((a) => a.id)
  assert.deepEqual(ids, ['pack:personal:Preferences', 'pack:personal:Vault', 'pack:personal:Studio', 'pack:mod:filetree', 'pack:manifest'])
  assert.equal(plan.actions[3].op.from, join(s.modSrc, 'filetree-src'))
  assert.equal(plan.actions[3].op.to, join(s.appDir, 'pack', '2026-10-27_1100', 'mods', 'filetree'))
  const off = planPack(s, { profiles: ['work'] }, { personal: { on: true, root }, work: { on: false, root } })
  assert.ok(!off.actions.some((a) => a.group === 'work'), 'a profile that is off is never packed')
  assert.equal(plan.actions[0].op.to, join(s.appDir, 'pack', '2026-10-27_1100', 'personal', 'Preferences'))
  const manifest = plan.actions.at(-1).op.value
  assert.equal(manifest.version, 1)
  assert.deepEqual(manifest.profiles, ['personal'])
  assert.deepEqual(manifest.mods, ['filetree'])
  assert.match(packName(new Date(2026, 9, 27, 9, 5, 7)), /^2026-10-27_090507$/)
  assert.ok(!plan.notes.some((n) => /Work notes/.test(n)))
  const withWork = planPack(s, { profiles: ['personal', 'work'] }, { personal: { on: true, root }, work: { on: true, root: tmp() } })
  assert.match(withWork.notes[0], /Work notes/)
})

test('kept mods leave out the conflict list', () => {
  assert.deepEqual(keptMods(snap({ installed: [inst('filetree@local-mods'), inst('reflect-mod@local-mods'), inst('nudges@my-toolkit')] })), ['filetree'])
})

test('restore: a pack profile goes only to the same profile; mods are added, not replaced', () => {
  const s = snap()
  const dir = join(s.appDir, 'pack', 'p1')
  mkdirSync(join(dir, 'personal', 'Studio'), { recursive: true })
  mkdirSync(join(dir, 'work', 'Vault'), { recursive: true })
  mkdirSync(join(dir, 'mods', 'filetree'), { recursive: true })
  s.installed = [inst('nudges@my-toolkit')]
  s.settings = { pluginConfigs: { 'nudges@my-toolkit': { options: { workFridayUpdate: true } } } }
  s.packs = [{ name: 'p1', dir, manifest: { version: 1, profiles: ['personal', 'work'], mods: ['filetree'], options: { 'nudges@my-toolkit': { workFridayUpdate: false }, 'learner@my-toolkit': { x: true } } } }]
  const r = planRestore(s, { pack: 'p1' }, { personal: { on: true, root: '/p' }, work: { on: false } })
  const ids = r.actions.map((a) => a.id)
  assert.deepEqual(ids, ['restore:personal:Studio', 'restore:mod:filetree', 'restore:mods-market', 'restore:mod-install:filetree', 'restore:options:nudges@my-toolkit'])
  assert.deepEqual(JSON.parse(r.actions[4].op.stdin), { workFridayUpdate: false })
  assert.equal(r.actions[0].op.to, join('/p', 'Studio'))
  assert.equal(r.actions[0].op.skipExisting, true)
  assert.deepEqual(r.actions[2].op.add, ['filetree'])
  s.packs[0].manifest.version = 9
  assert.equal(planRestore(s, { pack: 'p1' }, {}).actions.length, 0)
})

test('update is one pull plus refreshes', () => {
  const s = snap({ installed: [inst('nudges@my-toolkit')] })
  const ids = planUpdate(s).actions.map((a) => a.id)
  assert.deepEqual(ids, ['update:pull', 'update:market', 'update:nudges'])
  assert.deepEqual(planUpdate(s).actions[0].op.args, ['pull', '--ff-only'])
  assert.equal(planUpdate(snap({ git: { repo: false } })).actions.length, 0)
  const dirty = planUpdate(snap({ git: { repo: true, available: true, dirty: true } }))
  assert.equal(dirty.actions.length, 0)
  assert.match(dirty.notes[0], /local edits/)
  assert.match(planUpdate(snap({ claude: null })).notes.at(-1), /need Claude Code/)
})

test('install check reports marks, Studio and versions', () => {
  const root = tmp()
  mkdirSync(join(root, '.claude'))
  writeFileSync(join(root, '.claude', 'settings.local.json'), JSON.stringify({ env: { WSOS_PROFILE: 'personal' }, permissions: {} }))
  const s = snap({ installed: [inst('nudges@my-toolkit', { version: '1.5.0' })] })
  const items = verify(s, { personal: { on: true, root } })
  const get = (label) => items.find((i) => i.label === label)
  assert.equal(get('Claude installs the toolkit from this folder').ok, true)
  assert.equal(get('nudges is on and current').ok, false)
  assert.equal(get('Personal folder is marked Personal').ok, true)
  assert.equal(get('Personal Studio is built').ok, false)
})

test('secret-looking names never go in a pack', () => {
  for (const n of ['.env', '.env.local', '.envrc', '.env-prod', '.env_backup', 'id_rsa', 'id_ed25519.pub', 'cert.pem', 'my.key', 'node_modules', '.git']) assert.equal(keepInPack(n), false, n)
  for (const n of ['design.md', 'notes.txt', 'environment.md', 'keyboard.md']) assert.equal(keepInPack(n), true, n)
})

test('path helpers compare Windows paths loosely', () => {
  assert.ok(samePath('C:\\A\\b\\', 'c:/a/B'))
  assert.ok(inside('C:\\a\\b\\c', 'C:\\a\\b'))
  assert.ok(!inside('C:\\a\\bc', 'C:\\a\\b'))
})
