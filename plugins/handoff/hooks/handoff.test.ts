import { expect, test } from 'claude-code/testing'

const ROOT = 'C:/Users/Lapto/Downloads/basketball-platform'
const HANDOFF = `---
title: Live match scores
status: open
created: 2026-10-05
from: Cowork
---

# Goal
Visitors see live scores on the club homepage.
`

const norm = (p: string) => p.replace(/\\/g, '/').toLowerCase()
const seen: string[] = []

function fakeFiles(on: any, files: Record<string, string>) {
  const key = (p: string) => Object.keys(files).find(k => norm(k) === norm(p)) ?? p
  on('session.root', () => ({ value: ROOT }))
  on('fs.exists', (_$: any, e: any) => {
    seen.push(e.path)
    return { value: Object.keys(files).some(k => norm(k) === norm(e.path)) }
  })
  on('fs.read', (_$: any, e: any) => ({ value: files[key(e.path)] }))
  on('fs.write', (_$: any, e: any) => {
    files[key(e.path)] = e.text
    return { value: undefined }
  })
  on('command.register', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
}

test('gives an open handoff to Claude with the first message, once', async ($, on) => {
  const files: Record<string, string> = { [`${ROOT}/.claude/handoff.md`]: HANDOFF }
  fakeFiles(on, files)
  const contexts: (readonly string[] | undefined)[] = []
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_$, e) => {
    contexts.push(e.context)
    return { text: e.text }
  })

  await $.session.start({ source: 'startup', cwd: ROOT, surface: null, isInteractive: true } as never)
  await $.prompt.submit({ text: 'lets start', origin: { kind: 'composer' } } as never)
  await $.prompt.submit({ text: 'and carry on', origin: { kind: 'composer' } } as never)

  expect(contexts[0]?.some(c => c.includes('Live match scores'))).toBe(true)
  expect(contexts[1]?.some(c => c.includes('Live match scores')) ?? false).toBe(false)
  expect(files[`${ROOT}/.claude/handoff.md`]).toContain('status: in progress')
})

test('/handoff done marks it finished', async ($, on) => {
  const files: Record<string, string> = { [`${ROOT}/.claude/handoff.md`]: HANDOFF }
  fakeFiles(on, files)

  const result = await $.command.run({ command: 'handoff', args: 'done' } as never)
  expect((result as { text: string }).text, `paths checked: ${seen.join(', ')}`).toContain('marked done')
  expect(files[`${ROOT}/.claude/handoff.md`]).toContain('status: done')
})

test('says how to make one when there is none', async ($, on) => {
  fakeFiles(on, {})
  const result = await $.command.run({ command: 'handoff', args: '' } as never)
  expect((result as { text: string }).text).toContain('/handoff-to-code')
})
