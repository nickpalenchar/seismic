---
name: release
description: Take a version of Seismic's desktop app out from start to finish, with its section in CHANGELOG.md, the tag, the build and the draft release the owner publishes. Use when the owner says "make a release", "release a new version", or names this skill.
---

# Release

The steps, their commands and the facts behind them are in `docs/release.md` § "A release". Read
it first and go through its steps in its order. This skill adds where the owner comes in and what
to judge on the way.

A release candidate (`v<version>-rc.<n>`) is not this skill's: it goes as `docs/release.md` §
"Release candidates" says.

The owner approves once, on the changelog's section, before anything leaves the machine. After
that the agent pushes, tags and watches the build. Publishing the release (step 7) reaches every
installed app through the updater, so that click is the owner's.

## On a Seismic card

### Before the handover: steps 1–3

**Step 1, where things stand.** Of what the status script puts in the way, GitHub's `main` lagging
is what step 4 fixes, and the missing changelog section is what step 2 writes. Everything else is
the owner's call (`ask`, with what you would do): distribution switched off, a missing secret,
GitHub's `main` with commits of its own, a tag already taken, a draft left over. Take the version
it proposes.

**Step 2, the changelog.** Read the output of `bun scripts/release.ts commits` as a user of the
app would: which demos show something they will notice, and what each is about (a demo page's
title says it in a few words; `curl -sL <url>` shows it). Write the section as
`docs/release.md` says, in English, short: a demo behind several commits is one entry, internal
work (tests, scripts, refactors) stays out of it, and a link that no longer opens (`curl -sL -o
/dev/null -w '%{http_code}' <url>`) is not used. The date in its heading is the day you tag; set
it again in step 5 if that day has passed.

**Step 3, the handover.** Commit the version and the changelog, run the checks, and hand over with
`ready_for_review`. The demo is an HTML artifact: the section as it renders, and the release notes
as the run will make them (`bun scripts/release.ts notes v<version> nickpalenchar/seismic
<file>`, which needs the tag: make it in a scratch clone of your workstation, never in it). The
summary holds the version, the secrets still missing, and what follows the approval: push, tag,
build, draft, and the owner publishing.

### After the landing: steps 4–7

Landing the version restarts Seismic. Call `after_restart` and end the turn; go on once Seismic says
it runs your change.

**Steps 4 and 5.** Your workstation stands at what landed: tag its `HEAD`, after checking that its
`package.json` has the version and `bun scripts/release.ts check v<version>` passes. Push `main`
first, then the tag.

**Step 6, the build.** Watch the run in the background and end the turn. When it fails, read the
failed steps (`bun scripts/gh.ts run view <id> --log-failed`); a job that failed on something
flaky runs again with `bun scripts/gh.ts run rerun <id> --failed`. An HTTP 403 from Apple
needs the owner's acceptance of Apple's agreement: `ask`. A fault in the code goes to
`propose_card`; the release waits for it. Once the draft check passes, read the notes as a user
of the app will.

**Step 7, the owner publishes.** `ask` with the link to the draft
(`https://github.com/nickpalenchar/seismic/releases`), a line on the notes, and the options
"Published" and "Not now". After "Published", run the status script again: the new version is
the latest release, and `https://github.com/nickpalenchar/seismic/releases/latest/download/latest.json`
names it. Then end.

## In a terminal

The same steps, with the owner in the chat instead of on a card. The version commit goes onto
`main` directly. Instead of the handover, show the owner the section and go on to step 4 when they
say so.
