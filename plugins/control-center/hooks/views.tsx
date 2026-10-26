// The Control Center's pages: pure drawing from a model and a set of actions.
// No engine calls here; register.tsx builds the model and owns every action.

import {
  CAPABILITIES,
  LEVEL_ICON,
  LEVEL_LABEL,
  PLUGINS,
  QUICK_ACTIONS,
  STAGES,
  WORKFLOWS,
  capById,
  capabilityStatus,
  pluginById,
  pluginStatus,
  search,
  workflowById,
} from './registry'
import type { Capability, Env, Fix, Level, Status, Workflow } from './registry'
import type { Flow, Page, PendingSetting } from '../types'

// ---------------------------------------------------------------- model and actions

export type ModuleView = {
  id: string
  icon: string
  name: string
  level: Level
  summary: string
  detail: string[]
  actions: { key: string; label: string; act: () => void }[]
}

export type Weather = {
  percent: number | null
  tokens: number | null
  window: number | null
  delta: number | null
  history: number[]
  limits: { kind: string; percentUsed: number; resets: string }[]
}

export type Model = {
  surface: string
  page: Page
  query: string
  flow: Flow | null
  env: Env
  stage: string | null
  favourites: string[]
  expanded: string | null
  pending: PendingSetting | null
  autoOpen: boolean
  notice: string | null
  weather: Weather
  modules: ModuleView[]
  nudge: { id: string; command: string; text: string } | null
  learnerWaiting: number
  deploy: { rows: { env: string; sha: string; state: string; ago: string; url?: string }[]; headDeployed: string | null; repo: string | null } | null
  outputStyle: 'off' | 'learning' | 'explanatory' | 'both' | 'unknown'
}

export type Actions = {
  go: (page: Page) => void
  setQuery: (q: string) => void
  submitQuery: () => void
  preview: (kind: 'capability' | 'workflow', id: string) => void
  previewFix: (fix: Fix) => void
  confirm: () => void
  dismissFlow: () => void
  toggleFavourite: (id: string) => void
  toggleDetails: (id: string) => void
  nudgeRun: () => void
  nudgeLater: () => void
  openLearner: () => void
  refresh: () => void
  requestSetting: (p: PendingSetting) => void
  confirmSetting: () => void
  cancelSetting: () => void
  setAutoOpen: (on: boolean) => void
}

type E = any

// ---------------------------------------------------------------- small parts

const COLOR: Record<Level, string> = {
  ready: '#3FB950',
  attention: '#D29922',
  setup: '#D29922',
  signin: '#D29922',
  connection: '#DB6D28',
  error: '#F85149',
  info: '#58A6FF',
  disabled: 'inactive',
}

function Chip(E: E, key: string, level: Level, label?: string, checking = false) {
  return (
    <E.Text key={key} color={checking ? 'inactive' : COLOR[level]}>
      {checking ? '◌ CHECKING' : `${LEVEL_ICON[level]} ${label ?? LEVEL_LABEL[level]}`}
    </E.Text>
  )
}

function Heading(E: E, key: string, text: string) {
  return (
    <E.Text key={key} bold color="inactive">
      {text.toUpperCase()}
    </E.Text>
  )
}

const runLabel = (cap: Capability) => (cap.exec.via === 'fill' ? '▶ USE' : '▶ RUN')

function CapCard(E: E, m: Model, a: Actions, cap: Capability) {
  const st = capabilityStatus(cap, m.env)
  const fav = m.favourites.includes(cap.id)
  const open = m.expanded === cap.id
  const blocked = !['ready', 'attention'].includes(st.level)
  return (
    <E.Box key={`card-${cap.id}`} flexDirection="column" borderStyle="round" borderColor="subtle" paddingX={1}>
      <E.Box flexDirection="row" gap={1}>
        <E.Text bold>
          {cap.icon} {cap.name}
        </E.Text>
        {Chip(E, `chip-${cap.id}`, st.level, undefined, st.checking && st.level === 'ready')}
      </E.Box>
      <E.Text color="inactive">{cap.description}</E.Text>
      {blocked && st.problems[0] ? <E.Text color={COLOR[st.problems[0].level]}>{st.problems[0].text}</E.Text> : null}
      <E.Box flexDirection="row" gap={1}>
        {blocked && st.problems[0]?.fix ? (
          <E.Button key={`fix-${cap.id}`} label={st.problems[0].fix.label} variant="primary" onPress={() => a.previewFix(st.problems[0].fix!)} />
        ) : (
          <E.Button key={`run-${cap.id}`} label={runLabel(cap)} variant="primary" onPress={() => a.preview('capability', cap.id)} />
        )}
        <E.Button key={`fav-${cap.id}`} label={fav ? '★' : '☆'} plain onPress={() => a.toggleFavourite(cap.id)} />
        <E.Button key={`details-${cap.id}`} label={open ? 'Hide' : 'Details'} plain onPress={() => a.toggleDetails(cap.id)} />
      </E.Box>
      {open ? Details(E, m, cap, st) : null}
    </E.Box>
  )
}

