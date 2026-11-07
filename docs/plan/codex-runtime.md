# Codex preview hardening, then Pi

Seismic owns the canvas, workspaces, conversations and owner decisions. Each harness owns its coding
loop. A role (Koordinator, worker, explorer or small job) is not a harness or a model. The local
Codex worker preview is described in the permanent design chapters; this plan tracks what remains.

## Goal

Harden the local Codex worker preview and complete its remaining acceptance and parity work, then add Pi as a harness with the shared Seismic contracts.

## Workstreams

- [x] **W1:** Process cleanup. Finish and review the current process-group and observed-descendant cleanup, including the
  Linux `/proc` changes. Check normal stop, forced stop and agent death, PID reuse, unrelated
  canaries and shutdown escalation. Verify how this interacts with app parking and `app.keep`;
  distinguish graceful shutdown, explicit forced shutdown and crashes. `app.keep` governs
  waiting-card parking; do not invent an app-process identity contract merely to keep the app alive
  through forced shutdown. Check how Codex's semantic background-terminal cleanup and process
  groups interact with those lifecycle choices. Native Windows and Linux Codex behavior remains
  unverified. Record the actual results and limitations, not a containment guarantee.
- [x] **W2:** Comparable harness crash probes. Run comparable real Claude and Codex probes on macOS in scratch repositories and an isolated
  Seismic home: agent death and Seismic death, with a separately grouped background process and an
  unrelated canary. Check whether the app is meant to remain running, clean up every test-owned
  process, and report blocked authentication or incomplete runs rather than extrapolating.
- [x] **W3:** Session lifetimes and crash recovery. Before adding Pi, specify session work, the app governed by parking and `app.keep`, and
  external operations as distinct lifetimes. Use probe results to design and validate safe
  recovery of observed processes after an Seismic crash. This is not a Codex preview gate; it is
  a Pi gate. Recovery must not kill another live Seismic instance's processes or unrelated processes.
  Done for Codex on macOS and Linux (container); see "Recovery boundary" below. The lifetimes and
  the recovery are now in `docs/design/agents-and-workspaces.md` (Lifetimes).
  Launching agents through the liveness supervisor, and what must hold before that, belongs here
  (see "Liveness-pipe prototype: evaluation").
- [x] **W4:** Liveness-pipe prototype. Evaluated (2026-11-01): the two failure cases that reverted
  the first Codex transport integration are fixed in the prototype and have regression tests, and
  the transport's process identity is the agent's own, not the supervisor's. Verdict: combine it
  with the registry rather than adopt it alone, and keep it out of Seismic's launch path until W3; see
  "Liveness-pipe prototype: evaluation" below.
- [x] **W5:** Platform process boundaries. Evaluated (2026-11-03): systemd user scopes (Linux) and
  Job Objects (Windows) hold everything a real Codex app-server's commands started, the job also
  through Seismic's death, where today's tracker misses a child that detached before its first sample;
  neither holds a process that asks the system to start it elsewhere. Prototypes only, out of the
  launch path; Claude, macOS and the installed app untested. See "Platform process boundaries" below.
- [x] **W6:** Live phase 1 acceptance. Done (2026-11-03, macOS, Codex CLI 0.162.0): a Claude and a
  Codex card side by side through question, usage limit, pause, two restarts and landing, each in
  one session throughout. Found and fixed: a Codex card waited a blind 15 minutes after a usage
  limit; it now goes on at the reset. See "Live phase 1 acceptance (W6)" below.
- [x] **W7:** Active session identity. Done (2026-11-02): the working and reading bubbles name the
  harness and model of the session at work; see `docs/design/conversation-on-the-card.md`.
- [x] **W8:** Codex configuration trust. Done (2026-11-02): `.codex/` is the trust group `codex`
  of the repository-trust dialog; a Codex worker loads it only where its workspace's `.codex/` is
  to the byte what the owner trusted, checked at every start and resume, with Codex's own layer
  report (`config/read`) checked before a thread runs. See `docs/design/agents-and-workspaces.md`
  (Native Codex workers). Verified against Codex CLI 0.162.0 on macOS: the per-session trust
  override wins over the user's `[projects]` in both directions, project layers above the
  checkout are never read, and the workspace-write sandbox refuses creating or writing `.codex/`.
  Not verified: Linux and Windows Codex; whether Codex reloads project configuration that changes
  during a running session (Seismic checks only at start and resume).
- [x] **W9:** Foreground-wait guard. Decided (2026-11-02): no guard for Codex. Native `PreToolUse` hooks exist
  (Claude-shaped input and `permissionDecision: deny`) and work, but only once trusted in the user's
  own `config.toml`; session-level hooks stay untrusted and never run. And none is needed: steering
  lands during a running foreground command, which then continues as a background terminal. Now in
  `docs/design/agents-and-workspaces.md` (Native Codex workers). Still open, and W8's: if Seismic ever
  manages Codex hooks, that is a write into the user's configuration.
- [x] **W10:** Transcripts and retrospectives. Done (2026-11-03): decided to build it. A Codex worker's run is read from its
  rollout like a Claude transcript, so its cards feed the work retrospective. Now in
  `docs/design/the-koordinator.md` (Friction notes). Verified against rollouts of Codex CLI 0.162.0
  on macOS; the format is Codex's own and may change, in which case a run simply gives no excerpt.
- [ ] **W11:** Feature parity. SSH, non-Git folder undo, contributor reviews and record/replay, each with its own parity tests
  before removing the current refusal. User/repository skill discovery is separate from bundled
  file-based skills already supplied to Codex.
