// learner collector: gathers what the person typed to Claude in sessions that
// ran inside the given folders, and those projects' memory notes, as one JSON
// object on stdout. Run by the learner mod (transcripts can exceed what a mod
// may read). Every transcript line records the folder its session ran in, so a
// session outside the folders (the other profile, say) is never read.
//
// Usage: node collect.mjs --roots "C:/code/personal;D:/notes" [--days 60] [--max 400]

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join, basename } from 'node:path'
import { homedir } from 'node:os'

const args = process.argv.slice(2)
const opt = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 ? Number(args[i + 1]) : fallback
}
const days = opt('--days', 60)
const max = opt('--max', 400)
const since = Date.now() - days * 86_400_000

// Windows paths are case-insensitive and take either slash: compare one form.
const norm = p => String(p).trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
const rootsAt = args.indexOf('--roots')
const roots = (rootsAt >= 0 ? String(args[rootsAt + 1] ?? '') : '').split(';').map(norm).filter(Boolean)
if (roots.length === 0) {
  process.stderr.write('no folders to scan: pass --roots\n')
  process.exit(2)
}
const inRoots = cwd => {
  const p = norm(cwd)
  return roots.some(r => p === r || p.startsWith(`${r}/`))
}

const CLAUDE = join(homedir(), '.claude')
const PROJECTS = join(CLAUDE, 'projects')

// Messages that carry no request: approvals, engine notices, skill bodies.
const NOISE = /^(yes|yeah|ok(ay)?|sure|go ahead|continue|thanks?|thank you|do it|it works now)\b[.! ]*$/i
const ENGINE = /^(<|Base directory for this skill|Your response above was stopped|\[Request interrupted|This session is being continued|Caveat:)/

const projectName = dir =>
  /scratch-workspaces/.test(dir) ? 'scratch' : basename(dir).replace(/^C--Users-[^-]+-/, '').replace(/^Downloads-/, '').replace(/-/g, ' ').trim() || 'home'

function walk(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name !== 'subagents') walk(p, out)
    } else if (e.name.endsWith('.jsonl')) out.push(p)
  }
  return out
}

function typed(o) {
  if (o.type !== 'user') return null
  const c = o.message?.content
  if (typeof c === 'string') return c
  if (Array.isArray(c)) {
    const t = c.filter(p => p?.type === 'text').map(p => p.text).join(' ')
    return t || null
  }
  return null
}

const messages = []
const seen = new Set()
// Project folders with at least one session inside the roots; only their memory is read.
const inScope = new Set()
for (const dir of existsSync(PROJECTS) ? readdirSync(PROJECTS) : []) {
  const project = projectName(dir)
  for (const file of walk(join(PROJECTS, dir))) {
    if (statSync(file).mtimeMs < since) continue
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      let o
      try {
        o = JSON.parse(line)
      } catch {
        continue
      }
      if (!o.cwd || !inRoots(o.cwd)) continue
      inScope.add(dir)
      const text = typed(o)
      if (!text) continue
      const at = Date.parse(o.timestamp ?? '')
      if (!(at >= since)) continue
      const clean = text.replace(/<pasted_content[^>]*>[\s\S]*?<\/pasted_content[^>]*>/g, '[pasted text]').replace(/\s+/g, ' ').trim()
      if (!clean || NOISE.test(clean) || ENGINE.test(clean)) continue
      const key = clean.slice(0, 120).toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      messages.push({ project, date: new Date(at).toISOString().slice(0, 10), text: clean.slice(0, 240) })
    }
  }
}
messages.sort((a, b) => a.date.localeCompare(b.date))

const memory = []
for (const dir of inScope) {
  const mem = join(PROJECTS, dir, 'memory')
  if (!existsSync(mem)) continue
  for (const f of readdirSync(mem)) {
    if (!f.endsWith('.md') || f === 'MEMORY.md') continue
    memory.push({ project: projectName(dir), file: f, text: readFileSync(join(mem, f), 'utf8').slice(0, 40_000) })
  }
}

process.stdout.write(JSON.stringify({ messages: messages.slice(-max), memory }))
