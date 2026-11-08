## Agents and workstations

A chapter of the [design doc](../design.md), whose header says how it is written.

### Plan git baselines

With the project setting `planBaselines` on (the default; the old key `projectBaselines` is still read), the first workstream started in a
plan creates a local lightweight git tag `obeya/project/<plan-id>/baseline` at the default
branch's commit from which work starts. Every workstream branch in that plan gets the same tag
in its repository and the local git config `branch.<branch>.obeya-project-baseline` names it.
The card's conversation records the tag and commit after its workstation is prepared. A later
workstream still starts from the current default branch; the tag remains the plan's original
reference, through landings, restarts and plan or plan-doc renames. Clones, including those on
other hosts, receive the same tag and branch configuration. Tags are local; Seismic does not push
them to the forge. A conflicting tag in a clone fails workstation preparation rather than moving it.

The project's configuration and Project defaults offer "Create plan tags"; new projects copy
the default, while existing projects keep their own setting. Turning it off stops creating tags and
configuring branches on subsequent starts; existing tags and branch links stay. Turning it back on
reuses a plan's tag, or captures the current starting point if it has none. Manual tasks and
folders without git have no plan baseline. Tagging an already active plan captures its next
workstream's starting point; it cannot reconstruct the plan's earlier start.

### Agents

By default, agents are Claude through the Agent SDK on the machine's Claude Code login (the owner's
subscription, no API key). The checkout runs the Claude Code binary the SDK brings; the compiled app
runs the machine's own (`claude` on the `PATH`, else `~/.local/bin`, or `SEISMIC_CLAUDE`). Agents get
Seismic's environment without the marks of a Claude Code session that may have started Seismic
(`CLAUDE_CODE_*`, `CLAUDECODE`, `CLAUDE_PID`) or of what started it (`SEISMIC_SUPERVISED`, `SEISMIC_FROM_APP`,
`BUN_BE_BUN`), but with `CLAUDE_CODE_OAUTH_TOKEN`, the login of a machine without a keychain. On
such a machine `claude-token` in Seismic's home, once there, takes the variable's place: it holds the
newest token the owner gave Seismic, which the variable Seismic was started with may not.

A Claude worker is one session per card with streaming input, permission mode `auto`, and the repository's
Claude Code settings and CLAUDE.md (only once the owner trusted them, see Trusting a repository's
commands); after a restart it resumes by session id. A plan agent is one session per plan in
the read checkout, resumed for each of the owner's questions about the plan, one at a time. Plan agents, ideas'
exploration agents and the Koordinator's look-ups have a worker's tools and mode (see Looked-up
questions); agents that only judge from text (reading commands, estimates, the learner) are
read-only: Read, Grep, Glob, mode `dontAsk`.

Claude sessions refuse long foreground sleeps in Bash (see Waiting without blocking). What changed
since a session's instructions were built reaches the agent once, with its next tool call's result
(not a subagent's), without a message or turn: a preference of the owner learned meanwhile; for a
workstream's worker also its plan's new decisions and the owner's notes that came during its turn
(see Reading order). A call the settings want confirmed becomes the question the card waits on (see
Refused and confirmed tool calls); Seismic's own tools are allowed by a `PreToolUse` hook.

When another card's work lands over files a worker changed, it hears the commits and overlapping
files with its next turn, so it can decide whether to rebase before handover (see Overlapping work
after a landing). This news waits for a turn rather than entering a tool result or waking the
worker by itself.

#### Native Codex workers (preview)

Task workers can instead use the installed Codex CLI's app-server, with its own login. Seismic finds
`codex` on the server process's PATH, or the native executable named by `SEISMIC_CODEX`; a repository
or per-session environment cannot select a different executable. Only local Git workstations are
supported: no SSH, folders without Git, contributor reviews, or record/replay. The repository's own
Codex configuration (its `.codex/`: settings, hooks, MCP servers, rules, which run outside Codex's
sandbox and approvals) is loaded only where the workstation's `.codex/` is, to the byte, what the owner
last trusted for the repository (the `codex` group, see Trusting a repository's commands), checked
at every start and resume; otherwise, and with a symbolic link in it (Codex would read a file the
owner never saw), the session loads none of it and works without. Seismic tells Codex so per session,
over whatever the user's Codex configuration says of the project (`-c projects={"<path>"={trust_level=…}}`
for the checkout and, from a linked worktree, the main checkout, which is how Codex keys it), and
before any thread runs checks Codex's own account of the layers it reads (`config/read`): a project
layer it should not load ends the start. Codex reads no project layer above the checkout's top level
(Codex CLI 0.162.0). Codex's sandbox keeps a worker from writing `.codex/` itself; a change there
reaches the workstation through the owner (a granted command, a rebase) and counts once trusted.
What Seismic compares and what Codex then reads are two reads: a process outside the sandbox that
swaps a file between them is not caught. Instructions (`AGENTS.md`) and repository skills are not
configuration and are not held, as a repository's CLAUDE.md is not.
Decided 2026-11-02: stricter than for Claude, whose workstation changes count while the main branch's
are trusted, since Codex's configuration runs outside the sandbox Seismic relies on; rejected:
refusing any `.codex/` (it stopped Codex workers in every repository with one, Seismic's own
included). The user's global Codex configuration is trusted.
A repository's Claude Code configuration (`.claude/`, `.mcp.json`) waiting for the owner's trust
does not stop a Codex worker, which reads none of it: the worker starts as it would, only without
the allow-list shortcut below (no command runs unasked on that list until the owner has trusted the
configuration). Decided 2026-11-02; rejected: refusing it, as before, which stopped Codex workers in
every repository with a change to `.claude/` not trusted yet, for no protection. A review card, whose
workstation holds a stranger's code, stays refused for Codex.
Other roles, setup and the usage meter remain Claude-based. A Codex worker's runs feed the
work retrospective like a Claude worker's (its rollout is read, see `the-koordinator.md`). An
unsupported capability fails visibly, never by substituting Claude.

Codex keeps its native workspace-write sandbox (its workstation and the temporary directories, plus the
demos directory where it makes the demos it hands over; `SEISMIC_CODEX_SANDBOX=danger-full-access` (or the
older name `OBEYA_CODEX_SANDBOX`) in
Seismic's environment lifts the sandbox for every Codex worker, a stopgap, with Codex asking only for
what it holds dangerous) and on-request approvals, not Claude's pre-command hooks. Who decides an
approval is Codex's automatic review (`auto_review`: a reviewing subagent of Codex judges each
escalation by its risk), Codex's counterpart of Claude's `auto` mode and the preset, or the owner;
the Configuration's Agents section has a switch for it while task workers run in Codex (`settings.json`
`codexAutoReview: false` asks the owner), read when a worker starts. With the review, no permission
question reaches the card: a request it refuses shows in the conversation as auto mode's refusals do,
with its rationale, and `seismic_run` runs only what the allow list covers, telling the worker to run
anything else in its own shell with escalated permissions, where the review judges it. Decided
2026-11-06 (owner: Codex cards should stop asking, as Claude's do); rejected: lifting the sandbox
(`SEISMIC_CODEX_SANDBOX`, which still asks for what Codex holds dangerous) and approving everything
(no judgement at all). Without the review, approvals use the same owner question as Claude (see
Refused and confirmed tool calls); extended permission profiles are refused. A command that a `Bash` rule of
the repository's `.claude/settings.json` allow list covers, as the owner last confirmed it, is not
asked: Claude Code applies that list itself, Seismic applies it to Codex. A command counts when it is
plain: one or more programs joined by `&&`, `;` or new lines, each covered by a rule, alone or in
the shell Codex wraps it in; leading `NAME=value` assignments (not `PATH`, `GIT_*` and the like) and
output redirected to a file under a temporary directory or `2>&1` are looked through, and so is
setting the shell up in front of covered commands without a rule of its own: `source` (or `.`) of
an existing file, symlinks resolved, outside every place the worker writes (its workstation, the
demos directory, the temporary directories), and `nvm use` with at most a version, `--lts` and
`--silent`, neither with a variable set in front (`NVM_DIR=…` would choose what it loads). A leading `~/` in a command or a rule is the home directory. Pipes, `||`,
substitution, heredocs, other redirection, other `~` and `..` in a path never ride on a rule. Decided
2026-11-02 (owner): workers set up Node with `source ~/.nvm/nvm.sh && nvm use 24 && …` before
nearly every command, and a file the worker cannot change runs what the owner put there, not what
the agent wrote; such a file that `seismic_run` changed on the owner's question is the one way around
it. Both: the rules for those who want only their own files, the look-through for everyone else.
Such a command
also gets network without a question, whether Codex asks for it with the command or for a host of
its managed network; Seismic accepts only that one command's access, never one for the session, a
host for good or an amended rule. A path grant or permissions beyond network are always asked, and
so is network for a command the list does not cover. Decided 2026-11-02, the same as `seismic_run`
gives a covered command: an owner who listed `pnpm install` meant it to install, and the question
said no more than the rule did; rejected: asking for every network grant, as before. The same list also gives `.codex/rules/obeya.rules` for
Codex's own rule engine (`scripts/codex-rules.ts` here, the settings skill in other repositories,
see Writing the settings), for the rules that are literal word prefixes, loaded once the owner
trusts the repository's `.codex/`.

