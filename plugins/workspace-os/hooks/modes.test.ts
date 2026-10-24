import { expect, test } from 'claude-code/testing'

const PERSONAL_APP = 'C:/Users/me/Code/personal/app'
const PERSONAL_OTHER = 'C:/Users/me/Code/personal/site'
const WORK_APP = 'C:/Users/me/Code/work/client'

const ROOTS = {
  personalRoots: 'C:\\Users\\me\\Code\\personal',
  workRoots: 'C:\\Users\\me\\Code\\work',
}

type Seen = { statuses: (string | undefined)[]; toasts: number; panes: number; store: Record<string, unknown> }

// The engine beneath the plugin, with a store that lasts across the test's sessions.
function engine(on: any, profile: string | undefined): Seen {
  const seen: Seen = { statuses: [], toasts: 0, panes: 0, store: {} }
  const env: Record<string, string | undefined> = { WSOS_PROFILE: profile, USERPROFILE: 'C:\\Users\\me' }
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: PERSONAL_APP }))
  on('env.get', (_$: any, e: any) => ({ value: env[e.name] }) as never)
  on('store.get', (_$: any, e: any) => ({ value: seen.store[e.key] }) as never)
  on('store.set', (_$: any, e: any) => {
    seen.store[e.key] = e.value
    return { value: undefined } as never
  })
  on('command.register', () => ({ value: undefined }) as never)
  on('ui.status', (_$: any, e: any) => {
    seen.statuses.push(e.text)
    return { value: undefined } as never
  })
  on('ui.toast', () => {
    seen.toasts++
    return { value: undefined } as never
  })
  on('ui.open', () => {
    seen.panes++
    return { value: { isPlaced: false, reason: 'test' } } as never
  })
  on('prompt.compose', () => ({ sections: [] }) as never)
  return seen
}

const start = ($: any, cwd: string) => $.session.start({ source: 'startup', cwd, surface: null, isInteractive: true } as never)
const mode = async ($: any, args: string) => ((await $.command.run({ command: 'mode', args } as never)) as { text: string }).text
const prompt = async ($: any) => {
  const input = { model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: ['desktop'], tools: ['Read'], outputStyle: null, traits: [] }
  const { sections } = (await $.prompt.compose(input as never)) as { sections: readonly { text: string }[] }
  return sections.map(s => s.text).join('\n')
}
const modesIn = (text: string) => (text.match(/Mode: (Tutor|Build with me|Do it for me|Review mine)\./g) ?? []).length

// ---- Defaults ----

test('Personal defaults to Build with me, Work to Do it for me', { options: ROOTS }, async ($, on) => {
  const seen = engine(on, 'personal')
  await start($, PERSONAL_APP)
  expect(await prompt($)).toContain('Mode: Build with me.')
  expect(seen.statuses.at(-1)).toBe('Personal · Build with me')
})

test('Work defaults to Do it for me', { options: ROOTS }, async ($, on) => {
  const seen = engine(on, 'work')
  await start($, WORK_APP)
  expect(await prompt($)).toContain('Mode: Do it for me.')
  expect(seen.statuses.at(-1)).toBe('Work · Do it for me')
})

test('with no profile there is no mode, and /mode says why', { options: ROOTS }, async ($, on) => {
  engine(on, undefined)
  await start($, PERSONAL_APP)
  expect(modesIn(await prompt($))).toBe(0)
  expect(await mode($, 'tutor')).toBe('Modes need a profile. Start the session from the Personal or Work environment.')
})

// ---- Switching ----

test('/mode changes the mode from the next message, one mode at a time', { options: ROOTS }, async ($, on) => {
  const seen = engine(on, 'personal')
  await start($, PERSONAL_APP)
  expect(await mode($, 'tutor')).toContain('Personal · Tutor\nFor this session')
  const text = await prompt($)
  expect(text).toContain('Mode: Tutor.')
  expect(modesIn(text)).toBe(1)
  expect(seen.statuses.at(-1)).toBe('Personal · Tutor')
})

test('mode names are forgiving; an unknown one changes nothing', { options: ROOTS }, async ($, on) => {
  engine(on, 'personal')
  await start($, PERSONAL_APP)
  await mode($, 'Review Mine')
  expect(await prompt($)).toContain('Mode: Review mine.')
  expect(await mode($, 'chill')).toContain('isn\'t a mode')
  expect(await prompt($)).toContain('Mode: Review mine.')
})

