## Conversation on the card

A chapter of the [design doc](../design.md), whose header says how it is written.

### The conversation

Every kind of card shows its exchanges as one conversation ("Conversation"), built once
(`src/ui/talk.ts`). Messages are the owner's words (spoken or typed, with screenshots, once, as the
agent got them); the agent's questions with their options and the owner's pick marked on them; its
replies; its handovers (the one a demo came with carries the report's question, with its options
and the owner's pick marked, muted once answered; a handover in the same turn as a reply stands
under it after a dashed line as "Handover"); and what the Koordinator looked up. Small lines between
them mark state changes (waiting for other cards before the start, and why; started, pull request, approved, landed, the demo's link put on the pull
request, stopped, errors, usage limit); an address in them is a link (the comment on the pull
request, say). Everything else (tool calls, thoughts, status
lines, Seismic's notes) folds away as "History" under the agent's next message. Seismic's reply to what
the agent passed on (`to_seismic`) answers a step in that "History", so it stands under that message,
with what Seismic says after it until then (the answer it looked up); while that message has not come
yet, below the agent at work. The owner's words or a state line before the message keep it where it
came, below the agent's steps up to there. What Seismic reads to look a question up on a card (asked
there by voice, or passed on by its agent) is not the agent's work: it stays out of the agent's
"History" and its bubble at work, and folds under the answer Seismic looked up; while Seismic still
looks, under its reply that it does, where that reply stands. On a Question card Seismic's agent is
the card's own, so its reading is the card's agent at work.

A card the worker proposes from a conversation appears there as "Proposed new card", above
its clickable cover with the canvas's dashed proposal design. It stays visible outside the folded
steps, including when the worker replies or hands over afterwards. The cover follows the card's
current state once accepted; a replacement proposal gets its own entry, and a withdrawn one keeps
its original title without a link. Proposals on another canvas link there.

A follow-up card Seismic makes of the card (asked for in words on it, passed on by its agent, or a
review's follow-up task) is an action of Seismic's in its conversation, set apart from what is said:
another colour and the small print's face, a dashed frame, "Seismic · Created a follow-up card" above the
new card's cover in small, as the canvas shows it now (its state, its question). A click opens that
card by its address, in place, a modifier click in a tab of its own. One that went onto another
canvas opens there; one gone from the canvas (archived, deleted) shows the title it had, not a link.
The action is logged once the card exists, after the undo window, so a command taken back leaves
none; until the agent's next message it waits with Seismic's reply to what the agent passed on, and
goes under that message with it. A note the worker
answered without `reply` counts as answered by its next words, unless a reply follows before the
owner says more. Once no agent works on the card and no question is open, steps after the last
message stand where they happened, the agent's last words among them as its message. A card that was
an idea continues the idea's conversation.

Claude login errors offer "Reauthenticate" in the conversation, or, when a failed start's
explanation above it shows the error, there alone: one error gets one button.
It opens the same terminal login as Setup, even when the login check still reports an account
after a session failed to refresh. The error stays visible. The action reports whether a terminal
opened, offers the manual command, and tells the owner to send the message again after signing in.
A session that signed in with a token instead of this machine's account (on another machine, or
here on `CLAUDE_CODE_OAUTH_TOKEN`), which its error records, gets "Create a new token" there
instead, since a new login here would leave the token expired: the terminal runs
`claude setup-token`, and the token it prints goes into a field beside the error, which Seismic keeps
as `claude-token` for the sessions that start from then on. The field is not kept as an unsent
draft, since it holds a secret. Errors recorded before sessions said how they signed in offer the
login.
The terminal opens on the machine Seismic runs on, so on the phone and on any other device the error
offers no button, only the hint that the login happens at that computer, where the same message
offers it.

A Claude login error is one in Claude Code's own words: its `/login` or `claude auth login` hints,
"Failed to authenticate" with an OAuth or 401 API error, or "not logged in" on the stderr of its
process's exit. The server words a session's failure by the same rule ("Claude is not logged in on
this machine …"). Another tool's login error (gh's, an expired OAuth token of some API) offers no
Claude login.

The speaker's role is followed by the harness and model that produced the message, when known.
This holds for card replies and open questions as well as the Koordinator's reply and a looked-up
answer, which can come from different models. Attribution is recorded when the agent speaks and
survives a restart or a later change of defaults; old messages with no known identity stay unlabelled
rather than taking today's model. The bubbles of an agent at work (a card's worker, an idea's or a
Question card's agent, the reviser of a proposal, the Koordinator reading, an answer being looked
up) name the harness and model of the session that runs there now, read from that session, never
from the defaults: its harness and chosen model from its start, the model it resolved once it says
(a "default" choice), and nothing once that session ended (a paused card whose session ended shows none).