function Details(E: E, m: Model, cap: Capability, st: Status) {
  const how = cap.exec.via === 'command' ? `/${cap.exec.command}` : cap.exec.via === 'fill' ? `${cap.exec.text.trim()} …` : 'a request to Claude'
  return (
    <E.Box key={`detail-${cap.id}`} flexDirection="column">
      <E.Text color="inactive">
        {cap.type} · {cap.source}
        {cap.plugin ? ` · ${cap.plugin}` : ''} · runs {how}
      </E.Text>
      <E.Text color="inactive">Requires:</E.Text>
      {cap.needs.length === 0 ? <E.Text color="inactive">  nothing</E.Text> : null}
      {cap.needs.map((n, i) => {
        const label =
          n.kind === 'command' ? `/${n.name} available` : n.kind === 'plugin' ? `${n.id.split('@')[0]} plugin on` : n.kind === 'mcp' ? `${n.label} connected${n.optional ? ' (optional)' : ''}` : n.kind === 'cli' ? `${n.name} CLI installed` : `project: ${n.check}`
        const bad = st.problems.find(p => p.need === i)
        return (
          <E.Text key={`need-${cap.id}-${i}`} color={bad ? COLOR[bad.level] : COLOR.ready}>
            {'  '}
            {bad ? '✗' : '✓'} {label}
          </E.Text>
        )
      })}
    </E.Box>
  )
}

function WorkflowCard(E: E, m: Model, a: Actions, w: Workflow) {
  const fav = m.favourites.includes(`wf:${w.id}`)
  return (
    <E.Box key={`wf-${w.id}`} flexDirection="column" borderStyle="round" borderColor="subtle" paddingX={1}>
      <E.Text bold>
        {w.icon} {w.name}
      </E.Text>
      <E.Text color="inactive">{w.description}</E.Text>
      {w.steps.map((s, i) => {
        const cap = capById(s.cap)!
        const st = capabilityStatus(cap, m.env)
        return (
          <E.Text key={`wfstep-${w.id}-${i}`} color={['ready', 'attention'].includes(st.level) ? undefined : 'inactive'}>
            {'  '}
            {i + 1}. {LEVEL_ICON[st.level]} {cap.name} <E.Text color="inactive">· {s.why}</E.Text>
          </E.Text>
        )
      })}
      <E.Box flexDirection="row" gap={1}>
        <E.Button key={`launch-${w.id}`} label="▶ LAUNCH WORKFLOW" variant="primary" onPress={() => a.preview('workflow', w.id)} />
        <E.Button key={`fav-wf-${w.id}`} label={fav ? '★' : '☆'} plain onPress={() => a.toggleFavourite(`wf:${w.id}`)} />
      </E.Box>
    </E.Box>
  )
}

// ---------------------------------------------------------------- header, search, flow

function Header(E: E, m: Model, a: Actions) {
  const w = m.weather
  const icon = w.percent === null ? '☀' : w.percent < 25 ? '☀' : w.percent < 50 ? '☁' : w.percent < 75 ? '☂' : w.percent < 90 ? '☇' : '↯'
  const lim = (kind: string) => m.weather.limits.find(l => l.kind === kind)
  const hud = [
    `${icon} Context ${w.percent === null ? '—' : `${w.percent}%`}`,
    w.delta !== null ? `${w.delta >= 0 ? '↑' : '↓'} ${w.delta >= 0 ? '+' : ''}${w.delta.toFixed(1)}%` : null,
    lim('five_hour') ? `5h ${Math.round(lim('five_hour')!.percentUsed)}%` : null,
    lim('seven_day') ? `Weekly ${Math.round(lim('seven_day')!.percentUsed)}%` : null,
  ]
    .filter(Boolean)
    .join(' | ')
  return (
    <E.Box key="header" flexDirection="column">
      <E.Text bold color="claude">
        ✻ Claude Code Control Center
      </E.Text>
      <E.Button key="hud" label={hud} plain onPress={() => a.go('weather')} />
    </E.Box>
  )
}

