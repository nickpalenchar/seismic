## Data

A chapter of the [design doc](../design.md), whose header says how it is written.

Everything that has to survive a restart of Seismic lives in one SQLite database; what git, GitHub
and the repositories already know is read from them, not stored.

Persistent (SQLite):

- projects, their per-project settings (home repository, whether the owner paused its agents, the card collecting each repository's
  CLAUDE.md rules, the retrospective's and the work retrospective's counts and when they last ran);
  each project's canvases (name, unique in the project in any case; icon; place in the owner's order;
  always one named `main`, which the migration that brought canvases gave every project with all its
  cards and groups) and the canvas each card and group is on (a workstream's is its plan's); groups
  and each card's group; owner-drawn dependencies between cards (the project setting `manual_dependencies`
  is a JSON list of `[from, to]` pairs, optionally followed by `{fromSide, toSide, offset}` for the
  chosen edges and the target's position along its edge; older pairs use automatic routing);
- cards with everything shown on them or needed to resume them: kind, state, position, parent, the
  card they came from; the agent session with its pinned harness, model and effort (old unqualified
  sessions belong to Claude; Codex locators start `codex:`), workstation, branch and status line; the open question or
  handover (with the reason when there is no demo); queue, scope, the card's hold (below); the pull request and what of it was already passed on to the worker; on a review card, the
  contributor's pull request (author, whether maintainers may push, the head handed over, the
  checks and merge probe, the findings with what came of each, the change request waiting for the
  contributor); the code review of a card's work (the mode it was handed over under, the handover
  it is for, and the latest review: the handover and commit it reviewed, running (with its agent's
  session, which a restart resumes), done or failed with why, its findings with what came of each); an approval held until the work can land; landed work whose worker still finishes;
  a waiting card's stopped app; the clone that keeps a card's branch since its workstation was taken
  from it;
  proposals waiting for the owner; a merge draft on an unworked proposal or planned task (partner,
  original place, combined text or exact coverage parts, optional follow-up with its screenshots and
  question references, and the texts and handover compared so stale approval can be refused); the new repository a card is to be built in, and that Seismic made
  it; an idea's brief, open questions and picks; a prototype's idea
  and outcome; a plan's plan doc as last read and the plan docs its landed work added; the priority the owner
  gave it (`priority`: `trivial`, `low`, `medium`, `high`, `veryHigh` or `critical`, null for none); its short
  code for addresses (see Addresses in The canvas), unique across the database;
- each session that worked on a card, with the harness, resolved model and effort it ran on (see
  Models and effort in Agents and workstations), and the owner's responses on approved work: the
  handover each is about, whom it credits, the card's context as it was, the answer and facets;
- why a card's agent does not run now, or why the card is off the canvas: one hold per card, JSON
  with its `reason` and `since`, as the owner's pause at a safe point (`pausing`), the owner's
  pause (`paused`), the usage limit's pause after three refusals (`limit`: the refusal count, the
  known reset as `until` if any, the status line before), a snooze (`snoozed`: until when, the card
  it waits on, by whom, why, and whether it waited for the owner or is to start then) or the
  parking lot (`parkingLot`). What Seismic had for a held worker meanwhile is kept with the hold
  (`held`): always on a pause, on a snooze only where the owner snoozed a worker. These never hold
  together: setting one replaces the one before, a snooze keeping what a pause held. The Koordinator's
  queue and a waiting card's stopped app are kept apart, as they hold beside any of them;
- card events (the conversation log, with the owner's screenshots and agents' mocks, and the
  producing agent's harness and model when known); the Koordinator's replies and looked-up answers
  each retain their own producing identity, never inferred for old messages; workstations
  and their leases, what a card changed in a folder without git and its undo there;
- the activity log: one typed line per event (when, who: the owner, a card's agent or Seismic; a
  fixed code such as created, proposed, archived, deleted, stopped, reviewSent, approved, started,
  landed, waitsForCard, waitsForWorkstation or usageLimit; the card, a second card it waits for, the
  harness a usage limit stopped, the title a deleted card had at its deletion), written where the event happens (an approval once it holds: one
  turned away, or a landing that hands the card back for a new approval, writes none) and worded in the UI, so it
  follows the interface language. The free-text state lines in a card's conversation are not
  parsed for it, so nothing before the log is reconstructed; a wait read again is not written twice,
  but a usage limit that cleared and comes again is a stop of its own;
- the Koordinator's conversation with the owner, split into chats (each exchange in one; the
  chat opened last per project is where new words go), and the threads of looked-up questions (the
  question, its answer and files, the card it moved onto, the step to take once the answer is in),
  and the cards that left the project for another;
- confirmed commands waiting out their undo window;
- shared demo pages (slug, link, what the page shows, the change it was published after, whether it
  is publishing or withdrawing) and a running re-share of outdated pages;
- paired devices (a hash of the cookie, never the cookie itself; name; push subscription);
- the decision log, preferences, the friction noted on each card's runs and the settings changes
  the work retrospective proposed from it.

Files under `~/.obeya/` (the same for the app and a checkout): the database (`obeya.db`), the
owner's screenshots (`images/<project>/`), other files the owner dropped into a field
(`files/<project>/<uuid>/<name>`), the configuration (`projects.json`), the settings
(`settings.json`, `demo.json`, `voice.json`), where the running Seismic answers (`server.json`), the
`tailscale serve` entry Seismic made (`tailscale-serve.json`), the key it signs pushes with
(`vapid.json`), the app's server log (`app.log`), the stalls of the server and its pages (`stalls.log`, see Running Seismic), voices and models (`voices/`), the workers'
clones and worktrees (`workspaces/`, the name it had before workstations were called so), the read checkout's worktrees (`read/`), the cards' undo in
folders without git (`undo/`), the files of looked-up answers (`answers/<project>/<thread>/`), the
static sites Seismic keeps (`sites/<key>/`), the env files their repositories' settings name
(relative to the home, `sites/demos/deploy.env`, say), and `share/`, the directory deploys run in.

Migrations: the schema version is tracked in the database; each step runs in its own transaction, so
a failure leaves the database at the previous version, and an older Seismic refuses a newer
database. Whenever a step is pending on an existing database, Seismic first writes a consistent copy
(`VACUUM INTO`) beside it as `obeya.db.before-<version>`, the version being migrated to, and keeps
the newest three. A fresh database and one already up to date are not copied. To roll back, stop
Seismic and put the copy in place of `obeya.db`.

Derived, not stored: git, PR and CI state (read from git and GitHub), plan-doc content (read from
the repository; the copy on the plan is only for the archive).

Decisions:

- One hold per card in place of separate pause, pause-at-safe-point, snooze and parking-lot columns
  (2026-11-08): checked against the code and the live database, none of them holds together with
  another, and two flags that could disagree (a paused card also snoozed) made every reader decide
  which one wins. The pause for a due restart is not stored (it lasts only while Seismic waits to
  restart) and shows as a hold of its own (`restart`) to the UI and agents. The migration counts a
  pause or snooze from the moment it ran, as neither kept a time of its own.
