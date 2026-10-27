import { expect, test } from 'claude-code/testing'

const PERSONAL_APP = 'C:/Users/me/Code/personal/app'
const WORK_APP = 'C:/Users/me/Code/work/client'

const ROOTS = {
  personalRoots: 'C:\\Users\\me\\Code\\personal',
  workRoots: 'C:\\Users\\me\\Code\\work; D:\\Clients',
  personalVault: 'C:\\Users\\me\\Vaults\\Personal',
  workVault: 'C:\\Users\\me\\Vaults\\Work',
}

type Seen = { statuses: (string | undefined)[]; toasts: number; panes: number; ran: string[] }

// The engine beneath the plugin: records what reaches it instead of doing it.
function engine(on: any, env: Record<string, string | undefined> | 'broken', core: 'allow' | 'deny' = 'allow'): Seen {
  const seen: Seen = { statuses: [], toasts: 0, panes: 0, ran: [] }
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: PERSONAL_APP }))
  on('env.get', (_$: any, e: any) => {
    if (env === 'broken') throw new Error('environment unavailable')
    return { value: env[e.name] } as never
  })
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
  on('tool.call', (_$: any, e: any) => {
    seen.ran.push(e.tool)
    return { result: 'ok', isError: false } as never
  })
  on('tool.check', () => ({ decision: core, reason: core === 'deny' ? 'core said no' : undefined }) as never)
  on('prompt.compose', () => ({ sections: [] }) as never)
  return seen
}

const start = ($: any, cwd: string) => $.session.start({ source: 'startup', cwd, surface: null, isInteractive: true } as never)
const env = (profile?: string) => ({ WSOS_PROFILE: profile, USERPROFILE: 'C:\\Users\\me' })
const read = ($: any, file_path: string) => $.tool.call({ tool: 'Read', file_path } as never)
const check = ($: any, tool: string, input: unknown, extra: object = {}) =>
  $.tool.check({ tool, input, ...extra } as never) as Promise<{ decision: string; reason?: string }>

// ---- Boundary ----

test('Personal can read its own folders but not Work folders or the Work vault', { options: ROOTS }, async ($, on) => {
  const seen = engine(on, env('personal'))
  await start($, PERSONAL_APP)
  await read($, `${PERSONAL_APP}/src/index.ts`)
  expect(seen.ran).toEqual(['Read'])
  const blocked = await read($, `${WORK_APP}/notes.md`)
  await read($, 'C:/Users/me/Vaults/Work/clients.md')
  await read($, 'D:/Clients/acme/contract.md')
  expect(seen.ran).toEqual(['Read'])
  expect(JSON.stringify(blocked)).toContain('workspace-os blocked this: the path is outside the Personal profile.')
})

test('Work can write its own folders but not Personal ones', { options: ROOTS }, async ($, on) => {
  const seen = engine(on, env('work'))
  await start($, WORK_APP)
  await $.tool.call({ tool: 'Write', file_path: `${WORK_APP}/a.ts`, content: 'x' } as never)
  const blocked = await $.tool.call({ tool: 'Write', file_path: 'C:/Users/me/Vaults/Personal/diary.md', content: 'x' } as never)
  await $.tool.call({ tool: 'Edit', file_path: `${PERSONAL_APP}/a.ts`, old_string: 'a', new_string: 'b' } as never)
  expect(seen.ran).toEqual(['Write'])
  expect(JSON.stringify(blocked)).toContain('workspace-os blocked this: the path is outside the Work profile.')
})

test('Windows spellings of a Work path are all caught; a look-alike folder is not', { options: ROOTS }, async ($, on) => {
  const seen = engine(on, env('personal'))
  await start($, PERSONAL_APP)
  for (const p of [
    'c:/USERS/me/code/WORK/client/x.ts',
    'C:\\Users\\me\\Code\\work\\client\\x.ts',
    '/c/Users/me/Code/work/client/x.ts',
    'C:/Users/me/Code/personal/../work/client/x.ts',
    '"C:\\Users\\me\\Code\\work\\x.ts"',
  ]) {
    await read($, p)
  }
  expect(seen.ran).toEqual([])
  await read($, 'C:/Users/me/Code/workshop/x.ts')
  expect(seen.ran).toEqual(['Read'])
})

test('a shell command naming a Work path is refused; an ordinary one runs', { options: ROOTS }, async ($, on) => {
  const seen = engine(on, env('personal'))
  await start($, PERSONAL_APP)
  await $.tool.call({ tool: 'Bash', command: 'cat "C:\\Users\\me\\Code\\work\\secrets.txt"' } as never)
  await $.tool.call({ tool: 'PowerShell', command: 'Get-Content C:/Users/me/Code/work/a.txt' } as never)
  await $.tool.call({ tool: 'Bash', command: 'npm test' } as never)
  expect(seen.ran).toEqual(['Bash'])
})

// secret-shield's vault files: ~/.claude/secret-shield/<project path as a slug>.env
const VAULTS = 'C:/Users/me/.claude/secret-shield'

