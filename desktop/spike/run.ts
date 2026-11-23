// The W1 spike of docs/plan/remote-workspaces.md: servers, pages and judgement around the shell in
// src/main.rs. Build it (`cargo build` here; the Linux container and the Windows job do the same),
// then:
//
//   bun desktop/spike/run.ts desktop/spike/target/debug/webview-spike
//
// Origins, all on 127.0.0.1: 8900 this machine's Seismic (window `main`) and the harness, 8901 and
// 8902 two remote workspaces (windows `desk-a`, `desk-b`), 8903 a foreign site. The binary runs
// several times:
//
// - first: the shell pairs each workspace over HTTP and opens its window at the one-time login link;
//   the page reloads itself once, then embeds frames (same origin, sandboxed, the other workspace, a
//   foreign site, a redirect to it) and tries to leave its origin (location, link, redirect, form
//   post, window.open, meta refresh);
// - again: a relaunch, each window opened at its start page: the device cookie has to be there;
// - frames: the navigation hook lets everything through, so the foreign frames load and call the
//   shell with the invoke key (the worst case): the capability alone has to turn them away;
//   On Linux that run has to show wry's quirk instead (a foreign frame's postMessage call passes as
//   the window's page), so the fix below stays needed;
// - frames-no-postmessage (Linux only): the same with wry's postMessage IPC unregistered, the way
//   the shell is to run there: no call may pass.
//
// It prints each check with PASS or FAIL and the events behind a failure, and exits 1 on a FAIL.


const binary = process.argv[2] ?? "";
if (!binary) throw new Error("usage: bun desktop/spike/run.ts <webview-spike binary>");

const LOCAL = 8900;
const DESKS = { 8901: "desk-a", 8902: "desk-b" } as Record<number, string>;
const FOREIGN = 8903;
const at = (port: number) => `http://127.0.0.1:${port}`;
const device = crypto.randomUUID();
const cookieName = (port: number) => `seismic-device-http-${port}`;

type Event = Record<string, any>;
let events: Event[] = [];
let mode = "first";
let key = "";
let os = "";
const tokens = new Map<string, boolean>();
const links: string[] = [];

const html = (body: string) => new Response(`<!doctype html><meta charset="utf-8">${body}`, { headers: { "content-type": "text/html" } });
const hasCookie = (req: Request, port: number) => (req.headers.get("cookie") ?? "").split(/;\s*/).includes(`${cookieName(port)}=${device}`);

// what every page shares: report to its own origin, call the shell through Tauri and around it
const common = (win: string) => `<script>
const win = ${JSON.stringify(win)};
const rep = (o) => fetch('/report', { method: 'POST', body: JSON.stringify({ ...o, win, origin: location.origin, href: location.href }) });
const T = window.__TAURI_INTERNALS__;
const KEY = ${JSON.stringify(key)};
const IPC = ${JSON.stringify(os === "windows" ? "http://ipc.localhost/" : "ipc://localhost/")};
async function call(cmd, tag) {
  if (!T) return 'no __TAURI_INTERNALS__';
  try { return 'ok: ' + await T.invoke(cmd, { tag }) } catch (e) { return 'denied: ' + e }
}
async function raw(cmd, tag) {
  const out = {};
  try {
    const r = await fetch(IPC + cmd, { method: 'POST', body: JSON.stringify({ tag: tag + '|fetch' }), headers: { 'Content-Type': 'application/json', 'Tauri-Callback': '1', 'Tauri-Error': '2', 'Tauri-Invoke-Key': KEY } });
    out.fetch = r.headers.get('Tauri-Response') + ': ' + await r.text();
  } catch (e) { out.fetch = 'failed: ' + e }
  const post = window.ipc?.postMessage ? (s) => window.ipc.postMessage(s) : window.webkit?.messageHandlers?.ipc ? (s) => window.webkit.messageHandlers.ipc.postMessage(s) : window.chrome?.webview ? (s) => window.chrome.webview.postMessage(s) : null;
  if (post) {
    try { post(JSON.stringify({ cmd, callback: 1, error: 2, payload: { tag: tag + '|postMessage' }, __TAURI_INVOKE_KEY__: KEY })); out.postMessage = 'sent' } catch (e) { out.postMessage = 'failed: ' + e }
  } else out.postMessage = 'no handler';
  return out;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
</script>`;

