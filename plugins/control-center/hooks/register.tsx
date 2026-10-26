import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import { CAPABILITIES, EMPTY_ENV, OUTPUT_STYLE_PLUGINS, capById, capabilityStatus, search, workflowById, workflowPrompt } from './registry'
import type { Env, Exec, Fix, Level } from './registry'
import { ControlCenter } from './views'
import type { Model, ModuleView } from './views'
import type { EnvSnapshot, Flow, Page, PendingSetting } from '../types'

// The Control Center: one pane over everything this Claude Code setup can do.
// It reads the real environment (plugins, MCP health, CLIs, the project, the
// toolkit's own published state), and runs things only through Claude Code's
// own commands and prompt, so every permission prompt and plan-mode approval
// still applies. It never reads secret values or settings beyond plugin state.

const PANE = 'control-center'

const page = atom({ plugin: 'control-center', key: 'page' } as const, 'home' as Page)
const query = atom({ plugin: 'control-center', key: 'query' } as const, '')
const flow = atom({ plugin: 'control-center', key: 'flow' } as const, null as Flow | null)
const env = atom({ plugin: 'control-center', key: 'env' } as const, EMPTY_ENV as EnvSnapshot)
const stage = atom({ plugin: 'control-center', key: 'stage' } as const, null as string | null)
const favourites = atom({ plugin: 'control-center', key: 'favourites' } as const, [] as string[])
const expanded = atom({ plugin: 'control-center', key: 'expanded' } as const, null as string | null)
const pending = atom({ plugin: 'control-center', key: 'pending' } as const, null as PendingSetting | null)
// Quiet by default: the pane opens when asked (/cc, /control-center), unless the person turns
// "open at start" on in the pane itself.
const autoOpen = atom({ plugin: 'control-center', key: 'autoOpen' } as const, false)
const notice = atom({ plugin: 'control-center', key: 'notice' } as const, null as string | null)

// What the toolkit's other mods publish (read only; each mod owns its own).
const twForecast = atom({ plugin: 'token-weather', key: 'forecast' } as const, null as { history: number[]; window: number } | null)
const twLimits = atom({ plugin: 'token-weather', key: 'limits' } as const, [] as { kind: string; percentUsed: number; resetsAt?: string }[])
const nudge = atom({ plugin: 'nudges', key: 'suggestion' } as const, null as { id: string; command: string; text: string } | null)
const learnerScan = atom({ plugin: 'learner', key: 'scan' } as const, { phase: 'idle', message: '', proposals: [] } as { phase: string; message: string; proposals: { status: string }[] })
const shieldStatus = atom({ plugin: 'secret-shield', key: 'status' } as const, null as { protectedCount: number; lastScrubAt: number | null; lastScrubFiles: number; lastScrubReplacements: number } | null)
const deployInfo = atom({ plugin: 'deploy-status', key: 'info' } as const, null as { repo: string | null; rows: { env: string; sha: string; state: string; at: number; url?: string }[]; headDeployed: string | null; checkedAt: number | null } | null)

const TOOLKIT = '@my-toolkit'
const clip = (s: string, n: number) => {
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length > n ? `${one.slice(0, n - 1)}…` : one
}

