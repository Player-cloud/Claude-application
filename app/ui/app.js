// Workspace OS page. Talks only to the local server, which shows each change before making it.

const token = document.querySelector('meta[name="wsos-token"]').content
const view = document.getElementById('view')

async function call(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-WSOS-Token': token },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`)
  return data
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
const when = (iso) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'never')

let check = null
const wiz = { profiles: null, plugins: null, pack: null }
const PROFILE_NAMES = { personal: 'Personal', work: 'Work' }
const GROUPS = { conflicts: 'Remove what conflicts', toolkit: 'Toolkit', personal: 'Personal', work: 'Work', plugins: 'Plugins', mods: 'Kept mods', pack: 'Pack', update: 'Update' }

function showError(el, e) {
  el.innerHTML = `<div class="card"><h3>Something went wrong</h3><p class="note">${esc(e.message || e)}</p></div>`
}

// Shows what a step would change, with a tick per change, and applies only the ticked ones.
async function planBlock(el, step, input, { applyLabel = 'Apply these changes', after } = {}) {
  el.innerHTML = '<p class="loading">Working out what would change…</p>'
  let plan
  try { plan = await call('POST', '/api/plan', { step, input }) } catch (e) { return showError(el, e) }
  const notes = plan.notes?.length ? `<div class="notes">${plan.notes.map((n) => `<p class="note">${esc(n)}</p>`).join('')}</div>` : ''
  if (plan.blocked) {
    el.innerHTML = `<div class="card"><h3>Fix this first</h3>${notes}</div>`
    return
  }
  if (!plan.actions.length) {
    el.innerHTML = `<div class="card">${notes}<p>Nothing to change here.</p></div>`
    after?.(true, plan)
    return
  }
  let lastGroup = null
  const rows = plan.actions.map((a) => {
    const head = a.group !== lastGroup ? `<div class="group label">${esc(GROUPS[a.group] || a.group)}</div>` : ''
    lastGroup = a.group
    return `${head}<div class="action"><input type="checkbox" id="a-${esc(a.id)}" data-id="${esc(a.id)}" checked>
      <label for="a-${esc(a.id)}"><div>${esc(a.label)}</div>${a.detail ? `<div class="detail">${esc(a.detail)}</div>` : ''}</label></div>`
  }).join('')
  el.innerHTML = `<div class="card"><h3>This will change</h3>${notes}<div class="actions">${rows}</div>
    <div class="row"><button class="btn primary" data-apply>${esc(applyLabel)}</button><span class="note">Untick anything you don't want. Claude's settings are backed up first.</span></div></div>`
  el.querySelector('[data-apply]').addEventListener('click', async (ev) => {
    const ids = [...el.querySelectorAll('input[data-id]:checked')].map((c) => c.dataset.id)
    if (!ids.length) return
    ev.target.disabled = true
    ev.target.textContent = 'Working…'
    let out
    try { out = await call('POST', '/api/apply', { step, input: plan.input, ids }) } catch (e) { return showError(el, e) }
    const allOk = out.results.every((r) => r.ok)
    el.innerHTML = `<div class="card"><h3>${allOk ? 'Done' : 'Stopped at a problem'}</h3>
      ${out.backup ? `<p class="note">Settings backup: ${esc(out.backup)}</p>` : ''}
      <div>${out.results.map((r) => `<div class="result ${r.ok ? 'ok' : r.ok === false ? 'bad' : ''}"><span class="mark" aria-hidden="true">${r.ok ? '✓' : r.ok === false ? '✗' : '–'}</span>
        <div><div>${esc(r.label)}${r.ok === false ? ' <span class="badge bad">failed</span>' : ''}</div>${r.note ? `<pre>${esc(r.note)}</pre>` : ''}</div></div>`).join('')}</div></div>`
    after?.(allOk, plan)
  })
}

// ---------- Setup ----------

const STEPS = ['Check this PC', 'Clear old installs', 'Choose profiles', 'Plugins', 'Restore from a pack', 'Check the install', 'Done']

