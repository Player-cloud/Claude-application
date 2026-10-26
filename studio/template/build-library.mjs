#!/usr/bin/env node
// Rebuilds library.js from types.md and items/*/item.md so the viewer can show the library.
// Usage: node build-library.mjs [studio-folder]   (defaults to the folder this file is in)
// No dependencies; reads and writes only inside the Studio folder.

import { readFileSync, readdirSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'avif']
const SECTIONS = { 'your note': 'note', observed: 'observed', inferred: 'inferred', 'your reaction': 'reaction' }
const STATUSES = ['new', 'sorted', 'not-inspected']

export function parseTypes(text) {
  const types = []
  let current = null
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.startsWith('## ')) {
      current = { id: '', name: line.slice(3).trim(), definition: '', traits: [] }
      types.push(current)
    } else if (!current || line === '' || line.startsWith('<!--')) {
      continue
    } else if (/^id:/i.test(line)) {
      current.id = line.slice(3).trim()
    } else if (/^[-*] /.test(line)) {
      current.traits.push(line.slice(2).trim())
    } else {
      current.definition = current.definition ? `${current.definition} ${line}` : line
    }
  }
  for (const t of types) if (!t.id) t.id = slug(t.name)
  return types.filter(t => t.id !== 'unsorted')
}

export function parseItem(text) {
  const meta = {}
  const sections = { note: '', observed: '', inferred: '', reaction: '' }
  let body = text
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (fm) {
    body = text.slice(fm[0].length)
    for (const line of fm[1].split(/\r?\n/)) {
      const m = line.match(/^([A-Za-z_]+):\s*(.*)$/)
      if (!m) continue
      let value = m[2].replace(/\s+#.*$/, '').trim()
      if (m[1] === 'tags') {
        value = value.replace(/^\[|\]$/g, '').split(',').map(s => s.trim()).filter(Boolean)
      }
      meta[m[1]] = value
    }
  }
  let key = null
  const buf = {}
  for (const line of body.split(/\r?\n/)) {
    const h = line.match(/^##\s+(.*)$/)
    if (h) {
      key = SECTIONS[h[1].trim().toLowerCase()] ?? null
      if (key) buf[key] = []
      continue
    }
    if (key) buf[key].push(line)
  }
  for (const k of Object.keys(buf)) sections[k] = buf[k].join('\n').trim()
  return { meta, sections }
}

export function buildLibrary(dir, now = new Date()) {
  const warnings = []
  const typesPath = join(dir, 'types.md')
  const types = existsSync(typesPath) ? parseTypes(readFileSync(typesPath, 'utf8')) : []
  if (!types.length) warnings.push('types.md has no types')
  const typeIds = new Set(types.map(t => t.id))

  const items = []
  const itemsDir = join(dir, 'items')
  const folders = existsSync(itemsDir)
    ? readdirSync(itemsDir).filter(f => statSync(join(itemsDir, f)).isDirectory()).sort()
    : []
  for (const folder of folders) {
    const mdPath = join(itemsDir, folder, 'item.md')
    if (!existsSync(mdPath)) {
      warnings.push(`items/${folder} has no item.md, skipped`)
      continue
    }
    const { meta, sections } = parseItem(readFileSync(mdPath, 'utf8'))
    let type = meta.type || 'unsorted'
    if (type !== 'unsorted' && !typeIds.has(type)) {
      warnings.push(`items/${folder}: type "${type}" is not in types.md, shown as Unsorted`)
      type = 'unsorted'
    }
    const files = readdirSync(join(itemsDir, folder))
    const image = files.find(f => /^image\./i.test(f) && IMAGE_EXTS.includes(f.split('.').pop().toLowerCase()))
    if (meta.id && meta.id !== folder) warnings.push(`items/${folder}: id "${meta.id}" differs from folder name`)
    items.push({
      id: folder,
      title: meta.title || folder,
      type,
      tags: Array.isArray(meta.tags) ? meta.tags : [],
      source: meta.source || '',
      link: meta.link || '',
      status: STATUSES.includes(meta.status) ? meta.status : 'sorted',
      added: meta.added || '',
      image: image ? `items/${folder}/${image}` : null,
      sections
    })
  }

  return { library: { version: 1, written: now.toISOString(), types, items }, warnings }
}

// JSON inside a script file: escape "<" so "</script>" and "<!--" can't appear,
// and the two line separators that older engines treat as line breaks.
export function toScript(library) {
  const json = JSON.stringify(library, null, 2)
    .replace(/</g, '\\u003c')
    .replaceAll(String.fromCharCode(0x2028), '\\u2028')
    .replaceAll(String.fromCharCode(0x2029), '\\u2029')
  return `// Written by build-library.mjs. Don't edit by hand; edit items/*/item.md and rebuild.\nwindow.STUDIO = ${json};\n`
}

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

const here = dirname(fileURLToPath(import.meta.url))
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dir = process.argv[2] || here
  const { library, warnings } = buildLibrary(dir)
  writeFileSync(join(dir, 'library.js'), toScript(library))
  const counts = library.types.map(t => `${t.name} ${library.items.filter(i => i.type === t.id).length}`)
  const unsorted = library.items.filter(i => i.type === 'unsorted').length
  console.log(`library.js written: ${library.items.length} items (${counts.join(', ')}, Unsorted ${unsorted})`)
  for (const w of warnings) console.log(`warning: ${w}`)
}