function ago(ms: number): string {
  const m = Math.round(ms / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 48) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

function resetLabel(iso: string | undefined, now: number): string {
  if (!iso) return ''
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  const hm = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
  return at.getTime() - now < 86_400_000 ? hm : `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][at.getDay()]} ${hm}`
}

// ---------------------------------------------------------------- probes

async function sh($: any, argv: string[], timeoutMs = 30_000): Promise<string | null> {
  try {
    const run = await $.process.run(argv, { timeoutMs })
    return run.exitCode === 0 ? run.stdout : null
  } catch {
    return null
  }
}

async function patchEnv($: any, patch: Partial<EnvSnapshot>): Promise<void> {
  const current = await read($, env)
  const next: EnvSnapshot = { ...current, ...patch }
  await update($, env, () => next)
  // Cached for the next session; holds names and states only.
  await $.store.set('env', { ...next, project: null, commands: [] })
}

async function probeProject($: any): Promise<void> {
  const root: string = (await $.session.root()).replace(/\\/g, '/')
  const name = root.split('/').filter(Boolean).pop() ?? root
  const inside = await sh($, ['git', '-C', root, 'rev-parse', '--is-inside-work-tree'])
  const hasGit = inside !== null && inside.trim() === 'true'
  const branch = hasGit ? ((await sh($, ['git', '-C', root, 'rev-parse', '--abbrev-ref', 'HEAD'])) ?? '').trim() || null : null
  const status = hasGit ? ((await sh($, ['git', '-C', root, 'status', '--porcelain'])) ?? '') : ''
  const remote = hasGit ? ((await sh($, ['git', '-C', root, 'remote', 'get-url', 'origin'])) ?? '') : ''

  let deps: Record<string, string> = {}
  if (await $.fs.exists(`${root}/package.json`)) {
    try {
      const pkg = JSON.parse(await $.fs.read(`${root}/package.json`))
      deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }
    } catch {
      deps = {}
    }
  }
  const auth = deps['next-auth'] ? 'next-auth' : Object.keys(deps).find(d => d.startsWith('@auth0/')) ? 'auth0' : null

  let handoff: { title: string; status: string } | null = null
  if (await $.fs.exists(`${root}/.claude/handoff.md`)) {
    const text: string = await $.fs.read(`${root}/.claude/handoff.md`)
    const front = /^---\s*\n([\s\S]*?)\n---/.exec(text)?.[1] ?? ''
    const field = (k: string) => new RegExp(`^${k}:\\s*(.+)$`, 'mi').exec(front)?.[1].trim()
    handoff = { title: field('title') ?? 'Untitled handoff', status: (field('status') ?? 'open').toLowerCase() }
  }

  await patchEnv($, {
    project: {
      root,
      name,
      hasGit,
      branch,
      changed: status.split('\n').filter(l => l.trim()).length,
      github: /github\.com[/:]/.test(remote),
      next: 'next' in deps,
      prisma: 'prisma' in deps || '@prisma/client' in deps,
      auth,
      resend: 'resend' in deps,
      handoff,
    },
  })
}

async function probeCommands($: any): Promise<void> {
  const list: { name: string }[] = await $.command.list()
  await patchEnv($, { commands: list.map(c => c.name) })
}

async function probePlugins($: any): Promise<void> {
  const out = await sh($, ['claude', 'plugin', 'list', '--json'], 60_000)
  if (out === null) return
  try {
    const items: { id: string; version: string; enabled: boolean }[] = JSON.parse(out)
    const plugins: Record<string, { version: string; enabled: boolean }> = {}
    for (const p of items) plugins[p.id] = { version: p.version, enabled: p.enabled }
    await patchEnv($, { plugins })
  } catch {
    // Leave the last known state.
  }
}

async function probeClis($: any): Promise<void> {
  const clis: Record<string, boolean> = {}
  for (const name of ['qodo', 'vercel', 'gh']) {
    const found = (await sh($, ['where', name], 10_000)) ?? (await sh($, ['which', name], 10_000))
    clis[name] = found !== null && found.trim() !== ''
  }
  await patchEnv($, { clis })
}

// `claude mcp list` checks each server's health; it is slow, so it runs in the
// background and its last answer is kept.
async function probeMcp($: any): Promise<void> {
  const out = await sh($, ['claude', 'mcp', 'list'], 120_000)
  if (out === null) return
  const mcp: EnvSnapshot['mcp'] = {}
  for (const line of out.split('\n')) {
    const m = /^(\S[^:]*(?::[^:\s]+)*): .* - (✔|!|✘) (.*)$/.exec(line.trim())
    if (!m) continue
    const [, server, mark, rest] = m
    if (mark === '✔') mcp[server] = { status: 'ok' }
    else if (mark === '!') mcp[server] = { status: 'auth' }
    else mcp[server] = { status: 'failed', detail: /—\s*([A-Z_]+)/.exec(rest)?.[1] }
  }
  await patchEnv($, { mcp, mcpCheckedAt: await $.clock.now() })
}

