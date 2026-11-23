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
  made from a card (a proposal, a follow-up, a prototype) join its group. Creating a card by
  double-clicking or double-tapping the canvas joins the group whose painted territory contains
  that point. Moving a card never changes its group. A group ends with its last card.
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
  Sadilek's copyright line (MIT requires it); the README credits him in one line.
- **Seismic ships its own desktop app from GitHub Releases** (2026-11-17), from v0.1.0 on, with
  Seismic's own updater key and app identifier: the build workflow drafts a release for every tag
  `v<version>`, the owner publishes it, and the live seismic.im (built from the separate
  `seismic-site` repository) links its version-less downloads. macOS signed and notarised; Windows
  and Linux unsigned, with `SHA256SUMS`. The upstream's machinery came back as it was (switched off
  on 2026-11-13) without its hero video, site screenshots and Pages site; `site/` here stays
  unpublished (`SITE` in `scripts/distribution.ts`). Release notes are a curated `CHANGELOG.md`
  section per version, each entry linking its demo, with the commits folded under it; rejected:
  commit subjects as notes (hundreds of lines per release, unreadable for users). Kill switches:
  `DISTRIBUTION` in `scripts/distribution.ts`, `CHECK_RELEASES` in `desktop/src/update.rs`,
  `UPDATES_ENABLED` in `src/server/app-update.ts`. `docs/release.md` has the process.
- **The Koordinator is called Seismic in the UI** (2026-10-09): the owner has one counterpart, not a
  product plus a component in it.
- **A persistent local store** (SQLite in Seismic's home), not an ephemeral one.
- **A write's answer goes out before the snapshot is built** (2026-11-21): the board's listeners
  hear of a change on `setImmediate` (`Board.tell`), after the request that made it has its
  response written, not in a microtask, which held the response until the whole snapshot was built
  and sent (about 1 ms ahead of the push on a 600-card project). The v1 routes answer with what they
  changed, which the page shows at once. Tests wait for the listeners with `heard()`
  (`src/server/test/helpers/testing.ts`), not a bare `Bun.sleep(0)`.
- **The page keeps what a snapshot did not change as the objects it holds** (2026-11-21): the
  whole project still comes with each change, but `withUnchanged` (`src/ui/api.ts`) gives each card
  and part that is the same as before its previous object, so memoized components (`CardView`,
  `AgentEntry`, `CardHandles`) are not drawn again; on 600 cards that drew some 35,000 components
  per change. This holds only while the snapshot carries nothing that changes on its own (a "now"
  or a counter on each card), and while what the canvas and the docked sheets pass a card is the
  same values and functions from render to render (`useCallback` over a ref, as `openCard`).
  Rejected for now: sending only the changed cards, which would change the server's push.
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
- **A parked card holds nothing back while parked** (2026-11-15): it is neither in progress, a
  pending workstream nor a possible duplicate, arrows from it hold nothing, and no chain of waits
  runs through it. A queued card keeps its wait on it, so the wait holds again once it is unparked
  (unless that card has come to wait for the queued one meanwhile); one waiting only on parked
  cards starts.
- **Approval covers the PR, its monitoring and the merge** (2026-10-05): the owner approves the
  demo, not the code; rejected: leaving the merge to the owner (PRs sat for days).
- **The worker tends its PR the repository's way** (2026-10-01); rejected: Seismic scripting rebase
  and force-push, which clashed with repositories that merge `main` in.
- **Work that changed nothing ends `done`, read from the workstation** (2026-10-02), not from the
  worker's word.
- **A worktree given back clean is removed, its branch kept** (2026-11-17): a card's worktree is
  cheap to make again (`git worktree add` from the branch), while a folder left behind costs hundreds
  of megabytes of dependencies and nothing ever came back for it. Files git ignores do not make it
  dirty (they are what a new worktree installs again); uncommitted changes do, and that worktree
  stays as it is. A card that stops *with* commits on its branch still keeps its worktree: the diff
  and changed-files views read from it. Rejected: keeping every worktree until the card lands, which
  left a folder per stopped card.
- **An idea's agent works in the repository's checkout, holding no workstation and no slot**
  (2026-11-18): it reads and discusses, so a clone or worktree of its own would be cost without
  use. The Workstations pill still shows it while it works on a reply, as a dot after the cards'
  in the idea's colour when there is room, counted at work and outside the worker scheduling cap.
  Where the repository has no workstation on this machine (clones on other machines alone, a
  folder without git) the pool gains
  an entry for this machine's checkout (`PoolHost.checkout`) that holds only those ideas. Rejected:
  leaving working ideas off the pill, which hid agents at work from its count.
- **A capped worktree display gives each visible worktree one position** (2026-11-18), including
  those waiting on the owner. Visible busy worktrees have priority if the display fills. Hidden
  workers and queued or snoozed cards retaining a worktree reserve space left after visible workers.
  Working ideas can use the remaining positions.
- **What Seismic suggests by itself is switched per project** (2026-11-14): new cards from the work
  retrospective, merges from the duplicate check at a card's start, and labels. Off takes the tool
  and its instructions out of the agent's session rather than telling it to refrain.
- **Code reviews are a project setting, by a separate agent, never blocking approval** (2026-11-05);
  rejected: the worker reviewing its own diff. Once a review has run on a card, it and its one list
  of items stay for the card's whole life (2026-11-17): a handover the project would not review (its
  setting off, a review the owner started by hand, no change left on the branch) and turning the
  setting off keep them, in manual mode. Rejected: dropping them, which started every later review
  from an empty list. Verifying resubmitted fixes is part of the review: in manual mode too, the
  handover that resubmits them starts the review by itself (2026-11-18); only a review of new work
  waits for "Start code review".
  Card approval stays available with raised or reopened findings (2026-11-20), so the owner can
  proceed with the handover without deciding each finding. The approval dialog warns that the
  findings will stay unanswered and any unsent choices will be dropped. If approval also ends
  review work in progress, the same dialog warns about that too, on every approval route.
