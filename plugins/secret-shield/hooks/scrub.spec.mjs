// Tests for the scrubber itself, run in a throwaway home folder so the real
// ~/.claude is never read or written. claude plugin test doesn't run these
// (they start real processes); run them with:
//   node --test plugins/secret-shield/hooks/scrub.spec.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT = fileURLToPath(new URL('./scrub.mjs', import.meta.url))
const SECRET = 'postgresql://admin:Fake-Pw-98765@db.example.com/app'
const line = text => JSON.stringify({ type: 'user', cwd: 'C:\\Users\\Tester\\app', message: { content: text } })

// A fake home with one finished transcript and one still being written, both holding the secret.
function fakeHome() {
  const home = mkdtempSync(join(tmpdir(), 'shield-'))
  const project = join(home, '.claude', 'projects', 'C--Users-Tester-app')
  mkdirSync(project, { recursive: true })
  const old = join(project, 'old-session.jsonl')
  const busy = join(project, 'busy-session.jsonl')
  writeFileSync(old, line(`use ${SECRET} for the db`) + '\n')
  writeFileSync(busy, line(`use ${SECRET} for the db`) + '\n')
  const hourAgo = new Date(Date.now() - 60 * 60_000)
  utimesSync(old, hourAgo, hourAgo)
  return { home, old, busy, backups: join(home, '.claude', 'secret-shield', 'backups') }
}

function scrub(home, ...args) {
  const out = execFileSync(process.execPath, ['--no-warnings', '--experimental-strip-types', SCRIPT, ...args], {
    env: { ...process.env, USERPROFILE: home, HOME: home },
    encoding: 'utf8',
  })
  return JSON.parse(out.trim().split('\n').pop())
}

const bakFiles = dir => (existsSync(dir) ? readdirSync(dir, { recursive: true }).filter(f => String(f).endsWith('.bak')) : [])

test('by default it rewrites in place and leaves no unredacted copy', () => {
  const f = fakeHome()
  try {
    const s = scrub(f.home)
    assert.ok(s.replacements > 0)
    assert.ok(!readFileSync(f.old, 'utf8').includes('Fake-Pw-98765'))
    assert.ok(readFileSync(f.old, 'utf8').includes('{{secret:'))
    assert.deepEqual(bakFiles(f.backups), [])
  } finally {
    rmSync(f.home, { recursive: true, force: true })
  }
})

test('a transcript changed in the last 10 minutes is left alone', () => {
  const f = fakeHome()
  try {
    const s = scrub(f.home)
    assert.equal(s.skippedBusy, 1)
    assert.ok(readFileSync(f.busy, 'utf8').includes('Fake-Pw-98765'))
  } finally {
    rmSync(f.home, { recursive: true, force: true })
  }
})

test('--keep-backups saves the original, and --prune-backups deletes it', () => {
  const f = fakeHome()
  try {
    scrub(f.home, '--keep-backups')
    const baks = bakFiles(f.backups)
    assert.equal(baks.length, 1)
    assert.ok(readFileSync(join(f.backups, String(baks[0])), 'utf8').includes('Fake-Pw-98765'))
    const p = scrub(f.home, '--prune-backups')
    assert.equal(p.prunedFiles, 1)
    assert.deepEqual(bakFiles(f.backups), [])
  } finally {
    rmSync(f.home, { recursive: true, force: true })
  }
})

test('--dry-run changes nothing', () => {
  const f = fakeHome()
  try {
    const before = readFileSync(f.old, 'utf8')
    const s = scrub(f.home, '--dry-run')
    assert.ok(s.replacements > 0)
    assert.equal(readFileSync(f.old, 'utf8'), before)
    assert.ok(!existsSync(join(f.home, '.claude', 'secret-shield')))
  } finally {
    rmSync(f.home, { recursive: true, force: true })
  }
})
