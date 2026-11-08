## Running Seismic

A chapter of the [design doc](../design.md), whose header says how it is written.

### Server

Bun, TypeScript. HTTP + WebSocket to the UI, one API per project (`/api/c/<project>/…`,
`/api/projects` lists them); SQLite under `~/.obeya/`. `obeya <repo>…` starts one project with the
given repositories (`--name` names it); `obeya` starts the projects `~/.obeya/projects.json` lists,
`obeya --config <file>` those of another file. Without that file (the first start) it serves no
project, and the page is the setup assistant (see Setup assistant).

One Seismic per home: a running one writes its port and its supervisor's pid into `server.json` in
its home, and a second start on that home says where the first runs and
ends. An entry whose process is gone, or alive but silent for 5 s (another program got the pid), is
stale. A supervisor restarting its server marks the entry `restarting`, and a start meanwhile waits
up to 90 s for it, so the app started during a checkout's self-update opens that Seismic.

Seismic's environment variables are named `SEISMIC_*`; the names from before the rename, `OBEYA_*`, count
where the new one is not set. What Seismic sets for its agents and the skills (`SEISMIC_URL`,
`SEISMIC_HOME`, `SEISMIC_AGENT_PID`, `SEISMIC_HOLDS_VOICE`) it sets under both names, since older checkouts
and running agents still read the old ones.

The app and a checkout share the home (`SEISMIC_HOME` moves it for both): projects, settings, voices,
models and worktrees carry over, and workers one paused the other resumes. The database starts from
the schema Seismic was released with; later changes are migrations. An Seismic older than the database
(`PRAGMA user_version` above its migrations) leaves it alone and says to update; a database a
pre-release Seismic left below the release schema is left alone too, naming the commit to start once.

#### Who may talk to it

Only the owner. The server listens on `127.0.0.1`, which every program and account on the machine
reaches, and some routes run commands as the owner. So every request and WebSocket upgrade is
checked first for coming from Seismic's own site and for naming the owner.