async function refreshAll($: any, withMcp: boolean): Promise<void> {
  await Promise.all([probeProject($), probeCommands($), probeClis($)])
  await probePlugins($)
  await patchEnv($, { checkedAt: await $.clock.now() })
  if (withMcp) await probeMcp($)
}

// ---------------------------------------------------------------- running things

async function setFlow($: any, next: Flow | null): Promise<void> {
  await update($, flow, () => next)
}

// Runs through Claude Code itself: a command as if typed, a prompt as the
// person's own words, or text placed in the prompt for them to finish.
async function execute($: any, exec: Exec, base: Flow): Promise<void> {
  try {
    if (exec.via === 'fill') {
      await $.prompt.fill({ text: exec.text })
      await setFlow($, { ...base, phase: 'filled' })
    } else if (exec.via === 'prompt') {
      await setFlow($, { ...base, phase: 'launched' })
      await $.prompt.submit({ text: exec.text, asUser: true })
    } else {
      await setFlow($, { ...base, phase: 'launched' })
      const res = await $.command.run({ command: exec.command, args: exec.args ?? '' })
      const current = await read($, flow)
      if (res?.text && current && current.phase === 'launched') await setFlow($, { ...current, phase: 'done', message: clip(res.text, 240) })
    }
  } catch (err) {
    await setFlow($, { ...base, phase: 'failed', message: clip((err as Error).message ?? 'It did not start.', 200) })
  }
}

async function confirmFlow($: any): Promise<void> {
  const f = await read($, flow)
  if (!f || f.phase !== 'preview') return
  const now: number = await $.clock.now()
  const base: Flow = { ...f, at: now }
  if (f.kind === 'fix' && f.fix) return execute($, f.fix.exec, base)
  if (f.kind === 'capability') {
    const cap = capById(f.id)
    if (!cap) return
    const st = capabilityStatus(cap, (await read($, env)) as Env)
    if (!['ready', 'attention'].includes(st.level)) return
    if (cap.stage) await update($, stage, () => cap.stage!)
    return execute($, cap.exec, base)
  }
  const w = workflowById(f.id)
  if (!w) return
  const prompt = workflowPrompt(w, (await read($, env)) as Env)
  return execute($, w.ask ? { via: 'fill', text: `${prompt}\n${w.ask}` } : { via: 'prompt', text: prompt }, base)
}

async function openPreview($: any, kind: 'capability' | 'workflow', id: string): Promise<void> {
  await setFlow($, { kind, id, phase: 'preview', at: await $.clock.now() })
}

async function openFix($: any, fix: Fix): Promise<void> {
  const base: Flow = { kind: 'fix', id: fix.label, fix, phase: 'preview', at: await $.clock.now() }
  // Filling the prompt changes nothing, so it needs no extra confirmation.
  if (fix.exec.via === 'fill') return execute($, fix.exec, base)
  await setFlow($, base)
}

async function applySetting($: any): Promise<void> {
  const p = await read($, pending)
  if (!p) return
  const steps: string[][] = []
  steps.push(['claude', 'plugin', p.style === 'learning' ? 'enable' : 'disable', OUTPUT_STYLE_PLUGINS.learning])
  steps.push(['claude', 'plugin', p.style === 'explanatory' ? 'enable' : 'disable', OUTPUT_STYLE_PLUGINS.explanatory])
  let failed = 0
  for (const argv of steps) if ((await sh($, argv, 60_000)) === null) failed++
  await update($, pending, () => null)
  await probePlugins($)
  const msg = failed ? `Some changes didn't apply (${failed} of ${steps.length}). Check /plugin.` : 'Done. It takes effect in new sessions.'
  await update($, notice, () => msg)
}