test('the other profile\'s secret-shield vault files are refused; its own are not', { options: ROOTS }, async ($, on) => {
  const seen = engine(on, env('personal'))
  await start($, PERSONAL_APP)
  const blocked = await read($, `${VAULTS}/C-Users-me-Code-work-client.env`)
  await read($, `${VAULTS}/C-Users-me-Code-work.env`)
  await read($, `${VAULTS}/D-Clients-acme.env`)
  await $.tool.call({ tool: 'Bash', command: 'cat ~/.claude/secret-shield/C-Users-me-Code-work-client.env' } as never)
  expect(seen.ran).toEqual([])
  expect(JSON.stringify(blocked)).toContain('workspace-os blocked this: the path is outside the Personal profile.')
  await read($, `${VAULTS}/C-Users-me-Code-personal-app.env`)
  await read($, `${VAULTS}/C-Users-me-Code-workshop-x.env`)
  expect(seen.ran).toEqual(['Read', 'Read'])
})

test('Work is refused Personal\'s vault files but reads its own', { options: ROOTS }, async ($, on) => {
  const seen = engine(on, env('work'))
  await start($, WORK_APP)
  await read($, `${VAULTS}/C-Users-me-Code-personal-app.env`)
  await read($, `${VAULTS}/C-Users-me-Code-work-client.env`)
  expect(seen.ran).toEqual(['Read'])
})

test('with no profile, Work\'s vault files are refused', { options: ROOTS }, async ($, on) => {
  const seen = engine(on, env(undefined))
  await start($, PERSONAL_APP)
  await read($, `${VAULTS}/C-Users-me-Code-work-client.env`)
  await read($, `${VAULTS}/C-Users-me-Code-personal-app.env`)
  expect(seen.ran).toEqual(['Read'])
})

test('with no profile, Work is blocked and Personal works', { options: ROOTS }, async ($, on) => {
  const seen = engine(on, env(undefined))
  await start($, PERSONAL_APP)
  await read($, `${PERSONAL_APP}/a.ts`)
  const blocked = await read($, `${WORK_APP}/a.ts`)
  expect(seen.ran).toEqual(['Read'])
  expect(JSON.stringify(blocked)).toContain(
    'workspace-os blocked this: Work folders are off limits in a session with no profile. To use them, start the session from the Work environment.',
  )
  expect(seen.statuses).toEqual(['No profile · Work folders blocked'])
})

test('refusals read as plain sentences: none repeats "so"', { options: ROOTS }, async ($, on) => {
  engine(on, env('personal'))
  await start($, PERSONAL_APP)
  const personal = JSON.stringify(await read($, `${WORK_APP}/a.ts`))
  expect(personal).toContain('workspace-os blocked this:')
  expect(/\bso\b[\s\S]*\bso\b/.test(personal)).toBe(false)
})

test('refusals with no profile read as plain sentences too', { options: ROOTS }, async ($, on) => {
  engine(on, env(undefined))
  await start($, PERSONAL_APP)
  const none = JSON.stringify(await read($, `${WORK_APP}/a.ts`))
  expect(none).toContain('workspace-os blocked this:')
  expect(/\bso\b[\s\S]*\bso\b/.test(none)).toBe(false)
})

test('a session started inside the other profile\'s folder can\'t search or run there', { options: ROOTS }, async ($, on) => {
  const seen = engine(on, env('personal'))
  await start($, WORK_APP)
  await $.tool.call({ tool: 'Grep', pattern: 'TODO' } as never)
  await $.tool.call({ tool: 'Bash', command: 'ls' } as never)
  expect(seen.ran).toEqual([])
  expect(seen.statuses).toEqual(['Personal · this folder belongs to the other profile'])
})

test('if the profile can\'t be read at the start, the session has no profile and Work stays blocked', { options: ROOTS }, async ($, on) => {
  const seen = engine(on, 'broken')
  await start($, PERSONAL_APP)
  await read($, `${WORK_APP}/a.ts`)
  expect(seen.ran).toEqual([])
})

// ---- Gate ----

test('deploys, pushes, migrations, publishing and releases always ask', { options: ROOTS }, async ($, on) => {
  engine(on, env('personal'))
  await start($, PERSONAL_APP)
  for (const command of [
    'git push origin main',
    'git -C app push',
    'vercel',
    'vercel deploy --prod',
    'vercel env add SECRET',
    'npx wrangler deploy',
    'npx prisma migrate deploy',
    'npx prisma migrate reset',
    'npx prisma db push',
    'npm publish',
    'gh release create v1.0.0',
    'gh workflow run deploy.yml',
    'echo KEY=1 >> .env.local',
  ]) {
    const v = await check($, 'Bash', { command })
    expect(v.decision, command).toBe('ask')
    expect(v.reason, command).toContain('workspace-os:')
  }
  expect((await check($, 'PowerShell', { command: 'git push' })).decision).toBe('ask')
})