What the sandbox keeps from a Codex worker (network, a browser, a local server, git writes in its
worktree, whose `.git` lies in the main repository, the demos) goes through two tools Seismic runs
itself with the owner's rights, for workers on this machine that are not review cards:
`seismic_run` (a shell line; covered by the allow list it runs at once, else the owner is asked as for
any permission; runs in the workstation, a temporary directory or the demos directory, symlinks and
`..` resolved; no stdin, a timeout of 300 s by default and 1800 s at most that ends everything the
command started, output cut to its start and end) and `seismic_git` (add, commit, rebase, merge, reset
and the other worktree commands, never push, remote, config or options that run a program or move the
work tree; no question). The gate and the places are the protection, not a sandbox. A call of several
minutes returns intact (checked with a 200 s command). The worker's prompt says which tools do what
its own shell cannot.
Seismic's tools and their card scope are shared. A session started before the rename to Seismic
and resumed since still reaches the tools by their old names: a Codex thread keeps the tool
definitions it started with (`obeya_report`, `obeya_to_obeya`, and `obeya_obeya_run`,
`obeya_obeya_git` for the execution tools), and a resumed Claude session, whose history calls
`mcp__obeya__…`, gets the tools under those names beside today's. Bundled skills are supplied as readable skill files, not Claude plugins.
Context changes reach Codex in Seismic tool results or by steering; a Codex worker has no
foreground-wait guard, because it needs none. Steering reaches Codex while a foreground command is
still running (checked with a 120 s `sleep` and a note sent after 15 s: the agent answered four
seconds later, and the command carried on as a background terminal Seismic tracks like any other),
so a long foreground wait never keeps an owner's note from the agent, which is all Claude's guard
protects. A native pre-command hook would not be a substitute: Codex runs a hook only once its
hash is trusted in the user's own `config.toml` (`hooks.state`); a hook passed per session
(`-c`, `thread/start` config) stays untrusted and never runs, and Seismic does not write the user's
Codex configuration. Background
terminals keep the worker active. Each completed background task wakes result inspection even
while another terminal keeps serving the app; unchanged status polls do not extend the worker's
background timeout. Closing a session cleans its terminals before the server exits. Since native
PTYs can leave the app-server's process group, Seismic also tracks observed descendants by process
identity and terminates them on app-server exit, including an unexpected exit. Its process
snapshots (every half second while a session runs) never hold the server's event loop: on a busy
machine `ps` can take seconds, during which a blocking call would serve no pages and hear no agents
(seen 2026-11, up to 1.8 s). All sessions observe on one shared tick and share one snapshot per
tick rather than taking one each (decided 2026-11-05: with several Codex sessions, one `ps` each
multiplied the load that made `ps` slow); a caller that asks while a snapshot runs waits for the
next, never reuses one older than its request. Snapshots and the kills that follow them run one
after the other, so a kill acts on everything an earlier snapshot registered. A snapshot that times
out skips that observation, including the first one that establishes the session's ownership; only
snapshots that keep timing out for half a minute end the session (decided 2026-11-05: one slow `ps`
on a busy machine used to end a working session). Any other failure to inspect still ends it at
once. Only the sweep at start, before the server
serves anyone, takes its snapshot blocking. On Linux it reads
process identities and their creation ticks from `/proc`, without depending on `ps`; it skips
unreadable unrelated processes but fails if it cannot inspect one it already owns. This is cleanup,
not an OS containment boundary: a process that detaches and loses its ancestry between observations
may escape tracking. On Windows, a cold PowerShell/CIM process snapshot gets a longer startup
allowance; a later snapshot that times out gets one longer retry. Ownership must still be established
before the session proceeds. Windows and Linux native-PTY failure cleanup remain preview acceptance gates.
What this tracking ends, and what outlives it, is set out in Lifetimes below.