async function toggleFavourite($: any, id: string): Promise<void> {
  const list = await read($, favourites)
  const next = list.includes(id) ? list.filter(x => x !== id) : [...list, id]
  await update($, favourites, () => next)
  await $.store.set('favourites', next)
}

// ---------------------------------------------------------------- the model

async function buildModel($: any, surface: string): Promise<Model> {
  const e = (await read($, env)) as Env
  const now: number = await $.clock.now()
  const f = await read($, twForecast)
  const lims = await read($, twLimits)
  const n = await read($, nudge)
  const scan = await read($, learnerScan)
  const shield = await read($, shieldStatus)
  const deploy = await read($, deployInfo)

  const last = f && f.history.length ? f.history[f.history.length - 1] : null
  const prev = f && f.history.length > 1 ? f.history[f.history.length - 2] : null
  const percent = f && last !== null && f.window > 0 ? Math.round((last / f.window) * 100) : null
  const weather = {
    percent,
    tokens: last,
    window: f?.window ?? null,
    delta: f && last !== null && prev !== null && f.window > 0 ? ((last - prev) / f.window) * 100 : null,
    history: f?.history ?? [],
    limits: lims.map(l => ({ kind: l.kind, percentUsed: l.percentUsed, resets: resetLabel(l.resetsAt, now) })),
  }

  const on = (name: string): boolean | null => (e.plugins ? !!e.plugins[`${name}${TOOLKIT}`]?.enabled : null)
  const mod = (id: string, icon: string, name: string, fn: () => Omit<ModuleView, 'id' | 'icon' | 'name'>): ModuleView => {
    const enabled = on(id)
    if (enabled === false) return { id, icon, name, level: 'disabled', summary: 'Turned off.', detail: [], actions: [] }
    return { id, icon, name, ...fn() }
  }
  const waiting = scan.proposals.filter(p => p.status === 'new').length
  const handoff = e.project?.handoff ?? null
  const failing = deploy?.rows.find(r => r.state === 'failure' || r.state === 'error')

  const modules: ModuleView[] = [
    mod('secret-shield', '🔒', 'Secret Shield', () => ({
      level: !shield ? 'ready' : shield.lastScrubAt === null ? 'attention' : 'ready',
      summary: shield
        ? `Protected · ${shield.protectedCount} secrets · ${shield.lastScrubAt ? `scrubbed ${ago(now - shield.lastScrubAt)}` : 'not scrubbed yet'}`
        : 'Protected · status arrives once it reports',
      detail: [
        'Secrets you paste are swapped for placeholders before Claude sees them.',
        shield?.lastScrubAt ? `Last scrub: ${shield.lastScrubReplacements} copies in ${shield.lastScrubFiles} files.` : 'Old transcripts are scrubbed at each session start.',
        'Values are never shown here.',
      ],
      actions: [{ key: 'mod-scrub', label: '🧽 Scrub now', act: () => void openPreview($, 'capability', 'scrub-secrets') }],
    })),
    mod('token-weather', percent !== null && percent >= 90 ? '↯' : '☀', 'Token Weather', () => ({
      level: percent !== null && percent >= 90 ? 'attention' : 'ready',
      summary: [percent === null ? 'Context: no reading yet' : `Context ${percent}%`, ...weather.limits.map(l => `${l.kind === 'five_hour' ? '5h' : l.kind === 'seven_day' ? 'Weekly' : l.kind} ${Math.round(l.percentUsed)}%`)].join(' · '),
      detail: percent !== null && percent >= 90 ? ['The context window is nearly full: compact soon.'] : [],
      actions: [{ key: 'mod-weather', label: 'Open details', act: () => void update($, page, () => 'weather' as Page) }],
    })),
    mod('nudges', '✻', 'Nudges', () => ({
      level: 'ready',
      summary: n ? n.text : 'No suggestion right now.',
      detail: ['Suggests a command at the right moment; nothing runs without your click.'],
      actions: n
        ? [
            { key: 'mod-nudge-run', label: '▶ Run', act: () => void openPreview($, 'capability', capById(n.command)?.id ?? n.command) },
            { key: 'mod-nudge-later', label: 'Not now', act: () => void $.command.run({ command: 'nudge', args: 'later' }) },
          ]
        : [],
    })),
    mod('deploy-status', '🚀', 'Deploy Status', () => ({
      level: failing ? 'error' : !deploy || deploy.repo === null ? 'info' : 'ready',
      summary: !deploy
        ? 'Waiting for the first check.'
        : deploy.repo === null
          ? 'No GitHub remote in this project.'
          : deploy.rows.length === 0
            ? `No Vercel deployments found for ${deploy.repo}.`
            : deploy.rows.map(r => `${r.env} ${r.state === 'success' ? '✓' : r.state === 'failure' || r.state === 'error' ? '✗' : '…'} ${r.sha} ${ago(now - r.at)}`).join(' · '),
      detail: deploy?.rows.filter(r => r.url).map(r => `${r.env}: ${r.url}`) ?? [],
      actions: deploy?.repo ? [{ key: 'mod-deploy', label: 'List deployments', act: () => void openPreview($, 'capability', 'deploy-status') }] : [],
    })),
    mod('handoff', '🔄', 'Handoff', () => ({
      level: handoff && handoff.status !== 'done' ? 'attention' : 'ready',
      summary: handoff ? `${handoff.status === 'open' ? 'Ready' : handoff.status === 'done' ? 'Done' : 'In progress'}: ${handoff.title}` : 'No handoff in this project.',
      detail: ['Cowork writes .claude/handoff.md; Claude reads it with your first message.'],
      actions: handoff ? [{ key: 'mod-handoff', label: '▶ View handoff', act: () => void openPreview($, 'capability', 'handoff') }] : [],
    })),
    mod('learner', '🧠', 'Learner', () => ({
      level: waiting > 0 ? 'attention' : 'ready',
      summary: waiting > 0 ? `${waiting} skill ideas awaiting your approval.` : scan.phase === 'idle' ? 'No scan yet this session.' : scan.message || 'Nothing new.',
      detail: ['Nothing is created without your approval.'],
      actions: [
        ...(waiting > 0 ? [{ key: 'mod-learner-review', label: 'Review ideas', act: () => void $.command.run({ command: 'skill-ideas', args: '' }) }] : []),
        { key: 'mod-learner-scan', label: 'Scan now', act: () => void openPreview($, 'capability', 'learn-skills') },
      ],
    })),
  ]

  const ls = e.plugins?.[OUTPUT_STYLE_PLUGINS.learning]?.enabled
  const ex = e.plugins?.[OUTPUT_STYLE_PLUGINS.explanatory]?.enabled
  const outputStyle: Model['outputStyle'] = !e.plugins ? 'unknown' : ls && ex ? 'both' : ls ? 'learning' : ex ? 'explanatory' : 'off'

  return {
    surface,
    page: await read($, page),
    query: await read($, query),
    flow: await read($, flow),
    env: e,
    stage: await read($, stage),
    favourites: await read($, favourites),
    expanded: await read($, expanded),
    pending: await read($, pending),
    autoOpen: await read($, autoOpen),
    notice: await read($, notice),
    weather,
    modules,
    nudge: n,
    learnerWaiting: waiting,
    deploy: deploy ? { rows: deploy.rows.map(r => ({ env: r.env, sha: r.sha, state: r.state, ago: ago(now - r.at), url: r.url })), headDeployed: deploy.headDeployed, repo: deploy.repo } : null,
    outputStyle,
  }
}