function setupFrame(n, body) {
  const nav = STEPS.map((s, i) => `<a href="#/setup/${i + 1}" ${i + 1 === n ? 'aria-current="step"' : ''} class="${i + 1 < n ? 'done' : ''}">
    <span aria-hidden="true">${i + 1 < n ? '✓' : i + 1 === n ? '●' : '○'}</span> ${i + 1} · ${esc(s)}</a>`).join('')
  view.innerHTML = `<div class="split"><nav class="side" aria-label="Setup steps"><div class="steps">${nav}</div>
    <p class="note">Each step shows what it will change and asks before it does it.</p></nav>
    <section class="main" aria-labelledby="step-title">${body}
    <div class="row" style="justify-content: space-between">
      ${n > 1 ? `<a class="btn" href="#/setup/${n - 1}" style="display:inline-flex;align-items:center;text-decoration:none">Back</a>` : '<span></span>'}
      ${n < STEPS.length ? `<a class="btn" href="#/setup/${n + 1}" style="display:inline-flex;align-items:center;text-decoration:none">Next</a>` : ''}
    </div></section></div>`
}

async function loadCheck(force) {
  if (!check || force) check = await call('GET', '/api/check')
  if (!wiz.profiles) wiz.profiles = structuredClone(check.defaults.profiles)
  if (!wiz.plugins) wiz.plugins = [...check.defaults.plugins]
  if (!wiz.pack) wiz.pack = check.defaults.pack
  return check
}

async function setupStep(n) {
  setupFrame(n, '<p class="loading">Looking at this PC…</p>')
  let c
  try { c = await loadCheck(n === 1) } catch (e) { return showError(view, e) }
  const steps = [null, step1, step2, step3, step4, step5, step6, step7]
  steps[n](c)
}

function step1(c) {
  const item = (ok, title, detail) => `<div class="action"><span class="badge ${ok ? 'ok' : 'warn'}">${ok ? 'OK' : 'Needs you'}</span><div><div>${title}</div><div class="detail">${detail}</div></div></div>`
  setupFrame(1, `<h1 id="step-title">Check this PC</h1>
    <p class="lead">Workspace OS sets up the toolkit through Claude's own plugin commands. It never talks to Claude itself, so it needs no API key.</p>
    <div class="card"><div class="actions">
      ${item(true, 'Node.js', esc(c.node))}
      ${item(!!c.git, 'Git', c.git ? esc(c.git) : 'Not found. Only needed to update the toolkit from GitHub. Get it from git-scm.com.')}
      ${item(!!c.claude, 'Claude Code', c.claude ? `${esc(c.claude.version)} at <code>${esc(c.claude.path)}</code>` : 'Not found. Open Claude Desktop and its Code tab once, then press Check again, or paste the path to claude.exe below.')}
      ${item(!c.movedFrom, 'Toolkit folder', `<code>${esc(c.appDir)}</code>${c.movedFrom ? `<br>Last time it ran from <code>${esc(c.movedFrom)}</code>. Step 2 points Claude at the new place.` : ''}${c.removable ? '<br>This looks like a USB or second drive. Plugins are copied into Claude when installed, so they keep working with it unplugged; updates need it plugged in.' : ''}`)}
      ${item(true, 'Packs', c.packs.length ? `${plural(c.packs.length, 'pack')} found. Newest: ${esc(c.packs[0].name)} (${esc(c.packs[0].profiles.map((p) => PROFILE_NAMES[p] || p).join(', ') || 'no profiles')}). You can pick another in step 5.` : 'None in this folder. That is fine on a first PC.')}
    </div></div>
    <div class="card"><label for="claude-path"><h3>Claude Code location (optional)</h3></label>
      <div class="row"><input type="text" id="claude-path" placeholder="C:\\Users\\you\\AppData\\Roaming\\Claude\\claude-code\\2.1.300\\claude.exe" style="flex:1;min-width:240px">
      <button class="btn" data-save-claude>Save</button><button class="btn" data-recheck>Check again</button></div><p class="note" data-claude-note></p></div>`)
  view.querySelector('[data-recheck]').addEventListener('click', () => setupStep(1))
  view.querySelector('[data-save-claude]').addEventListener('click', async () => {
    const note = view.querySelector('[data-claude-note]')
    const r = await call('POST', '/api/settings', { claudePath: view.querySelector('#claude-path').value })
    if (r.ok) setupStep(1)
    else note.textContent = r.note
  })
}

function step2() {
  setupFrame(2, `<h1 id="step-title">Clear old installs</h1>
    <p class="lead">Finds anything that would fight the toolkit: retired or overlapping plugins and mods, a second copy of a toolkit plugin, a Windows-wide profile setting, and Claude still installing from an old toolkit folder. Old folders are left on disk.</p>
    <div data-plan></div>`)
  planBlock(view.querySelector('[data-plan]'), 'conflicts', {}, { applyLabel: 'Remove and switch' })
}

