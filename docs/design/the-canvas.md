## The canvas

A chapter of the [design doc](../design.md), whose header says how it is written. Several canvases per project, switched by tabs, are planned in [Several canvases per project](../plan/multi-canvas.md). Moving the UI onto shadcn/ui with Tailwind in frost's look is planned in [shadcn/ui with Tailwind, in frost](../plan/shadcn-ui.md).

The UI is a browser app with a custom canvas: camera with fly-to, unfold-in-place, semantic zoom,
edge indicators, minimap, a frosted top bar the canvas slides under, and a status bar along the bottom.
Edge indicators point to cards needing the owner that lie outside the visible canvas. When several
indicators would meet, they touch in a tight stack without covering one another, in a stable card order, so each title
and arrow remains available as the canvas moves.

### The bar

The bar holds what is about Seismic as a whole. Left, ☰ and the logo, one button that opens
the left menu (see The left menu); in the middle the card finder's field; right, Seismic's
button (a speech bubble, see Sheets) and, rightmost, an avatar that only holds the place for user
accounts Seismic does not have yet (no menu, a tooltip saying it comes later). Notices about the
server (an update, a restart) and `?` stand left of Seismic's button; the workstation pool is in the
status bar (see The pool in the status bar in Agents and workstations).

Under the bar a row of buttons floats over the main area, the project between them staying the
project's (drag and click go through): at the left the project switcher (see Switching projects), gone while the left menu is docked, at
the right the gear of the project settings (see The project settings) and then one group of two
buttons, the agents' (a robot) and "Needs you" (a bell). "Needs you" counts in the orange of a
waiting card the cards that wait for the owner on every project, read or not, and nothing else
(Seismic's answers and proposals count in the inbox alone); its click opens the "Needs you" sheet
(see below). Its label shows until
the owner has clicked it once (per browser), then the bell and the count stand alone: the label is
how a first-time owner learns what the bell is. The camera keeps content below the row as it does
below the bar.

"Needs you" is a sheet (see Sheets) of the cards that wait for the owner: the shown project's
first, in the inbox's order and with the inbox's entries (see the inbox below: the card at size S,
its one-click replies, "Go to card", the unread dot), then every other project with cards waiting
as one header with its name and its count in orange, folded until clicked open (open again on a
reload, as every fold of it starts closed). A switch "Hide other projects" leaves those headers
out, remembered per browser. Seismic's answers and rule or setting proposals are the inbox's alone.
The open card's entry is ringed, and the sheet stays undimmed beside any card.

The agents' button counts in grey the cards waiting in the queue, and only those; its click slides
out "Agent work", a sheet (see Sheets) with two tabs, the one chosen last remembered per browser.
"Work" holds two groups, each heading with a plain count: "Working" (the project's cards at work:
a worker at it, making its demo included, which its state line says; its code review running; its
worker fixing findings the owner gave it; approved and landing, or in a pull request), each a pane
like an inbox entry (the card at size S, "Go to card"), and "Todo": "Queued" with the queue's count
in grey, the waiting cards in turn, each at size XS (see Card sizes) with what it waits for, dragged
to its place (see The queue's order), with no button that takes it out of the queue (that change is
too big to sit on a list row; "Take out of the queue" on the card does it), a row opening its card;
then "Planned", the cards not started and not queued, as panes. A group without cards says so. A
card that needs the owner is in neither: "Needs you" lists it, whatever its stage. Parked cards are
only in the Parked view; finished and archived cards, and ideas the owner has nothing to answer on, are
not listed.

The Parked view is the parking lot, a full-page view of the main area (see the archive below for
how such a view behaves) from the view switcher or "Parked" in the left menu, headed with its count
and a ✕. A planned or stopped task that is not queued (nothing runs for it)
is parked with "Park" in its "⋯" menu (the open card's, and on the canvas); a task that waits for the
owner (a demo, a question) can be parked too, which stops its agent first and asks to confirm with a
yellow "Stop and park" or a grey "Go back"; parked, it is off the
canvas and lists there as a pane like those of "Working", its state "Parked" with a car icon. It stays
planned or stopped underneath, so its buttons are those of a card that is not running; it does not
start by itself or from its start time. Starting it asks first: "This takes the card out of the
parking lot" with "Unpark and start" or "Go back". "Unpark" in the same menu puts it back on the
canvas without starting it. Opening a parked card unfolds it from its row, without flying anywhere.

The Queue view ("Queue" in the left menu) is the queue as a full-page view: the waiting cards in
turn, dragged to their place as in "Todo", a row opening its card.

#### The view switcher

At the bottom centre of the main area, a small rounded group "Canvas | Parked | Table" switches what
the main area shows; "Table" is greyed out with "Coming soon". The view showing is marked (none
while the inbox, the archive or the queue shows; "Canvas" goes back from them too). Switching keeps
the canvas's camera where it was, and an open card stays open over whichever view comes. A click on
it leaves the cursor where it was. The canvas tabs and the left menu's canvases go back to the
canvas as well. There is no microphone button on the desktop: Space is held to talk (see Voice).
The phone keeps its microphone and has no switcher.

"Activity" is a log, newest first, of what happened lately on the cards and who did it, with no
unread marker and no count on the tab or the robot button (what waits is in the inbox). Each line
is a small sentence ("You approved", "An agent proposed", "Waits for “X”", "Waits for a
workstation", "Stopped: Claude usage limit", "Landed on main") above the card's compact face, the
time at the right, under "Today", "Yesterday" and then dates. A card on another canvas of the
project carries its canvas icon, as in search. A click opens a live card; a deleted card keeps the
title it had and is no link. It shows the open project's lines, or with the inbox's "All projects"
switch every project's, each marked with its project; older lines load as the list is scrolled,
back to the first one recorded, and new ones arrive over the same push as everything else, above
the lines already loaded without skipping any (more new lines than a page start the list over).
Recorded: the owner creating a card (a follow-up card an approved merge creates included), archiving, deleting, stopping, approving, and sending review
items or findings to the agent; an agent proposing a card or starting on one; work landing on main;
a card queued behind another card or for want of a free workstation; an agent stopped by its
harness's usage limit. Not recorded: a handover waiting (the inbox shows that), snoozing and
waking, and anything before the log existed (the tab starts empty).

The card finder is a field in the middle of the bar, centred while the bar's sides leave it room,
with a `/` key cap that teaches the shortcut; on the canvas, `/` focuses it when no text field has
focus. While it has focus, its results drop below it. It searches non-archived cards by title words or short code, in the same order as
card links in a task description, each result the card at size XS (see Card sizes). A click opens a result; arrow keys choose one and Enter opens it,
including the first result when no arrow key has been pressed. Escape or a click outside closes it.
The highlighted result remains visible as the owner moves through a list longer than the available space.
The finder shows all matches; the task-description card-link menu limits its suggestions instead.
Cards folded into a merge proposal are left out until they can open again. Focusing the field closes
any open bar menu; Escape or a pick empties it again. While a card is unfolded the field is hidden.

The archive ("Archived" under the open project in the left menu, or `A`) is a full-page view of the main area, under the
bar and the floating row: its search field, day headings and entries (see Card lifecycle); a row
opens its card, the view stays beneath the unfolded card and returns when it folds back. Its ✕, Esc
(once no card is open) or a click beside it closes it.

The inbox ("Inbox" in the left menu, which carries no count badge; as no entry of the menu does) lists
everything that waits for the owner on every project and that they have not read yet (see Read and
unread below): the cards that need them, per project one for Seismic's answers waiting unread, and
each open rule or setting proposal; the entry is marked while the inbox shows). The inbox is a full-page view of the main area, like the
archive, instead of jumping to a card: its list in a column at the left, the room beside it saying
that "Go to card" opens the card there. Its ✕ and Esc (once no card is open) close it, as do the
menu's canvases and "Archived", which take its place. Opened, it stays open as the owner switches
project (per tab) and across a reload, until they close it. A sheet on the right (Seismic's, say)
opens beside it.

The desktop's inbox lists the shown project's entries; a switch "All projects", right-aligned on the line of the Unread | All filter, lists every project's entries in one list (off by default, remembered). The list is ordered newest first by the time shown on the entry;
cards snoozed while they waited stand at the end (see Snoozing a card). The phone's "Needs you"
shares the entries, layout and actions, but sorts by last update, newest first: a refreshed demo
moves its card to the top (see The phone view). An entry is a pane of glass of its own holding the
card at size S (see Card sizes): its project (name and icon) and since when it waits on its top
line, and what the card waits for (the question, the summary, the proposal's text) in place of the
line under its title. Rule and setting proposals offer their decisions directly in the inbox. Seismic's latest unread answer on a project is an entry too, placed by
when it came, and leads to Seismic's sheet there.

Under an entry stand the buttons that answer it in one click, the same as its card's own, and of
them exactly the one the card has as its default is primary: "Accept and start" with "Discard" on a
proposal that asks nothing, "Keep" with "Remove" on a card its agent withdrew, and on a single
question of up to four options, single-choice, one button per option, primary only for the option
its agent would pick. What the card alone can settle (a handover, an idea's reply, several
questions, a multiple choice, a proposal with questions of its own or being reworked, a pull
request waiting for its merge, Seismic's answers) has no button. A handover's entry says "Demo ready"
(or "Ready for review") under the card's title and offers only "Go to card": work is approved after
watching its demo on the card, never blind from the list (owner, 2026-11-05; an "Approve" button on
the entry was dropped for that reason). A reply takes its entry out of the list at once and puts
it back with the reason if the server refuses it. One that sets work in motion (an acceptance, an
answer, a dismissal) is sent only once its "Undo" has run out, or as the page closes; a removal
goes at once, with the undo a card's removal always has.

"Go to card" ("Go to Seismic" on Seismic's answer) is on every entry, last and never primary, even
alone. It unfolds the card over the inbox's view, from its entry and into the room beside the list,
without moving the canvas behind it; on another project by switching there, where the inbox is
open again with the card. The list is not dimmed while a card is open: the open card's entry is
marked with a ring and a tint, its buttons answer as before, and the owner works down the list from
there; the card folds back into its entry and the view returns.

Read and unread: an entry is unread until the owner clicks on it (any of its buttons, "Go to card"
included) or opens its card some other way (on the canvas, with Tab); only a click on a button reads an entry (its title is one, underlined on hover and opening the card), not one on the text around it; an unread one has an orange
dot in the entry's top-right corner and the title bold, a read one neither. Read holds for the wait it was read
in: a card that waits anew (a new demo after feedback), one that asks something new while it
waits (another question, another summary) and a newer answer of Seismic's are unread again; a card open while it starts to wait again stays read, as the owner is
looking at it. Nothing counts them: unread is shown by the entry's marker alone. A switch "Unread | All" above the
list shows every entry or only the unread ones; with "Unread", the open card's entry stays listed
until the owner moves on, so it does not vanish under them. The switch's choice and what was read
are kept per browser, like what of a conversation was seen (the phone and the desk each have their
own). Tab still goes through the cards of this project that need the owner and Seismic's
answers (see the legend), never another project's.

The bar has no hint line. `?` (or the round `?` button) shows the legend of mouse and keys, ending
with the link "Report a wish or a bug" (see Wishes for Seismic's makers). The button only teaches
the key: the legend says so, and once the key has been used the button is gone for good (per
browser).

The buttons always fit: when the contents outgrow the bar (a wide sheet, a narrow window), the
search field narrows first (centred no longer once a side needs more than half), then the bar gives
up in steps the logo's wordmark (☰ and the sign stay), then `?`, and last
the search field shrinks to its icon;
Seismic's button and the avatar always stay. The
floating row does the same with its own steps: the branch, then the "Needs you" label, then the
project's name shortens. The step is measured from the actual contents, since the same width may
hold a short or a long name. In the app on a Mac the bar keeps clear of the
window's traffic lights at its left (or they sit in the docked left menu's head).

The logo (three chevrons in blues, `src/ui/logo/seismic_logo.png`; the wordmark "Seismic" in Newsreader) opens
the bar, stands alone while the page loads (above "No connection to the server" when the server is gone), and is the
favicon and the app icon's source (`scripts/logo.py`).

#### The left menu

A click on ☰ and the logo opens one menu for everything that is not on the canvas, top to bottom:

- "Inbox" with its count (see the inbox above), which opens the inbox.
- "Configure agents ›", which slides in a page of its own with a back arrow at its head: "Agents",
  "Rules" and "Code review rules", greyed out with "Coming soon", and "Performance" (the
  performance dashboard over the page) with "Feedback log" (the log's page) under it.
- "Projects": the open project bold, with its agents' pause, and under it its
  canvases by name (a click shows it), "Queue" and "Parked" (each opens its view), "Archived" (the archive's view)
  and "Project settings ›" (its sheet). No entry of the menu carries a count. Every other project is one line with its
  pause, a click switching there (see Switching projects); "New project" ends the list.
- "Settings", the Configuration dialog (see The configuration dialog in Repositories and
  configuration), with "Preferences", "Controls: mouse and keys" (the legend `?` shows) and
  "Report a wish or a bug" under it.

The entry of what is showing (the canvas, the inbox, the queue, the parked cards, the archive, the project settings) is marked. The menu
drops down under ☰, and a click on an entry, beside it or Esc closes it. Moving to "Configure agents" or back keeps the menu open and moves keyboard focus to the new page. Its head has a pin that
docks it as a sidebar on the window's left edge, full height, as the sheets are on the right (see
Sheets); the same button, pressed, undocks it. Docked, it stays open as entries are clicked, ☰ hides
it and shows it again (both remembered per browser, as the docking is, on every project), and the
floating row's project switcher is gone, since the menu switches projects. Unlike a sheet it is not
dimmed while a card is open. A narrow window, or one that would leave the project less than about a
column of cards beside it and an open sheet, folds it back under ☰ until there is room again: the
two sidebars never stack, neither over each other nor side by side on one edge. In the app on a Mac
the docked menu reaches up to the window's top, so the traffic lights move from the bar into its
head, which stays in place as the menu scrolls and drags the window as the bar does; the bar beside
it then starts at its own edge. The phone view has no such menu.

"Preferences" is a dialog in the style of the Configuration (see The Configuration dialog in
Repositories and configuration) with two sections: Language and appearance (languages, light or
dark) and About Seismic (version and the server's own settings). Each setting saves on its own; the dialog comes back after the reload a new language causes, at the section it
showed, and a link in it opens the Configuration.

### The project settings

The gear in the floating row (an icon without a label, the configuration's problems counted on it in red)
slides out the open project's settings, a sheet like the inbox (see Sheets): docked to the right edge
in a wide window, one sheet at a time, its second click, its ✕ and Esc close it; a narrow window
lays it over the whole page down to the status bar, the microphone hidden behind it. It is headed
"Project settings" under the project's name and holds what applies to this project alone, each change
saved into the configuration at once and applied without a restart:

- Models: for each group of agents (see Models and effort in Agents and workstations) a harness,
  model and effort. Left open, each shows Configuration's value and follows it as it
  changes; a value chosen is the project's own. Running agents keep theirs; the next to start take it.
- Code reviews: "Review the work", off unless turned on; once on, "Reviews happen" "Automatically,
  with the demo" or "Manually, at handover", and the line that this applies only to work that lands
  on `main` ("Work that goes through a pull request is reviewed on the forge"). See Code reviews in
  Card lifecycle.
- Demo site: where "Share" puts the project's demos, one of this machine's sites with a path of its
  own, "Initialize", the vocabulary of tags and when a demo goes on the site (see A project's demo
  site in Sharing demos).
- Cards: "Cards archive", "Manually" (the default) or "Automatically, after landing" (see Archive
  in Card lifecycle); "Right click on a card", "Manage groups" (the default: the colour ring, see
  Groups) or "Manage canvases" (a ring of the project's canvases, see Canvases).
- Labels: the toggles "Seismic suggests" (see Projects in Repositories and configuration).
- Plans: plan git baseline tags.

Its foot opens the Configuration at this project's page for its name, repositories and the rest.

### The status bar

A thin frosted bar along the bottom, between the sheets docked at the edges, with three places.
Left, the connection: "Online" in light green; in orange text without a background "Reconnecting …" while the
connection is gone, "Server not responding …" while it is open but the server answers nothing (see
the decision on the status bar's liveness), and "No connection since <time>" or "Unresponsive since
<time>" from 2½ minutes on; while a restart waits, that instead, in ice blue (see Running Seismic,
the restart); beside it "Creating demo site …" while the project's demo site is being initialized
(see A project's demo site in Sharing demos). In the middle, whom the microphone speaks to (see Voice). It stays above an open
card's dimming, so that line stays readable while a card is open; the view switcher sits just above
the bar. Until the owner has talked once (remembered per browser), that line starts with "Hold Space
to talk", which is how voice is found without a microphone button. Right, the usage limits of the Claude plan that Claude Code on this machine is logged in
with, behind the small mark of the harness they belong to (Claude Code's; other harnesses get their
own mark and meters beside it): the session's (five hours) and the week's, each a short meter with its
percentage, the most used limit of each group, coloured in the grade the plan's usage endpoint gives
it (warning, critical). A click lists every limit (the session, the week for all models,
the week for a single model) with when it starts anew, where the numbers come from and as of when,
and "Hide", which turns the setting off; "Usage limits in the bar" under Configuration →
Notifications and limits turns it on again (on until then). The phone view shows the same at the right of its top bar.
The numbers come from the data behind Claude Code's `/usage`: one idle Claude Code session, which
sends no prompt and so uses none of the limits, is asked a little over every minute (it keeps an
answer for a minute) while the setting is on and a page of Seismic is open, and closed once neither
holds, half a minute after the last page closed: a reload, or a switch to another project, finds the
numbers there and shows them as soon as its connection opens. Nothing shows for a login without plan limits (an API key, a cloud provider), a Claude Code
too old to answer, or numbers that could not be fetched again for five minutes. The workers on other
machines may use other logins; the bar shows this machine's. The lists the status bar opens
open upwards.

### Switching projects

The floating row's left holds the project switcher while the left menu is not docked. Its button
names the project and its home branch (or its count of repositories); a click lists the projects
under it in the configuration's order, the open one marked, as the left menu lists them too. Each
names its repositories and carries its agents' pause (see Pausing a project's
agents). A click on one switches there within the page, without loading it
again: the canvas of the project before goes, the other's comes in its place as on a page load (its
camera, the card, sheet and scroll positions it was left with, Seismic's sheet as left; see Sheets),
and every input keeps its draft per project: a screenshot, a dictation or a wish draft that is still
under way at the switch ends up in the draft of the project it was started on. The switch is a step in the browser's history (Back returns to the project
before), and a click with a modifier opens the project in a tab of its own. The same holds where
the page goes to a card on another project (the inbox, a confirmation's "Go to card", the
workstations, Seismic's answer elsewhere). Decided 2026-11-08 (owner): a reload for each switch
loaded the whole app again; rejected: keeping every project mounted at once (a connection and a
canvas each, for projects not looked at). The list ends with "New project", which opens the configuration's
Projects section with a new, empty project already added to its list, ready to fill in. What waits itself is in the inbox (see
The bar), not here.

### Creating cards

A double-click or `n` creates a card and unfolds it with the cursor in the text field. The title is
optional: a card closed or started with text or screenshots but no title gets one from a short
session of the "Small jobs" group (else the text's first line) before its start is judged;
meanwhile the canvas shows the first line, muted, and a title the owner types wins. A card left
empty is dropped (one left by a closed page on Seismic's next start). Deleting offers undo.

Automatic titles follow the plugin's `titles` skill, choosing a format from the task's meaning:
"As <role> I should <action>" for a user's capability where the role matters,
"<component> - <something that is not working>" for an observed fault, and
"<component> should <new action>" for new behaviour. The wording follows the task's language,
aims for about 70 characters, and keeps the distinguishing action, symptom or condition. These
formats work with ordinary prose and screenshots; a concise action title covers tasks with no
role or component, without inventing either.

An empty canvas names speaking first (hold Space and say what to build; the card appears at the
pointer), the double-click second.

### Cards on the canvas

Cards have one fixed size; a delivered workstream becomes a shorter card (`W3` and its title) once its
agent is done. It keeps the width and title size of an open card, on opaque muted green stock
that stays opaque when zoomed out, with larger titles in the overview. Existing plans make
room for these cards where their older layout would overlap. A plan wraps its workstreams, which cannot be dragged out; new plans go below
the existing ones. A proposal or follow-up goes below its card, or, when that spot is taken (for a
workstream: by its own plan), to the nearest spot clear of everything, unless that is more than about two cards away: in a crowded
area it then stays below its card and overlaps, so it is always in view of the card it follows. The dashed line from a
proposal, follow-up or prototype to its card joins the facing sides and runs above plans but
below cards. Where a wait joins the same two cards (a follow-up queued behind the card it came
from, say), only the wait's arrow shows: both lines would take the same course.

The arrow before a plan's title collapses it to its head ("Fold", "Unfold"), for
plans the owner does not work on (on a shared repository every colleague's plan docs are
plans). Collapsed, it shows title, progress, start button, the badge of workstreams that need the
owner, the bubble of its agent's unread answers (see Asking in a plan's sheet), and a mark per workstream in its state's colour that names and opens it. Its workstreams stay
in the plan's sheet and the queue, and an edge indicator for one that needs the owner points to
the plan. Nothing around it moves. Collapsing is stored in this Seismic, not in the plan doc, so it
holds across reloads, devices and the archive.

A planned or queued card shows a play button under the pointer that starts it without unfolding.
While Seismic checks a started card before its start (the Koordinator's judgement, see Scheduling),
a faint Stop takes the play button's place, and the unfolded card offers "Stop" below what it
checks: either calls the start off, and the card is planned again, as taken out of the queue; a new
start checks afresh. Without it, a start clicked by mistake could not be taken back until the check
ended (2026-11-04).

While a card's worker is in a turn, a word in italics after its state line ("Agent at work · thinking") says what it is doing, and the moving line runs thin under that line instead of beside
it. The word is read from the agent's steps alone, without asking the agent: "working"; "building" while an editing tool runs; "thinking" once it has gone
about twenty seconds without a step while no tool of its runs; "debugging" after one of its
tool calls failed (a command's non-zero exit), until that tool succeeds again; and, in green, the
stages of its demo: "preparing demo" from the demo skill, a demo script or a dry run on,
"recording demo" while the render runs (also as background work after the turn ended), "finalizing demo" from its next step until the handover. A failure outranks the demo, the demo
outranks thinking. While the worker takes in feedback, the non-demo words add "from feedback". The phone's Agents view shows its cards the same way.

Every wait between cards on the canvas shows at all times as a thin, solid, grey arrow from the card
waited for to the card waiting, under the cards and above plans like the dashed line: only direct
waits, not the chain, and of those only the ones no chain of others already implies: when C waits
for A and for B, and B for A, the arrows run A → B → C without one from A to C (the owner,
2026-11-09: the extra arrows only cluttered the picture; the chain says the same). A wait on a loop
always keeps its arrow. Finished cards' dim green lines count in that chain too. All kinds of wait look alike (a card queued behind another, a workstream and
those it builds on, a card snoozed until another, an arrow the owner drew); a wait ends once the card
waited for is finished. A finished card's dependencies stay instead, from it to
the cards queued behind it, snoozed until it, building on it or that the owner drew an arrow to, as dim green lines (as long as the card still records that dependency; an arrow the owner drew can be removed with its trash button either way). A workstream of a collapsed plan shows
its waits at the plan's head. The lines stay thin on screen however far the view zooms out.
Under the pointer a card shows the waits around it over every step instead, again without those a chain implies, those to it in the waiting colour and
those from it in purple (see Scheduling); a wait shows once, never as both. Only the colour changes: line, head and course
stay as they were, so that moving the pointer over the cards leaves the picture calm.

The owner draws a dependency between two task cards: near the middle of a card's edge a dot appears
in the card's colour once the pointer comes close to the dot or to that edge; a click on it starts an
arrow that follows the pointer and snaps to the closest point on the nearest edge of the card under
it or close to it, a click there connects the two at that point (Escape cancels). A click on empty
canvas instead makes a new card there, already connected as the one that waits, and opens it to be
written; left empty, it goes again as any new card does, and its arrow with it. The arrow keeps
the edges it was drawn between and its place along the waiting card's edge; arrows drawn before
that choice was kept are routed between the cards as the other waits are. Until the owner has drawn
their first arrow, a line beside the pointer says what it will do while they draw: which card is to
be clicked, and once one is under the pointer, that it starts only once the other is done. The arrow
points from the prerequisite to the card that waits for it and stays on the canvas, as every wait
does, under the cards: a card it crosses stays clickable and draggable all over. Under the pointer
it shows a trash button that removes it at once, with "Undo"; the button sits on the arrow's
middle, or the nearest point along it no card covers. It is grey like the canvas's other remove
buttons, darker under the pointer, and keeps its size on screen at every zoom, as does the band
along the arrow that shows it. While the arrow holds a queued card, the
removal waits until the undo has run out (or the page closes), so taking it back never leaves a card
started. Plans and their workstreams get no dots, since the plan doc decides their order, and
inferred waits have no trash button. An arrow that would close a cycle with other arrows or waits is
refused, and the line says why: the card it starts from already waits for the other, directly or
through other cards, so the two would wait for each other. One to or from a plan or a workstream
is refused the same way, saying the plan doc gives their order. A deleted or archived card's arrows are hidden and count for nothing; bringing the card
back brings them back, except one that would now close a cycle. How an arrow holds a card's start:
see Scheduling.

#### Card sizes

A card has one face, which every place that shows a card draws in one of four sizes, so that no
list says a card's title, state or labels in a way of its own:

- **M** is the card on the canvas, also two merged cards side by side, the phone's Agents view (its queue aside) and a follow-up made in a conversation. Its top line holds the label
  chips (the priority's flag and name, then category, sub-category and complexity; one Seismic
  suggested is framed dashed in purple), followed by where it is (its repository on a project with
  several, its project on the phone) and its kind ("Idea", "Plan", a workstream's label, a review
  card's pull request; a plain task says none). Then its title; one line of what holds it, what it
  asks, its status, else the start of its text; its state line in its state's colour with what its
  agent is doing; and the pin while it needs the owner. Zoomed out, only the label chips of the top
  line stay, enlarged.
- **S** is a compact row of up to four lines, for the inbox, "Needs you" and Agent work: the label
  chips, then where, kind and since when; the title with the pin (in the inbox, drawn subtle, see below, the pin and the unread dot sit
  in the card's top-right corner); the state line; then what the card waits for (else the line under its title), in at
  most two lines. The top line and the state line stay one line on any width: the chips keep their
  size and where/kind/since is cut with an ellipsis. The entry's buttons stand below it.
- **XS** is two lines with the least, for `/` search, the queue, the archive (with the time it was
  archived beside it), a plan's sheet, the merge picker, and the cards before and after a queued
  card in its chain on the open card: the priority's flag alone, then the title (a workstream's
  after its label) with the pin, cut off with "…" on one line at every width, phones included, so
  that the state line always keeps its place; below, the dot and the short word of its state in its colour
  ("Working", "Demo ready", "Question", "Queued"; a state without a short word keeps its own), its
  kind, the other canvas it is on, what the list adds (what it waits for, what it builds on,
  "Archived") and, in grey, as much of the line under its title as fits, cut off with "…". A plan's
  sheet leaves that line out, as it shows the workstream's text from the plan doc below in full.

- **Inline** is a card named within a line of text: a pill with a dot in the colour of its state, its
  title as it is now in blue and underlined, and its priority where it has one; the state line is its
  tooltip and a click opens the card. Every reference to a card in running text draws it so: a smart
  link in a conversation, what a queued card waits for (in its detail, the queue, a plan's sheet), the
  cards a message or the Koordinator names, and the card a toast is about.

The edge indicators and the minimap are no faces: they only name a card.

Decision (2026-11-08): one face in four sizes for every surface, rather than each list drawing a row
of its own: search showed neither state nor priority, and the rows drifted apart with every change to
the card. XS leaves out category, sub-category and complexity so that it stays two lines; the
priority stays, as what decides where in a list to look first, on the title line, and the state takes
its short word so that the rest of the line can say what the card is about (owner, 2026-11-08). The
short words are one table beside the state line's own words, not chosen per list.

Any size can be drawn **subtle**, for places that hold many cards (the inbox shows its entries so):
the pin becomes a small dot inside the card's top-right corner (an unread entry's dot takes that
place too), the state line is plain and muted instead of bold in the state's colour, and there is no
moving line under a working card; an M card also loses the colour strip along its top, and an XS card's state dot turns muted. A part the size does not show anyway stays as it is.


#### Priorities

The owner gives any card a priority: Trivial, Low, Medium, High, Very high or Critical ("Trivial",
"Low", "Medium", "High", "Very high", "Critical"). A card has none until then. The unfolded card
(a plan: its sheet) shows the priority in its kind line, or "Set priority" while it has
none. A click there lists the six priorities, highest first, and "None" to take it off; the pick
takes effect at once, without an undo. On the canvas, the card's face shows the priority before its kind as a flag
and its name, in a colour that rises from grey to red; Critical is set in white on red. A plan's
head shows it in place of the word "Plan". A priority is a label for the owner only: it changes
neither the queue's order nor what starts first, and agents are not told of it. It is stored in
this Seismic, as collapsing is, so a workstream's priority stays out of its plan doc. Categories and a
complexity beside it, suggested by Seismic where the owner leaves them empty, are planned in
[Built-in card labels](../plan/card-labels.md).

#### A plan arranged by its dependencies

A plan's workstreams can stand in columns by what builds on what: leftmost what can start at
once, each further column one step along the longest chain of open workstreams. Delivered
workstreams stay in rows of chips above. Within a column cards follow what they build on, so arrows
cross little, else the plan's order; a column holds four cards and overflows into one beside it.

Plan docs state dependencies in prose ("Needs W1", "after W2", or only implicitly), so the
Koordinator reads them in a turn of its own: for each workstream, delivered ones too, the ones it
builds on directly (it must name every open one). The reading is kept for the doc as it stood; under the pointer a workstream shows the open
ones it builds on as waits (see Scheduling), and the plan's sheet lists the workstreams in this
order with what each builds on.

A plan arriving with two or more open workstreams is arranged once read, unless the owner has
moved one of its cards meanwhile. "Arrange" in its head (or in its sheet) arranges it again, after a
new reading if the doc has changed; it takes effect at once, with "Undo". A plan that grows
into other cards moves to the nearest clear spot.

### Moving around

A card dragged to an edge of the view scrolls it, faster nearer the edge, but only as far as the
canvas reaches plus room to drop the card; a card picked up at an edge scrolls only once the pointer
moves towards it.

Panning and zooming stop while a strip of the area the minimap panel shows (the bounding box of all cards and
notes plus the panel's margin) is still in sight, so every point the minimap can pinpoint is reachable,
empty corners included; an empty canvas has no limit. When the view ends up outside it (cards go, the window shrinks),
the camera flies back. The minimap sits bottom left, clear of the
sheets; a click flies there, a moving press lets the view glide after the pointer.

On a touch screen (a tablet; phones get the phone view) fingers do what mouse, Shift and hover do at
the desk; a mouse or trackpad on the same device behaves as at the desk. The browser's own gestures
are off over the canvas, so a pinch zooms the canvas, not the page.

- One finger always pans, also when it lands on a card: a finger on a full canvas mostly lands on
  cards, and moving them by accident was the common case.
- Two fingers pinch-zoom around their midpoint, within the usual zoom limits, and pan at once; when
  one lifts, the other pans on. The view limit (the minimap panel's area) holds throughout.
- A tap opens a card; while cards are marked, it takes a card in or out instead (as Shift + click).
  A tap on the empty canvas unmarks. A double-tap on the empty canvas creates a card there.
- A long press (about 400 ms without moving) on a card picks it up: the card lifts, the device gives
  a short buzz where it can, and the card follows the finger with edge scrolling, marked cards
  along, as a drag does. A long press on the empty canvas starts the lasso instead.
- A second finger landing while a card is held drops it where it is (nothing jumps) and pinches.
- What hover shows at the desk shows on touch for the card last picked up and let go: its dots for
  drawing an arrow (also on marked cards), its waits in colour, the trash buttons on its drawn
  arrows. Drawing an arrow is two taps: the dot, then the waiting card or empty space; a tap on the
  card it starts from cancels. A card's play button stands on every startable card.
- A long press opens no browser menu and selects no text; the colour ring, at the desk also on a
  right click, is reached through the marked cards' "Group …".
  (With the project setting "Right click on a card" at "Manage canvases", a right click opens the canvas ring instead.)

*The on-screen keyboard* (a tablet's, and the phone view's alike) takes the bottom of the screen and
nothing else: the page stands in the part the keyboard leaves, its bar at the top of the screen and
whatever sits at the screen's bottom (a sheet's field, the microphone) right above the keyboard. The
page asks to be shrunk while the keyboard is up (`interactive-widget=resizes-content`, heeded by
Chrome on Android); Safari ignores that, shrinks only the visual viewport and pans the page up to
bring the field into view, so there the page is pinned to the visual viewport (moved to its top and
cut to its height) while it is more than 150 px shorter than the page at a scale of 1 (zoomed in with
two fingers, the page is zoomed, not pinned). Chrome's visual viewport alone is off by its own bars,
so Chrome is not pinned. Safari on an iPhone or iPad does not zoom into a field written smaller than
16 px (the page's largest scale is 1, which Safari ignores for two fingers), as the zoom moved the
page as much as the keyboard.
- The hints say tap and hold instead of click and Shift. One more, under the bar, says what a long
  press does, until the owner has used one.

### Unfolding a card

Opening a card takes about 300 ms (a flight to the middle, then the unfold), closing folds it back into its place on the canvas
without moving the view, so the card is seen among the rest it sits with: fast enough not to wait on,
long enough to keep the context.

An unfolded card is as large as its content, up to the room between the window's top (over the
dimmed bar) and the view switcher; beyond that it scrolls. Only a window too low for a usable panel lets
it reach under the switcher, with room for the last row to scroll past it. A card's row of
decisions stays in view at its foot while a long text scrolls, so a planned workstream shows "Start agent" without scrolling.

A card whose conversation stands alone is a conversation wide. A card with a conversation beside
what it is about (an idea, a proposal, a task with a result) is a wide split, the conversation a
third, as tall as its taller column. An open card sits in the middle of the canvas; where the canvas
is too narrow for it, it reaches over the docked sheet, which lies dimmed under it anyway, but not
over the docked left menu, which stays usable beside it. Each
column scrolls on its own, the panel never. A Question card is its conversation alone at a card's
width, growing with it up to the room above the view switcher before it scrolls, like a split's column:
a looked-up answer is long, and a box of fixed height left most of the window unused. A proposal's
text box grows until the reason below it would leave view.

### Addresses

The page's address names what it shows: `/p/<project>` a named project, `<project>` being its name as a
slug (lowercase, accents folded, every run of characters other than letters and digits one dash; a project name needs at least one letter, so the slug is never empty), or its id where the name would not tell
projects apart (two projects with the same slug, or a slug that is another project's id: ids keep
opening their project). An address names a project by that part, else by id (links from before names,
notifications), and a hand-typed name works too. An address naming no project says so and lists the
projects, rather than showing another one's cards. A rename moves the open page's address (an open
card's included) to the new name. The names a project had before stay its own (see Projects in
Repositories and configuration): an address with one of them, a card's too, opens that project and
moves to its name now; an address names a project by its name now first, then by id, then by an old
name. Decided 2026-11-07: name as slug with the id as fallback; rejected: ids only (not what the owner
sees), names only (breaks on duplicates and renames). Old names as redirects decided by the owner the
same day, so that links shared before a rename keep working.
`/p/<project>/c/<code>` a card
or plan open on it (the phone view: the card full screen). The code is the card's short code, the
first six hex digits of its id with one more digit for each card already holding those; its whole id
works in its place, and the page then shows the short one. The short code is given once, when the
card is made, and never changes, so a link stays good; existing cards got theirs when the database
was migrated, each the shortest start of its id no other card shared. Opening an address (a link, a
bookmark, a reload) opens that card at once, without the flight; an archived one unfolds from its
row in the archive, an archived workstream from its plan's sheet; a code no card has leaves the
project open at its own address. Existing `/c/<project>`, `/c/<project>/card/<code>` and `/c/<project>/feedback` addresses,
and query addresses (`/?c=<project>&card=<id>`), are rewritten to this form, so old links and bookmarks keep working. What else the page shows that is
not a place (`?view=phone`, the phone's open conversation `?talk`; on the project `?talk` opens
Seismic's sheet once, as the inbox's link to an answer on another project does) stays in the query.
`/p/<project>/feedback` is the Agent Feedback Log in place of that project (see Comparing ratings in
Card lifecycle), and `?performance` on a project opens the performance dashboard once.

Opening a card or a plan is a step in the browser's history, on the canvas as on the phone: Back
closes it again, and closing it (Esc, the close button) goes back that step, so Back after closing
leaves the page rather than opening the card again. A card opened from a plan's sheet is a step on
from the plan's; one opened in place of another (by a link in it) takes over that one's step, so
Back from it returns to what was open before the first. Where a card names another (what a queued
card waits for, the card a follow-up or a proposal comes from, the card that replaced a proposal, a
prototype's idea and plan, what Seismic waits on), the name is a link to that card while it is on
the canvas: a click opens it in place of the open one, a click with a modifier in a tab of its own.
Card faces on the canvas link nothing, since a click there opens the card itself.

### Sheets

The sheets (Seismic's, a plan's, a plan doc being read, "Needs you", Agent work, the project settings) are a sidebar docked to the window's right
edge, full height, one at a time; each is a view registered with its title and icon, and the one frame around them (width, grip, ✕, Esc, the room it takes from the canvas, the dimming beside a card) is the same for all, so a new kind of sheet is only a new registration. The inbox is no sheet but a full-page view (see The bar); the docked left menu is one on the left edge. The canvas is the rest between
them: the top bar, the floating row, the view switcher and the confirmations, the edge indicators, the minimap and an
unfolding card all keep to it. Opening, closing or resizing a sheet, or docking the left menu,
shifts the view so its middle stays in the middle of the rest. A card opened beside a sheet
returns beside whatever sheet is open when it closes; a plan's sheet stays, dimmed, while one of
its cards is open, and "Needs you", Agent work and the project settings stay undimmed beside any card. A narrow window lays the sheet over the canvas.

Seismic's button, a speech bubble with its counts, stays where it is when its sheet opens and becomes
the sidebar's top corner that closes it; the sheet is headed "Seismic". Other sheets have a ✕.
Leaving a project (for another, or a reload) with Seismic's sheet open and something entered in its
field brings the sheet back open on return; with the field empty, or the sheet closed on leaving
(a draft in it or not), the project comes back with it closed (owner, 2026-10-30): an open sheet
with words in it is work in progress, an empty one was only a glance.

Esc closes a sheet, from a text field in it too, unless a field being edited takes it to cancel the
edit; with a card open beside a sheet, the first Esc closes the card.

The owner drags the sheet's left edge: one width for all sheets, another for reading a plan doc
(which follows the window until dragged). The browser remembers both; a double-click on the edge
restores the default.

### Visual identity

Frost: panes of frosted glass over a soft, cool board, light and dark, so that the canvas reads as
calm and modern without looking like a stock component kit.

- *The board*: a cool gradient with faint washes of blue, pink and mint, under a faint dot grid.
- *The card*: a pane of frosted glass (translucent, blurring what lies behind it), with large soft
  corners, a thin bright edge and a diffuse shadow. Its state is a short glowing tab at the top edge
  in its ink (a taller one when zoomed out). Zoomed far out a card keeps its title, its label chips
  (those that fit in one line) and its state line with the moving stroke of an agent at work, all
  drawn larger so they still read; its other text goes. The owner's turn is an orange frame with a soft orange
  glow and a pulsing pin with "!", a failed worker's the same in red with "!!" (the pulse, a halo
  growing and fading, changes nothing but size and opacity: an animation the browser has to repaint
  makes the whole card under it shimmer on a zoomed-out canvas, 2026-10-30); an idea is glass tinted
  rose; a proposal only pencilled in (dashed, no glass); a queued card's tab dashed; done and live
  cards are glass tinted muted green, in a plan or outside one (a Question card keeps its own;
  while their agent still works after landing, only their state line is in the working ink, with the
  moving line). The state line at the card's foot stays one line, cut short
  with an ellipsis when it is longer, so it never runs into the text above it. Under the pointer a
  card lifts; dragged, it lifts a little further. "At work" is a stroke drawn again and again.
- *Lists that fill from a field*: the card finder, the composer's `/` skill menu, the card-link menu
  in the task field and the merge picker's search all behave alike. Focus stays in the field, which is
  exposed as a combobox over a listbox; the arrow keys move the highlighted option (wrapping, except in
  the merge picker), Enter picks it (Tab too in the two `/` menus), Escape closes the list alone and the
  card stays open (`data-esc`), and a pointer over an option highlights it. Keys are left to an IME
  while it composes. One small shared hook and component serve all four, with no combobox library
  (Radix has none; cmdk and Ariakit would be a second behaviour library for four uses, two of which
  sit in a textarea and a contentEditable they do not own; 2026-11-09).
- *Glass costs frames, so it gives way*: zoomed far out and while the canvas moves (a pan, a zoom, a
  camera flight), cards drop the blur and take a tint that keeps them the colour they have at rest
  (in dark mode the blur's saturation makes them bluer, so the tint is a blue one; light mode needs
  none); the blur comes back once the canvas has stood still for a moment. A pan or a click on the
  canvas must not change the cards' colour (owner, 2026-11-05: the earlier darker, greyer tint
  showed as a flicker in dark mode), and each blurred card would otherwise re-sample the board
  behind it on every frame.
- *Inks*: planned grey, working clear blue, waiting for the owner strong orange (also every count of
  what waits; a card whose agent asks the owner a question is dark yellow instead: its tab, frame,
  minimap mark and pin, the pin with "?" in place of "!", and its state line, on the canvas and in
  the open card, "Question for you" after a question-mark icon, so a question stands out from a demo or
  review to approve, owner 2026-11-04), approved green, in PR petrol, proposal violet, idea rose red,
  live and done faded. Marks in the inks (tab, frame, pin) reach 3:1 against the glass; a state line
  in words is its ink drawn toward the text colour until it reaches 4.5:1 (a faded finished card's,
  3:1), measured in both modes over the board's lightest and darkest. Dark mode is smoked glass on a
  night board with the inks as far apart: blue and green never confusable, orange the loudest.
- *Light or dark*: as the system until the owner picks Light or Dark (or the system again) in Configuration (`theme` in
  Seismic's `settings.json`). The page reads it before its first render and applies a change without
  reload; until the server has answered, the board already takes the choice that browser saw last
  (kept in the browser, set before the first paint), so a canvas chosen dark on a light system never
  shows light first (owner, 2026-11-05: the canvas waits for its colours); `color-scheme`
  follows so native controls and framed pages (a worker's HTML artifact, a mock) match. The site and shared demo pages follow the system.
- *Motion*: as the system's reduce-motion setting until the owner picks Full or Reduced (or the
  system again) in "Preferences" beside Light or dark (`motion` in Seismic's `settings.json`), read
  before the first render and applied without reload. Reduced, nothing moves or blurs: animations
  and transitions jump to their end, camera flights, a card's unfold and the zoom of a screenshot or
  demo happen at once (an opened card shows once, at the size it settles at as its conversation,
  demo and files load, held back for at most about a third of a second rather than growing in
  view; after a reload it shows at once), scrolling to something is instant, the group waves and streaks are gone, and
  every frosted surface drops its blur (panes and bars turn solid, cards take the tint they have while the canvas moves).
  Colour flashes that point at a message or setting stay, a tint rather than a move; so do meters
  that show something live (the microphone's level) and following the pointer while dragging.
- *Type*: Inter for titles, headings and text alike (SIL OFL, self-hosted, no Google Fonts), code in
  the system monospace. The logo keeps its own wordmark.
- *Icons*: Lucide's stroke icons, one per meaning, throughout the UI; the logo, the group colour
  mark and the complexity bars stay drawings of their own.
- *Carried through*: the top bar, the open card, sheets and dialogs are frosted glass too, with what
  lies under an open card or a dialog softly blurred; bars that stay put while a pane scrolls are
  frosted over the pane's content. The open card is frosted only while open in full: unfolding,
  folding and hidden it is a solid pane, and the card it lifted off the canvas has no blur, since
  Safari can leave a hidden element's blur painted where it was (an empty pane over the canvas
  after a card folded, seen on an iPad). Menus and tips are solid panes with the same edge and corners
  (most open from the top bar, whose own blur would keep theirs from reaching the canvas). So are
  the questions stacked by the microphone (the rating after an approval, the one about notifications): on a
  narrow screen they stand over the microphone, which must not show through them. Buttons,
  fields and chips have soft corners; dots, the microphone, spinners and the pin stay round. The
  site and shared demo pages keep their own look.

### Canvases

A project holds its cards on canvases, at least one: each card and group is on exactly one, a
workstream on its plan's. Layout, minimap, edge indicators, groups and the free spots new cards go
to are each canvas's own; repositories, settings, the demo site, the inbox count and Seismic stay
the project's. Every project has the canvas "main", which holds what the project had before it had
several (the database migration put every card and group there); it cannot be renamed or deleted.
Other canvases have a name unique in the project (in any case), never a number from 1 to 999,
since `#2` names a canvas by its place, an optional icon (one emoji, or `lucide:<name>` of a curated set of Lucide icons; anything else is refused), and a place
in the owner's order. Only a canvas without cards can be deleted; its archived cards go to "main",
where they come back from the archive. Its groups go to "main" too; one whose name "main" already
has (in any case) is merged into that group, so "main" never holds two groups of a name.

Where a new card goes: one the owner makes goes on the canvas they are on; a follow-up, a proposal,
a prototype and a Question card on the canvas of the card they come from; a plan found in a
repository on "main", with its workstreams; a plan written from an idea takes the idea's place on
the idea's canvas. What Seismic makes without a card to follow (a card it is told to make, a
retrospective's proposal) goes on the canvas the owner last had in view in a page, else "main".
Moving cards onto another canvas puts each at a free spot there and out of its group, which belongs
to the canvas it leaves; a workstream moves with its whole plan. A card moved to another project
goes onto the canvas the owner last looked at there.

The page shows the canvas its address's hash names: `#<name>`, `#<n>` its place in the order
(`#1` the first), none the first. As the page loads, a `#<n>` becomes the name of the canvas it
names, so reordering does not change what the address shows, and a hash naming no canvas goes; the
hash then stays in the address as cards open and close, so a reload shows the same canvas. Switching
canvas writes its name into the hash. A card's address needs no hash, since the card knows its
canvas: opening a card or a plan on another canvas, from search, the inbox, a link or a wait's stub,
switches to it and the hash names it, so a link with a hash naming another canvas opens on the
card's own. Search and the inbox list every canvas's cards, a card on another canvas than the one
shown marked with that canvas's icon (the inbox with its name too). Grouping offers the groups of
the canvas shown only. The camera is kept per canvas.

A tab strip sits at the bottom right above the status bar. With one canvas it is only a "+",
labelled "New canvas" until a canvas has been made or the drawer opened once; with several it shows
each canvas's icon (a canvas without one shows its name's first letter), the canvas shown as a
wider tab with its name, an orange count on a canvas whose cards wait for the owner, and the "+".
A click on a tab switches to it. The pointer on the strip (on touch, the first tap; from the keyboard,
↑ on a tab, which moves the focus into it) slides out a drawer above it: the canvases in order by name, each with its waiting count in orange, a click
switching to it; on hover or keyboard focus a row shows a pencil (rename and icon), a grip that drags it to another
place in the order, and a trash on a canvas without cards (never "main"); the drawer ends with
"+ New canvas". Tab and Shift+Tab can leave the drawer and keep focus at their destination;
Escape or choosing a canvas from the keyboard returns focus to the selected tab. Opening the
new-canvas or edit dialog leaves focus in that dialog. The "+" and "+ New canvas" open the canvas dialog: a name, checked against the
naming rule as it is typed, and an icon picked from a grid of common emojis and a curated set of
Lucide icons, or none; "Create canvas" makes it and shows it. The same dialog, from the pencil,
changes a canvas ("main" keeps its name and changes only its icon). What is typed and picked in it
stays until it is saved or cancelled, also across closing it and a reload. While a card is open the
strip lies under the dimming, so switching never leaves a card's unsent input behind; the drafts of
the Koordinator and of other cards are the project's and stay as they are across a switch.

The open card's "⋯" beside its labels offers "Move to canvas" with the project's other canvases
(only where there are others, and not on an archived card): the card folds away onto that canvas,
the canvas shown stays, and a line confirms where it went. A plan's container has the same "⋯" at
the end of its head, shown while the pointer is on the plan (always on touch): the plan goes with
all its workstreams. Its menu stands over the page, at the size of the page rather than the zoom,
opens under the button or, without room there, above it, scrolling where neither side holds it, and closes when the canvas moves under it (a pan, a zoom, a flight of the view). Esc closes the menu alone, the open card or plan staying open. A wait whose other card lies on another
canvas ends in a stub: a short faint arrow into the card from the left (what it waits for) or out
of it to the right (what waits for it), ending at a round button with the other canvas's icon that
names the card and canvas on hover and opens that card there.
With the project setting "Right click on a card" at "Manage canvases", a right click on a card (or on a
marked one: all marked) blooms a ring of the project's canvases around the pointer, built like the colour ring
(a ball with the canvas's icon, its name beside it, Esc or a click in the middle closes it). A click on one moves
the card (a plan with its workstreams, all marked cards) there with a line and "Undo"; the canvas shown
stays and its own ball does nothing. "Group …" on the marked cards still opens the colour ring.
The API (`/api/c/<project>/canvases`) creates, renames, re-icons, reorders and deletes canvases and
moves cards onto one; the Koordinator has the same as `new_canvas`, `change_canvas`,
`delete_canvas` and `move_to_canvas`, and sees each card's canvas and which one the owner looks at.

### Groups on the canvas

A group shows as a territory behind its cards: a soft glowing outline over a faint area in its
colour. Group colours appear only there and in the minimap, never on a card, so they do not compete
with the state inks. Zoomed far out, group names stand pale over their territories.

A territory is the contour of an energy field (Bubble Sets): the group's cards pull, near cards are
linked so they share one territory (not across another card), other cards push back, and where two
groups meet the stronger holds the ground (a card amid another group is an island). To keep the
edge tight, only the strongest pull counts at each point, not the sum (which bulges over every gap);
the narrow gap between two facing cards pulls like a card; and a card's pull is squeezed on a side
facing another card across a narrow gap, so the edge follows the gap's middle instead of hanging
down beside the other card as a tip. Contours are smoothed so they come out round, without grid
facets. Only fields that something moved near are recomputed, and a slow computation defers the
next, so a dragged card keeps the frame rate and its territory follows a little later; at rest
nothing is computed.

When cards change group, from wherever (the colour ring, the Koordinator, another page), a wave
runs out from where it was assigned, the territory overshoots and settles, and a light runs once
along the new edge, all in under a second (see the decision on large animations).

Marking: Shift + drag draws a lasso (without Shift it pans), Shift + click toggles a card (a
workstream: its plan; a click beside a plan's workstreams marks the plan); a lasso adds to what is marked. Marked cards carry drifting dashes and a
line with their count and "Group …". Dragging a marked card moves all marked ones, an unmarked one
alone. A click on the empty canvas or Esc unmarks. Two hints teach it, each until used once: after a
card was moved alone, how to mark several (gone after a few seconds, or at once with the next click,
canvas drag or scroll); beside two or more marked cards, that dragging one moves
them all.

Assigning: "Group …", or a right click on a card where the project's "Right click on a card" is "Manage groups", its default (that card, a workstream's plan, or all marked ones if it is among
them), opens a ring of colour balls: the groups, "+" (a new group, named in place) and "∅" (none).
Each group's name stands beside its ball with its count of cards still to be done (not finished, archived or a dropped idea; a plan by its workstreams); a group at 0 goes
pale, a candidate for deleting. Behind the ring the canvas steps back under a frosted halo and holds
still. Moving towards a ball picks it, a click takes it, Esc closes the ring. The picked group's ×
deletes it (its cards, archived ones too, belong to none), with "Undo".

A group belongs to one canvas and holds only cards on it; group names are unique per canvas.
The Koordinator has the tools `group` (by name; a new name creates the group), `ungroup` and
`rename_group`, and sees each card's group.

### Refusals

The server words no UI text for refusals: it answers with a stable error code and an English detail
for developers (a failed start's log entry carries the code too). The UI shows its own text per
code, a generic one otherwise.

### Decisions

- **A canvas's cards and groups point to it without a database foreign key** (2026-11-07): SQLite
  cannot drop a column that is part of one, and a column added to an existing table cannot be
  required either; the server sets it on every card and group it writes, falling back to "main".
  "main" is known by its name, which is why it keeps it. Rejected: a flag for the first canvas (the
  owner may reorder, and `/p/<project>` opens whichever is first).
- **The bar says "Online" only while the server answers** (owner, 2026-11-07): an open WebSocket
  proves nothing when the server's event loop is frozen, so the page pings every 5 s and any
  message counts as an answer. Ten seconds without one reads "Server not responding …"; from
  2½ minutes on, "Unresponsive since <time>" (the time of the last answer). A lost connection reads
  "Reconnecting …", and "No connection since <time>" after the same 2½ minutes. Rejected: trusting
  the socket's open state alone, which showed "Online" through a freeze that blocked videos and
  project switching.
- **Status, voice target and usage in one status bar at the bottom** (owner, 2026-11-05): the
  connection, a waiting restart, whom the microphone speaks to and the usage limits used to be pills
  in the top bar and a line under the microphone; gathered along the bottom, the top bar keeps the
  project's controls and the state of Seismic reads in one place. Rejected: keeping them in the top bar,
  where they crowded the buttons and dropped out first in a narrow window.
- **What the agent does is read from its steps** (owner, 2026-11-03): the word on a working card
  comes from the tool calls, their results and the pauses between them, so it costs the agent nothing
  and cannot be forgotten. Thinking is a pause without a running tool rather than the model's
  thinking blocks, which arrive only once the thinking is done. Rejected: a tool or instruction for
  the agent to announce its phase, which it would call late or not at all.
- **Path addresses with short card codes** (owner, 2026-11-01): a card's address is a permalink
  that survives a reload and can be passed on, and paths leave room for views nested deeper. The
  code is stored, not derived from the cards there are at the time, so a later card whose id starts
  alike cannot make an earlier link ambiguous. Rejected: query parameters (`?c=`, `?card=`), and
  the whole id in the address, which is long to read and pass on.
- **A project's own settings behind a gear in the floating row** (owner, 2026-11-05): settings that differ
  from project to project (models first, then the labels Seismic suggests) belong one click from the
  project, in a sheet beside the cards rather than in a dialog over them. What the project leaves open
  follows the Configuration, so a change there still reaches every project that did not choose
  otherwise. The gear took the bar's "Configuration" button's place, which moved to the left menu
  and the sheet's foot: two settings buttons side by side would leave the owner guessing which is
  which. Rejected: copying Configuration's models into each project (a later change there would reach
  no existing project), and the project's page in the Configuration dialog as the only place.
- **The inbox a full-page view, "Needs you" a sheet** (owner, 2026-11-09; replaces "The inbox on
  the right", 2026-11-05): what waits is worked down in a list beside the cards it opens, across
  projects; as a view of the main area opened from the left menu, like the archive, the list gets
  the room of the page and leaves the right edge to Seismic's sheet, and the card unfolds beside the
  list instead of over a sheet. The cards alone, the everyday part, stay one click away behind the
  bell as a sheet, the shown project first. Shared entries, layout and actions on desktop and phone
  keep their behaviour consistent; the desktop sorts by the time shown, newest first, and the phone
  newest update first. Rejected: the inbox as a dock view (it competed with Seismic's sheet for the
  right edge), and a list on the left that closed on every click or grouped entries by project,
  which hid which wait was oldest.
- **Inbox entries read and unread** (owner, 2026-11-07): an entry already looked at still stood out as
  new. Read is kept per entry and wait, so a card that asks again comes back unread, and only unread entries are marked. It is kept in the browser,
  as what of a conversation was seen is: no new server state for a view-only marker. Rejected: read
  state on the server shared by phone and desk (more state for a marker; can follow if wanted);
  hiding read entries outright (they still wait and are answered from the list).
- **The inbox's entries answer in one click** (owner, 2026-11-02): with several things
  waiting, opening each card for a decision its summary already settles is slow, and an inbox one
  cannot answer from is a list to work through twice. Only the decisions the card's own default
  button makes are offered, and those that set work in motion wait out an undo, since a list is
  clicked by accident more easily than a card. Rejected: entries that only open their card (a click
  is then made with the card's demo and remarks in view, but every decision costs a round trip);
  a separate inbox for the replies, which would be a fourth place for what waits.
- **Waits are always on the canvas, as faint lines** (owner, 2026-11-02): with waits shown only
  under the pointer, the overall picture was missing, and one forgot that Seismic tracks them at all.
  There is no switch to hide them. Rejected: stubs at the cards' edges only (they say there is a
  dependency but not the picture), and a layer behind a button (it does not keep the waits in
  mind).
- **A finished card keeps its dependencies** (owner, 2026-11-04, extended to every card 2026-11-06):
  with a finished card's lines gone, the picture of what its delivered work unlocked next was lost.
  Dim green says "delivered", against the grey and orange of waits, for every finished card in a
  plan or not; delivered chips are muted green to match. Rejected: a blue tone while the target
  is still open (one more colour to learn), and keeping them grey, which reads as one more wait.
- **The owner may draw dependencies between task cards** (2026-11-02), beside the waits Seismic
  infers: single cards have no plan doc to say what comes first, and the owner sometimes knows an
  order that a conflict check cannot see, without wanting to turn the cards into a plan.
  Rejected: arrows to or from plans and workstreams, whose order the plan doc decides; a trash
  button on inferred waits, which Seismic would infer again at the next start; a confirmation dialog
  before removing an arrow, where "Undo" does the same with one click fewer. A click on empty
  canvas while drawing makes the waiting card (2026-11-04): the next step often has no card yet,
  and making one first, then drawing again, took a detour.
- **Path addresses with short card codes** (owner, 2026-11-01): a card's address is a permalink
  that survives a reload and can be passed on, and paths leave room for views nested deeper. The
  code is stored, not derived from the cards there are at the time, so a later card whose id starts
  alike cannot make an earlier link ambiguous. Rejected: query parameters (`?c=`, `?card=`), and
  the whole id in the address, which is long to read and pass on.
- **Closing a card goes back a step** (owner, 2026-11-02): an open card is a view over the canvas,
  like a dialog, and the phone already closed cards that way. Rejected: closing as a step of its own,
  after which Back opened the card that was just closed.
- **The look is frost, on shadcn/ui with Tailwind** (owner, 2026-11-05, 2026-11-10): frost is
  one stylesheet with one token set (board, glass, inks; light, dark by system, dark by choice), and
  its tokens are the values behind shadcn/ui's variables
  (`--background`, `--card`, `--primary` …), and the state inks and glass are Tailwind tokens of their
  own, so a shadcn part wears frost without a rule of its own; `dark:` follows the owner's choice of
  light or dark, else the system's. Controls are shadcn parts on Radix Primitives in
  `src/ui/components/`, added through the shadcn CLI and edited freely once copied; AI Elements serve
  the conversations. Glass on every card was chosen over frost on the chrome alone with solid cards:
  the stronger look, at a cost measured with about 100 cards on screen at middle zoom on a 2560×1440
  window, where blurring every card dropped to 49 fps with a GPU and 23 fps without one; dropping the
  blur while the canvas moves brought it to 60 and 55 fps, against 60 without glass. Solid cards
  remain the fallback. While the hand-written stylesheet is still being replaced, Tailwind runs without
  its reset and its utilities sit in a cascade layer under the old stylesheet, which therefore wins
  where both style a property; no class of the old stylesheet may share a name with a Tailwind utility
  (`hidden`, `fixed`, `ring`), since the utility would apply to it as well. Rejected: our own
  stylesheet on Radix Primitives (2026-11-09, reversed 2026-11-10: every control, popover and dialog
  was being rebuilt by hand, and the ready-made higher-level parts and conversation components were
  out of reach); shadcn's neutral look; porting shadcn's behaviour into our CSS; Tailwind only in the
  conversations; a prefix on every Tailwind class, which would have kept old and new apart at the
  price of every generated part's classes; Base UI, with a smaller set of mature parts; keeping frost
  as a layer over upstream's stylesheet, which made every rule depend on the layer that overrode it
  (merged into one on 2026-11-10). The earlier
  look, index cards pinned to a wall (2026-10-10), is gone.
- **The inbox opens a list instead of jumping to the next card** (owner, 2026-11-01): with
  several things waiting, a jump hides what the others are and cannot answer anything. Entries are
  newest first on desktop (owner, 2026-11-08), as in a mail inbox,
  with "Unread" the default filter so what is still to do stays short.
  Mobile uses newest update first (owner, 2026-11-07), so a refreshed demo rises to the top.
  Rejected: keeping the jump on the button (Tab keeps it).
- **Groups are contours drawn in SVG** (2026-10-05): calm, no WebGL, no cost at rest. Rejected: two
  WebGL shader prototypes ("plasma" areas, a drifting honeycomb), livelier but costing frames all
  the time.
- **Reduced motion is a setting of its own, not only the system's** (owner, 2026-11-05): the owner
  wants Seismic calm without changing the whole computer, and it covers the blur too, which the
  system's reduce-motion setting does not name but which costs the same attention and GPU. One
  switch for both; rejected: a separate setting for the blur, two controls for one need.
- **Nothing on the canvas animates a large area for a second or longer** (2026-10-15). Chrome's
  screen capture (a demo's screencast, a shared tab) locks onto a large area changing every frame;
  once it stops, the capture drops all changes for about 0.27 s. Hence the canvas holds still behind
  the colour ring and the group wave stays under a second. Rejected: dropping the halo's blur, which
  would leave the cards' text readable behind the ring's names.
- **The lasso marks cards rather than opening the colour ring** (owner, 2026-10-21): marking first,
  as in Figma or Miro, grouping a click away. Rejected: the ring on every lasso, closed by dragging a
  marked card.
- **A group ends with its last card** (2026-10-06): no empty groups to clean up. Deleting exists for
  groups whose last cards sit in the archive, out of the ring's reach.
- **A plan the owner does not work on collapses** (2026-10-21): it stays in sight and needs no
  second list. Rejected: hiding plans into a list beside the archive, filtered by the plan doc's
  git author ("Only my plans").
- **`?` only teaches** (2026-10-15). Rejected: a permanent `?` button. A "New task" button that
  only taught the double-click left the bar with the new menu (2026-11-09).
- **A card's title is optional** (2026-10-15). Rejected: a required title, which dropped untitled
  cards with their text.
- **The queue is part of Agent work's "Todo"** (2026-11-07; the two groups 2026-11-09), opened from the agents' robot button with a grey badge counting the
  queued cards, so that what the agents do and what waits for them stand in one place (owner).
  "Working" and "Todo" replace stage groups with chips per stage, which were more than the owner
  read, and "Needs you" left them for a sheet of its own. Rejected: a drop-down list under a button
  of its own in the bar, which kept the queue apart from the cards being worked on; and the queue
  inside the Koordinator's sheet.
- **Activity is a tab of Agent work** (2026-11-08), not a part of the inbox (the inbox is for
  what waits for the owner) and not a sheet of its own (the bar is full). Rejected: an unread count
  on the robot button, as a log has nothing to answer.
- **The usage limits come from Claude Code's `/usage` data** (2026-10-28), asked through the
  Agent SDK of an idle session. Rejected: calling the plan's usage endpoint directly with the OAuth
  token read from the keychain or Claude Code's credentials file, which ties Seismic to where and how
  Claude Code keeps its login; and the rate-limit events of running agents alone, which say little
  until a limit is close and nothing while no agent runs. The SDK marks the call experimental: when
  it changes, the bar shows nothing until Seismic follows.
- **The usage limits outlast the last page by half a minute** (2026-10-29). Rejected: closing the
  session and forgetting the numbers with the last page, which left the bar without them for the
  seconds a new session takes after every switch of project.
- **The usage limits' list opens on a click, not on hover** (owner, 2026-11-02), as the bar's other
  menus do. Rejected: hovering, which spread the list over the canvas whenever the pointer crossed
  the bar.
- **A card's priority is a label, not an order** (2026-11-03): six levels, from Trivial to
  Critical, that the owner sets and reads on the cards; the queue keeps its own order (see The
  queue's order in The Koordinator). Rejected: priorities that also order the queue (the owner chose a
  label only).
- **One left menu for everything that is not on the canvas** (2026-11-04, 2026-11-09, the owner):
  views about no one project and a single "Preferences" entry sat behind the logo, and the
  projects in a pinnable picker of their own; merged, the owner finds the inbox, the project's
  views and Seismic's settings in one place, and the bar keeps only what is about Seismic as a
  whole. The Configuration keeps what sets up the work, notifications, usage limits and other
  devices included; only language, theme and the server moved out into "Preferences", which the
  menu names as a dialog, not by its sections. The menu docks like the picker did, since the
  inbox, the queue and the archive are now views kept open beside the project. Rejected: the
  logo's menu and the picker side by side, two menus for two halves of one question (where do I go).

- **The bar measures what fits** (2026-10-12). Rejected: container queries on the bar's width, which
  let a long branch or a large pool push buttons under the sheet.
- **An unfolded card is as large as its content, up to the room it has** (2026-10-08, 2026-10-21).
  Rejected: filling the room (empty space, stray scrollbars), a fixed size (small on a large
  screen), and a proposal sized by its text alone (a long conversation scrolled in a small box). It may reach over the bar (2026-10-09), as keeping the bar free cost moderate windows much
  room, and over a docked sheet (owner, 2026-11-02): the sheet is dimmed and out of use while a card
  is open, and keeping beside it squeezed a split into the canvas's width.
- **On touch, one finger pans and a long press picks up a card** (owner, 2026-11-05). Rejected: a
  finger on a card dragging it, as the mouse does, which on a full tablet canvas moved cards on
  nearly every attempt to pan. The touch gestures live apart from the mouse handling and only
  report gestures to it, so the desk behaviour stays as it was.
- **The on-screen keyboard leaves the page in place, cut to what it leaves** (owner, 2026-11-05):
  on an iPhone and an iPad Safari's pan pushed the bar off the screen and the conversation with it.
  The whole page is pinned, not each view on its own, so every view fixed to the screen follows.
  Rejected: stopping Safari's pan (no way to do it that holds across versions); each view following
  the visual viewport by itself (the phone panel did, and every other view slid away).
- **The sheets are a docked sidebar** (2026-10-06, 2026-10-09). Rejected: panels floating over a
  full-window canvas, which cut off cards and covered the microphone. Seismic's button becomes the
  sidebar's corner (the owner's wish) rather than sliding with the bar.
