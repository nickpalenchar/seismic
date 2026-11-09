# A new UI menu

## Goal

Rearrange Seismic's chrome around the owner's wireframes: a dockable left menu, a slimmer top bar
with a search field in the middle, a second row of floating buttons under it, a right dock that
loads registered views (Chat, Agent work, Needs you, Project settings, plans and plan docs), and a
view switcher at the bottom centre where the microphone is today. Most of it regroups what exists
(the pinnable project picker grows into the left menu; the sheets become the right dock); what is
new is a registry for dock views, a shared mechanism for full-page views in the main area, the
"Needs you" view, and the switcher.

## Today

Described in [The canvas](../design/the-canvas.md): "The bar", "The logo's menu", "The navigation"
and "Sheets".

- **Bar, left:** the logo with a chevron opens the logo's menu (Agent performance, Feedback log,
  Preferences, Configuration, Controls, Report a wish); then the project picker, the archive's
  button and "New task".
- **Bar, right:** search (`/`), the gear (project settings sheet), the robot (Agents sheet), the
  inbox, Seismic's speech bubble (its sheet).
- **Left:** the project picker can be pinned as a sidebar; pinned, its button leaves the bar and
  the project's name heads it; a narrow window folds it back; in the Mac app the traffic lights
  move into its head.
- **Right:** sheets dock one at a time (Seismic, a plan, a plan doc, the inbox, the agents, the
  project settings) with one width, a grip, ✕ and Esc, each wired by hand in `App.tsx`; there is
  no registry.
- **Agents sheet:** Queue (drag order) | All (stage groups, "Needs you" first, stage chips) |
  Parked | Activity.
- **Inbox:** a right sheet with Unread | All, "All projects", one-click replies, Seismic's answers,
  rule and setting proposals, and "Go to card" opening the card beside the list.
- **Archive:** a drop-down from the bar, plus a full-screen view of the main area that stays under
  an unfolded card.
- **Bottom:** the microphone at the centre (Space held is push-to-talk already; the button is its
  visible face), the image button, the canvas tab strip at the bottom right, the status bar.

## Shape

**Top bar.** ☰ and the logo first; a click toggles the left menu. A search field in the centre
(the same finder and results as today; `/` still focuses it). On the right Seismic's chat icon (its
sheet, as today's speech bubble) and an avatar placeholder with no menu yet (Seismic has no user
accounts). The archive's button, "New task" and the inbox's button leave the bar. The bar's fitting
to a narrow window is redone for the new contents.

**Floating row under the bar.** Left: the project switcher, hidden while the left menu is docked
(the menu switches projects then). Right, in this order: "+ Create" (from
[Several canvases per project](multi-canvas.md) W6, wherever that has landed by then), the cog
(project settings in the dock), then one button group of 🤖 Agent work (its grey queue count) and
🛎 "Needs you" with its count. The "Needs you" label shows until the button has been clicked once,
then collapses to the bell and the count: that label is the first-use hint.

**Left menu.** Today's pinnable navigation and the logo's menu merge into one menu. On a medium
window it floats as a drop-down with a pin, as the picker does now; pinned it docks full height,
and the same fold-back rule and Mac traffic-light behaviour hold. Contents, top to bottom:

- **Inbox**, with its unread count in orange; opens the inbox view.
- **Configure agents ›**, sliding to a sub-page with a back arrow: Agents, Rules and Code review
  rules (each greyed out, "Coming soon"), and Performance (the dashboard and the feedback log).
- **Projects:** the open project bold and expanded, with its canvases by name, then Queue, Parked,
  Archived and "Project settings ›"; every other project one line with its waiting count in orange
  and its pause, as in today's picker; "New project" at the end.