function Nav(E: E, m: Model, a: Actions) {
  const items: [Page, string][] = [
    ['home', '🏠 Home'],
    ['actions', '⚡ Actions'],
    ['skills', '🧠 Skills'],
    ['plugins', '🧩 Plugins'],
    ['workflows', '🛠 Workflows'],
    ['system', '🛡 System'],
    ['installed', '📦 Installed'],
    ['favourites', '⭐ Favourites'],
    ['settings', '⚙ Settings'],
  ]
  return (
    <E.Box key="nav" flexDirection="row" flexWrap="wrap" gap={1}>
      {items.map(([page, label]) => (
        <E.Button key={`nav-${page}`} label={label} plain dimColor={m.page !== page} onPress={() => a.go(page)} />
      ))}
    </E.Box>
  )
}

function Search(E: E, m: Model, a: Actions) {
  const hits = m.query.trim() ? search(m.query) : []
  return (
    <E.Box key="search-box" flexDirection="column">
      <E.Input
        key="search"
        placeholder="What do you want Claude to do?"
        value={m.query}
        onInput={(v: string) => a.setQuery(v)}
        onSubmit={() => a.submitQuery()}
      />
      {hits.map((hit, i) => {
        if (hit.kind === 'capability') {
          const cap = capById(hit.id)!
          const st = capabilityStatus(cap, m.env)
          return (
            <E.Box key={`hit-${hit.id}`} flexDirection="row" gap={1}>
              <E.Button key={`hitrun-${hit.id}`} label={`${cap.icon} ${cap.name}`} plain onPress={() => a.preview('capability', cap.id)} />
              <E.Text color={COLOR[st.level]}>{LEVEL_ICON[st.level]}</E.Text>
              {i === 0 ? <E.Text color="inactive">↵</E.Text> : null}
            </E.Box>
          )
        }
        if (hit.kind === 'workflow') {
          const w = workflowById(hit.id)!
          return (
            <E.Box key={`hit-wf-${hit.id}`} flexDirection="row" gap={1}>
              <E.Button key={`hitwf-${hit.id}`} label={`${w.icon} ${w.name} workflow`} plain onPress={() => a.preview('workflow', w.id)} />
              {i === 0 ? <E.Text color="inactive">↵</E.Text> : null}
            </E.Box>
          )
        }
        const p = pluginById(hit.id)!
        const st = pluginStatus(p, m.env)
        return (
          <E.Box key={`hit-pl-${hit.id}`} flexDirection="row" gap={1}>
            <E.Button key={`hitpl-${hit.id}`} label={`🧩 ${p.name} plugin`} plain onPress={() => a.go('plugins')} />
            <E.Text color={COLOR[st.level]}>{LEVEL_ICON[st.level]}</E.Text>
          </E.Box>
        )
      })}
      {m.query.trim() && hits.length === 0 ? <E.Text color="inactive">Nothing matches. Try words like "deploy", "review" or "bug".</E.Text> : null}
    </E.Box>
  )
}