Agent words are kept whole up to 12 000 characters (a worker's `reply` is cut at 2000). While the
worker works, the conversation ends with it at work and its latest step on one line, with its
background work that runs ("In the background", each with how long it has run). Once the card waits for
the owner (handed over, asked) and the worker's turn has ended, nobody is at work on it, even while
its background work runs on (the app served for the owner to try): the conversation then shows only
that work, under "In the background", without the agent at work or its step, and there is nothing to
pause. Until 2026-10-22 it showed the agent at work as long as such work ran, which read as if it
were still working on the change while the card waited for the owner. A card that waits on a
question ends with it, its options and the card's one field.

How a question ended is one rule for every kind of card, read from what came after it: picked
options stand ticked (an answer in the owner's own words ticks the options it names); asked again in
the same words, it reads "Asked again below. ↓", linking there, options greyed; passed
over by the owner's words and then a reply that does not ask it again, "Settled by your message." without options (nothing while that reply is still being written); left without a word
when the card went on (built, taken on, parked, archived), "Left open.", options greyed. A
rephrased question counts as settled. An answered question keeps only its orange label, not the
orange edge.

Which questions are open is one rule too (`openQuestions` in `src/core/types.ts`): an idea's while
its agent is not replying, a proposal's while not being reworked, a worker's while the card waits
for it, a demo report's until answered; a parked or dropped idea has none. Open questions move to
the conversation's end under "Question for you" ("Questions for you"), and only then does the field read
"A remark – optional" and "Answer". Every question with options ends with one more choice, a field
"Your own answer …" in place of an option's label: writing in it picks it (on a single-choice
question in place of the option picked), and it goes out like a pick; a question without options
has that field alone. Where the picks travel apart
from the words (a worker's or a handover's question), the own answer leads the owner's words as
text, named by its question where several stand; where the answer names each question (ideas,
proposals), it stands as that question's answer, ticked on the question after its options like a
picked one; a proposal accepted with it takes it as decided. It stays in the card's draft with the
picks, written but not picked too. The owner's words the agent read only
after it asked (said while it worked, they reached it after the question) go along and stay below
the question, as everywhere in reading order: above it they would read as words the question took
into account, and once it is answered and back in place they would jump below it. Anything of an
agent's after the question leaves them where they were. The canvas card, the phone's count and
the Koordinator name the same questions. How agents ask: see Questions go to the owner.

Messages new to the owner (after the last event they had in view and their own last words) have an
orange edge until the conversation closes; the phone's button counts them. One that arrives while
the conversation is in view gets none; one that came while the page was hidden keeps it. Seen state is kept per browser, on desktop and phone alike.

A code block in a message (and in any Markdown text a card shows) wraps its lines and has a copy
button in its corner: agents put there what the owner is to take elsewhere as it is (a command, a
message to send). At the desk the button shows while the pointer is on the block, for newcomers too; on a
touch screen, which has no hover, always. The button puts the block's exact text on the
clipboard and reads "Copied" for a moment. Where the page may not write the clipboard (served over
plain HTTP to another machine, as through a VPN, where browsers offer no clipboard API) it selects
the block's text and copies the selection; where even that fails, the text stays selected and the
button reads "Selected: press and hold to copy".

A conversation scrolled to its end follows it as it grows; scrolled up, it stays put, and only the
owner's own words or actions take it to the end. Seismic's sheet does the same.

### Reading order

A conversation shows things in the order the agent saw them: the owner's words stand where the agent
read them, not where they were sent. Seismic holds them while the agent is in a turn and records after
which log line it took them in; the steps before close above them, the rest below. Until read, they
stand below the agent's work, muted and dashed, "Not read yet · at its next step" (on an
idea, proposal or Question card "… · after its current reply"). Each has a bin: taking it back
removes it, no agent hears it, and its text and screenshots return to the field if that is empty. No
undo. A page that lost its connection reloads each open card's log on reconnect, else words would
stay "Not read yet".

