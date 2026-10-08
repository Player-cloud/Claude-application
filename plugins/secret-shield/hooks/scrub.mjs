// secret-shield scrubber: replaces secrets in Claude Code transcripts and
// memory files with {{secret:NAME}} placeholders.
//
// 1. Loads every vault in ~/.claude/secret-shield/*.env.
// 2. Reads what the person typed in each transcript (their messages and the
//    queue records written before any mod runs) and detects secrets there,
//    adding new ones to that project's vault.
// 3. Replaces every known value, wherever it appears in the file, with its
//    placeholder. A backup of each changed file goes to
//    ~/.claude/secret-shield/backups/ first.
//
// Files touched in the last --min-age minutes (default 10) are skipped: a
// running session is still writing them. --exclude <sessionId> skips one
// session outright. --dry-run reports without writing.
//
// Usage: node --no-warnings --experimental-strip-types scrub.mjs [--dry-run] [--min-age N] [--exclude ID]

import { readFileSync, writeFileSync, renameSync, mkdirSync, readdirSync, statSync, existsSync, copyFileSync } from 'node:fs'
import { join, dirname, relative, basename } from 'node:path'
import { homedir } from 'node:os'
import { findSecrets, parseEnv, envLine, assignNames } from './detect.ts'

const args = process.argv.slice(2)
const flag = name => args.includes(name)
const option = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback
}
const dryRun = flag('--dry-run')
const minAgeMs = Number(option('--min-age', '10')) * 60_000
const exclude = option('--exclude', '')

const HOME = homedir()
const CLAUDE = join(HOME, '.claude')
const VAULT_DIR = join(CLAUDE, 'secret-shield')
const BACKUP_DIR = join(VAULT_DIR, 'backups')
const MIN_SCRUB_LENGTH = 6

const slugFor = root => root.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
const vaultFile = root => join(VAULT_DIR, `${slugFor(root)}.env`)

function walk(dir, test, out = []) {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) walk(path, test, out)
    else if (test(entry.name)) out.push(path)
  }
  return out
}

// value -> name, across every vault
const known = new Map()
const loadVaults = () => {
  for (const file of walk(VAULT_DIR, n => n.endsWith('.env'))) {
    if (file.startsWith(BACKUP_DIR)) continue
    for (const [name, value] of parseEnv(readFileSync(file, 'utf8'))) {
      if (!known.has(value)) known.set(value, name)
    }
  }
}

function addToVault(root, found) {
  const path = vaultFile(root)
  const existing = existsSync(path) ? parseEnv(readFileSync(path, 'utf8')) : new Map()
  const named = assignNames(found, existing)
  const fresh = named.filter(n => n.isNew)
  if (fresh.length && !dryRun) {
    mkdirSync(VAULT_DIR, { recursive: true })
    const current = existsSync(path) ? readFileSync(path, 'utf8') : '# secret-shield vault: values hidden from Claude chats\n'
    const body = current.endsWith('\n') ? current : `${current}\n`
    writeFileSync(path, body + fresh.map(n => envLine(n.name, n.value)).join('\n') + '\n')
  }
  for (const n of named) if (!known.has(n.value)) known.set(n.value, n.name)
  return fresh.length
}

function typedTexts(line) {
  let o
  try {
    o = JSON.parse(line)
  } catch {
    return []
  }
  if (o.type === 'queue-operation' && typeof o.content === 'string') return [o.content]
  if (o.type !== 'user') return []
  const c = o.message?.content
  if (typeof c === 'string') return [c]
  if (Array.isArray(c)) return c.filter(p => p?.type === 'text' && typeof p.text === 'string').map(p => p.text)
  return []
}

const cwdOf = text => {
  const m = /"cwd":"((?:[^"\\]|\\.)*)"/.exec(text)
  return m ? JSON.parse(`"${m[1]}"`) : null
}

// Every spelling a value can take inside a JSON line or a markdown file.
function spellings(value) {
  const once = JSON.stringify(value).slice(1, -1)
  const twice = JSON.stringify(once).slice(1, -1)
  return [...new Set([twice, once, value])].sort((a, b) => b.length - a.length)
}

function scrubText(text) {
  let out = text
  let hits = 0
  const values = [...known.keys()].filter(v => v.length >= MIN_SCRUB_LENGTH).sort((a, b) => b.length - a.length)
  for (const value of values) {
    const placeholder = `{{secret:${known.get(value)}}}`
    for (const form of spellings(value)) {
      const parts = out.split(form)
      if (parts.length > 1) {
        hits += parts.length - 1
        out = parts.join(placeholder)
      }
    }
  }
  return { out, hits }
}

function writeScrubbed(file, text) {
  const backup = join(BACKUP_DIR, relative(HOME, file).replace(/[\\/:]+/g, '__') + '.bak')
  mkdirSync(dirname(backup), { recursive: true })
  copyFileSync(file, backup)
  const temp = `${file}.secret-shield.tmp`
  writeFileSync(temp, text)
  renameSync(temp, file)
}

loadVaults()
const now = Date.now()
let detected = 0
let skippedBusy = 0
let total = 0
const report = []

// Replacing a URL can uncover a password that stood beside it, so repeat
// until a pass finds nothing new (at most 4 passes).
for (let round = 0; round < 4; round++) {
const before = detected
skippedBusy = 0
const transcripts = walk(join(CLAUDE, 'projects'), n => n.endsWith('.jsonl'))
const roots = new Set()

// Pass 1: detect secrets in what the person typed.
const eligible = []
for (const file of transcripts) {
  if (exclude && basename(file).startsWith(exclude)) continue
  if (now - statSync(file).mtimeMs < minAgeMs) {
    skippedBusy++
    continue
  }
  eligible.push(file)
  const text = readFileSync(file, 'utf8')
  const root = cwdOf(text)
  if (root) roots.add(root)
  const found = []
  for (const line of text.split('\n')) for (const typed of typedTexts(line)) found.push(...findSecrets(typed))
  const fresh = found.filter(f => !known.has(f.value) && f.value.length >= MIN_SCRUB_LENGTH)
  if (fresh.length && root) detected += addToVault(root, fresh)
}

// Pass 2: scrub transcripts, memory files and remember logs.
const memoryFiles = walk(join(CLAUDE, 'projects'), n => n.endsWith('.md'))
const rememberFiles = [join(CLAUDE, '.remember'), ...[...roots].map(r => join(r, '.remember'))].flatMap(d =>
  walk(d, n => n.endsWith('.md') || n.endsWith('.json') || n.endsWith('.jsonl')),
)
const targets = [...eligible, ...memoryFiles, ...rememberFiles].filter(f => now - statSync(f).mtimeMs >= minAgeMs)

for (const file of new Set(targets)) {
  const { out, hits } = scrubText(readFileSync(file, 'utf8'))
  if (hits === 0) continue
  total += hits
  report.push(`${hits} in ${relative(HOME, file)}`)
  if (!dryRun) writeScrubbed(file, out)
}

if (detected === before) break
}

const summary = {
  dryRun,
  knownSecrets: known.size,
  newlyDetected: detected,
  replacements: total,
  filesChanged: report.length,
  skippedBusy,
  files: report,
}
console.log(JSON.stringify(summary))
