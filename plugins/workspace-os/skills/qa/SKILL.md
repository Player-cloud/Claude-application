---
name: qa
description: Click through what was built in a real browser, following the user journeys in its plan, and report what works and what doesn't with screenshots. Use when the user says "qa", "test it in the browser", "click through it", "does it actually work", after a build from a docs/designs plan, or when the drift check is done and the thing has screens.
---

# QA in a real browser

Tests prove the code does what the code says. This check proves the screens do what the plan says, the way a person would use them. It is the browser-QA idea from Remy (goremy.ai), done with our own skill, on your plan, with no API key. It reports and never fixes: the user picks what gets fixed.

## 1. Find the journeys and the states

1. Find the plan: normally `docs/designs/<name>.md`. Ask if there is more than one or none. Without a plan, ask the user to list the two or three things a person must be able to do, and use those.
2. Take the plan's **Journeys** section as the script. Each journey is a numbered list of steps with what should be seen. If the plan has no such section, write the journeys from it, show them, and wait for an OK before running anything.
3. Find the named test states: the plan's **Scenarios** section, or a `scenarios` script in the project (Learning Studio has `npm run scenario`). Run each journey in every state it names, and at least in the normal one.

## 2. Start it

Use the start command from the plan or the project's README (a local page, `npm run dev`, or a file opened from disk). Never deploy, push, sign in to anything, or point it at real profile folders: use the scenario folders. Ask before installing anything.

## 3. Click through

Pick the first of these that is available:

1. **Playwright from the project** when it already has it (Learning Studio does). Write a throwaway script in the scratch folder, outside the repo, that follows the journey step by step and saves a screenshot after each step.
2. **A browser tool in this session**: the Claude desktop app's browser or Claude in Chrome. Follow the journey by hand, taking a screenshot at each step.
3. **No browser here** (Cowork without a browser tool, for example): give the user the journey as a checklist to click through, and ask them to paste back what they saw at any step that went wrong.

At each step, check what the plan says should be seen. Also watch for page errors, broken images, text running off the screen, and anything that makes a network request when the plan says it works offline. Look at screenshots rather than trusting the code.

Save screenshots to `qa/<date>-<plan name>/` in the scratch folder, or in the project when the user wants to keep them. Never commit them to a public repo without asking.

## 4. Report

Show one table, with failures first:

| # | Journey | Step | Plan says | Saw | Result | Screenshot |
|---|---|---|---|---|---|---|

Result is **Pass**, **Fail** or **Unclear** (say what would settle it). Under the table, give the count of steps that passed and the states that were used.

Then ask which failures to fix. Change no code as part of this skill. If a failure is really the plan being wrong, offer to update the plan instead and note it in the plan's `## Review log`.