A worker reads them with the result of its next tool step, through the hook that also passes it
preferences and decisions, screenshots as file paths (a tool result carries no images); a turn that
ends before another step starts the next with them; a step that ends the turn (`ask`, say) carries
them in its result, which leaves the turn to the worker (see A worker's tools); a session
that ends first gets them with the message it resumes with, after a stop at the next start. An
idea's agent, a proposal's reviser and a Question card's agent read them when their next turn
starts. Words said between turns start the next turn.

### Replying to a message

On a card and in Seismic's sheet the owner can reply to one message, as in chat apps: a button in its
corner (at the desk while the pointer is on the message, for newcomers too; on a touch screen
always)
puts it as a quote above the field, removable with × or Escape (before Escape closes the card or the sidebar); typed or spoken words go out with
it. The quote is part of the field's draft, so it survives closing the card and reloads. The sent
message shows the quote's first lines; a click scrolls to the original. Only messages can be quoted,
not steps or state lines.

The agent reads `[In reply to your message: "…"]` above the words: about 160 characters of what it
already has in its session, else the whole message (Seismic's words, which the worker never got). The
Koordinator always gets the quote whole; in the sheet a looked-up answer by its tag (`A12`).

### Quoting marked text

To answer a part of a message, the owner marks it in the conversation, in anyone's message, their
own included; on a card with a field and in Seismic's sheet a small button with a quotation-mark icon
appears beside the marking (named "Quote" beside the icon until used once). The same holds for
what such a card shows beside its conversation (an idea's brief and mocks, a task's text, an HTML
artifact, a file the card shows, formatted or as a page) and for a page an answer in the sheet comes
with: the quote goes into that card's field, on the phone opening the panel the field is in. A
framed page is the worker's and cannot be read from Seismic's page, so every page Seismic frames on its
own page (not a shared copy) tells it what is marked in it, with where its first and last line
stand. Only the frame the owner is in is heard, the button stays beside that frame whatever the
page says, and the text reaches the field only on the owner's press. There is one marking at a time: a new one in a frame takes away the
page's, a press on Seismic's page the frame's, as one page's marking would. At the desk it
stands at the end where the pointer let go, outside the marking; on a touch screen below the middle
of the marking's last line, clear of the selection handles and of the system's menu above. A press
puts the marked text, on one line, in quotation marks of the UI language into the field, followed by
" - ", with the cursor behind it and the focus in the field (on the phone the keyboard opens at the
first tap). Where it goes depends on where the cursor stood when it left the field: at the end of
the text (or never in this field since it was shown), at the end, after a line break unless that is
the start of a line; anywhere else, as the line after the cursor's line. It is typed in as by hand,
so ⌘Z takes it back. Unlike replying to a message, the quote is plain text of the draft: the agent
reads it as the owner's words.

### The task as first message

Once the agent starts, a task's text and screenshots stand as the conversation's first message,
labelled by origin: "You", "Idea" (a prototype), "Proposal" (an accepted proposal), "Seismic" (from
the work retrospective). A long text folds under "more", and "Likely affected" folds under
it. A card that was an idea shows its brief on the left instead; a workstream its plan-doc text
under "Plan doc" (see Plan docs).

### Card layout

Every card with a conversation (idea, proposal, a task an agent worked on) is laid out the same way:
what it is about on the left (brief, proposal text, demo with chapters and sharing, result files,
pull request, what landed), the conversation on the right with the open questions and one field with
one Send, and the decisions (build, accept, approve, stop, archive) in a row below both. The last
demo stays while the worker works again (see The demo on the card). A task with nothing for the left
yet is its conversation alone, as narrow as that, and widens once there is a result. A task waiting
for its first start (planned, snoozed to start later, or in the queue) is a split: its full text
(editable where the owner wrote it) and what it waits for on the left, its conversation on the
right. Only a card the owner has just created stays its text alone until it closes or starts, so the
task goes into the text, not into a note.

A planned card nobody has worked on answers at once: what the owner types in its field
("A question or note – Seismic answers now …") goes to an agent, Seismic's answering agent (the one
that looks up the Koordinator's questions, with a worker's tools to read and check), which replies in
the card's conversation while the card stays planned: the owner asks what the task would involve, what
the code says, or tells it what to keep in mind. It resumes for each message, a new one starting from
the conversation so far when its session is gone; words that come during its turn wait for the next,
unread until then, with a bin; it shows at work and can be paused like any agent; its answers pass on
what asks Seismic for something (`to_seismic`, "start that", say). What was talked over is part of the
task: the worker that starts the card gets the conversation with it, and so does the exploration agent
of the card made an idea. Spoken words still go to the Koordinator.

A planned card a worker already began on (a stopped one), one waiting for a new repository, a review
card and a prototype have no such agent: the field takes notes for the worker that takes the card on
("A note to the agent – it gets it once it starts"). Typed notes stand unread ("Not read yet · once the agent starts", with a bin to take them back) and go to the worker with the task
when it starts, by the owner's click, at the time it was snoozed to, or out of the queue; a stopped
card's worker gets them with the message it resumes with. Made into a plan, the card's worker
gets them with its task; discussed as an idea, its exploration agent opens the discussion with them.

The field is the same on every card and in Seismic's sheet: one frame, the text growing up to 30 % of
the window (no scrollbar below that), the screenshot button, the microphone (see Voice in) and Send
in its bottom corner. Beside a short text the three stand side by side; once the text is about as
high as the three stacked (three lines on the phone), they stack in a narrow column and the text
gets the width; the switch is judged at the stacked width, so it does not flip back and forth. The
placeholder shows in full, on two lines where needed, since it often says what the agent does with a
message (the owner, 2026-10-17). Send is an arrow in a dark circle, as in chat apps; a button that
starts something rather than sends keeps its words ("Start prototype").

A review card's findings (see Review cards) stand above its demo, each with its choice; the findings
of a code review (see Code reviews in Card lifecycle) stand in the card's Review tab, as the same
element. What the owner chose stands above the field like a quote and goes out with its one Send, the
words beside it.

Under a task's title stand its branch (and plan doc) and the size of its change ("+120 −30 in 5 files"; where the card shows its change list, the size stands below the list instead): before landing the workspace against where its base branch was, uncommitted and new files
included; after, what the landing put on the default branch (an archived card keeps it). A click
shows the whole diff over the page; "Copy path" copies the workspace's directory (`host:/dir` on
another machine). The owner rarely reads code, so it stays a quiet line.

