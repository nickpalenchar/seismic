# Agent permission rules for this canvas

Review draft: [`.claude/settings.json`](settings.json) contains 29 allow rules for
Claude Code sessions. Review this explanation and the file before trusting it in **Konfiguration**.
This change does not accept trust on the owner's behalf.

## What the draft is based on

The Seismic canvas history was read on 2026-10-31, through event 492. It contained 16 permission
questions, all on **“Seismic should have a prompt to re-login when it encounters login errors”**:
creating a demo directory, staging scratch instances (including `--code HEAD`), starting and
driving the browser, running Codex review, tests, copying demo files, and generating/checking
the demo. Type checking and dependency installation are also required by this repository.
The rules cover those recurring workflows plus the browser's inspection and cleanup commands.
One-off shell editing and copying are left for individual approval.

**Those 16 questions came from a Codex worker. Codex does not read this Claude settings file.**
It will continue to ask at its own sandbox and approval boundaries. These rules help Claude
workers performing the same steps; the `codex exec` entries let a Claude worker launch a review,
and do not configure a Codex worker. There is no change to Codex's policy in this draft.

## How to read the rules

Claude's [permission reference](https://code.claude.com/docs/en/permissions) defines these as
command-text patterns. No `*` means the command is exact. A trailing ` *` also matches the bare
command, so the test rule covers `bun test`, `bun test --parallel`, and selected test files.
The browser text/html rules likewise work without `--tab`.

These are workflow allowances, not filesystem or network confinement. `*` can span spaces,
slashes and extra arguments: the directory patterns do not prove that there is only one path,
that it has no `..`, or that a command has no extra options. A script-path pattern can also
match unexpected arguments before the named script. Shell operators are checked as separate
commands, so an allowed test does not by itself approve `bun test && git push`.
Different quoting, absolute script paths, environment assignments, or shell wrappers can still
prompt; no blanket shell-wrapper rule is included.

Tests, package installation and demo scripts execute code and can start subprocesses. Bun test
arguments can include loaders. Browser `input` and `eval` can perform actions on pages, and
navigation is not restricted to localhost. Trust these entries only with that scope understood.
The two Codex rules are exact so a trailing wildcard cannot add a sandbox override.

The `/Users/nick/…` paths intentionally match the commands recorded on this machine. They do
not match another user's paths or an installed plugin at another location. The relative Bun
commands are intended to run from a card's repository workspace; they are not bound to a
particular checkout by these patterns.

## Every rule and why it is here

The tables follow the JSON file's order. In the browser table, **B** is exactly
`node /Users/nick/harness/obeya/plugin/skills/browser/lib/browser.ts`.

### Setup and checks

| Allow rule | Reason and scope |
| --- | --- |
| `Bash(bun install)` | Required clone setup, with no extra install flags or named packages. Executes package lifecycle scripts. |
| `Bash(bun test *)` | Full suite, `--parallel`, and targeted tests. Allows test flags, including loaders; it is not a read-only allowance. |
| `Bash(bun run typecheck)` | Runs only the repository's named typecheck command, without extra arguments. |

### Demo directories and scratch app

| Allow rule | Reason and scope |
| --- | --- |
| `Bash(mkdir -p /Users/nick/demos/obeya-*)` | Creates this canvas's demo directories using the observed naming convention. Text pattern, not a path boundary. |
| `Bash(mkdir -p /tmp/obeya-*)` | Creates temporary staging/demo directories with the same namespace. The OS may resolve `/tmp` to `/private/tmp`; that spelling needs its own rule. |
| `Bash(bun scripts/scratch-obeya.ts /tmp/obeya-*.json)` | Stages a scratch app from the observed temporary stage-file convention. |
| `Bash(bun scripts/scratch-obeya.ts /Users/nick/demos/obeya-*/stage.json)` | Stages a fresh take from a demo's saved stage file, as the repository's demo recipe requests. |
| `Bash(bun scripts/scratch-obeya.ts /tmp/obeya-*.json --code HEAD)` | Covers the recorded before-version staging command; fixes the normal final arguments to `--code HEAD`. |
| `Bash(bun scripts/scratch-obeya.ts --stop *)` | Cleans up an instance by port. The script checks that it owns the server before stopping it. |
| `Bash(bun scripts/scratch-obeya.ts --login *)` | Prints a fresh login link for a staged instance's port. Treat the resulting link as a credential. |

