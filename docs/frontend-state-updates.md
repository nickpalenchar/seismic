# How the frontend writes state: assessment

Assessment of 2026-11-21. Lots of UI elements take a long time to show the result of an action;
this lists how the frontend sends state changes to the server and how the result comes back. It
records findings only, no proposed changes.

## The core loop

1. **Writes go out over REST.** Every call goes through `call()` in `src/ui/api.ts`. Most card and
   canvas writes return `void` (`patch`, `remove`, `archive`, `act`, `assign`, `dependency`,
   `moveToCanvas`), so the client learns nothing from the response.
2. **Reads come back as a full snapshot over the WebSocket.** Nearly every board method ends in
   `this.changed()`; there are about 100 call sites in `src/server/board.ts`. `changed()`
   (`board.ts:642`) clears every cache, including the per-card `worked` cache. The `onChange`
   listener (`src/server/server.ts:263`) then rebuilds `snapshot()` (`board.ts:2187`) and sends the
   whole project to every socket on it.
3. **The UI replaces everything.** `useProject` (`src/ui/api.ts:659`) calls
   `setSnapshot(msg.snapshot)`, and the whole `Project` tree in `App.tsx` (3110 lines) re-derives
   from it.

The time a button takes to show its result is therefore: HTTP round trip, plus the server finishing
the action, plus a full snapshot rebuild and serialisation, plus the WS push, plus a full
`JSON.parse`, plus a full React re-render.

## All the ways the UI changes state

| # | Pattern | Where | How the UI learns the result |
|---|---|---|---|
| A | REST that returns nothing, then wait for the push | card, canvas, group and dependency writes; most of `api.*` used in `App.tsx`, `detail.tsx`, `parts.tsx`, `canvases.tsx` | the next full snapshot |
| B | REST whose response is the new view, then local `setState` | settings screens: `config.tsx` (`setView(await api.saveTheme(...))`), access, voice, demo sites | the response body; the snapshot isn't involved |
| C | REST, then a forced full re-read | `api.act` for `message`, `answer` and `release now` calls `refreshCard`, which does `GET /project` for the whole project (`api.ts:333`, `api.ts:492`, `api.ts:700`) | a second full snapshot over HTTP, raced against the WS push with a `snapshotVersion` counter |
| D | Voice/text command, held for undo on the server | `api.command` → Koordinator; results come back as a `notice` with a `token`/`undoMs` (`src/server/commands.ts:499`) | a notice, then a snapshot once the delay runs out |
| E | Polling | `config.tsx:1445, 1764, 2168, 2397, 3145`, `access.tsx:42`, `setup.tsx:442/556/927`, `folder.tsx:33`, `diff.tsx:92` (every 1–2.5 s) | each poll's response |
| F | Client-to-server state over the WS instead of REST | `hold`, `focus`, `here`/`away`/`back` (`api.ts` ~545–600) | none (fire and forget) |
| G | Ad-hoc event buses between components | `agentSettingsEvents`, `eventListeners`, `goneListeners`, `reconnectListeners`, `cardRefreshListeners`, notice listeners, all in `api.ts` | an in-page broadcast, used to make components re-fetch their own copy |

## Competing ways to show a change before the server confirms it

Each of these was built separately; none is shared:

- **Local overlays in `App.tsx:321–327`:** `moved` (positions), `folded` (plan collapse),
  `pending` (new cards), `underway` (approved cards). Each is cleared on the next snapshot by a
  hand-written value comparison.
- **Delayed removal on the client:** dependency removals are held in `removing` and
  `pendingRemovals` with a timer and a `pagehide` flush (`App.tsx:1631`). This is a second undo
  mechanism alongside the server-side command token (D).
- **Undo by inverse request:** `archive`→`unarchive`, `pushMain`→`keepMain`. This is a third undo
  mechanism.
- **Optimistic chat bubble:** `Composer optimistic` plus `pendingChat.ts`.
- **`soon()` (`App.tsx:268`):** polls the snapshot or DOM every 100 ms for up to 3 s, waiting for a
  change to arrive (used at `App.tsx:750, 879, 1130`).
- **No optimism at all:** everything else, including card patches (title/text edits), archive,
  group assign, canvas moves, start/stop/pause and most `act` actions. These are the interactions
  that feel slow, because they wait for the whole loop above.