#### The files beside the demo

What a card's work made or changed is its result, shown on the left for folder and git cards alike.
The top of the column has a row of tabs: "Video" first where there is a video, "Document" for an
HTML artifact or named HTML result, "Schema change" for a named schema-change page, "Review" for
the code review of the work where the canvas reviews it (its open findings counted beside the title
by severity, from dark purple through grey; "outdated" where it reviewed an earlier handover), and "Diff"
for the underlying change list. Other named result files have tabs named after their files. Only
available results have tabs; the first opens by default. The demo and named results show without
the change list above them. Named files show their contents first, with the caption above the view.

The Diff tab contains the change list: a line per file with its sign (＋ added, ✎ changed, ↪ moved
or renamed, ✕ deleted), its path cut at the front so the name stays, its lines added and removed,
and on a folder card what discarding would leave. The files named at handover come first, then
other changed files that can be shown, documents first; last, greyed and not to be picked, deleted
files, directories and files that are neither documents nor text (their line counts still open
their diff). A click on a line shows its file below, a click on its line counts its changes there.
Where that view lies out of sight, the click scrolls it into view. Past eight lines "and N more ▾"
unfolds the rest. The file picked stays in view when folded. Beside the toggle stands the size of
the whole change ("+120 −30"), which shows the whole diff over the page. On a git card the lines
are the branch's files, on a folder card its change list. The phone has the same tabs and list,
with controls tall enough to tap. Markdown shows formatted (with its images), a PDF in the browser's
viewer (on a phone, and where the browser has none, its pages drawn by pdf.js one under the other
as wide as the column), an image as is, an HTML page as an HTML artifact, text and code as text; anything else as a
tile with "Open on the computer". In Diff, a changed file first shows "Changes", with "Formatted" or
"Whole file" beside. "Open on the computer" and "Show in folder" act on the machine Seismic runs
on (a non-document only in its folder, since opening would run it), and only for a request from that
machine; from another device the file downloads and "Show in folder" says it works only there.
The column keeps its tallest height so the card does not jump; a PDF's viewer is as high as the
column shows, so its scrollbar is the only one; a video left for another file stops.

A card with named files, or a folder card handed over without a demo but with files to show, is a
split even without a demo; the server decides at the handover so the layout does not jump. A worker
names only files of its change, or a page in its demo's directory (see A change to persisted data
models in Demos), at most twelve, or is asked again; without `files` later the earlier
ones stand, an empty list removes them. An open view reads its file afresh when a handover arrives
or the work changes it.

