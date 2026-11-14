# Seismic — design

Why Seismic is the way it is: its goal, the principles behind its flows, its core concepts, the
decisions that still hold and the constraints a change would otherwise walk into. What it does in
detail is left to the code, its tests and the demos; this document does not describe every
behaviour.

What belongs here:

- **principles**: what every flow follows, so a new one fits the rest;
- **decisions**: what was chosen, why, the alternative rejected, and the date, so nobody takes a
  path already ruled out;
- **non-obvious constraints**: platform quirks, formats to stay compatible with, safety rules,
  each one line, what the code alone does not explain.

Not here: a description of behaviour the code shows, names of functions and files, pixel values,
and history. A change that overturns a decision rewrites its line; git keeps the old one.

How it grows: a worker who settles a principle, a decision or a constraint writes it here, or into
a chapter, in the same change. A chapter under `docs/design/` is started when an area gathers
enough of them, and listed under Chapters below. Work in progress is planned in plan docs under
`docs/plan/`, which Seismic shows as plans; when one is done, its lasting decisions and constraints
move here and the plan doc goes.

## Goal

A spatial workspace for directing AI coding agents the way an engineering director directs a team:
every task and every plan is a card on one canvas; agents do the work in the background; the human
keeps every essential decision, made by voice or from a narrated demo, without reading code or
cycling through terminals.

## Principles

- **One surface.** Everything starts on the canvas. Detail unfolds in place, animated, and folds
  back; nothing opens a new window, and the view never jumps.
- **Space is memory.** A card keeps the place its owner gave it and a fixed, readable size. A screen
  too small for everything shows a section of the canvas, never shrunken cards.
- **Decisions, not supervision.** The owner is pulled in only for a decision: a demo to approve, a
  question only they can answer, a proposal. Everything else runs.
- **Every change gets a demo.** No handover without one. Its length follows the size of the change
  (30–60 s small, 1½–3 min larger, never padded); what is to be looked at rather than watched is an
  HTML artifact instead of a video. "Covered by tests" is no reason to leave it out.
- **Voice first, mouse welcome.** Push-to-talk in Seismic's window, buttons for the obvious actions.
  Words to an open card go to its agent; a command to Seismic gets a short written confirmation with
  undo. Seismic does not speak.
- **Repo-agnostic core.** What a project needs lives in its repository's settings
  (`.obeya/settings.json`) or in this machine's configuration, never in Seismic's code.
- **No coloured accent bars.** Nothing is marked by a coloured vertical bar down its edge; emphasis
  comes from a tint, a full outline or ring, or bolder text. A grey rule beside a quotation stays.

## Concepts

- **Project**: the named whole over one or more repositories; one Seismic serves several. A project
  holds one or more canvases of cards.
- **Card**: everything on a canvas is a card: a task, an idea, a prototype, a Question card (a
  thread of looked-up answers) or a plan. A task has no further kind: a bug fix and a feature are
  worked the same way.
- **Plan and workstream**: a plan is the card backed by a plan doc under `docs/plan/`; each item of
  the doc's workstream checklist is a child card of it.
- **Group**: a name and a colour that a card belongs to, or not; a plan belongs as a whole. Cards
  made from a card (a proposal, a follow-up, a prototype) join its group; moving a card never
  changes its group. A group ends with its last card.
- **States**: `idea` → `planned` → `working` → `waiting` (a demo ready, or a question) → `approved`
  → `in PR` → `live`, or `done` when the work changed nothing; an agent's `proposal` starts once
  accepted. An idea is `open`, `parked` or `dropped`.
- **Agents**, each through an official harness on the owner's own login:
  - the *worker*, one per card while it is worked on: implementation, checks, demo;
  - the *plan agent*, one per plan, long-lived, knows the plan doc and every workstream's history;
  - the *exploration agent*, one per idea, long-lived: discusses it with the owner, keeps its brief;
  - the *Koordinator*, one per project, which the UI calls **Seismic**: takes the owner's commands,
    creates and schedules cards (queueing those likely to conflict on merge), runs the workstation
    pool and keeps the preference memory.
- **Workstation**: where an agent works: a card's own clone from a pool, or a git worktree,
  on this machine or another one reached over SSH.