- [ ] **W12:** Other harness roles. Harness selection for other roles once their permission/read-only/continuation contracts are
  implemented. Keeping the Koordinator on Claude is a rollout boundary, not an architectural need.
- [ ] **W13:** Pi adapter. Implement the phase 2 adapter and its supported role contracts after the phase 1 gates.

## Verified checkpoint

Installed Codex CLI 0.162.0, on macOS, in scratch repositories and a scratch Seismic home:

- Native app-server transport and shared Seismic tools, file edits, reporting, active-turn messages,
  questions and owner replies, HTML handover, subprocess restart and restored tools.
- Selecting Codex through the real settings UI and discovering account models without a model turn.
- A real canvas card asking Blue/Green, restarting Seismic and changing the future default to Claude,
  then answering Blue and resuming the same Codex thread and resolved model.
- Owner permission denial and subsequent allow decisions through the existing question UI.
- Separate headless browser sessions for Codex and the test driver, desktop/mobile artifact checks,
  serving the actual HTML artifact in the card, approval and landing on the scratch repository's main.
- A real Codex card receives owner messages after defaults switch to Claude. A paused, undelivered
  answer survives server restart; resuming retains its thread/model and receives the next message.

## Focused hardening status

The acceptance pass used three independent read-only reviewers (including Codex), native scratch
runs and deterministic probes. Its nine findings have corresponding fixes and regression coverage:

| Area | Implemented check |
| --- | --- |
| Native PTYs outlive the app-server's process group | Track observed process descendants with creation identities, not arbitrary reported PIDs. A separate-group subprocess test leaves an unrelated PID alone; a real Codex PTY's heartbeat stops after app-server SIGKILL. |
| Main exits before shutdown escalation | Await transport shutdown before process exit. A subprocess regression awaits shutdown then exits; an EOF/TERM-ignoring server does not survive. |
| Ephemeral approval identities | Ignore callback ids, turn/item ids and timestamps, retain command and authority; equivalent reissued requests match, changed authority does not. |
| Broader file-change authority | Refuse `grantRoot` approvals and extended profiles rather than accepting session-wide authority as a one-call decision. |
| Denial instructions lost | Deliver the owner's explanation through model input after declining the native request; test steering receives the alternative. |
| Partial background completion | Each ended task wakes result inspection while persistent tasks remain; demonstrated with a native build plus a persistent server. |
| Polls extend timeout forever | Emit idle only on a transition or authoritative turn completion, not unchanged polling; regression tests cover repeated polls and the existing worker timeout. |
| Obsolete approval blocks later questions | Request resolution and turn completion abort and settle callbacks; a real Workers regression serializes another question afterwards. Session close preserves restartable questions. |
| Legacy Claude gets Codex skill menu | Legacy unqualified session ownership wins over changed defaults, tested before an explicit Codex pin selects its bundled skills. |

Process tracking is best-effort cleanup, not race-proof containment. A child that detaches and
loses its ancestry entirely between snapshots can escape observation. Native failure cleanup on
Windows/Linux native Codex cleanup is still unverified; do not expand the preview's platform
guarantees on the strength of the macOS result alone. On Linux, synthetic app-server tests run in an
ARM64 container without `ps`: an observed separately grouped child is killed after app-server death,
an unrelated process survives, and shutdown escalates. Linux process snapshots now read `/proc` and
use kernel start ticks, not `ps`'s second-resolution creation time. The app-server root is checked
against its recorded creation identity before new descendants are adopted. Numeric PID and process
group signalling still has a check-to-signal reuse race; start ticks are not a durable process handle.
This does not close the containment gap.

New speaker metadata persists the producing harness/model per utterance, including separate
Koordinator replies and researched answers. Concurrency/persistence tests keep identities isolated;
shared UI rendering and desktop/sidebar/phone screenshots cover the labels. Old messages are not
relabelled from current defaults; active working and reading bubbles name the session at work (W7).
Claude usage is independent of the worker harness: a live idle
Claude SDK fetch and the scratch UI both show it. The compact toolbar keeps percentages after
hiding the workspace pool; only its smallest stage hides them. No Codex usage is added.

### Verification limits

- Live concurrent Claude/Codex cards, blocked by Claude OAuth expiry in the first pass, were rerun
  in W6 (below).
- A post-fix Codex review identified attribution losses in card logs and moved answers, since fixed.
- Live rate-limit recovery is W6's (below); cross-platform cleanup remains unverified. Focused regression
  results are not a full-suite-green claim (the unrelated artifact-copy macro test is known to fail).
- The running owner's instance is never a test target; all probe jobs and scratch instances used
  for this pass are stopped after verification.

## Process cleanup: current work and follow-up

Current evidence (2026-10-31): on macOS, the process-tracking, Codex transport and runtime,
plus simulated parking/demo tests pass (87 tests); typecheck passes. A real Codex app-server
SIGKILL stopped an observed separately grouped background Python job (heartbeat stopped and its
PID disappeared). This was a runtime probe, not a full card or app-parking test; it did not test
Seismic's own death or an unrelated canary. The earlier Linux container tests were synthetic;
Windows and native Linux Codex remain unverified. An initial broad Codex review timed out; a
subsequent narrow review identified the already-known snapshot-to-signal PID/PGID reuse race and
also the unverified app-server group signal after `exit` and `close`, when its numeric group ID may
have been reused. Neither risk is resolved. An initial test run was blocked by an inaccessible
stale temporary directory; an isolated TMPDIR allowed the tests to run.