#### Antigravity workers (preview)

Task workers and code reviews can also run in Google's Antigravity (its command line tool `agy`), the successor of the
Gemini CLI for personal Google accounts, as a third harness beside Claude Code and Codex. It signs in
with the owner's personal Google account, which only the owner can do (running `agy` once); a start
without a sign-in fails visibly with that instruction. Routing, pinning, refusal of cross-harness
resume and the cases it does not support (SSH hosts, folders without git, record/replay, contribution
reviews) are those of Codex, and none falls back to Claude Code. Its sessions are `agy:<conversation
id>`; a restart resumes the same conversation (`--conversation`).

One headless `agy` process per session speaks stream-json both ways: a `user` frame per turn in, step
updates out, exactly one `result` per turn. A message sent during a turn waits for it and starts the
next one (idle with `more`). `agy` has no flag for system instructions, so they go in front of the
session's first message of every process (also after a resume); images go in as file paths in the
text. Bundled skills are supplied as readable files, as for Codex.

Auto mode: no permission question ever reaches the card. A worker runs with
`--dangerously-skip-permissions` inside `agy`'s own OS sandbox (`--sandbox`: seatbelt, nsjail,
AppContainer); skipping permissions also switches off `agy`'s hooks, so there are no hook-based
guards, the sandbox is the protection. What the sandbox keeps from it (network, git writes in the
worktree, the demos) goes through `seismic_run` and `seismic_git` like Codex's, with the same gate. A
code review does not skip permissions (skipping would skip deny rules too) and gets only rules for
Seismic's tools, reads and a few commands that only look; writing is denied, and a denied action ends
the headless turn (checked against agy 1.5.2).

`agy` can only reach tools through an MCP server it connects to, so Seismic runs one localhost HTTP
endpoint (Streamable HTTP with JSON replies, a port of its own) for all `agy` sessions. A session
registers its tools under a token of its own and hands `agy` the endpoint through the workstation's
`.agents/mcp_config.json` (a bearer header), never through the owner's global configuration. The file
is kept out of git by the repository's `info/exclude`, removed when the session ends, and a
workstation's own file of that name stops the start rather than being overwritten. Tool names carry the
`seismic_` prefix; each result carries the context updates as for Codex.

Models come from `agy models`; efforts are low to max. A usage-limit failure of a turn is recognised
from its error text (best effort; Google does not document it) and waits like the others. Crash
recovery, process cleanup and transcript reading at the level Codex has are not built yet: the work
retrospective skips `agy` sessions. Decided 2026-11-06: Antigravity over the retired Gemini CLI; shown as "Antigravity" in the UI (owner, 2026-11-06);
full auto inside the OS sandbox, rejected: permission questions on the card (the owner wants none)
and a Seismic-side allow list (the sandbox is the boundary).

### Models and effort

Every agent belongs to one of five groups: the Koordinator (voice commands, estimates and schedules,
look-ups, plan agents, learner, retrospective, proposal rewrites), workers, ideas' exploration agents,
small jobs (the work retrospective's notes and proposals, a shared demo page's text, a card's
title and its suggested labels), and code reviews (see Code reviews in Card lifecycle). The Configuration dialog sets each group's model (Claude Code's default or an alias: Fable,
Opus, Sonnet, Haiku) and effort (low to max) and marks the presets: Opus throughout, high effort for
workers, exploration agents and code reviews, medium otherwise. Stored in `settings.json` under `agents`, only
where it differs from the preset. A project may set a harness, model or effort of its own for any group (its
settings sheet, see The project settings in The project), saved with the project in the configuration
(`agents`, by group, with `harness`, Claude `model` and `effort`, and separate `codex` and `agy`
model and effort choices); what it leaves open follows the Configuration's. Earlier project settings
with a Claude model but no harness still select Claude Code even where Configuration selects another
harness. An effort alone keeps the configured harness with that effort. Saving restarts nothing; agents starting afterwards take it, a
running session keeps its own, except the voice commands' session, which reopens when the
Koordinator's setting changes (as for another language).

