import { expect, test } from 'claude-code/testing'

const VAULT = 'PASSWORD="Fake-Pass-123"\n'
const MESSAGE = 'Log in with {{secret:PASSWORD}} please'

function engine(on: any) {
  on('session.root', () => ({ value: 'C:/Users/Tester/Downloads/app' }))
  on('env.get', () => ({ value: 'C:/Users/Tester' }) as never)
  on('fs.exists', () => ({ value: true }))
  on('fs.read', () => ({ value: VAULT }))
}

const expanded = ($: any) =>
  $.ui.mount({ plugin: 'secret-shield', surface: 'terminal', component: 'UserMessage', props: { text: MESSAGE, isExpanded: true } as never })

test('by default the value never enters the drawing', async ($, on) => {
  engine(on)
  const ui = await expanded($)
  expect(await ui.find({ text: /PASSWORD/ } as never)).toBeDefined()
  expect(await ui.find({ text: /Fake-Pass-123/ } as never)).toBeUndefined()
  expect(await ui.find({ text: /hover reveal is off/ } as never)).toBeDefined()
})

test('with "Reveal secrets on hover" on, the value is there for hovering', { options: { revealOnHover: true } }, async ($, on) => {
  engine(on)
  const ui = await expanded($)
  expect(await ui.find({ text: /hover to show/ } as never)).toBeDefined()
  expect(await ui.find({ text: /Fake-Pass-123/ } as never)).toBeDefined()
})
