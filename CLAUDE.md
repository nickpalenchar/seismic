# CLAUDE.md

Seismic: a spatial canvas for directing AI coding agents. Its goal, principles, concepts, decisions
and non-obvious constraints are in `docs/design.md`; read it before a change, and the chapters it
lists under `docs/design/` that the change touches (UI work: `docs/design/ui-system.md`).

The design docs hold principles, decisions (chosen, why, rejected, date) and non-obvious constraints
(platform quirks, formats to stay compatible with, safety rules): not a description of every
behaviour, and not history. A worker who settles one of those writes it into `docs/design.md` or a
chapter in the same change; a chapter is started when an area gathers enough of them. Work in
progress is planned in plan docs under `docs/plan/` (Seismic shows them as plans); when one is done,
its lasting decisions and constraints move into the design doc and the plan doc goes.

- Bun + TypeScript throughout; tests with `bun test --parallel` (a file per process, from Bun 1.4 on;
  older Bun ignores the flag and runs them one after the other), types with `bun run typecheck`.
  When the suite fails only from machine load or timing, don't ask to rerun it: hand over and say
  which failing tests were unrelated. When it hangs or stalls, stop it and go on to the demo and
  handover without asking: say there that the tests were skipped. The test "names what stands in
  the way: site-media as the latest, a missing secret, GitHub ahead, a tag taken, a draft left over"
  in `release-status.test.ts` clones real git repositories and may time out while iterating: skip it
  locally (`--test-name-pattern` or by file), and run the full suite before handing over.
- Never wait with `sleep` or polling chains in the foreground (`sleep 25; …`, `until curl …; sleep 3`):
  a hook blocks them. Run long commands (`bun test --parallel`, `bun run typecheck`, a scratch Seismic
  start) with run_in_background or Monitor and wait for the notification; for a short wait on a port
  use one bounded `timeout 30 bash -c 'until curl -sf http://127.0.0.1:<port>/ >/dev/null; do sleep 2; done'`.
- File edits with complex content, quotes or special characters go through Read + Write, not `sed`,
  to avoid shell escaping problems.
- `src/core/` is shared by server and UI (types, plan-doc parser, layout); `src/server/` is the
  Bun server with SQLite; `src/ui/` the React canvas, with `src/ui/components/` for UI pieces shared across views (starting with toasts: one store, one component, every toast goes through it); `src/adapters/` what Seismic knows of a repository (its defaults, its settings).
- Code that drives agents is tested against the fake runtime in `src/server/testing.ts` and real
  git repositories in a temp directory (`gitRepo` there; git calls are what makes tests slow).
  Live runs go against a scratch git repository with a plan doc and a scratch `SEISMIC_HOME` (never
  `~/.obeya` of a running Seismic): `bun scripts/scratch-obeya.ts <stage.json>` stages one with its
  cards in about a second (its header describes the stage file; `--stop <port>` ends it). Its
  workers are idle; with `--real-workers` they are real agents on the machine's Claude login.
- UI checks run in a headless browser through the `browser` skill of Seismic's plugin
  (`obeya:browser`; a session without the plugin reads `plugin/skills/browser/SKILL.md`): `input`
  for trusted clicks, drags, keys held for push-to-talk; `start --fake-mic <wav>` for voice. A
  claude-in-chrome tab is often hidden, which freezes `requestAnimationFrame`: camera flights and
  the unfold never finish there. For what headless Chromium can't reproduce (on-screen keyboard,
  fullscreen, rotation), use `bun scripts/android-phone.ts`: Chrome in the Android emulator, with
  real taps (its header describes the commands).
- Reviews of the code (security, code quality and the like) always bring in Codex (`codex exec`)
  as a second reviewer.
- Voice on this machine: Parakeet through uv, the default, needs nothing set. For Whisper instead:
  `SEISMIC_WHISPER_BACKEND=mlx SEISMIC_WHISPER_PYTHON=/Users/sadilek/dev/stimmzwilling/.venv/bin/python`
  (has `mlx_whisper`; the model is cached). That Python alone, without the backend, fails: it has no
  `onnx_asr` for Parakeet.
- The Seismic that plans this repo is the stable clone's, on port 4417 with `~/.obeya`; `bun start`
  in a `-dev` checkout runs its code on `~/.obeya-dev` and port 4418, beside it. An Seismic restarts
  itself once `main` moves to commits that change code, a commit of yours included (workers resume, the page
  reloads); docs-only commits leave it running. Keep tests off it.