- **A model out of usage is the owner's to route around, on the card** (2026-11-17): a worker or
  code review stopped by its model's usage limit shows a callout naming the model, with "Try again",
  "Select new agent" and, for a review, "Skip review". A worker handed to another model of the same
  harness resumes its session; across harnesses it starts afresh from the briefing and its branch,
  since sessions never cross harnesses. A review keeps its run's agent when retried, even if the
  "Code reviews" setting changed; skipping drops the stopped run and keeps the review's items.
- **Every agent role has its own harness, model and effort** (2026-11-19). Project choices override the machine's defaults.
  A new choice applies to new sessions. An existing session belongs to the harness that created it. Antigravity processes sharing
  a checkout use the same credential-free workspace MCP file. Each session has its own stdio bridge and tool registration,
  and holds a checkout lock while it uses the file, so cleanup waits for sessions from every Seismic process. The shared
  config dispatches to each session's own Seismic executable and entry point from its environment.
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
- **A card says whether its canvas holds it (`canvasVisible`), derived as the server builds the
  cards, not stored** (2026-11-15): a stored flag would need updating on every archive, collapse,
  plan-doc change and merge proposal, and would drift. The canvas holds what is folded away (a
  collapsed plan's workstreams, a merge proposal's partner); it does not hold deleted, archived,
  parked or snoozed cards, ended prototypes, or the workstreams of an archived plan or whose key left the doc.
  Rejected: "drawn right now", which would make folding a plan empty its canvas. A canvas is empty
  when no card on it is visible and no group on it holds a visible card (`canvasHolds`); the
  server's delete, the Koordinator's precheck and the drawer's trash (the server's `inUse`) ask only
  that. Deleting a canvas moves its parked and snoozed cards to the destination picked in the
  warning (`main` by default). They appear there when unparked or woken. The warning follows the
  canvas's current counts, and deletion requires the counts shown at confirmation to still match.
  Deletion removes the canvas's groups and leaves its other invisible cards their canvas id. When
  an archived or deleted card comes back, or a plan doc returns, a missing canvas falls back to
  `main`, as do follow-ups and prototypes made from those cards (`homeCanvas`). An unarchived card
  tells the owner so in a toast. Rejected: archived cards blocking a delete, or moving to `main` with it.
