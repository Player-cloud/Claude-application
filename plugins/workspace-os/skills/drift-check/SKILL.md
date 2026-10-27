---
name: drift-check
description: Compare what was built with the plan or spec it was built from, and list every place they differ. Use when the user says "drift check", "does the code match the plan", "check against the spec", after a build from a docs/designs plan, or when wrap-up offers it.
---

# Drift check

A plan stops being useful once the code drifts from it without anyone noticing. This check lists the differences so the user can decide, case by case, whether the plan or the code is right. It is the drift-report step of the Elephant-Goldfish Model (egm.dev), done with our own skill and no install.

## 1. Find the pair

Ask for the plan's path (normally `docs/designs/<name>.md`) and the code folder, unless the user has given them or this session built from one plan.

## 2. Check with fresh eyes

Use the Agent tool to start one subagent that gets only the two paths and these instructions. If there is no Agent tool, do the check yourself, and read the plan again from the file instead of relying on memory:

1. List every checkable claim in the plan: files and folders, commands, settings, screens, behaviours, limits, and every "never", "always" and "asks first" rule.
2. For each claim, look in the code and mark it **Matches**, **Differs** (say how), or **Missing**.
3. List anything the code does that matters to the user but the plan doesn't mention, marked **Not in plan**.
4. Give a file and line for each mark that isn't Matches. Don't edit anything.

## 3. Report

Show only the rows that aren't Matches, in one table, with safety rules first (anything about deleting, secrets, the other profile, or asking first):

| # | Mark | Plan says | Code does | Where |
|---|---|---|---|---|

Under the table, give the count of claims that match.

For each row, ask which side is right: **fix the code**, **update the plan**, or **leave it**. Change nothing until the user says. When the plan is updated, add the date and the row numbers to its `## Review log` section.

If everything matches, say so in one line.

If what was built has screens, offer the `qa` skill next: the drift check reads the code, and qa checks the screens against the plan's journeys.
