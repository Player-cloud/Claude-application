import { expect, test } from 'claude-code/testing'

const NOW = new Date(2026, 9, 5, 12, 0).getTime()

for (const surface of ['terminal', 'desktop'] as const) {
  test(`shows the forecast and limits, and keeps what is beneath, on ${surface}`, async ($, on) => {
    on('session.start', (_$, e) => ({ cwd: e.cwd }))
    on('clock.now', () => ({ value: NOW }))
    on('session.usage', () => ({
      value: {
        startedAt: NOW,
        context: { tokens: 67_000, window: 200_000, percent: 34 },
        rateLimits: [{ kind: 'five_hour', percentUsed: 42, resetsAt: new Date(2026, 9, 5, 14, 30).toISOString(), source: 'api' }],
      },
    }) as never)
    on('ui.render', ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>from beneath</Text>
    })

    await $.session.start({ source: 'startup', cwd: 'C:/x', surface: null, isInteractive: true } as never)
    const ui = await $.ui.mount({ plugin: 'token-weather', surface, component: 'AbovePrompt', props: { hasSurvey: false } as never })

    expect(await ui.find({ text: /Cloudy/ } as never)).toBeDefined()
    expect(await ui.find({ text: /67k \/ 200k/ } as never)).toBeDefined()
    expect(await ui.find({ text: /42%/ } as never)).toBeDefined()
    expect(await ui.find({ text: /resets 14:30/ } as never)).toBeDefined()
    expect(await ui.find({ text: /from beneath/ } as never)).toBeDefined()
  })
}