Seismic serves only the files the card made or changed and images their Markdown shows, nothing else
and no link the card made; on a branch it reads git's NUL-separated name list, as diff headers
misread names with spaces (`x b/notes.md`). It reads from the workspace while there is one, else the
landed commit or branch (to open a landed card's file, the checkout's copy). Files are served like
an HTML artifact (see The demo on the card), except a PDF: no browser shows one in a sandboxed frame
or under a CSP sandbox, so it comes unsandboxed with `nosniff` and a policy allowing nothing
(`default-src 'none'`, `form-action 'none'`, `Connection-Allowlist`). Chrome's viewer runs PDF
scripts; tested on 2026-10-21, a PDF submitting a form, opening a link or calling
`getURL`/`launchURL` sent nothing. pdf.js runs none of a PDF's scripts, links or forms; it comes
from Seismic itself (its legacy build, which phones' older browsers run), outside the page's bundle,
under the address of its version, so a browser caches it for good.

#### Trying the app by hand

"Open app ↗" at the end of the branch line opens the app running in the card's workspace in a new
tab; a plain link, as it is rarely wanted. The worker reports the address with `app_running(url)`
(an empty url when it stops it); the card keeps it until cleared, parked or the workspace goes. The
link shows only while the app answers (any HTTP answer, probed by the open card). It goes through
Seismic, which keeps the app running at least 30 minutes after, so parking does not stop it under the
owner.

For a workspace on another machine (see Hosts) the probe and link go through an `ssh -L` forward of
that one port to a system-picked free port here (never the same number, which a local clone's stack
may need), made at the first probe, ended when the app is no longer offered or Seismic stops; its
remote command waits on stdin so it dies with Seismic. A dropped forward is remade on the same port,
so an open tab keeps working. A page calling an API on another port finds nothing (the worker's
brief says so).

### Screenshots

What the owner writes on a card may carry screenshots: pasted, dropped or picked with the field's
image button, scaled to at most 2000 px in the browser and uploaded at once. They show as thumbnails
in field and conversation and reach the agent as images in the message, with their paths. A click
enlarges one over the greyed page; Esc or a click shrinks it back. After the first screenshot picked
by file dialog, a hint under the thumbnails names the paste and capture keys (⌘V / Ctrl+V, ⌃⇧⌘4 /
Win+Shift+S), across sends and reloads, until "Got it" or the first paste; never on a device
without mouse or trackpad.

A planned card's description takes screenshots too; its worker (or idea agent) gets them with the
task, and building an idea adds those from its discussion. A command in the Koordinator's sheet may
carry screenshots; they go with each action that creates or concerns a card, and join the task of a
card it starts. A spoken command takes the screenshots of the field it speaks to (see Drafts);
dropped on the microphone or pasted outside a text field, they land there. Only with no card open
and the sidebar closed does the microphone keep its own screenshots beside it; they move into the
sidebar's field when it opens and back when it closes (its words stay in the sidebar's field, the
paths of dropped files go back with them, see Other files). An
open card leaves them beside the microphone, out of sight until it closes; they are for Seismic, not
the card's agent.

### Other files

A file of another kind (a PDF, a log, a spreadsheet, a folder in the app) dropped on a field or on
the microphone, or together with screenshots, goes in by its path, as a terminal agent's prompt
takes a file dragged from the file manager, so the owner can have the agent read it, move it or
change it where it lies. The app knows the path from the system (see App). A browser does not tell
a page where a dropped file lies, so Seismic looks for it on its own machine: Spotlight on a Mac, else
(or when that finds none) Downloads, Desktop, Documents (also under OneDrive) a few levels deep and
the home itself, hidden folders left out; a file counts only with the same name, size and time
(within two seconds), and only if exactly one fits. Otherwise (a browser on another device, two
copies, a file elsewhere) Seismic keeps a copy under its home (`files/<canvas>/`, at most 100 MB, in a
folder of its own under its name made one word) and the copy's path goes in.

The path goes into the field's text at the cursor while the field has it (⌘Z takes it back), else
where the cursor last stood or at the end, parted by spaces, in quotes where it has a space; the
focus stays where it was, so the microphone still sends rather than dictates. Dropped on the
microphone with no field to take it, the path waits beside the microphone under the file's name (×
removes it) and goes with the next recording; it moves into Seismic's field when the sidebar opens,
and back beside the microphone when it closes, as the screenshots do, while it still stands in the
field's text (the words around it stay there).
While a file is looked for or uploads the field shows "uploading …" and does not send, and a recording
waits for it (and for screenshots still uploading) before it goes. The image button's picker stays
for screenshots; its tooltip names dropping other files.

