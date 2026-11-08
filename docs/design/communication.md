## Communication

A chapter of the [design doc](../design.md), whose header says how it is written.

Agents never talk to each other directly; the Seismic server is the mailbox, so every exchange is
visible on a card.

### A worker's tools

- `report(status)`: a status line on the card, belonging to the stretch of work it reports on: a
  handover or an approval clears it, and a line reported while pausing for a restart gives way to
  the one from before.
- `reply(text)`: its answer to a note or feedback. It does not end the turn; with no work left, the
  turn ends with it and the card goes on waiting for approval.
- `ask(question, options, multiple, pick, pick_why, demo)`: returns at once; the worker ends its
  turn and the answer is its next message. `demo` is what the owner is to look at to answer (drafts
  side by side), shown on the card as a handover's demo is (see The demo on the card in Demos). The owner picks one option (several when `multiple`), writes their
  own answer, or both. `pick`/`pick_why` are what the worker would choose and why, marked "I would take this" on the card. Picks travel apart from the owner's words: the worker reads `They picked "…".`, an own answer
  written in place of an option as `They answered in their own words: "…".`, and below it what they
  `added in their own words`; the log keeps both as one text, picks first.
  An answer stands in the conversation at once and leaves the card open.
- `propose_card(title, task, reason, idea?, questions?, replaces?, start_at?, repo?)` and
  `withdraw_proposal(title, why, replaced_by?)` (see Proposals): something it noticed outside its
  task, instead of doing it, or a follow-up due later (`start_at`). `repo` exists wherever Seismic
  runs more than one repository: its description lists the ids and paths of the project's own and,
  by project, those of the other projects.
- `ready_for_review(summary, demo)`, whose summary is the report the owner reads. The demo's
  `question` (text, options, multiple, pick, pick_why) is asked and answered as with `ask`, while the
  card goes on waiting for approval (see Waiting for approval in Card lifecycle).
- `app_running(url)`: where the app in its workstation opens, for the owner to try by hand (see Trying
  the app by hand); for a workstation on another machine Seismic forwards the port.
- `snooze(until, why, card, state)` (see Snoozing a card).
- `to_seismic(request)`: what the owner's words ask of Seismic rather than of the worker (see Passing a
  request on to Seismic).

A call that ends the turn (`ask`, `ready_for_review`, `pr_opened`, `snooze`, `after_restart`)
returns "end your turn now". When the owner's words waited for that very step (see Reading order in
Conversation on the card), its result carries them instead, says what stands meanwhile (the question
waits for the owner, the handover for approval) and leaves the turn to the worker: it answers them
with `reply`, does what they ask, asks anew if they change its question, then ends the turn.

Seismic's messages to a worker say what happened (feedback, an answer, a note, a failed landing, the
landing), not what to do next: whether to record a demo again after feedback is the worker's call
(see The demo on the card).

### Turns that end without a handover

A turn that ends without `ask` or `ready_for_review` gets one nudge, then its last words become a
question to the owner; a turn that failed (an SDK error result, e.g. Claude not logged in) becomes
the error in words instead. A session that died with its error (Codex refusing its configuration,
say) or an agent that could not start at all gets no nudge, which nothing would hear: the error goes
to the owner at once, and their answer starts the worker afresh (resuming its session where it had
one). Such a card shows as failed: the owner's turn in red, its pin "!!", its state "Agent stopped
with an error". A worker that then works on by itself takes that question back.

A turn that ends while the worker's own background work runs (a render, a test suite, a watcher) is
not such a turn: the work wakes the worker, so Seismic waits, also after the landing, where an ended
turn would otherwise finish the card and remove its workstation. The SDK reports each change in how
much background work runs; Seismic waits as long as some does, bounded by the work's own limits (two
hours for a background command, half an hour for a watcher; three hours for a session that never
says the work ended). It nudges only ten minutes after the work ended without a sign of life. A turn
in which the worker said and did nothing does not count: a session resumed after a restart first
ends a turn over what the previous one left, which would otherwise use up the nudge.

#### Usage limit

