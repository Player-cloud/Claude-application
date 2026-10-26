// Opens the viewer from disk (file://) in real browsers.
// STUDIO_BROWSERS picks them (default "chromium,firefox"); each must be installed (npx playwright install firefox).
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { assemble, rebuild } from '../tools/assemble.mjs'

// require() also finds a globally installed Playwright, which ESM import doesn't.
const playwright = createRequire(import.meta.url)('playwright')

const names = (process.env.STUDIO_BROWSERS || 'chromium,firefox').split(',').map(s => s.trim()).filter(Boolean)

for (const name of names) {
  let browser
  before(async () => { browser = await playwright[name].launch() })
  after(async () => { await browser?.close() })

  async function openStudio(dir) {
    const page = await browser.newPage()
    const requests = []
    const errors = []
    page.on('request', r => requests.push(r.url()))
    page.on('pageerror', e => errors.push(String(e)))
    page.on('dialog', d => { errors.push(`dialog: ${d.message()}`); d.dismiss() })
    await page.goto(pathToFileURL(join(dir, 'index.html')).href)
    await page.waitForLoadState('load')
    return { page, requests, errors }
  }

  test(`${name}: sample library renders grouped by type, Unsorted last`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'studio-'))
    assemble(dir)
    const { page, errors } = await openStudio(dir)
    const sections = await page.$$eval('section.type', s => s.map(x => [x.dataset.type, x.querySelectorAll('.card').length]))
    assert.deepEqual(sections, [['bold-and-loud', 2], ['dark-and-glowing', 2], ['calm-and-structured', 1], ['unsorted', 1]])
    assert.match(await page.textContent('#meta'), /^6 designs · last sorted /)
    // Thumbnails are lazy, so cards below the fold may not have started loading yet: load each and wait.
    const loaded = await page.$$eval('.card img', imgs => Promise.all(imgs.map(i => {
      i.loading = 'eager'
      return i.decode().then(() => i.naturalWidth > 0, () => false)
    })))
    assert.equal(loaded.length, 5)
    assert.ok(loaded.every(Boolean), 'every thumbnail loaded from disk')
    assert.match(await page.textContent('[data-id="2026-10-25-loop-studio"]'), /Not inspected/)
    assert.deepEqual(errors, [])
    rmSync(dir, { recursive: true, force: true })
  })

  test(`${name}: opening a design shows its image and four sections`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'studio-'))
    assemble(dir)
    const { page } = await openStudio(dir)
    await page.click('[data-id="2026-10-20-brisk-bakery"]')
    const dialog = page.locator('dialog[open]')
    await dialog.waitFor()
    const headings = await dialog.locator('h4').allTextContents()
    assert.deepEqual(headings, ['Your note', 'Observed', 'Inferred', 'Your reaction'])
    assert.match(await dialog.textContent(), /one word does all the work/)
    assert.ok(await dialog.locator('img').evaluate(i => i.decode().then(() => i.naturalWidth > 0, () => false)))
    await page.keyboard.press('Escape')
    await page.locator('dialog[open]').waitFor({ state: 'detached' }).catch(() => {})
    assert.equal(await page.locator('dialog[open]').count(), 0)
  })

  test(`${name}: search and tag filter narrow the library`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'studio-'))
    assemble(dir)
    const { page } = await openStudio(dir)
    await page.fill('#search', 'teal line chart')
    assert.deepEqual(await page.$$eval('.card', c => c.map(x => x.dataset.id)), ['2026-10-22-night-ledger'])
    await page.fill('#search', '')
    await page.selectOption('#tag', 'landing page')
    assert.deepEqual(await page.$$eval('.card', c => c.map(x => x.dataset.id)),
      ['2026-10-20-brisk-bakery', '2026-10-23-aurora-app'])
    await page.fill('#search', 'nothing like this')
    assert.equal(await page.locator('.card').count(), 0)
    assert.match(await page.textContent('#library'), /Nothing matches/)
  })

  test(`${name}: HTML and script in item text show as plain text`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'studio-'))
    assemble(dir, { sample: false })
    const attack = '<img src=x onerror="alert(1)"><script>alert(2)</script></script><b>bold</b>'
    mkdirSync(join(dir, 'items', 'evil'), { recursive: true })
    writeFileSync(join(dir, 'items', 'evil', 'item.md'),
      `---\ntitle: ${attack}\ntype: bold-and-loud\nlink: javascript:alert(3)\n---\n\n## Your note\n${attack}\n`)
    rebuild(dir)
    const { page, errors } = await openStudio(dir)
    assert.equal(await page.textContent('.card-title'), attack)
    await page.click('.card')
    await page.locator('dialog[open]').waitFor()
    assert.equal(await page.locator('dialog b, dialog script, dialog img[src="x"], .card img').count(), 0)
    assert.equal(await page.locator('dialog a').count(), 0, 'a javascript: link is not rendered')
    assert.deepEqual(errors, [])
  })

  test(`${name}: the viewer makes no network requests`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'studio-'))
    assemble(dir)
    const { page, requests } = await openStudio(dir)
    await page.click('[data-id="2026-10-23-aurora-app"]')
    await page.locator('dialog[open]').waitFor()
    const outside = requests.filter(u => !u.startsWith('file:') && !u.startsWith('data:'))
    assert.deepEqual(outside, [])
  })

  test(`${name}: a folder without library.js says what to do`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'studio-'))
    assemble(dir, { sample: false })
    rmSync(join(dir, 'library.js'))
    const { page, errors } = await openStudio(dir)
    assert.match(await page.textContent('#library'), /no library\.js in this folder yet/)
    assert.deepEqual(errors, [])
  })
}