function step3() {
  const card = (p, desc) => {
    const v = wiz.profiles[p]
    return `<div class="card ${v.on ? 'selected' : ''}" data-profile="${p}">
      <div class="check"><input type="checkbox" id="on-${p}" ${v.on ? 'checked' : ''}><label for="on-${p}"><h2>${PROFILE_NAMES[p]}</h2></label></div>
      <p class="note">${desc}</p>
      <label for="root-${p}" class="note">Folder on this PC</label>
      <input type="text" id="root-${p}" value="${esc(v.root)}"></div>`
  }
  setupFrame(3, `<h1 id="step-title">Which profiles do you want on this PC?</h1>
    <p class="lead">Only the profiles you pick are set up. Folder paths differ between computers, so they are asked here.</p>
    <div class="grid wide">${card('personal', 'Your own projects: Studio, Preferences, Vault and video lessons.')}${card('work', 'Work projects, kept apart by the profile guard. Adds the Friday manager-update nudge.')}</div>
    <div class="row"><button class="btn primary" data-preview>Show what this creates</button><span class="note" data-msg></span></div>
    <div data-plan></div>`)
  for (const p of ['personal', 'work']) {
    view.querySelector(`#on-${p}`).addEventListener('change', (e) => {
      wiz.profiles[p].on = e.target.checked
      view.querySelector(`[data-profile="${p}"]`).classList.toggle('selected', e.target.checked)
    })
    view.querySelector(`#root-${p}`).addEventListener('input', (e) => { wiz.profiles[p].root = e.target.value.trim() })
  }
  view.querySelector('[data-preview]').addEventListener('click', () => {
    const picked = ['personal', 'work'].filter((p) => wiz.profiles[p].on)
    const msg = view.querySelector('[data-msg]')
    if (!picked.length) { msg.textContent = 'Pick at least one profile.'; return }
    if (picked.some((p) => !wiz.profiles[p].root)) { msg.textContent = 'Give each picked profile a folder.'; return }
    msg.textContent = ''
    planBlock(view.querySelector('[data-plan]'), 'profiles', { profiles: wiz.profiles })
  })
}

function rootRows(c) {
  const rows = []
  for (const p of ['personal', 'work']) {
    for (const r of c.roots[p] || []) {
      if (wiz.profiles[p]?.root && r.path.toLowerCase() === wiz.profiles[p].root.toLowerCase()) continue
      const id = `root-${p}-${rows.length}`
      rows.push(`<div class="action"><input type="checkbox" id="${id}" data-root="${esc(r.path)}" ${wiz.dropRoots?.includes(r.path) ? '' : 'checked'}>
        <label for="${id}"><div>${esc(r.path)} ${r.exists ? '' : '<span class="badge warn">not found on this PC</span>'}</div><div class="detail">Already in your ${PROFILE_NAMES[p]} folders. Kept unless you untick it.</div></label></div>`)
    }
  }
  return rows.length ? `<div class="card"><h3>Other profile folders already set</h3><div class="actions">${rows.join('')}</div></div>` : ''
}

function step4(c) {
  wiz.dropRoots = wiz.dropRoots || []
  const rows = c.catalog.map((p) => `<div class="action"><input type="checkbox" id="pl-${esc(p.name)}" data-plugin="${esc(p.name)}" ${wiz.plugins.includes(p.name) ? 'checked' : ''}>
    <label for="pl-${esc(p.name)}"><div>${esc(p.name)} <span class="badge">${esc(p.version)}</span></div><div class="detail">${esc(p.description)}</div></label></div>`).join('')
  setupFrame(4, `<h1 id="step-title">Plugins</h1>
    <p class="lead">Picked plugins are installed or updated and given your profile folders. Unpicked ones are turned off, not deleted.</p>
    <div class="card"><div class="actions">${rows}</div></div>
    ${rootRows(c)}
    <div class="row"><button class="btn primary" data-preview>Show the changes</button></div>
    <div data-plan></div>`)
  view.querySelectorAll('[data-plugin]').forEach((box) => box.addEventListener('change', () => {
    wiz.plugins = [...view.querySelectorAll('[data-plugin]:checked')].map((b) => b.dataset.plugin)
  }))
  view.querySelectorAll('[data-root]').forEach((box) => box.addEventListener('change', () => {
    wiz.dropRoots = [...view.querySelectorAll('[data-root]:not(:checked)')].map((b) => b.dataset.root)
  }))
  view.querySelector('[data-preview]').addEventListener('click', () => {
    planBlock(view.querySelector('[data-plan]'), 'plugins', { plugins: wiz.plugins, profiles: wiz.profiles, dropRoots: wiz.dropRoots })
  })
}

