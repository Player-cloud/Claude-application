// Tests for the collector itself, run in a throwaway home folder so the real
// ~/.claude is never read. claude plugin test doesn't run these (they start
// real processes); run them with:
//   node --test plugins/learner/hooks/collect.spec.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT = fileURLToPath(new URL('./collect.mjs', import.meta.url))
const now = new Date().toISOString()
const line = (cwd, text) => JSON.stringify({ type: 'user', cwd, timestamp: now, message: { content: text } })

// A fake home with a Personal project, a Work project and a session with no recorded folder.
function fakeHome() {
  const home = mkdtempSync(join(tmpdir(), 'learner-'))
  const add = (dir, lines, memory) => {
    const project = join(home, '.claude', 'projects', dir)
    mkdirSync(join(project, 'memory'), { recursive: true })
    writeFileSync(join(project, 'session.jsonl'), lines.join('\n') + '\n')
    writeFileSync(join(project, 'memory', 'notes.md'), memory)
  }
  add('C--Users-me-Code-personal-app', [line('C:\\Users\\me\\Code\\personal\\app', 'write the personal recipe page')], 'personal gotcha')
  add('C--Users-me-Code-work-crm', [line('C:/Users/me/Code/work/crm', 'draft the client report')], 'work secret plan')
  add('C--Users-me-Code-personalised', [line('C:/Users/me/Code/personalised', 'look-alike folder request')], 'look-alike note')
  add('C--Users-me-old', [JSON.stringify({ type: 'user', timestamp: now, message: { content: 'no folder recorded' } })], 'old note')
  return home
}

const collect = (home, ...args) =>
  JSON.parse(execFileSync(process.execPath, [SCRIPT, ...args], { env: { ...process.env, USERPROFILE: home, HOME: home }, encoding: 'utf8' }))

test('only sessions inside the given folders are read, with their memory', () => {
  const out = collect(fakeHome(), '--roots', 'c:/users/ME/code/Personal')
  assert.deepEqual(out.messages.map(m => m.text), ['write the personal recipe page'])
  assert.deepEqual(out.memory.map(m => m.text), ['personal gotcha'])
  const all = JSON.stringify(out)
  for (const text of ['client report', 'work secret plan', 'look-alike', 'no folder recorded', 'old note']) assert.ok(!all.includes(text), text)
})

test('several folders separated by ;', () => {
  const out = collect(fakeHome(), '--roots', 'C:\\Users\\me\\Code\\personal; C:/Users/me/Code/work/')
  assert.deepEqual(out.messages.map(m => m.text).sort(), ['draft the client report', 'write the personal recipe page'])
})

test('without --roots nothing is read', () => {
  const home = fakeHome()
  const run = spawnSync(process.execPath, [SCRIPT], { env: { ...process.env, USERPROFILE: home, HOME: home }, encoding: 'utf8' })
  assert.equal(run.status, 2)
  assert.equal(run.stdout, '')
})

test('the global CLAUDE.md is not read', () => {
  const home = fakeHome()
  writeFileSync(join(home, '.claude', 'CLAUDE.md'), 'global lesson text')
  const out = collect(home, '--roots', 'C:/Users/me/Code/personal')
  assert.ok(!JSON.stringify(out).includes('global lesson text'))
})
