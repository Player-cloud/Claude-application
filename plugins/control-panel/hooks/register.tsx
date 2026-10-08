import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Command } from '../types'

const PANE = 'control-panel'
const commands = atom({ plugin: 'control-panel', key: 'commands' } as const, [] as Command[])
const query = atom({ plugin: 'control-panel', key: 'query' } as const, '')
const stage = atom({ plugin: 'control-panel', key: 'stage' } as const, null as string | null)
const selected = atom({ plugin: 'control-panel', key: 'selected' } as const, null as string | null)

// Claude's own theme colours, so the panel follows whichever theme is chosen.
const ACCENT = 'claude'
const MUTED = 'inactive'
const LINE = 'subtle'

// The desktop header is an SVG drawn outside the theme, so it uses Claude's
// terracotta and neutral greys that read on light and dark backgrounds alike.
const CLAY = '#D97757'
const GREY = '#9A9A9A'

// The work runs through these stages in order; each lists the commands that
// do it, best first. Commands this session doesn't have are left out.
const PIPELINE: { id: string; title: string; hint: string; commands: string[] }[] = [
  {
    id: 'brief',
    title: 'Brief',
    hint: 'Agree the plan in Cowork, then pick up the handoff here.',
    commands: ['handoff', 'handoff-to-code', 'engineering:system-design', 'engineering:architecture'],
  },
  {
    id: 'plan',
    title: 'Plan',
    hint: 'Design the part before building it.',
    commands: ['feature-dev:feature-dev', 'engineering:testing-strategy'],
  },
  {
    id: 'build',
    title: 'Build',
    hint: 'Build, test and commit the next part of the plan.',
    commands: ['next-part', 'frontend-design:frontend-design', 'engineering:debug'],
  },
  {
    id: 'review',
    title: 'Review',
    hint: 'Catch bugs and security holes before they ship.',
    commands: ['pr-review-toolkit:review-pr', 'claude-security:claude-security', 'code-review'],
  },
  {
    id: 'ship',
    title: 'Ship',
    hint: 'Check everything, then deploy a preview.',
    commands: ['ship-check', 'deploy-status', 'vercel:status', 'vercel:env'],
  },
  {
    id: 'report',
    title: 'Report',
    hint: 'Tell your manager, keep memory current, learn from what repeats.',
    commands: ['manager-update', 'project-artifact:project-artifact', 'claude-md-management:revise-claude-md', 'learn-skills'],
  },
]

const stageOf = (name: string) => PIPELINE.find(s => s.commands.includes(name))?.id ?? null