- UI work follows `docs/design/ui-system.md`: shadcn/ui parts and proven libraries first, React
  components, frost's own CSS only where its look needs it, and the rules every screen follows
  (keyboard paths, toggles, no accent bars, links, undo, discoverability, the phone view, polish).
- No project-specific logic in the core: what a project needs goes into its settings
  (`.obeya/settings.json` in that repository), not into this repo. Those settings stay few and
  generic: each describes something that holds for any kind of app, not one kind of web stack, and
  no two cover the same need; where two overlap, merge them.
- The extension design (`docs/plan/extensions.md`) is best effort: not every feature fits it
  cleanly, and the core may be extended where needed. A worker promoting a feature into an
  extension should expect other features to have seeped into the code it moves, and edits those
  itself.
- The owner works in Seismic at the level of requirements, feature and bug descriptions and specs,
  and checks results in demos and result artifacts. Source code and diffs stay in the background:
  on a card with a demo or artifact, its changed files are optional and stay in their own Diff tab,
  never shown up front.
- UI strings live in one place, `src/ui/strings.ts`, in English (German support was removed on
  2026-11-07 until language support returns; the table per language keeps its shape).
  Docs, comments and prompts are in English and quote the English labels.
- Prompts and skills for agents: fix unwanted behaviour by removing the instruction that causes
  it, not by adding a prohibition. Forbid nothing an agent would not do without being told to.
- The colleagues use Windows or Linux: features must work there; macOS-only tools (e.g. `say`)
  only as an additional option.
- Demo videos and voice recordings never go into git.
- A demo video shows the entire feature from start to finish, not only what changed since the last demo.
- Before a demo video goes to the owner, watch it for faults of the demo itself and fix them first:
  every dictated text it shows is transcribed completely and correctly (no missing words or
  numbers, no misrecognitions), and what the agents in it say points out no fault (a comment cut
  off, input missing).
- Videos on the site (the hero video, anything for obeya.si) are narrated in the owner's ElevenLabs
  voice clone (voice ID `IErGHDQU4vPqicCi8dwR`), not the voice of the demo settings; demo videos
  published elsewhere (in a PR or issue comment, say) keep the voice of the demo settings. Its API
  key is in `.voice/elevenlabs.key` of the main checkout (`/Users/sadilek/dev/obeya`, gitignored);
  render with an `SEISMIC_HOME` whose `demo.json` names both (`voice: elevenlabs`, `voiceName`,
  `keyFile`), as `scripts/hero-video/render.ts` sets up for the hero video (its README says how to
  change and re-render it). Credits are limited: only for the site's videos, never as Seismic's own
  demo voice, and even there only once: a video for the site is iterated in local renders in the
  owner's Qwen3 voice, and the ElevenLabs render happens after the owner has approved the video.
  Qwen3-TTS references of the owner's voice lie beside the key, each with its transcript (`.txt`):
  `.voice/qwen-reference-de.wav` (a recording) and `qwen-reference-en.wav` (cut from the ElevenLabs
  voice); the demo settings' `reference` names the one of the narration language. Qwen3 is good
  enough for demos, ElevenLabs marginally better for the site, so the site stays with ElevenLabs
  (owner, 2026-10-12); `scripts/hero-video/qwen.py` renders the hero narration in Qwen3 to compare.
- Every release also brings the README's text up to date: like the site, it names what the release
  adds that a newcomer should know (phone remote control, say).
- A release contains everything on `main` at the moment it is tagged: right before tagging, rebase
  onto the current `main` (moving the tag if it is already set), so commits that landed while the
  release was being prepared go into it too.
- gh calls against this repository's GitHub repository go through `bun scripts/gh.ts <gh args…>`:
  it runs gh on the checkout's origin as the account that owns it (`sadilek` for sadilek/obeya),
  since the machine's active gh account may be another without admin rights.
- A recurring step that needs a longer CLI call (an upload, say) goes into a script in the repo,
  not into the docs as a command to copy.
- Commit directly to `main`; this repo uses no feature branches or pull requests. An Seismic worker
  is the exception: it commits on its card's branch, and Seismic lands that branch on `main`.
- When a task handles a GitHub issue, its worker closes the issue once the work has landed, with a
  comment linking the demo video and the commit on `main`.
- Once the owner approves the demo of an external contributor's pull request: comment on the PR
  with the demo link, squash-merge it, then `git pull` on `main` so the local checkout is current.
- Pull requests Seismic opens in other people's repositories carry no Seismic attribution: no
  `Co-authored-by` Seismic, no mention of Seismic in the PR text. They may link the demo page, and the
  page itself may say "created with Seismic" at the bottom.