function step5(c) {
  if (!c.packs.length) {
    setupFrame(5, `<h1 id="step-title">Restore from a pack</h1><div class="card"><p>No pack in this folder, so there is nothing to restore. Make one on your other PC with <b>Pack for another PC</b>, then bring this folder back.</p></div>`)
    return
  }
  const opts = c.packs.map((p) => `<option value="${esc(p.name)}" ${p.name === wiz.pack ? 'selected' : ''}>${esc(p.createdAt ? when(p.createdAt) : p.name)} · ${esc(p.profiles.map((x) => PROFILE_NAMES[x] || x).join(', ') || 'no profiles')}${p.mods.length ? ` · ${plural(p.mods.length, 'mod')}` : ''}</option>`).join('')
  setupFrame(5, `<h1 id="step-title">Restore from a pack</h1>
    <p class="lead">Copies each profile in the pack into the same profile on this PC (Personal into Personal, Work into Work), plus your kept mods. Files already on this PC are kept.</p>
    <div class="card"><label for="pack" class="note">Pack</label><select id="pack" class="btn" style="text-align:left">${opts}</select></div>
    <div class="row"><button class="btn primary" data-preview>Show what it copies</button></div>
    <div data-plan></div>`)
  view.querySelector('#pack').addEventListener('change', (e) => { wiz.pack = e.target.value })
  view.querySelector('[data-preview]').addEventListener('click', () => {
    planBlock(view.querySelector('[data-plan]'), 'restore', { pack: wiz.pack, profiles: wiz.profiles }, { applyLabel: 'Restore' })
  })
}

function checkList(items) {
  const bad = items.filter((i) => !i.ok).length
  return `<div class="card"><h3>${bad ? `${plural(bad, 'thing')} to fix` : 'Everything is in place'} <span class="badge ${bad ? 'warn' : 'ok'}">${items.length - bad} of ${items.length}</span></h3>
    ${items.map((x) => `<div class="result ${x.ok ? 'ok' : 'bad'}"><span class="mark" aria-hidden="true">${x.ok ? '✓' : '✗'}</span><div><div>${esc(x.label)}</div>${x.detail ? `<div class="note">${esc(x.detail)}</div>` : ''}</div></div>`).join('')}</div>`
}

async function step6() {
  setupFrame(6, `<h1 id="step-title">Check the install</h1>
    <p class="lead">Checks this PC is set up the way the earlier steps intended: plugins on at the toolkit's versions, profile folders marked, Studio built, nothing conflicting left.</p>
    <div data-out><p class="loading">Checking…</p></div>
    <div class="row"><button class="btn" data-recheck>Check again</button></div>`)
  view.querySelector('[data-recheck]').addEventListener('click', () => step6())
  try {
    const { items } = await call('GET', '/api/verify')
    view.querySelector('[data-out]').innerHTML = checkList(items)
  } catch (e) { showError(view.querySelector('[data-out]'), e) }
}

function step7() {
  setupFrame(7, `<h1 id="step-title">Done</h1>
    <div class="callout"><p>Restart Claude Desktop so it loads the plugins. Then open a session in your profile folder from the Code tab; the status line shows the profile.</p></div>
    <div class="row"><button class="btn primary" data-finish>Open the dashboard</button></div>`)
  view.querySelector('[data-finish]').addEventListener('click', async () => {
    await call('POST', '/api/setup-done')
    location.hash = '#/dashboard'
  })
}

// ---------- Dashboard ----------

function tile(label, big, small, kind) {
  return `<div class="card tile"><div class="label">${esc(label)}</div><div class="big">${esc(big)}</div><div class="small">${kind ? `<span class="badge ${kind}">${esc(small)}</span>` : esc(small)}</div></div>`
}

function openCard(target, title, text) {
  return `<a href="#" class="card open" data-open="${esc(target)}"><h3>${esc(title)}</h3><span class="note">${esc(text)}</span></a>`
}