function FlowPanel(E: E, m: Model, a: Actions) {
  const f = m.flow
  if (!f) return null
  const box = (children: any) => (
    <E.Box key="flow" flexDirection="column" gap={1} borderStyle="round" borderColor="claude" paddingX={1}>
      {children}
    </E.Box>
  )

  if (f.kind === 'fix' && f.fix) {
    if (f.phase === 'preview') {
      return box([
        <E.Text key="fx-t" bold>
          {f.fix.label}
        </E.Text>,
        <E.Text key="fx-n" color="inactive">
          {f.fix.note ?? (f.fix.exec.via === 'command' ? `Runs /${f.fix.exec.command}.` : f.fix.exec.via === 'fill' ? `Puts ${f.fix.exec.text} in your prompt.` : 'Asks Claude to help; nothing changes without your approval.')}
        </E.Text>,
        <E.Box key="fx-b" flexDirection="row" gap={1}>
          <E.Button key="confirm-run" label="⚡ CONTINUE" variant="primary" onPress={() => a.confirm()} />
          <E.Button key="cancel-run" label="Cancel" plain onPress={() => a.dismissFlow()} />
        </E.Box>,
      ])
    }
  }

  const cap = f.kind === 'capability' ? capById(f.id) : undefined
  const wf = f.kind === 'workflow' ? workflowById(f.id) : undefined
  const title = cap ? `${cap.icon} ${cap.name}` : wf ? `${wf.icon} ${wf.name}` : f.fix?.label ?? f.id

  if (f.phase === 'preview') {
    const st = cap ? capabilityStatus(cap, m.env) : null
    const blocked = st && !['ready', 'attention'].includes(st.level)
    const steps = cap ? cap.steps : wf ? wf.steps.map(s => `${capById(s.cap)!.name}: ${s.why}`) : []
    return box([
      <E.Text key="pv-t" bold>
        {title}
      </E.Text>,
      blocked ? (
        <E.Box key="pv-blocked" flexDirection="column">
          <E.Text color={COLOR[st!.level]}>{LEVEL_ICON[st!.level]} Can't run yet:</E.Text>
          {st!.problems.map((p, i) => (
            <E.Box key={`pv-p-${i}`} flexDirection="row" gap={1}>
              <E.Text color={COLOR[p.level]}> • {p.text}</E.Text>
              {p.fix ? <E.Button key={`pv-fix-${i}`} label={p.fix.label} plain onPress={() => a.previewFix(p.fix!)} /> : null}
            </E.Box>
          ))}
        </E.Box>
      ) : (
        <E.Box key="pv-steps" flexDirection="column">
          <E.Text color="inactive">You are about to run:</E.Text>
          {steps.map((s, i) => (
            <E.Text key={`pv-s-${i}`}> ✓ {s}</E.Text>
          ))}
          {st?.problems.filter(p => p.level === 'attention').map((p, i) => (
            <E.Text key={`pv-w-${i}`} color={COLOR.attention}>
              {' '}
              ! {p.text}
            </E.Text>
          ))}
          <E.Text color="inactive">
            {wf?.ask ? 'Adds the workflow to your prompt so you can describe the goal first.' : cap?.exec.via === 'fill' ? 'Adds the command to your prompt so you can finish it.' : 'Runs in this conversation. Sessions start in plan mode: approve the plan in the chat.'}
          </E.Text>
        </E.Box>
      ),
      <E.Box key="pv-b" flexDirection="row" gap={1}>
        {blocked ? null : <E.Button key="confirm-run" label={wf ? '⚡ LAUNCH' : '⚡ RUN'} variant="primary" onPress={() => a.confirm()} />}
        <E.Button key="cancel-run" label="Cancel" plain onPress={() => a.dismissFlow()} />
      </E.Box>,
    ])
  }

  const status =
    f.phase === 'launched' ? '⏳ Sent to Claude…' : f.phase === 'running' ? '⏳ Running in the conversation…' : f.phase === 'filled' ? '✎ Added to your prompt: finish it and press Enter.' : f.phase === 'failed' ? '🔴 It did not start.' : '✓ Finished.'
  const nextCaps = f.phase === 'done' && cap?.next ? cap.next.map(id => capById(id)).filter(Boolean) as Capability[] : []
  return box([
    <E.Text key="rs-t" bold>
      {title}
    </E.Text>,
    <E.Text key="rs-s" color={f.phase === 'failed' ? COLOR.error : f.phase === 'done' ? COLOR.ready : undefined}>
      {status}
    </E.Text>,
    f.message ? (
      <E.Text key="rs-m" color="inactive">
        {f.message}
      </E.Text>
    ) : null,
    nextCaps.length > 0 ? (
      <E.Box key="rs-next" flexDirection="row" flexWrap="wrap" gap={1}>
        <E.Text color="inactive">Next:</E.Text>
        {nextCaps.map(c => (
          <E.Button key={`next-${c.id}`} label={`${c.icon} ${c.name}`} plain onPress={() => a.preview('capability', c.id)} />
        ))}
      </E.Box>
    ) : null,
    <E.Button key="dismiss-flow" label="Close" plain onPress={() => a.dismissFlow()} />,
  ])
}

// ---------------------------------------------------------------- pages

