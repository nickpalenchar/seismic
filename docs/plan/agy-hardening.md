# Antigravity preview hardening

The Antigravity (`agy`) worker preview is described in `docs/design/agents-and-workspaces.md`
(Antigravity workers). This plan tracks what the preview leaves out, at the level Codex has.

## Goal

Bring `agy` workers to the Codex level of crash recovery, process cleanup and transcript reading.

## Workstreams

- [ ] **W1:** Process cleanup and crash recovery. Observe the processes an `agy` session starts (as
  `codex-rpc.ts` does for Codex) and record them in the session registry, so that a crashed Seismic's
  sweep ends them. Check what `--sandbox` does with background commands and how `agy` ends them.
- [ ] **W2:** Transcript reading. Find where `agy` keeps a conversation on disk
  (`~/.gemini/antigravity-cli`) and read it in `transcript.ts`, so the work retrospective covers `agy` sessions.
- [ ] **W3:** Usage limits. Record what `agy` actually reports when a Google account's quota is used up
  (the preview recognises it from the error text) and read the reset time from it.
- [ ] **W4:** Background commands. Show the agent's background tasks on the card and wake the
  session when one ends, as for Codex.
