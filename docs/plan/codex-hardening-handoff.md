# Handoff: Codex hardening, speaker labels and Claude usage

## Request and current state

The owner asked to fix the nine findings from the focused Codex acceptance pass, show the speaking
agent's model in dialogues, and check the missing Claude usage display without adding Codex usage.
They now want someone else to finish this work.

Checkout: `/Users/nick/harness/obeya`, branch `feature/codex-support` at `5f4cb43` (`Enable native Codex task workers
on the canvas`). **All changes described below are uncommitted. Nothing has been pushed.**
Ask the owner before committing; this repository commits on main. Do not discard the dirty files.
Read `CLAUDE.md`, `docs/design.md` and the relevant design chapters before continuing.

The native Codex worker was already usable before this change. This is hardening and attribution,
not the initial integration. Other roles remain Claude. Pi is a later phase; do not start it here.

## Implemented, pending final verification/review

### Nine acceptance findings

1. **PTY cleanup:** new `src/server/agent-processes.ts` tracks observed app-server descendants,
   including separate process groups, using process creation identities to reduce PID-reuse risk.
   `src/server/codex-rpc.ts` samples descendants every 500 ms and cleans them on exit. Arbitrary
   unrelated PIDs reported by the protocol are not adopted without ancestry evidence.
2. **Shutdown:** `endCodexHere()` now returns a promise; `endAgentsHere()` returns it and
   `src/server/main.ts` awaits shutdown before exiting, allowing TERM/KILL escalation to run.
3. **Approval identity:** `src/server/codex-runtime.ts` removes callback ids, timestamps and
   turn/item ids from persisted permission identity, retaining the command and requested authority.
4. **Broad approval scope:** reject file approvals carrying `grantRoot` and extended permission
   profiles rather than treating session-wide access as a one-call grant.
5. **Denial instructions:** accompanying owner text is delivered as model input after declining.
6. **Partial completion:** any ended background task wakes inspection even while a server remains.
7. **Polling:** unchanged background polls no longer emit idle repeatedly and reset worker timeout.
8. **Obsolete permissions:** request resolution/turn completion abort and settle callbacks;
   `src/server/workers.ts` withdraws obsolete questions while session close preserves restartable
   questions. A subsequent queued permission can proceed.
9. **Legacy skills:** `src/server/canvas.ts` respects an existing unqualified Claude session before
   consulting today's Codex default when choosing the skill menu.

**Important limitation:** process sampling is best-effort cleanup, not race-proof OS containment.
A child that detaches and loses ancestry entirely between observations can escape. Native Windows
and Linux cleanup have not been verified. Keep these limitations explicit; do not claim all process
containment is solved.

### Speaker/model attribution

- `src/core/types.ts`: `AgentIdentity` and optional identity fields on card events and separate
  Koordinator replies/researched answers.
- New `src/server/agent-identity.ts`: AsyncLocalStorage context with snapshot access.
- `src/server/runtime.ts`: per-session identity in `withAgentSetting`; wraps tool execution,
  permission callbacks and events; updates the identity from resolved session model information.
- `src/server/db.ts`: additive migrations for `events.agent`, `talk.reply_agent`,
  `talk.answer_agent`; persists producing identities, not current defaults. Migration test updated.
- `src/server/board.ts`, `src/server/advisor.ts`, `src/server/commands.ts`,
  `src/server/answers.ts`: propagate identities across asynchronous result delivery.
- Shared `src/ui/message.tsx`, card conversation in `src/ui/detail.tsx`, sidebar in
  `src/ui/koordinator.tsx`: show harness/model for ordinary messages and open questions.
  Working and reading bubbles remain unlabelled: prior events do not reliably identify the
  active session. Old messages with unknown identity remain unlabelled. Owner/system messages are not
  automatically stamped as agents.

### Claude usage

The backend remains independent of Codex and was **not changed**. An idle Claude SDK usage fetch
succeeded; the scratch UI also displayed real Claude session/week percentages. No Codex usage was
added. Crowded toolbar CSS was hiding usage: `src/ui/styles.css` now keeps compact percentages at
fit stage 5 and only hides usage at the smallest stage 6. This behavior is documented.

### Docs

Relevant permanent chapters were updated in `docs/design/`: agents-and-workspaces, communication,
conversation-on-the-card, data, the-canvas. `docs/plan/codex-runtime.md` contains the fix matrix,
evidence limits and remaining phase 1/Pi gates. Remove this handoff when it is no longer useful.

## Tests and evidence — distinguish passed from pending

### Latest broad run

`/tmp/obeya-codex-hardening-final-tests.log`: **435 passed, 1 failed, 436 tests, 2513 assertions**.
The only failure was `src/server/server.test.ts`, voice test:
`a session that fails again tells the owner why, not that they went unheard`.

Cause: the new reply closure read `decision.agent` when interpretation threw before assignment.
**Fixed** in `src/server/commands.ts` by using `decision?.agent` in both reply and card-log
paths. The focused set has since passed with 439 tests and 2523 assertions; typecheck and diff check
also passed. Latest focused log: `/tmp/obeya-hardening-last-tests.log`.

The broad set was these 19 files:

- `src/server/agent-processes.test.ts`, `src/server/agent-identity.test.ts`
- `src/server/codex-rpc.test.ts`, `src/server/codex-runtime.test.ts`
- `src/server/worker-runtime.test.ts`, `src/server/workers-harness.test.ts`
- `src/server/runtime.test.ts`, `src/server/settings.test.ts`, `src/server/work-retro.test.ts`
- `src/server/workers.test.ts`, `src/server/canvas.test.ts`, `src/server/db.test.ts`
- `src/server/server.test.ts`, `src/server/commands.test.ts`, `src/server/answers.test.ts`
- `src/ui/message.test.ts`, `src/ui/usage.test.ts`, `src/ui/barFit.test.ts`
- `plugin/skills/browser/lib/browser.test.ts`