function Home(E: E, m: Model, a: Actions) {
  const p = m.env.project
  const stageIndex = STAGES.findIndex(s => s.id === m.stage)
  const recommended = capById(stageIndex >= 0 ? STAGES[stageIndex].primary : p && p.changed > 0 ? 'next-part' : p?.handoff && p.handoff.status !== 'done' ? 'handoff' : 'next-part')!
  const nudgeTitle: Record<string, string> = {
    'ship-after-push': '🚀 READY TO SHIP',
    'ship-after-commit': '🚀 READY TO SHIP',
    'ship-on-ask': '🚀 READY TO SHIP',
    'next-part': '🏗 READY FOR THE NEXT PART',
    'commit-old-work': '⚠ UNCOMMITTED WORK',
    'manager-update': '📝 UPDATE DUE',
  }
  const issues = PLUGINS.filter(pl => ['connection', 'setup', 'signin', 'error'].includes(pluginStatus(pl, m.env).level)).length
  const shield = m.modules.find(x => x.id === 'secret-shield')
  const deploy = m.modules.find(x => x.id === 'deploy-status')
  const handoff = m.modules.find(x => x.id === 'handoff')
  const weather = m.modules.find(x => x.id === 'token-weather')
  return (
    <E.Box key="page-home" flexDirection="column" gap={1}>
      <E.Box flexDirection="column">
        {Heading(E, 'h-quick', 'Quick actions')}
        <E.Box flexDirection="row" flexWrap="wrap" gap={1}>
          {QUICK_ACTIONS.map(q => (
            <E.Button key={`quick-${q.label}`} label={`${q.icon} ${q.label}`} variant="secondary" onPress={() => a.preview('capability', q.cap)} />
          ))}
        </E.Box>
      </E.Box>

      <E.Box flexDirection="column">
        {Heading(E, 'h-project', 'Current project')}
        {p ? (
          <E.Text>
            📁 <E.Text bold>{p.name}</E.Text>
            {p.branch ? <E.Text color="inactive"> · ⎇ {p.branch}</E.Text> : null}
            {p.hasGit ? <E.Text color={p.changed > 0 ? COLOR.attention : 'inactive'}> · {p.changed > 0 ? `${p.changed} uncommitted` : 'all committed'}</E.Text> : <E.Text color="inactive"> · no git</E.Text>}
          </E.Text>
        ) : (
          <E.Text color="inactive">Reading the project…</E.Text>
        )}
        <E.Text>
          {STAGES.map((s, i) => (
            <E.Text key={`st-${s.id}`} bold={i === stageIndex} color={i === stageIndex ? 'claude' : i < stageIndex ? undefined : 'inactive'}>
              {i > 0 ? ' → ' : ''}
              {i === stageIndex ? `[${s.title}]` : s.title}
            </E.Text>
          ))}
        </E.Text>
        <E.Box flexDirection="row" gap={1}>
          <E.Button key="next-step" label={`▶ NEXT STEP: ${recommended.name}`} variant="primary" onPress={() => a.preview('capability', recommended.id)} />
        </E.Box>
      </E.Box>

      <E.Box flexDirection="column">
        {Heading(E, 'h-smart', 'Smart actions')}
        {m.nudge ? (
          <E.Box key="smart-nudge" flexDirection="column">
            <E.Text bold color="claude">
              {nudgeTitle[m.nudge.id] ?? '✻ SUGGESTION'}
            </E.Text>
            <E.Text>{m.nudge.text}</E.Text>
            <E.Box flexDirection="row" gap={1}>
              <E.Button key="nudge-run" label={`▶ RUN ${(capById(m.nudge.command)?.name ?? m.nudge.command).toUpperCase()}`} variant="primary" onPress={() => a.nudgeRun()} />
              <E.Button key="nudge-later" label="Not now" plain onPress={() => a.nudgeLater()} />
            </E.Box>
          </E.Box>
        ) : null}
        {p?.handoff && p.handoff.status !== 'done' ? (
          <E.Box key="smart-handoff" flexDirection="row" gap={1}>
            <E.Text>🔄 Handoff {p.handoff.status === 'open' ? 'ready' : p.handoff.status}: {p.handoff.title}</E.Text>
            <E.Button key="smart-handoff-view" label="▶ VIEW HANDOFF" plain onPress={() => a.preview('capability', 'handoff')} />
          </E.Box>
        ) : null}
        {m.learnerWaiting > 0 ? (
          <E.Box key="smart-learner" flexDirection="row" gap={1}>
            <E.Text>🧠 {m.learnerWaiting} skill {m.learnerWaiting === 1 ? 'idea' : 'ideas'} waiting for your approval</E.Text>
            <E.Button key="smart-learner-open" label="Review" plain onPress={() => a.openLearner()} />
          </E.Box>
        ) : null}
        {issues > 0 ? (
          <E.Box key="smart-issues" flexDirection="row" gap={1}>
            <E.Text color={COLOR.connection}>🟠 {issues} plugins need sign-in, setup or a connection fix</E.Text>
            <E.Button key="smart-issues-open" label="Plugins" plain onPress={() => a.go('plugins')} />
          </E.Box>
        ) : null}
        {!m.nudge && !(p?.handoff && p.handoff.status !== 'done') && m.learnerWaiting === 0 && issues === 0 ? <E.Text color="inactive">Nothing needs you right now.</E.Text> : null}
      </E.Box>

      <E.Box flexDirection="column">
        {Heading(E, 'h-live', 'Live status')}
        {[shield, weather, deploy, handoff].filter(Boolean).map(mod => (
          <E.Box key={`live-${mod!.id}`} flexDirection="row" gap={1}>
            <E.Text color={COLOR[mod!.level]}>{LEVEL_ICON[mod!.level]}</E.Text>
            <E.Button key={`live-open-${mod!.id}`} label={`${mod!.icon} ${mod!.name}`} plain onPress={() => a.go(mod!.id === 'token-weather' ? 'weather' : 'system')} />
            <E.Text color="inactive">{mod!.summary}</E.Text>
          </E.Box>
        ))}
      </E.Box>
    </E.Box>
  )
}