- **The setup assistant goes in steps** (2026-11-15): agents (several picked at once, each with
  what it needs, git shared below them), the model of Seismic's own agent (harness, model and effort,
  among the picked agents only. Edits stay in the step until Confirm saves them. The model lists
  of Codex and Antigravity are read before any harness is saved), the features that can wait,
  then on the first start the first project. Going on from the first step needs one configured agent, which counts
  only with git ready too; the Seismic step needs a confirmation, the features step never blocks, a
  callout names what is left out. Rejected: tabs
  "Needed"/"Recommended" with the first project under the needed ones. A login done in a shell of
  its own (over SSH) brings no focus back to the page, so while a login the step waits for is
  missing the list checks again every 15 seconds (also where Seismic opened no terminal and the
  owner ran the command by hand), and each login has its own "Check again".
  The page shows at once and checks each agent on its own (`/api/setup?sections=`), git in a section
  and check of its own too, so a slow git holds back no agent's result; a spinner with "Checking …"
  by an agent until its check answers or fails (2026-11-18). Each answer carries the installation as
  it was when its check began, so only the answer of the latest check sets it. An agent the owner has not ticked
  or unticked is picked once its check finds it ready and stays off otherwise; one the owner touched
  keeps their choice whatever the check finds. Settings → Advanced relaunches Setup in a solid dialog
  above Settings. Reopened setup only offers connected harnesses;
  new connections are made in Settings → Harnesses. Rejected: one check of everything before the page
  shows (a slow CLI held up the whole page), and picking Claude Code where none is ready.
  The repository a first project is cloned from is read when its field is left with another value
  than the one read last (2026-11-18), not while typing. Both `git ls-remote` and `git clone` use
  gh's login as Git's only credential helper for GitHub when signed in to github.com itself
  (`gh auth status --hostname github.com`, the same check as the setup's GitHub login item: a
  plain `gh auth status` also passes on a GitHub Enterprise login alone). Both normalize GitHub web
  URLs and owner/name to HTTPS and scope the helper to https://github.com.
  Otherwise the background check skips configured helpers because they can open dialogs, and
  an explicit clone uses them so saved HTTPS credentials still work. Both commands disable Git's
  own prompts and run without a controlling terminal. The default SSH command runs in batch mode,
  and Git keeps any SSH transport selected through its configuration or environment. The read
  reports a timeout even if a child process keeps its output pipe open. Rejected: `gh repo view`,
  which an API token can pass without the contents access a clone needs. A GitHub repository that
  cannot be read while gh is logged out may just be private, so the
  line offers gh's login and, a login in a terminal of its own bringing no focus back, reads again
  every 15 seconds until it shows. The check informs and does not block the clone.
- **A project has an icon, as a canvas has** (2026-11-19): the same values and the same picker, so a
  mark means the same on both. It is saved in Seismic's configuration beside the project's name, as
  part of what the owner calls the project on this machine, not in the repository's settings, which
  are shared with everyone working on it. Rejected: a separate set of project icons.
