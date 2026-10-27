# Learning Studio

A design reference library, one per profile. You drop screenshots into `Studio/inbox/`, ask Claude (in Cowork or the Code tab) to "sort my new designs", and open `Studio/index.html` in any browser to see the library grouped by design type. Nothing runs in the background, nothing calls a model except your own Claude sessions, and the viewer works offline straight from disk.

## What's here

| Path | What it is |
|---|---|
| `template/index.html` | The viewer. Reads `library.js` and the images next to it; never loads anything from the internet or writes files |
| `template/STUDIO.md` | Instructions Claude follows for every Studio job: sort, react, propose a preference, use in work, link-only items, remove |
| `template/types.md` | The starting design types (Bold and loud, Dark and glowing, Calm and structured) |
| `template/build-library.mjs` | Rebuilds `library.js` from `types.md` and `items/*/item.md`. No dependencies |
| `sample/items/` | Six made-up designs for trying the viewer and for the tests |
| `tools/assemble.mjs` | Puts template + sample together; `npm run sample` writes `sample-build/` |
| `test/` | Generator tests, and viewer tests that open the page from disk in real browsers |

## Set up a Studio

1. Create `Personal/Studio/` beside (not inside) `Personal/Preferences/`, with an empty `inbox/` folder.
2. Copy the four files from `template/` into it.
3. Run `node build-library.mjs` there once (or ask Claude to "follow STUDIO.md and rebuild the index"), then open `index.html`.

In Cowork, connect the `Personal/Studio` folder. In the Code tab, open a session in the Personal profile. For the first sorts in Cowork, say "follow STUDIO.md and sort my new designs".

## Update the viewer later

Copy the new `index.html` and `build-library.mjs` over the old ones and rebuild. `STUDIO.md` and `types.md` may hold your own edits, so compare before replacing them. Your `items/` are never touched.

## Try the sample

```
npm run sample
```

Then open `sample-build/index.html`.

## Named test states

```
npm run scenario            # all of them
npm run scenario -- broken  # one
```

Writes ready-made Studios to `scenario-build/<name>/` for the `qa` skill and for trying things by hand: `first-run` (empty, fresh from the template), `normal` (the six samples), `inbox-waiting` (two new files to sort) and `broken` (three faulty items). The tests check each one builds and opens cleanly.

## Tests

```
npm install
npx playwright install chromium firefox
npm test
```

`STUDIO_BROWSERS=chromium npm test` runs one browser. Edge uses the same engine as Chromium.