function Grouped(E: E, m: Model, a: Actions, key: string, caps: Capability[], order: string[]) {
  const groups = order.filter(g => caps.some(c => c.category === g))
  return (
    <E.Box key={key} flexDirection="column" gap={1}>
      {groups.map(g => (
        <E.Box key={`${key}-${g}`} flexDirection="column">
          {Heading(E, `${key}-h-${g}`, g)}
          {caps.filter(c => c.category === g).map(c => CapCard(E, m, a, c))}
        </E.Box>
      ))}
    </E.Box>
  )
}

const OUTCOME_ORDER = ['Build', 'Debug', 'Review', 'Test', 'Secure', 'Ship', 'Report', 'Design', 'Data', 'Auth', 'Email', 'Brief', 'Docs', 'Claude Code']

function ActionsPage(E: E, m: Model, a: Actions) {
  const outcomes = CAPABILITIES.filter(c => c.source !== 'toolkit' && c.id !== 'copy')
  return Grouped(E, m, a, 'page-actions', outcomes, OUTCOME_ORDER)
}

function SkillsPage(E: E, m: Model, a: Actions) {
  const personal = CAPABILITIES.filter(c => c.source === 'personal' || c.source === 'toolkit')
  return (
    <E.Box key="page-skills" flexDirection="column" gap={1}>
      {Heading(E, 'sk-h1', 'Your skills and commands')}
      {personal.filter(c => c.source === 'personal').map(c => CapCard(E, m, a, c))}
      {Heading(E, 'sk-h2', 'Toolkit commands')}
      {personal.filter(c => c.source === 'toolkit').map(c => CapCard(E, m, a, c))}
    </E.Box>
  )
}

function PluginsPage(E: E, m: Model, a: Actions) {
  const cats = ['Development', 'Web / Deployment', 'Claude Code', 'Account', 'Output styles', 'Toolkit'] as const
  return (
    <E.Box key="page-plugins" flexDirection="column" gap={1}>
      {cats.map(cat => (
        <E.Box key={`plcat-${cat}`} flexDirection="column">
          {Heading(E, `plh-${cat}`, cat)}
          {PLUGINS.filter(p => p.category === cat).map(p => {
            const st = pluginStatus(p, m.env)
            const caps = CAPABILITIES.filter(c => c.plugin === p.name)
            const ready = !['disabled', 'error', 'connection', 'setup', 'signin'].includes(st.level)
            return (
              <E.Box key={`pl-${p.id}`} flexDirection="column" paddingLeft={1}>
                <E.Box flexDirection="row" gap={1}>
                  <E.Text bold>{p.name}</E.Text>
                  {Chip(E, `plchip-${p.id}`, st.level, undefined, st.checking)}
                  {st.version ? <E.Text color="inactive">v{st.version.slice(0, 12)}</E.Text> : null}
                </E.Box>
                <E.Text color="inactive">{p.description}</E.Text>
                {st.problems.map((pr, i) => (
                  <E.Box key={`plp-${p.id}-${i}`} flexDirection="row" gap={1}>
                    <E.Text color={COLOR[pr.level]}>{LEVEL_ICON[pr.level]} {pr.text}</E.Text>
                    {pr.fix ? <E.Button key={`plfix-${p.id}-${i}`} label={pr.fix.label} plain onPress={() => a.previewFix(pr.fix!)} /> : null}
                  </E.Box>
                ))}
                {ready && caps.length > 0 ? (
                  <E.Box flexDirection="row" flexWrap="wrap" gap={1}>
                    {caps.map(c => (
                      <E.Button key={`pluse-${p.id}-${c.id}`} label={`▶ ${c.name}`} plain onPress={() => a.preview('capability', c.id)} />
                    ))}
                  </E.Box>
                ) : null}
              </E.Box>
            )
          })}
        </E.Box>
      ))}
    </E.Box>
  )
}

function WorkflowsPage(E: E, m: Model, a: Actions) {
  return (
    <E.Box key="page-workflows" flexDirection="column" gap={1}>
      <E.Text color="inactive">A workflow asks Claude to use several skills in order, checking in with you between steps.</E.Text>
      {WORKFLOWS.map(w => WorkflowCard(E, m, a, w))}
    </E.Box>
  )
}

function SystemPage(E: E, m: Model) {
  return (
    <E.Box key="page-system" flexDirection="column" gap={1}>
      <E.Text color="inactive">Persistent modules that run on their own in every session.</E.Text>
      {m.modules.map(mod => (
        <E.Box key={`mod-${mod.id}`} flexDirection="column" borderStyle="round" borderColor="subtle" paddingX={1}>
          <E.Box flexDirection="row" gap={1}>
            <E.Text bold>
              {mod.icon} {mod.name}
            </E.Text>
            {Chip(E, `modchip-${mod.id}`, mod.level, mod.level === 'ready' ? 'ACTIVE' : undefined)}
          </E.Box>
          <E.Text>{mod.summary}</E.Text>
          {mod.detail.map((d, i) => (
            <E.Text key={`mod-${mod.id}-d${i}`} color="inactive">
              {d}
            </E.Text>
          ))}
          {mod.actions.length > 0 ? (
            <E.Box flexDirection="row" gap={1}>
              {mod.actions.map(x => (
                <E.Button key={x.key} label={x.label} plain onPress={x.act} />
              ))}
            </E.Box>
          ) : null}
        </E.Box>
      ))}
    </E.Box>
  )
}