A recording nothing came of, or that Seismic refused, leaves the screenshots where they were. When the
connection breaks before the answer, the page asks Seismic by the recording's id whether it arrived,
and returns words and screenshots to the field only if not; the command's line then says "Seismic has it; only its answer did not come through." instead of "That did not work".

### Skills by `/`

A Codex task worker offers Seismic's bundled browser, demo and settings skills, with their descriptions.
Its menu comes from the supplied skill files, without starting Claude or advertising Claude-only
commands. The selected `/obeya:name` and the owner's words reach Codex unchanged; its instructions
point to the corresponding file. User and repository Codex skills are not part of this preview's
menu. The card's pinned harness, not a newly changed default, selects its menu.

For Claude agents, in the field where a card's agent hears the owner's words (a task's, an idea's, a review card's; not
where the Koordinator reads them, nor on a Question card), `/` at the start of the text or of a word
opens a menu of the skills the agent can be asked for, as in Claude Code: the repository's, the
user's, those of the plugins the agent loads (Seismic's own for a worker) and Claude Code's own skills
(`/code-review`), in that order, each with its argument hint and the first line of its description;
not Claude Code's controls of a session (`/compact`, `/model`), which Seismic runs itself. A path
(`/src/ui`) opens none. What follows the slash filters: names that start with it first (also after a
plugin's prefix, `obeya:demo`), then those that contain it; the menu shows only while something
fits. The arrow keys mark, Enter, Tab or a click picks, Esc closes the menu and leaves the card
open. Picking types `/name ` over the word, as if by hand (⌘Z takes it back). The words reach the
agent as they are: Claude Code's skill tool takes `/name` in a message as the owner asking for that
skill, at the start or in the middle of a sentence. Until the owner has used the menu once (moved
through it with the arrow keys or picked a skill), a hint under the field says so while it has the cursor ("“/” asks the agent for one of its skills.").

Claude Code says which skills there are: Seismic starts it in the repository's read checkout with the
agent's plugins and settings, asks for its commands and skills, and ends it without a message (no
tokens; a few seconds). A repository whose Claude Code configuration waits for the owner's trust
(see Trusting a repository's commands) offers the user's skills alone, as its agents get them; so does a review
card, whose agent reads none of the repository's settings. A list is kept for two minutes per
place; after that it serves while it is asked again. A worker on another machine gets this
machine's list.

### Cards by `/` in the task text

In a card's task text, while it can still be edited, `/` at the start of the text or of a word
searches the canvas's cards: the words after it on the same line filter them, each of them in the
title (case aside) or the card's short code; titles that start with the search first, at most
eight, neither the card itself nor what is archived. The menu opens just under the line being
typed, from the slash on, only while something fits, each card as the smart link it will become,
with its short code; the keys and the click work as in the skills menu, and Escape closes it
without closing the card. Picking puts the card's smart link in place of the search, inside the
text, followed by a space. In the field a smart link is one piece: the cursor steps over it,
Backspace or Delete takes it out whole, and pasted text comes in as plain words. The text is kept
as markdown, the smart link as a link to the card's address, `[Title](/p/<project>/c/<code>)`
(see Addresses), so the agent reads the card's title and where it lives, and every place that
shows the text plainly (the card's face) shows the title. Until the owner has picked a card once,
a hint under the field says so while it has the cursor ("Type “/” and words of a card’s title to link it.").

Wherever a card's conversation shows text (the task as first message, the agents' messages), a link
to a card's address is a **smart link**: a pill with a dot in the colour of the card's state, its
title as it is now (not as it was when linked) in blue and underlined, and its priority where it has
one; its tooltip is the card's state line, and a click opens the card as other card links do. A
card no longer on the canvas (archived, deleted, or on another canvas) keeps the link's text in a
muted pill. Further facts a card comes to have (an assignee, labels, a due date) belong in the
pill too, beside the priority, as long as it stays one line.

### Marking screenshots

A screenshot still in a field opens ready to be marked: a drag frames a region, a click sets a pin,
in signal red with a white edge, numbered together in order (a pin in a red circle, a frame in a red
tab at its corner, so a small frame does not read as a pin). Undo (⌘Z / Ctrl+Z) takes back the last
mark, down to the unmarked image; Done, Esc or a click beside closes. A hint shows until the owner
has marked once. On closing, the browser draws the marks in and uploads the result, which replaces
the original in the field (which waits to send until it is uploaded); the agent only gets the marked
image. The marks are kept as shapes, so reopening (even after a reload) shows the original with its
marks and Undo still works. A sent screenshot cannot be marked. The server sees one more uploaded
image.

### Decisions

- **A conversation, not the log** (2026-10-05). Rejected: both side by side. Workers answer notes
  with `reply`. Rejected: their last words before the owner's next message (often "Ich committe
  jetzt") and a small model summarizing each turn (cost on every turn). A note withdraws an open
  question rather than answering it, which would log a remark as a decision.
- **A planned card nobody worked on is asked, not just noted** (2026-11-03): the notes of the decision
  below waited unanswered until the start, so the owner could not talk a task over before deciding to
  start it. Typed words now get an answering agent's reply at once and the card stays planned.
  Rejected: turning the card into an idea on the first message (it changes what the card is and its
  buttons, for what is a question); a worker started to answer (it needs a workspace, and starting is
  the owner's decision).
- **A planned card takes notes for its agent** (2026-10-30, GitHub issue #24): a scheduled task
  offered only to start it or to snooze it, so what the owner thought of meanwhile (what to watch
  out for) had to go into the task's text or wait for the agent. Rejected: notes only on queued
  cards (2026-10-16 until then); a field on a card just created, which offered two places for the
  task. Spoken words still go to the Koordinator, since "start that" and "put that back" are
  what is said to a planned card, and no agent is there yet to pass them on.
- **One layout for every card with a conversation** (2026-10-07). Rejected: a task stacking demo,
  buttons, feedback and conversation in one column, with the demo's question its own field and Send.
- **The task is the conversation's first message** (2026-10-08), so the conversation reads from the
  start (asked, done, added) and every card kind's starting point is in it. Rejected: a "Task"
  section on the left.
- **The last demo stays while the worker works again** (2026-10-08); **a demo report's question
  stays on its handover** (2026-10-09). Rejected: hiding the demo on feedback; moving the question
  to the newest handover, orange as if open.
- **A follow-up card is an action with its cover** (owner, 2026-11-03): Seismic's confirmation alone
  read as one more message, and the card it made had to be found on the canvas. The cover is the
  card's live face, not a copy from the moment it was made, so it shows how far the follow-up got.
  Rejected: a state line with the title as a link, which reads as dialogue's small print and shows
  nothing of the card. Proposals an agent makes are not actions: they are its steps until the owner
  accepts them.
- **Agent words kept long** (2026-10-09). Rejected: a 600-character cut.
- **Replies to one message** (2026-10-09; sheet 2026-10-15), the quote part of the draft.
- **Quoting marked text into the field** (owner, 2026-10-22): the owner often answers single
  sentences or parts of them and did so by copy, paste, quotation marks and " - " by hand. The quote
  is text in the field rather than a reply chip, so several can stand in one message, each followed
  by its comment. From what the card shows too, artifacts and an idea's brief among it (owner, same
  day): those are what the owner answers most often. Rejected for framed pages: reading the
  selection from Seismic's page, which a sandboxed frame of origin `null` does not allow.
- **Code blocks copy at a click and wrap** (owner, 2026-10-22): marking a drafted text by hand was
  fiddly, on the phone above all. At the desk the button shows on hover (owner, same day), so it
  does not sit on every block; on a touch screen always, since there is no hover. The block wraps,
  since what it holds is mostly prose the owner reads before sending it on. Rejected: scrolling a
  long line sideways.
- **Order as the agent saw it** (2026-10-14): Seismic holds the words and passes them at the next
  step, so it knows where they were read and can take them back. Rejected: passing a note straight
  into the session; Seismic learned only at turn end what it took, and the SDK takes one back only by
  a control request.
- **Seismic's reply to a passed-on request under the agent's message** (owner, 2026-10-29): the agent
  passes the owner's words on and then says so; standing where it was logged, Seismic's "One moment, let me check" came above the agent's message that triggered it. The passing-on step folds under that
  message, so the reply follows it. Rejected: holding the reply back in the server until the
  agent's message (it would be lost in a restart, and each kind of agent would need it).
- **Seismic's look-up apart from the agent's work** (2026-10-29): Seismic logs what it reads for a
  look-up on the card it was asked on, and it showed in the worker's bubble at work as if the worker
  read it. It now goes with Seismic's answer. Rejected: not logging it on the card (the owner would
  not see what the answer rests on).
- **Words read after an open question stand below it** (2026-10-22), also while it waits at the
  end. Rejected: holding them back until the owner answers, which keeps from the worker what it
  could take in at once.
- **Orange edge only for what is new, never for what arrived in view** (2026-10-17). Rejected: edges
  on answered questions (looked open) and on messages the owner watched arrive.
- **The conversation stays where the owner scrolled** (2026-10-20). Rejected: every agent step
  jumping to the end.
- **One rule for ended and for open questions on every card kind** (2026-10-21). Rejected: per-kind
  logic, which disagreed between field, phone, canvas and Koordinator.
- **Screenshots as images in the message**, so the agent sees them without a step. Rejected: files
  to read (only where tool results carry no images).
- **Other files go in by their own path** (owner, 2026-10-26), so the agent can also move or change
  them; a PDF dropped on the microphone opened in a new tab instead. A browser never tells a page a
  dropped file's path, so for a browser Seismic looks for the file by name, size and time, and the app
  takes the path from the system (owner's choice of both). Rejected: always a copy (the agent could
  not touch the original); the File System Access API, whose handles carry no path. The path is
  text in the field, so it reaches every agent through what already carries the owner's words and
  stays editable. Rejected: a chip per file beside the screenshots, which every way a message
  travels would have had to carry. The picker stays for images: on a phone it opens the photos.
  The paths go back beside the microphone when the sidebar closes (owner, 2026-10-26): they stayed
  in its field and a recording went without them. Rejected: the microphone sending the closed
  sidebar's words, which stay apart from it on purpose.
- **A spoken command takes the screenshots of its field** (2026-10-12). Rejected: a separate
  microphone store, which left pasted screenshots behind. **Seismic says whether a cut-off command
  arrived** (2026-10-16). Rejected: treating it as failed, or detecting a leaving page by
  `pagehide`; both sent screenshots twice. The microphone's screenshots move into the sidebar rather
  than hide (2026-10-17).
- **Marking: the gesture decides** (owner, 2026-10-14); frames numbered like pins (owner,
  2026-10-15). Rejected: a free pen (rough on a trackpad) and a tool switch.
- **The worker reports the app's address; the link shows only while it answers** (2026-10-16).
  Rejected: Seismic guessing ports (Docker listens elsewhere, only the worker knows the page), a mark
  on the canvas card, starting a parked app from the link. Only the reported port is forwarded
  (owner): more would need the worker to name them and keep their numbers here.
- **A card's files are its result, in tabs beside the demo** (owner, 2026-10-21), named files first.
  Rejected: an open button per change-list entry (no place for the result, Markdown unread in the
  browser), Markdown formatted only in the diff overlay (the result hidden behind "View"), a
  bundled pdf.js everywhere. A file opened from another device downloads; an answer's files do the same.
- **On a phone, pdf.js draws a PDF** (2026-10-22): Chrome on Android shows an empty frame for a PDF,
  so the owner saw nothing of a PDF on the phone; Safari on the iPhone is no more reliable in a frame.
  Rejected: a tile that opens the file in the phone's PDF app (the result to judge would be one tap
  and an app away, unlike every other kind of file) and drawing pages on the server (no tool that
  runs on every platform). The desktop keeps the browser's viewer, which searches and selects text.