async function dashboard() {
  view.innerHTML = '<p class="loading">Checking this PC…</p>'
  let h
  try { h = await call('GET', '/api/health') } catch (e) { return showError(view, e) }
  const on = h.plugins.filter((p) => p.on).length
  const stale = h.plugins.filter((p) => p.on && p.version && p.version !== p.folderVersion).length
  const bad = h.checks.filter((c) => !c.ok).length
  const g = h.git || {}
  const marked = ['personal', 'work'].filter((p) => h.profiles[p].on)
  const opens = [openCard('claude-desktop', 'Claude Desktop', 'Code tab: open a session in a profile folder'), openCard('cowork', 'Cowork', 'Planning and writing; wrap-up and learn-from-video')]
  for (const p of marked) if (h.profiles[p].studio) opens.push(openCard(`studio:${p}`, `${PROFILE_NAMES[p]} Studio`, h.profiles[p].inbox ? `${plural(h.profiles[p].inbox, 'new file')} in the inbox` : 'Your design library'))
  for (const p of marked) opens.push(openCard(`folder:${p}`, `${PROFILE_NAMES[p]} folder`, h.profiles[p].root))
  opens.push(openCard('handbook', 'Handbook', 'The Workspace OS help guide'))
  const need = (n) => `<p>${esc(n.text)}${n.step ? ` <a href="#/setup/${n.step}">Go to step ${n.step}</a>` : ''}
    ${n.resume ? ` <a href="#/${n.resume === 'pack' ? 'pack' : n.resume === 'update' ? 'dashboard' : `setup/${{ conflicts: 2, profiles: 3, plugins: 4, restore: 5 }[n.resume]}`}">Resume</a>` : ''}
    ${n.restore ? ' <button class="btn" data-restore>Put settings back</button>' : ''}</p>`
  view.innerHTML = `<div class="split"><div class="main">
    <div class="grid">
      ${tile('Plugins', `${on} of ${h.plugins.length} on`, stale ? `${stale} out of date` : h.market.here ? 'from this folder' : 'from another folder', stale || !h.market.here ? 'warn' : 'ok')}
      ${tile('Install check', bad ? `${plural(bad, 'thing')} to fix` : 'All in place', `${h.checks.length - bad} of ${h.checks.length} checks pass`, bad ? 'warn' : 'ok')}
      ${tile('Toolkit', g.commit || 'No Git', g.repo ? `${g.branch || ''}${g.dirty ? ', local edits' : ''}` : 'Not a Git copy', g.dirty ? 'warn' : '')}
      ${tile('Profiles', marked.map((p) => PROFILE_NAMES[p]).join(' + ') || 'None', marked.length && marked.every((p) => h.profiles[p].marked) ? 'Folders marked' : 'Needs setup', marked.length && marked.every((p) => h.profiles[p].marked) ? 'ok' : 'warn')}
      ${tile('Last pack', h.lastPack ? when(h.lastPack.at) : 'Never', h.lastPack ? h.lastPack.name : 'Make one before you move', '')}
    </div>
    <h2>Open</h2>
    <div class="grid">${opens.join('')}</div>
    <div class="row">
      <button class="btn" data-recheck>Check again</button>
      <button class="btn primary" data-update>Update toolkit</button>
      <a class="btn" href="#/pack" style="display:inline-flex;align-items:center;text-decoration:none">Pack for another PC</a>
      <a class="btn" href="#/setup/3" style="display:inline-flex;align-items:center;text-decoration:none">Add or change a profile</a>
    </div>
    <div data-plan></div>
    <details class="card"><summary>Details</summary>
      ${checkList(h.checks)}
      ${h.plugins.map((p) => `<div class="result ${p.on ? 'ok' : ''}"><span class="mark" aria-hidden="true">${p.on ? '✓' : '–'}</span><div>${esc(p.name)} <span class="note">${p.installed ? `${esc(p.version)}${p.version && p.version !== p.folderVersion ? ` (toolkit has ${esc(p.folderVersion)})` : ''}${p.on ? '' : ', off'}` : 'not installed'}</span></div></div>`).join('')}
      <p class="note">Claude Code: ${h.claude ? `${esc(h.claude.version)} at ${esc(h.claude.path)}` : 'not found'} · Node ${esc(h.node)} · Toolkit at ${esc(h.appDir)}</p>
    </details>
  </div>
  <aside class="side"><div class="card"><h3>Needs you</h3><div class="needs">${h.needs.length ? h.needs.map(need).join('') : '<p>Nothing right now.</p>'}</div></div></aside></div>`
  view.querySelector('[data-recheck]').addEventListener('click', () => dashboard())
  view.querySelector('[data-update]').addEventListener('click', () => planBlock(view.querySelector('[data-plan]'), 'update', {}, { applyLabel: 'Update toolkit' }))
  view.querySelector('[data-restore]')?.addEventListener('click', async (ev) => {
    const r = await call('POST', '/api/restore-backup')
    ev.target.replaceWith(Object.assign(document.createElement('span'), { className: 'note', textContent: r.note }))
  })
  view.querySelectorAll('[data-open]').forEach((a) => a.addEventListener('click', async (ev) => {
    ev.preventDefault()
    const r = await call('POST', '/api/open', { target: a.dataset.open })
    if (!r.ok) alertInline(a, r.note || 'Could not open it.')
  }))
}