The lifecycle boundary remains open: the tracker kills observed descendants on app-server exit,
without distinguishing an app protected by `app.keep` from session work. Simulated parking tests
alone do not establish what happens to a real app launched under Codex on session shutdown.
Determine the intended lifecycle and exercise it with a real process before treating this as safe.

Paired macOS runtime probes (2026-10-31) launched a real background Python heartbeat under each
agent in separate scratch repositories. Each heartbeat was in a different process group from its
agent; an unrelated canary survived all four cases. After SIGKILL of the runtime host, the observed
Codex app-server and heartbeat exited, while Claude and its heartbeat survived (the heartbeat
advanced from 40 to 57 in 1.8 seconds). After SIGKILL of the agent, the Codex heartbeat stopped
and disappeared; Claude's heartbeat survived and advanced from 37 to 54. The short-lived runtime
host also exited after agent failure, unlike the Seismic server, so these results do not establish
behavior of a still-running server. All observed test-owned processes were explicitly cleaned up.
The Codex owner-death result is an observation of this run, not a crash-containment guarantee;
the Claude result makes crash cleanup relevant to both harnesses. No `app.keep` or real card was
involved. Probe and detailed output: `/tmp/obeya-runtime-owner-crash.ts` and
`/tmp/obeya-{owner,agent}-crash-{codex,claude}.log` on the test machine.

Real Codex card probes (2026-10-31) used a scratch server and trusted settings whose `app.keep`
logs and succeeds, while `app.stop` logs and signals the test app. A Python heartbeat launched as
a native background terminal was alive on a waiting question, but `app.keep` had not run while
that background task remained active. On graceful Seismic shutdown the heartbeat stopped; neither
settings command had run. A second attempt launched it via a shell `&` with redirected stdio: the
app was already dead by the time `app.keep` ran, while `app.stop` did not run. Thus neither
attempt demonstrates that an app which `app.keep` actually protected survives session closure;
the latter can even report keeping an app that already exited. A third launcher created a separate
session for the heartbeat and remained its parent for 1.5 seconds so it could be observed. Here
`app.keep` ran while the heartbeat was alive (57 ticks); graceful server shutdown then killed it
(58 ticks, PID gone), without invoking `app.stop`. **Decision (owner, 2026-10-31):** `app.keep`
protects an app from waiting-card parking, not an unconditional right to survive shutdown. A
graceful shutdown waits up to the existing 15-minute limit for busy workers; a forced shutdown is
chosen precisely because the owner does not want to wait, and stops remaining processes as best it
can without waiting for them to finish. A crash is separate and cannot run graceful shutdown.
The stop scheduler waits for busy workers and supports an immediate owner override, with regression
tests for both and for the deadline. Forced stop signals the tracked processes immediately instead
of waiting for Codex's normal EOF/TERM/KILL escalation; a synthetic macOS test checks a separately
grouped child and unrelated canary. Ordinary shutdown still waits for escalation. The card probe
above had no busy worker at shutdown, so it does not verify graceful waiting or this forced path
with a real card. All scratch servers stopped and
test-owned PIDs were cleaned up. Probe source and last report: `/tmp/obeya-keep-card-probe.ts`,
`/tmp/obeya-keep-card-report.json` on the test machine.

W1 closing pass (2026-11-01, macOS, Codex CLI 0.162.0, scratch directories, no model turn;
`scripts/process-lifecycle-probe.ts`). The probe drives the installed app-server through Seismic's
transport, starts three Python heartbeats with `thread/shellCommand` (in the shell's group, in a
session of its own, in a session of its own whose launcher exits early) and an unrelated canary,
then ends things four ways:

| Case | Heartbeats | App-server | Canary |
| --- | --- | --- | --- |
| Graceful transport close | all three stopped | gone | alive |
| Forced close (`endCodexHere(true)`) | all three stopped | gone | alive |
| SIGKILL of the app-server (the host lives) | all three stopped | gone | alive |
| SIGKILL of the host (no tracker left to run) | **all three kept running** | gone (stdin EOF) | alive |

So cleanup follows from the host's tracker, not from Codex: when Seismic itself dies, the
separately grouped and the same-group jobs alike outlive it. This differs from the earlier
host-death probe above, where the heartbeat stopped; the earlier job was most likely a Codex-managed
terminal that the app-server ended itself on EOF, whereas `shellCommand` jobs are not. Treat the host-death result as
"depends on how Codex started the process", never as a guarantee either way. Crash recovery is W3 (below) and W4.

Review changes from this pass: a refused signal (EPERM) no longer leaves the other observed
processes alive, and the identities still owed are kept and retried when the transport's pipes
close; a Windows `taskkill` failure other than "not found" is reported and retried, not forgotten
(untested on Windows); the app-server's group is signalled once at `exit`, never again by later
escalation timers (a test pins it); the probe itself only signals pids that still look like its own.
Open, by nature of numeric signalling: that one group signal at `exit` and every snapshot-to-signal
kill can reach a reused number if the group emptied and the number was recycled in between.