Stage files and the scratch script are executable workflow inputs, not inert previews. For
example, the script can run real workers when requested. These patterns do not enforce the
recipe's choice of idle workers or prove that a URL/port belongs to the current card.

### Codex as a reviewer

| Allow rule | Reason and scope |
| --- | --- |
| `Bash(codex exec --sandbox read-only review --uncommitted)` | Reviews staged, unstaged and untracked work using an explicit read-only sandbox. Exact command, no arbitrary prompt or appended options. |
| `Bash(codex exec --sandbox read-only review --base main)` | Reviews the card's committed changes against `main` with the same fixed sandbox. |

These replace the observed free-form `codex exec --output-last-message … 'Review …'` invocation.
That original spelling still asks. Review output can be captured with shell redirection, whose
target may need separate approval. The commands use the user's existing Codex login and
configuration; read-only describes the review's sandbox, not a promise of no network or
session/cache writes. See [official OpenAI documentation](https://learn.chatgpt.com/docs/non-interactive-mode)
and `codex exec --help` / `codex exec review --help` for the installed CLI.

### Browser skill

| Allow rule (expand B as above) | Reason and scope |
| --- | --- |
| `Bash(B start)` | Starts the session's headless browser with default options. Fake microphone and window-size variants still ask. |
| `Bash(B stop)` | Closes that browser. |
| `Bash(B status)` | Inspects browser process/connection state. |
| `Bash(B tabs)` | Lists its open tabs. |
| `Bash(B open *)` | Opens a URL in a new tab; destinations are unrestricted. |
| `Bash(B nav *)` | Navigates an existing tab, optionally selected by `--tab`. |
| `Bash(B close *)` | Closes a selected tab. |
| `Bash(B text *)` | Reads visible text from the current or selected tab. |
| `Bash(B html *)` | Reads the page's full HTML. |
| `Bash(B input *)` | Trusted clicks, dragging, typing and keys; also supports page JavaScript and screenshot steps. Can submit forms and write screenshot files. |
| `Bash(B eval *)` | Runs page JavaScript for inspection and interaction. Can change page state and make network requests. |
| `Bash(B screenshot *)` | Writes a screenshot to the supplied path; output paths are unrestricted by this rule. |
| `Bash(B playwright)` | Prints the installed Playwright import and browser availability. Browser installation is a different command and still asks. |

### Demo tooling

| Allow rule | Reason and scope |
| --- | --- |
| `Bash(node /Users/nick/harness/obeya/plugin/skills/demo/lib/setup.ts)` | Checks recording prerequisites and the configured voice. Does not allow voice installation commands. |
| `Bash(node /Users/nick/demos/obeya-*/demo.ts)` | Runs a canvas demo's recording script. Grants that script's code the ability to run subprocesses, write files and use the configured voice service. |
| `Bash(node /Users/nick/demos/obeya-*/demo.ts --narration)` | Generates narration/cache for the observed demo preparation step. Hosted voice settings can incur charges. |
| `Bash(node /Users/nick/demos/obeya-*/demo.ts --dry)` | Runs the scenes for validation without recording the finished video. The demo code still runs. |

## Review and trust

1. Read the JSON and the scope above. Remove any workflow the owner does not want pre-approved.
2. After the approved change lands on the repository's main branch, open **Konfiguration** and
   review the held Claude configuration diff. Trust the displayed configuration with
   **Trust these commands** (`Diesen Befehlen vertrauen` in German). Seismic trusts the whole
   displayed Claude group, including any other files in it, not just this allow list.
3. Newly started Claude sessions then load the trusted project settings. Existing sessions may
   need to finish and start again. A later configuration change requires review again.

The file adds only `permissions.allow`: no hooks, MCP servers, environment values, permission
mode change, sandbox bypass, or trust-database writes. There is no `Bash(*)`, `Bash(bun *)`,
`Bash(node *)`, `Bash(codex exec *)`, blanket `mkdir`, arbitrary shell, or push/deploy rule.
General `cp`, `sed -i`, `--real-workers`, `--say`, `--artifact`, arbitrary before-version
commits, and demo re-voicing are not separately pre-approved. Wildcards can nevertheless match
more command text than the typical examples, as described above. Existing user/managed
settings, ask/deny rules, and sandbox checks still apply; this is not a guarantee of zero prompts.
