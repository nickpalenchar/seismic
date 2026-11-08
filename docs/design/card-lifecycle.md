## Card lifecycle

A chapter of the [design doc](../design.md), whose header says how it is written.

A card is created by the owner (voice or project) or proposed by an agent, worked on by a worker,
handed over with a demo, approved, and lands; finished cards go to the archive.

### Proposals

A worker proposes a card with `propose_card` (see A worker's tools). Its text is written for the
agent that will take the card on, as the owner would write a card (no "I", other cards named by
their title). Apart from it come a reason, for the owner only, beside the card that proposed it, and
what the owner has to decide, as questions with options. The owner can edit the proposal and pick
options on it. "Accept and start" starts it like a started planned card, through the
Koordinator; "Accept" only plans it. Accepting writes the questions into the text, picked ones
under "Decided:", the rest under "Open questions:", so the new worker reads what is settled and
asks the rest.

Seismic proposes cards of its own too ("Proposed by Seismic"): the work retrospective's, and the card
that fills in the settings of a repository that has none (see Projects in Repositories and configuration).
Everything Seismic proposes by itself shows its state label "Proposed by Seismic" in purple, the proposal
colour, in the inbox (an agent's proposal keeps its own label, "Proposed by an agent", in orange).

A proposed idea ("✦ Proposal · Idea") is for something to think through first: "Accept and discuss" makes it an open idea whose exploration agent opens the discussion with the text and its
questions; "Accept as a task" plans it as a task. "Ideate" on a proposed task
makes it an open idea the same way, whose agent hears that it was proposed to be built and the owner
wants to think it through first; by voice, "ideate it first".

#### A proposal that starts later

A follow-up that can only be done later (whether a bank has registered a form, two weeks on) is a
proposal with a start time (`start_at`), not a sentence in a handover where it goes under. The owner
decides on it now, and the card starts by itself at the time. The time stands under the proposal's
text with "Change" (the "Later" menu, with "No set time"), and on the canvas card after its
state ("starts …"). Its one button, "Accept", plans the card and snoozes it until then, the
proposal's reason as what it does then; at the time it starts like a started planned card (see
Snoozing a card), at once if the time has passed. Its worker hears when the card was set to start
and that it is that time now, so "in two weeks" reads as due; it checks what it can and asks the
owner for what only they can see. A rework keeps the time; accepting only as planned, or as an idea,
drops it. Starting after another card is done is the plan's order, not this.

#### A proposal its agent takes back

A worker takes back its own proposal with `withdraw_proposal`, or replaces it with `propose_card`'s
`replaces`, naming it by title (Seismic matches the card's latest proposal of that title, case, quotes
and markdown aside, and otherwise answers with the list of its proposals). A proposal still open goes
from the project at once, also mid-rework, and the proposing card's conversation says so. It is kept
as deleted with the mark, so the retrospective does not read it as dismissed by the owner. One the owner
accepted already is only marked until it is finished: its card reads "Replaced by “…”" or "Withdrawn by its agent" and needs the owner, and its panel says by what and why, with "Remove" (as
"Delete", with an undo) and "Keep". A finished card stays as it is.

#### Merging cards

"Merge with" starts at a task nobody has worked on: a proposal or a planned task.
The picker searches titles and texts, listing planned tasks and proposals first, then in-progress,
done/live and archived tasks, newest first within each group, each at size XS (see Card sizes). It excludes itself, workstreams,
ideas and prototypes, snoozed cards, cards being merged or reworked, and repositories that are down.
Two started tasks cannot merge with each other.

The furthest-along card survives: proposal, planned, in progress (including stopped tasks with a
branch), done/live, archived. The dissolving card is on the left and the survivor on the right.
When both cards are unworked (two proposals, proposal and planned, or two planned tasks), a
read-only agent writes one combined title and task, preserving both sets of requirements and
keeping questions separate. Otherwise it compares the back card's text against the survivor's
text and its handover summary, where present. It reads no branch diff or repository files.
The survivor's text, branch, worker, demo, state and place stay untouched, while its worker can
continue working during comparison.

The pair shows together on the canvas, with a spinner while the comparison runs. Once ready it
needs the owner. Its panel shows both originals above the merged card. Long originals start as
previews; "Show all" expands them together. Only the panel scrolls; the result is complete
and "Approve merge" and "Separate" stay reachable on desktop and phone.

For a progressed survivor the merged card is an exact copy of the right card. If it covers the
left completely, all of the left task is crossed out, with a green notice explaining that the
right card covers it and is preserved. Otherwise only covered parts of the left task are crossed
out. Below the unchanged merged card an arrow leads to a preview of a new planned follow-up,
containing only uncovered work, with the relevant screenshots and questions from the left card.
A notice explains that extra work becomes a fast follow. The coverage map reproduces the original
task exactly, so omissions or rewriting cannot hide a requirement from the owner.

Only approval removes the left card and creates the follow-up, as one transaction. Its arrows and
existing follow-ups move to the survivor, removing self arrows and duplicate arrows. The new
follow-up is an ordinary planned task in the survivor's repository and group, placed beside it,
with the existing dependency arrow waiting for the survivor to land. An archived survivor stays
archived; its new follow-up is created on the canvas just the same. An archived stopped task
continues to hold the follow-up until its work lands; an archived finished task holds nothing. For unworked pairs approval
instead gives the survivor the combined text and screenshots, with both proposals' questions kept
as questions (or included in a planned task's text). The dissolved card is kept as deleted, marked
as merged rather than dismissed for retrospective.

"Separate" restores both original cards, including their places, without creating work. A failed
comparison shows its reason and "Try again"; unfinished comparisons resume after restart.
If the compared text or handover changes before approval, a new comparison is required. A combined
unworked draft cannot overwrite a survivor that has since started.

Decision (2026-11-04): started, finished and archived tasks may be survivors, but only an unworked
card can dissolve. This preserves the task under its worker while allowing covered requests to
go and uncovered work to become a follow-up. The owner approves the comparison before any deletion
or creation: an agent can misjudge coverage and silently lose work. Crossed-out originals make
that judgement checkable. Merging into a third combined task is rejected: the further-along card,
its work and its place are what stay.

#### Reworking a proposal by words

Instead of editing a proposal by hand, the owner may say or type what should change (its field "What should change?"). With the proposal open, the words go straight to a read-only agent of its own
in the card's repository, the reviser, without the Koordinator or an undo window. It rewrites title,
text, reason and questions by those words and keeps the rest; a question the words settle goes, its
decision into the text. What the words ask of Seismic (accept or dismiss it, a rule, another card) it
passes on with `to_seismic` (an accept passed on that way waits for the rework, as the button does);
what they only ask ("Which would you take?") it answers, leaving the
proposal as it was. Words about a proposal that is not open go to the Koordinator.

Screenshots with the words (see Screenshots) reach the reviser along with those already on the
proposal and those shown earlier in its conversation (at most twelve, newest first); it names those
that go with the task (dropping one it kept before, if the words make it obsolete), which then show
with the proposal's text and are the task's once accepted.

The conversation stands beside the proposal as on an idea, its open questions at the end, a settled
question where it was asked (see The conversation). Options picked and sent ("Answer") go to the
reviser at once; accepting instead takes the picks into the text. While the rework runs the proposal
shows "Being reworked" (on the canvas card in place of its state, which the kind line already
names), cannot be edited or accepted with "Accept" alone, and does not count
as needing the owner; words said meanwhile wait for the next rework. Then the conversation shows the
reviser's reply, "Proposal revised." when the text changed, and any new questions. A reviser
that ends without a text leaves the proposal as it was, with the error; a rework running at a
restart starts again.

"Accept and start" (and "Accept and discuss", "Ideate") does not wait for
the rework, like "So bauen" on an idea: clicked during one, the proposal is accepted once the new text
is there, unless it still has questions, in which case it stays a proposal and the conversation says
why. Meanwhile the button reads "Starts after the rework …" with "Don’t accept after all", and
the canvas card's state line adds "then accepted". Accepting by voice during a rework is refused (see Commands
to the Koordinator).

### At work

`working`: the worker leases a workstation, implements, runs the checks the repository's settings name,
and records the demo.

### Waiting for approval

`waiting: demo`: the card carries the demo (see The demo on the card); the owner approves or gives
feedback. Whatever the owner writes or says on the card goes to the worker at once, and the work
still waits for approval: while the worker takes the words in, the card is at work ("Agent working", not counted as needing the owner), "Approve" stays, and a change the words
call for comes as a new handover. Words asking Seismic for something (gib frei, a follow-up) the worker
passes on with `to_seismic`.

When the turn ends, the card is the owner's again. Without a new demo it reads "Agent answered, waiting for you" instead of "Demo ready"; a new demo reads "Demo ready" again, numbered from the second demo on ("2nd demo ready", "3rd demo ready"; drafts that came with a question do not count). Only
words for the owner count as an answer (a reply, what the worker says, Seismic's result of
`to_seismic`), from this turn; an answer to earlier words does not count. A turn that ends without any
(an error, the session ended) leaves the card at "Demo ready", and the conversation says the agent
stopped without answering. A turn that ends with words for the owner while only the app it serves
for them to try runs on also gives the card back: only that app shows as running. Background work
the worker waits for (a test run, a render it said a new handover waits for) keeps the card at work
until it wakes the worker and its turn ends, words or not, and so does any background work after a
turn without such words. The app is what the worker started in the turn in which it said the app
runs (`app_running`) and still runs then: nothing else tells the two apart, so a worker names the app
again each time it starts it anew.

A question in the demo report is an open question like a worker's (see Questions go to the owner),
with its options and the worker's pick.
The card's one field (see The conversation) takes the answer and feedback together; the worker hears
them as the answer, and the card is at work while it takes them in, as after feedback. A restart
resumes that turn like a working card's.

#### The handover report

The worker's summary is its handover in the card's conversation, not repeated under the demo: the
first says what changed for the user and what the owner needs to know, in a few short paragraphs at
most; a later one only what the conversation has not said yet, often a sentence. A reply to a note
that changes nothing ends the turn by itself, without a new handover. Whoever reads the card's report
outside its conversation (a follow-up's worker, the Koordinator, a prototype's idea, a shared page)
gets the whole of it: the first handover, then "Afterwards in the conversation:" with the replies and later
handovers in order. A problem beyond the task is a proposal, not a line in the report.

#### Code reviews

Review answers may be submitted to the current worker or to a new agent chosen by harness, model and effort. The latter starts a fresh session in the same workstation with the selected findings as its task context; the previous worker must have finished its turn.

A project may have the work of its cards reviewed before it lands (its settings sheet, "Code reviews",
see The project settings in The canvas; off unless the owner turns it on, since reviews cost tokens).
Only work that lands on `main` is reviewed: a card whose work goes through a pull request (with the
repository's `land: pr`, also where "Straight to main" would push it) is left to the forge's
reviewers, and so are folders without git, review cards, prototypes, work that changes nothing and
approved work handed over again only to land.

The reviewer is an agent of its own, not the worker: one session of the "Code reviews" group (see
Models and effort in Agents and workstations), read-only, in the card's workstation. Its brief is the
card's title and task, the files changed and the branch's diff against `main` (cut off at a size, the
rest left to reading the files); its instructions are to review the repository's way (its CLAUDE.md
and docs): correctness, security, quality, and whether the change fits the design docs. It changes
nothing and records its findings once with a tool: each with a title, a sentence or two in the
conversation language, a severity (blocker: an app crash, a very important secret exposed, or an
unprotected database; critical: a clear exploit, severe degradation, or other major consequence;
major: a real defect or a clear departure from the repository's rules; minor: worth fixing without
holding the work up; low: a small issue with limited impact; info: a nitpick or an uncertain point
worth flagging), the file and line, whether it is about security, and the findings one agent
would fix with it in one go (a bundle, as on a review card). A review that ends without recording
any failed; the card says why, and it can be started again.

"Reviews happen" says when:

- "Automatically, with the demo": the review starts as the worker hands over, and the card shows the
  demo at once, but the owner is not notified (push, desktop notification) that it waits until the
  review has finished, whether the handover is the first or follows "Fix it". A "Review" tab stands after the deliverables, before Diff (see The files beside
  the demo in Conversation on the card): its running status, in the reviewing teal, names the reviewing harness and model
  and has a "Stop review" button (the review is dropped and leaves nothing, as on approval), then it shows the findings, the open ones counted beside the tab's title by severity in colour.
  A completed, current review with no findings shows a green checkmark beside the title.
  Blocker has a dark purple badge,
  critical a saturated red badge with white text, major a lighter red, minor orange, low yellow,
  and info grey. The conversation notes the findings by severity when it is done, or says why it
  failed.
- "Manually, at handover": nothing runs by itself. "Approve" stays first and primary; beside it
  "Start code review", in purple, until the latest handover is reviewed. The click runs exactly the
  automatic review and opens its tab.

While either review runs, the card's state rule and status line turn blue-green and say "Agent
reviewing"; it does not show an attention badge while the review runs. "Approve" becomes a yellow warning button, and stays one while
the card's agent (the same or a new one) fixes findings the owner sent it, until its next handover:
fixing is part of the review. A second, smaller line inside it says why: "Review in progress" or "Fixing in progress". Clicking it asks "Approve without Review?"
and explains that approval stops the in-progress review and moves straight to landing. The owner
chooses "Stop Review & land" or "Continue review"; the latter leaves the review running.

Changing the setting (or starting Seismic after it changed) reaches work already waiting for approval: with Manually a "Start code review" button appears, with Off the review goes. Automatically starts reviews at handovers only, never on work already waiting; findings are never settled by a setting change. Planned cards follow the setting once they hand over; cards already at work when it changed hand over without an automatic review (Manually still offers the button).

Approval never waits for a review: approving while one runs stops it, and nothing of it stays. A
handover makes the review before it stale unless the branch's commit is the one reviewed (an answer
to the owner's words that changed no code keeps it): a review still running stops, and in automatic
mode a new one starts; in manual mode the tab, findings and all, reads "outdated" and "Start code
review" returns. Stopping the card stops a running review too. A restart of Seismic waits for a
review at work as for a worker in a turn: its agent hears of it, ends its turn without findings, and
goes on in the same session once Seismic runs again (a session that does not resume, another harness
say, starts the review over); a review due while a restart waits starts after it. The card's log
says it paused and went on; the tab reads running throughout. Only a review of work no longer waiting
for approval after the restart failed ("Seismic restarted meanwhile").

The Review tab lets the owner step through earlier completed reviews, in chronological order, as
with earlier demos. Each shows its findings and the selections made on them at the time. Earlier
reviews are read-only: their finding choices and submission controls are unavailable. The latest
review remains selected by default, including while a newer review runs.

The findings are the same element as a review card's (see Review cards in Landing), with the severity
and where the finding is. On each open finding of the latest review the owner chooses "Fix it", "As
a follow-up task" or "Ignore" (a second click takes it back; an ignored one is settled and leaves
the list without reaching the worker, as on a review card). Every later review of the card's work
is given the findings ignored or chosen as follow-up tasks in its earlier reviews, including the
linked follow-up tasks where created, so it does not raise them again; the choices stand above the field and go to the
worker with the card's one Send, with or without words of the owner's, exactly as on a review card.
Each open finding also has a "Write more context" button at its bottom right, apart from the choices: it opens a text box and becomes "Save"; the saved words stand on the finding (button "Edit context") and go to the agent verbatim with the finding's decision, on review cards too. They are kept like the choices until sent and dropped with them; an ignored finding sends none. Finding numbers start again with every code review, so choices and context belong to the review they were written for: as soon as the card's review is another one, whichever tab is open, they are dropped, and a draft holding them from before this was tracked is dropped too.
Approving while choices on findings are picked but not sent asks first: "Approve and close items" approves and drops them, "Go back" keeps them.
The Review tab also offers "Submit answers" beneath the findings once a choice is made, so the
owner can send those choices without opening the conversation on a phone. Sending them takes the
card straight into the agent's response, clearing "Waiting for you", its "Needs you" inbox count,
and its notification while the agent works, as sending the same choices through the conversation does.
The worker reads each finding in full (it did not write them) and fixes those to fix on its branch,
handing over again with a new demo where the change shows; that handover marks them fixed. While
the worker fixes them, those findings fold to their head line (number, title, severity) with a
"Fixing" badge before the severity, so the ones still to decide stand out; a click on the head
unfolds one. A finding
it holds wrong it explains in its handover instead. Follow-up tasks it makes with a tool of its own,
bundled as the owner's words say, else as the review bundled them: tasks beside the card, following up
on it, started at once and waiting in the queue until its work has landed (the reason reads "Builds on
it"); until each finding chosen has its task, the worker's handover and reply are refused. A finding
made a follow-up task links it.

### Approval and landing

Where work lands through pull requests, the approve button reads "Freigeben (PR)": the card goes
`in PR`, its worker opens the PR (until then "Approved · agent opening the PR"), and Seismic carries
it through to the merge, which it does itself unless the settings leave the merge to people on the
forge (see PR loop).

Where the settings allow it (`direct`), "Straight to main" beside it pushes the work onto the
default branch without a pull request, review or the PR's CI (see How work lands); only the button
does, never words to the Koordinator. Where work lands on `main`, approval lands it at once.

A review card, a contributor's pull request (see Review cards), reads "Merge (PR #5)": Seismic merges
the head its worker reviewed, and the card is `live`; while a change request waits for the
contributor it is `in PR`, "Waiting for the contributor".

An approve click folds the card at once without waiting for the server: the canvas card says what is
under way: first "being approved …" or "being pushed straight to main …", then the landing or its
place in the repository’s landing queue (see How work lands). It no longer counts as needing the
owner and is skipped by Tab, which goes on from the place of the card it opened last. A message with
a spinner stands above the microphone, which the answer turns into the confirmation or, when the
landing is refused, into the reason, with the card waiting for review again; a restart that cut the
landing off gives the card back the same way.

#### Feedback after approval

The owner is asked how the agent did when the card goes into the archive by the owner's hand, as the
project's "Cards archive" says (see Archive): where the owner archives cards ("Manually", the
default), once the card is archived (its archive button, on the card or the project, or "all
finished ones at once", which asks about each in turn); where cards archive themselves
("Automatically, after landing"), once the approval has gone through (the card's button, work that
changed nothing included). A workstream, which goes into the archive only with its plan, is asked
about after its approval either way. Then a prompt stands
right above the microphone, under the confirmation: "How well did the agent do “…”?" with five stars (Poor, Fair, Okay,
Good, Excellent) and "Skip". A star saves the rating at once; then a comment
field opens, optional, and "Skip" becomes "Done". The prompt stays until answered or
skipped, also when the card goes into the archive meanwhile; another approval asks about its own card instead. Skipping records nothing: the card keeps
asking. Every approved card (`approved`, `in PR`, `live`, `done`, archived too; archiving by hand,
only once archived) whose latest
handover has no response shows the same stars and comment under its conversation, and once answered
shows the answer there to change; an unsent comment is a draft of the card's like any other. Saving
goes its own way: approval and landing never wait for it, and a refused save shows its reason in the
prompt, the approval standing. A response is about the latest handover (see Models and effort in
Agents and workstations); approved again for the same handover (a retried landing), nothing new is
asked once answered; work handed over anew asks afresh. Review cards of contributors' pull requests
and prototypes are not asked about. "Feedback after approval" in Configuration → Notifications and limits turns
the asking off and on for every open page at once; turned off, no card asks or shows a rating, and
the responses given stay.

#### Comparing ratings

"Compare ratings" (beside "Feedback after approval" in the Configuration, and
under the stars of every rated card; the logo's menu has it as "Agent performance") opens "Agent performance" over the page, as the configuration
is: every response on every project (`/api/feedback`), grouped by whom it credits (see Models and
effort in Agents and workstations). Each harness heads its rows, one per model and effort, the model
as the session resolved it and an unknown field named unknown; work by several configurations
("Several configurations") and work nothing was recorded of ("Not recorded") have rows of their
own under "Not credited to one model", never counted for a model. Rows are ordered by harness,
model and effort, never by score. Each says how many ratings it rests on, their average and
comments; a row with fewer than five ratings is greyed and tagged "few". The main view shows
each row's ratings split by stars as one bar ("Spread"); "Each rating" draws each rating as a
dot on the scale from 1 to 5 with the median as a line, the dots of one rating scattered in a cloud
that grows with their number (the same at every render), each dot the larger the newer its rating, in
five steps: up to three days, a week, a month, two months, older; "Over time" puts above the table each
model and effort's average per month as a line (from the first month with a rating to the last), a
month of fewer than five ratings a hollow point, work credited to no one model without a line. The
view chosen is kept per browser. With
fewer than five ratings in all (after the filters), there is no table and no average, only the
responses so far, each with whom it credits. The head counts responses, ratings and those credited
to no one model. Filters: project, repository and plan (each only where there is more than one to
choose, a plan as soon as there is one), and the period (all, the last 90 or 30 days, by when a
response was last given). A click on a row lists its responses, the latest first: the card's title
as it was (a link to the card: on this project it closes the dialog and opens the card, archived
ones from the archive; on another, its address), plan, repository, project where they differ,
date, stars and comment, and for mixed work the configurations that did it. A deleted card's
response still counts and says so, its title without a link. Closed and opened
again, the dialog keeps its filters and open row; it holds the keyboard's focus while open and
gives it back to what opened it. A response with only a comment counts as a
response, not a rating. The phone view has no dashboard.

"Feedback log: every response by time" in the dashboard's head leads to the Agent Feedback Log, a
page of its own in place of the project (`/p/<project>/feedback`), with the dashboard's filters as they
were; its link "← Agent performance" leads back to that project with the dashboard open and the filters
the two share, and so does the browser's Back. A page rather than a view in the dialog: a long list
of responses wants the whole screen, and an address of its own keeps it across a reload and makes it
a link (2026-11). It lists every response on every project, the newest first (by when it was last
given), each with its date, card (a link to it, opening on its project, archived ones from the
archive; a deleted card's title without one), stars ("no stars" for a comment alone), comment,
whom it credits (for mixed work "Several configurations" with the configurations that did it),
plan, repository and project. Filters: the dashboard's (period by when a response was last given),
then harness, model and effort of the credited configuration (each where there is more than one to
choose, an unknown value named unknown), which work credited to no one configuration never matches,
and rating, whole stars or "no stars". Grouping: none, configuration (in the dashboard's order,
mixed and unrecorded work last), plan, repository, project (by name, those without one last),
week (from Monday) or month (the newest first); each section heads its responses with their count
and average, and the column it groups by gives way to that heading. The head counts the responses
shown of all. With no responses at all it says what fills it; when the filters leave nothing, it
says so with "Clear filters". Filters and grouping stay in the address. Every control is a
link, a select or a button, in reading order for the keyboard.

### Live and done

Merged (or landed on `main`) → `live`. The demo stays on the card. The worker hears that its work is
on main and may finish what waited for that (see After landing).

Work that changed nothing in the repository (a demo, an analysis, an answer) has nothing to land:
when the handover finds no commits of the card's own (measured as in The Koordinator) and nothing
uncommitted, the button reads "Beenden" with a line that no pull request follows, and approving makes
the card `done` ("Erledigt"). The handover's answer tells the worker what the button will do, as
Seismic sees the branch: close the card, or land the files it names. A worker knows the commits it made,
not those its branch carried from before, and otherwise told the owner the opposite of what the card
showed. A worker whose
branch emptied after the approval closes the card with `close_unchanged`, refused while the
workstation holds changes.

A finished card an agent worked on keeps its field: a question there resumes that agent (see
Questions after the work).

### Archive

The owner archives a finished card ("Archivieren" on it, its archive button on the canvas, or all
finished ones at once in the archive); a prototype goes there when it ends (see Prototypes). The
project setting "Cards archive" chooses between "Manually" (the default: only so) and
"Automatically, after landing": then an owner's finished task goes into the archive by itself as
soon as its work has landed (or closed without a change) and its worker is done after the landing,
with a line in its log; a workstream still goes with its plan, and a card brought back from the
archive stays on the canvas. The setting also decides when the owner is asked how the agent did
(see Feedback after approval). A
stopped task ("Stopped") can be archived one at a time, for the owner to come back to, beside "Start again" and "Delete"; not while it waits to start, nor while its workstation holds work that has not
landed, or a clone keeps its branch since its workstation was taken (the button is greyed and says
why), which would lie unseen in a clone. A stopped card opens
like a card an agent worked on, the task as its conversation's first message.

The archive (its button in the bar, or `A`) drops down like the queue: archived cards on a timeline
by day, newest first, each at size XS (see Card sizes) beside the time it was archived, a plan with
the count of its workstreams. One unfolds as on the canvas and can go
back to its place; an ended prototype only shows, read-only, how it ended. A search field, focused on
opening and kept between openings, filters by every typed word (case and accents aside) in title,
text, summary, last status, state or kind, and a plan's goal and workstreams, marking the words in the
titles. The list stays under the dim while a card from it is open, so the card folds back into it.

### Plans end

A plan ends when every workstream in its plan doc is ticked on the default branch, or when the
doc is deleted: it moves into the archive with its workstreams, which are not listed on their own. A
workstream still at work then (or its worker finishing after the landing) keeps the plan on the
project until that worker is done. Opened from the archive, its sheet shows read-only the goal and
workstreams as the doc last stood, each workstream with its conversation and demo. When the file
comes back, or gets an open workstream, the plan returns to its place.

Every plan's sheet holds its conversation with its plan agent (see Asking in a plan's
sheet), lists its decisions and links the idea or task its plan doc came from (see Deciding).

### Decisions

- **Code reviews are a project setting, by a separate agent of a model group of its own, only where
  work lands on `main`** (owner, 2026-11-05): automatic with the demo (the Review tab with its
  coloured counts) or manual at handover ("Approve" stays first and primary, "Start code review" second in purple:
  the everyday button keeps its place); the
  owner sends findings to the worker to fix with the one Send, or makes them follow-up tasks. Off by
  default: reviews cost tokens, and nothing reviewed before. Rejected: the worker reviewing its own
  diff before handing over (no fresh eyes, no separate model, nothing the owner can start at
  handover); reviews of work through a pull request, which the forge's reviewers cover (a card of its
  own takes those up); approval waiting for the review.
- **A review stands for a later handover of the same commit** (2026-11-05): an answer to the owner's
  words with ready_for_review and no new commit would otherwise start a new review each time, at its
  cost, for a diff already reviewed.

- **The dashboard compares without ranking** (owner, 2026-11-03): ratings are the owner's judgement
  of single tasks, whose difficulty and kind count too, so rows keep a fixed order, always show how
  many ratings they rest on, and below five ratings in all give no averages. The owner chose the
  table with each row's spread of stars as the main view, beside it the dots of each rating and the
  trend per month, whose sparse months are drawn hollow rather than left out. Rejected: sorting by
  average (it reads as a ranking the numbers cannot carry); recommending a model from the ratings, which is for
  [Choosing an agent for a task](../plan/agent-choice.md) to take up.

- **Feedback is five stars and an optional comment, asked after the approval and never in its way**
  (owner, 2026-11-03): five steps give comparisons between models enough range, the comment says
  why. The rating is kept off the approve button so approving never waits for an opinion. Rejected:
  thumbs up or down (too coarse to compare), a required rating, a prompt that ends with the
  confirmation's few seconds (the card keeps asking instead).

- **A proposal is written for the next worker, with its reason and questions apart.** Rejected: one
  first-person text with the questions buried in it, which went to the next worker as if the owner
  had written it.
- **A proposal the owner talks about is rewritten by an agent of its own** (2026-10-06). Rejected:
  the proposing worker (may be gone or busy) and the Koordinator's quick turn (a whole card text
  would slow every confirmation).