Lifecycle summary, as verified: for Codex, normal and forced stop and agent death end session work
(observed descendants and the app-server's group), unrelated processes are left alone, and
`app.keep` is not involved: it only decides whether a waiting card's app is stopped by parking. An
app started as session work dies with its session on any shutdown, graceful or forced; one the owner
wants to outlive a shutdown needs a handoff that does not exist (W3 left it unspecified). A crash of Seismic runs no
cleanup. A Claude agent's death ends nothing it started outside its own process group (W2 below).

W2 comparable crash probes (2026-11-02, macOS 26.6.2, Claude Code 2.1.316 through the
Agent SDK, Codex CLI 0.162.0 app-server, Bun 1.3.14; `scripts/harness-crash-probe.ts`). Each case
stages its own scratch Seismic with real workers, repository and `SEISMIC_HOME`, trusts settings whose
`app.keep` logs and exits 0 and whose `app.stop` logs and kills the app, and starts one card (Claude
Sonnet, low effort; Codex account default, low effort). The worker runs `python3 job.py`, which forks
a heartbeat into a session and process group of its own and keeps it as its child for three
seconds, then asks a question. Once the card waits and parking (`SEISMIC_PARK_GRACE=2`) ran `app.keep`,
so the app is one Seismic means to keep running while the card waits, the probe SIGKILLs the worker's
agent process (the `claude` binary, or `codex app-server`) or the Seismic server, and looks 8 s later.
An unrelated canary in its own session runs throughout. Repetitions: Claude agent death 5, the other
three cases 3 each (Codex agent death also once more in a trial); every case measured, none blocked.

| Case | App (separate group, kept by `app.keep`) | Agent | Server | Canary | Card |
| --- | --- | --- | --- | --- | --- |
| Claude, agent SIGKILL | **kept running** (~80 ticks in 8 s, every time) | gone | alive | alive | still asks; log: "Claude Code process terminated by signal SIGKILL" |
| Codex, agent SIGKILL | stopped at once (0–1 ticks, pid gone, every time) | gone | alive | alive | still asks; log: "Codex app-server exited (SIGKILL)", then parking's "the app keeps running" |
| Claude, Seismic SIGKILL | **kept running** | exited (stdin EOF) | gone | alive | unchanged in the database |
| Codex, Seismic SIGKILL | **kept running** | exited (stdin EOF) | gone | alive | unchanged in the database |

What this says about whether the app is meant to keep running:

- Codex agent death matches the design: observed session work ends whatever `app.keep` says. But
  parking runs `app.keep` again once the app-server is gone and logs on the card that the app keeps
  running, after the tracker had already killed it: the card tells the owner the opposite of what
  happened (in every Codex agent-death run).
- Claude agent death leaves a separately grouped app running, kept or not: Claude workers have no
  descendant tracking, and Seismic signals nothing when one dies. The design does not say whether that is
  meant; it is the same outcome as an Seismic crash, but with Seismic still running and able to clean up.
  This makes recovery after agent death a W3 question for both harnesses, not only for Codex.
- Seismic death: both harnesses' agents exit on their own once their stdin closes; the separately
  grouped app outlives Seismic for both, as the design says of a crash (no cleanup runs). Nothing marks
  the card: it still asks in the database. In one of three Claude runs another Claude process of the
  server (not the worker's; most likely the Koordinator's or a small job's) and the MCP servers from
  the machine's user-level Claude configuration were still alive 8 s after the server's death.
- In no case did a card show the owner that its worker was gone beyond the error line in its log;
  what an answer to the still-open question does next (resume, error, a second app) was not tested.

Cleanup: after each case the probe stops the scratch server (`--stop`), kills every heartbeat
working in the case's directory (found by working directory, not by pid file) and every process it
saw under the server that still has the same command, then checks that none is left; every case
reported clean (the first trial run, whose cleanup missed its scratch server, aside: that server was
gone when checked by hand), and a final `ps` found no probe process. Not covered: Linux and Windows,
an agent killed mid-turn instead of while waiting, a same-group background job, the app started by a
native Codex background terminal (W1 covers that through the transport alone), and resuming after
the crash.

### Recovery boundary (W3, implemented 2026-11-02)

What W3 built from the proposal below, for Codex sessions (`src/server/session-registry.ts`; the
rules are in the design chapter, Lifetimes). Differences from the proposal, with reasons:

- **No separate supervisor.** The Seismic server itself holds the per-session lease and writes the
  record; its death releases the lease. The supervisor of W4 is a different failure (a launcher that
  dies on its own) and stays a prototype; the production registry is independent of it.
- **The sweep is destructive, not report-only.** The proposal held it back until an OS mechanism
  binds a signal to a process identity, which neither macOS nor Bun offers. Report-only leaves the
  processes running until someone finds them, and the live tracker already ends processes by exactly
  the same check (pid and creation time, then a numeric signal). The sweep makes no stronger claim
  than that: the residual race (a pid reused between check and signal) is the live one's, and on
  macOS the creation time has second resolution, so a false match needs the same pid reused in the
  same second the recorded process started. Windows, which has no identity here, records nothing.
- **No group signals in the sweep** (Codex review): a recorded leader is signalled by its own pid; the
  live tracker's group signal stays. Also from that review: a record that cannot be read now is
  retried, not quarantined; a file that cannot be removed keeps the record; a replaced pid with a
  new creation time is republished.
- **Record content:** also the working directory, so that a new Codex session in a workspace whose
  old session could not be accounted for refuses to start (the proposal's "session that can safely
  resume versus one whose old writer is unaccounted for"). Refusing is only for Codex so far.
- **Visibility** is the server's log; an unrecovered record is reported again at each start. Not on
  the card.

Validated (macOS 26, Bun 1.3.14; Linux ARM64 container with `--init`, same tests):

- `src/server/session-registry.test.ts`, real processes and real SIGKILL of the owner: recorded work
  ends while an unrelated canary and a process recorded with another creation time (a reused pid)
  stay; a live owner's lease (a second owner on the same directory, the sweeper's own process)
  protects its record; refused or ineffective signals keep the record and report `unrecovered`, and
  the next sweep finishes; another host, an earlier boot, an unreadable record and an unwritable
  registry never signal; a crashed host of the real Codex transport (stub app-server and a detached
  PTY observed through the tracker) is recovered from its record, and an orderly close removes it.
  Linux passes the same tests and `agent-processes.test.ts`.
- Real Claude Code 2.1.316 and Codex CLI 0.162.0 (`scripts/harness-crash-probe.ts`, case
  `obeya-restart`: the W2 setup, then SIGKILL of the server and a start of Seismic again on the same
  home): Codex: the app the worker started stayed alive after the crash (as in W2) and the next
  start logged `recovered (ended <app pid>)`, the app stopped, the canary lived, the record was gone.
  Claude: nothing recorded, nothing recovered, the app kept running (unchanged from W2). Repetitions:
  Claude 1, Codex 3, all measured, none blocked; the probe's own stop of the restarted scratch server
  reported "still runs after the stop" each time, though nothing of it was left a moment later.

Open after W3: Claude Code (and Pi) record nothing, so their sessions recover nothing; whether the
Claude worker should observe descendants like Codex is a decision for the harness work. The parking
note "the app keeps running" after Codex's tracker ended the app is still wrong (a lifetime the
design now names but does not resolve). The registry stays unproven on Windows and in a packaged
build, and a power-loss test of the record's durability is untested.

### Proposed recovery boundary (the original proposal)

Use the supervisor and a registry for different failures, not as substitutes. A private liveness
pipe lets the session's supervisor react when its Seismic server dies. A durable registry is a fallback
for a supervisor that dies, or cleanup it could not complete; it does nothing until a later sweep.
Neither makes an unobserved descendant recoverable. The prototypes below have no startup sweep and
must not be treated as providing this design.

A separate **report-only** prototype in `scripts/agent-registry-prototype.ts` explores a
per-generation SQLite write-lock lease and atomic record replacement in a private local scratch
directory. The lease is held independently of the record file; an inspector cannot read a generation
while its lease is held, and an owner process's death releases it. Records carry a supervisor and
observed process identities; Linux identity reads boot ID, PID namespace and `/proc` start ticks.
Other platforms report identity unavailable. An inspector reports match, different, or
missing-or-hidden, and treats a missing/busy lease, corrupt record or mismatched boot/namespace as
unknown. It never kills processes or deletes records. Tests use synthetic identities and exercise a
separate owner's death on macOS. The supervisor can optionally write the registry on Linux in a
scratch directory: it establishes its lease before launch and records observed identities whose
start ticks still match, retaining previous observations. A shell waits on a private pipe before
executing agent code; the supervisor first records the gated child's identity, then releases it.
A Linux ARM64 container test checks that record from the first line of child code. The record is
fsynced along with its directory before release; filesystem and lease durability under power loss,
initial directory creation, and write-failure boundaries remain unverified. A crash between later
observation and publication still loses that observation. A synthetic Linux ARM64 container test
kills the supervisor and inspects the surviving worker and
separately grouped child; neither is killed by the report. Windows, hostile paths, power-loss durability,
filesystem lock behavior beyond local tests, real agents and packaged Seismic are unverified. This is
not a production registry, a startup sweep or proof that an identity is safe to signal.

- **Lifetime:** each local agent session gets a random, never-reused session generation and a
  supervisor. Session work belongs to it; a card's `app.keep` affects parking, not forced shutdown.
  External operations and remote hosts are not assumed to be session-owned. An app that needs an
  independent lifetime cannot be identified or protected by ancestry alone; no such handoff is
  specified yet. An ordinary session end and owner-pipe EOF both trigger cleanup, while a graceful
  server stop waits for busy turns as described above. No command-line search or workspace-wide
  kill is an ownership boundary.
- **Ownership:** the supervisor holds an exclusive, kernel-backed per-generation lease while it can
  own or clean up the session. Another Seismic instance or startup sweeper must acquire that same
  lease non-blockingly and keep it throughout inspection, signalling and record updates; a busy,
  missing, inaccessible, unsupported or ambiguous lease is *not* permission to kill. Lease files
  must not be unlinked and recreated while contenders may hold the old inode. Use a private local
  directory, secure permissions and paths that cannot be redirected; define and test platform lock
  semantics before relying on them. A random id or an owner PID alone is not a lease.
- **Records:** persist a versioned record per generation containing the host and boot identity,
  supervisor identity, and only observed session-process identities (PID plus a sufficiently
  precise kernel creation identity), with the session generation and lifecycle state. Do not store
  credentials or full command lines. Use atomic, crash-safe updates and serialize updates with the
  lease; keep a record when writing, inspecting or cleanup fails, rather than declaring success.
  Boot, host, PID namespace, identity format and lock backend must match the observer's environment;
  an unknown, corrupt, old, inaccessible or incompatible record is quarantined and reported, never
  guessed at. A filesystem shared across hosts or PID namespaces is not by itself a common process
  ownership domain.
- **Ordering:** a gated launch must establish the lease and durable initial record before agent code
  is allowed to run. As processes are observed, persist identities before relying on the registry
  to recover them. A crash before persistence or between observations still leaves a gap: the gate
  does not make later children atomic. Close or crash triggers immediate best-effort supervisor
  cleanup; mark the generation finished and remove its record only after cleanup is known to have
  completed. A crash during record updates or cleanup leaves it eligible for a later retry once the
  lease is available. Concurrent sweepers must not both clean the same generation.
- **Sweep:** only after obtaining the lease and establishing same-host, same-boot, same-namespace
  identities may a sweep consider an individual recorded process. Missing or mismatched processes
  are not targets; a live process whose identity cannot be established is left alone and reported.
  Verification followed by `kill(pid)` or `killpg(pgid)` still races reuse, and a group number does
  not prove every member is owned. Automatic destructive recovery requires an OS mechanism that
  safely binds signalling to the verified process identity; until one is selected and tested on a
  platform, its sweep is report-only. In particular, macOS `ps` second-resolution start times and
  numeric group IDs are insufficient for that guarantee. Linux pidfds and Windows process handles
  are candidates, not yet a verified complete design; neither discovers unseen children.
- **Acceptance before integration:** exercise crashes at each launch, registration and cleanup
  boundary; an owner and supervisor dying independently; concurrent instances and sweepers;
  reboot, namespace and PID reuse; invalid records, permissions and failed writes; normal and
  forced stop; kept apps and unrelated canaries. Test real Claude and Codex, packaging, and each
  supported OS. A failed or unavailable recovery must be visible and must not silently widen the
  kill scope. Preserve the distinction between a session that can safely resume and one whose old
  writer is still unaccounted for.

### Liveness-pipe prototype: evaluation

`scripts/agent-liveness-prototype.ts` (the supervisor) and `scripts/agent-liveness-owner.ts` (its
caller) are POSIX-only experiments; Seismic does not launch agents through them. The build bundles the
supervisor as a resource, and a macOS compiled-binary smoke test ran it with `BUN_BE_BUN=1`.

How they work. The caller starts the supervisor in a group of its own with two private pipes: a
liveness pipe whose write end only the caller holds, and a report pipe the supervisor writes to.
The supervisor launches the agent in a group of its own behind a gate (a shell that waits on a
third private pipe, then closes it and execs the agent), so none of the three pipes reaches the
agent. It samples the agent's descendants every 100 ms and, through the report pipe, tells the
caller each identity it observes (PID plus creation time), the agent's first and before agent code
runs. The caller adopts each reported identity only while a process still has that creation
time; no ancestry is needed, so the identities stay attributable after the supervisor has died
and its processes have been reparented. On liveness-pipe EOF or agent exit, the supervisor kills
the observed processes, then signals the agent's group once. When the supervisor exits, for any
reason, the caller signals every adopted identity that still matches, plus their children at that
moment. The caller acts on the supervisor's `exit`, not on its pipes closing: the agent inherits
the supervisor's stdio, so after a supervisor SIGKILL a reparented agent still holds them.

The two failures that reverted the first Codex transport integration, and their regression tests
(`scripts/agent-liveness-prototype.test.ts`; each was checked to fail with its fix removed):

- *Supervisor SIGKILL while the agent holds its pipes.* A synthetic agent starts a separately
  grouped leaf; the supervisor is killed after reporting it. The caller's `done` settles while the
  supervisor's stdout is still held open, both agent and leaf are stopped, an unrelated canary
  survives. The agent identity the caller receives is the agent's, distinct from the supervisor's.
- *Fast agent exit.* The agent starts a same-group child and exits before the first sample. The
  group signal at exit stops the child; a canary survives.

Two more tests: neither the liveness nor the report pipe is open in the agent, and ending one of two
concurrent supervisors' pipes stops only its own agent. All pass on macOS and in a Linux ARM64
container (Bun 1.3.14, 2026-11-01), together with the earlier registry tests. These are synthetic
processes, not a real Claude or Codex harness, and nothing was run on Windows.

What the combination covers, by what dies:

| Dies | Who cleans up | Left over |
| --- | --- | --- |
| Seismic server | supervisor, on liveness-pipe EOF | descendants not yet sampled that left the agent's group |
| supervisor | caller, from the adopted identities | the same, and a same-group child of an agent that also exited already |
| both (power loss, OS killing both) | nobody until a registry sweep, Linux report-only today | everything |

Verdict: combine, do not adopt alone. The supervisor answers the server's death, the caller's
adoption answers the supervisor's death, and only a durable registry with a startup sweep (above)
can answer both dying; none of them makes an unobserved descendant recoverable. Before agents are
launched through it (W3):

- *Normal shutdown.* Liveness EOF means SIGKILL at once. Graceful stop (busy turns, Codex's
  EOF/TERM/KILL escalation) must stay with the server over the transport; the pipe is only for the
  server's death, and an ordinary stop closes it only after the transport has finished.
- *Apps and external work.* Everything observed under the agent dies with the session, including an
  app `app.keep` protects from parking, which matches the owner's decision that a crash ends session
  work. Work outside the agent's ancestry (a daemon's children, containers, remote hosts) is not
  reached and not owned.