- **A popover inside the Configuration dialog is modal** (2026-11-19): the dialog keeps its content
  mounted outside its own subtree, so a non-modal popover there counts as outside it and a press in
  the popover closes the dialog.
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
  Nothing may create `~/.seismic` before that move, or it is skipped: the desktop app's shell keeps
  `~/.obeya` as its home (its log, the window's place) until the server has moved it.
  Clones live under `workspaces/<project>/<repo>/<n>`.
- Old names are still read: `workspaces` in settings and configuration, `--workspace`,
  `canvases.json` (copied once to `projects.json`), `OBEYA_*` beside `SEISMIC_*`, which agents get
  under both names; the owner key's header `X-Obeya-Key` and cookie `obeya-<port>`, and the paired
  device's `obeya-device`, beside the `seismic-` ones (only the new ones are written); the
  browser's `obeya-…` storage keys, moved to `seismic-…` once at page start (`src/ui/browserState.ts`);
  on a remote host, the pid file of a session under `~/.obeya/remote` (now `~/.seismic/remote`, a
  cache copied anew), checked once and removed when distinct. If both paths name the same file,
  its contents determine recovery before replacement, including a pre-rename bare PID. Marked
  records at either path require their unique mark: the environment via `/proc` on Linux, or
  the supervisor’s argv via `ps -ww` elsewhere. The supervisor forwards signals and stdin to
  Claude and returns its exit code. If the mark cannot be read (including older marked records
  without a supervisor on macOS), recovery leaves the process alone;
  rounded process start times cannot establish identity. Only a bare legacy record gets the
  one-time Claude command check.
  A Codex thread resumes by its id from any cwd, so a moved checkout needs nothing for it (checked
  2026-11-14 with Codex 0.169).
- Names in stored data from before the rename are read beside the new ones: `events.author` and
  `activity.who` `obeya` became `seismic` in a database step; the deploy words `obeya:github-pages`
  and `obeya:github-folder` in `demo-sites.json`, the connection-code prefix `obeya-site:`, the
  `.obeya-installed` marker of an installed voice and the `<!-- seismic:demo -->` marker in a pull
  request's description still count. A shared site's `obeya-site.json` manifest keeps its name.
- A plan doc is a plan when its `## Workstreams` section holds a checklist (`- [ ] **W1:** Title. …`);
  a ticked item is live; a workstream is known by its label, else its title, never its place.
- Card branches are `seismic/<title>-<id>` (`obeya/…` for cards started before the rename; both are
  recognised); a card's change is measured from the nearest branch that is neither. Plan baseline
  tags are `seismic/project/<id>/baseline`; a plan that has its tag under `obeya/…` keeps it.
- Addresses are `/p/<project>/c/<card code>`; a card's code never changes, and former project names
  and the older `/c/…` forms keep resolving. Card links in text are stored as such markdown links.
- The database's version is `PRAGMA user_version`; an older Seismic refuses a newer database; a
  copy is taken before each pending step; a table rebuild keeps its rowids.
- Antigravity account-quota errors report `RESOURCE_EXHAUSTED (code 429): Individual quota reached.`
  followed by a relative `Resets in 152h12m37s.` duration; sum every component, with hours above 24
  allowed. A reset that cannot be read stays unknown (observed CLI logs, 2026-11-14).
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
- Commits and PRs carry `Demo-Video:`/`Demo-Page:` trailers and an `<!-- seismic:demo -->` marker.
- Installers have version-less names under `releases/latest/download/` and the updater reads
  `latest.json` there, so every release is "latest", and no other release (a pre-release, say) may
  become it.
- A tag makes a release only as `v<version of package.json>` with its section in `CHANGELOG.md`
  (`## <version> — <date>`); the section's first twelve lines (a paragraph or an entry counting as
  one) are what installed apps show of the update.

Platform quirks:

- Windows and Linux must work; macOS-only tools only as an extra. On Windows spawned programs run
  without a window, there is no SIGTERM, and every spawn blocks the server's thread.
- Windows has no process group: a tree is ended whole only by a job object its first process joins
  before it starts anything (a launcher that waits on stdin, then starts the program). The process
  table cannot do it: a helper whose parent has exited has no link left to follow, and a pid of an
  exited process may already be another's.
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
- The bundled plugin's namespace must be `seismic`, matching setup cards and worker briefs. Startup
  warns about a missing, damaged or differently named manifest without changing generated skill names.
- A macOS binary must be signed, ad hoc at least, or it is killed at start.
- Claude's SDK hands a queued message over only after the running tool call, so agents never wait
  in long foreground commands.
- Demo files are read at once, not streamed: streaming stalls whenever the event loop is busy (on
  Windows at about 1 MB/s).
- A sandboxed frame has a `null` origin and loads nothing beside it on static hosts: shared
  artifacts are self-contained.
- A repository's worktrees share its `.git`: two `git worktree add` at once fail on each other's
  half-written entry, two config writes on the config's lock. Those changes run one at a time per
  repository (`inTurn` in `src/server/workstations.ts`).

Safety rules:

