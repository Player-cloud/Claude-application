import { expect, test } from 'claude-code/testing'

// ---------------------------------------------------------------- a fake environment shaped like the real one

// Fixed clock; the stand-ins below repeat these numbers literally (each is compiled on its own).
const NOW = 1791216000000
const ROOT = 'C:/Users/test/Downloads/basketball-platform'

const PLUGIN_LIST = [
  ['feature-dev@claude-plugins-official', true],
  ['pr-review-toolkit@claude-plugins-official', true],
  ['code-simplifier@claude-plugins-official', true],
  ['claude-security@claude-plugins-official', true],
  ['vercel@claude-plugins-official', true],
  ['figma@claude-plugins-official', true],
  ['prisma@claude-plugins-official', true],
  ['learning-output-style@claude-plugins-official', true],
  ['explanatory-output-style@claude-plugins-official', true],
  ['control-panel@my-toolkit', true],
  ['secret-shield@my-toolkit', true],
  ['token-weather@my-toolkit', true],
  ['nudges@my-toolkit', true],
  ['deploy-status@my-toolkit', true],
  ['handoff@my-toolkit', true],
  ['learner@my-toolkit', true],
].map(([id, enabled]) => ({ id, version: '1.2.0', enabled, scope: 'user' }))

const MCP_LIST = `Checking MCP server health…

plugin:vercel:vercel: https://mcp.vercel.com (HTTP) - ! Needs authentication
plugin:prisma:Prisma-Local: npx -y prisma mcp - ✘ Failed to connect — CONNECTION_CLOSED: Connection closed
plugin:figma:figma: https://mcp.figma.com/mcp (HTTP) - ! Needs authentication
plugin:desktop-commander:desktop-commander: npx -y @wonderwhy-er/desktop-commander@latest - ✔ Connected
`

const COMMANDS = [
  'next-part', 'ship-check', 'manager-update', 'handoff-to-code', 'copy', 'handoff', 'deploy-status', 'scrub-secrets', 'learn-skills', 'nudge', 'skill-ideas',
  'code-review', 'security-review', 'simplify', 'feature-dev:feature-dev', 'pr-review-toolkit:review-pr', 'claude-security:claude-security',
  'vercel:deploy', 'vercel:env', 'frontend-design:frontend-design', 'figma:figma-design-to-code', 'engineering:debug', 'engineering:testing-strategy',
  'qodo:qodo-review', 'qodo:qodo-setup',
].map(name => ({ name, description: `${name} description`, source: 'user' }))

const PACKAGE = JSON.stringify({ dependencies: { next: '14.2.0', '@prisma/client': '6.19.0', 'next-auth': '4.24.0' } })
const HANDOFF = '---\ntitle: Live match scores\nstatus: open\n---\n# Goal\nScores on the homepage.\n'

type World = { ran: { command: string; args: string }[]; submitted: string[]; filled: string[]; processes: string[][]; reads: string[] }

function fakeEngine(on: any): World {
  const w: World = { ran: [], submitted: [], filled: [], processes: [], reads: [] }
  const store: Record<string, unknown> = {}
  on('session.root', () => ({ value: ROOT }))
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('clock.now', () => ({ value: NOW }))
  on('store.get', (_$: any, e: any) => ({ value: store[e.key] }))
  on('store.set', (_$: any, e: any) => {
    store[e.key] = e.value
    return { value: undefined }
  })
  on('command.register', () => ({ value: undefined }))
  on('command.list', () => ({ value: COMMANDS }))
  on('turn.start', (_$: any, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('fs.exists', (_$: any, e: any) => ({ value: /package\.json$|handoff\.md$/.test(e.path.replace(/\\/g, '/')) }))
  on('fs.read', (_$: any, e: any) => {
    const p = e.path.replace(/\\/g, '/')
    w.reads.push(p)
    return { value: p.endsWith('package.json') ? PACKAGE : HANDOFF }
  })
  on('process.run', (_$: any, e: any) => {
    const argv: string[] = e.argv
    w.processes.push(argv)
    const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false } })
    const fail = { value: { exitCode: 1, stdout: '', stderr: 'not found', isStdoutTruncated: false } }
    const cmd = argv.join(' ')
    if (cmd === 'claude plugin list --json') return ok(JSON.stringify(PLUGIN_LIST))
    if (cmd === 'claude mcp list') return ok(MCP_LIST)
    if (argv[0] === 'claude' && argv[1] === 'plugin') return ok('done')
    if (argv[0] === 'git') {
      if (argv.includes('--is-inside-work-tree')) return ok('true\n')
      if (argv.includes('--abbrev-ref')) return ok('feature/live-scores\n')
      if (argv.includes('status')) return ok(' M app/page.tsx\n M lib/x.ts\n')
      if (argv.includes('get-url')) return ok('https://github.com/example-org/basketball-platform.git\n')
    }
    return fail // where/which: no qodo, vercel or gh on PATH
  })
  on('command.run', (_$: any, e: any) => {
    w.ran.push({ command: e.command, args: e.args })
    return { text: e.command === 'deploy-status' ? 'Deployments for example-org/basketball-platform: prod success' : '' }
  })
  on('prompt.submit', (_$: any, e: any) => {
    w.submitted.push(e.text)
    return { text: e.text }
  })
  on('prompt.fill', (_$: any, e: any) => {
    w.filled.push(e.text)
    return { isFilled: true } as never
  })
  return w
}

