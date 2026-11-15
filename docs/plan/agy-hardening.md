# Antigravity preview hardening

This plan tracks what the Antigravity (`agy`) worker preview leaves out, at the level Codex has.

## Goal

Bring `agy` workers to the Codex level of crash recovery, process cleanup and transcript reading.

## Workstreams

- [ ] **W1:** Process cleanup and crash recovery. Observe the processes an `agy` session starts (as
  `codexRpc.ts` does for Codex) and record them in the session registry, so that a crashed Seismic's
  sweep ends them. Check what `--sandbox` does with background commands and how `agy` ends them.
- [x] **W2:** Transcript reading. `agy` keeps a conversation as a SQLite database,
  `~/.gemini/antigravity-cli/conversations/<conversation id>.db` (the id after `agy:`), in WAL mode
  while it runs. Its `steps` table holds one protobuf message per row, undocumented, read by field
  number in `transcript.ts` (`agyRun`): step type 15 is the model's turn (words in field 20.1), 132 a
  tool call (call in 5.4, result text in 140.2.1), with `status` 6 for canceled and 7 for failed
  (reason in `error_details`). `run_command` reads as Bash, `read_file`/`write_file`/`edit_file` as
  Read/Write/Edit, `call_mcp_tool` as `mcp__<server>__<tool>`. A sandboxed process cannot always
  open a WAL database read-only (it cannot make the shared memory file), so the reader then copies
  the database with its `-wal` to a temp directory and reads the copy; `?immutable=1` would ignore
  the log and lose the latest steps. The conversation id pattern is one, `AGY_CONVERSATION_ID`,
  shared by resuming and lookup.
- [x] **W3:** Usage limits. Record what `agy` actually reports when a Google account's quota is used up
  (the preview recognises it from the error text) and read the reset time from it.
- [ ] **W4:** Background commands. Show the agent's background tasks on the card and wake the
  session when one ends, as for Codex.

## W3 evidence — account quota

Inspected the installed CLI's existing logs on 2026-11-14, without spending the account's
remaining quota. `~/.gemini/antigravity-cli/log/cli-20261107_110332.log`, line 130,
records at local time `11:03:35.868688` on November 7:

```text
agent executor error: generating and executing: RESOURCE_EXHAUSTED (code 429): Individual quota reached. Please upgrade your subscription to increase your limits. Resets in 152h12m37s.
```

Line 131 repeats the same failure without the `agent executor error:` prefix. Another log,
`cli-20261107_181023.log`, reports `Resets in 145h5m46s.`. These are actual account failures,
not the preview's invented `Quota exceeded. Retry in 30s.` example. Only the error text is
retained in `src/server/fixtures/agy-quota.txt`; no account identifiers or conversation content
are copied. This capture establishes the error wording, not a live stream-json envelope.

The reset is a relative, compound hours/minutes/seconds duration; hours can exceed 24. Seismic
adds the entire duration to receipt time and passes it to the existing usage-limit wait path.
An error without a readable time keeps the existing unknown-reset behaviour.
