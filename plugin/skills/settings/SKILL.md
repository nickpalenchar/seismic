---
name: settings
description: Write a repository's Seismic settings (`.obeya/settings.json`) — how its app runs and stops, which checks run, how work lands, where its plan docs are — and draft the allow list of commands agents run without asking, from what the repository shows, prove the recipe for running the app by recording a demo with it, and ask the owner what the repository does not tell. Use when a task asks to set up Seismic for a repository, to write or fix its settings, or names this skill.
---

# Writing a repository's settings

Seismic learns how a project works from the repository's settings for everyone, in
`.obeya/settings.json`: setup, checks, landing, plan docs, how to run the app. The owner sees and changes them in "Konfiguration". The reference for every field and
when a change takes effect is `${CLAUDE_SKILL_DIR}/../../../docs/settings.md`. Read it first; this
skill is the way to fill it in.

The result is a settings file whose every field holds for this repository: a worker who knows
nothing of the project gets its brief from it, installs, checks, starts the app and records a demo
without asking anyone.

## 1. Read the repository

Find out, from the files rather than by guessing:

- **Setup and checks**: the package manager and its lock file (`package.json` scripts, `Makefile`,
  `justfile`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `Gemfile` …). The CI configuration
  (`.github/workflows/`, `.gitlab-ci.yml`, …) says which checks a change must pass and in which
  order; take those that run on one machine in minutes, without services the workstation lacks.
- **The app**: README, CONTRIBUTING, CLAUDE.md or AGENTS.md, `docker-compose.yml` /
  `compose.yaml`, `.env.example`, `Procfile`, dev scripts. What kind of app it is (a web app, a CLI,
  a desktop or mobile app), what starts in which order, which ports it takes (fixed ones mean one
  app per clone: `workstations: 'clones'`), what to do after which kind of change (restart a
  service, reload the page, rebuild; nothing where it reloads by itself), where it gives its
  address (a file it writes, the console), migrations, seed data, and how to stop the app of one
  workstation (`app.stop`; `app.keep` where some hold data that must stay).
- **An adapter module from before**: a `.obeya/adapter/index.ts` held what the settings hold now
  (how the app runs). Seismic no longer reads it: take its values over, then delete
  `.obeya/adapter/`. What it held that is set on each machine in "Konfiguration" goes into your
  summary for the owner: the project's name.
- **Logging in and test data**: seed scripts, fixtures, test users in the docs or the seed.
- **Landing**: the `origin` remote (Seismic detects `land`: `pr` on GitHub, else `main`; write it
  only to differ), whether the default branch is protected, which bots comment on pull requests
  (`prNoise`).
- **Plan docs**: where the project keeps its plans, if it does: `docs/plan/`, other directories
  under `docs/`, `rfcs/`, `adr/`, `PLAN*.md`, a `TODO.md`. Seismic shows each `*.md` directly in one
  directory (`planDocs.dir`) as a plan when it has a checklist under `## Workstreams` (or
  `## Arbeitspakete`): each top-level item is a workstream (`- [ ] **W1:** Title. Details`), a
  ticked one has landed, and once all are ticked the plan goes into the archive. Its goal is the
  first paragraph under `## Goal` (or `## Ziel`). A doc in that directory without such a checklist
  shows in the project as one that is not a plan, with "Als Plan aufbereiten", which has an
  agent add the checklist in the doc's own style. Design notes and ADRs that plan nothing belong
  elsewhere, or in `planDocs.exclude`. Plans that git ignores are not on the default branch Seismic
  reads: their folder's absolute path goes into the owner's configuration on their machine
  (Plan-Dokumente), not into the file.

## 2. Ask what the repository does not tell