- **Deliverables and the diff have separate tabs** (owner, 2026-11-04): video first, HTML documents
  and schema-change pages as results, with the underlying file list in Diff. The owner judges the
  result from its deliverables; the code behind it stays a deliberate tab choice.
- **Claude Code lists the skills, and the owner's `/name` reaches the agent unchanged** (2026-10-30,
  GitHub issue #27). Rejected: Seismic reading the skill directories itself (plugins, marketplaces,
  the account's and Claude Code's own skills: Claude Code's discovery to rebuild and keep up with);
  the list of a running session alone (none for a card waiting to start or done); passing a message
  that starts with `/name` to Claude Code as a slash command (Seismic says what the owner's words are,
  a note on a handover, say, so they never start the message, and words that reach the agent during
  a turn come with a tool result, where nothing is expanded).
- **Card links are markdown links to the card's address, shown as pills inside the task field,
  searched by plain text** (2026-11-04; pills in the field and fuzzy search later: owner): the
  agent and every plain view read the title without Seismic translating anything, and the link opens
  the card wherever the address does. The task field is an editable text rather than a plain text
  box, so the pill stands where the card is named and goes whole. `/` searches cards in the task
  text, where no agent's skills are offered; the conversation's field keeps `/` for skills.
  Rejected: a token of the card's id (`#ab12`), which says nothing to the agent or in plain text;
  the raw markdown in a plain text box with the pills listed under it, which the owner found hard
  to read.
