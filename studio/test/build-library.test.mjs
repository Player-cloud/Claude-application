import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import vm from 'node:vm'
import { parseTypes, parseItem, buildLibrary, toScript } from '../template/build-library.mjs'
import { assemble } from '../tools/assemble.mjs'

function load(script) {
  const sandbox = { window: {} }
  vm.runInNewContext(script, sandbox)
  return sandbox.window.STUDIO
}

test('types.md template parses into the three starting types', () => {
  const types = parseTypes(readFileSync(new URL('../template/types.md', import.meta.url), 'utf8'))
  assert.deepEqual(types.map(t => t.id), ['bold-and-loud', 'dark-and-glowing', 'calm-and-structured'])
  for (const t of types) {
    assert.ok(t.definition.length > 20, `${t.id} has a definition`)
    assert.ok(t.traits.length >= 3, `${t.id} has traits`)
  }
})

test('item.md parses header fields and the four sections', () => {
  const { meta, sections } = parseItem([
    '---', 'id: x', 'title: X', 'type: bold-and-loud', 'tags: [food, landing page]',
    'status: sorted          # new | sorted | not-inspected', '---', '',
    '## Your note', 'note text', '', '## Observed', 'seen', '## Inferred', 'guess',
    '## Your reaction', '- 2026-10-27: "brave"'
  ].join('\r\n'))
  assert.equal(meta.title, 'X')
  assert.deepEqual(meta.tags, ['food', 'landing page'])
  assert.equal(meta.status, 'sorted')
  assert.deepEqual(sections, { note: 'note text', observed: 'seen', inferred: 'guess', reaction: '- 2026-10-27: "brave"' })
})

test('the sample library builds with every item grouped and no warnings', () => {
  const dir = mkdtempSync(join(tmpdir(), 'studio-'))
  const { library, warnings } = assemble(dir)
  assert.deepEqual(warnings, [])
  assert.equal(library.items.length, 6)
  const byType = id => library.items.filter(i => i.type === id).length
  assert.equal(byType('bold-and-loud'), 2)
  assert.equal(byType('dark-and-glowing'), 2)
  assert.equal(byType('calm-and-structured'), 1)
  assert.equal(byType('unsorted'), 1)
  const link = library.items.find(i => i.status === 'not-inspected')
  assert.equal(link.image, null)
  assert.ok(library.items.filter(i => i.image).every(i => i.image.startsWith(`items/${i.id}/image.`)))
  assert.deepEqual(load(readFileSync(join(dir, 'library.js'), 'utf8')).items.length, 6)
})

test('an unknown type falls back to Unsorted with a warning', () => {
  const dir = mkdtempSync(join(tmpdir(), 'studio-'))
  writeFileSync(join(dir, 'types.md'), '## Calm\nid: calm\nQuiet.\n')
  mkdirSync(join(dir, 'items', 'a'), { recursive: true })
  writeFileSync(join(dir, 'items', 'a', 'item.md'), '---\ntitle: A\ntype: loud\n---\n')
  const { library, warnings } = buildLibrary(dir)
  assert.equal(library.items[0].type, 'unsorted')
  assert.match(warnings.join('\n'), /"loud" is not in types\.md/)
})

test('library.js cannot be broken out of by item text', () => {
  const LS = String.fromCharCode(0x2028)
  const PS = String.fromCharCode(0x2029)
  const nasty = `end </script><script>alert(1)</script> <!-- ${LS} line ${PS} para`
  const script = toScript({ version: 1, types: [], items: [{ title: nasty }] })
  assert.ok(!script.includes('</script'), 'no closing script tag')
  assert.ok(!script.includes('<!--'), 'no HTML comment opener')
  assert.ok(!script.includes(LS) && !script.includes(PS), 'line separators escaped')
  assert.equal(load(script).items[0].title, nasty)
})