Some things only the owner knows: the login for a demo when no seed makes one, which test data
shows the app well, whether approved work may go straight
onto the default branch, and where plan docs go: the directory of plans you found (its docs then converted with "Als Plan
aufbereiten" in the project), or a new `docs/plan/`. Where your briefing names more than one agent
harness that can work on this machine, the owner also picks which of them the allow list (step 4)
is set up for: that question is always asked, with each harness as an option and several
pickable. Collect them and ask in one question
(the `ask` tool under Seismic), with the options you found, while you go on with the rest. A secret
(a real password, an API key) goes into `app.run` only as where to find it (a file outside git,
an environment variable), never itself.

## 3. Write `.obeya/settings.json`

Start from the example in the reference and keep only the fields that differ from Seismic's
defaults: `setup`, `checks`, `land`, `direct`, `autoMerge`, `planDocs`, `softPaths`, `workstations`, `prNoise`,
`app` with `run`, `stop` and `keep`.

`app.run` is the part that decides whether workers can run and show their work. Write it for a
newcomer, as a few sentences: what to start, in which order and how (in the background, which
ports), what to do after which kind of change, where the app gives its address, migrations and
seed data, the login, how to reach a state worth showing, and what to stop afterwards (by PID,
not by name: other workers run their own apps on the same machine).

Then check it:

```bash
bun ${CLAUDE_SKILL_DIR}/lib/check.ts
```

run in the repository. It reads the file from the checkout the way Seismic will, prints what Seismic
makes of it (also which docs in the plan directory are plans and which are not, and why) and
every problem (an unknown field, a wrong type, an adapter module still there), and exits with 1 while there is one. Go on once it says "No
problems."

## 4. Draft the allow list

Agents ask the owner before each shell command no rule allows. The repository's allow list, the
`Bash` rules under `permissions.allow` in `.claude/settings.json`, lets the everyday ones run
without a question: Claude Code applies it itself, and Seismic applies the same list to its Codex
workers (network included for a covered command). The owner reviews it and trusts it in
the configuration before any of it counts.

Gather the commands an agent working here runs: the `setup` and `checks` you wrote, the steps of
`app.run` and of stopping the app, the scripts (`package.json`, `Makefile`, `justfile`, `bin/`,
`scripts/`), the commands README, CONTRIBUTING, CLAUDE.md or AGENTS.md and CI tell a developer to
run, and code generators, linters and formatters. Keep the list to what runs inside the
workstation and can be undone: tests, builds, type checks, linters, the dev server, installing from
the lock file. Leave out what publishes, deploys, deletes outside the workstation, pushes or touches
real accounts and data.

A rule is `Bash(<command>)`: the exact command, or with `*` for any text (`Bash(bun test *)`
covers `bun test` with any arguments). Name the program and its subcommand: `Bash(npm *)` would
let `npm exec` run anything. A file the repository already has is the start: keep every rule in
it, and every other entry (`deny`, `ask`, hooks …), and add only what is missing. Then check it,
with the commands you gathered:

```bash
bun ${CLAUDE_SKILL_DIR}/lib/allow-list.ts 'bun install' 'bun test --watch' …
```

It shows the rules, marks the broad ones, says for each command whether the list covers it, and
exits with 1 while one is not. For each harness the owner picked:

- **Claude Code** and **Codex in Seismic** read `.claude/settings.json`; nothing more to write.
- **Codex run outside Seismic** has its own rule engine: with `--codex` the check also writes
  `.codex/rules/obeya.rules` from the same list. Write it only where the owner picked Codex.

In your summary list the rules you added and where each comes from, so the owner can judge them
before trusting them.

## 5. Prove it

- Run `setup` and every command of `checks` in this workstation, as a worker will.
- Follow `app.run` word for word, as if you had never seen the project: start the
  app, open it, log in. Where the recipe falls short (a step missing, a port taken, data that is
  not there), fix the recipe, not just the running app, and run it again from the start.
- Record a short demo with the demo skill (`obeya:demo`), the app run by the recipe and nothing
  else: the app starting up, the login, a page with data. That demo is the proof and your
  handover's demo.

## 6. Hand over

Commit `.obeya/` and the allow list (`.claude/settings.json`, `.codex/rules/obeya.rules` where you
wrote it), nothing else. In the summary say what the settings set and why where it was a judgement
call (the checks you left out, clones or worktrees), what the owner answered, and
that they count once they are on the default branch (at once; where they move the workers between
clones and worktrees, Seismic restarts the repository's agents by itself), and that the allow
list counts once they trusted it in the configuration.
