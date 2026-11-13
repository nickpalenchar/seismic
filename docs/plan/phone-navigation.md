# Phone view: new navigation and a working-agents section

## Goal

Replace the phone view's four tabs with a layout built for one project at a time: a slim top bar, a collapsible "N working" box, the project's cards in sections, and a floating bottom bar with five entries (Menu, Chat, New card, Search, Needs you). The new view is built as its own component next to today's `src/ui/phone.tsx`, which stays reachable for comparison for a while and is then removed.

## Shape

**Project in view.** The view shows one project, the one named in the top bar. The last project picked is remembered per browser (the first project until one is picked). The working box, the sections, the chat (it no longer has a project picker), new cards and search all belong to that project. Only Needs you spans every project. Opening a card from another project (from Needs you or a push) switches the top bar to that project, so Back lands on that project's list.

**Top bar.** The Seismic sign opens the menu. Next to it the project name with a chevron opens the project switcher (also reachable from the menu). On the right the usage pills scroll sideways and slide under the project name with a fade.

**Working box.** "● ● ○ ○ 4 working": the dots are the workstation marks of the desktop's status bar, and the word "workstations" never appears. A chevron folds and unfolds the box; the state is remembered per browser. Unfolded, it lists the cards agents are on (working, code reviewing, review fixing, landing) with the rows of the status bar's workstation popover; a tap opens the card.

**Card sections.** Queued (grey badge), then Planned, then Parked and Done, folded, at the end. A section without cards is left out. Each shows 20 cards, then "Load more". Cards use `CardFace`, as wide as the screen. Needs-you cards are not repeated here.

**Floating bar.** A glass pill, the + slightly larger.

- Menu: the desktop's left menu as a full-height sheet over everything, the floating bar included.
- Chat: the project's Seismic conversation as a full-screen page with its chat history; it replaces the draggable panel for Seismic's chat and keeps the microphone.
- New card: as today's +, in the project in view. The new card opens full screen, the bar hides, X returns to the list.
- Search: a full-screen search over the project's cards, the phone's version of the desktop's `/`.
- Needs you: what waits across all projects, each entry naming its project, with the inbox's quick replies. The bell carries the count across all projects.

**Open card.** Below the top bar, which stays, with an X in it in place of the usage pills (Back still works), no floating bar, the microphone as today. Its conversation stays the panel it is today; it may become a full page later, once the chat page exists.

**Decisions (owner, 2026-11-12).** Push-to-talk lives only in the chat page and on an open card; the list and the floating bar have no microphone. Parked and Done become folded sections at the end of the list; the queue's drag-to-reorder and the Activity log are not carried over and stay on the desktop (read from the owner's answer; they say so if either should stay). The view shows one project at a time; Needs you still covers every project.

**Old and new side by side.** The new view first lives under `?view=phone-next`. Once it covers what the old one does, it becomes the default `?view=phone` and the old one moves to `?view=phone-old`; one later commit removes it. Before the new view is written, the hard-won shared behaviour moves out of `phone.tsx` into modules both views use, so no fix that took many iterations is lost.

**Reused parts.** The desktop menu (`nav.tsx`, shadcn Sidebar), the workstation rows of `WorkstationsPill` (`parts.tsx`), `CardSearch`/`finderResults` with the shadcn `Command` part, `InboxList`/`NeedsYouSheet`, `KoordinatorTalk` with `ChatsHead`, `UsagePill`, `Sheet`, `CardFace`.

