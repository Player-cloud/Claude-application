import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Forecast, Limit } from '../types'

const forecast = atom({ plugin: 'token-weather', key: 'forecast' } as const, null)
const limits = atom({ plugin: 'token-weather', key: 'limits' } as const, [] as Limit[])

const TURNS = 12
const BARS = '▁▂▃▄▅▆▇█'

function weather(percent: number) {
  if (percent < 25) return { icon: '☀', word: 'Clear', color: 'yellow' }
  if (percent < 50) return { icon: '☁', word: 'Cloudy', color: 'cyan' }
  if (percent < 75) return { icon: '☂', word: 'Showers', color: 'blue' }
  if (percent < 90) return { icon: '☇', word: 'Storm', color: 'magenta' }
  return { icon: '↯', word: 'Compact soon', color: 'red' }
}

function fmt(n: number) {
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `${+(n / 1_000).toFixed(1)}k`
  return `${n}`
}

const LIMIT_LABEL: Record<string, string> = { five_hour: '5-hour', seven_day: 'week', spend_limit: 'spend' }
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function limitColor(percent: number) {
  if (percent < 50) return 'green'
  if (percent < 80) return 'yellow'
  return 'red'
}

// "14:30" for a reset within a day, "Fri 14:30" further out.
function resetLabel(iso: string | undefined, nowMs: number) {
  if (!iso) return ''
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  const hm = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
  return at.getTime() - nowMs < 24 * 3600_000 ? hm : `${DAYS[at.getDay()]} ${hm}`
}

function toLimits(raw: readonly { kind: string; percentUsed: number; resetsAt?: string }[]): Limit[] {
  return raw.map(l => ({ kind: l.kind, percentUsed: l.percentUsed, resetsAt: l.resetsAt }))
}

function sparkline(history: number[], window: number) {
  return history
    .map(t => BARS[Math.min(BARS.length - 1, Math.max(0, Math.round((t / window) * (BARS.length - 1))))])
    .join('')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    const { context, rateLimits } = await $.session.usage()
    const seededLimits = toLimits(rateLimits)
    await update($, limits, () => seededLimits)
    const current = await read($, forecast)
    if (context.tokens !== undefined && (current === null || current.history.length === 0)) {
      const seeded: Forecast = { history: [context.tokens], window: context.window }
      await update($, forecast, () => seeded)
    }
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) return result

    const { context } = await $.session.usage()
    if (context.tokens === undefined) return result

    const current = await read($, forecast)
    const next12: Forecast = {
      history: [...(current?.history ?? []), context.tokens].slice(-TURNS),
      window: context.window,
    }
    await update($, forecast, () => next12)
    return result
  })

  // Usage limits move with every response, the main loop's and subagents'.
  on('session.measure', async ($, e, next) => {
    const fresh = toLimits(e.rateLimits)
    await update($, limits, () => fresh)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const f = await read($, forecast)
    const usage = await read($, limits)
    const hasForecast = f !== null && f.history.length > 0 && f.window > 0
    // Draw on top of whatever else is in the band (nudges, the engine's own).
    const beneath = await next(e)
    if (e.props.hasSurvey || (!hasForecast && usage.length === 0)) {
      return beneath
    }

    const { Box, Text } = $.ui.resolve(e)
    const nowMs = await $.clock.now()
    const limitRow =
      usage.length === 0 ? null : (
        <Box>
          <Text dimColor>⏳ </Text>
          {usage.map((l, i) => (
            <Text key={l.kind}>
              {i > 0 ? <Text dimColor> · </Text> : null}
              <Text dimColor>{LIMIT_LABEL[l.kind] ?? l.kind} </Text>
              <Text color={limitColor(l.percentUsed)} bold>
                {Math.round(l.percentUsed)}%
              </Text>
              {l.resetsAt ? <Text dimColor> resets {resetLabel(l.resetsAt, nowMs)}</Text> : null}
            </Text>
          ))}
        </Box>
      )

    if (!hasForecast) {
      return (
        <Box flexDirection="column">
          {limitRow}
          {beneath}
        </Box>
      )
    }

    const tokens = f!.history[f.history.length - 1]
    const prev = f!.history.length > 1 ? f!.history[f!.history.length - 2] : 0
    const delta = tokens - prev
    const percent = Math.round((tokens / f!.window) * 100)
    const w = weather(percent)

    return (
      <Box flexDirection="column">
      <Box>
        <Text color={w.color} bold>
          {w.icon} {w.word}
        </Text>
        <Text>
          {'  '}
          {percent}% · {fmt(tokens)} / {fmt(f.window)}
          {'  '}
        </Text>
        <Text color={w.color}>{sparkline(f.history, f.window)}</Text>
        <Text dimColor>
          {'  '}
          {delta >= 0 ? `▲ +${fmt(delta)}` : `▼ ${fmt(delta)}`} last turn
        </Text>
      </Box>
      {limitRow}
      {beneath}
      </Box>
    )
  })
}