function deskPage(req: Request, port: number) {
  const url = new URL(req.url);
  const n = Number(url.searchParams.get("n") ?? "0");
  const win = DESKS[port]!;
  const other = Number(Object.keys(DESKS).find((p) => Number(p) !== port));
  const frames = [
    ["same", `${at(port)}/frame?case=same&win=${win}`, ""],
    ["sandboxed", `${at(port)}/frame?case=sandboxed&win=${win}`, "allow-scripts"],
    ["otherdesk", `${at(other)}/frame?case=otherdesk&win=${win}`, ""],
    ["foreign", `${at(FOREIGN)}/frame?case=foreign&win=${win}`, ""],
    ["redirect-frame", `${at(port)}/redirect?to=${encodeURIComponent(`${at(FOREIGN)}/frame?case=redirect-frame&win=${win}`)}`, ""],
  ];
  const away = (c: string) => `${at(FOREIGN)}/land?case=${c}&win=${win}`;
  return html(`<title>${win}</title><h1>${win} at ${at(port)}</h1><p>device cookie: ${hasCookie(req, port)}</p><div id=frames></div>
<a id=link href="${away("link")}">away</a>
<form id=form method=post action="${away("form")}"><input name=x value=1></form>
${common(win)}<script>
(async () => {
  await rep({ case: 'cookie', n: ${n}, cookie: ${hasCookie(req, port)}, mode: ${JSON.stringify(mode)} });
  for (const cmd of ['ping_a', 'ping_b', 'ping_local']) await rep({ case: 'top-call', cmd, result: await call(cmd, win + '|top|invoke|' + cmd) });
  if (${n} === 1) { await sleep(300); location.replace('/?n=2'); return }
  for (const [c, src, sandbox] of ${JSON.stringify(frames)}) {
    const f = document.createElement('iframe');
    f.src = src; f.width = 260; f.height = 80;
    if (sandbox) f.setAttribute('sandbox', sandbox);
    document.getElementById('frames').append(f);
  }
  await sleep(4000);
  if (${JSON.stringify(mode)} !== 'first') return;
  const steps = [
    ['js', () => { location.href = ${JSON.stringify(away("js"))} }],
    ['link', () => document.getElementById('link').click()],
    ['redirect', () => { location.href = '/redirect?to=' + encodeURIComponent(${JSON.stringify(away("redirect"))}) }],
    ['form', () => document.getElementById('form').submit()],
    ['open', () => window.open(${JSON.stringify(away("open"))})],
    ['meta', () => { location.href = '/meta?to=' + encodeURIComponent(${JSON.stringify(away("meta"))}) }],
  ];
  for (const [step, go] of steps) {
    await rep({ case: 'nav-try', step });
    go();
    await sleep(1500);
    await rep({ case: 'nav-stayed', step });
  }
})();
</script>`);
}

function framePage(req: Request) {
  const url = new URL(req.url);
  const c = url.searchParams.get("case")!;
  const win = url.searchParams.get("win")!;
  return html(`<body style="font:11px sans-serif">frame ${c} at ${url.origin}${common(win)}<script>
(async () => {
  const tag = win + '|frame-' + ${JSON.stringify(c)} + '|';
  const out = { case: 'frame', frame: ${JSON.stringify(c)}, internals: !!T };
  for (const cmd of ['ping_a', 'ping_b']) {
    out[cmd] = { invoke: await call(cmd, tag + 'invoke|' + cmd), raw: await raw(cmd, tag + 'raw|' + cmd) };
  }
  await rep(out);
})();
</script>`);
}

function localPage() {
  return html(`<title>main</title><h1>this machine's Seismic</h1>${common("main")}<script>
(async () => {
  for (const cmd of ['ping_local', 'ping_a', 'ping_b']) await rep({ case: 'top-call', cmd, result: await call(cmd, 'main|top|invoke|' + cmd) });
})();
</script>`);
}

