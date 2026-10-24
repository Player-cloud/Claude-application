---
name: feedback
description: Record the user's feedback on Claude's work as a lasting preference in this profile's taste notes. Use when the user says "feedback:", "remember that I prefer…", "don't do that again", "I like it when you…", or corrects the style, tone, design or approach of something Claude made and wants it to stick.
---

# Feedback

Turn one piece of feedback into a preference that changes future work, written only where the user approves.

## 1. Ask where it applies

Use the AskUserQuestion tool with one question, "Where should this feedback apply?", and these options:

- **This task only**: nothing is saved. Apply it now and say so.
- **This project**: it belongs in the project's own `CLAUDE.md`. Offer to add one line there (the edit will ask the user), or point to reflect's "This repo instead" button if a reflect suggestion is showing.
- **This kind of work**: coding, writing, design or learning. Saved in that file.
- **Everything in this profile**: saved in `general.md`.

If the feedback is ambiguous (praise or criticism, which part), ask one short follow-up before going on.

## 2. Find the file

The system prompt names this profile's Preferences folder ("taste notes for this profile are in …"). Use exactly that folder. The files are `coding.md`, `writing.md`, `design.md`, `learning.md` and `general.md`.

Never write the other profile's Preferences, and never write `~/.claude/CLAUDE.md`: it is shared by Personal and Work. If no Preferences folder is named, tell the user the profile has no folders set and stop.

If the file doesn't exist yet, it starts as:

```markdown
# <Kind> preferences

## Approved

## Rejected

## Notes
```

## 3. Show the change, then make it

Write the preference as one short, concrete line the next session can act on, in the user's terms:

- Under **Approved** for something to keep doing, under **Rejected** for something to avoid.
- End it with its source in italics: `_(YYYY-MM-DD, <the task in a few words>)_`.
- If a line already says the same thing, update that line instead of adding a second.
- If the new line contradicts an existing one, show both and ask which stands.

Show the user the exact line or lines and the file before editing. Then make the edit with the Edit or Write tool. That edit always asks the user for permission (workspace-os); if they decline, nothing is saved, so say so.

## 4. Confirm

One sentence: what was saved, and where.