- **⚙ Settings:** the Configuration dialog; Preferences and the two help entries ("Controls: mouse
  and keys", "Report a wish or a bug") move under it.

**Right dock as a registry.** Each dock view registers its id, title, icon and component; the
shell owns width, grip, ✕, Esc, one at a time, the canvas making room, and dimming beside an open
card. Chat, Agent work, Needs you, Project settings, a plan and a plan doc become registered views.
The plan doc keeps its own remembered width. The inbox is no longer a dock view.

**Needs you (dock view).** The cards waiting on the owner, current project first; other projects
follow as collapsed headers with a count badge. A switch "Hide other projects" is remembered per
browser. Each card shows the shared card face at size S with the inbox's one-click replies and "Go
to card". The 🛎 count is cards only; the inbox's count, which also covers Seismic's answers and
proposals, stays on the menu's Inbox entry.

**Agent work (slimmed).** Two groups and a second tab:

- "Working": working, code reviewing, review fixing and landing, with a plain count.
- "Todo": queued (grey badge, keeping drag to reorder), then planned, with the total as a plain count.
- "Activity" stays as a second tab. Parked moves out to the Parked view; the stage chips and "All"'s
  "Needs you" group go (Needs you has its own dock view).

**Full-page views in the main area.** One mechanism: a view fills the main area between the docks,
under the bar and floating row; a card unfolds over it and the view returns when it folds back;
Esc (with no card open) or the switcher leaves it. Views:

- Canvas (today's).
- Inbox, from the menu. It keeps everything today's inbox sheet has: Unread | All, "All projects",
  one-click replies, Seismic's answers, rule and setting proposals, read and unread. "Go to card"
  unfolds the card over the view; the open card's entry keeps its ring so the owner works down the
  list.
- Parked: today's Parked tab as a full-page list.
- Archived: today's full-screen archive, from the menu (the bar's drop-down goes).
- Queue, from the menu: built if cheap on the same mechanism, otherwise "Coming soon".
- Table: new, not built in this plan; shown greyed out with "Coming soon".

**Bottom-centre switcher.** A small rounded group **Canvas | Parked | Table** replaces the
microphone and image buttons; Table is greyed out with a "Coming soon" tooltip. Switching keeps the
canvas's camera, and an open card stays open over any view. The canvas tab strip stays at the
bottom right.

**Voice without the mic button.** Space push-to-talk stays. The status bar's middle line shows "Hold
Space to talk" until it has been used once, so voice stays discoverable. Pasting an image still
attaches it.

**Phone.** Unchanged, apart from strings and the shared Needs-you list.

## Workstreams

- [x] **W1:** Right-dock registry and full-page views. Turn every sheet (Seismic, plan, plan doc, inbox, agents, project settings) into a registered dock view (id, title, icon, component) whose shell owns width, grip, ✕, Esc, one at a time, the canvas making room and dimming beside a card; turn the full-screen archive into a general full-page view mechanism (a view fills the main area, a card unfolds over it and returns to it, Esc leaves it). No visible change; the risk is touching every sheet and the archive's view, so each keeps its behaviour from "Sheets" in The canvas. Goes first: every later workstream builds on one or the other.
- [ ] **W2:** Top bar and floating row. ☰ and logo, the centred search field (`/` focuses it), the chat icon, the avatar placeholder; the floating row with the project switcher on the left, and the cog and the 🤖 / 🛎 group on the right, the "Needs you" label collapsing after its first click (🛎 opens the inbox sheet until W4). The archive's button, "New task" and the inbox's button leave the bar; until W3 lands, Inbox and Archive sit in the logo's menu so nothing becomes unreachable. Bar fitting redone for the new contents, the Mac traffic lights kept clear.
- [ ] **W3:** Left menu. Merge the logo's menu and the project navigation into one floating or docked menu: Inbox with its count, the "Configure agents" sub-page with its back arrow and "Coming soon" entries, the project tree (open project with its canvases by name, Queue, Parked, Archived, "Project settings ›"; other projects with waiting counts and pause; "New project"), and Settings with Preferences and help under it. ☰ toggles it; the pin, fold-back on a narrow window and the Mac traffic-light head carry over from the pinned navigation; the floating row's project switcher hides while it is docked. Until W4 and W5, entries for views not built yet open today's equivalents.
- [ ] **W4:** Needs you, slimmer Agent work, inbox as a view. The Needs you dock view behind 🛎 (current project first, others as collapsed headers with counts, "Hide other projects" remembered per browser, size-S card faces with one-click replies); Agent work as Working | Todo plus the Activity tab, without the stage chips and "Needs you" group; the inbox moved out of the dock into a full-page view opened from the menu's Inbox, keeping every behaviour it has today (Unread | All, "All projects", replies, answers, proposals, read and unread, "Go to card" unfolding over it with the ring kept). The risk is losing an inbox behaviour in the move: list them from the code and the docs first and check each in the demo.
- [ ] **W5:** Views and the bottom-centre switcher. Parked as a full-page view (out of Agent work); the Canvas | Parked | Table switcher with Table greyed out and "Coming soon"; the microphone and image buttons removed, with "Hold Space to talk" in the status bar until first use and paste still attaching images; switching keeps the camera and an open card. The Queue view is built if cheap on the same mechanism, otherwise it stays a "Coming soon" menu entry.
- [ ] **W6:** Docs and cleanup. Rewrite "The bar", "The logo's menu", "The navigation", "Sheets", the agents and inbox parts of [The canvas](../design/the-canvas.md) and the chapters that refer to them, then delete this plan doc and its link in that chapter's header.

## Boundaries

W1 goes first and changes nothing visible. W2 to W5 all edit `App.tsx` and the bar, so they land
one after another, not in parallel; W6 follows them. Each is a day-sized card with a demo. Project
settings' internal arrangement waits for a later spec from the owner and is not in this plan; the
Table view is only a greyed-out entry here.

Decisions (owner, 2026-11-09): a plan doc with workstreams; the bottom-centre switcher holds Canvas,
Parked and a future Table view; the inbox becomes a full-page view in the main area, opened from
the left menu like Archived, rather than a dock view. Smaller calls in "Shape" (the "Needs you"
label as first-use hint, the 🛎 count being cards only, "Hold Space to talk" in the status bar)
were taken when the plan was written and are the workers' to adjust.