**Risks.** Losing phone-specific fixes in the rewrite (hence W1 first); the menu sheet pulling in desktop-only entries that need trimming for the phone. This plan touches the same phone view as W6 of [several canvases](multi-canvas.md) (one list, cards marked with their canvas's icon): whichever lands second adapts to the other.

## Workstreams

- [x] **W1:** Move shared behaviour out of `phone.tsx`. Keyboard detection, the "first tap acts" handling, one WebSocket per project, the connection banner, the push-notification prompt, the landscape strip, video full screen and swipe-away toasts move into modules both views use. No visible change; the existing phone checks still pass.
- [x] **W2:** The new shell under `?view=phone-next`. Top bar with project switcher (remembered per browser) and scrolling usage pills; the working box with its rows taken out of `WorkstationsPill` into a shared part; the sections with "Load more"; the floating bar (Menu, Chat, Search and Needs you may still be inert); an open card with X; New card works here. Lands after W1.
- [ ] **W3:** Menu sheet and Needs you page. The menu as a full-height sheet with the desktop menu's content trimmed for the phone (including the project switcher), and the Needs you page across projects with project names, quick replies and the bell count; opening a card from another project switches the top bar's project. Lands after W2, can run beside W4.
- [x] **W4:** Chat page and search page. The full-screen Seismic chat with chat history and microphone for the project in view, replacing the draggable panel for Seismic's chat; the full-screen search over the project's cards. Lands after W2, can run beside W3.
- [ ] **W5:** Switch the default. `?view=phone` shows the new view, the old one stays at `?view=phone-old`; rewrite "The phone view" in `docs/design/running-obeya.md` to describe the new view, and check the README and the phone screenshots of the release. Lands after W3 and W4.
- [ ] **W6:** Remove the old view. Delete `phone.tsx`, `?view=phone-old` and what only it used, once the owner has compared them. Delete this plan doc; what passes the rebuild test is already in the design chapter.

## Shared phone behaviour (W1)

Both shells mount `usePhoneEnvironment` (`phoneEnvironment.ts`) and `usePhoneProjects`
(`phoneProjects.tsx`), rendering its `feeds` once across list/card navigation and its `banner`
where needed. The environment module exports the shared view, page and bar classes; preserve
`ph-view`, `ph-panel` and the sibling microphone/toast structure for keyboard and landscape CSS.
`usePhonePush` (`phonePush.ts`) routes notification taps through shell callbacks. Reuse `Notify`
for the permission prompt, `Composer` for first-tap focus handling, `Demo`/`useFullscreen` for
video, and `Toasts` with `aside` for swipe dismissal; those already live outside either shell.

`phoneTalkPanel.tsx` exports `TalkPanel` and its conversation/title classes for both card and
Seismic conversations. It owns the keyboard/landscape panel layout, drag/glide/close handling,
late composer focus, and `--ph-field`/`--ph-panel` measurement and cleanup. Open-card shells use
`usePhoneCardPanel` with their page ref for the initial half panel and video scroll adjustment.

## The new shell (W2)

`phoneShell.tsx` holds the controller both views run (`usePhoneShell`): the project feeds, what is
open as history steps, edits of the open card, a new card, push-to-talk, confirmations, and the
open card full screen (`cardScreen(header, above)`: the old view passes its Back bar, the new one
its top bar, which stays over the card with an X in place of the usage pills, the card starting
right below it). `follow: true` (the new view) makes the project of an opened card the one in view
and writes the project in view into the address, so a reload stays on it; the project in view is
remembered under the key the old view used for its Seismic conversation. `phoneNext.tsx` is the
new view under `?view=phone-next`; its Menu (the sign and the bar's first button) and Needs you buttons are still disabled for W3, the
bell already counts across projects. The
working box's rows are `WorkingRows`/`WorkstationRow` in `workstations.tsx`, the status bar's pill
uses the same parts. A section's "Load more" count starts again at 20 when the project changes;
folded sections and the box's fold are remembered per browser.

## Chat and search pages (W4)

Chat is the shell's conversation step (`?talk`, a step in the browser's history) shown as a page:
`TalkPanel` with `page`, always full height with no grip to drag, its head `ChatsHead` with an X
(the chats drawer and the keyboard/landscape layout are the panel's), and the microphone under it.
The floating bar's Chat button carries the project's unread answers and the moving line of Seismic
at work, as the old view's talk button. Search is `phoneSearch.tsx`: a field over the project's
cards matched as the desktop's finder does (`finderResults`), twenty at a time with "Load more", a
card per tap; it is a history step of its own (`history.state.search`), so Back from a card found
there lands on the results with the query kept. Both pages hide the floating bar.
