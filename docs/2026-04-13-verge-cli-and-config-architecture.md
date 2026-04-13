---
date: 2026-04-13
title: Verge CLI And Config Architecture
tags: [verge, cli, config, architecture, integration]
---

# Verge CLI And Config Architecture

This document describes the clean long-term integration model for Verge.

The goal is to make Verge work across many repositories without baking repo-specific logic into the API or worker.

## The Core Shape

The production-ready shape should be:

- one published `verge` package
- one real `verge` CLI
- one repo-local `verge.config.ts`
- one typed process discovery API
- built-in adapters for common tools

The important rule is that the product model stays:

```text
run -> step -> process -> observation
```

A `process` stays the smallest meaningful tracked unit. That should not change just because the runner chooses to execute work in a convenient way internally.

## Why This Shape Is Right

The current self-hosted implementation proves the runtime model, but it still hardcodes Verge's own repository definitions into the app bootstrap path.

That is fine for the MVP, but it is not the right long-term integration model.

The cleaner model is:

- Verge provides the runtime system
- each repository provides its own typed configuration
- Verge loads that configuration and executes it

That keeps repository-specific behavior in the repository and keeps Verge itself generic.

## Current State

The repo now implements the first version of this shape:

- a root `verge.config.ts`
- a workspace `verge` CLI
- API bootstrap that loads config from disk
- CLI-backed Vitest process discovery for the `test` step

That means the design is no longer only conceptual. The current repo already uses this boundary for its own self-hosting path.

## The CLI

Verge should ship a real `verge` command.

The CLI should be the main entry point for:

- local development
- config loading
- syncing repository definitions
- starting API and worker processes
- validation and diagnostics

In practical terms, the package should expose a `bin` entry so installing Verge gives the repo a `verge` executable.

The CLI does not need to be large. It just needs to be the stable entry point for using Verge.

## The Config File

Each repository should define one `verge.config.ts`.

This file should be the single source of truth for:

- repository metadata
- step definitions
- process discovery rules
- execution commands
- reuse policy
- checkpoint policy

This is the cleanest model because the config is:

- typed
- versioned with the repo
- reviewable in pull requests
- easy to change alongside build and test changes

It should feel similar to other TypeScript-native tool configs such as `vite.config.ts`.

## The Main Boundary

Verge should provide:

- the CLI
- the API
- the worker
- the planner
- the process model
- the UI
- the storage model

The repository should provide:

- the repo definition
- the steps
- the process discovery rules
- step-specific metadata

That means Verge owns the system, and the repository owns the domain-specific configuration.

## Step Definitions

Each step should say how its processes are discovered and how they are run.

That should be explicit. Verge should not guess from random shell output.

Examples of steps:

- `test`
- `lint`
- `build`
- `docs:validate`

Each step should define:

- its key
- its display name
- its command
- which repo surfaces it observes
- whether reuse is allowed
- whether checkpointing is allowed
- how its processes are materialized

## Process Discovery

Process discovery should be a first-class part of the step definition.

That is how Verge knows what actual processes exist before execution starts.

The initial materialization kinds can stay:

- `singleProcess`
- `namedProcesses`
- `discoveredProcesses`

The key point is not the specific kind names. The key point is that each step defines how real processes are materialized.

### `singleProcess`

Use this when the step really is one tracked process.

Example:

- one workspace-wide format check

### `namedProcesses`

Use this when the repository can explicitly define the real processes ahead of time.

Examples:

- one build target
- one document check
- one named smoke scenario

### `discoveredProcesses`

Use this when the real processes should be discovered from the tool itself.

This is the best default for many test systems.

For example, the current Verge repo discovers tests by asking Vitest for the real list of tests, then turning each listed test into one Verge process.

## Built-In Adapters

Verge should ship adapters for common tools.

That is the elegant production-ready path because repositories should not have to invent discovery and result parsing from scratch for normal tools.

The first useful adapters are:

- `vitest`
- `oxlint` or generic lint-by-file
- `playwright`
- simple named target steps
- custom TypeScript steps

Each adapter should own:

- discovery
- execution argument generation
- result parsing

That keeps tool logic in one place.

## Tests As The Reference Example

Tests are the clearest example of the model.

For tests:

- the step is `test`
- each individual test is a `process`

That means Verge should not show repo slices like `api` or `web` as the processes for a test step unless those slices are actually the smallest meaningful tracked unit in that repository.

The cleaner model is:

- discover real tests
- give each test a stable key
- run them
- record one process result per test

Extra metadata such as file path can still exist, but the process stays the actual test.

## Result Ingestion

Discovery alone is not enough.

Verge also needs to map execution results back onto the discovered processes.

So each step adapter should have a matching result-ingestion path.

For example:

- discover tests from the tool
- execute them through the step command
- parse structured output or reporter output
- match the result back to each process key

That is what makes reuse, checkpointing, and per-process UI views correct.

## What The API And Worker Should Load

The API and worker should not eventually depend on hardcoded self-hosted process specs.

Instead, startup should look like this:

1. resolve the workspace root
2. load `verge.config.ts`
3. validate the config
4. sync repository and step definitions into the database
5. plan and execute runs from that synced config

That is how Verge becomes a product instead of a repo-specific prototype.

## Example Shape

The config API should feel roughly like this:

```ts
import { defineVergeConfig, namedStep, vitestStep } from "verge/config";

export default defineVergeConfig({
  repository: {
    slug: "my-repo",
    displayName: "My Repo",
  },
  steps: [
    namedStep({
      key: "format-check",
      displayName: "Format Check",
      command: ["pnpm", "format:check"],
    }),
    vitestStep({
      key: "test",
      displayName: "Tests",
    }),
  ],
});
```

This is only an example, not a final API. The important part is the shape:

- the repo owns the config
- Verge owns the runtime
- built-in adapters reduce repetitive custom code

## What To Avoid

Verge should avoid these long-term:

- hardcoding repository definitions inside the API bootstrap path
- making every repository write raw shell-oriented discovery logic
- exposing execution convenience objects as first-class product objects
- treating grouped execution units as if they were always the real processes

Those choices make the system harder to reason about and harder to reuse across repositories.

## Recommended Direction

The most elegant and production-ready system for Verge is:

- `verge` CLI as the entry point
- `verge.config.ts` as the repository contract
- adapter-based process discovery and result ingestion
- a strict public model of `run -> step -> process -> observation`

That gives Verge a clean product boundary and a clean repository integration story at the same time.