// Which capability a command belongs to, for following the stage.
const stageOfCommand = (name: string) => CAPABILITIES.find(c => c.exec.via === 'command' && c.exec.command === name)?.stage ?? null

// ---------------------------------------------------------------- hooks

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command.register({ name: 'control-center', description: 'Open the Control Center: everything Claude can do for this project, one click away' })
    await $.command.register({ name: 'cc', description: 'Open the Control Center with the search ready ("What do you want Claude to do?")' })

    const cached = (await $.store.get('env')) as EnvSnapshot | undefined
    if (cached) await update($, env, () => ({ ...EMPTY_ENV, ...cached, project: null, commands: [] }))
    const favs = (await $.store.get('favourites')) as string[] | undefined
    if (favs) await update($, favourites, () => favs)
    const open = ((await $.store.get('autoOpen')) as boolean | undefined) ?? false
    await update($, autoOpen, () => open)

    void refreshAll($, true)
    if (open) void $.ui.open({ id: PANE, title: 'Control Center' })
    return result
  })

  on('command.run', { command: 'control-center' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Control Center' })
    void refreshAll($, false)
    return { text: 'Control Center opened.' }
  })

  on('command.run', { command: 'cc' }, async ($, e) => {
    if (e.args.trim()) await update($, query, () => e.args.trim())
    await update($, page, () => 'home' as Page)
    await $.ui.open({ id: PANE, title: 'Control Center', focus: true })
    return { text: 'Control Center opened. Type what you want Claude to do.' }
  })

  // Follow the work: any command run elsewhere moves the current stage.
  on('command.run', async ($, e, next) => {
    const s = stageOfCommand(e.command)
    if (s) await update($, stage, () => s)
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    const m = /^\s*\/([\w:-]+)/.exec(e.text)
    const s = m ? stageOfCommand(m[1]) : null
    if (s) await update($, stage, () => s)
    return next(e)
  })

  // Real progress: the turn a launched run starts, and how it ends.
  on('turn.start', async ($, e, next) => {
    const f = await read($, flow)
    if (f && f.phase === 'launched') await setFlow($, { ...f, phase: 'running', turnId: e.turnId })
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) return result
    const f = await read($, flow)
    if (f && (f.phase === 'running' || f.phase === 'launched') && (!f.turnId || f.turnId === e.turnId)) {
      const message =
        e.reason === 'aborted' ? 'Stopped before it finished.' : e.reason === 'error' ? 'Ended with an error; see the conversation.' : e.answer ? clip(e.answer, 240) : 'See the conversation for the result.'
      await setFlow($, { ...f, phase: e.reason === 'answer' ? 'done' : 'failed', message })
    }
    return result
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const E = $.ui.resolve(e)
    const m = await buildModel($, e.surface)
    return ControlCenter(E, m, {
      go: p => {
        void update($, page, () => p)
        void update($, notice, () => null)
      },
      setQuery: q => void update($, query, () => q),
      submitQuery: () => {
        const top = search(m.query, 1)[0]
        if (top && top.kind !== 'plugin') void openPreview($, top.kind, top.id)
        else if (top) void update($, page, () => 'plugins' as Page)
      },
      preview: (kind, id) => void openPreview($, kind, id),
      previewFix: fix => void openFix($, fix),
      confirm: () => void confirmFlow($),
      dismissFlow: () => void setFlow($, null),
      toggleFavourite: id => void toggleFavourite($, id),
      toggleDetails: id => void update($, expanded, cur => (cur === id ? null : id)),
      nudgeRun: () => {
        if (m.nudge) void openPreview($, 'capability', capById(m.nudge.command)?.id ?? m.nudge.command)
      },
      nudgeLater: () => void $.command.run({ command: 'nudge', args: 'later' }),
      openLearner: () => void $.command.run({ command: 'skill-ideas', args: '' }),
      refresh: () => void refreshAll($, true),
      requestSetting: p => void update($, pending, () => p),
      confirmSetting: () => void applySetting($),
      cancelSetting: () => void update($, pending, () => null),
      setAutoOpen: v => {
        void update($, autoOpen, () => v)
        void $.store.set('autoOpen', v)
      },
    })
  })
}

export type { Level }