// Stand-ins for the toolkit's mods, publishing what the real ones publish.
// Each is compiled on its own, so its values are written out literally.
const STAND_INS = [
  {
    name: 'secret-shield',
    register: (on: any) => {
      on('command.run', { command: 'seed-secret-shield' }, async ($: any) => {
        await $.state.set({ plugin: 'secret-shield', key: 'status' }, { protectedCount: 18, lastScrubAt: 1791208800000, lastScrubFiles: 17, lastScrubReplacements: 394 })
        return { text: '' }
      })
    },
  },
  {
    name: 'token-weather',
    register: (on: any) => {
      on('command.run', { command: 'seed-token-weather' }, async ($: any) => {
        await $.state.set({ plugin: 'token-weather', key: 'forecast' }, { history: [40000, 62000, 70000], window: 200000 })
        await $.state.set({ plugin: 'token-weather', key: 'limits' }, [{ kind: 'five_hour', percentUsed: 38 }, { kind: 'seven_day', percentUsed: 21 }])
        return { text: '' }
      })
    },
  },
  {
    name: 'nudges',
    register: (on: any) => {
      on('command.run', { command: 'seed-nudges' }, async ($: any) => {
        await $.state.set({ plugin: 'nudges', key: 'suggestion' }, { id: 'ship-after-push', command: 'ship-check', text: 'You just pushed. Check it and deploy a preview?' })
        return { text: '' }
      })
    },
  },
  {
    name: 'deploy-status',
    register: (on: any) => {
      on('command.run', { command: 'seed-deploy-status' }, async ($: any) => {
        await $.state.set({ plugin: 'deploy-status', key: 'info' }, { repo: 'example-org/basketball-platform', rows: [{ env: 'prod', sha: 'f1e209b', state: 'success', at: 1790006400000, url: 'https://example.com' }], headDeployed: null, checkedAt: 1791216000000 })
        return { text: '' }
      })
    },
  },
  {
    name: 'learner',
    register: (on: any) => {
      on('command.run', { command: 'seed-learner' }, async ($: any) => {
        await $.state.set({ plugin: 'learner', key: 'scan' }, { phase: 'done', message: '2 proposals.', proposals: [{ status: 'new' }, { status: 'new' }, { status: 'added' }] })
        return { text: '' }
      })
    },
  },
]

async function start($: any, surface: 'terminal' | 'desktop' = 'desktop') {
  await $.session.start({ source: 'startup', cwd: ROOT, surface: null, isInteractive: true } as never)
  for (const s of STAND_INS) await $.command.run({ command: `seed-${s.name}`, args: '' } as never)
  const ui = await $.ui.mount({ plugin: 'control-center', surface, component: 'Pane', requestId: 'control-center', props: {} as never })
  // Re-check so the background probes have settled before asserting.
  await ui.press({ key: 'nav-settings' })
  await ui.press({ key: 'refresh' })
  await ui.press({ key: 'nav-home' })
  return ui
}

const has = async (ui: any, text: RegExp) => (await ui.find({ text } as never)) !== undefined

// ---------------------------------------------------------------- navigation

for (const surface of ['terminal', 'desktop'] as const) {
  test(`every page opens on ${surface}`, { plugins: STAND_INS }, async ($, on) => {
    fakeEngine(on)
    const ui = await start($, surface)
    for (const p of ['home', 'actions', 'skills', 'plugins', 'workflows', 'system', 'installed', 'favourites', 'settings']) {
      await ui.press({ key: `nav-${p}` })
      expect(await ui.find({ key: `page-${p}` })).toBeDefined()
    }
    await ui.press({ key: 'hud' })
    expect(await ui.find({ key: 'page-weather' })).toBeDefined()
    expect(await has(ui, /Context: 35% · 70k \/ 200k/)).toBe(true)
  })
}

// ---------------------------------------------------------------- home answers the seven questions