*Its own site.* Any page in the owner's browser may send requests to `127.0.0.1` (a `text/plain`
POST needs no preflight and is parsed as JSON all the same), and a DNS name rebound to `127.0.0.1`
reaches it under that name. So `Host` (and `X-Forwarded-Host`) must be one of Seismic's names
(`localhost`, `127.0.0.1`, `[::1]`, and while other devices reach it the tailnet name or the address
it listens on; any port), else 421; an `Origin`, where present, must be Seismic's own (as
`X-Forwarded-Proto`/`-Host` say behind `tailscale serve`), and `Sec-Fetch-Site: cross-site` is
refused, else 403. A top-level navigation from another site to a page outside `/api/`
(`Sec-Fetch-Mode: navigate`, `Sec-Fetch-Dest: document`) passes: it only shows the page, and a phone
scanning the QR code often arrives that way; in another site's frame the page gets nothing. Requests
with neither header (the app's shell, scripts)
pass. Bun serves an HTML bundle past any handler, so the page lives at a
path made up at every start, fetched from there once the request passed.

*The owner's key.* 32 random bytes in `owner.key` in the home, readable by the owner alone. The
app's shell and Seismic's scripts send it as `X-Obeya-Key`; the page carries it in an
`HttpOnly; SameSite=Strict` cookie `obeya-<port>` (browsers keep cookies per host, not port).
Without it the API answers 401 `notOwner`, the page says "This browser is not signed in to Seismic" with how to sign in, and no WebSocket opens. A page opened by a link from another site
lacks the `Strict` cookie: it gets a page that opens the same address again, now with it.

A browser gets the cookie from a link, as in Jupyter: `/login?token=…` (optionally `&next=<path>`)
sets it and goes on from a page of its own, since a redirect in a cross-site navigation (from another
app, the app shell's `tauri:` page) carries no `Strict` cookie. The token is made at every server
start and signs in any number of browsers until it stops; an older link says it no longer holds. Only
a holder of the key gets it (`POST /api/login-link`, local only): Seismic prints it at every start, and
a second start prints the running one's; the app's window signs in through it; "Open in browser" (File menu on a Mac, the configuration) opens the default browser with a one-time token
(`once`), through the system's `open`, whose command line other accounts see;
`scripts/scratch-obeya.ts` prints it as `url` (`--login <port>` again). Once signed in, the address
alone opens Seismic: the cookie lives as long as browsers allow (400 days). Workers hold no key: their
narration goes to a server of its own that answers nothing else (their `SEISMIC_URL`).

*The workers' files.* An HTML artifact or an answer's files load in a sandboxed frame of origin
`null`, so what its page loads goes without the cookie; it carries instead the key in the address
the frame's page is redirected to (see The demo on the card), which only the owner or a paired
device ever sees. The gate of other devices still applies.

The cookie goes to any server on `127.0.0.1` whatever its port: a page the owner opens there from
another account on the machine would see it.

#### Other devices

The owner's phone reaches Seismic over the owner's own private network; Seismic runs no service of its
own for it and is never on the open internet. "Reachable from other devices" (`remote` in
`settings.json`) is off by default (Seismic answers only on this machine). On, it is one of:

- *Over Tailscale*: Seismic stays on `127.0.0.1` and runs `tailscale serve --bg --https=<port>
  http://127.0.0.1:<its port>`, proxying HTTPS and WebSockets from `https://<machine>.<tailnet>.ts.net`.
  It takes 443, else 8443, else 10000, whichever no entry serves, and touches no other entry; it notes
  its own in `tailscale-serve.json` in the home, so it can move or remove exactly that one, after a
  restart too. Stopping, Seismic removes it, so a program taking its port later is not served to the
  tailnet. Bun's dev server answers for scripts only under the name it listens on, so an Seismic with
  `--dev` shows a blank page through `tailscale serve`.
- *Over an address*: Seismic also listens, in plain HTTP, on an address of one of the machine's
  interfaces (another VPN's). The section says a phone's browser allows microphone and push only over
  HTTPS.

The configuration's section "Other devices" and the dialog "Connect a phone" show what the
network lacks, each with its one step: Tailscale missing (how to install it per platform), not
running, logged out, HTTPS off in the tailnet (a link to the admin console's DNS page), on Linux the
operator right `tailscale serve` needs (`sudo tailscale set --operator=$USER`), all three ports
taken. Ready, they name the Tailscale account for the phone to log in with, and while the tailnet has
no other device they say the phone is not in it yet and cannot resolve the address. While open they
check every few seconds, so each fixed step shows, and Seismic serves through Tailscale, without a click.
A `tailscale status` that takes longer than its 10 s (a machine under load) keeps the state found
before instead of calling Tailscale stopped. They also say that other devices
reach Seismic only while it runs here.

A request is *local* when it comes from loopback under one of this machine's names, unforwarded (no
`X-Forwarded-For`, `-Host`, `Forwarded`); through `tailscale serve` it is forwarded and counts as
remote, as does anything on the other address. A remote request needs a paired device; without one
the page is "This device is not connected to Seismic" with how to connect and a field for the code
(401), the API answers 401 `notPaired`, and no WebSocket opens.

*Pairing.* "Connect a phone", below the paired devices in the section, opens a dialog with a QR
code of `<address>/pair?code=<code>`, the address and the code in large digits. The code has six
digits, holds five minutes (renewed while the dialog is open) and pairs one device; five wrong tries
spend it (counted only from Seismic's own page or without `Sec-Fetch-Site: cross-site`, so another site
cannot spend them). The phone gets the device cookie `obeya-device` (32 random bytes; the database
keeps its SHA-256, a name from the user agent such as "iPhone · Safari", and when it was paired and
last seen) and goes on to the phone view, and the dialog says "iPhone · Safari is connected.". The cookie is `HttpOnly`, over HTTPS
`Secure; SameSite=None`, over HTTP `SameSite=Lax`.

*Devices.* The section lists them with when paired and last seen, each with "Remove", which acts
at once without undo: its open pages lose their WebSocket and reload to the page that says how to
connect. A device stays paired until removed or unused for 90 days. Pairing, devices and the setting
are managed only on this machine (`/api/access…` answers another device 403 `onlyHere`, and the
section shows it only its heading and hint).

*Keeping the machine awake.* While the setting is on, Seismic keeps its machine from idle sleep per the
switch "Keep this computer awake": *While an agent works* (default), while a worker is in a turn,
waits for its background work or lands, until two minutes after the last; or *Always*, so the phone
can give tasks while no agent works (`awake: "always"` in `remote`). Per platform:
`caffeinate -i -w <pid>` on macOS, `systemd-inhibit --what=idle:sleep` around `tail --pid=<pid>` on
Linux (both end with Seismic), `SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED)` through
`bun:ffi` on Windows. The display may still sleep, and a closed laptop lid sleeps anyway, which the
switch's hint says. Workers on SSH hosts keep Seismic's machine awake, not their hosts.

#### The phone view

On a phone the page shows the phone view instead of the project, at the same address and from the
same bundle. A phone is a device with a coarse pointer whose screen's shorter side is under 600 px;
a tablet and a narrow window at the desk keep the project. `?view=phone` or `?view=project` decides
instead. The view is settled at load; turning the phone does not switch it. It uses each project's
own WebSocket. It shows four lists:

- **"Needs you"**: the inbox (see The bar): what waits for the owner across every project in one
  list, most recently updated first, Seismic's unread answers among them. A new demo or another
  card update moves that card to the top. Each entry names its project, says
  what it waits for (its state line: "Demo ready", "Question for you" …) and since when (the server
  keeps that across restarts), with the same one-click replies and "Go to card". Snoozed cards stand
  at the end (see Snoozing a card). The desktop's inbox shows the same entries with the latest
  wait first; both share the entry layout and actions, the unread dot and the "Unread | All" switch.
- **"Running"**: the cards an agent or Seismic is at that wait for nobody (working, taking in the owner's
  words, landing, queued, in a PR, an idea's agent thinking …), with their status line, snoozed ones
  at the end. Every card that leaves "Needs you" without being done stands here.
- **"Planned"**: the tasks no agent has started yet and that wait for nobody: planned ones (a follow-up
  the owner accepted, say), stopped ones, and those set to start at a time. Opened, a card offers
  what it does on the canvas ("Start agent", "Later"), so a task can be started from the phone.
  Without this list an accepted proposal left the phone until it was started (2026-10-31).
- **"Done"**: the finished cards that are not archived yet, those the archive's "Archive … done tasks" would take, and none the lists above hold.

"Planned" and "Done" are closed until their head (with the count) is tapped, since either may
hold many cards the owner rarely needs on the phone. Opened, the head moves up to the bar so its
cards show; it stays open while a card is open and over a reload, and is closed again in a new tab.
Without such cards it is not there.

The cards look as on the canvas, as wide as the screen and without the pin, their kind line led by
the project's name where there are several; where two of at least
340 px fit (the phone turned) they stand side by side.

*Seismic's conversation* is a panel over the list, opened by the project's speech-bubble button with its
unread count across projects, left of the microphone at a finger's size, or by the card "Seismic answered". With several projects a picker right of the microphone names whose Seismic it is, which
is also whom the microphone speaks to with no card open (none with one project or a card open). The
button opens the conversation an answer waits in when the picked one has none, and the picker
follows. The panel holds the conversation, its field and below it room for the microphone, which
never stands over the field; only the conversation scrolls. Its address is `?talk`; its answers count
as read once it is open. A card opened from it opens over it; Back returns.

The panel takes the part of the screen the keyboard leaves, its field right above the keyboard, as
the whole page does (see The canvas, The on-screen keyboard). The panel's top is a grip, its whole row with the title (its buttons aside): the panel follows the finger and stays where let
go, the page under it scrolling on until all of it can stand above the panel; within 15 % of the screen's top it takes the full height, within 15 % of the bottom it closes;
let go while moving it glides on, slowing evenly, so a short swipe up fills the screen and one down
closes it, while a finger still for 50 ms before lifting leaves it where it is. It opens at the full
height (half beside a demo video). The button, Back and Esc close it.

The toasts above the microphone (see The toast stack: Seismic's reply, a confirmation with "Undo",
a command still being read, a warning, which stays there until dismissed as on the project) are swiped aside to either side: past a third of their width or flicked they fly out, else
spring back. Swiping takes nothing back: "Undo" goes unused, a command being read is carried out
without its confirmation. Until the owner has swiped one in this browser, each line nudges aside once
as a hint. The project has no such gesture.

*A card* opens full screen at a tap, at its address `/p/<project>/c/<code>` (see Addresses in
The project; a reload or restart opens it again); Back (the
button, the browser's, Esc) returns to the list where it was scrolled. It is the project's detail view
with the same answer options, demo, approve buttons and undo, its page the only thing that scrolls;
plan docs and the configuration are not opened from there. Its conversation is in the same panel as
Seismic's, at the card's address with `?talk`, opened by the button left of the microphone, whose number counts the
messages the conversation shows (not the agent's folded words between steps; a reply and the handover
under it in the same message count once) since the owner last had it open or wrote there, plus one for the open questions, however many stand in their block (until
2026-10-22 each question counted). Every card kind gets there the same way, through the
shared detail view. A working card and one waiting for answers open with the panel up, a working one
as a half sheet so title, state line and buttons stay in view; others open on their page. While an
agent or Seismic is at work, the button carries a working card's moving line. The conversation opens
with the first unseen message at the top of the panel, else at its end; new messages carry the
orange edge (see The conversation). Beside a demo video the panel is a half sheet and the video
scrolls into the upper half, so a comment at a place in the video ("Comment here" brings the
panel up with the cursor in the field) is written with the video in view, as on the canvas; turned
sideways the panel opens at the full height there too.

Calls go to the API of the project in view; a call or words about a card go to its own project's API,
whichever is in view as they leave (closing a card puts Seismic's project in view before its last calls
go).

*A new card* comes from the plus button that stands in the microphone's place on the list (the
microphone is back there while Seismic's conversation is open, and on an open card): it makes a task
in the project whose Seismic the list speaks to, where there is room on it (the server places a card
created without a position), and opens it with the cursor in its text. Left without a title, Seismic
names it from its text; left empty, it goes, as on the canvas. Turned sideways it stands where the
microphone does. The list gave up its microphone for it (owner, 2026-11-06): voice stays in the
conversation and on cards. Rejected: a plus button beside the microphone.

*The microphone* at the bottom is held by a finger (pointer events, no long-press menu, no text
selection; lifting or the browser taking the gesture ends it) and speaks to the open card's agent,
else to Seismic. No line names whom (what is in view fills the screen), nor shows "→ into the field" or "send with Enter"; the line under it says when it hears only silence. While the
keyboard is up it hides, with the conversation button and the picker, and the field's own microphone
dictates. The keyboard counts as up while a text field has the focus and the page is more than 150
px shorter than the tallest it had at that width (the phone's own button closes the keyboard but
leaves the focus). Shown again with the cursor in a field, the microphone dictates into the field.
On both microphones the touch is only the press (`touchstart` cancelled): otherwise Chrome takes a
half-second press for a long press on the field, selects text, closes the keyboard and cancels the
recording.

A tap on a button next to a field acts at the first tap: the screenshot button and Send leave the
cursor in the field, so the keyboard stays up, and back from the image picker the field takes the
focus again. A tap into a field while the keyboard is down only places the cursor and brings the
keyboard up; otherwise Chrome's spelling suggestions, opened by that tap, closed the keyboard just
opening. That holds only for fields one types into: a tap on a date and time field stays the
browser's and opens the phone's own picker (taken over too, it did nothing). On an iPhone, Safari takes a tap
for a hover alone, and acts on it only at a second tap, when the hover it sends first shows
something new (a star lit, a hint, a button fading in): so what hover reveals at the desk reacts to
a mouse only, or stands on a touch screen from the start. Back from the iPhone's own full screen
player, Safari placed taps beside their target until the page scrolled (Approve under the video
took none): the views around the video scroll by a pixel and back as that player closes. What the
owner may still tap does not move while something above it comes or goes: the rating prompt stands
nearest the microphone, the confirmations above it. Texts that name the space bar name the microphone. Enter breaks the line and only Send sends
(a phone's Enter is its line break, and a half-written message cannot be taken back). The screenshot
button offers photo library and camera, and marking a screenshot works with a finger. Drafts are kept
per tab apart from the project's, the field of Seismic's conversation one per project.

*Turned sideways* (the screen under 600 px high) the microphone stands at the right edge, halfway up
under the thumb, in a strip of its own beside the content, with the screenshot button above it, the
picker at the strip's top and Seismic's conversation button at its bottom. The fade goes, the bar is
slimmer and scrolls away on the list. The panel leaves no room under its field, and with the keyboard
up the field takes the strip's width too. Confirmations stand at the bottom of the content (in the
panel, above the field). Upright nothing changes.

*A demo video* goes full screen from Seismic's button at its top right; its own controls' full-screen
button is hidden. Full screen locks the screen to the video's orientation (landscape), however the
phone is held; once the phone has been turned to match, turning it back (held 300 ms, read from the
orientation sensor) ends it, as do the button and Back. Turning into landscape while the video plays
in view starts it. Seismic does this itself because Chrome's own handling is racy (it releases the lock
while the screen may still report the old orientation, so turning sometimes ends or starts full
screen wrongly); Seismic holds the lock until full screen ends. Where only the video can go full screen
(Safari on an iPhone) there is no button and the video's own controls stay.

*When the server does not answer* for 3 s, a line at the top says "Seismic is not answering · since 14:02" and why that may be; the page reconnects by itself, at once when it comes back into view, and
the 3 s count from then (a phone back from its lock screen reconnects within them). A sleeping
machine refuses nothing, so a connection not open within 3 s counts as not answering, and one not
open after 10 s is tried anew. A connection that stays open but answers nothing to the page's
pings (a frozen server) counts as not answering too: after about 10–15 s of silence the line says
"Server not responding …", as the desktop's status bar does, and "Unresponsive since 14:02" after
2½ minutes.

#### Notifications on the phone

Seismic tells the owner's phone when something starts to wait for them, by Web Push to the browser's
own push service: no account, no service of Seismic's. Messages are encrypted for the device (RFC 8291)
and requests signed with Seismic's VAPID key (RFC 8292), with WebCrypto; the push service sees neither
title nor text. The key is made at the first start and kept in `vapid.json` in the home.

*Turning them on.* A paired device holds at most one subscription; removing the device removes it,
and one the push service answers with 404 or 410 goes, as does a stored one that is no valid
subscription (the other devices still get their push). An iPhone gets pushes only from the home
screen (iOS 16.4+): in Safari the phone view says how ("Share", "Add to Home Screen"). There, and
in a phone's Chrome, a box at the top asks "Turn on notifications"; its button asks for the
permission (iOS asks only after a tap), and the box stays until it is given or refused. Given, the
page hands its subscription to the server (`PUT /api/push`) at every load. Over plain HTTP there are
no pushes; the section "Other devices" says so and which devices have them on.

*What is pushed:* a card that starts waiting for the owner, with what it waits for as the text ("Demo ready", "Question for you" …), its title and, with several projects, its project; a failed landing
("Landing failed"); a stuck worker (its turn failed or ended twice without a handover and
Seismic made a question of it: "Agent is stuck"). Not Seismic's answers in its conversation (the
owner asked from where they are), nor cards waiting already when Seismic starts.

*Not while the owner uses Seismic:* nothing is pushed while a page on this machine was in use in the
last three minutes, or while a page on a paired device is in use. A page is in use while in view and
the owner moved, typed or scrolled or a video played within the last half minute (it reports that
every 30 s and on coming into view); a project left in view with nobody at it holds nothing off. The
phone view is in use whenever in view, and its hold ends at once when it goes out of view, closes or
is silent for 45 s. What starts waiting while the owner is there is not pushed later either.

Pushes go `Urgency: high`, which lets the push service wake a sleeping phone; whether it does is the
phone's choice (Android held Chrome's messages until unlock on the owner's Pixel, 2026-10-16).
*Several at once:* the first goes out at once; what starts waiting within the minute after goes out
as one push at its end ("3 cards are waiting for you", the titles as text, leaving out what no longer
waits), and a further minute starts. *Tapping a push* opens its card in the phone view
(at its address), "Needs you" for several, in the open app if there is one; a later push for the same
card replaces the earlier.

*The web app.* The page names a manifest (standalone, icons `/icons/180.png`, `/icons/512.png`), and
the phone view registers a service worker at `/sw.js`; neither needs pairing. The worker shows the
pushes and keeps the page's shell, served from its cache when the network fails or takes over 3 s.
So the app opened while the machine sleeps shows the phone view saying Seismic does not answer within
about 7 s: the page waits 3 s for its language and projects, then goes on with the browser's language
and the projects it last had. The worker requests the page anew rather than passing the request on:
Android's Chrome marks a home-screen launch `Sec-Fetch-Site: cross-site`, and passed on it loses
`Sec-Fetch-Mode: navigate`, so *Its own site* would refuse it. The project page registers no worker.

#### Notifications on the desktop

The project page tells the owner at the computer when a card starts to wait for them, by the same
rules as the phone's pushes (*What is pushed*; the cards waiting as the page opens, or as another
project is shown, are not news), but only while nobody is looking at the page: it is hidden or its
window is not focused. Several at once make one notification. In the app (Tauri) the notification is
the system's, shown by the shell; in a browser it is the page's own, and clicking it opens the card.

Whether it happens is the owner's choice and per machine: "Notifications on this computer" in the
Configuration (notifications and limits), saved in the home's settings. It is undecided until the owner has been
asked; the first page asks once, in a box above the confirmations, with "Turn on" (which asks the
system for its permission) and "No thanks". The setting is on only if the system granted the
permission; where it is on but the system refuses, the Configuration says so. The phone view has its
own switch (see above).

#### Stalls

Seismic's server runs on one thread: while it computes or waits in a synchronous call (a git command,
say), it answers no page and hears no agent, and the project seems frozen. Every stall of half a
second or more goes into the server's output and into `stalls.log` in the home, which outlives
restarts (past 1 MB it starts afresh, the one before kept as `stalls.previous.log`). An entry gives
the time, the stall's length, the few places in the code where most of it went with their share
(the runtime function the thread was in, `spawnSync` or `stringify`, then the functions of Seismic
that called it, by file and line), and each process the server waited for longer than 50 ms, by its
command line. A pause the thread did not run in at all (the machine slept) is no stall.

What happens often or many times at once therefore never waits for a process: starting an agent and
landing work read git without blocking, and of the processes Seismic waits for without blocking, a few
start per turn of the event loop, the rest in the next; starting one takes the thread a moment, under
load many milliseconds.

A page reports its own freezes of half a second or more over its WebSocket, and the server logs them
in the same places, naming the device and the project: where the browser says where the time went
(Chromium's long animation frames: the scripts by what invoked them, and style and layout), the
largest parts; and the server's messages the page took in during the three seconds before, by type
and size. Safari and Firefox tell only the length. A page finds its freezes by a heartbeat from a
worker thread, which it has to take in: one taken in half a second or more after it was sent means
the page's thread was busy that long. A page whose timers the browser merely holds back reports
nothing: WebKit runs a page's timers about once a second while its window seems idle to it (not in
front, nothing drawn for a while), with the page still in view, and a worker's timers on. A page out
of view is not watched, as the browser holds it back by itself; one that froze while its connection
was down reports once it is back. A page that stalls again and again the same way (from the same
page, with its time going to the same places) gets one entry for the first, and the ones like it
that follow, each within a minute of the one before, are counted: one line says how many, over what
span and how long each was, once a minute has passed without another, or every hour while they go
on, so that such a page cannot push the server's own stalls out of `stalls.log`.

### Setup assistant

One list of what Seismic needs on this machine, in four parts: *Agenten* (Claude Code, its login, git,
and git's name and e-mail, without which an agent's commit fails); *Pull Requests* (gh and its login,
needed at the first approval in a repository on GitHub); *Sprachbefehle* and *Demos* (the
configuration dialog's checks, each with the size still to download; uv above the speech recognition,
whose "Install" waits for it; see The voice input settings). Where agents run on the
machine's own Claude Code (see Agents), the list names the version Seismic was checked with when that
differs. Logins come from `claude auth status` and `gh auth status`.

"Install" installs what needs no admin rights: Claude Code and uv with their official installers,
the speech recognition, a demo's voice. System software (git, gh, ffmpeg, Node, a browser) comes with
the command for this platform and a copy button, installed at a click where that needs no password
(Homebrew, winget). A login opens a terminal with `claude auth login` or `gh auth login` (none found:
the command to run by hand); git's name and e-mail are two fields. The list checks again when the
window gets the focus back. Seismic puts `~/.local/bin` and on a Mac Homebrew's directories on its
`PATH`, so what was installed is found from a process the desktop started; on Windows every check
rereads `PATH` from the registry.

The list has a second page, "Recommended" (the first, "Needed", holds the four parts above; the tabs
show only where the second has something). Its first part is *Weitere Agenten* / *More agents*:
Antigravity (`agy`, see Antigravity workers under Agents), checked on `PATH`, installed at a click with
its official installer, and its Google login, which the owner does in a terminal (`agy`); it counts
as signed in once `agy models` works. The second part is *Mobile development*, on a Mac only: for
iPhone apps and web apps with a phone view, agents run an iPhone simulator and drive Safari in it.
Xcode (`xcodebuild -version`; "Open in the App Store" opens its page, since Xcode comes only from
there), an iPhone simulator (`xcrun simctl list devices available` shows an iPhone; if not, "Install"
runs `xcodebuild -downloadPlatform iOS`), and Safari's remote automation (`safaridriver --enable`
done once, which makes the user a member of the `_webdeveloper` group; checked with `dseditgroup`).
"Enable in a terminal" opens a terminal that runs `safaridriver --enable && exit`, which asks for the
password and closes itself once through. AXe (the `axe` command, a free open-source tool that sends
taps and swipes into the simulator, which Safari's remote automation cannot) is checked on `PATH`;
"Install" runs `brew install cameroncooke/axe/axe`, and without Homebrew the part links its page. One step cannot be checked or done from outside: in the
simulator, Settings › Apps › Safari › Advanced › "Remote Automation" is turned on by hand, so the part
says so in a line.

#### The first project

On the first start the page ends with "Where is your project?": two cards with a radio button each,
"Already on this computer" (a folder: a path or the system's folder dialog) and "On GitHub / a
server" (a clone: `owner/name` through `gh repo clone` where gh is logged in, else by URL; any git
URL; into the home directory unless another is given). It shows the main branch Seismic found there. A
folder without git gets the offer to set it up (see Setting up git in a folder), whose confirmation
also creates the project. Seismic writes `projects.json` (worktrees, or two clones when the repository's
settings say clones), starts the project at once (see Live configuration) and the page opens it, with
a first card that says what to try. Later "Check setup" in the Configuration dialog opens the
same list over the project, without the first project. A scratch Seismic with `"setup": true` starts like
a first start.

### Setting up git in a folder

Where the first project or "+ Repository" is given a folder in which git finds no repository, it
offers "Use without git" (`"git": false` in its entry; see Folders without git) and "Set up a git repository here", each with a line on what it means. The latter first shows what the first
commit would hold: the folder's entries with file counts and sizes, files from 1 MB listed as large,
what stays out, and the default `.gitignore` (build output, dependencies, secrets: `node_modules/`,
`dist/`, `.env*` but `.env.example`, keys) Seismic writes where the folder has none. The preview uses a
git directory of its own in the temp directory, so looking changes nothing; the owner keeps more out
with a `.gitignore` and "Look again". Confirming runs `git init` on git's `init.defaultBranch`, else
`main`, and commits every file not ignored (workers see only committed files) under git's name and
e-mail (none: it says so and does nothing). A failed step undoes the ones before. Building a card
in a new repository sets git up the same way, without the preview (see Building in a new
repository).

### Self-update

Seismic runs from a checkout that work lands on, so `live` must mean running (the compiled binary has
no checkout and never restarts for new code). Without `--dev` the `obeya` process supervises the
server: when the checkout moves to commits that change code (not only `docs/`, `.md` files, `site/`,
`.github/`, or the agents' own configuration under `.claude/` and `.codex/`, an allow rule added to
it, say), it restarts the server, running `bun install --frozen-lockfile` first when
`package.json` or `bun.lock` changed (a failure is logged and the restart goes ahead). Workers resume,
and an open page reloads when it reconnects to a new server process. What counts as new is measured from
the commit the server started from, and a restart waits until HEAD has held still for a round (a
landing under way finishes first), HEAD checked once more after git has told what changed. While
nothing moves, the watch starts no process: every two seconds it compares the files HEAD stands on
(HEAD, each ref it names on the way to a commit, a branch possibly naming another, and
`packed-refs`; refs of a worktree's own, such as `refs/worktree/` and `refs/bisect/`, are in its
own git directory) and asks git what HEAD is only once one of them changed. Where the files cannot
tell (refs in a reftable, a symbolic ref whose target cannot be read safely), git is asked every
round.

#### Waiting for the workers

The restart waits until no worker is in a turn or waiting for its background work, even one that
has asked or handed over in it (at most 15 minutes), since it stops whatever a worker runs. Those
workers are told it is due: they start nothing
long, stop background work they can restart, and pause at the next safe point by ending their turn
(no nudge, no question to the owner; the card's log says so). Until the restart, a card whose
worker paused for it (and does not wait for the owner) shows so: ice blue, a circular arrow and
"Paused, pending restart" in place of "Agent at work", so the owner tells it from an agent at work. A turn that starts meanwhile (a message,
finished background work) hears that it keeps Seismic waiting: the worker takes the message in, leaves
the work until it is resumed and ends the turn at once. A resumed worker hears that what ran was
stopped (exit code 137). A worker waiting for its landed work's restart is not in a turn. Code
review agents count as workers here, and pause and go on the same way (see Code reviews in Card
lifecycle).

#### Waiting for the owner

The restart also waits, past the 15 minutes, while the owner watches a demo video or dictates (from
the press until the words are in the field or Seismic has read them): the page reports both over its
WebSocket, and a page that closes lets go. The server itself holds the restart while it transcribes a
recording, and while a command is in its undo window until it has run.

While a restart waits, the status bar shows it at its left in place of "Online" ("Restart waits for N agents", "… for your video", "… for
your dictation"; with agents only, until when at most); hovering names why and the cards it waits for,
across projects, and "Restart now" (`POST /api/restart`) has it go ahead at once, its hover
saying what that cuts off.

#### Keeping the page

The page that reloads keeps what was open: just before, it writes down per tab the open card, project
(plan doc read or not) and sheet, the scroll positions in them, the drafts and where the demo video
stood (playing on only in a tab in sight); the new page reopens them without flights or unfold. The
camera is kept anyway.

#### Restarting by hand

For work on Seismic itself, the Configuration dialog's section "Developer" has "Restart Seismic"
and "Rebuild Seismic". Either asks for a restart like any other (it waits for the workers and the
owner, shows in the bar with "Restart now", and the page reloads); a rebuild also installs the
checkout's dependencies before the server starts again, whether or not they changed, and a rebuild
asked while a restart already waits turns that restart into one. Restarting needs the supervisor, so
with `--dev` both are off and say to restart in the terminal; the app and the compiled binary have
no checkout to rebuild from, so there only restarting is offered. There is no undo: the section is
reached on purpose, and a restart costs the workers only a pause.

#### Pulling from the upstream

Seismic from a clone of its repository moves only when its owner pulls. So the supervised server
fetches its branch's upstream at start and every hour (only that branch, into its remote-tracking
ref). While the upstream has commits that change code (the restart's test), the bar shows "Update: 12
new commits", the newest ten on hover, and a "git pull" button, which fetches again and
fast-forwards; the restart follows as after a landing. Where Seismic cannot fast-forward there is no
button, and the hover says why and what to do: commits of the checkout's own, uncommitted changes to
files the new commits change (named), or git's message for anything else. Back on the page, Seismic
looks again without fetching. A branch without upstream, a detached HEAD, `--dev`, the app and the
compiled binary (the app has its own updates) have nothing to pull.

### Stopping

Ctrl-C, SIGTERM or `POST /api/stop` (the app; Windows has no SIGTERM) stops Seismic the way a restart
goes, only nothing starts again: workers in a turn are told Seismic is about to stop and pause at a
safe point, and Seismic ends once none is in a turn (at most 15 minutes). The bar shows it ("Shutdown
waits for N agents", "Shut down now"), and "Shut down now" or a second Ctrl-C forces it: Seismic
signals its known agent processes without waiting for their ordinary shutdown escalation. This is
best-effort cleanup, not containment of processes it never observed (see Agents and workstations).
Supervisor and server both get the terminal's Ctrl-C, so signals within a second count as one press.
A stop does not wait for the owner's video or dictation (the owner asked for it), and turns a
waiting restart into a stop. The next start resumes the stopped workers.

The sidecars (transcription, speech, narration voice), the agents' Claude Code processes, the `ssh`
of remote sessions and the process keeping the machine awake run outside the terminal's process
group, so its Ctrl-C reaches none of them: in it, Ctrl-C broke every agent's turn off at once. They
hear of the stop from Seismic and go on meanwhile. Once Seismic ends, it closes the sidecars' stdin, which
they finish as a normal end after their current request (one still there after 30 s is killed), and
ends the agent sessions, so no agent goes on with a turn nobody hears. A forced stop sends an
immediate kill instead of waiting for their normal exit; Windows uses a best-effort process-tree
termination. On Windows, where a detached process opens a console window for every program it
starts, the Python sidecars ignore Ctrl-C instead, and the agents stay in the console.

On Windows every program Seismic starts runs without a window (git above all, many times a minute;
the narration voice's installer and samples too), except one meant to be seen (Explorer, a terminal
for a login). An Seismic without a console of its own (a scratch Seismic, one started without a
terminal) would otherwise give each a window: with Windows Terminal as the default terminal, one
flashes up per call and takes the focus from what the owner is typing in, several a second while
workers are busy.

### Decisions

- **Other devices over the owner's private network, paired by a QR code** (2026-10-16, plan "Seismic from the phone"). Rejected: a public tunnel (agents with shell rights on the open internet), a relay
  of Seismic's own (a cloud service), a messenger bot (a third party sees all, and it is only a chat). A
  device stays paired until removed or unused for 90 days, not for a fixed time (a phone in daily use need not pair again, one forgotten
  drops out by itself); devices are managed
  only on the machine, so a lost phone cannot keep itself in. The device cookie is `SameSite=None`
  over HTTPS, not `Strict`: with `Strict` a worker's HTML artifact could not load its own files.
- **Every request is checked for `Host` and `Origin`, from this machine too** (2026-10-16): otherwise
  any site in the owner's browser could start and approve cards with a `text/plain` POST, and a
  rebound DNS name could do everything. No token in the page is needed: what a foreign page may send
  without a preflight carries its `Origin`, and preflights get no CORS headers.
- **The machine stays awake while a worker works, or always if the owner says so** (2026-10-16, the
  owner): always awake is too much as a default (a laptop on battery), but the owner wants to give
  tasks from the phone while no agent works. Rejected: a hint how to keep it awake by hand (the switch does it
  without leaving Seismic).
- **"Connect a phone" only in the configuration** (2026-10-16): a phone is connected once, so it
  takes no place in the bar. Rejected: a phone icon in the bar.
- **The phone view is a view of its own in the same page, not the project made touch-capable**
  (2026-10-16, plan "Seismic from the phone"): readable cards on 390 px mean mostly panning. It goes by
  coarse pointer and short side, not window width, so a narrow window at the desk keeps the project.
  It reuses the project's detail view, conversation, drafts and confirmations rather than copies. One
  WebSocket per project rather than one stream for all: the server's messages stay as they are, and an owner has a
  handful of projects.
- **Done cards on the phone in a list of their own, closed by default** (2026-10-28, the owner):
  the owner wants to see what is done but not archived from the phone, without it pushing what
  waits and what runs further down.
- **Phone conversations are a panel from below, sized with a grip** (2026-10-17). Rejected: the
  conversation as a box in the scrolling page (a scroll area inside another, and the page scrolled
  past the field to make room for the microphone); a grip that only closes or springs back. Cards
  whose conversation is the point (working, asking) open with it up (2026-10-19).
- **Real full screen for phone demo videos, with Chrome's notice** (2026-10-17, the owner): Chrome on
  Android shows "… to exit full screen: swipe down from the top" each time, and no page can turn it
  off. Rejected: a player covering the page without full screen (Chrome's bars stay, and Chrome locks
  the orientation only in full screen).
- **Pushes by Web Push to the web app on the home screen** (2026-10-16, plan "Seismic from the phone").
  Rejected: ntfy or a messenger (a third party for nothing Web Push lacks); a native app (nothing a
  home-screen web app cannot do here). WebCrypto rather than a library: the two RFCs are a few dozen
  lines, checked against RFC 8291's example. A page at the machine holds pushes off while in use, not
  merely in view, or a project left open would hold them off until the screen locks.
- **No pushes while the owner uses the phone view either** (2026-10-17): they add nothing while the
  owner works through the cards there. Its hold ends the moment it goes out of view, not three
  minutes later, so what starts waiting right after the phone is locked is pushed.
- **Stalls are always watched, with the JavaScript engine's sampling profiler running all along**
  (2026-10-29, the owner): freezes of a few seconds came now and then (after an approval, say) and
  could not be traced afterwards. The profiler samples the thread's stack from a thread of its own,
  also while it waits in a synchronous call; it costs under half a percent of a core while Seismic is
  idle and a few percent of its speed while busy. Rejected: timing chosen
  calls only (a stall in code nobody thought of goes unnamed); profiling only on demand (the stall
  is over by the time someone asks); a slow-request log (the page acts on a click before the
  server answers, so a slow answer freezes nothing).
- **Agent starts and landings read git without the server waiting, and reuse what was read while
  the refs stand still** (2026-10-31): with many cards landing in a row, the trust check at each
  agent start and the settings read after each landing called git synchronously, a few calls each,
  and held the server up for up to 1.1 s. Whether the main branch moved is told by `stat`s of the
  refs, so an agent whose repository did not move starts at once. Rejected: every agent start
  waiting for git (each start later, though the main branch rarely moved); watching the refs for
  changes (the event comes after a commit made just before the start); a cap on git processes
  running at once (a fetch or clone taking minutes would hold a place, and the trust check of an
  agent start would queue behind it).
- **Programs run without a window on Windows by default, not by an option at each call**
  (2026-11-01): one call forgotten brings the flashing windows back. A program meant to be seen asks
  for its window.
- **What reacts to a change on the canvas hears of it once the code that changed it is through, once
  for all it changed** (2026-10-31): a landing or a card moving on changes the project dozens of
  times in a row, and each reaction asks for the project as the page sees it, which took a few
  milliseconds to build on a project with hundreds of archived and shared cards; when many cards
  landed one after another, the server stood still for half a second at a time. The cards alone
  (what code reads back between its writes) are built apart from the rest of that view (the sheet's
  outdated pages, the workstations, the notes on the plan directories), and one archived card is built
  without the whole archive. Which cards are prototypes (an idea lists its own, archived ones too)
  is read once per change, and each is made into a card when one first needs it, once per change
  too, not again for every card looked up: a pass of sharing looks up every shared card, hundreds of
  them, and stood still for half a second doing so. A write to one card (2026-11-02) makes only
  that card's row into a card anew: what the other rows made (their demos and pages, with a look at
  the demos' files) is kept while those rows stay the same, until anything else changes, when the
  files are looked at again (a demo deleted by hand shows as gone then); and the reads each change
  makes find their cards through indexes rather than going through the archive. A run of thirty
  landings took a third of a second of CPU on a laptop and a second in CI, now a fifth of that.
  Rejected: patching only the written card into the project's cards (what other cards show depends
  on it: an idea's prototypes, the waits, a card's place in a queue). The owner's settings file, asked for the
  language with every text the server writes, is read again only once it changed. Rejected: reacting to each change at once and
  only making the view cheaper (the reactions still build it once per change).
- **A page's freezes are found by a worker's heartbeat, not by its own timer running late**
  (2026-10-30): the app's webview on macOS runs a page's timers about once a second when its window
  is not in front, with the page still in view, and logged a stall of about a second every second
  all night. A worker's timer runs on, and its message waits only for a busy thread. Rejected:
  taking a page without focus for one held back (a page shown beside the window in use is watched
  too, and freezes there as well); counting late timers only where the browser tells long animation
  frames (WebKit tells none, so it would watch nothing).
- **Seismic restarts itself for new code on its own checkout instead of hot reloading**: workers resume
  by session id anyway; hot reloading keeps old state alive next to new code. It also restarts for
  commits made outside Seismic.
- **A due restart is announced to the workers, which pause for it themselves** (2026-10-01): an agent
  knows where its work can stop. Rejected: waiting for a moment no worker is busy (with six in
  parallel it rarely came, and the 15 minutes ran out in test runs and renders); a lock agents set
  before long commands (rests on every agent remembering it); restarting workers one by one (one
  server process).
- **A turn that starts while a restart is due ends at once** (2026-10-14). Rejected: letting it finish
  its step: a worker sent back for a conflict landed its work before pausing, and one woken by its
  render went on rendering, holding the restart all along.
- **A restart waits for the owner only where it would destroy what they do** (2026-10-02): a playing
  video, a dictation until its words are in, a command in its undo window. Everything else is kept
  across the reload, so a page merely open does not hold new code back. The server, not the page,
  holds the dictation until transcribed and the undo window (2026-10-12, 2026-10-14): released with
  the key, a restart lost a long dictation mid-transcription; held by the page, a reload in the window
  lost the confirmed command.
- **Sidecars end through their stdin**, not by being killed: killed, Python left the model download's
  progress-bar semaphore behind and its resource tracker warned on the terminal.
- **The watch for new code reads files, not git, while nothing moves** (2026-10-29): on Windows,
  starting a process holds up the server's one thread even when it does not wait for the process;
  on a busy laptop `git rev-parse HEAD` held it 330 ms at the median and up to 11 s waited for
  (`spawnSync`), 60 ms and up to 1.5 s started without waiting. Asked every two seconds, it delayed
  the requests in that rhythm, a video's ranges among them. The files are told apart by inode, size
  and mtime in nanoseconds: `packed-refs` written anew can keep both its size and its millisecond.
  Rejected: git without waiting alone (still a process every two seconds, each holding the server
  up to a second); watching the git directory (watches miss changes, which is why plan
  directories are polled as well).
- **Git is called directly, and test repositories are copied**: on macOS Seismic calls the binary
  `xcrun --find git` names, not the `/usr/bin/git` shim, which looks it up on every call (10 ms instead
  of 4, over a few thousand calls a test run); test repositories are copies of a template committed
  once. Together they halved the test suite. A repository's main branch and its commit are read with
  one `for-each-ref` (2026-10-15), not four to seven calls each time.
- **Tests run a file per process** (`bun test --parallel`, Bun 1.4+, 2026-10-15): one after the other
  the suite took 165 s, mostly waiting for git; in parallel 27 s. The longest file sets the run's
  length, so large test files are split by theme around a shared fixture.
- **The first project is chosen with two cards and radio buttons**: pills read as buttons in a user
  test, not as a choice.