function matches(list: Command[], q: string): Command[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return []
  return list
    .filter(c => words.every(w => `${c.name} ${c.description}`.toLowerCase().includes(w)))
    .sort((a, b) => Number(!a.name.toLowerCase().includes(words[0])) - Number(!b.name.toLowerCase().includes(words[0])))
    .slice(0, 6)
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')

// Desktop header: a six-step progress track in Claude's style.
function trackSvg(currentIndex: number, focusIndex: number): string {
  const w = 360
  const left = 24
  const gap = (w - left * 2) / (PIPELINE.length - 1)
  const steps = PIPELINE.map((s, i) => {
    const x = left + i * gap
    const isDone = currentIndex >= 0 && i < currentIndex
    const isCurrent = i === currentIndex
    const dot = isCurrent
      ? `<circle cx="${x}" cy="48" r="7" fill="${CLAY}"/>`
      : isDone
        ? `<circle cx="${x}" cy="48" r="6" fill="${CLAY}" fill-opacity="0.45"/>`
        : `<circle cx="${x}" cy="48" r="6" fill="none" stroke="${GREY}" stroke-opacity="0.6" stroke-width="1.5"/>`
    const ring = i === focusIndex && !isCurrent ? `<circle cx="${x}" cy="48" r="10" fill="none" stroke="${CLAY}" stroke-opacity="0.6" stroke-width="1.2"/>` : ''
    const label = `<text x="${x}" y="74" text-anchor="middle" font-size="10.5" font-weight="${isCurrent ? 600 : 400}" fill="${isCurrent ? CLAY : GREY}">${esc(s.title)}</text>`
    return ring + dot + label
  }).join('')
  const doneTo = currentIndex > 0 ? left + currentIndex * gap : left
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="86" viewBox="0 0 ${w} 86" font-family="ui-sans-serif, Segoe UI, system-ui, sans-serif"><text x="${left - 2}" y="18" font-family="ui-serif, Georgia, 'Times New Roman', serif" font-size="16" fill="${CLAY}">Control panel</text><line x1="${left}" y1="48" x2="${w - left}" y2="48" stroke="${GREY}" stroke-opacity="0.35" stroke-width="1.5"/><line x1="${left}" y1="48" x2="${doneTo}" y2="48" stroke="${CLAY}" stroke-width="1.5"/>${steps}</svg>`
}

// Terminal header: the same track drawn in text.
function trackText(currentIndex: number): string {
  return PIPELINE.map((_, i) => (i === currentIndex ? '◉' : currentIndex >= 0 && i < currentIndex ? '●' : '○')).join('──')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await $.command.register({ name: 'panel', description: 'Open the control panel: the pipeline and every skill, one click each' })
    const list = (await $.command.list()).map(c => ({ name: c.name, description: c.description }))
    await update($, commands, () => list)
    void $.ui.open({ id: PANE, title: 'Control panel' })
    return result
  })

  on('command.run', { command: 'panel' }, async $ => {
    const list = (await $.command.list()).map(c => ({ name: c.name, description: c.description }))
    await update($, commands, () => list)
    await $.ui.open({ id: PANE, title: 'Control panel' })
    return { text: 'Control panel opened.' }
  })

  // Follow the work: whatever command runs, from the panel or typed, moves the
  // panel to its stage.
  on('command.run', async ($, e, next) => {
    const found = stageOf(e.command)
    if (found) {
      await update($, stage, () => found)
      await update($, selected, () => null)
    }
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    const m = /^\s*\/([\w:-]+)/.exec(e.text)
    const found = m ? stageOf(m[1]) : null
    if (found) {
      await update($, stage, () => found)
      await update($, selected, () => null)
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button, Input } = els
    const available = await read($, commands)
    const names = new Set(available.map(c => c.name))
    const current = await read($, stage)
    const picked = await read($, selected)
    const q = await read($, query)
    const results = matches(available, q)

    const currentIndex = PIPELINE.findIndex(s => s.id === current)
    const focusId = picked ?? current ?? 'build'
    const focusIndex = PIPELINE.findIndex(s => s.id === focusId)
    const focus = PIPELINE[focusIndex]
    const here = focus.commands.filter(c => names.has(c))
    const [main, ...more] = here
    const nextStage = PIPELINE[focusIndex + 1]

    // This plugin doesn't see its own command go by, so move the stage here.
    const run = async (name: string) => {
      const found = stageOf(name)
      if (found) {
        await update($, stage, () => found)
        await update($, selected, () => null)
      }
      await $.command.run({ command: name, args: '' })
    }
    const fill = (name: string) => $.prompt.fill({ text: `/${name} ` })
    const pick = (id: string) => update($, selected, () => id)
    const describe = (name: string) => clip(available.find(c => c.name === name)?.description ?? '', 90)

    const header =
      e.surface === 'desktop' && 'Svg' in els ? (
        <els.Svg
          source={trackSvg(currentIndex, focusIndex)}
          alt={`Pipeline: ${PIPELINE.map(s => s.title).join(', ')}. ${current ? `Current stage: ${PIPELINE[currentIndex].title}.` : 'No stage started yet.'}`}
          width={360}
        />
      ) : (
        <Box flexDirection="column">
          <Text color={ACCENT} bold>
            ✻ Control panel
          </Text>
          <Text color={ACCENT}>  {trackText(currentIndex)}</Text>
        </Box>
      )

    return (
      <Box flexDirection="column" gap={1} paddingX={1}>
        {header}

        <Box key="steps" flexDirection="row" flexWrap="wrap" gap={1}>
          {PIPELINE.map((s, i) => (
            <Button
              key={`step-${s.id}`}
              label={`${i + 1} ${s.title}`}
              plain
              dimColor={s.id !== focus.id}
              onPress={() => pick(s.id)}
            />
          ))}
        </Box>

        <Box
          key={`stage-${focus.id}`}
          flexDirection="column"
          gap={1}
          borderStyle="round"
          borderColor={focus.id === current ? ACCENT : LINE}
          paddingX={2}
          paddingY={1}
        >
          <Box flexDirection="column">
            <Text color={focus.id === current ? ACCENT : MUTED} bold>
              {focus.id === current ? 'NOW' : `STAGE ${focusIndex + 1} OF ${PIPELINE.length}`}
            </Text>
            <Text bold>{focus.title}</Text>
            <Text color={MUTED}>{focus.hint}</Text>
          </Box>

          {main ? (
            <Box flexDirection="column">
              <Button key={`run-${main}`} label={`Run /${main}`} variant="primary" onPress={() => run(main)} />
              <Text color={MUTED}>{describe(main)}</Text>
            </Box>
          ) : (
            <Text color={MUTED}>None of this stage's commands are installed.</Text>
          )}

          {more.length > 0 && (
            <Box flexDirection="column">
              <Text color={MUTED}>Also useful</Text>
              <Box flexDirection="row" flexWrap="wrap" gap={1}>
                {more.map(name => (
                  <Button key={`run-${name}`} label={`/${name}`} variant="secondary" onPress={() => run(name)} />
                ))}
              </Box>
            </Box>
          )}

          {nextStage && <Button key="next-stage" label={`Next: ${nextStage.title} →`} plain onPress={() => pick(nextStage.id)} />}
        </Box>

        <Box flexDirection="column">
          <Text bold>Quick find</Text>
          <Input
            key="search"
            placeholder={`Search ${available.length} skills and commands`}
            value={q}
            onInput={value => update($, query, () => value)}
            onSubmit={() => (results[0] ? fill(results[0].name) : undefined)}
          />
          {results.map(c => (
            <Box key={`hit-${c.name}`} flexDirection="row" gap={1}>
              <Button label={`/${c.name}`} plain onPress={() => fill(c.name)} />
              <Text color={MUTED}>{clip(c.description, 60)}</Text>
            </Box>
          ))}
          {q.trim() !== '' && results.length === 0 && <Text color={MUTED}>No matches.</Text>}
          {q.trim() === '' && <Text color={MUTED}>Results go into the prompt so you can add details first.</Text>}
        </Box>
      </Box>
    )
  })
}