async function handle(req: Request, port: number): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  if (path === "/shell") {
    const e = await req.json();
    if (e.kind === "key") ({ key, os } = e);
    events.push({ source: "shell", ...e });
    return new Response("ok");
  }
  if (path === "/report") {
    events.push({ source: "page", port, ...(await req.json()) });
    return new Response("ok");
  }
  events.push({ source: "http", port, method: req.method, path, case: url.searchParams.get("case"), win: url.searchParams.get("win"), cookie: DESKS[port] ? hasCookie(req, port) : undefined });
  if (path === "/frame") return framePage(req);
  if (path === "/land") return html(`<h1>left the window's origin: ${url.searchParams.get("case")}</h1>`);
  if (path === "/redirect") return new Response(null, { status: 302, headers: { location: url.searchParams.get("to")! } });
  if (path === "/meta") return html(`<meta http-equiv="refresh" content="0;url=${url.searchParams.get("to")}">`);
  if (port === LOCAL && path === "/local") return localPage();
  if (!DESKS[port]) return new Response("not found", { status: 404 });
  if (path === "/api/pair" && req.method === "POST") {
    const { code } = await req.json();
    if (code !== "123456") return Response.json({ error: "wrong code" }, { status: 401 });
    const token = crypto.randomUUID();
    tokens.set(token, false);
    const link = `${at(port)}/login?once=${token}`;
    links.push(link);
    return Response.json({ link });
  }
  if (path === "/login") {
    const token = url.searchParams.get("once") ?? "";
    if (tokens.get(token) !== false) return new Response("this login link is used or unknown", { status: 403 });
    tokens.set(token, true);
    return new Response(null, {
      status: 302,
      headers: { location: "/?n=1", "set-cookie": `${cookieName(port)}=${device}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000` },
    });
  }
  if (path === "/") return deskPage(req, port);
  return new Response("not found", { status: 404 });
}

for (const port of [LOCAL, ...Object.keys(DESKS).map(Number), FOREIGN]) {
  Bun.serve({ hostname: "127.0.0.1", port, fetch: (req) => handle(req, port) });
}

function runApp(env: Record<string, string>) {
  return new Promise<void>((resolve) => {
    const child = Bun.spawn([binary], { env: { ...process.env, ...env }, stdio: ["ignore", "inherit", "inherit"] });
    const kill = setTimeout(() => child.kill(), 60_000);
    void child.exited.then(() => (clearTimeout(kill), resolve()));
  });
}

type Check = { name: string; pass: boolean; detail?: unknown };
const checks: Check[] = [];
const check = (name: string, pass: boolean, detail?: unknown) => checks.push({ name: `[${mode}] ${name}`, pass, detail: pass ? undefined : detail });
const OWN: Record<string, { cmd: string; origin: string }> = { "desk-a": { cmd: "ping_a", origin: at(8901) }, "desk-b": { cmd: "ping_b", origin: at(8902) }, main: { cmd: "ping_local", origin: at(LOCAL) } };

/// Every command that ran: the window and the sender (taken from its tag) have to be the
/// capability's own, so a frame's call ran only where the frame is that window's origin.
function judgeCommands(expectTop: boolean, quirk = false) {
  const ran = events.filter((e) => e.kind === "cmd");
  const wrong = ran.filter((e) => {
    const [win, from] = String(e.tag).split("|");
    const own = OWN[e.window];
    // a sandboxed frame has an opaque origin but its server's URL, which is what a frame's
    // postMessage call is matched by: it is the window's own origin's content, reported apart
    const sameOrigin = from === "top" || from === "frame-same" || from === "frame-sandboxed";
    return e.window !== win || own?.cmd !== e.cmd || !sameOrigin;
  });
  if (quirk) {
    // wry on Linux hands a postMessage call to Tauri as the page the webview shows: a foreign frame
    // passes as the window's page. Still so means the shell still has to unregister that handler.
    check("wry's postMessage still attributes a foreign frame's call to the window's page (why the shell unregisters it)", wrong.some((e) => String(e.tag).includes("|frame-foreign|")), wrong);
  } else check("no call ran outside its window's capability (window and origin)", wrong.length === 0, wrong);
  const sandboxed = ran.filter((e) => String(e.tag).includes("|frame-sandboxed|"));
  if (sandboxed.length) console.log(`note [${mode}] a sandboxed same-origin frame holding the invoke key ran: ${sandboxed.map((e) => e.tag).join(", ")}`);
  if (expectTop) {
    for (const [win, { cmd }] of Object.entries(OWN)) {
      check(`${win}'s own page may call ${cmd}`, ran.some((e) => e.window === win && e.cmd === cmd && String(e.tag).includes("|top|")), events.filter((e) => e.win === win && e.case === "top-call"));
    }
  }
  return ran;
}

