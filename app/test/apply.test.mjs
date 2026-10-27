import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runOp, applyActions, mergeModsMarket } from '../lib/apply.mjs'
import { run } from '../lib/sys.mjs'

const tmp = () => mkdtempSync(join(tmpdir(), 'wsos-'))

test('mergeJson keeps everything else in the file', async () => {
  const dir = tmp()
  const file = join(dir, '.claude', 'settings.local.json')
  mkdirSync(join(dir, '.claude'))
  writeFileSync(file, JSON.stringify({ permissions: { allow: ['Bash(ls)'] }, env: { OTHER: '1' }, hooks: { Stop: [] } }))
  await runOp({ type: 'mergeJson', path: file, set: { env: { WSOS_PROFILE: 'work' } } })
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { permissions: { allow: ['Bash(ls)'] }, env: { OTHER: '1', WSOS_PROFILE: 'work' }, hooks: { Stop: [] } })
})

test('copyTree skips secret-looking files and, when restoring, keeps files already there', async () => {
  const from = tmp()
  const to = join(tmp(), 'out')
  mkdirSync(join(from, 'sub'))
  writeFileSync(join(from, 'note.md'), 'new')
  writeFileSync(join(from, '.env'), 'SECRET=1')
  writeFileSync(join(from, 'sub', 'id_rsa'), 'key')
  writeFileSync(join(from, 'sub', 'a.md'), 'a')
  const r = await runOp({ type: 'copyTree', from, to })
  assert.ok(r.ok)
  assert.ok(existsSync(join(to, 'note.md')))
  assert.ok(!existsSync(join(to, '.env')))
  assert.ok(!existsSync(join(to, 'sub', 'id_rsa')))
  writeFileSync(join(to, 'note.md'), 'mine')
  const again = await runOp({ type: 'copyTree', from, to, skipExisting: true })
  assert.match(again.note, /already there, kept/)
  assert.equal(readFileSync(join(to, 'note.md'), 'utf8'), 'mine')
})

test('mods marketplace keeps the mods already listed', () => {
  const dir = tmp()
  mkdirSync(join(dir, '.claude-plugin'))
  writeFileSync(join(dir, '.claude-plugin', 'marketplace.json'), JSON.stringify({ name: 'local-mods', owner: { name: 'me' }, plugins: [{ name: 'skins', source: './skins' }] }))
  mkdirSync(join(dir, 'filetree', '.claude-plugin'), { recursive: true })
  writeFileSync(join(dir, 'filetree', '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'filetree', description: 'tree' }))
  assert.deepEqual(mergeModsMarket(dir, ['filetree', 'skins']), ['filetree'])
  const m = JSON.parse(readFileSync(join(dir, '.claude-plugin', 'marketplace.json'), 'utf8'))
  assert.deepEqual(m.plugins.map((p) => p.name), ['skins', 'filetree'])
  assert.equal(m.owner.name, 'me')
})

test('apply runs only ticked changes and stops at the first failure', async () => {
  const dir = tmp()
  const actions = [
    { id: 'a', label: 'A', op: { type: 'mkdir', path: join(dir, 'a') } },
    { id: 'b', label: 'B', op: { type: 'copyTree', from: join(dir, 'missing'), to: join(dir, 'x') } },
    { id: 'c', label: 'C', op: { type: 'mkdir', path: join(dir, 'c') } },
    { id: 'd', label: 'D', op: { type: 'mkdir', path: join(dir, 'd') } },
  ]
  const out = await applyActions(actions, ['a', 'b', 'c'], null)
  assert.deepEqual(out.results.map((r) => [r.id, r.ok]), [['a', true], ['b', false], ['c', null]])
  assert.ok(existsSync(join(dir, 'a')))
  assert.ok(!existsSync(join(dir, 'c')))
  assert.ok(!existsSync(join(dir, 'd')))
})

test('arguments reach programs intact: spaces, & and % are not interpreted by a shell', async () => {
  const tricky = ['C:\\Program Files\\x & y', '%USERPROFILE%', 'a"b', '^&|<>']
  const r = await run(process.execPath, ['-e', 'console.log(JSON.stringify(process.argv.slice(1)))', ...tricky])
  assert.equal(r.code, 0)
  assert.deepEqual(JSON.parse(r.stdout), tricky)
})