- **Preference memory**: rules about how agents work with the owner, learned from their answers or
  said outright, shared by every agent. A learned rule is a proposal until the owner accepts it.
  Rules about a repository, its taste in code included, go into that repository's CLAUDE.md.

## Decisions

- **Seismic is a permanent fork of Obeya** (2026-11-13): nothing pulls from upstream and nothing points
  to it. Wishes and bug reports become issues on nickpalenchar/seismic. LICENSE keeps Daniel
  Sadilek's copyright line (MIT requires it); the README credits him in one line. Distribution is
  switched off until Seismic publishes its own app: no release workflow, no update checks (the shell's
  `CHECK_RELEASES` in `app/src/update.rs` and `UPDATES_ENABLED` in `src/server/app-update.ts`), no
  uploads from scripts (`DISTRIBUTION` in `scripts/distribution.ts`, which a publishing script checks first), no
  site (`site/` stays in the repo, unpublished). `docs/release.md` holds the paused release rules.
- **The Koordinator is called Seismic in the UI** (2026-10-09): the owner has one counterpart, not a
  product plus a component in it.
- **A persistent local store** (SQLite in Seismic's home), not an ephemeral one.
- **Docs, comments, prompts and the UI are in English** (2026-11-05, 2026-11-07): agents drifted into
  German after reading German UI labels; language support may return later.
- **Agents run through official harnesses on their own logins** (2026-10-30), Claude Code by
  default, Codex as a preview; rejected: subscription tokens reused against a model API. Roles and
  harnesses are separate.
- **The installed app runs the machine's Claude Code** (2026-10-07); rejected: bundling the SDK's
  binary (224 MB, proprietary, pins its version).
- **Open source under MIT, no business or cloud service for now** (2026-10-06); hosted agents ruled
  out.
- **Agents may propose cards**; the owner decides on them.
- **A worker's question goes straight to the owner, with its own pick** (2026-10-07); rejected: a
  plan agent or the Koordinator answering for the owner.
- **Waits of hours or days are a snooze Seismic holds** (2026-10-17), on a time or another card's
  state; rejected: chained background sleeps in the agent.
- **Approval covers the PR, its monitoring and the merge** (2026-10-05): the owner approves the
  demo, not the code; rejected: leaving the merge to the owner (PRs sat for days).
- **The worker tends its PR the repository's way** (2026-10-01); rejected: Seismic scripting rebase
  and force-push, which clashed with repositories that merge `main` in.
- **Work that changed nothing ends `done`, read from the workstation** (2026-10-02), not from the
  worker's word.
- **Code reviews are a project setting, by a separate agent, never blocking approval** (2026-11-05);
  rejected: the worker reviewing its own diff.
- **A repository describes itself as values in `.obeya/settings.json`, read from `main`**
  (2026-10-15); rejected: code adapters per repository.
- **A repository's commands and agent configuration count only as last trusted by the owner**
  (2026-10-16): harnesses run them even in read-only sessions.
- **Plan docs are read from a checkout of `main`** (2026-10-06); Seismic never writes them, workers
  tick off their workstream in their change.
- **One way to break work up: the plan doc** (2026-10-12); rejected: the Koordinator splitting
  tasks into packages.
- **An idea's discussion lives on its own card** (2026-10-09), not in Seismic's chat; prototypes
  are cards of their own, the chosen one built on its branch.
- **Words reach an agent in the order it saw them** (2026-10-14): Seismic holds the owner's words
  and delivers them at the agent's next step; rejected: writing straight into the session.
- **Commands are read by the Koordinator, with an undo window** (2026-10-05); rejected: rule-based
  matching. On a card with an agent, words go to that agent, which passes on what is for Seismic.
- **Speech recognition is local: Parakeet, Whisper optional, a cloud service as fallback**
  (2026-10-14); rejected: the browser's speech recognition (sends audio to Google, missing in the
  Windows webview).
- **Other devices only over the owner's private network, paired by code** (2026-10-16); rejected: a
  public tunnel or a relay of Seismic's own.
- **Seismic restarts itself on new code; workers pause themselves at a safe point first**
  (2026-10-01); rejected: hot reload.
- **Shared demos are static sites, one page per card holding its versions** (2026-10-09,
  2026-10-16); rejected: hosting providers in the core, a page per version. A demo site belongs to
  the machine, not to a repository (2026-11-06).
