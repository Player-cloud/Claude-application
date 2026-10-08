import { expect, test } from 'claude-code/testing'

const COMMANDS = [
  { name: 'next-part', description: 'Plan, build, test and commit the next part', source: 'user' as const },
  { name: 'ship-check', description: 'Check a project is safe to deploy', source: 'user' as const },
  { name: 'copy', description: 'Copy a file to the clipboard as rich text', source: 'user' as const },
]

for (const surface of ['terminal', 'desktop'] as const) {
  test(`stepper, stage card, run and search on ${surface}`, async ($, on) => {
    const ran: string[] = []
    const filled: string[] = []
    on('command.list', () => ({ value: COMMANDS }))
    on('ui.open', () => ({ value: { isPlaced: true } }) as never)
    on('command.run', (_$, e) => {
      ran.push(e.command)
      return { text: '' }
    })
    on('prompt.fill', (_$, e) => {
      filled.push(e.text)
      return { isFilled: true } as never
    })

    await $.command.run({ command: 'panel', args: '' } as never)
    const ui = await $.ui.mount({ plugin: 'control-panel', surface, component: 'Pane', requestId: 'control-panel', props: {} as never })

    // Desktop draws the SVG progress header; the terminal draws it in text.
    expect((await ui.find({ type: 'Svg' } as never)) !== undefined).toBe(surface === 'desktop')

    // With nothing run yet, the panel opens on Build and offers its main command.
    expect(await ui.find({ key: 'stage-build' })).toBeDefined()
    expect(await ui.find({ key: 'run-next-part' })).toBeDefined()
    expect(await ui.find({ key: 'run-ship-check' })).toBeUndefined()

    // The stepper moves the card; commands that aren't installed stay hidden.
    await ui.press({ key: 'step-ship' })
    expect(await ui.find({ key: 'run-ship-check' })).toBeDefined()
    expect(await ui.find({ key: 'run-vercel:status' })).toBeUndefined()
    await ui.press({ key: 'next-stage' })
    expect(await ui.find({ key: 'stage-report' })).toBeDefined()

    // Running a command makes its stage current and brings the card back to it.
    await ui.press({ key: 'step-build' })
    await ui.press({ key: 'run-next-part' })
    expect(ran).toContain('next-part')
    expect(await ui.find({ key: 'stage-build' })).toBeDefined()

    // Search narrows to matching commands and puts the pick in the prompt.
    await ui.input({ key: 'search', text: 'clipboard', kind: 'change' })
    expect(await ui.find({ key: 'hit-copy' })).toBeDefined()
    expect(await ui.find({ key: 'hit-next-part' })).toBeUndefined()
    await ui.input({ key: 'search', text: 'clipboard' })
    expect(filled).toContain('/copy ')
  })
}
