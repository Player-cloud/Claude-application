import { expect, test } from 'claude-code/testing'

const PERSONAL_APP = 'C:/Users/me/Code/personal/app'
const WORK_APP = 'C:/Users/me/Code/work/client'
const PV = 'C:/Users/me/Code/personal/Vault'
const WV = 'C:/Users/me/Code/work/Vault'

const ROOTS = {
  personalRoots: 'C:\\Users\\me\\Code\\personal',
  workRoots: 'C:\\Users\\me\\Code\\work',
}

const FAKE_KEY = 'sk-ant-api03-FAKEFAKEFAKEFAKEFAKEFAKEFAKE'

// A small vault on a pretend disk: names keep their case, lookups ignore it.
const FILES: Record<string, string> = {
  [`${PV}/Ideas.md`]: `# Ideas\nBuild a [[Garden]] planner.\nTest key ${FAKE_KEY}\n`,
  [`${PV}/Garden.md`]: '# Garden\nTomatoes and basil.\n',
  [`${PV}/Private.md`]: '---\nagent: none\n---\nMy garden diary.\n',
  [`${PV}/Projects/Plan.md`]: '# Plan\nGarden plan, see [[Garden|the garden]].\n',
  [`${PV}/.obsidian/app.json`]: '{"garden": true}',
  [`${PV}/.obsidian/notes.md`]: 'garden settings',
  [`${WV}/Client.md`]: '# Client\nGarden centre account.\n',
}
// Symbolic links: where each one really leads.
const LINKS: Record<string, string> = {
  [`${PV}/Escape.md`]: `${WV}/Client.md`,
  [`${PV}/Elsewhere`]: 'C:/Users/me/Code/work',
}

const key = (p: string) => p.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/\/$/, '').toLowerCase()
const find = (table: Record<string, string>, p: string) => Object.keys(table).find(k => key(k) === key(p))
const isDir = (p: string) => Object.keys(FILES).some(f => key(f).startsWith(`${key(p)}/`))

type Seen = { ran: string[]; registered: string[] }

function engine(on: any, profile: string | undefined): Seen {
  const seen: Seen = { ran: [], registered: [] }
  const env: Record<string, string | undefined> = { WSOS_PROFILE: profile, USERPROFILE: 'C:\\Users\\me' }
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: PERSONAL_APP }))
  on('env.get', (_$: any, e: any) => ({ value: env[e.name] }) as never)
  on('store.get', () => ({ value: undefined }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('tool.register', (_$: any, e: any) => {
    seen.registered.push(`${e.name}${e.isDeferred === false ? '' : ' (deferred)'}`)
    return { value: { tool: `mcp__workspace-os__${e.name}` } } as never
  })
  on('ui.status', () => ({ value: undefined }) as never)
  on('prompt.compose', () => ({ sections: [] }) as never)
  on('fs.list', (_$: any, e: any) => {
    const dir = key(e.path)
    const names = new Map<string, 'file' | 'dir' | 'other'>()
    for (const f of Object.keys(FILES)) {
      if (!key(f).startsWith(`${dir}/`)) continue
      const rest = f.slice(dir.length + 1).split('/')
      names.set(rest[0]!, rest.length > 1 ? 'dir' : 'file')
    }
    for (const l of Object.keys(LINKS)) {
      if (key(l).startsWith(`${dir}/`) && !l.slice(dir.length + 1).includes('/')) names.set(l.slice(dir.length + 1), 'other')
    }
    return { value: [...names].map(([name, kind]) => ({ name, kind, size: 1, mtimeMs: 0 })) } as never
  })
  on('fs.stat', (_$: any, e: any) => {
    const link = find(LINKS, e.path)
    if (link) return { value: { kind: 'file', size: 1, mtimeMs: 0, isLink: true, realPath: LINKS[link] } } as never
    if (find(FILES, e.path)) return { value: { kind: 'file', size: 1, mtimeMs: 0, isLink: false, realPath: e.path } } as never
    if (isDir(e.path)) return { value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false, realPath: e.path } } as never
    throw new Error('ENOENT')
  })
  on('fs.read', (_$: any, e: any) => {
    // Reading through a link reads what it points at, as a real disk does.
    const link = find(LINKS, e.path)
    const f = find(FILES, link ? LINKS[link]! : e.path)
    if (!f) throw new Error('ENOENT')
    return { value: FILES[f] } as never
  })
  on('tool.call', (_$: any, e: any) => {
    seen.ran.push(e.tool)
    return { result: 'ran', isError: false } as never
  })
  return seen
}

const start = ($: any, cwd: string) => $.session.start({ source: 'startup', cwd, surface: null, isInteractive: true } as never)
const vault = async ($: any, name: string, input: object = {}) =>
  String(((await $.tool.call({ tool: `mcp__workspace-os__${name}`, ...input } as never)) as { result?: unknown }).result)

// ---- Reading ----

test('a note reads back, with secrets masked', { options: ROOTS }, async ($, on) => {
  engine(on, 'personal')
  await start($, PERSONAL_APP)
  const text = await vault($, 'vault_read', { path: 'Ideas.md' })
  expect(text).toContain('Build a [[Garden]] planner.')
  expect(text).toContain('{{secret}}')
  expect(text).not.toContain('FAKEFAKE')
  expect(await vault($, 'vault_read', { path: 'Projects\\Plan' })).toContain('Garden plan')
})

test('a private note (agent: none) can\'t be read, listed or found', { options: ROOTS }, async ($, on) => {
  engine(on, 'personal')
  await start($, PERSONAL_APP)
  expect(await vault($, 'vault_read', { path: 'Private.md' })).toBe('No note at Private.md.')
  expect(await vault($, 'vault_list')).not.toContain('Private')
  expect(await vault($, 'vault_search', { query: 'diary' })).toBe('No notes match "diary".')
})