test('home shows project, stage, next step, smart actions and live status', { plugins: STAND_INS }, async ($, on) => {
  fakeEngine(on)
  const ui = await start($)
  expect(await has(ui, /basketball-platform/)).toBe(true)
  expect(await has(ui, /feature\/live-scores/)).toBe(true)
  expect(await has(ui, /2 uncommitted/)).toBe(true)
  expect(await ui.find({ key: 'next-step' })).toBeDefined()
  expect(await has(ui, /READY TO SHIP/)).toBe(true)
  expect(await has(ui, /Handoff ready: Live match scores/)).toBe(true)
  expect(await has(ui, /2 skill ideas waiting/)).toBe(true)
  expect(await has(ui, /Protected · 18 secrets · scrubbed 2h ago/)).toBe(true)
  expect(await has(ui, /prod ✓ f1e209b 14d ago/)).toBe(true)
})

// ---------------------------------------------------------------- execution

test('a skill runs only after the preview, then follows the turn to its result', { plugins: STAND_INS }, async ($, on) => {
  const w = fakeEngine(on)
  const ui = await start($)
  await ui.press({ key: 'next-step' })
  expect(await has(ui, /You are about to run/)).toBe(true)
  expect(w.ran.map(r => r.command)).not.toContain('next-part')

  await ui.press({ key: 'confirm-run' })
  expect(w.ran.map(r => r.command)).toContain('next-part')
  expect(await has(ui, /Sent to Claude/)).toBe(true)

  await $.turn.start({ text: '', turnId: 't1' } as never)
  expect(await has(ui, /Running in the conversation/)).toBe(true)
  await $.turn.complete({ answer: 'Planned W10 part 1 and built it.', durationMs: 5, isAborted: false, turnId: 't1', reason: 'answer' } as never)
  expect(await has(ui, /Finished/)).toBe(true)
  expect(await has(ui, /Planned W10 part 1/)).toBe(true)
  expect(await ui.find({ key: 'next-ship-check' })).toBeDefined()
})

test('a command that answers at once shows its result', { plugins: STAND_INS }, async ($, on) => {
  const w = fakeEngine(on)
  const ui = await start($)
  await ui.press({ key: 'nav-skills' })
  await ui.press({ key: 'run-deploy-status' })
  await ui.press({ key: 'confirm-run' })
  expect(w.ran.map(r => r.command)).toContain('deploy-status')
  expect(await has(ui, /Deployments for example-org/)).toBe(true)
})