- A finish-working-changes proposal keeps its complete binary patch separately from the editable
  task and supplies it to the worker across hosts: as a file in its workstation's git directory,
  written before the worker starts, never inline in a prompt (an agent's input is limited).
  Submodule changes prevent the proposal: a parent patch cannot carry a submodule's dirty files or
  commits that only exist locally.
  Changed files with a filter driver (Git LFS, say) prevent it too: staging stores the filter's
  output (an LFS pointer to an object only that checkout has), not the file. Git's own line-ending
  and encoding conversions do not: `git apply` reverses them.

- Every request is checked for `Host` and `Origin` (DNS rebinding, preflight-free POSTs); the owner
  holds a key, other devices are paired, workers get no key and reach only a narration server.
- A home copied from a running Seismic records that one's `tailscale serve` entry: a Seismic gives
  up only an entry that proxies to its own port or to one where nothing answers, never another
  Seismic's address.
- `remote: { via: "hosts", hosts: [...] }` is for an owner's own reverse proxy (say Caddy, with a
  wildcard certificate, in front of several local apps): Seismic neither starts nor removes any
  `tailscale serve` entry, answers the listed host names (its `Host` and `X-Forwarded-Host` check),
  and treats what the proxy forwards as remote, so those devices pair like any other. The proxy must
  pass `Host` through and set `X-Forwarded-For`, `-Host` and `-Proto`. Chosen over a `tailscale serve`
  entry on port 443 because that port is then free for the proxy (2026-11-20).
- A paired device's cookie is named for the scheme and port of the address it was set at
  (`seismic-device-https-8443.<tag>`, `seismic-device-http.<tag>` without a port): a browser keeps cookies per
  host, whatever the port and scheme, so two Seismics on one host, or the `http://` and `https://`
  addresses of one, would otherwise overwrite each other's pairing. The address's own cookies, once
  present, decide alone; the older names (`seismic-device-8443`, `seismic-device`, `obeya-device`)
  still let in a browser that lacks them, and are never renewed. Pairing again with an explicit
  code or link (even where the browser is paired) keeps the device entry and hands over a new
  credential. Every credential given is kept, hashed, in the order given (`device_tokens`): the
  browser presenting one retires those given before it, never one given after, so an answer still
  on its way keeps working whatever arrives first. A replacement is made from the credential the
  pairing brought (an HMAC with a nonce), so the same credential brought again, a retry or a
  request sent before an earlier replacement arrived, gets the same answer and keeps its device;
  a retired one lets nobody in. The tag comes from the credential's hash, including for first
  pairings. The answer unsets the cookies the request brought, so a late answer sets its cookie
  beside the newest. Where a browser opened two first pairings before receiving either answer,
  Seismic prefers the device enrolled last, even if the answers arrive in reverse order.
  Rejected: one cookie name with the old credential kept valid for a generation or two, which only
  moves that race a renewal on; keeping the credential on pairing again, which leaves a copied
  cookie working (2026-11-23).
- The desktop app's shell pairs over HTTP (`POST /api/pair` with `{ code }`, JSON only): the
  answer is a one-time link (`/pair?token=`, valid for a minute, held in memory) or why not
  (`wrongCode`, `codeExpired`). The code is spent for the link: "Connect a phone" then says the
  desktop app took it (no QR code, no code to type), as long as the link holds, past the code's own
  deadline too, and that the device connected once it did; the device is made when the window opens the link, so it gets the
  webview's cookie and name, not the shell's. The link is built only on a request address that is
  a plain `host[:port]` of Seismic's as a whole. Opened again within a day of its use, a used link leads
  on to the project only a browser holding the credential it gave or a later one, and gives the
  same replacement again to one still bringing the credential it was made from, until the
  replacement is presented or retired. An expired or unknown link says it did not pair, even to
  a browser paired before (2026-11-23).
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
- `agy --sandbox` does not end the commands an agent starts in the background: they outlive the turn
  and agy's own exit (measured 2026-11-14, macOS). Seismic therefore observes the descendants of each
  `agy` process like Codex's (every 500 ms) and ends them, or the sweep does after a crash. A command
  that detaches (reparented to init) between two observations is not attributable and stays running.
- `agy` turns a command that outlives its wait into a task of its own and holds the turn open until it
  ends (it wakes itself); its stream-json frames say nothing of it and the frames behind the step wait.
  Seismic captures a resumed conversation's transcript boundary before launching agy, including when
  no transcript exists yet. It reads the tasks from the conversation's transcript
  (`~/.gemini/antigravity-cli/brain/<id>/.system_generated/logs/transcript.jsonl`, grown live: a step
  "running as a background task with task id: X" in a MODEL/GENERIC/RUNNING step, a
  SYSTEM/SYSTEM_MESSAGE/DONE message `Task id "X" finished`, measured
  2026-11-14), shows them on the card, and, as for Codex, wakes the session when one ends between turns.
