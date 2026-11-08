// What happens to an app a real Claude or Codex worker started when its agent, or Seismic, dies?
// bun scripts/harness-crash-probe.ts [claude|codex ...] [agent-death|obeya-death|obeya-restart ...] [--out <file>]
// For each harness and case it stages a scratch Seismic with real workers (scripts/scratch-obeya.ts,
// its own repository and SEISMIC_HOME), starts one card whose worker runs `python3 job.py` (a heartbeat
// that leaves for a session and process group of its own; the launcher exits after three seconds)
// and asks a question. Once parking has asked the trusted `app.keep` (which logs and keeps the app)
// it SIGKILLs the worker's agent process or the Seismic server (obeya-restart: and then starts an
// Seismic again on the same home, whose startup sweep ends what the crash left, session-registry.ts),
// waits, and records what still runs:
// heartbeat, agent, server, an unrelated canary, the card and the settings commands that ran. Then
// it ends every process it started or saw under the server, and checks nothing of them is left.
// Each line printed (and appended to --out) is one case as JSON; `status` is `measured`, `blocked`
// (the worker never got there: not logged in, refused, timed out) or `failed` (the probe broke).
// It reports what it saw on this machine with these CLI versions; it proves no containment.
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, openSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { Database } from 'bun:sqlite';

const ROOT = join(import.meta.dir, '..');
const read = (file: string) => { try { return readFileSync(file, 'utf8').trim(); } catch { return ''; } };
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
// the heartbeat rewrites its tick file ten times a second: a read in between finds it empty
const tickIn = (dir: string) => { for (let i = 0; i < 20; i++) { const t = read(join(dir, 'app.tick')); if (t) return Number(t); Bun.sleepSync(5); } return 0; };
const real = (path: string) => { try { return realpathSync(path); } catch { return path; } };

interface Proc { pid: number; ppid: number; pgid: number; command: string }
const table = (): Proc[] =>
  spawnSync('ps', ['-axo', 'pid=,ppid=,pgid=,command='], { encoding: 'utf8' }).stdout.split('\n').flatMap((line) => {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/);
    return m ? [{ pid: Number(m[1]), ppid: Number(m[2]), pgid: Number(m[3]), command: m[4]! }] : [];
  });
