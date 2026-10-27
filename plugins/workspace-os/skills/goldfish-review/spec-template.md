# <Name>: spec

Status: draft, <date>. Owner: <who decides>.

## Goal
One or two sentences: who it's for and what they can do once it exists.

## Hard rules
The things that must never change without asking: what it never does, what always asks first, what it must work without. Exact: add a short note wherever a rule could be read two ways (a limit, a threshold, what happens on a second try).

## Shape
The files, folders, commands and settings it adds or changes, and where each one lives. Name real paths.

## Journeys
What a person does, step by step, and what they should see after each step. The qa skill runs these in a real browser, so write them as checks:

1. <Journey name>
    1. <Step>. Sees: <what should be on screen>.
    2. <Step>. Sees: <...>.

## Scenarios
The named states it must work in, such as a fresh PC, an existing setup, a missing or broken folder, the Work profile. The journeys above run in each one that applies.

## Out of scope
What this release doesn't do, so nobody builds it by guessing.

## Open questions
Anything the author isn't sure of. Reviewers start here.

## Review log
Filled in by goldfish-review, drift-check and qa: the date, what was fixed and what was skipped and why.
