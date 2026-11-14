# Rename everything still called "obeya" to Seismic

## Goal

Seismic is a permanent fork of Obeya: nothing pulls from upstream and nothing points to it. Everything still called "obeya" becomes Seismic, and existing homes, repositories, browsers and paused agents are migrated so they keep working. App releases, the site and the hero video are switched off until Seismic publishes its own.

The rename of 2026-11-07 (bfd10b25) changed the product name, UI strings, docs prose, the agents' MCP tools (`mcp__obeya__…` names still answer for resumed sessions) and the environment variables (`SEISMIC_*`, with `OBEYA_*` as fallback). About 2,100 mentions of "obeya" remain in some 300 files.

## What is left

1. **Home directory.** `~/.obeya` (set in `src/server/main.ts`) with its database `obeya.db`. On the owner's machine it holds 14 GB of worker checkouts (`workspaces/`) plus `read/`, `sessions/`, sites and `owner.key`. A `-dev` checkout uses `~/.obeya-dev`.
2. **Repository folder `.obeya/`** (settings.json, theme.css, logo.svg, adapter/, remote/): committed in *other* repositories and read from their default branch. Seismic writes to it by committing or opening a PR.
3. **Git names.** Card branches `obeya/<slug>-<id>` and baseline tags `obeya/project/<id>/baseline`.
4. **Browser state.** localStorage `obeya-theme`, the phone's project key, the draft key `obeya`, the owner cookie `obeya-<port>` and the header `X-Obeya-Key`.
5. **Desktop app.** Bundle identifier `si.obeya`, binaries `obeya` / `obeya-server`, `Obeya.app`, installer names.
6. **Repo files and names.** Package name, plugin name (now `seismic`, skills cited as `seismic:browser`), `.codex/rules/obeya.rules`, `scripts/scratch-obeya.ts`.
7. **Code identifiers** (`toObeya`, `obeyaId`, `OBEYA_DRAFT`, `window.obeyaApp`, the Codex `clientInfo` "obeya" …): most of the hits, visible to nobody.

Ties to upstream that still work and must go:

- Wishes and bug reports become issues on sadilek/obeya (`src/core/wish.ts`).
- Both updaters (`src/server/app-update.ts`, `app/src/update.rs`, `tauri.conf.json`) check sadilek/obeya releases.
- Release tooling (`docs/release.md`, the release skill, `scripts/gh.ts` docs, the hero-video README) acts as the account `sadilek`. `site/` links to sadilek/obeya and its downloads, runs on obeya.si, and its code-signing page names Daniel Sadilek. The hero video is narrated in his ElevenLabs voice clone, and CLAUDE.md names `/Users/sadilek/...` paths.
- The fork's Build and Pages workflows have failed on every push since the rename.

## Decisions (owner, 2026-11-13)

- **Permanent fork, full rename**, code identifiers and file names included. The docs record the decision.
- **What stays.** LICENSE keeps Daniel Sadilek's copyright line (MIT requires it). The README keeps one line of credit ("Seismic began as a fork of Obeya by Daniel Sadilek") and says the fork has departed for good. Git history stays as it is; `main` is not rewritten.
- **Home directory: moved once to `~/.seismic`, with a symlink back** (W2). Rejected: a lazy copy of the home, which would copy 14 GB while the worktrees still pointed at the old copy.
- **Distribution: later.** App releases, the site and the hero video are switched off now (W1).
- **`.obeya/` in repositories.** Read `.seismic/` first, then `.obeya/`. Write to whichever exists; a repository with neither gets `.seismic/`. Other people's repositories are never moved automatically.
- **Branches and tags.** New ones are `seismic/…`; both prefixes are recognised, so cards in flight land as before.
- **Browser keys, cookie and header.** Read the new name, fall back to the old one, write only the new one. The server accepts both cookie and header names.
- **Compatibility shims that stay**, each marked in the code as a migration shim: the `OBEYA_*` environment variables, the old MCP tool names, and the fallbacks above.

## Workstreams

- [x] **W1:** Cut the upstream ties and switch off distribution. Small, no dependencies, starts at once. `ISSUES_REPO` becomes `nickpalenchar/seismic`. Both update checks (`app-update.ts`, `app/src/update.rs`) are switched off: no request, no update shown; they come back with distribution. `tauri.conf.json`: publisher Nick Palenchar, copyright naming both holders. `pages.yml` and the release part of `build.yml` (tag trigger, signing, publishing assets) are removed; CI that builds and tests on push may stay, and must pass again. The release skill, `docs/release.md` and the hero-video and site-shots scripts are marked as paused until Seismic distributes its own app. CLAUDE.md loses the rules that only serve the site, the hero video, ElevenLabs and releases, and every `sadilek` path and account; they stay readable in `docs/release.md`. README and `docs/design.md` record the permanent fork; `site/` stays in the repo, unpublished.
- [x] **W2:** Stored names and their migrations. About one to one and a half cards. *Home move*, at startup before any worker resumes, only when the home is the default one (`SEISMIC_HOME`/`OBEYA_HOME` unset), `~/.seismic` does not exist, `~/.obeya` is a real folder (not a symlink) and no Seismic runs on it (`server.json`): (1) rename `~/.obeya` to `~/.seismic` and `obeya.db` to `seismic.db` with its `-wal`/`-shm` files while the database is closed; one rename on one disk, nothing is copied; (2) create the symlink `~/.obeya` → `~/.seismic`; (3) run `git worktree repair` for every checkout under `workspaces/` and `read/`, so the project repositories' worktree links follow; (4) rewrite the absolute home paths that the database, `sessions/` and the JSON files hold; (5) paused agents must resume: Claude Code files sessions under `~/.claude/projects/<encoded cwd>`, so those folders of the moved checkouts get their new name too, and the worker checks that a Codex thread recorded at the old cwd still resumes by id; (6) the same for `~/.obeya-dev` → `~/.seismic-dev`. An older checkout started afterwards opens `~/.obeya` through the symlink, finds no `obeya.db` and shows an empty setup; that is acceptable because every Seismic on the machine moves to the new code with `main`, and the start says so. Also here, each with its fallback and a test: `.seismic/` in repositories, `seismic/` branches and tags (both prefixes recognised), browser keys, owner cookie and `X-Seismic-Key` header. Tested on a copy of the real home (`scripts/check-home-migration.ts`, extended to assert the move, the repaired worktrees and the rewritten paths) and with a paused fake-runtime worker that resumes its session after the move.
- [ ] **W3:** Rename code identifiers and files. Mechanical, about 300 files, one large diff; lands after W2, alone, when few cards run, since it conflicts with every card in flight. The identifiers of group 7; package name `seismic`; plugin `seismic` (skills `seismic:browser`, CLAUDE.md and prompts following); `.codex/rules/seismic.rules`; `scripts/scratch-seismic.ts`; the desktop app's binaries and names (`seismic`, `Seismic.app`, identifier `im.seismic`; it matters once distribution returns). Some names W2 left are stored elsewhere and need both forms read rather than a plain rename: the event author `obeya` in the database (`events.author`, `ActivityWho`), the deploy word `obeya:github-folder` in `demo-sites.json`, the connection-code prefix `obeya-site:`, and the `.obeya-installed` marker of installed voices. Done when `git grep -i obeya` shows only the migration shims, LICENSE, the README credit and the design-doc decision. Then this plan doc is deleted; what passes the rebuild test is already in the design chapters.

## Order

W1 and W2 run in parallel. W3 goes last and alone.