function InstalledPage(E: E, m: Model) {
  const rows: { key: string; name: string; type: string; source: string; level: Level; note: string }[] = []
  for (const p of PLUGINS) {
    const st = pluginStatus(p, m.env)
    if (!st.installed && !p.account) continue
    rows.push({ key: `in-pl-${p.id}`, name: p.name, type: p.category === 'Toolkit' ? 'mod' : p.category === 'Output styles' ? 'output style' : 'plugin', source: p.account ? 'claude.ai account' : p.id.split('@')[1] ?? '', level: st.level, note: [st.version ? `v${st.version.slice(0, 12)}` : '', st.problems[0]?.text ?? ''].filter(Boolean).join(' · ') })
  }
  for (const c of CAPABILITIES.filter(c => c.source === 'personal')) {
    const st = capabilityStatus(c, m.env)
    rows.push({ key: `in-sk-${c.id}`, name: c.exec.via === 'command' ? `/${c.exec.command}` : c.name, type: c.type, source: '~/.claude', level: st.level, note: st.problems[0]?.text ?? '' })
  }
  for (const [server, s] of Object.entries(m.env.mcp ?? {})) {
    const level: Level = s.status === 'ok' ? 'ready' : s.status === 'auth' ? 'signin' : 'connection'
    rows.push({ key: `in-mcp-${server}`, name: server.replace(/^plugin:/, ''), type: 'MCP server', source: 'plugin', level, note: s.status === 'ok' ? 'connected' : s.status === 'auth' ? 'needs sign-in' : `failed${s.detail ? `: ${s.detail}` : ''}` })
  }
  return (
    <E.Box key="page-installed" flexDirection="column">
      <E.Text color="inactive">
        {rows.length} items{m.env.mcpCheckedAt === null ? ' · MCP health still being checked' : ''}
      </E.Text>
      {rows.map(r => (
        <E.Box key={r.key} flexDirection="row" gap={1}>
          <E.Text color={COLOR[r.level]}>{LEVEL_ICON[r.level]}</E.Text>
          <E.Text bold>{r.name}</E.Text>
          <E.Text color="inactive">
            {r.type} · {r.source}
            {r.note ? ` · ${r.note}` : ''}
          </E.Text>
        </E.Box>
      ))}
    </E.Box>
  )
}

function FavouritesPage(E: E, m: Model, a: Actions) {
  const caps = m.favourites.map(id => capById(id)).filter(Boolean) as Capability[]
  const wfs = m.favourites.filter(id => id.startsWith('wf:')).map(id => workflowById(id.slice(3))).filter(Boolean) as Workflow[]
  return (
    <E.Box key="page-favourites" flexDirection="column" gap={1}>
      {caps.length + wfs.length === 0 ? <E.Text color="inactive">Nothing here yet. Press ☆ on any action or workflow to pin it here.</E.Text> : null}
      {caps.map(c => CapCard(E, m, a, c))}
      {wfs.map(w => WorkflowCard(E, m, a, w))}
    </E.Box>
  )
}