A turn the account's usage limit stopped (five-hour or weekly) is neither nudged nor a question. The
SDK's `rate_limit_event` says `rejected` and when the limit resets (API error `rate_limit`); without
the event, the message's "resets 7:20pm (Europe/Berlin)" says when. A Codex turn fails with
`usageLimitExceeded`; the reset is the latest one of the windows its `account/rateLimits/updated`
reports used up, else the time its message names ("try again at 10:41 PM.", on the machine's
clock). Seismic waits for a future reset, with a ten-second clock margin. Without a reset it
tries again after fifteen minutes, or after a minute if the reported reset has passed. Three
consecutive refused turns exhaust this retry budget: a worker's session closes and releases its
slot, while its card and workstation stay. A failed manual attempt pauses it immediately again;
actual text or a tool step clears the budget. Duplicate errors from one refused turn count once.
A light-blue bar and an hourglass mark the usage pause, with a visible way to try again now.

The server watches reset times centrally without asking an agent. Its Koordinator periodically
wakes all limit-paused workers whose recorded reset has passed, including after a server restart
or the machine waking from sleep. Pauses with no known future reset stay paused until the owner
tries again; a failed attempt cannot turn an old reset into a new retry loop. A project paused by
the owner stays paused. A worker's limit pause stores the retry count, known reset and earlier
status line with its existing pause record. On successful work its earlier status is restored.
The conversation shows the limit where it happened. A worker stopped while taking in the owner's
words on its handover is still at them: the card does not wait for the owner. Background work
continues during the first two waits; reaching the retry cap ends the worker's session and its
background work as a normal immediate pause does.

