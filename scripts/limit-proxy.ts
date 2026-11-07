// A pass-through proxy for live usage-limit checks: real Claude Code and real Codex talk to their
// real model services through it, and it answers a request with the account's usage limit instead,
// as often as it was told to, so that a live card runs into the limit and must recover from it.
//
//   bun scripts/limit-proxy.ts [--port <n>] [--log <file>]
//
// Claude Code goes through it with ANTHROPIC_BASE_URL=http://127.0.0.1:<port>/anthropic in the
// scratch Seismic's environment, Codex with the wrapper it writes (`codex` beside the log, given to
// the scratch Seismic as SEISMIC_CODEX): the installed Codex with a model provider of the same
// ChatGPT sign-in whose base URL is this proxy's /codex. Everything else is forwarded unchanged.
//
//   curl -XPOST 'http://127.0.0.1:<port>/limit?harness=claude&for=120'
//
// puts that harness (claude or codex) over its limit for the next `for` seconds, as a real limit
// is: every model request until then is refused, saying when the limit resets; GET /limit tells
// what is limited and what was refused. A refusal looks as the service's own does: for Claude a 429 with the unified rate-limit
// headers saying `rejected` and the reset, for Codex a 429 `usage_limit_reached` with `resets_at`.
import { appendFileSync, chmodSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const opt = (name: string) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined);
const port = Number(opt('port') ?? 4499);
const log = opt('log') ?? `/tmp/limit-proxy-${port}.log`;
const note = (line: string) => appendFileSync(log, `${new Date().toISOString()} ${line}\n`);

const UPSTREAM = { claude: 'https://api.anthropic.com', codex: 'https://chatgpt.com/backend-api/codex' } as const;
type Harness = keyof typeof UPSTREAM;
/** Until when (ms) each harness is over its limit. */
const limited: Record<Harness, number> = { claude: 0, codex: 0 };
const refused: { harness: Harness; path: string; at: string; resetsAt: string }[] = [];

/** Whether the request asks the model for a turn (not a token count, the model list or the usage). */
const modelCall = (harness: Harness, path: string, method: string) =>
  method === 'POST' && (harness === 'claude' ? /^\/v1\/messages\/?$/.test(path) : /^\/responses\/?$/.test(path));

function refusal(harness: Harness, until: number): Response {
  const reset = Math.ceil(until / 1000);
  const resetIn = Math.max(1, reset - Math.floor(Date.now() / 1000));
  if (harness === 'claude')
    return Response.json(
      { type: 'error', error: { type: 'rate_limit_error', message: 'This request would exceed your account\'s rate limit. Please try again later.' } },
      {
        status: 429,
        headers: {
          'anthropic-ratelimit-unified-status': 'rejected',
          'anthropic-ratelimit-unified-reset': String(reset),
          'anthropic-ratelimit-unified-representative-claim': 'five_hour',
          'anthropic-ratelimit-unified-5h-status': 'rejected',
          'anthropic-ratelimit-unified-5h-reset': String(reset),
          'anthropic-ratelimit-unified-5h-utilization': '1.0',
          'x-should-retry': 'false',
        },
      },
    );
  return Response.json(
    { error: { type: 'usage_limit_reached', message: 'The usage limit has been reached', plan_type: 'plus', resets_at: reset, resets_in_seconds: resetIn } },
    {
      status: 429,
      headers: {
        'x-codex-primary-used-percent': '100',
        'x-codex-primary-window-minutes': '300',
        'x-codex-primary-reset-at': String(reset),
        'x-codex-primary-reset-after-seconds': String(resetIn),
      },
    },
  );
}

const server = Bun.serve({
  port,
  hostname: '127.0.0.1',
  idleTimeout: 0,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/limit') {
      if (req.method === 'POST') {
        const harness = url.searchParams.get('harness') as Harness;
        if (!(harness in UPSTREAM)) return new Response('harness: claude or codex', { status: 400 });
        limited[harness] = Date.now() + Number(url.searchParams.get('for') ?? 120) * 1000;
        note(`limited ${harness} until ${new Date(limited[harness]).toISOString()}`);
      }
      return Response.json({ limited: Object.fromEntries(Object.entries(limited).map(([h, t]) => [h, t > Date.now() ? new Date(t).toISOString() : null])), refused });
    }
    if (process.env.LIMIT_PROXY_TRACE) note(`seen ${req.method} ${url.pathname} upgrade=${req.headers.get("upgrade") ?? ""}`);
    const [, prefix, ...rest] = url.pathname.split('/');
    const harness = prefix === 'anthropic' ? 'claude' : prefix === 'codex' ? 'codex' : undefined;
    if (!harness) return new Response('not found', { status: 404 });
    const path = `/${rest.join('/')}`;
    if (modelCall(harness, path, req.method) && limited[harness] > Date.now()) {
      const resetsAt = new Date(limited[harness]).toISOString();
      refused.push({ harness, path, at: new Date().toISOString(), resetsAt });
      note(`REFUSED ${harness} ${req.method} ${path} (resets ${resetsAt})`);
      return refusal(harness, limited[harness]);
    }
    const headers = new Headers(req.headers);
    headers.delete('host');
    headers.delete('accept-encoding');
    const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.arrayBuffer();
    const upstream = await fetch(`${UPSTREAM[harness]}${path}${url.search}`, { method: req.method, headers, body, redirect: 'manual' });
    note(`${upstream.status} ${harness} ${req.method} ${path}`);
    const out = new Headers(upstream.headers);
    out.delete('content-encoding');
    out.delete('content-length');
    return new Response(upstream.body, { status: upstream.status, headers: out });
  },
});

// the installed Codex, with a provider that reaches the model through this proxy under the same sign-in
const codex = spawnSync('/bin/sh', ['-c', 'command -v codex'], { encoding: 'utf8' }).stdout.trim();
const wrapper = join(dirname(log), 'codex');
writeFileSync(
  wrapper,
  // the overrides go after the subcommand: an app-server takes no -c given before it
  `#!/bin/sh\nsub="$1"; shift\nexec ${JSON.stringify(process.env.LIMIT_PROXY_CODEX ?? codex)} "$sub" -c model_provider=limitproxy -c 'model_providers.limitproxy={name="limitproxy",base_url="http://127.0.0.1:${server.port}/codex",wire_api="responses",requires_openai_auth=true}' "$@"\n`,
);
chmodSync(wrapper, 0o755);
note(`listening on ${server.port}, codex wrapper ${wrapper}`);
console.log(JSON.stringify({ port: server.port, log, codex: wrapper, claude: `http://127.0.0.1:${server.port}/anthropic` }));