function SettingsPage(E: E, m: Model, a: Actions) {
  const styleLabel: Record<string, string> = { off: 'Off', learning: 'Learning', explanatory: 'Explanatory', both: 'Both on (conflicting)', unknown: 'Checking…' }
  const pending = m.pending
  return (
    <E.Box key="page-settings" flexDirection="column" gap={1}>
      <E.Box flexDirection="column">
        {Heading(E, 'set-h-style', 'Output style')}
        <E.Text color={m.outputStyle === 'both' ? COLOR.attention : undefined}>Current: {styleLabel[m.outputStyle]}</E.Text>
        <E.Box flexDirection="row" gap={1}>
          {(['off', 'learning', 'explanatory'] as const).map(s => (
            <E.Button key={`style-${s}`} label={`${m.outputStyle === s ? '● ' : '○ '}${styleLabel[s]}`} plain onPress={() => a.requestSetting({ kind: 'output-style', style: s })} />
          ))}
        </E.Box>
        <E.Text color="inactive">Only one style can be on. Changes apply to new sessions.</E.Text>
      </E.Box>

      {pending ? (
        <E.Box key="pending" flexDirection="column" borderStyle="round" borderColor="claude" paddingX={1}>
          <E.Text bold>Confirm</E.Text>
          <E.Text>
            {pending.style === 'off'
              ? 'Turn off both output-style plugins for new sessions.'
              : `Turn on ${pending.style}-output-style and turn off the other one, for new sessions.`}
          </E.Text>
          <E.Box flexDirection="row" gap={1}>
            <E.Button key="confirm-setting" label="⚡ APPLY" variant="primary" onPress={() => a.confirmSetting()} />
            <E.Button key="cancel-setting" label="Cancel" plain onPress={() => a.cancelSetting()} />
          </E.Box>
        </E.Box>
      ) : null}

      <E.Box flexDirection="column">
        {Heading(E, 'set-h-open', 'Control Center')}
        <E.Button key="toggle-autoopen" label={`${m.autoOpen ? '☑' : '☐'} Open automatically when a session starts`} plain onPress={() => a.setAutoOpen(!m.autoOpen)} />
        <E.Box flexDirection="row" gap={1}>
          <E.Button key="refresh" label="⟳ Re-check everything" plain onPress={() => a.refresh()} />
          <E.Text color="inactive">{m.env.checkedAt ? 'Last checked this session.' : 'Not checked yet.'}</E.Text>
        </E.Box>
      </E.Box>

      <E.Box flexDirection="column">
        {Heading(E, 'set-h-limits', 'Known limitations')}
        <E.Text color="inactive">• No global Ctrl+K: Claude Code keybindings can't run commands. Type /cc to open this with the search ready.</E.Text>
        <E.Text color="inactive">• Sign-ins happen in /mcp, by you; this never signs in for you.</E.Text>
        <E.Text color="inactive">• Account connector health (Slack, GitHub and others) isn't visible to mods.</E.Text>
        <E.Text color="inactive">• Progress shows the turn starting and finishing, not each step inside it.</E.Text>
      </E.Box>
    </E.Box>
  )
}

function WeatherPage(E: E, m: Model) {
  const w = m.weather
  const BARS = '▁▂▃▄▅▆▇█'
  const spark = w.window ? w.history.map(t => BARS[Math.min(7, Math.max(0, Math.round((t / w.window!) * 7)))]).join('') : ''
  const k = (n: number) => (n >= 1000 ? `${+(n / 1000).toFixed(1)}k` : `${n}`)
  return (
    <E.Box key="page-weather" flexDirection="column" gap={1}>
      {Heading(E, 'w-h', 'Token weather')}
      <E.Text>
        Context: {w.percent === null ? 'no reading yet' : `${w.percent}% · ${k(w.tokens!)} / ${k(w.window!)}`}
      </E.Text>
      {w.delta !== null ? <E.Text>Last turn: {w.delta >= 0 ? '+' : ''}{w.delta.toFixed(1)}% of the window</E.Text> : null}
      {spark ? <E.Text color="claude">{spark}</E.Text> : null}
      {w.limits.map(l => (
        <E.Text key={`lim-${l.kind}`}>
          {l.kind === 'five_hour' ? '5-hour' : l.kind === 'seven_day' ? 'Weekly' : l.kind}: {Math.round(l.percentUsed)}%
          <E.Text color="inactive">{l.resets ? ` · resets ${l.resets}` : ''}</E.Text>
        </E.Text>
      ))}
      {w.limits.length === 0 ? <E.Text color="inactive">No usage-limit reading yet (shows after the first reply).</E.Text> : null}
    </E.Box>
  )
}

// ---------------------------------------------------------------- the pane

export function ControlCenter(E: E, m: Model, a: Actions) {
  const page =
    m.page === 'home'
      ? Home(E, m, a)
      : m.page === 'actions'
        ? ActionsPage(E, m, a)
        : m.page === 'skills'
          ? SkillsPage(E, m, a)
          : m.page === 'plugins'
            ? PluginsPage(E, m, a)
            : m.page === 'workflows'
              ? WorkflowsPage(E, m, a)
              : m.page === 'system'
                ? SystemPage(E, m)
                : m.page === 'installed'
                  ? InstalledPage(E, m)
                  : m.page === 'favourites'
                    ? FavouritesPage(E, m, a)
                    : m.page === 'settings'
                      ? SettingsPage(E, m, a)
                      : WeatherPage(E, m)
  return (
    <E.Box flexDirection="column" gap={1} paddingX={1}>
      {Header(E, m, a)}
      {Search(E, m, a)}
      {Nav(E, m, a)}
      {m.notice ? (
        <E.Text key="notice" color="claude">
          {m.notice}
        </E.Text>
      ) : null}
      {FlowPanel(E, m, a)}
      {page}
    </E.Box>
  )
}