test('an action sends a prompt; a command needing input fills the prompt', { plugins: STAND_INS }, async ($, on) => {
  const w = fakeEngine(on)
  const ui = await start($)
  await ui.press({ key: 'quick-Test' })
  await ui.press({ key: 'confirm-run' })
  expect(w.submitted[0]).toMatch(/^Run this project's test suites/)

  await ui.press({ key: 'nav-skills' })
  await ui.press({ key: 'run-copy' })
  await ui.press({ key: 'confirm-run' })
  expect(w.filled).toContain('/copy ')
  expect(await has(ui, /Added to your prompt/)).toBe(true)
})

test('workflows launch as one request naming each skill; ones needing a goal fill the prompt', { plugins: STAND_INS }, async ($, on) => {
  const w = fakeEngine(on)
  const ui = await start($)
  await ui.press({ key: 'nav-workflows' })
  await ui.press({ key: 'launch-ship-safely' })
  await ui.press({ key: 'confirm-run' })
  expect(w.submitted[0]).toContain('Security + Ship')
  expect(w.submitted[0]).toContain('/code-review')
  expect(w.submitted[0]).toContain('/ship-check')

  await ui.press({ key: 'launch-full-stack' })
  await ui.press({ key: 'confirm-run' })
  expect(w.filled.at(-1)).toContain('Feature to build:')
  // Figma isn't in the Full-Stack workflow, but Prisma's failed connection is flagged optional, so it still runs.
  expect(w.filled.at(-1)).toContain('Database (Prisma)')
})

// ---------------------------------------------------------------- dependencies

test('real states: sign-in, setup, connection issue, not installed', { plugins: STAND_INS }, async ($, on) => {
  const w = fakeEngine(on)
  const ui = await start($)
  await ui.press({ key: 'nav-plugins' })
  expect(await has(ui, /Figma isn't signed in/)).toBe(true)
  expect(await has(ui, /Prisma \(local\) failed to connect \(CONNECTION_CLOSED\)/)).toBe(true)
  expect(await has(ui, /qodo command-line tool isn't installed/)).toBe(true)
  expect(await has(ui, /The vercel command-line tool isn't installed/)).toBe(true)

  await ui.press({ key: 'nav-actions' })
  // Figma needs a sign-in: the card offers the sign-in, which only fills /mcp.
  await ui.press({ key: 'fix-figma' })
  expect(w.filled).toContain('/mcp')
  expect(w.ran.map(r => r.command)).not.toContain('figma:figma-design-to-code')

  // Qodo needs setup: the setup action previews, then runs qodo-setup on confirm.
  await ui.press({ key: 'fix-qodo-review' })
  expect(await has(ui, /Installs the Qodo CLI/)).toBe(true)
  await ui.press({ key: 'confirm-run' })
  expect(w.ran.map(r => r.command)).toContain('qodo:qodo-setup')

  // A command this session doesn't offer shows as unavailable.
  await ui.press({ key: 'nav-actions' })
  expect(await has(ui, /zyte-web-data:scrape-plan isn't available/)).toBe(true)
})

test('a blocked capability cannot be run from its preview', { plugins: STAND_INS }, async ($, on) => {
  const w = fakeEngine(on)
  const ui = await start($)
  await ui.input({ key: 'search', text: 'figma', kind: 'change' })
  await ui.press({ key: 'hitrun-figma' })
  expect(await has(ui, /Can't run yet/)).toBe(true)
  expect(await ui.find({ key: 'confirm-run' })).toBeUndefined()
  expect(w.ran.length).toBe(0)
})

// ---------------------------------------------------------------- system modules and nudges

test('system modules show live status; nudges stay user-controlled', { plugins: STAND_INS }, async ($, on) => {
  const w = fakeEngine(on)
  const ui = await start($)
  await ui.press({ key: 'nav-system' })
  expect(await has(ui, /Protected · 18 secrets/)).toBe(true)
  expect(await has(ui, /Context 35% · 5h 38% · Weekly 21%/)).toBe(true)
  expect(await has(ui, /You just pushed/)).toBe(true)
  expect(await has(ui, /2 skill ideas awaiting/)).toBe(true)
  expect(await has(ui, /Ready: Live match scores/)).toBe(true)

  await ui.press({ key: 'nav-home' })
  await ui.press({ key: 'nudge-run' })
  expect(w.ran.map(r => r.command)).not.toContain('ship-check')
  await ui.press({ key: 'confirm-run' })
  expect(w.ran.map(r => r.command)).toContain('ship-check')

  await ui.press({ key: 'nudge-later' })
  expect(w.ran).toContainEqual({ command: 'nudge', args: 'later' })
})

// ---------------------------------------------------------------- safety

test('never reads the secret vault or settings, and offers no allow-secrets shortcut', { plugins: STAND_INS }, async ($, on) => {
  const w = fakeEngine(on)
  const ui = await start($)
  for (const p of ['home', 'actions', 'skills', 'plugins', 'workflows', 'system', 'installed', 'settings']) await ui.press({ key: `nav-${p}` })
  expect(w.reads.some(p => /secret-shield|settings\.json|\.credentials|\.env/.test(p))).toBe(false)
  expect(await has(ui, /allow-secrets/)).toBe(false)
})

// ---------------------------------------------------------------- output style and settings

test('output style selector turns one style on and the other off, after confirming', { plugins: STAND_INS }, async ($, on) => {
  const w = fakeEngine(on)
  const ui = await start($)
  await ui.press({ key: 'nav-settings' })
  expect(await has(ui, /Both on \(conflicting\)/)).toBe(true)
  await ui.press({ key: 'style-learning' })
  expect(w.processes.some(a => a[2] === 'enable')).toBe(false)
  await ui.press({ key: 'confirm-setting' })
  expect(w.processes).toContainEqual(['claude', 'plugin', 'enable', 'learning-output-style@claude-plugins-official'])
  expect(w.processes).toContainEqual(['claude', 'plugin', 'disable', 'explanatory-output-style@claude-plugins-official'])

  await ui.press({ key: 'classic-off' })
  await ui.press({ key: 'confirm-setting' })
  expect(w.processes).toContainEqual(['claude', 'plugin', 'disable', 'control-panel@my-toolkit'])
})

// ---------------------------------------------------------------- search and favourites

test('plain-language search; Enter previews the top match', { plugins: STAND_INS }, async ($, on) => {
  fakeEngine(on)
  const ui = await start($)
  await ui.input({ key: 'search', text: 'deploy my app', kind: 'change' })
  expect(await ui.find({ key: 'hitrun-ship-check' })).toBeDefined()
  await ui.input({ key: 'search', text: 'deploy my app' })
  expect(await has(ui, /🚀 Ship Check/)).toBe(true)
  expect(await ui.find({ key: 'confirm-run' })).toBeDefined()
})

test('favourites pin and unpin', { plugins: STAND_INS }, async ($, on) => {
  fakeEngine(on)
  const ui = await start($)
  await ui.press({ key: 'nav-skills' })
  await ui.press({ key: 'fav-ship-check' })
  await ui.press({ key: 'nav-favourites' })
  expect(await ui.find({ key: 'card-ship-check' })).toBeDefined()
  await ui.press({ key: 'fav-ship-check' })
  expect(await ui.find({ key: 'card-ship-check' })).toBeUndefined()
})
