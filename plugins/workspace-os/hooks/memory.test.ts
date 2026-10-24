import { expect, test } from 'claude-code/testing'

const PERSONAL_APP = 'C:/Users/me/Code/personal/app'

const ROOTS = {
  personalRoots: 'C:\\Users\\me\\Code\\personal',
  workRoots: 'C:\\Users\\me\\Code\\work',
}

// Another mod that saves files, the way reflect-mod saves a rule: through $.fs.write.
const WRITER = {
  name: 'some-mod',
  register: (on: any) => {
    on('command.run', { command: 'save' }, async ($: any, e: any) => {
      const { path, text } = JSON.parse(e.args)
      try {
        await $.fs.write(path, text)
        return { text: 'written' }
      } catch (err) {
        return { text: `refused: ${(err as Error).message}` }
      }
    })
  },
}

type Seen = { writes: string[]; toasts: string[] }

function engine(on: any, profile = 'personal'): Seen {
  const seen: Seen = { writes: [], toasts: [] }
  const env: Record<string, string> = { WSOS_PROFILE: profile, USERPROFILE: 'C:\\Users\\me' }
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: PERSONAL_APP }))
  on('env.get', (_$: any, e: any) => ({ value: env[e.name] }) as never)
  on('ui.status', () => ({ value: undefined }) as never)
  on('ui.toast', (_$: any, e: any) => {
    seen.toasts.push(e.text)
    return { value: undefined } as never
  })
  on('fs.write', (_$: any, e: any) => {
    seen.writes.push(e.path)
    return { value: undefined } as never
  })
  on('tool.check', () => ({ decision: 'allow' }) as never)
  on('prompt.compose', () => ({ sections: [] }) as never)
  return seen
}

const start = ($: any) => $.session.start({ source: 'startup', cwd: PERSONAL_APP, surface: null, isInteractive: true } as never)
const save = async ($: any, path: string) =>
  ((await $.command.run({ command: 'save', args: JSON.stringify({ path, text: 'x' }) } as never)) as { text: string }).text
const check = ($: any, tool: string, input: unknown) => $.tool.check({ tool, input } as never) as Promise<{ decision: string; reason?: string }>

// ---- Other plugins can't write shared or taste memory ----

test('a mod can\'t save to the global CLAUDE.md, in any spelling, and you are told why', { options: ROOTS, plugins: [WRITER] }, async ($, on) => {
  const seen = engine(on)
  await start($)
  // (A mod's /c/Users/... isn't another spelling: the engine resolves it to C:\c\Users\...,
  // a different file, before any hook sees it. Claude's shell commands are covered by the gate.)
  for (const p of ['C:/Users/me/.claude/CLAUDE.md', 'C:\\Users\\me\\.claude\\CLAUDE.md', 'c:/users/me/.CLAUDE/claude.md']) {
    expect(await save($, p), p).toContain('refused')
  }
  expect(seen.writes).toEqual([])
  expect(seen.toasts.length).toBe(3)
  expect(seen.toasts[0]).toContain('shared by Personal and Work')
  expect(seen.toasts[0]).toContain('This repo instead')
})

test('the block holds even before the session start hook has run', { options: ROOTS, plugins: [WRITER] }, async ($, on) => {
  const seen = engine(on)
  expect(await save($, 'C:/Users/me/.claude/CLAUDE.md')).toContain('refused')
  expect(seen.writes).toEqual([])
})

test('a mod can\'t write either profile\'s Preferences', { options: ROOTS, plugins: [WRITER] }, async ($, on) => {
  const seen = engine(on)
  await start($)
  expect(await save($, 'C:/Users/me/Code/personal/Preferences/coding.md')).toContain('refused')
  expect(await save($, 'C:\\Users\\me\\Code\\work\\preferences\\writing.md')).toContain('refused')
  expect(seen.writes).toEqual([])
})

test('a mod\'s project save and other writes are untouched', { options: ROOTS, plugins: [WRITER] }, async ($, on) => {
  const seen = engine(on)
  await start($)
  expect(await save($, `${PERSONAL_APP}/CLAUDE.md`)).toBe('written')
  expect(await save($, 'C:/Users/me/Code/personal/PreferencesBackup/x.md')).toBe('written')
  expect(seen.writes.length).toBe(2)
  expect(seen.toasts).toEqual([])
})

// ---- Claude's own changes to memory always ask ----

test('Claude writing Preferences or the global CLAUDE.md asks you', { options: ROOTS }, async ($, on) => {
  engine(on)
  await start($)
  const prefs = await check($, 'Write', { file_path: 'C:\\Users\\me\\Code\\personal\\Preferences\\coding.md', content: 'x' })
  expect(prefs.decision).toBe('ask')
  expect(prefs.reason).toBe('workspace-os: changes to your Preferences always ask.')
  const global = await check($, 'Edit', { file_path: 'C:/Users/me/.claude/CLAUDE.md', old_string: 'a', new_string: 'b' })
  expect(global.decision).toBe('ask')
  expect(global.reason).toBe('workspace-os: changes to the global CLAUDE.md always ask.')
  expect((await check($, 'Bash', { command: 'echo rule >> "C:\\Users\\me\\.claude\\CLAUDE.md"' })).decision).toBe('ask')
})

test('ordinary edits, and reading Preferences, don\'t ask', { options: ROOTS }, async ($, on) => {
  engine(on)
  await start($)
  expect((await check($, 'Write', { file_path: `${PERSONAL_APP}/CLAUDE.md`, content: 'x' })).decision).toBe('allow')
  expect((await check($, 'Read', { file_path: 'C:/Users/me/Code/personal/Preferences/coding.md' })).decision).toBe('allow')
})

// ---- Loading taste ----

test('the prompt names this profile\'s Preferences folder and not the other\'s', { options: ROOTS }, async ($, on) => {
  engine(on, 'work')
  await start($)
  const input = { model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: ['desktop'], tools: ['Read'], outputStyle: null, traits: [] }
  const { sections } = (await $.prompt.compose(input as never)) as { sections: readonly { text: string }[] }
  expect(sections[0]!.text).toContain('C:\\Users\\me\\Code\\work\\Preferences')
  expect(sections[0]!.text).toContain('Only the feedback skill changes them')
  expect(sections[0]!.text.toLowerCase()).not.toContain('code\\personal')
})