test('/mode on its own shows profile, scratch and mode, and the choices', { options: ROOTS }, async ($, on) => {
  engine(on, 'personal')
  await start($, PERSONAL_APP)
  const text = await mode($, '')
  expect(text).toContain('Personal · Build with me')
  expect(text).toContain('/mode default')
})

// ---- Folder defaults ----

test('/mode default is remembered for that folder in a later session, and only there', { options: ROOTS }, async ($, on) => {
  const seen = engine(on, 'personal')
  await start($, PERSONAL_APP)
  expect(await mode($, 'default review')).toContain('Personal · Review mine\nNow the default for this folder')
  await start($, PERSONAL_APP)
  expect(await prompt($)).toContain('Mode: Review mine.')
  await start($, PERSONAL_OTHER)
  expect(await prompt($)).toContain('Mode: Build with me.')
  expect(Object.keys(seen.store)).toEqual(['mode:c:/users/me/code/personal/app'])
})

test('a session\'s own choice wins over the folder default, and ends with the session', { options: ROOTS }, async ($, on) => {
  engine(on, 'personal')
  await start($, PERSONAL_APP)
  await mode($, 'default review')
  await mode($, 'do')
  expect(await prompt($)).toContain('Mode: Do it for me.')
  await start($, PERSONAL_APP)
  expect(await prompt($)).toContain('Mode: Review mine.')
})

// ---- Scratch ----

test('a scratch folder is recognised in any spelling and defaults to Do it for me', { options: ROOTS }, async ($, on) => {
  const seen = engine(on, 'personal')
  for (const cwd of ['C:/Users/me/Code/personal/scratch', 'c:\\USERS\\me\\Code\\Personal\\Scratch\\notes']) {
    await start($, cwd)
    const text = await prompt($)
    expect(text, cwd).toContain('This is a scratch session for a one-off task')
    expect(text, cwd).toContain('Mode: Do it for me.')
    expect(seen.statuses.at(-1), cwd).toBe('Personal · scratch · Do it for me')
  }
  await start($, PERSONAL_APP)
  expect(await prompt($)).not.toContain('scratch session')
})

// ---- Quiet ----

test('switching modes opens no pane and raises no toast', { options: ROOTS }, async ($, on) => {
  const seen = engine(on, 'personal')
  await start($, PERSONAL_APP)
  await mode($, 'tutor')
  await mode($, 'default do')
  expect(seen.panes).toBe(0)
  expect(seen.toasts).toBe(0)
})

// ---- A mode and a task on one line ----

test('/mode tutor <task> switches to Tutor and hands the task back to send', { options: ROOTS }, async ($, on) => {
  engine(on, 'personal')
  await start($, PERSONAL_APP)
  const reply = await mode($, 'tutor Write a function that checks a UK postcode')
  expect(reply).toContain('Personal · Tutor')
  expect(reply).toContain('Now send your task as a message: Write a function that checks a UK postcode')
  expect(await prompt($)).toContain('Mode: Tutor.')
})

test('a multi-word mode name still works with a task after it', { options: ROOTS }, async ($, on) => {
  engine(on, 'personal')
  await start($, PERSONAL_APP)
  const reply = await mode($, 'Build with me then refactor the parser')
  expect(reply).toContain('Personal · Build with me')
  expect(reply).toContain('Now send your task as a message: then refactor the parser')
})

test('/mode default <mode> <task> sets the folder default and hands the task back', { options: ROOTS }, async ($, on) => {
  const seen = engine(on, 'personal')
  await start($, PERSONAL_APP)
  const reply = await mode($, 'default review check my tests')
  expect(reply).toContain('Now the default for this folder')
  expect(reply).toContain('Now send your task as a message: check my tests')
  expect(Object.values(seen.store)).toEqual(['review'])
})

test('an unknown first word names only that word and changes nothing', { options: ROOTS }, async ($, on) => {
  engine(on, 'personal')
  await start($, PERSONAL_APP)
  expect(await mode($, 'chill out for a bit')).toContain('"chill" isn\'t a mode.')
  expect(await prompt($)).toContain('Mode: Build with me.')
})

test('no /mode reply repeats the plugin name Desktop already shows', { options: ROOTS }, async ($, on) => {
  engine(on, 'personal')
  await start($, PERSONAL_APP)
  for (const args of ['', 'tutor', 'default do', 'nonsense', 'review write it']) {
    expect((await mode($, args)).startsWith('workspace-os'), args).toBe(false)
  }
})
