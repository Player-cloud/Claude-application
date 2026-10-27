import { expect, test } from 'claude-code/testing'

const PERSONAL_APP = 'C:/Users/me/Code/personal/app'
const ROOTS = {
  personalRoots: 'C:\\Users\\me\\Code\\personal',
  workRoots: 'C:\\Users\\me\\Code\\work',
  personalVault: 'C:/Users/me/Vaults/Personal',
}
// The engine hands paths on in its own spelling (backslashes on Windows, resolved on
// Linux), so the log is found by its normalised ending.
const LOG_END = 'users/me/vaults/personal/_log/actions.md'
const logOf = (files: Record<string, string>) => {
  const k = Object.keys(files).find(f => f.replace(/\\/g, '/').toLowerCase().endsWith(LOG_END))
  return k === undefined ? undefined : files[k]
}
const FAKE_KEY = 'sk-ant-api03-FAKEFAKEFAKEFAKEFAKEFAKEFAKE'

type Seen = { files: Record<string, string>; ran: string[] }

// The engine beneath the plugin: a pretend disk and a fixed clock.
function engine(on: any, profile: string | undefined, opts: { failing?: boolean; brokenDisk?: boolean } = {}): Seen {
  const seen: Seen = { files: {}, ran: [] }
  const env: Record<string, string | undefined> = { WSOS_PROFILE: profile, USERPROFILE: 'C:\\Users\\me' }
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: PERSONAL_APP }))
  on('env.get', (_$: any, e: any) => ({ value: env[e.name] }) as never)
  on('store.get', () => ({ value: undefined }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('tool.register', (_$: any, e: any) => ({ value: { tool: `mcp__workspace-os__${e.name}` } }) as never)
  on('ui.status', () => ({ value: undefined }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('prompt.compose', () => ({ sections: [] }) as never)
  on('tool.check', () => ({ decision: 'allow' }) as never)
  // You, answering the ask: yes.
  on('classic.PermissionRequest', () => ({ decision: { behavior: 'allow' } }) as never)
  on('clock.now', () => ({ value: Date.UTC(2026, 9, 27, 11, 5) }) as never)
  on('fs.exists', (_$: any, e: any) => ({ value: e.path in seen.files }) as never)
  on('fs.read', (_$: any, e: any) => ({ value: seen.files[e.path] ?? '' }) as never)
  on('fs.write', (_$: any, e: any) => {
    if (opts.brokenDisk) throw new Error('EACCES')
    seen.files[e.path] = e.text
    return { value: undefined } as never
  })
  on('tool.call', (_$: any, e: any) => {
    seen.ran.push(e.tool)
    return { result: opts.failing ? 'rejected' : 'ok', isError: !!opts.failing } as never
  })
  return seen
}

const start = ($: any) => $.session.start({ source: 'startup', cwd: PERSONAL_APP, surface: null, isInteractive: true } as never)

test('an approved push is logged in the vault, one line each; ordinary commands are not', { options: ROOTS }, async ($, on) => {
  const seen = engine(on, 'personal')
  await start($)
  await $.tool.call({ tool: 'Bash', command: 'npm test' } as never)
  await $.tool.call({ tool: 'Bash', command: 'git push -u origin main' } as never)
  await $.tool.call({ tool: 'Bash', command: 'rm -rf build' } as never)
  expect(seen.ran).toEqual(['Bash', 'Bash', 'Bash'])
  const log = logOf(seen.files) ?? ''
  expect(log).toContain('# Approved actions')
  expect(log).toContain('- 2026-10-27 11:05 · pushes always ask · `git push -u origin main` · ')
  expect(log).toContain('recursive deletes always ask · `rm -rf build`')
  expect(log).not.toContain('npm test')
})

test('secrets in a logged command are masked', { options: ROOTS }, async ($, on) => {
  const seen = engine(on, 'personal')
  await start($)
  await $.tool.call({ tool: 'Bash', command: `echo ANTHROPIC_API_KEY=${FAKE_KEY} >> .env` } as never)
  expect(logOf(seen.files)).toContain('writing to a .env file always asks')
  expect(logOf(seen.files)).not.toContain(FAKE_KEY)
})

test('an action that fails leaves no line', { options: ROOTS }, async ($, on) => {
  const failing = engine(on, 'personal', { failing: true })
  await start($)
  await $.tool.call({ tool: 'Bash', command: 'git push' } as never)
  expect(failing.ran).toEqual(['Bash'])
  expect(logOf(failing.files)).toBeUndefined()
})

test('no profile means no vault, so nothing is logged', { options: ROOTS }, async ($, on) => {
  const seen = engine(on, undefined)
  await start($)
  await $.tool.call({ tool: 'Bash', command: 'git push' } as never)
  expect(seen.ran).toEqual(['Bash'])
  expect(Object.keys(seen.files)).toEqual([])
})

test('a vault that cannot be written loses only the log line', { options: ROOTS }, async ($, on) => {
  const seen = engine(on, 'personal', { brokenDisk: true })
  await start($)
  const result = await $.tool.call({ tool: 'Bash', command: 'git push' } as never)
  expect(seen.ran).toEqual(['Bash'])
  expect(JSON.stringify(result)).toContain('ok')
})