Each group's row puts harness before model and effort. Harness selection is enabled only for task
workers and code reviews (Claude Code, Codex or Antigravity); the other groups show Claude Code disabled, while their model and
effort remain editable. A code review in Codex runs in Codex's read-only sandbox and asks nobody,
whatever `SEISMIC_CODEX_SANDBOX` lifts for workers; in Claude Code it is read-only as the other judging
agents are (Read, Grep, Glob). Code reviews run where workers do, and also on an Seismic whose workers
are idle (a scratch Seismic), on the agents' runtime there. Claude choices remain saved when Codex or Antigravity is selected and vice versa. Codex models and supported effort levels come from the
installed CLI's account catalog; loading failures can be retried, and an unavailable saved model
is shown, not replaced. An account-default choice is resolved to an actual model at first start.
The card persists its harness, model and effort before starting and retains them across parking,
restart, replies and changes to defaults. A deliberate fresh start takes the current selection.
On an individual planned task, a stopped one that starts again, or an immediately accepted task
proposal (on the phone too), the chevron beside the start button shows the worker default and lets
the owner choose a harness, model and effort for that start alone. The choice is kept on that card
(also after closing it or reloading the page) and shown in the button's small text; the main button
starts with it, or with the configured default while none is chosen. Only a choice the menu would
accept is kept, and a start re-checks a Codex or Antigravity choice (exact model and effort)
against the harness's current models at the click, from the main button and from the menu's
"Start with" alike; one the harness no longer offers stays shown and kept, the button
refuses it, and the owner changes it in the menu. Catalog errors remain retryable rather than
marking the choice unavailable; a successful menu reload refreshes its availability. A saved
harness that the card no longer supports stays visible and blocks starting until the owner
chooses an available harness; it never falls back to the configured default. The review
picker stays accessible even when its saved choice is unavailable. While a start checks the
catalog, its choice is locked and repeated clicks cannot start another worker; an accepted start
clears it, a failed one keeps it. The menu is reachable by keyboard (focus moves into it, Esc closes it and
returns to the chevron without closing the card). The choice is stored on the card when it is
requested, kept while the task is scheduled or waits for a workstation, taken back with the queue
entry, recorded in the card's conversation at the start, and does not alter the configuration; from
the start on, the pinning above holds it. Unavailable choices (Codex where it does not apply) and
catalog or default-loading errors are visible, with a retry; a selected unavailable model is not
silently replaced. A start that is not an immediate one of a single task (a plan's workstreams,
one set to start later, one in a new repository) takes no choice.
Unqualified old session ids mean Claude; Codex locators carry `codex:`, Antigravity's `agy:`, and none resumes in another harness. A locator alone is not authorization to attach it to another card.

Each session that works on a card is recorded with what it actually ran on: harness, the model it
resolved to (the model the session names, not the alias it was asked for), effort, and the alias or
choice it started with, from the time it is first heard. Heard again (a resume), it keeps what it
had and only learns the model it resolved to, if that was unknown. What is not known stays unknown (`null`), never taken from
today's defaults: a model a Claude session never named, the effort of a legacy session resumed on
defaults. The owner's response on a card's work (`/api/c/<project>/cards/<id>/feedback`; when Seismic
asks for one: see Feedback after approval in Card lifecycle) is taken only on approved work, is
about one handover and credits
the configurations of the sessions that ran on the card up to that handover, as they were then: one
configuration (`single`, credited even with unknown fields), several (`mixed`: none is credited on
its own), or nothing known (`missing`). Two configurations that differ in any field, an unknown
one included, count as two. The response keeps its card (by id, wherever the card goes), the
card's title, repository and plan as they were, an answer (a rating, a comment, or both) and
optional named facets for later dimensions such as the task's complexity or type. Given again for
the same handover, it replaces the answer and keeps whom it credits. Cards from before sessions were
recorded get their last session as its pinned setting has it, from their last start, with the model only where their
worker's messages name one, and a run of unknown effort for each other identity those messages
carry; where they carry two, neither is taken for the pinned session.

### Workstations

A card works in a worktree of its own, unless the repository's settings say clones or its
configuration names some (`clones`, `workstations` or `hosts`). Worktrees: any number in parallel
unless the repository has `slots`. Clones (for tools that break in a worktree, or an app stack per
clone): a pool, each clone leased by one card. `clones` is how many Seismic makes in its own directory
(`workspaces/<canvas>/<repo>/1..n`), on top of the existing ones `workstations` lists (on the command
line `--clones <n>`, `--workstation <path>`); the Configuration dialog shows the sum. Where work lands
on the local main, the checkout itself is never one of them, even where `workstations` lists it: work
lands there, the read checkout is read there, and a card's branch checked out in it stopped every
landing (2026-10-30, a tester's report). The dialog does not count it and says why; listed alone,
the cards work in worktrees, as without the list. A card keeps its
workstation across stop and restart until its work has landed and its worker finished what remains.

Starting a card does not block the server: the workstation is taken at once (so slots and the queue
see it taken), and git makes it ready in the background: `git worktree add` (a minute in a large
repository on Windows), or a clone's fetch and checkout of the card's branch (over SSH on a host),
the temporary worktree of a finished card's question likewise. Meanwhile the card is at work, its
status line "Preparing the workstation …"; it holds a slot, a restart waits for it, and the
owner's words wait unread until the worker starts with its task. A card stopped meanwhile gives
the workstation back once git is done. Where git fails, the workstation goes back, the card returns to
where it was (planned, its snooze gone, the words kept for its next start) and its conversation
says why; a clone git failed on is passed over for a while, like a dirty one, so a fetch that keeps
failing does not take it again and again.

Choosing a clone does not block the server either: `git status` in each free clone takes a while in
a large repository, and over SSH on a host. Seismic chooses by its last look at each free clone (clean,
uncommitted changes, or not there, its host unreachable), which git takes in the background: when a
clone is given back, and again when a look is older than a minute (half a minute where it found the
clone not clean, so a waiting card takes a clone within a minute of it being put right) as Seismic
looks for a free clone (at every change of the board while cards wait for one, and every minute). A clean clone goes first, then one not
looked at yet; a look that changes the answer changes the board, so a waiting card takes a clone
turned clean. The clone a card takes is looked at again before it works there: one no longer clean
is given back and the next one taken, and where none is left the card goes back to planned and waits
in the queue as when none is free at once. What else Seismic asks git about a card's workstation runs in
the background as well: whether it holds work (uncommitted changes, commits beyond the main branch),
where its branch left the main branch, and the plan docs its branch adds. A stopped card is planned
at once and gives its workstation back once git has said that it holds nothing (not if it started
again meanwhile); an approval ends the owner's turn at once, the card landing (`approved_at`), and
lands the work, opens the pull request or closes the card once git has told which; a handover is
recorded once git has told whether it changes anything.

The pool is what the configuration names. A clone no longer named leaves it: a free one at once, a
leased one when its card gives it back (no card moves mid-work). A clone Seismic made is then deleted
from disk, after `app.stop` ran in it, if nothing would be lost: no uncommitted or untracked files
(ignored ones aside), no stash, no submodules, no worktree from it in use, and no branch, tag or
detached HEAD with commits on no branch of `origin` (fetched with pruning) unless each file they
change is as on `origin`'s main branch, so a branch squashed or rebased in its pull request counts as
landed (where work lands on the local main, `origin` is the Seismic checkout). The folder is moved
aside first, so a clone named again meanwhile (here or by another project) is never removed under a
card. Otherwise it stays: the log says once what lies in it, the pool's list shows "stays: unlanded work in <path>", and a later start looks again; raising the number takes it back as it
is. Clones the owner listed, and folders on a host no longer configured, are never touched. A
workstation on this machine whose folder is gone (moved or deleted by hand) and that the configuration
no longer names leaves at once, clone or worktree, held or not: its card names no workstation any
more, one at work is planned again, its log says so, and its next start takes another. Only a
card's own worktree, where the repository makes them, stays the card's.

A card gives its workstation back once it will not work there again, checked at every board change and
at start: deleted; a workstream no worker is on once the plan doc on the default branch ticks it off
or no longer has it; or a lease that outlived its card's work (finished and its worker done, or the
card names another workstation). A clone keeps the card's branch and the rest and is free for others
once clean; a worktree goes once nothing in it is uncommitted, its branch kept. A deleted card
brought back with the undo takes its clone back if still free, else another at its next start.

