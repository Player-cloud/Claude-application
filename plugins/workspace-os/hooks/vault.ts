// The vault's rules that don't need the engine: which notes are private, what a
// note links to, how a search ranks, and masking secrets in what Claude is shown.
// (detect.ts is secret-shield's detector, copied unchanged.)

import { findSecrets } from './detect'

// A note whose frontmatter says `agent: none` is the person's alone: the vault
// tools neither list, search nor read it.
export function isPrivate(text: string): boolean {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  return !!m && /^agent:\s*["']?none["']?\s*$/im.test(m[1] ?? '')
}

// Obsidian links: [[Note]], [[folder/Note]], [[Note|shown text]], [[Note#heading]].
export function linksIn(text: string): string[] {
  return [...text.matchAll(/\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/g)].map(m => (m[1] ?? '').trim())
}

// A note's name as links use it: the file name without .md, any folder dropped.
export const noteName = (relPath: string) => (relPath.split('/').pop() ?? relPath).replace(/\.md$/i, '')

export function linksTo(text: string, name: string): boolean {
  const want = name.toLowerCase()
  return linksIn(text).some(link => noteName(link).toLowerCase() === want)
}

// Every word of the query must appear (in the name or the text); more hits rank higher.
export function score(relPath: string, text: string, query: string): number {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return 0
  const name = noteName(relPath).toLowerCase()
  const body = text.toLowerCase()
  let total = 0
  for (const w of words) {
    const inName = name.includes(w) ? 5 : 0
    const inBody = body.split(w).length - 1
    if (!inName && !inBody) return 0
    total += inName + Math.min(inBody, 10)
  }
  return total
}

// The line that holds the most query words, trimmed to one line of context. A heading
// only repeats the note's name, so on a tie a plain line wins.
export function excerpt(text: string, query: string): string {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  let best = ''
  let bestScore = 0
  for (const line of text.split(/\r?\n/)) {
    const lower = line.toLowerCase()
    const hits = words.filter(w => lower.includes(w)).length
    if (hits === 0) continue
    const s = hits * 2 + (line.trimStart().startsWith('#') ? 0 : 1)
    if (s > bestScore) {
      best = line
      bestScore = s
    }
  }
  const t = best.trim()
  return t.length > 160 ? `${t.slice(0, 157)}...` : t
}

// Secrets in a note are shown as {{secret}}: a note is data, and a key in it
// shouldn't reach the conversation just because Claude read the note.
export function maskSecrets(text: string): string {
  let out = text
  for (const s of findSecrets(text)) out = out.split(s.value).join('{{secret}}')
  return out
}

// A path inside the vault as the tools accept it: relative, forward slashes, no
// leading slash. Absolute paths and any .. step are refused outright.
export function cleanRelative(path: unknown): string | null {
  if (typeof path !== 'string') return null
  const p = path.trim().replace(/\\/g, '/').replace(/^\.\//, '')
  if (p === '') return ''
  if (/^[a-zA-Z]:/.test(p) || p.startsWith('/') || p.startsWith('~')) return null
  if (p.split('/').some(part => part === '..')) return null
  return p.replace(/\/+$/, '')
}

// A short fingerprint of a note's text (FNV-1a, 64 bits as two halves). It only has to
// change when the text changes, so an edit can tell the note moved on since it was read.
export function versionOf(text: string): string {
  let a = 0x811c9dc5
  let b = 0x01000193 ^ text.length
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    a = Math.imul(a ^ c, 0x01000193) >>> 0
    b = Math.imul(b ^ c, 0x5bd1e995) >>> 0
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0')
}

// A draft's file name from its title, or null for one that could name another place:
// no slashes, drive or reserved characters, not only dots, and nothing empty. (A ".." can't
// climb out without a slash, so "Ideas..later" is a fine title.)
export function draftName(title: unknown): string | null {
  if (typeof title !== 'string') return null
  const t = title.trim().replace(/\.md$/i, '').trim()
  if (!t || t.length > 120 || /[\\/:*?"<>|\x00-\x1f]/.test(t) || /^\.+$/.test(t)) return null
  return t
}

// How many times `piece` appears in `text`; an edit's old text must appear exactly once.
export function countOf(text: string, piece: string): number {
  return piece ? text.split(piece).length - 1 : 0
}

export const hasSecret = (text: string) => findSecrets(text).length > 0

// Obsidian's own settings folder is never shown.
export const isHidden = (relPath: string) => relPath.split('/').some(part => part.toLowerCase() === '.obsidian')
