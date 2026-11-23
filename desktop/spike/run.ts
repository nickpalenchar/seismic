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
// - frames-no-postmessage (Linux and macOS): the same with wry's postMessage IPC unregistered, the
//   way the shell is to run there: no call may pass, an opaque-origin sandboxed frame's included,
//   and each window's own page still reaches its command over the fetch IPC;
// - frames-main-frame-ipc (macOS only): the same with wry's postMessage IPC kept but gated to the
//   window's main frame at the window's own effective origin (the fetch IPC cannot be reached from
//   https pages there): the gate drops subframes and a separate off-origin main frame.
//
// It prints each check with PASS or FAIL and the events behind a failure, and exits 1 on a FAIL.
// With SPIKE_TLS_CERT and SPIKE_TLS_KEY set, run the HTTPS cookie lifecycle, then the frames run
// once more over HTTPS (postMessage unregistered on Linux, gated to the main frame on macOS). Both the shell
// and the webview must trust the fixture certificate. SPIKE_TLS_CA can specify a separate CA file
// for the harness's login-link replay check; it defaults to the fixture certificate.


const binary = process.argv[2] ?? "";
if (!binary) throw new Error("usage: bun desktop/spike/run.ts <webview-spike binary>");

const LOCAL = 8900;
const DESKS = { 8901: "desk-a", 8902: "desk-b" } as Record<number, string>;
const FOREIGN = 8903;
const GATE_PROBE = "gate-probe";
const FRAME_COMMANDS = ["ping_a", "ping_b"] as const;
const cert = process.env.SPIKE_TLS_CERT;
const privateKey = process.env.SPIKE_TLS_KEY;
if (!!cert !== !!privateKey) throw new Error("Set both SPIKE_TLS_CERT and SPIKE_TLS_KEY");
const tls = cert && privateKey ? { cert: Bun.file(cert), key: Bun.file(privateKey) } : undefined;
const scheme = tls ? "https" : "http";
const cookieAttributes = tls ? "SameSite=None; Secure" : "SameSite=Lax";
const at = (port: number) => `${port === LOCAL ? "http" : scheme}://127.0.0.1:${port}`;
const device = crypto.randomUUID();
const cookieName = (port: number) => `seismic-device-${scheme}-${port}`;

type Event = Record<string, any>;
let events: Event[] = [];
let mode = "first";
let key = "";
let os = "";
const tokens = new Map<string, number>();
const links: string[] = [];

const html = (body: string) => new Response(`<!doctype html><meta charset="utf-8">${body}`, { headers: { "content-type": "text/html" } });
const hasCookie = (req: Request, port: number) => (req.headers.get("cookie") ?? "").split(/;\s*/).includes(`${cookieName(port)}=${device}`);