## Code smells

1. **Writes don't return what they changed.** Because the response carries no state, the only
   source of truth is the next full snapshot. That forces the overlays, `soon()` and `refreshCard`.
2. **Every change costs the same as the most expensive one.**
   - `changed()` throws away all per-card work, so a one-field patch rebuilds every card, plus
     talk, chats, clone pools, plan dirs and setting proposals.
   - Changes are only merged within one microtask (`tell()`), so changes spread over a few ticks
     each send their own snapshot.
3. **The payload is the whole project and keeps growing.** The page-stall log
   (`~/.seismic/stalls.log`) shows snapshots growing from 81 KB to 351 KB, often two in a row, plus
   a `waiting` message of 11–70 KB.
   - `waiting` goes to every socket on every project (`everyone(waitingMessage())`), so a page on
     project B receives it when project A changes.
   - The phone view keeps one socket per project, so it receives every project's snapshots.
4. **No reuse of unchanged cards on the client.**
   - `JSON.parse` creates a new object for every card on each snapshot.
   - `CardView`'s memo compares `a.item === b.item` (`parts.tsx:322`), which never matches, so
     every card re-renders on every snapshot.
   - The same goes for `PlanView` and everything `App.tsx` derives.
5. **The overlays can get stuck.** For example, `moved` is only cleared when the server's `x`/`y`
   exactly equal the local ones. If the server ever adjusts a value (snapping, rounding), the
   overlay stays and hides the server's state.
6. **Two read paths race each other.** A WS push and the `GET /project` from `refreshCard` can
   arrive in either order; `snapshotVersion` exists only to pick a winner. `refreshCard` only
   exists because pushes can be missed during a reconnect.
7. **Three ways to address a project.**
   - The module-global `projectId` with `at()`, `cardAt()` going through the `projectOfCard` map,
     and explicit `/api/c/${project}` strings.
   - The `projectOfCard` map was added after calls went to the wrong project when the view switched.
   - Several calls accept an optional `project` argument and otherwise fall back to the global one.
8. **`api.ts` does too much.** It holds transport, the WS lifecycle, ping/freeze detection,
   reconnect, six ad-hoc listener sets, focus/hold reporting and downloads.
   - There is no client data layer: each settings component fetches and keeps its own copy.
   - Project settings are fetched separately by `koordinator.tsx` and the settings sheet, which an
     `EventTarget` keeps in step.
9. **The HTTP response waits for the action's work.** The route wrapper `on()` (`server.ts:350`)
   awaits whatever `press()` returns (`src/server/project.ts:1777`), such as `koordinator.request`
   or `workers.message`. Any slow action there delays its button's spinner. Not yet measured which
   actions are slow.
10. **A blocked server event loop delays every request and push.**
    - The server-stall log has 463 entries of at least 0.5 s.
    - Recent ones (Nov 17–21) are mostly file-watcher `close` (`repo.ts:204`), up to 9.8 s, plus
      SQLite reads inside `items()`/`cards.get`.
    - The largest group overall is 278 stalls in `renameSync` in the session registry
      (`src/server/llms/harnesses/sessionRegistry.ts`). None of those show up in the recent entries.
11. **None of this is written down.** `docs/design.md` and its chapters record no decision on the
    snapshot-push model, so nothing says whether "always push the whole project" was deliberate.

## First flow moved: "Share on approval" (2026-11-21)

The switch now sends `PATCH /api/v1/cards/:cardId/share` and gets the card back
(`src/server/routes/v1/cards/_cardId/share.ts`, `src/ui/clients/seismic.ts`). The URL names no
project: the server finds it from the card, which removes smell 7's wrong-project risk for this call. It shows the new value
the moment it is clicked, disabled with a spinner until the server answers.

Measured on scratch Seismics:

- **One card:** the PATCH answered in 14 ms, and the WS snapshot arrived in the same millisecond.
- **600 cards, 407 KB snapshot (your real one is 351 KB):** across five toggles the PATCH answered
  in 37–44 ms, and the snapshot arrived about 1 ms after the response each time.
