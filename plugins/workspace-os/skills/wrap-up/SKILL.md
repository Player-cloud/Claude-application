---
name: wrap-up
description: Summarise a work session and offer to keep the summary as a vault note. Use when the user says "wrap up", "let's stop here", "end of session", "where did we get to", or asks for a recap before leaving.
---

# Wrap up

Close a session with a short summary the user can pick up from later, and offer, never assume, to keep it.

## 1. Summarise

Write four short sections from this session only, in plain sentences:

- **Decided** — what the user chose, and the reason when one was given.
- **Ruled out** — options considered and dropped, so they aren't reopened by accident.
- **Still open** — questions waiting on the user, and work started but not finished (name the file, branch or pull request).
- **Next move** — the one thing to do first next time.

Keep it under about fifteen lines. Don't pad empty sections; write "None" instead. Leave out secrets, keys and anything from the other profile.

## 2. Offer to keep it

Ask once: "Want me to save this to your vault inbox?" Don't save anything unless the user says yes.

- On yes, call `vault_draft` with a title like `Session 2026-10-27 – <topic>` and the summary as the text. It lands in the vault's `_inbox` for the user to review, and never overwrites an existing note.
- If the profile has no vault, say so and offer the summary as text to copy instead.
- Never write the summary to Preferences, `CLAUDE.md` or memory files. A preference that came up goes through the `feedback` skill, and only if the user asks.

Why offer instead of saving every time: notes saved automatically pile up and get stale. Saving only what the user chooses keeps the vault worth reading.