function httpsCookiePage(req: Request, port: number) {
  const loginRedirect = new URL(req.url).searchParams.get("n") === "1";
  const response = html(`<title>${DESKS[port]}</title><h1>${DESKS[port]}</h1><script>
    (async () => {
      const reload = performance.getEntriesByType('navigation')[0]?.type === 'reload';
      await fetch('/report', { method: 'POST', body: JSON.stringify({
        case: 'cookie', win: ${JSON.stringify(DESKS[port])}, origin: location.origin,
        n: reload ? 2 : ${loginRedirect ? 1 : 0}, cookie: ${hasCookie(req, port)}
      }) });
      if (${loginRedirect} && !reload) location.reload();
    })();
  </script>`);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

// what every page shares: report to its own origin, call the shell through Tauri and around it
const common = (win: string) => `<script>
const win = ${JSON.stringify(win)};
const rep = (o) => fetch('/report', { method: 'POST', credentials: 'omit', body: JSON.stringify({ ...o, win, origin: location.origin, href: location.href }) });
const T = window.__TAURI_INTERNALS__;
const KEY = ${JSON.stringify(key)};
const IPC = ${JSON.stringify(os === "windows" ? "http://ipc.localhost/" : "ipc://localhost/")};
async function withDeadline(probe) {
  let timer;
  try {
    return await Promise.race([probe, new Promise((r) => { timer = setTimeout(() => r('timed out'), 2500) })]);
  } finally {
    clearTimeout(timer);
  }
}
async function call(cmd, tag) {
  if (!T) return 'no __TAURI_INTERNALS__';
  if (typeof T.invoke !== 'function') return 'no invoke function';
  return withDeadline((async () => {
    try { return 'ok: ' + await T.invoke(cmd, { tag }) } catch (e) { return 'denied: ' + e }
  })());
}
async function rawFetch(cmd, tag) {
  let response;
  try {
    response = await fetch(IPC + cmd, { method: 'POST', body: JSON.stringify({ tag: tag + '|fetch' }), headers: { 'Content-Type': 'application/json', 'Tauri-Callback': '1', 'Tauri-Error': '2', 'Tauri-Invoke-Key': KEY } });
  } catch (e) { return 'failed: ' + e }
  try {
    return response.headers.get('Tauri-Response') + ': ' + await response.text();
  } catch (e) { return 'response body failed: ' + e }
}
function rawPost(cmd, tag) {
  const post = window.ipc?.postMessage ? (s) => window.ipc.postMessage(s) : window.webkit?.messageHandlers?.ipc ? (s) => window.webkit.messageHandlers.ipc.postMessage(s) : window.chrome?.webview ? (s) => window.chrome.webview.postMessage(s) : null;
  if (!post) return 'no handler';
  try {
    post(JSON.stringify({ cmd, callback: 1, error: 2, payload: { tag: tag + '|postMessage' }, __TAURI_INVOKE_KEY__: KEY }));
    return 'sent';
  } catch (e) { return 'failed: ' + e }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
</script>`;

function frameFixtures(port: number) {
  const win = DESKS[port]!;
  const other = Number(Object.keys(DESKS).find((p) => Number(p) !== port));
  return [
    { frame: "same", port },
    { frame: "sandboxed", port },
    { frame: "otherdesk", port: other },
    { frame: "foreign", port: FOREIGN },
    { frame: "redirect-frame", port: FOREIGN },
  ].map((fixture) => {
    const url = `${at(fixture.port)}/frame?case=${fixture.frame}&win=${win}`;
    const src = fixture.frame === "redirect-frame" ? `${at(port)}/redirect?to=${encodeURIComponent(url)}` : url;
    return { ...fixture, url, src, sandbox: fixture.frame === "sandboxed" };
  });
}

function deskPage(req: Request, port: number) {
  const n = Number(new URL(req.url).searchParams.get("n") ?? "0");
  const win = DESKS[port]!;
  const away = (c: string) => `${at(FOREIGN)}/land?case=${c}&win=${win}`;
  return html(`<title>${win}</title><h1>${win} at ${at(port)}</h1><p>device cookie: ${hasCookie(req, port)}</p><div id=frames></div>
<a id=link href="${away("link")}">away</a>
<form id=form method=post action="${away("form")}"><input name=x value=1></form>
${common(win)}<script>
(async () => {
  await rep({ case: 'cookie', n: ${n}, cookie: ${hasCookie(req, port)}, mode: ${JSON.stringify(mode)} });
  const calls = (async () => {
    for (const cmd of ['ping_a', 'ping_b', 'ping_local']) await rep({ case: 'top-call', cmd, result: await call(cmd, win + '|top|invoke|' + cmd) });
  })();
  if (${n} === 1) { await calls; await sleep(300); location.replace('/?n=2'); return }
  for (const { src, sandbox } of ${JSON.stringify(frameFixtures(port))}) {
    const f = document.createElement('iframe');
    f.src = src; f.width = 260; f.height = 80;
    if (sandbox) f.setAttribute('sandbox', 'allow-scripts');
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
  const identity = { frame: ${JSON.stringify(c)}, effectiveOrigin: self.origin };
  void rep({ case: 'frame-loaded', ...identity });
  const out = { case: 'frame', ...identity, internals: !!T };
  for (const cmd of ${JSON.stringify(FRAME_COMMANDS)}) {
    const postMessage = rawPost(cmd, tag + 'raw|' + cmd);
    const [invoke, fetch] = await Promise.all([
      call(cmd, tag + 'invoke|' + cmd),
      withDeadline(rawFetch(cmd, tag + 'raw|' + cmd)),
    ]);
    out[cmd] = { invoke, raw: { fetch, postMessage } };
  }
  await rep(out);
})();
</script>`);
}

function gateProbePage() {
  return html(`<title>WKWebView origin check</title>${common(GATE_PROBE)}<script>
  rep({ case: 'gate-probe', effectiveOrigin: self.origin,
    postMessage: rawPost('ping_a', win + '|top|raw|ping_a') });
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
    if (e.kind === "key") key = e.key;
    if (e.kind === "key" || e.kind === "platform") os = e.os;
    events.push({ source: "shell", ...e });
    return new Response("ok");
  }
  if (path === "/report") {
    events.push({ source: "page", port, ...(await req.json()) });
    // The sandboxed fixture has an opaque origin even though its document URL is the workspace's.
    return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*" } });
  }
  events.push({ source: "http", port, method: req.method, path, case: url.searchParams.get("case"), win: url.searchParams.get("win"), cookie: DESKS[port] ? hasCookie(req, port) : undefined });
  if (path === "/frame") return framePage(req);
  if (port === 8902 && path === `/${GATE_PROBE}` && mode.includes("main-frame")) return gateProbePage();
  if (path === "/land") return html(`<h1>left the window's origin: ${url.searchParams.get("case")}</h1>`);
  if (path === "/redirect") return new Response(null, { status: 302, headers: { location: url.searchParams.get("to")! } });
  if (path === "/meta") return html(`<meta http-equiv="refresh" content="0;url=${url.searchParams.get("to")}">`);
  if (port === LOCAL && path === "/local") return localPage();
  if (!DESKS[port]) return new Response("not found", { status: 404 });
  if (path === "/api/pair" && req.method === "POST") {
    const { code } = await req.json();
    if (code !== "123456") return Response.json({ error: "wrong code" }, { status: 401 });
    const token = crypto.randomUUID();
    tokens.set(token, port);
    const link = `${at(port)}/login?once=${token}`;
    links.push(link);
    return Response.json({ link });
  }
  if (path === "/login") {
    const token = url.searchParams.get("once") ?? "";
    if (tokens.get(token) !== port) return new Response("this login link is used or unknown", { status: 403 });
    tokens.delete(token);
    return new Response(null, {
      status: 302,
      headers: {
        location: "/?n=1",
        "set-cookie": `${cookieName(port)}=${device}; Path=/; HttpOnly; ${cookieAttributes}; Max-Age=31536000`,
      },
    });
  }
  if (path === "/") return tls && !mode.startsWith("frames-https") ? httpsCookiePage(req, port) : deskPage(req, port);
  return new Response("not found", { status: 404 });
}

for (const port of [LOCAL, ...Object.keys(DESKS).map(Number), FOREIGN]) {
  Bun.serve({ hostname: "127.0.0.1", port, tls: port === LOCAL ? undefined : tls, fetch: (req) => handle(req, port) });
}

function runApp(env: Record<string, string>) {
  return new Promise<number>((resolve) => {
    const child = Bun.spawn([binary], {
      env: { ...process.env, ...env, SPIKE_HTTPS_COOKIES: tls ? "1" : "0" },
      stdio: ["ignore", "inherit", "inherit"],
    });
    const kill = setTimeout(() => child.kill(), 60_000);
    void child.exited.then((status) => (clearTimeout(kill), resolve(status)));
  });
}

type Check = { name: string; pass: boolean; detail?: unknown };
const checks: Check[] = [];
const exceptions: { mode: string; name: string; events: Event[] }[] = [];
const check = (name: string, pass: boolean, detail?: unknown) => checks.push({ name: `[${mode}] ${name}`, pass, detail: pass ? undefined : detail });
const OWN: Record<string, { cmd: string; origin: string }> = { "desk-a": { cmd: "ping_a", origin: at(8901) }, "desk-b": { cmd: "ping_b", origin: at(8902) }, main: { cmd: "ping_local", origin: at(LOCAL) } };

function judgeFrameProbes(ran: Event[]) {
  const reports = events.filter((e) => e.source === "page" && e.case === "frame");
  const post = mode.includes("no-postmessage") ? "no handler" : "sent";
  for (const [deskPort, win] of Object.entries(DESKS)) {
    for (const { frame, port, url, sandbox } of frameFixtures(Number(deskPort))) {
      const evidence = reports.filter((e) => e.win === win && e.frame === frame);
      const report = evidence[0];
      const caller = sandbox ? "null" : at(port);
      const complete = evidence.length === 1 && report !== undefined && report.port === port && report.href === url
        && report.effectiveOrigin === caller
        && FRAME_COMMANDS.every((cmd) => {
          const result = report[cmd];
          const allowed = frame === "same" && OWN[win]?.cmd === cmd;
          // A dispatched invoke can go unanswered (for example, a postMessage with no frame
          // callback). The raw transports and native command log are checked independently.
          const invoke = result?.invoke;
          return (report.internals === false ? invoke === "no __TAURI_INTERNALS__"
            : report.internals === true && typeof invoke === "string"
              && (invoke === "timed out" || invoke.startsWith("denied: ") || (allowed && invoke.startsWith("ok: "))))
            && typeof result.raw?.fetch === "string"
            && result.raw.postMessage === post;
        });
      check(`${win}'s ${frame} frame reported outcomes for both commands and all three IPC paths`, complete, { url, evidence });
      for (const cmd of FRAME_COMMANDS) {
        const reply = report?.[cmd]?.raw?.fetch;
        const tag = `${win}|frame-${frame}|raw|${cmd}|fetch`;
        const native = ran.filter((e) => e.tag === tag);
        const detail = { url, cmd, reply, native };
        if (tls && os === "macos") {
          check(`WKWebView blocked ${win}'s ${frame} raw fetch for ${cmd} at the HTTPS browser boundary`,
            typeof reply === "string" && reply.startsWith("failed: TypeError:") && native.length === 0, detail);
        } else if (frame === "same" && OWN[win]?.cmd === cmd) {
          check(`${win}'s same-origin raw fetch reached ${cmd} and received its reply`,
            reply === `ok: ${JSON.stringify(`${cmd} ran in ${win}`)}`
              && native.some((e) => e.window === win && e.cmd === cmd && e.originHeader === caller), detail);
        } else if (sandbox) {
          check(`IPC rejected ${win}'s sandboxed raw fetch for ${cmd} with an invalid origin`,
            reply === "null: Origin header is not a valid URL" && native.length === 0, detail);
        } else {
          const denial = `${cmd} not allowed on window "${win}", webview "${win}", URL: ${caller}/\n`;
          check(`the capability denied ${win}'s ${frame} raw fetch for ${cmd} at ${caller}`,
            typeof reply === "string" && reply.startsWith(`error: ${JSON.stringify(denial).slice(0, -1)}`) && native.length === 0, detail);
        }
      }
    }
  }
}

function judgeGate() {
  const dropped = events.filter((e) => e.source === "shell" && e.kind === "ipcDropped");
  function requireDrop(name: string, win: string, url: string, mainFrame: boolean, origin: string, expectedOrigin: string) {
    const evidence = dropped.filter((e) => e.window === win && e.url === url);
    check(name, evidence.some((e) => e.mainFrame === mainFrame && e.origin === origin && e.expectedOrigin === expectedOrigin),
      { win, url, mainFrame, origin, expectedOrigin, evidence });
  }
  for (const [port, win] of Object.entries(DESKS)) {
    const own = at(Number(port));
    for (const { frame, url, sandbox } of frameFixtures(Number(port))) {
      requireDrop(`WKWebView dropped ${win}'s ${frame} subframe at the gate`, win, url, false, sandbox ? "null" : new URL(url).origin, own);
    }
  }
  const probeOrigin = at(8902);
  const probeUrl = `${probeOrigin}/${GATE_PROBE}`;
  const probes = events.filter((e) => e.source === "page" && e.case === "gate-probe");
  check("the mismatched-origin page sent a main-frame postMessage probe",
    probes.some((e) => e.win === GATE_PROBE && e.port === 8902 && e.href === probeUrl && e.effectiveOrigin === probeOrigin && e.postMessage === "sent"), probes);
  requireDrop("WKWebView dropped a main-frame message from a mismatched effective origin",
    GATE_PROBE, probeUrl, true, probeOrigin, at(8901));
}

/// Judge the allowed window and effective origin, recording known engine exceptions separately.
function judgeCommands(expectTop: boolean, quirk = false) {
  const ran = events.filter((e) => e.source === "shell" && e.kind === "cmd");
  const mainFrameGate = mode.includes("main-frame");
  const postMessage = !mode.includes("no-postmessage") && !mode.includes("main-frame");
  const engine = os === "macos" && postMessage ? "WKWebView" : os === "linux" && postMessage ? "WebKitGTK" : "";
  const knownOpaqueCalls = engine ? ran.filter((e) => {
    const [win, from, ...call] = String(e.tag).split("|");
    return from === "frame-sandboxed" && e.window === win && OWN[e.window]?.cmd === e.cmd && call.at(-1) === "postMessage";
  }) : [];
  if (knownOpaqueCalls.length) exceptions.push({
    mode, name: `${engine} admitted native calls from opaque-origin sandboxed frames`, events: knownOpaqueCalls,
  });
  const wrong = ran.filter((e) => {
    const [win, from, ...call] = String(e.tag).split("|");
    const own = OWN[e.window];
    // The WKWebView gate controls postMessage only. Its HTTP fetch transport can still serve
    // the window's own origin, including a same-origin frame.
    const allowedSender = from === "top" || (from === "frame-same" && (!mainFrameGate || (!tls && call.at(-1) === "fetch")));
    return !knownOpaqueCalls.includes(e) && (e.window !== win || own?.cmd !== e.cmd || !allowedSender);
  });
  if (quirk) {
    // wry on Linux hands a postMessage call to Tauri as the page the webview shows: a foreign frame
    // passes as the window's page. Still so means the shell still has to unregister that handler.
    check("wry's postMessage still attributes a foreign frame's call to the window's page (why the shell unregisters it)", wrong.some((e) => String(e.tag).includes("|frame-foreign|")), wrong);
  } else check("no calls escaped window and origin scope beyond a recorded exception", wrong.length === 0, wrong);
  if (mode.startsWith("frames")) judgeFrameProbes(ran);
  if (mainFrameGate) judgeGate();
  if (expectTop) {
    for (const [win, { cmd, origin }] of Object.entries(OWN).filter(([win]) => !tls || win !== "main")) {
      const calls = events.filter((e) => e.source === "page" && e.win === win && e.case === "top-call" && e.origin === origin);
      check(`${win}'s own page may call ${cmd}`,
        ran.some((e) => e.window === win && e.cmd === cmd && e.tag === `${win}|top|invoke|${cmd}`)
          && calls.some((e) => e.cmd === cmd && e.result === `ok: ${cmd} ran in ${win}`), calls);
      if (mode.startsWith("frames")) {
        for (const wrongCmd of [...FRAME_COMMANDS, "ping_local"].filter((c) => c !== cmd)) {
          const replies = calls.filter((e) => e.cmd === wrongCmd);
          check(`${win}'s top page received a denial for ${wrongCmd}`,
            replies.some((e) => typeof e.result === "string" && e.result.startsWith("denied: ")), replies);
        }
      }
    }
  }
  return ran;
}

function judgeGuard(navigated: boolean) {
  const sent = events.filter((e) => e.source === "http" && (e.port === FOREIGN || (DESKS[e.port] && e.win && e.win !== DESKS[e.port])));
  const rendered = events.filter((e) => e.source === "page" && (e.case === "frame-loaded" || e.case === "frame")
    && e.port !== Number(Object.keys(DESKS).find((p) => DESKS[Number(p)] === e.win)));
  check("no page of another origin rendered in a workspace window's frames", rendered.length === 0, rendered);
  // WebView2 sends a navigation's GET while it asks the hook, and drops the answer when the hook
  // says no: the window stays, the request has left
  if (os === "windows") {
    if (sent.length) console.log(`note [${mode}] refused navigations whose GET still reached the other origin: ${sent.map((e) => `${e.win}:${e.case}`).join(", ")}`);
  } else check("no request reached another origin (navigations, redirects, frames)", sent.length === 0, sent);
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
  const status = await runApp(env);
  if (tls) check("the app reported its platform and quit cleanly",
    status === 0 && events.some((e) => e.kind === "key") && events.some((e) => e.kind === "quit"), { status, events });
  return events;
}

const log: Record<string, Event[]> = {};

console.log(`Checking ${scheme.toUpperCase()} cookies (${cookieAttributes})`);
log.first = await runMode("first", { SPIKE_RUN: "first", SPIKE_SECONDS: tls ? "8" : "20" });
for (const [deskPort, win] of Object.entries(DESKS)) {
  const port = Number(deskPort);
  const cookies = events.filter((e) => e.source === "page" && e.case === "cookie" && e.win === win && e.port === port && e.origin === at(port));
  const authenticatedLoads = events.filter((e) => e.source === "http" && e.port === port && e.method === "GET" && e.path === "/" && e.cookie);
  check(`${win} has the ${scheme.toUpperCase()} cookie after the login redirect and ${tls ? "on reload" : "on a second load"}`,
    cookies.some((e) => e.n === 1 && e.cookie) && cookies.some((e) => e.n === 2 && e.cookie) && authenticatedLoads.length >= 2,
    { cookies, authenticatedLoads });
  const linkCount = links.filter((link) => new URL(link).origin === at(port)).length;
  const pairingErrors = events.filter((e) => e.source === "shell" && e.kind === "pairFailed" && e.window === win);
  check(`${win} received exactly one login link`, linkCount === 1, { linkCount, pairingErrors });
}
for (const link of links) {
  const name = `the ${scheme.toUpperCase()} login link is single use (${new URL(link).port})`;
  try {
    const options = cert ? { tls: { ca: await Bun.file(process.env.SPIKE_TLS_CA ?? cert).text() } } : {};
    const again = await fetch(link, { redirect: "manual", ...options });
    check(name, again.status === 403, again.status);
  } catch (error) {
    check(name, false, String(error));
  }
}
if (!tls) {
  judgeGuard(true);
  judgeCommands(true);
}

log.again = await runMode("again", { SPIKE_RUN: "again", SPIKE_SECONDS: "8" });
for (const [port, win] of Object.entries(DESKS)) {
  const cookies = events.filter((e) => e.source === "page" && e.case === "cookie" && e.win === win && e.port === Number(port) && e.origin === at(Number(port)));
  const requests = events.filter((e) => e.source === "http" && e.port === Number(port));
  check(`${win} still has the ${scheme.toUpperCase()} cookie on relaunch without another login`,
    cookies.some((e) => e.n === 0 && e.cookie)
      && requests.some((e) => e.method === "GET" && e.path === "/" && e.cookie)
      && !requests.some((e) => e.path === "/login" || e.path === "/api/pair"),
    { cookies, requests });
}
if (!tls) {
  judgeGuard(false);
  judgeCommands(true);

  log.frames = await runMode("frames", { SPIKE_RUN: "again", SPIKE_GUARD: "off", SPIKE_SECONDS: "10" });
  judgeCommands(false, os === "linux");

  if (os === "linux" || os === "macos") {
    log["frames-no-postmessage"] = await runMode("frames-no-postmessage", { SPIKE_RUN: "again", SPIKE_GUARD: "off", SPIKE_POSTMESSAGE: "off", SPIKE_SECONDS: "10" });
    judgeCommands(true);
  }
  if (os === "macos") {
    log["frames-main-frame-ipc"] = await runMode("frames-main-frame-ipc", { SPIKE_RUN: "again", SPIKE_GUARD: "off", SPIKE_POSTMESSAGE: "main-frame", SPIKE_SECONDS: "10" });
    judgeCommands(true);
  }
}

if (tls) {
  // the guard is off, so foreign frames load: the capability and the effective origin alone have
  // to turn their calls away, and the windows' own pages have to reach their commands over HTTPS
  const postMessage = os === "linux" ? "off" : os === "macos" ? "main-frame" : "on";
  const name = { off: "frames-https-no-postmessage", "main-frame": "frames-https-main-frame-ipc", on: "frames-https" }[postMessage];
  log["frames-https"] = await runMode(name, { SPIKE_RUN: "again", SPIKE_GUARD: "off", SPIKE_POSTMESSAGE: postMessage, SPIKE_SECONDS: "10" });
  judgeCommands(true);
}

await Bun.write(`${import.meta.dirname}/target/spike-${os || "unknown"}${tls ? "-https" : ""}.json`,
  JSON.stringify({ scheme, cookieAttributes, checks, exceptions, log }, null, 1));
console.log(`\n== results (${os})`);
for (const c of checks) {
  console.log(`${c.pass ? "PASS" : "FAIL"} ${c.name}`);
  const detail = c.pass ? undefined : JSON.stringify(c.detail, null, 1);
  if (detail !== undefined) console.log("     " + detail.replaceAll("\n", "\n     "));
}
for (const exception of exceptions) console.log(`EXCEPTION [${exception.mode}] ${exception.name}`);
process.exit(checks.every((c) => c.pass) ? 0 : 1);