test('Obsidian\'s .obsidian folder is never shown', { options: ROOTS }, async ($, on) => {
  engine(on, 'personal')
  await start($, PERSONAL_APP)
  expect(await vault($, 'vault_list')).not.toContain('.obsidian')
  expect(await vault($, 'vault_read', { path: '.obsidian/notes.md' })).toBe('That path is not a note inside the vault.')
  expect(await vault($, 'vault_search', { query: 'settings' })).toBe('No notes match "settings".')
})

test('paths can\'t leave the vault: .., absolute paths and links out are refused', { options: ROOTS }, async ($, on) => {
  engine(on, 'personal')
  await start($, PERSONAL_APP)
  for (const path of ['../../work/Vault/Client.md', '..\\x.md', 'C:/Users/me/Code/work/Vault/Client.md', '/c/Users/me/Code/work/Vault/Client.md', '~/x.md']) {
    expect(await vault($, 'vault_read', { path }), path).toBe('That path is not a note inside the vault.')
  }
  // Escape.md is a link to the Work vault: it reads as missing, and isn't listed.
  expect(await vault($, 'vault_read', { path: 'Escape.md' })).toBe('No note at Escape.md.')
  const list = await vault($, 'vault_list')
  expect(list).not.toContain('Escape')
  expect(list).not.toContain('Client')
})

// ---- Searching, listing, links ----

test('search finds notes by every word, name matches first, private and hidden left out', { options: ROOTS }, async ($, on) => {
  engine(on, 'personal')
  await start($, PERSONAL_APP)
  const hits = (await vault($, 'vault_search', { query: 'garden' })).split('\n')
  expect(hits[0]).toContain('Garden.md')
  expect(hits.join('\n')).toContain('Projects/Plan.md')
  expect(hits.join('\n')).toContain('Ideas.md')
  expect(hits.length).toBe(3)
  expect(await vault($, 'vault_search', { query: 'garden tomatoes' })).toBe('- Garden.md: Tomatoes and basil.')
})

test('list shows notes, or only one folder\'s', { options: ROOTS }, async ($, on) => {
  engine(on, 'personal')
  await start($, PERSONAL_APP)
  expect((await vault($, 'vault_list')).split('\n').sort()).toEqual(['Garden.md', 'Ideas.md', 'Projects/Plan.md'])
  expect(await vault($, 'vault_list', { folder: 'Projects' })).toBe('Projects/Plan.md')
})

test('backlinks finds every note linking to one, in any link style', { options: ROOTS }, async ($, on) => {
  engine(on, 'personal')
  await start($, PERSONAL_APP)
  expect((await vault($, 'vault_backlinks', { note: 'Garden' })).split('\n').sort()).toEqual(['Ideas.md', 'Projects/Plan.md'])
  expect(await vault($, 'vault_backlinks', { note: 'Plan' })).toBe('No notes link to Plan.')
})

// ---- The boundary around it ----

test('Claude\'s built-in tools can\'t open the vault directly', { options: ROOTS }, async ($, on) => {
  const seen = engine(on, 'personal')
  await start($, PERSONAL_APP)
  const read = await $.tool.call({ tool: 'Read', file_path: `${PV}/Garden.md` } as never)
  await $.tool.call({ tool: 'Grep', pattern: 'garden', path: PV } as never)
  await $.tool.call({ tool: 'Bash', command: `cat "${PV.replace(/\//g, '\\')}\\Garden.md"` } as never)
  await $.tool.call({ tool: 'Read', file_path: `${PERSONAL_APP}/README.md` } as never)
  expect(seen.ran).toEqual(['Read'])
  expect(JSON.stringify(read)).toContain('read only through the vault tools')
})

test('a Work session\'s vault tools see only the Work vault', { options: ROOTS }, async ($, on) => {
  engine(on, 'work')
  await start($, WORK_APP)
  expect(await vault($, 'vault_read', { path: 'Client.md' })).toContain('Garden centre account')
  expect(await vault($, 'vault_list')).toBe('Client.md')
  expect(await vault($, 'vault_search', { query: 'tomatoes' })).toBe('No notes match "tomatoes".')
})

test('with no profile the vault tools aren\'t registered and have no vault', { options: ROOTS }, async ($, on) => {
  const seen = engine(on, undefined)
  await start($, PERSONAL_APP)
  expect(seen.registered).toEqual([])
  expect(await vault($, 'vault_read', { path: 'Garden.md' })).toBe('This session has no profile, so it has no notes vault.')
})

test('the four tools are registered up front, and the prompt points to them', { options: ROOTS }, async ($, on) => {
  const seen = engine(on, 'personal')
  await start($, PERSONAL_APP)
  expect(seen.registered).toEqual(['vault_search', 'vault_read', 'vault_list', 'vault_backlinks'])
  const input = { model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: ['desktop'], tools: ['Read'], outputStyle: null, traits: [] }
  const { sections } = (await $.prompt.compose(input as never)) as { sections: readonly { text: string }[] }
  expect(sections[0]!.text).toContain("This profile's notes vault is C:\\Users\\me\\Code\\personal\\Vault")
  expect(sections[0]!.text).toContain('vault_search, vault_read, vault_list and vault_backlinks')
})

test('a profile whose vault doesn\'t exist yet says where it should be', { options: { ...ROOTS, workVault: 'C:\\Users\\me\\Code\\work\\Notes' } }, async ($, on) => {
  engine(on, 'work')
  await start($, WORK_APP)
  expect(await vault($, 'vault_list')).toBe('This profile has no notes vault yet (expected at C:\\Users\\me\\Code\\work\\Notes).')
})
