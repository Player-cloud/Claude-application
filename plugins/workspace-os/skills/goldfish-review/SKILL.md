---
name: goldfish-review
description: Review a plan or spec with fresh reviewers who see only the document and the code, then sort the findings with the user. Use when the user says "goldfish review", "review this plan", "check this spec before we build", or a design doc is ready and nothing has been built from it yet.
---

# Goldfish review

A plan written in a long session carries that session's assumptions. Reviewers who have read nothing else (goldfish) find the gaps the author can't see. This is the review step of the Elephant-Goldfish Model (egm.dev), done with our own skill and no install.

## 1. Find the plan

Ask for the plan's path if the user hasn't given one. Plans normally live in the project's `docs/designs/<name>.md`. Also note the code folder the plan describes, or "none yet" for a plan with no code.

If the plan is still only in this chat, offer to save it to `docs/designs/` first. Reviewers can't read this conversation, and that is the point.

If there is no plan yet, offer to start one from `spec-template.md` in this skill's folder. Its Journeys and Scenarios sections are what the `qa` skill runs later.

## 2. Send out four goldfish

With the Agent tool, start four subagents (five when the plan has screens, see Design below) in one message so they run side by side. Give each one only the plan's path, the code folder, its lens and the return format below. Pass nothing from this session: no summary, no reasons, no history. If a reviewer has to guess, the plan is missing that information.

| Lens | Asks |
|---|---|
| Zoom out | Is there a simpler way, or something that already exists, that does the same job? Is any part not needed for the stated goal? |
| Comprehension | Reading it cold, what is unclear, undefined or contradictory? Which words or names are used before they're explained? |
| Critic | What breaks: edge cases, failure and recovery, data loss, security, the other profile's folders, Windows paths? |
| Readiness | Could someone build this without asking a question? List every decision the builder would have to guess. |
| Design (only when the plan has screens) | Do the screens follow the user's design system and their profile's `Preferences/design.md` taste notes? Where would a screen look generic, crowded or inconsistent? Pass both paths; if neither exists, skip this lens. |

Each reviewer returns at most eight findings, most important first, each as: where (section or line), the problem in one sentence, and a suggested change in one sentence. Tell them to say "nothing found" rather than pad the list, and not to edit any file.

If there is no Agent tool (in Cowork, for example), write out the four prompts so the user can paste each one into a new chat, and stop there until they paste the answers back.

## 3. Resolve with the user

Merge the lists. Drop duplicates, and keep the reviewer's wording. Show one table:

| # | Lens | Where | Finding | Suggested change |
|---|---|---|---|---|

Then ask which ones to fix. Use AskUserQuestion with multiSelect, or let the user reply with numbers, such as "fix 1, 3, 4". The user decides. A finding they skip stays skipped, with no argument.

Edit the plan for the chosen fixes only. Then add a `## Review log` section at the end of the plan (or add to the one already there) with the date, the numbers fixed, and the numbers skipped with each reason in a few words. A later review can then see what was already decided.

## 4. Stop before building

Say the plan is reviewed and ask whether to build now. Don't start building as part of this skill. After the build, the `drift-check` skill compares the code with this plan.

Cost: four subagents (five with Design) use about as much of the plan's allowance as four short chats. For a small change, offer one Readiness reviewer instead of four.