#### Taking a card's workstation

While every clone of a repository is taken (or blocked) and a card waits for one (or a finished
card's question for a clone), the pool's list has a faint "⋯" beside each card that holds a clone
and is at work, waits for the owner, or was stopped with work in it (not a card whose work landed,
nor a prototype). It opens "Give to the waiting card" with a sentence on what that does. A click
there gives that clone to the card waiting longest: after eight seconds in which "Undo" (in
the confirmation, and in the row, which says "giving it up") takes it back, the card's worker stops
as with "Stop", the app in the clone stops (`app.stop`, whatever `app.keep` says, since another
card works there next), and what is uncommitted there (untracked files too, ignored ones aside)
goes into a commit of Seismic's on the branch, marked by the trailer `Obeya-Kept: uncommitted work`.
The clone is then free and clean; the card is planned without a workstation and remembers the clone
that keeps its branch. A card whose worker was on it waits in the queue for a workstation, behind the
cards that waited already, and starts again once one is free; a card stopped before stays planned.
Its next start takes that clone if it is free, else another on the same machine (git takes the
branch from one clone to another only there, so the card waits for one of that machine's): the
clone fetches the branch from the one that kept it, which then drops its copy, and the commit of
Seismic's is taken apart again, its work uncommitted as before. The worker is a new session, as with
"Start again", told that the branch holds earlier work, perhaps uncommitted. The undo window is not
kept across a restart of Seismic: the card then keeps its workstation. Repositories in worktrees have
no such button: a worktree is the card's own, and a card waiting for a slot gets one when a busy
worker is paused or stopped.

Giving a workstation back does not block the server either: in a large repository (a checkout of
thousands of files) or over SSH, git takes a while to look into a worktree and remove it, to remove
a landed card's worktree and branch, to put a discarded prototype's clone back on the main branch
(its changes and branch thrown away), or to rename the branch of a prototype an idea is built on.
Git does all of it in the background, one step after the other on the same workstation, and the
workstation stays taken until git is done with it: no other card takes a clone half cleaned, and a
card's worktree made again meanwhile is added once the old one is gone. The card itself moves at
once (a discarded prototype into the archive, a deleted card off the project), and the pool shows the
workstation free once git is through; a restart waits for git as for a landing. Landing finds the
main branch the same way, without blocking.

#### Slots

Workers in clones are capped by slots, not clones: a slot is room for one busy worker (in a turn or
waiting for background work), counted per machine and repository (`slots` here, per host for the
others; as many as clones when left out). A new card takes a clean free clone on the first machine
(this one, then the hosts in order) with a slot left; with none, it waits ("Waiting for a free slot")
until a turn ends somewhere. A card holds its clone until its work lands, a slot only while its
worker is at work. A message to a waiting card is never held back for a slot, so a machine may go
over its slots for a while. A repository in worktrees can have slots too (in the Configuration
dialog under its row), which cap its busy workers the same way; left out, there is no cap.

#### A finished card's question

The owner's question to a finished card waits for neither slot nor clone. It takes a clean free
clone if there is one, else a temporary worktree (hooks off) detached at the head of the card's
branch, from the clone here that holds the branch or else the configured checkout (at `origin`'s
copy of the branch, else the default branch), under
`follow-up/<card>` in the repository's workstations directory, removed when the follow-up ends. Its
worker is told the app stack may not run there; if it needs it, it calls `need_clone`, tells the
owner with `reply` and ends its turn, and the card waits for the next clean free clone ("Waiting for a workstation"), ahead of queued cards, where its session resumes by itself; what the owner says
meanwhile waits for it.

#### The pool in the bar

For each repository in clones the top bar shows the pool ("Workstations"): per machine (named once
there is more than one) a dot per clone, solid while its card's worker is at work, pale while merely
held, orange while free but blocked, and how many new cards could start ("2 free", "all taken",
"none free · 1 blocked"). Hovering or clicking it drops down a list: per machine its slots at
work and clones taken, then each workstation on a line of its own, free ones included, with its path
(cut at the front where too long, so its end stays readable), the dot the pill shows for it, and
the card in it, "free" or "blocked"; then how many cards wait for a workstation or a slot. While
none is free and a card waits, "⋯" beside the cards whose clone may go to it (see Taking a card's
workstation). The card
is a link: a click closes the list, flies to the card and opens it; for a card on another project
the page switches to that project at the card's address (see Addresses in The project), which opens
it once the project has loaded. A card not on any project (archived, say) shows by its title without a link. A
repository in worktrees shows a dot per slot, and none without slots (no pill if all are so); its
list names the cards' worktrees.

A free clone is blocked when the last look at it (see Workstations) says no new card gets it: it has
uncommitted or untracked changes (the list names the first five files), git fails in it, its
folder is missing, its machine does not answer over SSH (one line per machine), or git failed making
it ready for a card in the last minute. Blocked clones do not count as free, and the list says in
orange, per clone, why and what puts it right: commit or discard the changes; repair it, or delete
a clone Seismic made, which its next start makes again; clone it again or take the path out of the
configuration; check the network and SSH access. Showing the pool looks again, in the background,
at free clones whose look is old by the same measure or that were never looked at, so the pill tells
before a card waits what a waiting card would find. A card queued for want of a workstation points to
the pill for the reason.

### Folders without git

A repository may be a folder that is to stay without git: a family archive in a cloud drive, where a
`.git` would mean sync conflicts and copies of every scan. Its configuration entry says `"git":
false`; the first project and "+ Repository" offer it beside setting up git (see Setting up git in a
folder). It has no branch, landing, pull requests, prototypes, hosts or clones, and the UI offers
none of them (nor "For everyone, into the repository": `.obeya/settings.json` is written into the
folder like any file). The folder is its own read checkout, its plan docs, settings and Claude Code
configuration read as they are; a plan doc "Make a plan" writes is named at the start, as in
a plan folder outside the repository, since nothing of it lands.

Every card works in the folder itself, any number at once. Nothing lands: approving makes the card
`done` ("Approved. The changes stay in the folder: done."). The worker is told others work
in the folder at the same time and that the card lists what it changed; a demo is needed only where
something can be seen (an HTML artifact for a draft).

**Each card's changes.** Seismic keeps a manifest of the folder (path, size, mtime, ctime, inode),
skipping what Finder, Drive and office suites keep for themselves. A tool call that may write (not
Read, Grep, Glob and the like) opens a window from its `PreToolUse` to its `PostToolUse` hook; the
folder is read before and after, and each change goes to the cards whose windows were open at its
ctime, which no tool sets (a deleted file by its directory's). So a change is a card's own even while
others, a scanner or the sync client change the folder; one outside every window is no card's, and
one during two cards' calls is listed by both and undone by neither. The window opens at a time read
off the ctime of a file Seismic writes then, since Linux stamps ctime from a coarse clock up to 10 ms
behind the system clock. An editing tool's call reads only its file; a script's call reads the whole
folder (0.3 s for 4,615 files). Background work keeps a window open; the end of a turn closes any
left open. A file only in the cloud (dataless) is never read, hashed or copied, which would download
it. Per path, a card's change runs from before its first change to after its last (added, changed,
moved, deleted; a moved directory is one move), with a hash of what it wrote, kept after the card is
done. Agents that only read (the Koordinator, plan agents) are not followed.

The card shows the list in the place of its branch ("Changed in the folder: 4 files +12 −1 · Undo: complete"), whose size shows it over the page with diffs of the text files whose
earlier version Seismic kept, and in full as the change list at the top of its left column (see The
files beside the demo), with what discarding would leave. Where the card shows no files beside its
conversation (before its first handover), the same list stands above the conversation, a click on a
file's name or line counts opening its diff, with "See the whole diff" beside it.

**Undo.** "Discard changes" on a card waiting for approval puts back what the card changed after
eight seconds in which the button counts down and a hint beside it says a second click calls it
off, since this undo cannot
itself be undone. Before a card's first write, Seismic prepares it under `undo/<canvas>/<repo>/<card>`
in its home: where the file system clones (APFS `clonefile`, reflink on btrfs and XFS; probed with
`COPYFILE_FICLONE_FORCE`), a clone of the whole folder, sharing bytes until a file changes (8.1 GB in
0.86 s, no space taken): full undo. Elsewhere (another volume, NTFS, ext4, Windows' ReFS and Dev
Drive, which Bun reaches no clone call for), copies of the text files: partial undo. An editing
tool's file is also copied just before its first write. Undo deletes added files, puts back changed
and deleted ones from the copy matching their state before the card (size and mtime), then reverses
moves. It leaves alone a file changed after the card (ctime, inode and hash or size and mtime differ
from what the card left), one with no copy, and a change two cards shared: the log names them, the
list keeps them, and the worker hears of them with its next message. Before the owner decides, the
card says which undo it has and what discarding does with each entry. The undo goes when the card is
done or discarded, and is made afresh if its worker goes on.

### Parking

A card waiting for the owner (handed over, asked, pull request open), its worker idle, has the app in
its workstation stopped after five minutes, so a quick reply does not pay for a restart
(`SEISMIC_PARK_GRACE`, in seconds, for demos and live checks). Seismic runs the settings' `app.stop`
there (once the owner trusted it, see Trusting a repository's commands), unless `app.keep` exits 0
(the app holds data that must stay; the card says it keeps running, unless the session died and
took the app with it, see Lifetimes). An app the owner opened from the
card runs at least 30 minutes (see Trying the app by hand). The card's log says the app was stopped,
and the next message to the worker tells it to start the app again as the recipe says; a message
arriving during the stop waits for it. A failed stop is an error on the card; the worker hears
nothing of it. After a restart,
waiting cards are parked the same way. Only processes go; the workstation stays the card's.

### Lifetimes

An agent's session can leave three kinds of thing running. Each has its own end, and none stands in
for another.

- **Session work**: processes the agent's session started and Seismic observed. For Codex that is
  every descendant of the app-server (native PTYs and background terminals included, wherever their
  process group is), found by creation identity as described above. It ends with the session: a
  stop, a forced stop, the session closing, its agent dying, and, after a crash of Seismic, the next
  start of an Seismic on the same home (Recovery after a crash). `app.keep` has no part in it. A
  Claude Code worker's session work is only its own process group: a stop ends that, and what the
  agent started in a group of its own is not observed, so it outlives the agent's death and a crash
  of Seismic alike (macOS, real agents, both harnesses). A harness added later says what it observes;
  it never claims more than it checked. A card whose agent died while Seismic runs keeps its state, with
  the exit as an error line in its log.
- **The app**: what serves the card's workstation for the owner to try, started by a worker as the
  repository's `app.run` says. Parking, "Stop", handing a clone over and discarding end it with
  `app.stop`; `app.keep` and the 30 minutes after "Open app" hold it back from parking only.
  Seismic never ends an app by process identity. An app started by a Codex native terminal is session
  work as well as the app, and the shorter lifetime wins: it ends with the session, `app.keep` or
  not. A session that dies this way is not parked again and its card's app address is cleared, so
  the card never claims an app keeps running that the session's cleanup ended. An app meant to
  outlive a session needs a handoff Seismic does not have: no ancestry says which
  process is meant to stay, so none is specified.
- **External operations**: pushes and pull requests, deploys, forge calls, and commands run on
  another machine (see Hosts). They are not session work and no cleanup or recovery of Seismic
  touches them; a session ending does not cancel them.

#### Recovery after a crash

A crash of Seismic runs no cleanup. While a Codex session runs, the server records what it observed in
`sessions/` of its home: one record per session (host, boot, PID namespace, the working directory,
and the pid and creation time of the app-server and each observed descendant, no command lines or
credentials) beside a lease file on which the server holds a SQLite write lock, which the kernel
drops when the server dies. The record is written before the app-server can run any session code and
again whenever the observed set grows; a session that ends in order removes both.

The next Seismic on that home sweeps before any card resumes. A record is looked at only while the
sweep holds its lease, so a live Seismic's sessions, this one's or another's on the same directory,
are never candidates. A record from an earlier boot is dropped without a signal; one from another
host or PID namespace, or that cannot be judged, is left alone and reported; an unreadable or
foreign-version one is moved to `sessions/quarantine/`. Otherwise only the recorded processes whose
pid still shows the recorded creation time are ended, each by its own pid and with their current
descendants, never by process group (a group number proves nothing about who else is in it, unlike
in a live session); every other process is left alone. The record goes once none of them runs. If one does, or
the signal is refused, the record stays, the next start tries again, and a new Codex session in that
workstation refuses to start meanwhile, so a second writer never works beside an old one. The sweep
reports each outcome in the server's log (card pages do not show it).

Limits, by nature of numeric signalling: between the check and the signal the process can end and
its pid be given to another; the creation time (to the tick on Linux, to the second on macOS)
makes that need a pid reused in the same second as the recorded process started. An observation lost
to a crash before it was written, a child that detached unseen between two samples, and a session
whose app-server was never recorded are not recovered. Windows records nothing and recovers nothing
(its identities were not checked). A Claude Code worker is not recorded at all. Recovery is
cleanup, not containment.

### Hosts

Other machines a repository's workers run on, over SSH. The configuration lists them per repository
(`hosts`: name, SSH target, directory for the clones, number of clones and of slots); the
Configuration dialog edits them as table rows under the clones, as the Koordinator's `configure` does
by voice. Only a repository in clones that lands through its remote can have them; a name means one
machine across the configuration. Seismic clones the repository there in the background (retrying an
unreachable host every two minutes, logging a failure once until it changes) and registers each clone
as `ssh://<host>/<path>`; a new card goes there when the machines before it have no slot (see Slots).

#### Running there

Every git call, stack command and worker session in such a workstation runs there through `ssh`,
unseen by its callers: `ssh <target> exec sh -c '…'` with the installers' directories on the `PATH`;
`exec`, so a shell that forks for a command (dash) does not stay as the session's parent under
another pid. One shared connection where `ControlMaster` exists (not Windows), its sockets in
`/tmp/obeya-ssh-<uid>` for the owner alone, since whoever reaches a socket uses its connection;
`BatchMode`; keep-alives that notice a dropped link within 45 s. Calls the server still blocks on fail
at once after a host's connection failed, and the host is asked again in the background 30 s on;
when it answers, waiting cards look again.

#### Logins and files

Nothing secret is stored there: the repository's GitHub login (from `git credential fill` here) and
the Claude login (`claude-token` in Seismic's home, from `claude setup-token`, else
`CLAUDE_CODE_OAUTH_TOKEN`) travel as the first line
of stdin of each command and session; the clones' credential helper reads `GH_TOKEN` (after an empty
helper, so macOS's keychain does not keep it). The clones are marked trusted in the host's
`~/.claude.json`, since nobody answers the folder dialog there and the repository's own permission
rules would not apply.

The session runs through the SDK's `spawnClaudeCodeProcess`: Claude Code started over `ssh`, with
Seismic's tools and hooks over its stdin and stdout. Before a host's first session, the plugin and the
`playwright-core` its demo skill needs go to `~/.obeya/remote` there (again when changed), with the
owner's demo settings without a key file (no API key goes to a host) and without the demo directory
(a path of this machine: demos there go into the host's `~/demos`, which the brief names), and that is the session's
`SEISMIC_HOME`. Its `SEISMIC_URL` is a port forwarded
(`-R`) to a server of Seismic's that answers only narration clips, inline as base64, so demos rendered
there get the owner's voice, which only this machine runs.

Screenshots in the owner's message are copied to `~/.obeya/remote/images` there and named by those
paths, as are the copies of dropped files whose paths the message holds (to `~/.obeya/remote/files`;
a file named by its own path stays on this machine, out of the worker's reach); a demo named in a handover is copied here (`<home>/hosts/<host>/<path>`) afresh at each
handover and served and shared from that copy (a path with `.` or `..` is refused, since the copy
replaces what lies at its place); the work retrospective reads
transcripts from there; gh runs here, on the pull request's URL.

#### A dropped connection

A dropped connection (ssh's exit code 255), or a host unreachable before the session starts, ends the
session as a restart does: the card says so, Seismic asks every 30 s whether the host answers, then
resumes the session by id with the message not yet taken, or word of the drop if it was at work (a
session that never started there starts anew with its first message); a
card waiting for the owner needs no session until their next message. The resumed session first ends
the one the drop may have left running there, by the pid it wrote, never itself (a restarted host,
a container say, reuses pids). A host needs git, Claude Code and what the repository's work needs.

### Decisions

- **Feedback credits the sessions that ran, frozen at the handover** (2026-11-03): attribution
  read from the card's pinned setting or today's defaults at the time of the response would credit
  a model that did not do the work after a fresh start, a harness change or a settings change.
  Work by several configurations credits none of them alone rather than the last or the most
  frequent, since the owner judges the result as a whole. Rejected: crediting the latest session;
  splitting credit by turns or time (it suggests a precision the owner's judgement does not have);
  filling unknown fields from defaults.

- **The installed app runs the machine's own Claude Code**, not the SDK's binary (2026-10-07): that
  would add 224 MB to every download, put Anthropic's proprietary binary into an MIT app and pin its
  version to Seismic's releases. Their protocols may drift; it held with every version tried, on macOS,
  Windows and Linux, and the setup assistant names the version Seismic was checked with.
- **Exploration agents and look-ups have a worker's tools** (2026-10-12). Rejected: read-only tools,
  with which they answered from the text, or said they could not see, what they could have checked.
- **Seismic's tools are allowed by a hook** (2026-10-10). Rejected: `allowedTools`, which makes the SDK
  log a `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` warning with a stack trace at every worker start.
- **Workers run on more than one machine, capped by busy workers rather than workstations**
  (2026-10-10). Measured on the owner's Mac (M4 Pro, 48 GB), 1–8 Oct 2026: workers were in a turn for
  74 of the 963 worker-hours they held a workstation (8 %), at most 8 at once, busy beyond 3 at once for
  17.6 worker-hours in 5 working days; the 5–9 held clones' app stacks filled the 48 GB and 20 GB of
  swap, while Claude Code took 2.3 GB. So waiting cards park, machines count slots for busy workers,
  and a card finding none goes to another machine, where it stays until its work lands. Rejected:
  clones as the only cap; stacks running until stopped by hand.
- **Crash recovery by record and lease, ending only what was observed and still has its recorded
  identity** (2026-11-02). Rejected: a command-line or workstation-wide search for stray agents
  (could hit another Seismic's or unrelated processes); a liveness pipe or supervisor alone (it
  cannot act once it dies itself, and a record can); report-only recovery (it leaves the processes
  running until the owner finds them); an app-process identity contract to keep apps alive through a
  crash (no ancestry shows which process the owner means to keep).
- **Worktrees by default** (2026-10-14); a project whose configuration names clones keeps them.
- **A host's forwarded port reaches a server that answers only narration clips** (2026-10-16).
  Rejected: forwarding to Seismic itself, which let anyone on that machine run commands here.
- **A finished card's question takes a temporary worktree when no clone is free** (2026-10-15).
  Rejected: failing; queuing it (clones are often held for days by cards in review); the read checkout
  (other agents read there at the same time).
- **A folder may stay without git** (2026-10-20): a cloud-drive archive (8.1 GB, 4,615 files, mostly
  PDFs) cannot take a `.git` without sync conflicts and copies of every scan. Cards work in place, in
  parallel with the Koordinator's overlap check on files; changes are told apart by ctime; undo is
  full where the file system clones. Rejected: a shadow git outside the folder (copies every file
  into git and the folder into each worktree); a copy per card applied on approval (cheap only where
  cloning works).
- **The pool follows the configuration; a clone leaving it is deleted** (2026-10-21), so a lowered
  number gives disk space and app stacks back. Rejected: clones staying once registered; leaving the
  folder; asking when saving (a step more, and a leased clone is freed only later).
- **A workstation whose folder is gone leaves the pool at once, even from its card** (2026-10-23):
  waiting for the card to give it back never ends, since nothing (git, `app.stop`) runs in a missing
  folder, and the project showed every moved repository twice. Rejected: keeping it until the folder
  comes back (a moved home never does).
- **A lease is given back from the card's state** (2026-10-21), whatever brought it there. Rejected:
  freeing only on a card's normal path, which left stopped, ticked-off workstreams holding clones.
- **An unreachable host fails fast** (2026-10-12): asking it on every look for a free clone (almost a
  minute with five clones there) left Seismic unresponsive while a card waited.
- **Git frees workstations in the background, the workstation taken until it is done** (2026-10-21):
  removing a worktree, or a checkout back to the main branch in a discarded prototype's clone, held
  the server on every project in a large repository or over SSH. Rejected: freeing the workstation first
  and cleaning it afterwards (another card could take it half cleaned).
- **The pool shows why a free clone goes to no card** (2026-10-26, GitHub issue #9): a clone with
  uncommitted changes counted as free in the pill while cards waited for one, with nothing saying
  why; the card's own line ("The free workstations have uncommitted changes") named
  neither the clone nor the files.
- **The pool lists each workstation with its path and card** (2026-10-26, GitHub issue #10): a summary
  of counts and titles did not say which folder a card works in, nor which clone is free, and gave
  no way to the card. A click opens the list as well as hovering, so its links can be reached and it
  works by touch. Rejected: a path cut at its end (the clone's number and the repository are at the
  end); the list on the phone (owner, 2026-10-27: the phone view stays simple).
- **The owner can take a card's clone for a card waiting for one** (2026-10-27, GitHub issue #11):
  a card in review, or stopped with work, held its clone for days while a more urgent card waited.
  Its uncommitted work goes into a commit on its branch, taken apart again when the card goes on,
  so the override loses nothing and needs no question first. Rejected: asking what to do with
  uncommitted work at each click; refusing while the clone holds uncommitted work (a worker at work
  nearly always has some). It shows only while no clone is free and a card waits (the card it was
  taken from queues again and would otherwise take the clone straight back), and behind a faint
  "⋯" rather than a button per row (owner, 2026-10-27: a rare action whose label alone did not
  say what it is for, and buttons in every row crowded the list).
- **Free clones are chosen by their last look, the one taken looked at again** (2026-10-21): in a
  large repository (GitHub issue #2: 9,188 files, on Windows) or over SSH, `git status` in every free
  clone at each look held the server, on every project. Rejected: asking git while choosing; a start
  that waits for the look before taking a clone (slots and the queue would not see it taken meanwhile).
