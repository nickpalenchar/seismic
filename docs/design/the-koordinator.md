## The Koordinator

A chapter of the [design doc](../design.md), whose header says how it is written.

The Koordinator is read-only SDK turns on the read checkout of the card's repository (the home
repository's without a card), one decision at a time (look-ups excepted, see Looked-up questions).
It schedules the cards, reads the owner's commands (see Commands to the Koordinator), looks things
up, and learns the owner's rules.

### Scheduling

Before a card starts, the Koordinator estimates the files it will change and judges whether running
it beside the cards in progress likely ends in merge conflicts. For each card in progress it sees
the estimated files and what the branch has changed so far (each file with its changed line ranges
and git's function context). Sharing a file is fine (additions in different places merge cleanly);
touching the same lines or function, or code one card moves, renames or reformats while the other
edits it, is not. Soft paths (`softPaths`, docs) do not count. In doubt the card runs: a conflict
that happens anyway goes back to its worker on landing. The estimated files stay internal: a card does not show
them (they read as a guess beside the files the card actually changed, and the owner has nothing to
do with them; 2026-11-02).

The same check compares the card's requested outcome with unfinished tasks in its repository:
planned tasks, work in progress, and work awaiting approval or landing. A substantially overlapping
outcome is a possible duplicate even if the tasks would edit different files; sharing a topic or
file alone is not enough. Planned tasks are shortlisted by overlapping task wording, while all
active work is considered. Seismic names the other card on the checked card, leaves it planned, and
lets the owner compare, merge or remove the cards, or start it again without repeating the warning
for unchanged text. Below the card's description it shows both original cards side by side, as in
the merge comparison, with a prominent status. Beside "Start agent", a joined purple "Attempt
merge" and secondary "Dismiss merge" pair either opens the existing agent-assisted merge flow or
sets aside the suggestion. This applies to cards started alone and to cards scheduled together.

A branch's change is measured from where it left the nearest branch that is not a card's
(`obeya/…`): the main branch, or a long-lived branch the card was built on; from the main branch if
it was merged into the card's branch since. So a card built on another card's branch keeps that work
as its own. Commits the branch starts with whose change the main branch holds as other commits are not
the card's: a pull after a merge on the forge rebases the local main's unpushed commits onto
`origin`, and the branches cards made before it keep those commits as they were. Counted, a card that
changed nothing showed their files and "Approve" (2026-11-02). git reads the changes of all cards in progress at once, without blocking the server.

In a folder without git (see Folders without git) the judgement is whether the card gets in the way
of one in progress: the same files changed, moved or deleted, or a directory reorganised that the
other works in; working side by side in one directory is fine. No paths are soft there.

Cards queued before it count too: a card likely to conflict with one waits behind it rather than
overtaking it, and once that one has started, until it has landed. A card judged again sees only the
cards queued before it, and a card waiting for another (directly or through others, an arrow the
owner drew counting as a wait) is never among
the cards that one sees as ahead or to build on, so no two cards wait for each other.

A waiting card shows the reason (one that starts says which files it shares and why that is fine).
Once what it waits for has landed or stopped it starts, or, if other work may have started
meanwhile, it is judged again. Cards whose waits end at once (the follow-up tasks of a merged PR,
say) are judged together, in one turn as a plan's start is (see Starting a whole plan): it
sees them in their order in the queue, keeps that order unless a dependency or a likely conflict
asks for another, and says which start now and which wait for which, so the first in the queue
does not start blind to one after it that it should build on or would collide with; a card alone
starts at once where nothing runs. "Start anyway" starts it at the owner's own risk. While it waits
it keeps its full card and its conversation, where Seismic answers what the owner asks (see Card layout); spoken words there go to
the Koordinator.

A workstream started on its own also waits for the workstreams of its plan it builds on (code, an
API, data or a decision one of them introduces, or the plan says it comes after), judged from the
plan doc, including those not started or stopped, since the owner may start workstreams one by one.
Such a wait holds until that workstream has landed; stopping it or taking it out of the queue does
not free the card. The card says so ("Waiting for W2 "…" (not started yet)", in its log, the
queue's list and the plan's sheet), so the owner sees which to start first. Even with nothing in
progress or queued, it skips this judgement only when no workstream of its plan is left unlanded.

A dependency drawn by the owner (see Cards on the canvas) holds the card until the prerequisite has
finished, including while that prerequisite is not started or stopped: a card started afterwards
queues behind it once judged, and one in the queue when the arrow is drawn waits for it from then on,
also one waiting only for a workspace or for the canvas's agents to resume. An arrow counts as a
wait wherever the queue reads waits: a card held by one is never ahead of its prerequisite or
among the cards that one may build on, a card does not pass it in the queue, and the arrows that
would close a cycle with other arrows or waits are refused. An arrow holds a card only until it
starts: one running or stopped by the owner afterwards (planned again, held anew once started
again), one the owner started anyway ("Start anyway") and one whose workspace was taken from it
go on once a workspace is free, whatever arrows are drawn. An arrow is kept apart from the waits the
Koordinator inferred: removing it leaves exactly those (a likely conflict still holds only while
the other card is in progress), and where both name the same card, the arrow holds on once the
inferred wait has ended. The card says that it waits because the owner connected the cards, in its
waiting box, on its face and with a line in its conversation once the arrow holds it, with the
inferred waits' own reason beside that where both hold it; an arrow is never given the reason of an
inferred wait. Starting a card anyway while arrows hold it (its play
button on the canvas or "Start anyway") asks first, naming the unfinished cards it was drawn to
wait for.

#### Follow-up tasks of a review

A follow-up task a review card's worker makes of findings (see Review cards) builds on the pull
request by definition, so Seismic queues it behind the review card as it is made, without an estimate:
"Waiting for "PR #34 …". Follow-up task from the review of PR #34; starts as soon as the PR is merged." The wait holds like a workstream's on one it builds on: stopping the review card does not free
it, only the merge (the card `live`); then it starts, or is judged again, together with the other
follow-up tasks of the PR, where it is not alone or other work runs. A PR
closed without a merge (the review card closed as done) leaves nothing to build on: its follow-up
tasks go back to planned, saying why, for the owner to start or delete. One made when the review
card is finished already is judged as any card. While it waits it is a task nobody has worked on:
the Koordinator may merge it with others (the merged task waits for what any of them waited for, in
the place of the first queued) or delete it.

#### Waiting for a workspace

A card let start while no workspace is free (all clones leased, or every free one dirty) waits in
its place in the queue ("Waiting for a workspace"), counting as ahead of the cards after it, and starts
by itself once one is free (looked for at every change of the board, and for dirty clones at least
once a minute, since they can turn clean without one; see Workspaces for how free clones are looked at). Its reason ends in a link ("Change the number of
clones", or "Change the number of slots") that opens the configuration at that setting, since the owner may
not know the pool is the limit nor where it is set. A start that fails for another reason drops the
card back to planned, showing the error as the reason. Waiting cards are picked up again when Seismic
starts.

#### The queue's order

Cards whose turn comes together go longest-waiting first. The owner sets the order where the waits
leave it open: in the queue's list a row is dragged to any place, by the grip at its left with a
mouse or a finger (a finger elsewhere on the list scrolls it), or with a mouse by the row itself;
the rows it passes make room, and the list scrolls at its edges. On a waiting card (which says its
place), "Earlier" and "Later" swap it with its neighbour, and "Show the queue" unfolds the
queue there with the card marked in it: there the card alone is dragged, the same way, while the
other rows only show where it stands (they neither move, open their card nor take it out), and the
two buttons give way to the drag until the queue is folded again. A card does not pass a card it waits for,
one waiting for it, or one being judged, and a card being judged does not move; a dragged row stops
at the last place it may take and, pulled farther, says why, and such a button stays grey and says
why when clicked. A drop moves it there in one step: it passes each
card between, which each move up one place. The order decides who goes first once free, who gets a
free workspace, and which cards count as ahead when one is judged again.

A card waiting for other cards shows, under what it waits for, the chain it waits in as small
cards one above the other, in the look the canvas gives waits while the pointer is on a card (tags,
rings and arrows; see below): on top the card it waits for ("comes first"; the first, where it waits
for several), then the card itself, its title alone, tagged "This card" in green, then a card that
waits for it ("waits for it"; the first in the queue where several do). The cards above and below
show their face as on the canvas and open in its place.

Each direct wait is a faint line on the canvas at all times (see Cards on the canvas). While the
pointer is on a card, its waits show both ways over every step over the faint lines: the cards it
waits for ("comes first") in purple and those waiting for it ("waits for it") in the waiting colour,
each with a ring, its tag and an arrow from the card waited for to the card waiting, so the two
directions read apart at a glance. A workstream not delivered yet also shows the open workstreams
it builds on as read for its plan's arrangement (see A plan arranged by its dependencies), and
a card snoozed until another card gets somewhere waits for that card (see Snoozing a card).

#### Starting a whole plan

"Start all N" (the plan card's head, its sheet, or by voice) queues all planned workstreams in
the plan's order, with 8 seconds for "Undo" (the button is easily hit). Then one Koordinator
turn sees them with the plan doc, the cards in progress and those queued ahead, puts them in an
order and says for each what it waits for: a workstream it builds on (until that has landed) or one
it would likely conflict with; the rest start at once. A workstream waits only for what comes before
it, and that order becomes the queue's. The plan's sheet names what each waits for. If the turn
fails, each is judged alone, seeing the others as queued after it; after a restart the joint turn
runs again.

### Learning the owner's rules

After whatever the owner says, the Koordinator decides whether a lasting preference was stated and
proposes it as a rule (the card's log says "Proposes: …"): for the preferences, which hold only
how agents work with the owner through Seismic, or, when it is about a repository (taste in code
included), for that repository's CLAUDE.md, one proposal per repository when it holds in all of
them. A rule said outright ("Remember: …", the open card as its occasion) or written in the sheet's
field for a new rule (with the same "Belongs in") is sorted the same way and recorded at once (a
command after its undo window), without a proposal: one on how agents work with the owner through
Seismic is active at once; one about a repository ("Remember: in the shop always …") goes into the card
"Add to CLAUDE.md" of the repositories it names (see Rules for a CLAUDE.md). The confirmation says
which. It may name a rule it changes, which takes the new text or, moved into a CLAUDE.md, goes.

The learner reads answers, notes and feedback to workers, an idea's discussion, the conversation
with the Koordinator (a command once its undo window has passed), and text the owner writes in a
card once they pause for a minute or act on it. It sees each input with the card's text, the owner's
words of the last three days, the agent's last message before the input, the canvas's repositories,
the active rules and the open and rejected proposals. Its signals: general phrasing ("always", "never",
"from now on"), a correction of how an agent works, a repetition. At most one proposal per input.

#### The retrospective

The retrospective counts the owner's inputs (what the learner reads, wordless clicks on a card, a
deleted card, a command taken back, a proposal decided on); the count survives a restart. At 20, one
read-only session in the home repository reads what happened since the last retrospective (the cards'
milestones, the owner's words in ideas and to the Koordinator, taken back or not, deleted or
dismissed cards, decided proposals), looks for patterns seen at least twice on different cards, and
proposes up to three rules, each with what it rests on ("From the retrospective: …").

#### Proposals and rules

Open proposals stand as individual inbox entries with their occasion, the rule a change would
replace, and where it goes ("Belongs in": the preferences or a repository's CLAUDE.md), which the
owner may switch. The owner accepts, edits before accepting, or rejects; rejected ones are kept so
the learner sees them. They count in the inbox across canvases. Active rules are managed in the Rules section of Seismic’s Preferences. The Koordinator gets the rules, numbered, with every command, and follows them
itself too.

#### Rules for a CLAUDE.md

A rule for a CLAUDE.md goes into that repository's open card "Add to CLAUDE.md", or a new one; its
worker writes the rules in the style of what is there. A new card is labelled Docs and Configuration at
once, as set labels, not as suggestions: Seismic makes the card itself, so there is nothing to
suggest (owner, 2026-11-05). No session is needed, and the canvas's suggestion toggles do not apply. The card starts by itself once no proposal waits any more (a waiting one might yet
be switched to its repository), so several go in together.
It lands like any card; until then the rule applies to no agent, afterwards through the CLAUDE.md
alone.

### The Koordinator's sheet

The sheet (Seismic's button or `C`) gives the conversation with the Koordinator all its height, with
the field every card has under it (see Card layout).

Opened with its button or `C`, the sheet focuses the field (the owner, 2026-10-19); opened with Tab,
going through what needs the owner, it does not, so the next Tab goes on.

#### Chats

The conversation is split into chats, so it does not grow into one long one. The owner's words go
into the chat open now; the sheet shows only that one. In the sheet's head, the icon at the left
slides out the earlier chats over the conversation, the latest first, each named by the owner's
first words in it, with when it was last talked in and its unread answers; a switch there shows
this canvas's chats (labelled with the canvas's name, "This canvas" in small text below it; the
default) or every canvas's ("All canvases", each with its
canvas's name). Picking one opens it (on another canvas, that canvas's sheet with it); the icon at
the right ("New chat") starts an empty one, greyed out while the open one is empty, and an empty
chat left for another goes. Which chat is open is kept by the server per canvas, so the phone and
every page talk in the same one. The phone's Seismic panel has the same head: the list from the menu
icon at its top left, a new chat from the icon at its top right.

The model selector beside the chat field applies to this chat on this canvas, on the phone and in
the sheet alike. “Canvas setting” follows the configured Seismic model; a chosen Claude model
overrides that setting for this chat. Changing the choice starts a fresh agent session for the next
message while keeping this chat's conversation. A new chat starts with the canvas setting, and
returning to an earlier chat restores its choice.

An exchange the Koordinator takes up by itself (a wait met, a looked-up answer's step) goes into the
chat of the exchange it follows, and a looked-up answer comes in the chat it was asked in. One that
arrives in a chat not open counts on Seismic's button and in the inbox as any unread answer; the
list's icon shows a dot and the chat its count, and opening the sheet for it while the open chat
has nothing unread opens that chat. Each chat is the Koordinator's memory while it is open (see
Koordinator memory).

The conversation does not list proposals or preferences; the inbox and Preferences hold them. What runs is not listed: the canvas shows it.

Messages look like a card's: the owner's on the right, who and when above, markdown (each line a
paragraph, each blank line an empty line as typed, lists, tables, code, nested quotes; the plan
docs' parser), a taken-back reply struck through, bare web addresses as links without `https://`
and without the sentence's punctuation after them.

### Work retrospective

Seismic looks back at how the workers worked, to make future runs cheaper: detours where a worker went
wrong and corrected itself (wrong flags, a script rewritten after failing, a long search for how to
start something), above all the same detour on several cards. It is built like the retrospective but
differs in source (the workers' transcripts), beat (finished cards), place (the repository of the
friction) and result (feature cards and setting values, not only rules). It runs in two stages.

#### Friction notes

When a card's work ends (landed, closed without a change, a prototype discarded or built, or deleted
unfinished), Seismic draws an excerpt from its runs' transcripts without a model. The Agent SDK keeps
them at `<CLAUDE_CONFIG_DIR or ~/.claude>/projects/<cwd, non-alphanumerics as "-">/<session
id>.jsonl`, also after the workspace is gone; Seismic looks there first, then in every directory, as
the naming may change. A Codex worker's run is its rollout, `<CODEX_HOME or
~/.codex>/sessions/<year>/<month>/<day>/rollout-<time>-<thread id>.jsonl` (or the archive beside
it), found by the thread id of the session (`codex:<thread id>`); it is read through the finished
items of its events (commands with their exit code, files added or patched, the agent's words and
other tool calls), as the same kinds of call, so the excerpt and everything after it is the same for
both harnesses. Codex runs only on this machine, so its rollouts are never fetched from a host. Earlier runs are found through the log, where a start from scratch notes the
session before ("The earlier run (session …) is kept for the work retrospective.").

The excerpt holds failed tool calls with their error, runs of similar calls (a failure and its
correction, a command three times or more), files written whole more than once, the worker's words
around each, and how many calls the run took before it first changed a file. Calls cut off by a
restart or stopped by the owner (a command killed or ended with Ctrl-C; in a Codex rollout, what a
turn ended as `turn_aborted` was still running, a command there ending with exit code -1) count as
no failure, and the excerpt names their steps as the owner's pause, stop or restart, so a model does
not read them as a timeout of the agent's. A bare status call rejected because the worker tool is
exposed with the `mcp__seismic__` prefix also contributes no finding; it says nothing about the
repository. Subagents are left out. An unreadable transcript gives no
excerpt and no error. A short read-only small job (see Models and effort) makes 0–3 friction notes
of it (what went wrong, what it cost, what would have prevented it). It is told the settings a
retrospective may propose as they apply now, so a worker working out what one would have said
becomes a note naming that setting and the value that worked.

#### The retrospective

Every 10 finished cards of a repository (a card that never ran does not count), the retrospective
runs; a new repository's first ones come after 1, then 2 more and 4 more cards, so the first
improvements come soon. It is one read-only session in that repository's read checkout (so it sees its
CLAUDE.md, scripts and skills). It reads the notes since the last one, with earlier retrospectives'
proposals (dismissed ones so it does not repeat them), and proposes at most three things, each
resting on friction on at least two cards:

- a feature card (a script, a skill, a fix to a tool), waiting as a proposal ("From the
  work retrospective: …"; its state "Proposed by Seismic", not "Proposed by an agent");
- a line for the repository's CLAUDE.md, which goes the way of the retrospective's rules;
- a value for one of the repository's settings (`checks`, `setup`, `softPaths`, the app's `run`),
  for knowledge the workers each worked out themselves; it sees them as they apply now. Since every
  handover brings a demo, an empty "How to run the app" is the usual case: the retrospective proposes
  the recipe the workers arrived at.

Nothing is created or started silently; the user's own skills (`~/.claude/skills`) are out of scope.
The owner can ask for one at once ("Do a work retrospective for the shop"); the count starts
again.

#### Setting proposals

A setting proposal (one per setting and repository) stands in the inbox,
marked as a change to the configuration: a cog and "Change configuration · <repo>" over the
setting's name, "Now" above "New", the reason and the cards as links, and "To the setting ↗",
which opens the configuration dialog at that setting on desktop. The inbox counts it.

The new value stands in a field the owner may edit in place ("As proposed" restores it; the
edit survives a reload). Two buttons, neither preselected, take it: "On this machine" sets it in
this machine's settings at once; "For everyone, into the repository" puts this one value into
`.obeya/settings.json` the way "Adopt for everyone into the repository" does (see
`.obeya/settings.json`), the value set on this machine until the file holds it. A notice says where
it went. "Dismiss" keeps it as rejected, and the next retrospective hears what became of each.

### Looked-up questions

A question that needs reading (what the agent would do, what the plan says, how something works) the
quick turn acknowledges ("I'll check the plan.") and passes on: about a plan or its
workstreams to the plan agent, in the plan's session; else to a thorough Koordinator turn on
the card's repository. Both have a worker's tools and permission mode (shell, gh, the web, files
outside the repository), so they check what the text alone does not say (which render is newest, a
CI run) instead of saying they cannot see it. A call the settings want confirmed is refused, as
there is no card to ask on. The quick turn stays read-only, so it answers in seconds.

A question about the work of an agent on a card ("Is it ensured that …?") goes to that agent
as a note or feedback instead: its work is on its branch, not in the read checkout, and the card shows
the agent at work while it answers. A look-up about a card gets its state, log and the worker's
start task, from which it derives the worker's steps.

The answer comes 10–30 s later: its start above the microphone (as plain text on one line, its
Markdown stripped), in full in the open card's log, else
in the Koordinator's sheet; meanwhile the open card shows what the agent reads. An answer in the
sheet stays unread until the owner has the sheet in view (open, the page not hidden): until then
Seismic's button counts it in orange, it counts once in the inbox and stands in it as one entry, and Tab
goes there after the cards that need the owner; such answers keep an orange edge until the sheet
closes. An answer that arrives while the sheet is in view, or in a card's log, is read where it
arrives. The quick turn's own reply waits the same way when it only answers, since a long one takes
20 s and more and the owner may have moved on (2026-10-19). A confirmation of actions does not wait:
the canvas shows what it did, with "Undo" above the microphone.

The Koordinator hears each answer in full with the next command (so "yes" to a card it offered
works), and it is part of its memory. A question still open at a restart is looked up again. A
look-up for an action the owner asked for brings its answer to the Koordinator at once instead,
which takes the action then (see A step once something is looked up).

### Looked-up threads

A look-up starts a thread. The Koordinator knows each answer by a tag (`A12`); when the owner's
words follow up on one ("and in October?", "make me an Excel from it"), the follow-up resumes the
session that found it (in doubt the newest), which still has all it read and computed. Turns of one
thread queue. A session that cannot be resumed is replaced by a fresh agent given the thread so far.
The follow-up shows "↳ continues: "…"" (and "reading …" while it runs) under the owner's words, so
the owner sees which answer Seismic took it for.

A look-up whose turn ends while its background work runs (a download, a long query) keeps reading
until that work wakes the agent, within a worker's limits (see Turns that end without a handover);
should it never wake it, its last words are the answer.

#### Files with an answer

Every thread has an output directory outside every repository, `~/.obeya/answers/<canvas>/<thread>/`
(never in git), given to the agent as a directory of its own: files the owner asks for or that help
(a spreadsheet, a chart, the scripts behind them, a draft) go there, and the answer names them with
a caption; a path outside it is refused. Under the answer they show: a page in the sandboxed frame
of an HTML artifact, an image inline, any other file as a chip that opens it with the system's app
(only from a page on the machine Seismic runs on; elsewhere, or where that fails, it downloads). A
file that would run when opened (a `.command`, a `.bat`) is shown selected in its folder instead.
Each has ↓ to download, and "Show in folder" opens the directory. Follow-ups build on the files
already there.

#### Question cards

"Make it a card" in a looked-up answer's head moves its thread onto a **Question card** beside the card
whose log held it: its question as title, its exchanges as conversation, the same session going on.
While the card exists, the sheet shows "On the card "…"" in place of its answers; once it is
archived or deleted they return, and "Make it a card" again opens the card, back from the archive if need
be. Follow-ups asked in the sheet go to the card.

On the card the owner talks straight to that agent through the shared conversation (see Conversation
on the card); words sent while it reads join its next turn (unread until then, and the owner can
take them back), except while its turn waits for background work: then they reach it at once, so
"take 2023 instead" arrives while the download runs (a session that fails after hearing them hands
them to the fresh one). Its agent passes on with `to_seismic` what asks Seismic; a note the Koordinator
passes to the card goes to it too.

It holds answers, not work: a look of its own ("QUESTION"), the number of answers and files, not taken
by "Archive done", no build, plan, prototype or park buttons. It has two: "Discuss as an
idea" (not while its agent reads) makes it an idea whose agent starts from the thread and its
directory, and "Done" archives it. The Koordinator lists Question cards among the cards it sees.

#### Asking in a plan's sheet

A plan's sheet has a section "Plan agent": the conversation with its plan agent and the
shared field. Words there go straight to the plan agent, not through the quick turn, in its one
session; a reply to a message follows up on that thread, other words start a new one. The agent has
`to_seismic` for what asks Seismic ("start W4"). The section shows every thread the plan agent
answers, also those asked of Seismic about the plan, each with "Make it a card". Seismic's sheet shows
them too, marked "in the plan sheet "…"", so an answer that comes after the owner left the plan
waits there unread; with the plan's sheet in view (not its plan doc) its answers count as read
and get no line above the microphone. While an answer to words written in the sheet waits unread,
the plan's card shows it at its corner, collapsed or not: a pulsing speech bubble in the plan
agent's colour (with the number from two answers on), beside the count of workstreams that need the
owner and unlike it; a click opens the sheet. The sheet then opens at the first of them, marked as
answers that waited are in Seismic's sheet. The conversation grows in the sheet, without a scrollbar
of its own.

### Koordinator memory

The owner's commands go to one ongoing session per canvas, so it understands "the other one too". It
sees a card's open question, also one in a demo report, so "yes" is an answer, not an approval. An
approval by word ("deploy it", "ship it") lands the way the repository sets; words that ask to
bypass the pull request ("without a PR", "straight to main") approve nothing in a repository whose work
goes out as one, and the Koordinator replies that only the card's button "Straight to main" does that,
where the settings allow it. Card
tags (`K1`, …) stay fixed for the session. Each command brings the cards as they are and what
happened since the previous one (state changes, questions, answers, hand-overs, notes, errors, new
cards; not the workers' steps), including a command the owner took back. Every exchange is stored.

A session that fails (an error result, which the SDK may report as `success` with `is_error`) is
replaced by a fresh one for the same command; if that fails too, the owner hears the reason ("Claude
is not logged in on this machine: …"), not "not understood". Sessions are never resumed:
after a restart, after 30 commands and when the owner opens another chat (see Chats), a fresh one
starts from memory (the last 20 exchanges of the chat open now, the canvas's last 14 days, the
newest five of that chat's looked-up answers in full). A new chat thus starts without the earlier
conversation, but still knows the canvas's history.

### Wishes for Seismic's makers

The owner reports what is missing or broken as a GitHub issue on sadilek/obeya (fixed, since the app
runs without a checkout), submitted under their own account. Four ways open the draft dialog: the
link "Report a wish or a bug" in the configuration dialog and in the legend (with "draft open"
while a draft waits), words to Seismic ("Seismic, feedback: …", at once without undo, since it sends
nothing), and "↗ Report as a wish" under a reply that says Seismic cannot do what was asked.

In the dialog's shared field the owner writes or speaks; a small read-only job writes it up as an
English title and body (reworking a body that stands with the new words), adding nothing they did
not say, and ending with one line on this Seismic's version, system and kind of install. Nothing from
cards, repositories or the conversation goes in unless the owner wrote it or it is the unmet request
and its answer. Without a model (not logged in) the owner's words stand as they are; at the usage
limit the line says when, and the page writes the draft once the limit lifts, after a reload too,
unless the owner edited it meanwhile. Title and body are editable, above the line that the issue is
public under the owner's name.

"Open on GitHub ↗" opens GitHub's prefilled new-issue page (`issues/new?title=…&body=…`) in the
system's browser. Screenshots cannot travel in the link: the click puts the first on the clipboard
and the dialog says to paste it. The link stays under 8000 characters: a longer body is cut, and
without a screenshot the whole body goes on the clipboard. Then the draft is gone, and the dialog
says what is on the clipboard. Until sent, the draft is kept like every input. A new wish does not
replace a draft with content: the dialog offers to discard it for the new one, and opening the old
draft on GitHub writes the new one too; a draft with only a title gives way at once. The draft
remembers the wish it came from, so that reply's link reopens it as it stands.

The Koordinator flags a reply when Seismic lacks the feature, not when the request is unclear,
something just failed, it does not fit a card's state, or for questions of fact. What an agent can
work out or make on the machine (a chart of each task's tokens from the agents' session logs, say)
is a look-up or a task, also where Seismic itself shows nothing of it. On a card such a
reply stays in the conversation rather than folding away with the confirmations. An agent that
passed the words on through `to_seismic` hears that the owner finds the link under the answer; a
`wish` passed on that way opens the draft on the page.

### Decisions

- **Wishes go out as a prefilled GitHub issue the owner submits** (2026-10-16), so Seismic holds no
  token. Rejected: posting through gh (publishes with only Seismic's preview as the check), a hosted
  endpoint (a service to run, spam, privacy), mail (manual attachments, exposes an address). Seismic
  offers it under a reply that it cannot do something; rejected: never (nobody learns where it falls
  short) or collecting them under "Proposals" (late, without context). No icon in the bar (always
  there for something rare) and no line in Seismic's sheet (the owner, 2026-10-17). The action is
  `wish`, since `feedback` is feedback on a card's work.
- **The Koordinator waits on a card for a step it announced** (2026-10-18, see A step once a card
  gets somewhere), since no turn of its runs without the owner's words and promised steps never
  came. Rejected: promising nothing it cannot take itself (the owner asks for both in one breath); a
  follow-up card whose worker does it (configuration is the Koordinator's, with check and undo);
  conditions beyond the two a worker waits for on another card.
- **A card waits rather than risking a collision**; the estimate is taken once, before the start,
  and a waiting card is checked again when its blockers finish.
- **A new card does not overtake a queued one it likely conflicts with**, even one far from done:
  fairness over parallelism; "Start anyway" remains.
- **A card waiting to start stays full size and takes notes** (2026-10-16; every planned card
  since 2026-10-30, see Card layout). Rejected: shrinking it to a planned card's panel while Seismic
  checks it, which left the owner's thoughts waiting until the agent ran. Spoken words still go to
  the Koordinator, since no agent is there to pass on "start anyway".
- **A card's change list is its own work, read without blocking** (2026-10-21, GitHub issue #2).
  Rejected: diffing each card in full against the main branch, one after the other on the server's
  thread: cards on a feature branch 766 commits ahead each counted the whole branch (30–70 s per
  card on Windows), and every canvas lost its server connection for minutes.
- **A start that finds no workspace is a wait, not a failure** (2026-10-05), so a card the owner
  started starts by itself once a workspace frees up.
- **The queue's list is reordered by dragging, not by one-place buttons** (2026-10-26): with more
  than a few cards waiting, a card going from last to first took a click per place, and buttons
  beside the drag were redundant (owner). The drag knows the waits: the row stops where they stop it
  and says why when pulled farther, so the drag never just fails. The card's own view keeps the
  buttons while its queue is folded, as moving one place is the common case there; unfolded, the
  card is dragged by the same means as in the queue's list (GitHub issue #14), and only the card
  itself, since the owner opened it to place that card, not to rearrange others. Touch drags by a grip so that the list still scrolls under
  a finger. Nothing passes a card being
  judged, which could otherwise end up waiting for a card that waits for it.
- **A plan's workstreams started together are scheduled in one turn** (2026-10-02): they often
  build on each other, which a conflict check does not see; only a turn seeing all of them and the
  plan doc can choose the order.
- **Cards freed at once are scheduled in one turn too** (2026-11-02, the owner on the follow-up
  tasks of a review: the first in the queue started unchecked, and only the second was checked
  against it, so nothing asked whether the first should build on the second). Rejected: starting
  them one by one in the queue's order.
- **Learned rules are proposals the owner accepts first** (2026-10-02), as the owner wants to see
  every rule before it applies. Rejected: storing them silently. The retrospective runs after about 20
  inputs, neither daily nor only on request.
- **Preferences hold only how agents work with the owner through Seismic**; repository rules, taste in
  code included, go into its CLAUDE.md (2026-10-02), versioned and seen by colleagues and by Claude
  Code outside Seismic. Rejected: not learning repository rules (lost), preferences scoped to a
  repository in the database (unversioned, invisible outside Seismic), committing to the CLAUDE.md on
  accept (the Koordinator only reads, and PR-landing repositories take nothing on `main` directly).
- **The work retrospective learns from transcripts in two stages** (2026-10-05): a model-free excerpt
  per card made into friction notes, and a retrospective over about ten cards' notes. Rejected:
  building it into the retrospective (the log's tool lines lack results, and source, beat, place and
  result differ), workers reporting their own detours at hand-over (patchy, longer hand-overs), raw
  transcripts in the retrospective (far too much context).
- **The work retrospective proposes setting values too** (2026-10-15), since with demos required
  workers kept working out how to start the app. They wait in the sheet, not as cards: taking one is
  a click, no agent work. The owner chooses machine or repository each time, neither preselected,
  and for the repository it is that one value only; the proposal shows plainly that it changes the
  configuration (the owner), hence its head, the link into the dialog and the value edited in place.
  Rejected: a "Change" button opening it (the owner could not tell what it did), hand-over
  summaries saying how the app ran (longer, and the notes carry it), and proposing landing, main
  branch or workspace mode (choices, not knowledge friction reveals). The ramp for new repositories
  exists because 10 cards made the first improvements late.
- **The sheet's conversation looks like a card's** (2026-10-09): one look and one field for every
  conversation.
- **A look-up is a thread with files** (2026-10-14). Rejected: one-shot look-ups whose follow-ups
  started over, and markdown-only answers written in the read checkout, where files would be left as
  uncommitted changes.
- **A look-up waits for its background work** (2026-10-19). Rejected: taking its words so far
  ("still downloading …") as the answer, which closed the session and stopped the work.
- **The plan agent can be asked from the plan's sheet** (2026-10-21, a colleague's feedback),
  since asking only through Seismic was not found from the plan.
- **The plan's card shows its agent's unread answers** (2026-10-29, issue #21): a reply to what
  the owner asked in the sheet is looked for where it was asked, not only on Seismic's button. A
  speech bubble rather than a second number, so it is not taken for workstreams that need the owner.
  Answers asked of Seismic about the plan stay on Seismic's button alone: they were asked there.
- **The Koordinator's memory lives in the store, not the session**: a session is never resumed, and
  a new one starts from the stored conversation and the cards' history. That keeps the context short
  over weeks and makes restart and renewal one path; the history is in it because the owner asks
  about progress over time ("what has happened since yesterday?") and refers to cards by what happened.
- **Chats, each the Koordinator's memory while open** (2026-11-06, the owner): one endless
  conversation grew long and mixed unrelated topics. A new chat forgets the earlier words but not
  the canvas's history, since "what happened since yesterday?" must still work. The open chat is
  the server's, per canvas, not the browser's, so voice, the phone and the desktop agree on where
  words go. Rejected: a chat per browser tab, and looked-up threads as the unit (they are single
  questions, not conversations).
