// workspace-os carries its own copy of secret-shield's detect.ts, because each
// plugin installs on its own. This fails when the two drift apart; copy
// secret-shield's version over this one to fix it. Run with:
//   node --test plugins/workspace-os/hooks/detect-copy.spec.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = rel => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8').replace(/\r\n/g, '\n')

test("workspace-os's detect.ts matches secret-shield's", () => {
  assert.equal(read('./detect.ts'), read('../../secret-shield/hooks/detect.ts'))
})
