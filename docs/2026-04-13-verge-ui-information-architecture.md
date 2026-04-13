---
date: 2026-04-13
title: Verge UI Information Architecture
tags: [verge, ui, ux, runs, processes]
---

# Verge UI Information Architecture

The current single-page UI is the wrong shape for the product.

Verge has at least four different levels of information:

- repository state
- runs
- steps inside a run
- processes inside a step

Those should not be flattened into one mixed dashboard.

## Basic Model

The UI should reflect the backend model directly:

- a `run` is one commit-level, PR-level, or manual evaluation
- a `step` is a major check inside a run, like `test`, `build`, or `lint`
- a `process` is the smallest meaningful thing Verge tracks inside a step

That means the main navigation should be built around runs, not around one large homepage panel.

## Recommended Shape

The product should have a small number of clear views:

1. A repository overview
2. A runs list
3. A run detail view
4. Optional process detail views later

## Repository Overview

This page should answer:

- what repository is this
- what is happening right now
- what areas are healthy, stale, or unknown
- what changed recently

This is a summary page, not the main operational surface.

It should show:

- repository name
- active runs
- latest run results
- area health summary
- high-level freshness
- short links into filtered runs

It should not try to show the full structure of every run.

## Runs List

This should be the main working view.

It should be a paginated table with one row per run.

A row should represent:

- one run
- one trigger
- one commit
- one run result

Recommended columns:

- status
- run id
- commit
- branch or PR
- trigger
- step summary
- reused or resumed steps
- started at
- finished at
- duration

Recommended filters:

- status
- trigger
- step
- branch
- commit
- reused vs fresh vs resumed
- active only

Recommended actions:

- open run detail
- rerun
- rerun without reuse
- rerun from checkpoint when supported

This page should feel closer to a CI runs table than a marketing dashboard.

## Run Detail View

This page should answer:

- why was this run created
- which steps existed in it
- what happened at the step level
- which steps or processes were reused
- which step should be inspected next

This is where Verge becomes understandable.

The run detail page should include:

- top summary
- step list

### Top Summary

The top summary should show:

- run id
- repository
- commit
- branch or PR
- trigger
- status
- plan reason
- step summary
- reused-from run id if any
- checkpoint-source run id if any
- created, started, finished, duration

### Step List

The page should first show the major checks inside the run.

Recommended columns:

- step key
- label
- status
- process count
- reused or resumed
- started at
- finished at
- duration

This makes the structure of the run obvious before the user drills into the lower-level processes.

Example:

- run: commit `abc123`
- steps:
  - `build`
  - `lint`
  - `typecheck`
  - `test`

Each step row should link to a dedicated step detail page. The run page should not load every process, event, artifact, and checkpoint by default.

### Step Detail View

This page should show the processes for one step.

It should show every process inside the step in a table.

Recommended columns:

- process key
- label
- file path when it exists
- type
- status
- attempt count
- started at
- finished at
- duration

If the step has many processes, this page should use search, filters, and pagination. It should not introduce another grouping layer just to keep the page smaller.

This makes the internal structure of the run obvious.

Example:

- step: `test`
- processes:
  - one individual test
  - another individual test
  - a third individual test

Without this view, the user cannot tell what the run actually did.

### Events

Show lifecycle events in time order:

- claimed
- started
- passed
- failed
- interrupted
- informational worker messages

This is useful for debugging scheduling and execution.

### Observations

Show the evidence created by the run:

- area key
- process key
- status
- summary payload
- execution scope
- observed at

This is the product-specific part of the UI. It should not be hidden.

### Artifacts

Show artifacts as explicit records:

- artifact key
- media type
- storage path
- metadata
- created at

For logs, the UI should make them easy to open directly.

### Checkpoints

Show checkpoints only when they exist.

Each checkpoint should show:

- created at
- resumable until
- completed process keys
- pending process keys
- storage path

This makes resume behavior explainable.

## Process Detail Views

This can wait until later.

If added, a process detail page would show:

- one process inside one run
- events for that process
- observations from that process
- artifacts from that process

This is useful, but not required for the first good UI.

## Navigation

The navigation should be plain:

- `Overview`
- `Runs`

Then link from `Runs` to individual run detail pages.

Do not make the landing page try to be the whole application.

## URL Structure

The UI should move away from hash-based navigation.

Recommended routes:

- `/`
- `/runs`
- `/runs/:runId`
- `/runs/:runId/steps/:stepId`

Optional later:

- `/repositories/:slug`
- `/runs/:runId/processes/:processId`

Normal routes are easier to reason about, easier to share, and easier to extend.

## Design Direction

The UI should feel operational, not promotional.

That means:

- fewer slogans
- more tables
- clearer status language
- explicit IDs and timestamps
- direct links between summary and detail

The design can still look strong, but it should read like an internal control plane, not a landing page.

## Visual Baseline

The visual baseline should be close to GitHub's default dark UI.

That means:

- dark GitHub-like color theme
- GitHub-like typography choices
- restrained spacing and surfaces
- familiar table, panel, and status treatment

The goal is not to invent a distinct brand language for the product right now.

The goal is to make the interface feel immediately legible and operational, like a tool someone could already imagine using inside GitHub.

## MVP Recommendation

The next UI iteration should do only this:

1. Keep a small repository overview on `/`
2. Add a dedicated paginated `/runs` table
3. Add a dedicated `/runs/:runId` detail page
4. Make the run page show steps only
5. Add a dedicated `/runs/:runId/steps/:stepId` page for process detail
6. Move event, observation, artifact, and checkpoint detail into the step page
7. Remove slogan-style copy from the main view

That would bring the UI much closer to the actual shape of Verge.