test('recursive deletes and discarding uncommitted work always ask', { options: ROOTS }, async ($, on) => {
  engine(on, env('personal'))
  await start($, PERSONAL_APP)
  for (const command of [
    'rm -rf node_modules',
    'rm -r build',
    'rm -fR dist',
    'rm --recursive out',
    'npx rimraf dist',
    'git reset --hard origin/main',
    'git clean -fd',
    'rmdir /s /q build',
  ]) {
    const v = await check($, 'Bash', { command })
    expect(v.decision, command).toBe('ask')
    expect(v.reason, command).toContain('workspace-os:')
  }
  for (const command of ['Remove-Item -Recurse -Force .\\build', 'Remove-Item C:\\tmp\\old -Recurse', 'del /s /q *.log']) {
    expect((await check($, 'PowerShell', { command })).decision, command).toBe('ask')
  }
  for (const command of ['rm notes.txt', 'rm -f old.log', 'git reset HEAD~1', 'git reset --soft HEAD~1', 'git clean -n', 'Remove-Item old.txt']) {
    expect((await check($, 'Bash', { command })).decision, command).toBe('allow')
  }
})

test('ordinary commands and reads are left alone', { options: ROOTS }, async ($, on) => {
  engine(on, env('personal'))
  await start($, PERSONAL_APP)
  for (const command of ['git status', 'git commit -m "x"', 'npm test', 'vercel ls', 'vercel logs my-app', 'cat .env.example']) {
    expect((await check($, 'Bash', { command })).decision, command).toBe('allow')
  }
  expect((await check($, 'Read', { file_path: `${PERSONAL_APP}/.env` })).decision).toBe('allow')
})

test('.env writes through the file tools ask', { options: ROOTS }, async ($, on) => {
  engine(on, env('personal'))
  await start($, PERSONAL_APP)
  expect((await check($, 'Write', { file_path: `${PERSONAL_APP}/.env`, content: 'A=1' })).decision).toBe('ask')
  expect((await check($, 'Edit', { file_path: `${PERSONAL_APP}\\.env.production`, old_string: 'a', new_string: 'b' })).decision).toBe('ask')
  expect((await check($, 'Write', { file_path: `${PERSONAL_APP}/environment.ts`, content: 'x' })).decision).toBe('allow')
})

test('deploy-like MCP tools ask', { options: ROOTS }, async ($, on) => {
  engine(on, env('personal'))
  await start($, PERSONAL_APP)
  expect((await check($, 'mcp__vercel__deploy_project', {})).decision).toBe('ask')
  expect((await check($, 'mcp__vercel__list_projects', {})).decision).toBe('allow')
})

test('the gate also asks inside a subagent', { options: ROOTS }, async ($, on) => {
  engine(on, env('personal'))
  await start($, PERSONAL_APP)
  expect((await check($, 'Bash', { command: 'git push' }, { agentId: 'a1' })).decision).toBe('ask')
})

test('the gate never loosens a deny from below', { options: ROOTS }, async ($, on) => {
  engine(on, env('personal'), 'deny')
  await start($, PERSONAL_APP)
  const v = await check($, 'Bash', { command: 'git push' })
  expect(v.decision).toBe('deny')
  expect(v.reason).toBe('core said no')
})

// ---- Profile ----

test('the profile is read once: changing the variable later changes nothing', { options: ROOTS }, async ($, on) => {
  const vars = env('work')
  const seen = engine(on, vars)
  await start($, WORK_APP)
  vars.WSOS_PROFILE = 'personal'
  await read($, `${PERSONAL_APP}/a.ts`)
  expect(seen.ran).toEqual([])
})

test('the profile name is forgiving about case and spaces; anything else is no profile', { options: ROOTS }, async ($, on) => {
  const vars = env(' WORK ')
  const seen = engine(on, vars)
  await start($, WORK_APP)
  vars.WSOS_PROFILE = 'home'
  await start($, PERSONAL_APP)
  expect(seen.statuses).toEqual(['Work · Do it for me', 'No profile · Work folders blocked'])
})

test('quiet: a session start opens no pane, raises no toast and sets one status', { options: ROOTS }, async ($, on) => {
  const seen = engine(on, env('personal'))
  await start($, PERSONAL_APP)
  expect(seen.panes).toBe(0)
  expect(seen.toasts).toBe(0)
  expect(seen.statuses).toEqual(['Personal · Build with me'])
})

test('the system prompt names the profile but no folder of the other one', { options: ROOTS }, async ($, on) => {
  engine(on, env('personal'))
  await start($, PERSONAL_APP)
  const input = { model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: ['desktop'], tools: ['Read'], outputStyle: null, traits: [] }
  const { sections } = (await $.prompt.compose(input as never)) as { sections: readonly { id: string; text: string }[] }
  expect(sections.map(s => s.id)).toEqual(['workspace-os:profile'])
  expect(sections[0]!.text).toContain('Personal profile')
  expect(sections[0]!.text.toLowerCase()).not.toContain('code/work')
  expect(sections[0]!.text.toLowerCase()).not.toContain('clients')
})