Run with `bun test` and those paths; then `bun run typecheck` and `git diff --check`.
Bun here is 1.3.14. Do not claim the whole suite passes from this focused set. An earlier unrelated
`src/server/artifact-copy.test.ts` macro execution/security regression is known; it was not fixed
in this task. Earlier full-suite runs also hit timeouts under heavy concurrency.

### Additional verified checks

- Permanent permission/background regressions in `src/server/codex-runtime.test.ts`.
- Real Workers obsolete-permission serialization regression in `src/server/workers.test.ts`.
- Legacy session skill ownership regression in `src/server/canvas.test.ts`.
- New process tests: separately grouped child's heartbeat stops after app-server death, unrelated
  PID survives; awaited shutdown terminates an EOF/TERM-ignoring fake app-server.
- Identity tests verify concurrent Claude/Codex isolation and SQLite persistence of distinct reply
  and answer identities. Shared message SSR tests verify labels and unknown historical identity.
- Real native probe `/tmp/obeya-codex-background-acceptance.ts`, output
  `/tmp/obeya-codex-background-hardened.log`: completion of a build while a server remains starts a
  new inspection turn; unchanged polls do not keep emitting idle. App-server SIGKILL stopped the
  native Python server's heartbeat (74 → 74; no process remained).
  The script's `modelWoke:false` is misleading: it matches whole text inside individual streaming
  deltas. The turn and streamed response started, but the probe killed the app-server before a full
  completion report. Do not claim that a complete report was received.
- Live mixed Claude/Codex cards were blocked earlier by Claude OAuth expiry. Deterministic mixed
  isolation passed with fake runtimes and real Git workspaces. Later usage-fetch success is not a
  rerun of mixed live cards. Do not change owner credentials to force a test.

### Required second review: incomplete

The initial post-fix review hit the account limit; subsequent Codex reviews completed. They found
lost explicit identities and historical answers inheriting unrelated context; those were fixed and
regression-tested. The final focused attribution review reported no findings:
`/tmp/obeya-hardening-last-review.log`. Its read-only sandbox could not run temp-directory tests;
the focused suite was run outside it.

## UI verification and scratch resources

Screenshots were opened and visually checked:

- `/tmp/obeya-speakers-desktop-final.png`
- `/tmp/obeya-speakers-sidebar-final.png`
- `/tmp/obeya-speakers-phone-final.png` (390 × 844)
- `/tmp/obeya-speakers-compact-usage.png` (1000 px wide)

The model is visible on open questions; sidebar reply/answer can show different models. Phone
horizontal overflow checks passed. Compact Claude usage remains visible at fit 5.

**Stopped:** scratch server PID **49856**, port **4492**, with idle workers.
Home `/tmp/obeya-scratch-4492/home`, config `/tmp/obeya-scratch-4492/canvases.json`.
This scratch database was seeded with identity fixtures for visual checks; it is not proof that
those displayed messages came from live model calls. Unit tests cover actual provenance mechanics.

Stopped with `bun scripts/scratch-obeya.ts --stop 4492`; the listener and PID were absent on
verification. Earlier native probe PIDs 24040, 23111 and 46581 were also absent.
**Never test against the owner's port 4417 or `~/.obeya`.**

Browser details if needed (read `plugin/skills/browser/SKILL.md` first): existing headless CDP port
63642, browser PID 20084, owned by this Pi process PID 99849. Every browser CLI call used
`SEISMIC_AGENT_PID=99849` (the skill falls back to `OBEYA_AGENT_PID` only where that is unset) to
avoid sharing a worker's browser. That process may have ended by the time
you resume: use your own identity/new browser rather than assuming it remains valid. The visual
helper `/tmp/obeya-speakers-visual-check.mjs` attaches to that CDP port. Phone screenshots need a
settled camera/unfold (the helper waits 1200 ms); CLI calls reset viewport to its configured desktop
size. Test login URLs are in local `/tmp` files: do not copy authentication tokens into handoffs,
commits or final responses. No demo media was added to git.

## Original ordered next steps (completed except where noted)

1. Done: inspect the dirty diff; rerun the failing voice test, the 19-file focused set, typecheck and
   diff check after the `decision?.agent` fix. Fix any new regressions, updating docs if behavior
   changes. Do not turn the known unrelated macro failure into a green-suite claim.
2. Done: finish the mandatory post-fix Codex review. Paid special attention to process
   lifecycle/Windows paths, permission cancellation and one-use identity, and asynchronous identity
   propagation. Review findings may require another focused test run.
3. Existing screenshots cover the earlier attribution UI. After review, active bubble labels were
   removed to avoid showing stale identities; no new screenshot was taken after that removal.
4. Done: stop scratch 4492 and verify known test-owned process cleanup. Correct any plan wording that implies
   verification or cleanup which has not happened.
5. Give the owner an honest completion summary with remaining cross-platform/containment and live
   mixed-harness/review limitations. Present a proposed commit message and ask before committing.
   No new commit or push is authorized by the handoff request.

Remaining larger parity work and the Pi estimate are in `docs/plan/codex-runtime.md`; do not expand
this handoff into SSH/non-Git/Koordinator/Pi implementation.