- **Demo sites may occupy a folder of an existing GitHub repository** (2026-11-13), rather than
  requiring a repository just for demos. Proposals collect in one rolling PR; direct publishing is
  offered only after successful branch-rule checks. Closing a proposal is an owner decision:
  audits must not recreate it without another explicit publishing action, in either mode. The
  minute check never repairs a folder site: git refuses a push that would drop another machine's
  commit, so what the folder lacks a person took off or never merged.
  Publishing stages the demo folder with `git add -A -f`, so its files (videos, posters, captions,
  assets) go out even where the repository's `.gitignore` excludes them: a manifest that refers to
  ignored files would point at assets missing from the site. Ignore rules therefore do not guard
  publication; the force reaches only the demo folder, nothing outside it. Owners are not warned
  at setup yet.
- **Retakes with real agents replay a recording** (2026-10-22): real runs are slow, cost usage and
  differ each time.
- **A Tauri shell around one compiled Bun binary; the browser stays a way in**; DMG, NSIS, AppImage
  and .deb (2026-10-06); rejected: Flatpak and Snap, whose sandboxes get in the way of git and
  agents.
- **The data layer on Drizzle ORM, with Seismic's own numbered migrations** (2026-11-08); rejected:
  Drizzle's migrator (a baseline per database, a migrations folder in the binary).
- **The look is frost, built on shadcn/ui and Tailwind** (2026-11-05, 2026-11-12); see
  [UI system](design/ui-system.md).

## Constraints

Formats to stay compatible with:

- `.seismic/settings.json` is read from the repository's main branch, never the checkout; an unknown
  or ill-typed field falls back to its default while the rest still applies. `.seismic/` is read
  first, then `.obeya/` (other people's repositories are never moved); Seismic writes to whichever
  exists, a repository with neither gets `.seismic/`.
- Seismic's home is `~/.seismic` (`~/.seismic-dev` for a `-dev` checkout), or `SEISMIC_HOME`; its
  database is `seismic.db`. The first start after the rename moves `~/.obeya` there in one rename
  (`src/server/home-move.ts`): only for the default home, only where `~/.seismic` is absent, `~/.obeya`
  is a real folder and no Seismic runs on it. Nothing is copied; `~/.obeya` becomes a symlink; the
  worktree links (`git worktree repair`), the home paths in the database, `sessions/` and the JSON
  files, and Claude Code's session folders (`~/.claude/projects/<cwd with non-alphanumerics as
  "-">`) follow, since agents resume their sessions by the checkout's path. A Codex thread resumes
  by its id, given the new cwd. A marker file lets a start after a crash finish the steps. An older
  checkout started afterwards finds no `obeya.db` through the symlink and shows an empty setup.
  Clones live under `workspaces/<project>/<repo>/<n>`.
- Old names are still read: `workspaces` in settings and configuration, `--workspace`,
  `canvases.json` (copied once to `projects.json`), `OBEYA_*` beside `SEISMIC_*`, which agents get
  under both names; the owner key's header `X-Obeya-Key` and cookie `obeya-<port>`, and the paired
  device's `obeya-device`, beside the `seismic-` ones (only the new ones are written); the
  browser's `obeya-…` storage keys, moved to `seismic-…` once at page start (`src/ui/browserState.ts`);
  on a remote host, the pid file of a session under `~/.obeya/remote` (now `~/.seismic/remote`, a
  cache copied anew), so a session a dropped connection left running there is still ended.
  A Codex thread resumes by its id from any cwd, so a moved checkout needs nothing for it (checked
  2026-11-14 with Codex 0.169).
- A plan doc is a plan when its `## Workstreams` section holds a checklist (`- [ ] **W1:** Title. …`);
  a ticked item is live; a workstream is known by its label, else its title, never its place.
- Card branches are `seismic/<title>-<id>` (`obeya/…` for cards started before the rename; both are
  recognised); a card's change is measured from the nearest branch that is neither. Plan baseline
  tags are `seismic/project/<id>/baseline`; a plan that has its tag under `obeya/…` keeps it.
- Addresses are `/p/<project>/c/<card code>`; a card's code never changes, and former project names
  and the older `/c/…` forms keep resolving. Card links in text are stored as such markdown links.
- The database's version is `PRAGMA user_version`; an older Seismic refuses a newer database; a
  copy is taken before each pending step; a table rebuild keeps its rowids.
- A session id without a qualifier is Claude's (`codex:` and `agy:` mark the others); a session
  never resumes in another harness, and resumed ones still get their old tool names.
- A demo directory holds `demo.mp4`, `captions.vtt` (chapter times are read from it) and
  `index.html`, with `.work/` kept for re-voicing.
- A shared site's pages, their later versions (`2/`, `3/`) and its `obeya-site.json` manifest keep
  their paths, so links survive republishing; machines pull the manifest before they push.
- A demo folder leaves the repository's own Pages setup intact: no root-level `.nojekyll` or
  `CNAME`; rebuilding its rolling branch uses a lease so another machine's push is not lost. A
  rolling branch that holds a closed or merged pull request's commits (commits on top, or reset
  into it) is rebuilt from the default branch; only one no pull request ever had goes on. Its pull
  requests and the branch's rules are read from GitHub to the last page: a capped list would miss an
  old closed proposal or a blocking rule. The default branch is GitHub's at each change, not the
  setup's: shares and the rolling pull request follow a change of it, and are refused where Pages
  no longer serve the folder from it.