- `agy models` lists an id per model and effort (`gemini-4-argon-medium`, display name
  `Gemini 4 Argon (Medium)`), but `--model` takes the base id and `--effort` the effort; a full id with
  any other `--effort` is refused, as is an effort the model lacks or any effort for a model without
  them (the orchestrator) (agy 1.5.11, 2026-11-18). Seismic lists each base model once with the
  efforts it has, splitting a suffix only where the display name confirms it, and passes no
  `--effort` for a model without efforts. Saved IDs are kept until the catalog can confirm a legacy
  variant. A start loads the catalog on first use, including after a restart. An unset effort takes
  the account's default variant for its default model, or the first supported effort for another
  model. Rejected: full ids with the effort locked to the suffix (18 entries, a one-choice effort
  picker), and full ids without `--effort` (effort in the model name for Antigravity only).
- An agent session (Codex or agy) sends its first turn only once its own identity is durable in the
  session registry (a timed-out first snapshot is taken again), and an observation that fails for good
  after that (not a timed-out snapshot) ends the session and keeps its record for the next start's
  sweep: what was seen may not be all it started. Such a record blocks new sessions in its directory
  only while something it names still runs: a start there that can take its lease and finds none of
  its processes running clears it, ending nothing (2026-11-22). Waiting for the next start's sweep
  left one failed model listing (Codex's in the home directory, which every listing shares) refusing
  every later listing until Seismic restarted.
  A process observed later that cannot be written to the record ends the session too. A session's
  end does not wait for its pipes to close beyond 2 s after its process exited: a command it left
  (never observed) can hold them for as long as it runs.

- The harness picker takes the last readiness check (`HarnessCheck.known`) once one is available.
  The same rule is planned for the Codex and Antigravity model pickers: `ModelCatalog` will serve
  the last listing and refresh it in the background after 5 minutes, when Seismic starts, and
  when a harness is connected. These checks take seconds and vary widely (`agy models` 0.2–21 s, a Codex listing
  0.15–12 s, 2026-11-22). Rejected: a fresh run per picker, which left the Harness select empty and
  the model list loading for as long as the slowest CLI took.
- Harness readiness is machine discovery. The owner’s confirmed harnesses are stored separately in the machine’s settings and
  control new agent choices and usage polling. Before the first saved list, existing agent defaults and project overrides provide
  the compatibility list because earlier onboarding did not record its selection. A disconnected default falls back to a connected
  harness and a disconnected project override follows the machine setting. Existing sessions keep their harness (2026-11-19).
- The first-project request of the setup assistant carries the complete list of harnesses the owner selected and set up.
  A previously saved role default carries over only if its harness is selected. Remaining roles default to Claude Code if selected,
  then Codex, then Antigravity. The repository check uses the same choices as the project will. The list and defaults are written
  before the project is saved and restored if the save writes nothing (decided 2026-11-15, clarified 2026-11-20).

- Codex and Antigravity workers and code reviews need a local Git checkout. Where a project's workers run in one of them (Configuration's
  harness, the project's own over it, or the one the first project is about to get), a folder without git is not offered:
  the setup assistant and "+ Repository" show only setting up git, with a note why, and the configuration's check refuses
  such a folder (`folderHarness`). A setup card names the harnesses that are installed and signed in on the machine
  (Claude Code, Codex, Antigravity, each checked as the setup assistant does), not Claude Code by default. Those logins are
  checked in the background (`HarnessCheck`: from the server's start, by each setup assistant check, and again once a minute
  old), never while a card starts: a CLI that hangs would otherwise hold up the whole server. Of overlapping checks, the
  one that began last stands, by the order they began in rather than by clock time, which ties (decided 2026-11-15);
  per harness, since the setup assistant checks one at a time (2026-11-18).

## Chapters

- [UI system](design/ui-system.md): how the UI is built (shadcn/ui parts and proven libraries
  first, React components, frost's own CSS only where its look needs it) and the rules every screen
  follows.
- [Code organization](design/code-organization.md): how the server code is laid out (layers, and
  `src/server/llms/` for built-in skills and their prompts) and the file header practice.