function alertInline(el, text) {
  let n = el.querySelector('.open-error')
  if (!n) { n = document.createElement('span'); n.className = 'note open-error'; el.appendChild(n) }
  n.textContent = text
}

// ---------- Pack ----------

async function packPage() {
  view.innerHTML = '<p class="loading">Loading…</p>'
  const { state } = await call('GET', '/api/state')
  const profiles = ['personal', 'work'].filter((p) => state.profiles?.[p]?.on)
  const box = (id, label, detail, checked) => `<div class="action"><input type="checkbox" id="${id}" ${checked ? 'checked' : ''}><label for="${id}"><div>${label}</div><div class="detail">${detail}</div></label></div>`
  view.innerHTML = `<h1>Pack for another PC</h1>
    <p class="lead">The pack is saved inside this toolkit folder. Take the folder to the new PC and run Workspace OS.cmd; setup finds the pack and offers to restore it.</p>
    <div class="split"><div class="main">
      <div class="card"><div class="actions">
        ${profiles.map((p) => box(`pk-${p}`, `<b>${PROFILE_NAMES[p]}</b>`, `Studio, Preferences and Vault from ${esc(state.profiles[p].root)}${p === 'work' ? '. Off by default: only carry Work notes where your workplace allows.' : ''}`, p === 'personal')).join('') || '<p>No profiles are set up on this PC yet.</p>'}
        ${box('pk-videos', '<b>Video lessons</b>', 'Learning\\videos in each picked profile. Can be large.', false)}
        ${box('pk-mods', '<b>Kept mods</b>', 'Your local mods except the ones on the conflict list.', true)}
      </div></div>
      <div class="row"><button class="btn primary" data-preview>Show what goes in</button></div>
      <div data-plan></div>
    </div><aside class="side">
      <div class="card"><h3>Never in the pack</h3><p class="note">Secrets and keys (files like .env, .pem, .key are skipped), secret-shield's store, your Claude sign-in, chat history and transcripts.</p></div>
      <div class="card"><h3>Comes with your account</h3><p class="note">claude.ai skills (wrap-up, learn-from-video), projects, memory and artifacts.</p></div>
      <div class="card"><h3>Still install on the new PC</h3><p class="note">Claude Desktop (sign in), Node.js and Git. ffmpeg only if you use video lessons.</p></div>
    </aside></div>`
  view.querySelector('[data-preview]').addEventListener('click', () => {
    const input = {
      profiles: profiles.filter((p) => view.querySelector(`#pk-${p}`).checked),
      videos: view.querySelector('#pk-videos').checked,
      mods: view.querySelector('#pk-mods').checked,
    }
    planBlock(view.querySelector('[data-plan]'), 'pack', input, { applyLabel: 'Make pack' })
  })
}

// ---------- Routing ----------

async function route() {
  const [, page, n] = (location.hash || '').split('/')
  document.querySelectorAll('[data-nav]').forEach((a) => a.toggleAttribute('aria-current', a.dataset.nav === page))
  document.querySelectorAll('[data-nav][aria-current]').forEach((a) => a.setAttribute('aria-current', 'page'))
  try {
    if (page === 'setup') await setupStep(Math.min(Math.max(Number(n) || 1, 1), STEPS.length))
    else if (page === 'pack') await packPage()
    else if (page === 'dashboard') await dashboard()
    else {
      const { state } = await call('GET', '/api/state')
      location.hash = state.setupDone ? '#/dashboard' : '#/setup/1'
      return
    }
  } catch (e) {
    showError(view, e)
  }
  window.scrollTo(0, 0)
  view.focus({ preventScroll: true })
}

call('GET', '/api/state').then(({ appDir }) => { document.getElementById('where').textContent = appDir }).catch(() => {})
window.addEventListener('hashchange', route)
route()