Every other agent waits the same way: look-ups, plan agents, Question cards' and ideas' agents,
the reviser of a proposal, and the Koordinator's small jobs (naming and checking cards, the learner,
the retrospective, the work retrospective). The stopped turn is neither an error nor over; the owner's
words meanwhile wait for its next turn. Where the agent waits says until when: under a looked-up
question "Usage limit · looks it up by itself at 19:20", on a card's face and in its bubble
"Usage limit · continues at 19:20". These agents share the retry budget and central reset watcher; their in-memory wait is
re-established after a restart. Ending the session (pausing the agent, parking the idea) ends the wait. Two do not wait: a demo page shared
without the worker's text (it takes the card's title and the summary's start) and the draft of a
wish, whose owner waits in the dialog (see Wishes for Seismic's makers). Seismic's chat: see
Confirmation and undo.

### Pausing an agent

A note reaches the worker at any time without stopping it. To stop it mid-work, the conversation's
bubble that shows the agent at work ("Agent at work") has a pause mark, faint. At the desk it
shows only while the pointer is on the bubble, so a long run does not keep a button in view; on a
touch screen it is always there. By voice "pause for a moment". Both pause at once.

On the project, the card shows a faint pause while the pointer is on it, in the corner where other
cards show their play and archive buttons (see The canvas), which pauses at a safe point instead:
the agent brings its work to a clean stop first, as for a restart (see Waiting for the workers). A
worker hears that the owner pauses it: it finishes the step it is in, starts nothing long, stops the
background work it can start again and ends its turn, without handing over if it is not done. An
idea's or Question card's agent finishes the reply it works on. Meanwhile the card reads "Agent pausing
…" and its bubble "Agent pausing …", whose pause still stops it at once. Once the turn ends,
however it ends (with a handover or a question too), the agent is paused as by the bubble's pause;
background work the worker let run keeps it from pausing until it ends, and the turn that work
starts hears that the owner still waits. A worker that has not ended its turn after 15 minutes is
paused at once. One with nothing running that could be cut off (its workstation still being made
ready, waiting for the usage limit) pauses at once. A restart meanwhile leaves it paused. On the
same hover, a paused card, and one about to pause, shows a faint ▶ there, which resumes it as
"Resume" does; the one about to pause hears that it works on instead, and so it does with the
owner's words to it.

The bubble and the pause exist exactly while an agent runs a turn (background work included): a
Question card's agent reading, an idea's agent replying, a worker in any card state (at work, taking
in the owner's words on its handover, in its PR, finishing after the landing). An idle agent (a PR
card waiting for review) has neither. The reviser of a proposal has no pause: its rework is short.

A worker's bubble also lists its background work under "In the background", each task as the agent
described it, with how long it has run, counting from when Seismic first saw it (the SDK gives no
start time); the SDK's own housekeeping does not show.

Pausing (at once, or once the turn has ended) ends the session, mid-step if need be, with whatever
it ran, and keeps the card's state and the session. A worker keeps workstation and branch, frees its slot, and its app is parked
after the grace; one paused on its handover leaves the card waiting for approval ("Demo ready ·
agent paused"), Approve included. An idea's or Question card's agent keeps what it had not
answered. The bubble stays where the agent stopped, in pencil grey, "Agent paused · ▶
Resume", over the line "Paused."; a restart of Seismic leaves paused agents paused.

"Resume" (by voice "carry on") or anything the owner writes resumes the same session; the
agent hears that it was paused and what ran was stopped (exit code 137), plus the owner's words and
what it had not answered. What Seismic had for a paused worker meanwhile (a review, a landing) goes
along then. "Stop" stays in the card's action row: it ends the agent and plans the card again.

### Pausing a project's agents

With several projects, each project's row in the navigation (see The navigation) shows the moving line of a card at work while
at least one agent works on that project (any agent with a pause, as above). While the pointer is on
the row, the line turns into a pause button, faint like a card's, "pause x running agents" in its tooltip; with
none at work but at least one paused, the row shows ▶ on the same hover, "resume x paused agents". On a touch screen the button is always there. Nothing else of it sits in the bar. The
phone has none of it, to stay simple (owner, 2026-10-30): pausing is for the desktop.

Pausing pauses each agent at work there as the pause on its card does, at a safe point; those about
to pause count as paused already. As long as one of them is still paused (or about to be), the cards the Koordinator lets start on that project wait in the queue ("Waiting:
project paused") instead of taking the slots that pausing freed. Resuming resumes every paused
agent there, as "Resume" does, and the waiting cards start. Once none on the canvas is paused
any more (the owner resumed each on its card, or their cards went), the queue runs again by itself;
one that could not go on (its repository left the project) is still paused and keeps the queue held.
A restart leaves it as it was: the cards stay paused and the project holds its queue. A snoozed card
is not a paused agent, though its worker stopped the same way: it counts for neither number, the
project's resume leaves it asleep, it holds no queue, and its card shows no ▶; it wakes at its time
or by "Wake now".

### Snoozing a card

A card can be set aside until a point in time, by its worker or by the owner. A worker can also
wait until another card is done (on main, or closed without a change) or waits for the owner (asks,
hands over, or is a proposal or an idea with questions), as a release waits for another card's fix.
Seismic holds the time and the card, not the agent's session. No other condition: waiting for CI
stays background work.

The worker calls `snooze` with `until`, or `card` (exact title, else a part only one open card's
title holds) with `state` `done` (default) or `waits_for_owner`, or both, waking at whichever comes
first, and ends its turn. A card already there or a time already past is refused. It takes effect
without asking the owner; the session ends, background work with it; workstation and branch stay, the
slot frees, the app is parked, and no nudge follows. It is allowed only while the card is at work
(started, in its PR, finishing after the landing) or its worker takes in the owner's words on its
handover, and the owner is not pausing it (the pause would end at the snooze's time); a question or
handover in the same turn takes it back. Snoozed on its handover (the owner asked it to check again
in three days), the card leaves the count of what waits for the owner as one the owner snoozed does, its handover stands
and can be approved meanwhile, which ends the snooze; woken, the worker is at work on it again. Its instructions send waits longer than a background command's two hours, and waits for
another card, to `snooze`; checkpoints are one snooze after another. Idea and Question cards' agents
have no such tool.

The owner snoozes with "Later" (a visible button with a clock in the action row; by voice "snooze
this until tomorrow morning"): this evening 18:00 (while more than half an hour off), tomorrow 08:00,
next Monday 08:00, or a date and time. One menu serves every kind of card. It is offered on cards at
work, cards waiting for the owner, and planned tasks not yet with the Koordinator:

- A card at work stops as on a pause and goes on where it stopped at the time.
- A card waiting for the owner leaves the count of what waits and Tab, moves to the end of "Needs you", and comes back
  at the time like a snoozed mail, with a push to the phone. Nothing goes to its agent; background
  work runs on. Answering it anyway (or parking the idea, reworking the proposal) ends the
  snooze.
- A planned card starts at the time as if the owner had started it, through the Koordinator's queue;
  its worker hears that the card was set to start then. "Start", "Wake now" or "Start
  all" on its plan start it at once. An accepted proposal with a start time is such a card
  (see A proposal that starts later). A card no longer planned to start (made an idea or plan,
  archived, started otherwise, its plan doc gone) is snoozed no longer, so it never starts unasked;
  a change to its plan doc leaves the snooze.

Waking is checked every 15 s, on every board change (so a card that only passes through the awaited
state counts) and at every start of Seismic; a time missed while Seismic was down or the machine slept is
caught up then, and a restart touches no snoozed card. A card wakes when its time comes, or its
awaited card got there or no longer will by itself (stopped, archived, removed, idea dropped). The
worker hears why and what for (and that the owner moved the time, if so); one the owner snoozed
hears that and that what ran was stopped. The owner's words or "Wake now" wake it earlier,
as does, for a worker that snoozed itself, whatever Seismic has for it (a review, the landing, a failed
check); it hears what woke it (no words: the owner wants to know where things stand) and may snooze
again. For a worker the owner snoozed, such news waits. A question for the owner that arises
meanwhile (its PR closed, a tool call to allow) ends the snooze.

On the project a snoozed card is pushed back on greyed stock with a clock: "◷ Snoozed until
tomorrow, 00:05" (or "until "…" is done", with "at the latest …" when it has a time too), with who
snoozed it and why. One waiting on another card shows that wait while the pointer is on either, as
a queued card does (see The queue's order). It counts neither as at work nor as needing the owner; on the phone it stands at
the end of its list. Its conversation shows a line where it was snoozed, carrying "Wake
now" and "Change" (the same menu, whoever snoozed it) while it lasts, and on waking a line
that says why it is back ("Back: time reached", "… woken by you", …).

### Waiting without blocking

The SDK hands a waiting message to the agent only after its running tool call, so a note never cuts
a command off; workers therefore keep tool calls short, wait for anything external (a deploy, a CI
run) in the background (`run_in_background`, Monitor) and end their turn, which a note restarts at
once. Longer waits are a snooze.

A foreground Bash command that sleeps longer than 30 seconds (`sleep N`, an unbounded polling loop,
judged from the command line) is refused with that reason. `timeout N` (or `gtimeout`) bounds the
command it starts wherever it stands in the line. Heredoc text counts only when a shell runs it
(`bash <<EOF`, `ssh host <<EOF`). The refusal names two bounded waits that pass, one without
`timeout`, which macOS lacks. The refusal is Claude's only: a note sent to a Codex worker reaches it
while a foreground command is still running, so Codex has no such guard (see Native Codex workers).

### Refused and confirmed tool calls

A tool call refused without asking anyone (a deny rule, auto mode's classifier, the permission mode,
a hook, the foreground-wait refusal) stands in the card's conversation as a line ("Not allowed
(rule in the settings): $ …"), with the SDK's reason when it gives one.

A tool call the settings want confirmed (an `ask` rule, say for database writes) becomes, through the
SDK's `canUseTool`, the question the card waits on: the whole command, Claude Code's reason, options
"Allow" and "Deny". The call waits within the worker's turn; meanwhile the worker counts as
waiting for the owner, so a restart need not wait for it. "Allow" runs it (words with it reach the
worker next); "Deny", words alone or a note refuse it with the owner's words in the result.
Concurrent calls are asked one after another. A card that moves on without the answer (its PR merged,
a review card's PR closed) refuses the call with what happened, so the worker goes on instead of
waiting for a question no longer on the card. After a restart the question stays; answered then, an
allowed call runs once without asking when the resumed worker makes it again. It is no decision for
the plan's log. Claude Code's `AskUserQuestion` is refused with a pointer to `ask`.

Codex's native command and file-change approval requests use this same question and one-call
allow/deny decision, not session-wide permission or policy amendments. A refusal by the owner is
labelled as such, not as Seismic's foreground-wait guard. A saved one-use grant identifies the action
and its permission scope, not ephemeral turn/item ids, callback ids or timestamps: a restart can
reissue the same action without asking again, but a changed command or requested authority needs
a new decision. Requests granting write access to a root for the rest of the session and extended
permission profiles are denied. A denial's accompanying owner instructions reach the coding loop
as input, since the wire decision itself carries no text. Resolving a native request or ending its
turn withdraws the obsolete question and settles its callback; closing a session instead preserves
the question for restart. Native user-input requests must use Seismic's `ask`.

### Notes and replies

A worker answers a note or feedback with `reply`, saying what it changes or why nothing, and asks if
the note is unclear. The closing words of a turn in which it replied mostly repeat the reply (often
in another language than the project's), so they fold under it as its last step, together with any steps in
between; closing words after a handover are left out. Words followed by a further step stay its
words.

A note while the card waits on the worker's question takes the question back: the card returns to
work (in its PR or after the landing, where it was), and the worker hears that its question is
withdrawn and asks anew if the note did not settle it. The note is no answer and goes into no
decision log. Words on a demo whose report asks a question answer it (see Waiting for approval).

### Questions go to the owner

A worker's question goes straight to the owner, with the worker's own pick; no other agent answers
for the owner. The worker asks only what it should not decide itself (product behaviour, trade-offs,
anything irreversible or external). What a plan has decided reaches its workstreams' workers
instead: a worker's task holds its plan's decision log ("Decisions taken in this plan so far")
beside the plan doc pointer, and a decision recorded while it runs reaches it at its next tool call,
as a learned preference does. Older answers agents gave in the owner's name stay in the logs, marked
"(an agent)". Owner-facing text from agents is in the owner's language (see Language).

### Decisions

- **An agent's question is a first-class thing with answer options**, not prose: the owner answers
  with a click, own words always possible, as the question's last choice with a field of its own
  ("Your own answer …"), so an own answer reads as the answer to that question rather than as a
  remark (2026-11-07). The answer travels as text, so the conversation reads the same later and a
  spoken answer takes the same path.
- **A handover's question has options like `ask`'s** (2026-10-29): one kind of question, answered with
  the same click and pick everywhere. Rejected: free text only, which made the owner type an answer
  the worker could have offered.
- **Picks travel apart from the owner's words** (2026-10-15), so the worker can tell them apart.
  Rejected: the pick as the first line of the owner's words.
- **A worker's question goes straight to the owner, with the worker's own pick** (2026-10-07).
  Rejected: a plan agent or the Koordinator answering and escalating only what it could not
  settle; the Koordinator then decided against building a feature, the owner's call, and an advisor
  knew barely more than the worker. Also rejected: narrower advisor rules, or an advisor that only
  suggests; the worker's pick gives the owner what a suggestion would.
- **Workers are told what happened, not what to do next**: they are full agents. Protocol stays where
  Seismic depends on it: `ready_for_review`, `ask`, `pr_opened`.
- **Words that reach a worker with the result of its turn-ending call leave it the turn**
  (2026-10-22). "End your turn now without further work" beside the owner's note had the worker end
  it in silence; the note looked unheard until the answer to its question came. Rejected: holding
  the words back until the owner answers (the worker could take them in at once), and a rule to
  answer every note beside the instruction to stop, which contradicted it.
- **A status line belongs to the stretch of work it reports on** (2026-10-09), so a line from before
  a handover does not stand over later work.
- **Background work keeps a turn open** (2026-10-12). Rejected: ending a turn a fixed ten minutes
  after it ended, which cut off a worker watching a deploy after the landing.
- **A turn on the owner's words that the usage limit stopped is still at them** (2026-10-16).
  Rejected: counting it as answered, which made the card wait for the owner, stopped its app and
  never went on by itself; and folding the limit's note into the next message, which put it under
  the reply to words the owner wrote after the reset.
- **Look-ups, ideas and the other agents wait for the usage limit too** (2026-10-17), in one shared
  wrapper an agent joins, so an agent added later waits by joining it. Rejected: only workers and
  Seismic's chat waiting, which answered look-ups with the limit error, ended idea turns in it, failed
  proposal reworks and named cards after their text's start.
- **The pause sits on the bubble of the running turn** (2026-10-15), not in the action row: the row
  holds decisions about the card, pausing is about the turn now running, and the pause exists
  exactly when a turn runs (also while a worker takes in the owner's words on a waiting card, before
  a paid render, say). "Stop" is named so it does not read like a pause. Rejected: the bubble's pause
  waiting for the next safe point, as for a restart: there the owner stops an agent going the wrong
  way (the card's pause waits, see below).
- **The pause, the reply and the copy button show on hover at the desk, from the first use on**
  (2026-10-29, owner): always in view, even faint, the pause drew the eye on every running turn. A
  newcomer finds a button that appears where the pointer goes, so none stays in view until its
  first use. Rejected: always visible; visible until used once. A touch screen, without hover,
  shows them all.
- **The card's pause and the project's pause wait for a safe point; the bubble's pauses at once**
  (2026-10-30, owner): pausing from the project sets work aside for later, and an agent cut off
  mid-step leaves half-done work (a test run, a render, uncommitted edits) to sort out on resume. The
  bubble's pause stays for an agent going the wrong way. The safe point is the one restarts already
  use, with the same 15 minutes at most. Rejected: one pause for all three places (either cuts off
  work the owner only wanted set aside, or lets an agent go on that is going the wrong way); a turn
  ending with a handover leaving the agent unpaused (a project whose agents all handed over would
  start its queue again).
- **A project pauses as its agents, each with its own pause** (2026-10-29, owner and maintainer, PR
  #22): the owner with several projects steers where the tokens go, pausing the less important
  ones. The project has no state of its own beyond holding its queue: what shows and what resumes
  are its paused cards, and the pause lasts over restarts as theirs does. Holding the queue keeps
  pausing a busy project from just swapping its running agents for its queued ones. Rejected: a
  project-wide stop at a safe point with every session ended and everything for its workers held
  (a state of its own beside the cards' pauses); a button beside the project pill (too close to
  the one in the navigation, and in view all the time); a setting to start Seismic with every project
  paused (pauses last over restarts anyway).
- **Waits of hours or days are a snooze Seismic holds** (2026-10-17). Rejected: workers keeping a turn
  open with chained background sleeps (the card looked busy for days and held a slot, every restart
  cut in, some 35 times a day, Seismic knew nothing of the reminders, and a night without network
  turned the midnight check into a stuck question); the agent only proposing a snooze for the owner
  to click (a click per checkpoint, while a snooze is undone with one); hiding only the restart
  noise; conditions besides a time or a card's state. The wording follows Gmail's
  "Snooze", which owners know.
- **A worker can snooze its card on its handover** (2026-11-02), when the owner's words on it ask
  for a later look ("Check again in three days"). Rejected: refusing it (the worker made a
  follow-up card instead, a second card for the same check); taking the handover back until the
  worker wakes (the owner could no longer approve meanwhile, as feedback keeps the approval).
- **A worker can snooze until another card gets somewhere** (2026-10-17): Seismic knows when that card
  lands, a guessed time means polling. The states are those another card's result shows in: done, or
  waiting for the owner. Rejected: any state change (each start, handover and approval would wake the
  worker); a wait the owner wires up (the worker knows what it waits for).
- **A question stands while background work keeps the turn open** (2026-10-16), with its options,
  since the card's header already says "Question for you".
- **Refused and confirmed tool calls reach the card** (2026-10-09). Rejected: dropping the SDK's
  denials, and refusing `ask`-rule calls silently for lack of someone to ask.
- **Closing words fold under the message they repeat** (2026-10-09). Rejected: dropping them, or
  showing them as a second message after the reply.