function judgeGuard(navigated: boolean) {
  const foreign = events.filter((e) => e.source === "http" && e.port === FOREIGN);
  check("no request reached the foreign origin (navigations, redirects, frames)", foreign.length === 0, foreign);
  const cross = events.filter((e) => e.source === "http" && DESKS[e.port] && e.win && e.win !== DESKS[e.port]);
  check("no workspace window loaded the other workspace's origin in a frame", cross.length === 0, cross);
  const offOrigin = events.filter((e) => e.source === "shell" && e.kind === "load" && e.window !== "main" && !e.url.startsWith(OWN[e.window]!.origin));
  check("no workspace window loaded a page off its origin", offOrigin.length === 0, offOrigin);
  if (!navigated) return;
  const stayed = events.filter((e) => e.case === "nav-stayed").map((e) => `${e.win}:${e.step}`);
  for (const win of Object.values(DESKS)) {
    const missing = ["js", "link", "redirect", "form", "open"].filter((s) => !stayed.includes(`${win}:${s}`));
    check(`${win} stayed on its page through js, link, redirect, form and window.open`, missing.length === 0, { missing, navs: events.filter((e) => e.kind === "nav" && e.window === win) });
  }
}

async function runMode(name: string, env: Record<string, string>) {
  mode = name;
  events = [];
  console.log(`\n== ${name}`);
  await runApp(env);
  return events;
}

const log: Record<string, Event[]> = {};

log.first = await runMode("first", { SPIKE_RUN: "first", SPIKE_SECONDS: "20" });
for (const win of Object.values(DESKS)) {
  const cookies = events.filter((e) => e.case === "cookie" && e.win === win);
  check(`${win} has the device cookie after the login link (n=1) and on a reload (n=2)`, cookies.some((e) => e.n === 1 && e.cookie) && cookies.some((e) => e.n === 2 && e.cookie), cookies);
}
for (const link of links) {
  const again = await fetch(link, { redirect: "manual" });
  check(`the login link is single use (${new URL(link).port})`, again.status === 403, again.status);
}
judgeGuard(true);
judgeCommands(true);

log.again = await runMode("again", { SPIKE_RUN: "again", SPIKE_SECONDS: "8" });
for (const win of Object.values(DESKS)) {
  const cookies = events.filter((e) => e.case === "cookie" && e.win === win);
  check(`${win} still has the device cookie after a relaunch`, cookies.some((e) => e.cookie), cookies);
}
judgeGuard(false);
judgeCommands(true);

log.frames = await runMode("frames", { SPIKE_RUN: "again", SPIKE_GUARD: "off", SPIKE_SECONDS: "10" });
judgeCommands(false, os === "linux");

if (os === "linux") {
  log["frames-no-postmessage"] = await runMode("frames-no-postmessage", { SPIKE_RUN: "again", SPIKE_GUARD: "off", SPIKE_POSTMESSAGE: "off", SPIKE_SECONDS: "10" });
  judgeCommands(true);
}

console.log(`\n== results (${os})`);
for (const c of checks) {
  console.log(`${c.pass ? "PASS" : "FAIL"} ${c.name}`);
  if (!c.pass) console.log("     " + JSON.stringify(c.detail, null, 1).replaceAll("\n", "\n     "));
}
await Bun.write(`${import.meta.dirname}/target/spike-${os}.json`, JSON.stringify({ checks, log }, null, 1));
process.exit(checks.every((c) => c.pass) ? 0 : 1);
