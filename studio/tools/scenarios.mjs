// Named test states for a Studio: the same few situations every check starts from,
// so the qa skill, the drift check and the tests all mean the same thing by "a fresh
// Studio" or "a broken item". `npm run scenario` writes them all to scenario-build/;
// `npm run scenario -- broken` writes one.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assemble, rebuild } from './assemble.mjs'

const studio = join(dirname(fileURLToPath(import.meta.url)), '..')
const sampleImage = join(studio, 'sample', 'items', '2026-10-20-brisk-bakery', 'image.svg')

export const SCENARIOS = {
  'first-run': {
    what: 'A Studio just copied from the template: empty inbox, no designs yet.',
    expect: { items: 0, warnings: 0 },
    make: target => assemble(target, { sample: false }),
  },
  normal: {
    what: 'The six sample designs, sorted, nothing waiting.',
    expect: { items: 6, warnings: 0 },
    make: target => assemble(target),
  },
  'inbox-waiting': {
    what: 'The sample library plus a screenshot and a link note waiting in inbox/ to be sorted.',
    expect: { items: 6, warnings: 0, inbox: 2 },
    make: target => {
      assemble(target)
      cpSync(sampleImage, join(target, 'inbox', 'new-landing-page.svg'))
      writeFileSync(join(target, 'inbox', 'link.txt'), 'https://example.com/a-site-i-liked\n')
      return rebuild(target)
    },
  },
  broken: {
    what: 'The sample library plus three faulty items: one with no item.md, one with a type not in types.md, one whose id differs from its folder.',
    expect: { items: 8, warnings: 3 },
    make: target => {
      assemble(target)
      const items = join(target, 'items')
      mkdirSync(join(items, '2026-10-26-no-notes'), { recursive: true })
      cpSync(sampleImage, join(items, '2026-10-26-no-notes', 'image.png'))
      mkdirSync(join(items, '2026-10-26-odd-type'), { recursive: true })
      writeFileSync(join(items, '2026-10-26-odd-type', 'item.md'), '---\nid: 2026-10-26-odd-type\ntitle: Odd Type\ntype: brutalist\nstatus: sorted\n---\n\n## Your note\nA type nobody defined.\n')
      mkdirSync(join(items, '2026-10-26-renamed'), { recursive: true })
      writeFileSync(join(items, '2026-10-26-renamed', 'item.md'), '---\nid: 2026-10-20-old-name\ntitle: Renamed\ntype: unsorted\nstatus: new\n---\n')
      return rebuild(target)
    },
  },
}

const buildDir = join(studio, 'scenario-build')

// Writes one scenario into `target` and returns what build-library said. Only an old
// copy inside scenario-build/ is cleared first; any other target must be new or empty.
export function makeScenario(name, target) {
  const s = SCENARIOS[name]
  if (!s) throw new Error(`No scenario "${name}". Known: ${Object.keys(SCENARIOS).join(', ')}`)
  if (resolve(target).startsWith(buildDir + sep)) rmSync(target, { recursive: true, force: true })
  else if (existsSync(target) && readdirSync(target).length) throw new Error(`${target} isn't empty`)
  return s.make(target)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const wanted = process.argv.slice(2)
  for (const name of wanted.length ? wanted : Object.keys(SCENARIOS)) {
    const target = join(buildDir, name)
    const { library, warnings } = makeScenario(name, target)
    console.log(`${name}: ${SCENARIOS[name].what}`)
    console.log(`  ${library.items.length} items, ${warnings.length} warnings. Open ${join(target, 'index.html')}`)
  }
}