- *Concurrent instances.* Each session has its own pipes and process groups; nothing is found by
  search. A startup sweep across instances still needs the registry's lease.
- *Remaining windows.* A descendant that leaves the agent's group between two samples; a fast agent
  exit combined with a supervisor death; macOS creation times have one-second resolution; every
  numeric signal (PID or group) races reuse; the group signal at exit can reach a reused number once
  the group has emptied.
- *Packaging.* POSIX only, with `/bin/sh` as the gate; Windows needs a different mechanism (W5: a
  Job Object, see "Platform process boundaries"). A
  compiled Seismic must start the bundled resource with `BUN_BE_BUN=1`, which the caller side does
  not set yet.
- *Both harnesses.* Claude's processes survived the host's death in the probes above; the launch path
  should be shared by Claude and Codex, not a Codex transport detail.

### Platform process boundaries (W5, evaluated 2026-11-03)

Two prototypes, outside Seismic's launch path like W4's: a transient systemd user scope per session on
Linux (`scripts/linux-scope-prototype.ts`) and a Job Object per session on Windows
(`scripts/windows-job-prototype.ts`). Each has tests (skipped where the mechanism does not exist) and
a probe with a real Codex CLI 0.162.0 app-server, no model turn and no login
(`scripts/linux-scope-probe.ts`, `scripts/windows-job-probe.ts`). `scripts/boundary-matrix.ts` runs the
Linux side in a Docker container that boots systemd; `.github/workflows/process-boundary.yml` runs
both on native GitHub runners (by hand, or on a push to a `boundary-probe/` branch).