const descendants = (root: number, rows = table()) => {
  const found = new Set([root]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const p of rows) if (found.has(p.ppid) && !found.has(p.pid)) (found.add(p.pid), (grew = true));
  }
  return rows.filter((p) => p.pid !== root && found.has(p.pid));
};
const cwdOf = (pid: number) => spawnSync('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], { encoding: 'utf8' }).stdout.split('\n').find((l) => l.startsWith('n'))?.slice(1) ?? '';
// a number seen earlier may belong to another program by now: only signal what still looks like ours
const stillOurs = (p: Proc) => table().some((q) => q.pid === p.pid && q.command === p.command);
// every heartbeat working under `dir`, however many a worker started: the job's command names no path
const heartbeats = (dir: string) => table().filter((p) => p.command.includes('job.py') && real(cwdOf(p.pid)).startsWith(real(dir)));
const kill = (pid: number, signal: NodeJS.Signals = 'SIGKILL') => { try { process.kill(pid, signal); return true; } catch { return false; } };

const JOB = `import os, sys, time
from pathlib import Path
if os.fork() == 0:
    os.setsid()  # a session and process group of its own, as a server started to outlive its shell
    Path('app.pid').write_text(str(os.getpid()))
    n = 0
    while True:
        n += 1
        Path('app.tick').write_text(str(n))
        time.sleep(0.1)
time.sleep(3)  # the launcher stays its parent long enough to be seen, then exits
print('heartbeat started')
`;
const SETTINGS = { app: { run: 'python3 job.py', keep: 'echo keep >> keep.log; exit 0', stop: 'echo stop >> stop.log; kill $(cat app.pid)' } };
const TASK =
  'This is a disposable process-lifecycle probe; it changes no code. Run `python3 job.py` once, in the foreground: it starts a heartbeat ' +
  'in a session of its own (app.pid, app.tick) and returns after about three seconds. Check that app.tick exists, then call ask with the ' +
  'question PROBE_READY and no options, and end your turn. Do not stop the heartbeat, edit files, commit or start anything else.';

const HARNESSES = ['claude', 'codex'] as const;
const CASES = ['agent-death', 'obeya-death', 'obeya-restart'] as const;
type Harness = (typeof HARNESSES)[number];
type Case = (typeof CASES)[number];

function versions() {
  const v = (cmd: string) => spawnSync(cmd, ['--version'], { encoding: 'utf8', env: probeEnv() }).stdout.trim();
  return { claude: v(claudeCli()), codex: v(codexCli()), bun: Bun.version, os: `${process.platform} ${spawnSync('uname', ['-r'], { encoding: 'utf8' }).stdout.trim()}` };
}
// Seismic runs Codex from PATH; a wrapper there (a terminal app's shim, say) would stand between the server and the app-server
const plainPath = () => (process.env.PATH ?? '').split(delimiter).filter((d) => !d.includes('cli-shims')).join(delimiter);
const codexCli = () => (process.env.SEISMIC_CODEX ?? process.env.OBEYA_CODEX) ?? Bun.which('codex', { PATH: plainPath() }) ?? 'codex';
const claudeCli = () => Bun.which('claude', { PATH: plainPath() }) ?? 'claude';
const probeEnv = () => ({ ...process.env, PATH: plainPath(), SEISMIC_CODEX: codexCli(), SEISMIC_PARK_GRACE: '2' });

async function run(harness: Harness, kind: Case) {
  const work = mkdtempSync(join(tmpdir(), `obeya-crash-${harness}-${kind}-`));
  const stage = {
    name: 'Crash probe',
    language: 'en',
    conversation: 'en',
    files: { 'README.md': '# Crash probe\n', 'job.py': JOB, '.obeya/settings.json': JSON.stringify(SETTINGS, null, 2) + '\n' },
    cards: [{ key: 'probe', title: `${harness} ${kind} probe`, body: TASK }],
    dir: join(work, 'scratch'),
  };
  writeFileSync(join(work, 'stage.json'), JSON.stringify(stage));
  // unrelated to everything else: a session of its own, never a descendant of the server
  const canary = spawn('python3', ['-c', 'import time\nwhile True: time.sleep(1)'], { detached: true, stdio: 'ignore' });
  canary.unref();
  const result: Record<string, unknown> = { harness, kind };
  let staged: { port: number; pid: number; dir: string; canvas: string; cards: Record<string, string> } | undefined;
  let seen: Proc[] = [];
  let job = 0;
  let agent: Proc | undefined;
  let db: Database | undefined;
  try {
    const out = spawnSync('bun', [join(ROOT, 'scripts/scratch-obeya.ts'), join(work, 'stage.json'), '--real-workers'], { cwd: ROOT, encoding: 'utf8', env: probeEnv(), timeout: 120_000 });
    if (out.status !== 0) throw new Error(`staging failed: ${out.stderr.trim().slice(-500)}`);
    staged = JSON.parse(out.stdout.trim().split('\n').pop()!);
    const s = staged!;
    const home = join(s.dir, 'home');
    const key = read(join(home, 'owner.key'));
    const api = async (path: string, body?: unknown, method = 'POST') => {
      const r = await fetch(`http://127.0.0.1:${s.port}${path}`, { method, headers: { 'x-obeya-key': key, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const text = await r.text();
      if (!r.ok) throw new Error(`${path}: ${r.status} ${text}`);
      return text ? JSON.parse(text) : {};
    };
    db = new Database(join(home, 'obeya.db'), { readonly: true });
    const id = s.cards.probe!;
    const card = () => db!.query('select state, need, paused, workstation, detail, session_id from cards where id = ?').get(id) as Record<string, string | null> | null;
    const check = await api('/api/config/check', undefined, 'GET');
    const repo = check.resolved[0].repos[0];
    await api('/api/config/trust', { path: join(s.dir, 'repo'), seen: repo.trust.now, held: repo.trust.held });
    const worker = harness === 'codex' ? { model: 'default', effort: 'low', harness: 'codex', codex: { model: 'default', effort: 'low' } } : { model: 'sonnet', effort: 'low' };
    await api('/api/agents', { worker }, 'PUT');
    await api(`/api/c/${s.canvas}/cards/${id}/act`, { action: 'start' });

    // the worker started the heartbeat, asked, and parking asked app.keep, which kept it
    const ready = () => {
      const c = card();
      const w = c?.workstation;
      return !!w && c?.state === 'waiting' && c.need === 'question' && tickIn(w) > 0 && read(join(w, 'keep.log')).includes('keep');
    };
    const end = Date.now() + 6 * 60_000;
    while (Date.now() < end && !ready() && alive(s.pid)) await Bun.sleep(500);
    const before = card();
    const workstation = before?.workstation ?? '';
    if (!ready()) {
      const log = read(join(s.dir, 'server.log'));
      return Object.assign(result, { status: 'blocked', why: alive(s.pid) ? 'worker did not reach the question with a kept heartbeat in 6 minutes' : 'scratch Seismic exited', card: before, heartbeat: workstation ? read(join(workstation, 'app.tick')) : '', logTail: log.slice(-1500) });
    }
    job = Number(read(join(workstation, 'app.pid')));
    const rows = table();
    seen = descendants(s.pid, rows);
    // the worker's agent: the server's own child working in the card's workstation (the Koordinator's works elsewhere)
    agent = seen.find((p) => p.ppid === s.pid && /claude|codex/.test(p.command) && real(cwdOf(p.pid)) === real(workstation));
    if (!agent) throw new Error(`no agent process in ${workstation} among ${JSON.stringify(seen.filter((p) => p.ppid === s.pid))}`);
    const jobRow = rows.find((p) => p.pid === job);
    const server = rows.find((p) => p.pid === s.pid)!;
    result.before = {
      card: before,
      server: { pid: server.pid, pgid: server.pgid },
      agent: { pid: agent.pid, pgid: agent.pgid, command: agent.command.slice(0, 120) },
      app: jobRow ? { pid: job, ppid: jobRow.ppid, pgid: jobRow.pgid, ownGroup: jobRow.pgid !== agent.pgid && jobRow.pgid !== server.pgid, underAgent: seen.some((p) => p.pid === job) } : { pid: job, missing: true },
      heartbeats: heartbeats(work).length,
      canary: { pid: canary.pid, underServer: seen.some((p) => p.pid === canary.pid) },
      keep: read(join(workstation, 'keep.log')),
      stop: read(join(workstation, 'stop.log')),
    };
    const tick = tickIn(workstation);
    const lastEvent = (db.query('select max(id) as id from events where card_id = ?').get(id) as { id: number | null }).id ?? 0;
    kill(kind === 'agent-death' ? agent.pid : s.pid);
    const sweptBefore = read(join(s.dir, 'server.log')).length;
    await Bun.sleep(8000);
    const after = tickIn(workstation);
    result.after = {
      appAlive: alive(job),
      ticksDuring8s: after - tick,
      // a heartbeat started after the crash writes the same files
      appPidNow: Number(read(join(workstation, 'app.pid'))),
      heartbeats: heartbeats(work).map((p) => ({ pid: p.pid, ppid: p.ppid, pgid: p.pgid })),
      agentAlive: alive(agent.pid),
      serverAlive: alive(s.pid),
      canaryAlive: alive(canary.pid!),
      // what else that ran under the server outlives it (the Koordinator's session, a helper)
      survivors: seen.filter((p) => p.pid !== job && alive(p.pid) && stillOurs(p)).map((p) => ({ pid: p.pid, command: p.command.slice(0, 100) })),
      card: card(),
      events: (db.query('select kind, author, substr(text, 1, 160) as text from events where card_id = ? and id > ? order by id').all(id, lastEvent) as unknown[]),
      keep: read(join(workstation, 'keep.log')),
      stop: read(join(workstation, 'stop.log')),
      serverLog: read(join(s.dir, 'server.log')).split('\n').filter((l) => /error|exit|died|stopp|kill|park/i.test(l)).slice(-12),
    };
    if (kind === 'obeya-restart') {
      // the same home, as a supervisor would start it again after the crash
      const log = openSync(join(s.dir, 'server.log'), 'a');
      const again = spawn(process.execPath, ['src/server/main.ts', '--config', join(s.dir, 'canvases.json'), '--port', String(s.port), '--dev'], {
        cwd: ROOT, env: { ...probeEnv(), SEISMIC_HOME: home }, detached: true, stdio: ['ignore', log, log],
      });
      again.unref();
      writeFileSync(join(s.dir, 'server.pid'), String(again.pid));
      s.pid = again.pid!;
      let up = false;
      for (let i = 0; i < 240 && !up && alive(s.pid); i++) {
        up = await fetch(`http://127.0.0.1:${s.port}/api/canvases`, { headers: { 'x-obeya-key': key } }).then((r) => r.ok, () => false);
        if (!up) await Bun.sleep(500);
      }
      await Bun.sleep(3000);
      const tickA = tickIn(workstation);
      await Bun.sleep(1000);
      result.restart = {
        up,
        appAlive: alive(job),
        ticksIn1s: tickIn(workstation) - tickA,
        heartbeats: heartbeats(work).length,
        agentAlive: alive(agent.pid),
        canaryAlive: alive(canary.pid!),
        card: card(),
        sweep: read(join(s.dir, 'server.log')).slice(sweptBefore).split('\n').filter((l) => /left by an earlier Seismic/.test(l)),
        registry: (() => { try { return readdirSync(join(home, 'sessions')); } catch { return []; } })(),
      };
    }
    result.status = 'measured';
    return result;
  } catch (e) {
    return Object.assign(result, { status: 'failed', why: (e as Error).message });
  } finally {
    db?.close();
    // everything this case started or saw, whatever the case left running
    const left: string[] = [];
    if (staged && alive(staged.pid)) {
      seen.push(...descendants(staged.pid));
      const stop = spawnSync('bun', [join(ROOT, 'scripts/scratch-obeya.ts'), '--stop', String(staged.port), '--dir', staged.dir], { cwd: ROOT, encoding: 'utf8' });
      if (stop.status !== 0) left.push(`--stop: ${stop.stderr.trim()}`);
    }
    for (const p of heartbeats(work)) kill(p.pid);
    for (const p of seen.reverse()) if (alive(p.pid) && stillOurs(p)) (kill(-p.pgid), kill(p.pid));
    kill(canary.pid!);
    await Bun.sleep(500);
    const scratch = staged?.dir ?? stage.dir;
    for (const p of table()) if (p.pid !== process.pid && (p.command.includes(scratch) || p.command.includes(real(scratch)) || seen.some((q) => q.pid === p.pid && q.command === p.command))) left.push(`${p.pid} ${p.command.slice(0, 100)}`);
    for (const p of heartbeats(work)) left.push(`${p.pid} ${p.command}`);
    result.cleanup = left.length ? { clean: false, left } : { clean: true };
    rmSync(work, { recursive: true, force: true });
  }
}

const args = process.argv.slice(2);
const outAt = args.indexOf('--out');
const outFile = outAt >= 0 ? args[outAt + 1] : undefined;
const named = args.filter((_, i) => i !== outAt && i !== outAt + 1);
const harnesses = HARNESSES.filter((h) => named.includes(h));
const cases = CASES.filter((c) => named.includes(c));
const header = { probe: 'harness-crash', at: new Date().toISOString(), versions: versions() };
console.log(JSON.stringify(header));
if (outFile) appendFileSync(outFile, JSON.stringify(header) + '\n');
for (const harness of harnesses.length ? harnesses : HARNESSES)
  for (const kind of cases.length ? cases : CASES) {
    const line = JSON.stringify(await run(harness, kind));
    console.log(line);
    if (outFile) appendFileSync(outFile, line + '\n');
  }
process.exit(0);