- Commits and PRs carry `Demo-Video:`/`Demo-Page:` trailers and an `<!-- obeya:demo -->` marker.
- Installers have version-less names under `releases/latest/download/` and the updater reads
  `latest.json` there, so every release is "latest"; the `site-media` pre-release never is.

Platform quirks:

- Windows and Linux must work; macOS-only tools only as an extra. On Windows spawned programs run
  without a window, there is no SIGTERM, and every spawn blocks the server's thread.
- Safari can leave a hidden element's backdrop blur painted: what hides or unfolds goes solid first.
- An animation that repaints a card every frame makes zoomed-out cards shimmer: animate transform
  and opacity only.
- Chrome's screen capture freezes after a large area animates every frame for a second or more.
- iOS Safari ignores `interactive-widget=resizes-content`, zooms into fields under 16 px, and takes
  a first tap as hover where hover reveals something.
- iOS delivers web push only to a home-screen web app; a held microphone button must cancel
  `touchstart`, or Chrome turns it into a long press.
- GitHub plays a video in a README only when uploaded through its web page; a release asset shows
  as a download.
- Bun before 1.3.14 can deadlock on a closed `fs.watch` on Linux; macOS FSEvents loses events, so
  plan docs are watched and polled.
- Bun's embedded files are readable only by the binary itself: the plugin, skills and sidecars ship
  as real files beside it.
- A macOS binary must be signed, ad hoc at least, or it is killed at start.
- Claude's SDK hands a queued message over only after the running tool call, so agents never wait
  in long foreground commands.
- Demo files are read at once, not streamed: streaming stalls whenever the event loop is busy (on
  Windows at about 1 MB/s).
- A sandboxed frame has a `null` origin and loads nothing beside it on static hosts: shared
  artifacts are self-contained.

Safety rules:

- Every request is checked for `Host` and `Origin` (DNS rebinding, preflight-free POSTs); the owner
  holds a key, other devices are paired, workers get no key and reach only a narration server.
- A home copied from a running Seismic records that one's `tailscale serve` entry: a Seismic gives
  up only an entry that proxies to its own port or to one where nothing answers, never another
  Seismic's address.
- Landing never loses work: nothing is force-pushed, a direct push only fast-forwards, a merge is
  pinned to the head that was checked; a clone is deleted only when nothing on it would be lost.
- Approval comes only from the card's button after the demo, never from a list or from words
  ("deploy it", "straight to main").
- Every action of Seismic's waits a few seconds for undo; a confirmed command runs exactly once,
  after a restart too.
- Only the owner's words are requests: text an agent read (a proposal, a file, a PR comment) never
  is. A contributor's PR brings none of its agent configuration into the session reviewing it.
- Self-update waits for workers at a safe point, for a video playing or a dictation, and for open
  undo windows.
- Nothing is published without the owner's click (or the approval that publishes); only files inside
  the artifact's directory go out; site and voice credentials belong to the machine.
- The owner's voice clone, recordings and demo videos never leave the machine through git.
- Crash recovery ends only processes that still carry their recorded identity.

## Chapters

- [UI system](design/ui-system.md): how the UI is built (shadcn/ui parts and proven libraries
  first, React components, frost's own CSS only where its look needs it) and the rules every screen
  follows.