- **On an open proposal, the owner's words go straight to its reviser** (2026-10-14), as on any card
  with an agent. Rejected: the Koordinator reading them first, which delayed the rework by the undo
  window.
- **The reviser replies, and a settled question stays where it was asked** (2026-10-14). Rejected:
  a silent reviser, after which the owner who asked about a question saw neither it nor an answer.
- **Accepting a proposal does not wait for its rework** (2026-10-06): whoever answered the last
  question knows starting comes next. Rejected: a disabled button.
- **An agent takes back its own proposal** (2026-10-17): an accepted one is only marked, since the
  owner chose it and work may be under way. Rejected: a new proposal saying it replaces an older one;
  the owner started both.
- **A follow-up due later is a proposal with a start time** (2026-10-21), so it does not go under in a
  handover. Rejected: the proposal coming back at the time (the owner decides twice); the worker's
  card staying snoozed after its handover (the approval would hang for weeks); a calendar entry (it
  only reminds, where the card's agent can check part of it itself).
- **A proposed task can be taken as an idea** (2026-10-16), to discuss and prototype it first.
  Rejected: only the proposing worker deciding whether a proposal is an idea.
- **Feedback keeps the approval** (2026-10-08): the owner's words reach the worker at once and the
  approval stays at hand. Rejected: sending the card back to `working` until the next handover,
  which took the approval away and held the feedback for "Undo" like a command.
- **Only words for the owner count as an answer** (2026-10-19). Rejected: counting any end of a
  turn, which left "Agent answered" under a question no agent had seen.
- **An answer given while only the app it started runs on gives the card back** (2026-10-28,
  narrowed 2026-10-29). Rejected: keeping the card at work as long as any background work of that
  turn ran, which showed an agent at work on the owner's words for hours while only the test server
  it had restarted for them ran; and giving the card back whatever background work ran, which read
  "waiting for you" while the tests and render the agent had said it would hand over after still
  ran. The app is told apart by `app_running` rather than by the work's duration or the agent's
  words: the SDK says neither which task serves what nor whether the agent waits for it.
- **A demo a worker reworks after an answer is at work, not the owner's** (2026-10-07). Rejected:
  keeping the badge, where a worker paused for a restart was never resumed.
- **A later handover says only what is new; a reply that changes nothing ends the turn**
  (2026-10-15, 2026-10-16): the owner has the rest in the conversation. Rejected: calling the
  summary the whole report, and a reply that told the worker to carry on; both made handovers repeat
  the reply just before them.
- **An approve click folds the card at once.** Rejected: the card staying open with no sign of the
  click until the push was through.
- **Work without a change ends in `done`, not `live`** (2026-10-02). Seismic reads it from the
  workstation, not from the worker's word. The owner still approves it: its demo or summary is the
  result. Rejected: waiting in `in PR` for a PR that never comes.
- **A finished card keeps a field for questions to its agent** (2026-10-08).
- **What the owner archives**: only their own finished cards, ideas once parked or dropped (a parked
  idea's result may have been used outside Seismic, 2026-10-15), and stopped tasks (2026-10-15).
  "All finished ones at once" leaves ideas alone; a workstream goes with its plan. Archiving
  keeps the card's position, demo and log.
- **The rating comes with archiving where the owner archives by hand** (owner, 2026-11-07): a card
  the owner archives is judged when it is put away, after the owner has seen the work live, not
  in the moment of approving; where cards archive themselves, there is no such moment, so the
  approval asks. Archiving by hand is the default.
- **No card goes into the archive while its worker finishes after the landing** (2026-10-16):
  workers are looked up among the cards on the canvas, so the worker of an archived card never ended
  its turn and held its clone out of the owner's sight.