How they work. *Linux:* `systemd-run --user --scope --unit=obeya-<random>.scope` has the user manager
move systemd-run's own process into the new cgroup before it execs the command in place (same pid,
same stdio, the environment kept), so the launch is gated by construction. A shell in between writes
the cgroup it finds itself in to a private fd 3, closes it and execs the agent; no line on fd 3 means
systemd-run exited without running anything, and the caller may start the agent without a scope.
Ending writes `cgroup.kill` (kernel 5.14+), which the kernel applies to every member at once, forks
during the kill included, with no pid looked up; where that file cannot be written, `systemctl --user
kill --signal=SIGKILL <unit>`. A scope outlives its caller, and its random unit name names nothing
else while it exists, so a sweep can end it by name (for the registry: record the unit, not pids).
*Windows:* a named job with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` and without breakaway. Bun cannot
create a process suspended, so the caller starts a gate (the prototype itself, `BUN_BE_BUN=1`) that
polls until it finds itself in that job; the caller assigns it by a handle of the still-waiting
process; only then does the gate start the agent with its own stdio and stay its parent. Ending is
`TerminateJobObject` by the job's handle; the caller's death closes the handle and the kernel ends
every member.

Where it ran: a Debian 13 container (systemd 257, Docker Desktop's Linux 6.10, ARM64, privileged with
a private cgroup namespace); GitHub's Ubuntu 22.04 (systemd 249) and 24.04 (255) runners, x64, native,
cgroup v2, a lingering user manager; GitHub's Windows Server 2025 runner (10.0.26100), x64, whose
step processes are already in a job of the runner's, so every job the probe made was nested. All
three Linux systems gave the same results. Windows took four runs, the first three with faults of
the tests and probe themselves (quoting, a locked scratch directory); the Codex cases measured the
same in each run that reached them.

Real Codex, four heartbeats started by `thread/shellCommand` (in the shell's tree; detached into a
session or process group of their own by a launcher that stays, exits after 1.5 s, or exits at once,
"fast"), an unrelated canary throughout:

| Case | Today's tracker alone | In a scope (Linux) | In a job (Windows) |
| --- | --- | --- | --- |
| Session closes (transport close) | three stop; **"fast" keeps running** (Linux and Windows alike) | all four stop (`cgroup.kill`) | all four stop (`TerminateJobObject`) |
| Seismic's stand-in SIGKILLed/terminated | **all four keep running** | all four keep running in the scope; a sweep by unit name then ends them | all four stop at once (kill on close) |

The canary lived in every case. "fast" is new: its launcher exits before the tracker's first 500 ms
sample, so nothing links it to the app-server; this is the gap W1 named ("a child that detaches
and loses its ancestry between snapshots"), now observed on both platforms. In the first Windows run
the tracker's PowerShell snapshot failed at the transport's start ("Cannot inspect agent process
ownership", the 3 s limit on a cold runner) and the case was blocked; the second run measured it.

Prototype tests, passing on all three Linux systems with and without a D-Bus daemon, and on Windows:
the agent is inside its boundary from its first instruction (and on Linux without the report pipe,
and with the pid the caller holds); a daemon detached at once is ended with the boundary and nothing
else is; the boundary outlives (Linux) or dies with (Windows) a killed caller; the agent's exit leaves
its app running in the boundary until something ends it; no reachable manager starts nothing and says
why; on Windows also a second job of the same name is refused, a nested job ends alone or with its
outer one, and a child created with `CREATE_BREAKAWAY_FROM_JOB` is created (CreateProcess accepts the flag there;
why was not examined) but stays in the prototype's job and ends with it.

Linux situations (the probe's `kill` case and the tests):

| Situation | Result |
| --- | --- |
| user manager and D-Bus | scope; ended by `cgroup.kill` |
| manager without a D-Bus daemon (dbus stopped, its socket gone) | scope, on systemd 249, 255 and 257 alike: systemd-run and systemctl reach the manager over its private socket |
| read-only cgroupfs in the caller's mount namespace | scope (the manager moves the process); ended by `systemctl --user kill` |
| no user manager (no lingering, no session; or no `XDG_RUNTIME_DIR`) | none: "Failed to connect to user scope bus", nothing ran |
| unprivileged container (no systemd, cgroupfs read-only) | none, nothing ran; tests skipped |

Ways out (measured; Linux on all three systems, Windows on the runner):

- Linux, stay in the scope: `setsid` and double forks. Leave it: `systemd-run --user --scope` and
  `systemd-run --user` (a unit of the manager's), and a process that makes a cgroup of its own in the
  user's subtree and writes its pid to its `cgroup.procs` (the user owns that subtree; moving into
  another session's scope works the same way). A boundary against accidents, not against an agent
  that means to leave.
- Windows, stay in the job: a detached spawn (`DETACHED_PROCESS`, a group of its own), `cmd /c start
  /b`, and `CREATE_BREAKAWAY_FROM_JOB` (above). Leave it: WMI's `Win32_Process.Create` (the process is
  WMI's child, outside the job, and survives `TerminateJobObject`). The task scheduler accepted and
  started a task, but its process wrote nothing within 20 s, so that way was not measured.
- Nesting, Linux: a session scope is a sibling of the caller's unit, not inside it: stopping the
  caller's scope or service (a terminal closing, `systemctl --user stop`) leaves session scopes
  running until a sweep. Windows: the probe's own process was in the runner's job; nested jobs
  worked, and ending the inner one left the outer.

App parking. Neither boundary ends anything by itself while its caller lives: the agent's exit leaves
the app in it, `app.stop` (run by Seismic outside the boundary) ends the app, and an empty scope goes
by itself. Ending the boundary when the session ends is what Seismic does to Codex session work today,
so for Codex parking and `app.keep` would behave as now, with the "fast" gap closed. Two differences
would need deciding before integration: for Claude, ending its boundary with the session widens
session work beyond its own process group (an app it started then dies with the session, as Codex's
does); and on Windows, kill on close ends session work at every exit of Seismic, a graceful restart
included, where Linux leaves it to the next start's sweep.

Not covered, so not claimed: Claude Code on Linux or Windows (no login there; nothing ran); Pi; macOS
(no unprivileged equivalent was selected, nothing changes there); cgroup v1 or hybrid hosts, kernels
before 5.14 (no `cgroup.kill`), distributions without systemd, WSL, Flatpak or Snap sandboxes; Windows
on ARM, a desktop Windows session, an unnested job, and the installed (compiled) app on either
platform; a Codex sandboxed command (the probe's ran with full access); the registry recording unit or
job names.

Verdict: both are real boundaries for what a cooperating agent starts, closing the gap sampling
leaves (W1, W4), and neither is containment against a process that means to leave. Linux scopes are
available only with a reachable user manager and need the existing tracker as the fallback; Windows
jobs need no service and also answer Seismic's crash. Integration is a launch-path change for both
harnesses (the W3/W4 open point) plus the two decisions above, not part of this workstream.

## Live phase 1 acceptance (W6)

2026-11-03, macOS, a scratch Seismic from this checkout with real workers on the machine's Claude and
Codex sign-ins (`--real-workers --restarts`), a scratch repository whose `bun run slow-check` takes
three minutes. Card C ran on Claude Code (Sonnet, medium), card X on Codex (gpt-6.1-sol, low), both
started at once with their harness chosen at the start. Usage limits were real refusals by the
services' own shape, put in by `scripts/limit-proxy.ts`: real Claude Code and the installed Codex
reach the real models through it (`ANTHROPIC_BASE_URL`, and `SEISMIC_CODEX` naming its wrapper, which
gives Codex a provider of the same ChatGPT sign-in), and for a set time it refuses each model request
with a 429 as at the account's limit. No account was driven to its actual limit.

| Step | Claude card | Codex card |
| --- | --- | --- |
| Start side by side, ask the owner | asked, answer delivered to it alone | asked, answer delivered to it alone |
| Answer given while both harnesses are over the limit (150 s) | "Usage limit · continues at 22:41" from the rate-limit event | the same, from Codex's rate-limit update (before the fix: a retry in 15 minutes) |
| Limit lifts | went on by itself within 20 s, acted on the answer | the same |
| Pause during the three-minute check | stopped at once, the check ended | the same, app-server and check ended |
| Restart (new code) while paused | stayed paused | stayed paused |
| Resume | went on, reran the check | went on, said the pause had cut the check off, reran it |
| Restart while both run the check | waited for the safe point; finished the check, handed over | finished the check, paused for the restart, after it handed over |
| Approve | landed on main | landed on main |

Each card kept one session (`agent_runs`: one Claude session id, one `codex:` thread) through limit,
pause, both restarts and landing. The proxy also showed that `codex -c … app-server` ignores
overrides given before the subcommand; its wrapper puts them after.

The accented-letter task was repeated on 2026-11-04 with Claude Code (Sonnet, medium) after removing
German examples from the worker's shared instructions and tool description. Its first question and
its handover were in English; the slow check finished. This repeat checked the language, not the
rate-limit, pause and restart sequence above.

## Phase 2: Pi

An installed `pi --mode rpc` subprocess is the preferred first adapter; an embedded SDK is an
alternative if tighter control outweighs isolation. Register the same Seismic tools through a Pi
extension. Reuse harness-aware settings and pinned session ownership. Map messages, steering,
persistence and `agent_settled` (not merely `agent_end`) to the shared contract. Support standard
extension dialogs explicitly; arbitrary TUI extensions are outside the initial scope. The
Koordinator can then select Pi once that role's contracts are supported, just like workers.

Estimated difficulty after a sound phase 1: a basic Pi worker is moderate, roughly 3–7 engineering
days; polished installed-extension/configuration/recovery support likely adds 1–2 weeks. These
are planning ranges, contingent on the supported extension set and remaining phase 1 gates.