- **Where the server's time goes, in process on 600 cards:**
  - the write: 0.6 ms
  - the route's `board.item()`, which rebuilds every card because the write cleared the cache: 7.4 ms
  - the rest of the snapshot: 10.6 ms

So the returned card arrives first, but only by a millisecond: the response waits on the same work
as the push. Two reasons:

- `Board.tell()` builds and sends the snapshot in a microtask, which runs before Bun writes the
  response.
- Reading a single card back rebuilds all of them.

What the owner sees as instant is the switch's own pending state. The returned card only saves time
once the response no longer waits on the snapshot build.

**After deferring `Board.tell()` to `setImmediate`** (the decision is in `docs/design.md`), on the
same 600-card project:

| From the click | What happens |
|---|---|
| 12 ms | The switch shows the new value (its pending state) |
| 8–12 ms (curl, no page) | The server answers the PATCH; that is only the route's `board.item()` rebuild |
| 60 ms | The response reaches the page |
| 60–307 ms | One long frame: React re-renders the page for the returned card (210 ms of script) |
| ~310 ms | The snapshot arrives, and the page re-renders all over again (142 ms) |

The server no longer holds the answer. The bottleneck is now on the page: smell 4, where every card
re-renders on every snapshot. It now costs about 200 ms for one changed card, and is paid twice:
once for the returned card, once for the snapshot that follows.

(The timings above are from the development build. Its React is several times slower than the
production one, which the owner's Seismic runs: there the same toggle settled in ~93 ms, with long
frames of ~80 and ~52 ms.)

## Unchanged cards are no longer drawn again (2026-11-21)

Counting the fibers React rendered per commit, on the same 600-card project, found what each
update redrew:

| What re-rendered | Why |
|---|---|
| Every `CardView` | each card was a new object after `JSON.parse`; `startCard` changed with `items` |
| Every entry of Agent work (600 `AgentEntry`) | the docked sheet stays mounted while closed (`forceMount`), and its entries had no memo; `onOpen` and `underway` were new functions on every render |
| The connection dots of every card (2,400 Tooltips) | inline JSX in `App.tsx`, outside any memo |
| The whole page once more, right after a snapshot | the `waiting` and `projects` messages replace their state even when nothing in them changed |

What changed:

- `withUnchanged` (`src/ui/api.ts`) keeps a new snapshot's unchanged cards and parts as the objects
  the page already holds. A snapshot that changes nothing is the previous object, which React does
  not render at all.
- `usage`, `waiting` and `projects` keep their state when the message brings the same content.
- `AgentEntry` is memoized. App passes stable `openFreshCard` and `isUnderway` callbacks, and
  `startCard` reads the cards through `itemsRef`.
- The dots are `CardHandles` (`src/ui/parts.tsx`), memoized and given only values.

Result (production build, five toggles):

| | Before | After |
|---|---|---|
| Switch settled after the click | 87–105 ms | 42–57 ms |
| Long frames (over 50 ms) per toggle | 2 (~78 ms, ~53 ms) | none |
| Fibers rendered by the response's commit (dev build) | ~35,000 | ~1,400 |

The snapshot after the response no longer renders anything: it brings the same card. The `waiting`
message still renders the page once, because the card toggled here is in it (it needs the owner).

## Card edits moved (2026-11-21)

A card's changes (title and text as typed, its place after a drag, labels, a plan's fold, the
undo of "Arrange") go through `PATCH /api/v1/cards/:cardId` (`src/server/routes/v1/cards/_cardId.ts`)
and `patchCard` in `src/ui/clients/seismic.ts`, which answers with the card. `api.patch` and the old
`PATCH /api/c/:project/cards/:id` are gone; that URL keeps its `DELETE` until it moves.

Typing is not disturbed by the card coming back: the title and text fields keep a draft of their
own, which the card they get does not overwrite (`ManualTitle` in `src/ui/detail.tsx`). Checked live
on the 600-card project: typing on through two saves kept every character, and the server held them.

## Open questions

- Which of smells 2–4 and 9–10 costs the most time in a slow interaction (a card patch or archive)?
  Answering it needs timings for the HTTP response, the snapshot rebuild, the payload size and the
  React commit, taken on the live API (owner key) or a scratch Seismic with a large stage.
- Which buttons are hit by server stalls? The stall log can be broken down by action.
