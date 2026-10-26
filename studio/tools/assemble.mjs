// Puts a complete Studio folder together: the template files plus the sample items,
// with library.js built. Used by the tests and by `npm run sample`.
import { cpSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildLibrary, toScript } from '../template/build-library.mjs'

const studio = join(dirname(fileURLToPath(import.meta.url)), '..')

export function assemble(target, { sample = true } = {}) {
  mkdirSync(join(target, 'inbox'), { recursive: true })
  cpSync(join(studio, 'template'), target, { recursive: true })
  if (sample) cpSync(join(studio, 'sample', 'items'), join(target, 'items'), { recursive: true })
  return rebuild(target)
}

export function rebuild(target) {
  const result = buildLibrary(target)
  writeFileSync(join(target, 'library.js'), toScript(result.library))
  return result
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const target = join(studio, 'sample-build')
  const { library, warnings } = assemble(target)
  console.log(`Sample Studio with ${library.items.length} items at ${target}`)
  console.log(`Open ${join(target, 'index.html')} in a browser.`)
  for (const w of warnings) console.log(`warning: ${w}`)
}
