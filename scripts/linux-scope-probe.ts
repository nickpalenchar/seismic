// What a systemd user scope holds on this Linux machine, measured; it proves no containment elsewhere.
// bun scripts/linux-scope-probe.ts [case ...], each case printing one JSON line:
//   codex-close-tracker, codex-close-scope: a real Codex app-server (SEISMIC_CODEX, or `codex` on the
//     PATH; no model turn, no login needed) starts four Python heartbeats with `thread/shellCommand`
//     (in the shell's group; in a session of its own; the same with a launcher that exits after 1.5 s;
//     the same with a launcher that exits at once), then the session ends: through today's tracker
//     alone, or with the app-server in a scope (scripts/linux-scope-prototype.ts) that is then killed.
//   codex-host-death-tracker, codex-host-death-scope: the same, but the process holding the transport
//     (Seismic's stand-in) is SIGKILLed; with a scope, a sweep then ends the scope by name.
//   breakaway: an agent in a scope tries the ways out an unprivileged process has.
//   nested: the caller itself in a scope, or a service, as when Seismic is started from a desktop
//     terminal or as a user service; what ending the caller's unit does to a session's scope.
//   kill: a scope with one sleep, ended; says whether by cgroup.kill or by systemctl (read-only cgroupfs).
// An unrelated canary runs throughout; everything the probe started is ended at the end of each case.
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { codexConnection } from '../src/server/codex-rpc';
import { killScope, launchInScope, members } from './linux-scope-prototype';

const read = (file: string) => { try { return readFileSync(file, 'utf8').trim(); } catch { return ''; } };
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const cgroupOf = (pid: number) => read(`/proc/${pid}/cgroup`).replace(/^0::/, '') || null;
const looksLike = (pid: number, what: string) => read(`/proc/${pid}/cmdline`).includes(what);
const until = async (check: () => boolean, ms = 30_000) => { const end = Date.now() + ms; while (!check() && Date.now() < end) await Bun.sleep(50); return check(); };
const unitCgroup = (unit: string) => spawnSync('systemctl', ['--user', 'show', '-P', 'ControlGroup', unit], { encoding: 'utf8' }).stdout.trim();

const JOBS = ['same', 'detached', 'late', 'fast'] as const;
const JOB = `import os, sys, time
from pathlib import Path
name = sys.argv[1]
def beat():
    Path(name + '.pid').write_text(str(os.getpid()))
    n = 0
    while True:
        n += 1
        Path(name + '.tick').write_text(str(n))
        time.sleep(0.1)
if name == 'same':
    beat()
elif os.fork() == 0:
    os.setsid()
    beat()
elif name == 'detached':
    os.wait()
elif name == 'late':
    time.sleep(1.5)  # the launcher exits; the job keeps running with a parent that is gone
`;

const [mode, dir, kind] = process.argv.slice(2);
if (mode === 'driver') {
  // Seismic's stand-in: holds the transport, ends the session the way the case says
  const repo = join(dir!, 'repo');
  const codex = (process.env.SEISMIC_CODEX ?? process.env.OBEYA_CODEX) ?? Bun.which('codex');
  if (!codex) throw new Error('codex is not installed');
  const scoped = kind!.endsWith('-scope');
  const unit = `obeya-probe-${randomUUID()}.scope`;
  const app = [codex, 'app-server', '--listen', 'stdio://'];
  const [command, ...args] = scoped ? [Bun.which('systemd-run')!, '--user', '--scope', '--quiet', '--collect', `--unit=${unit}`, '--', ...app] : app;
  const c = codexConnection({ command: command!, args, cwd: repo, env: { ...process.env } }, { notification() {}, request: async () => ({}) });
  writeFileSync(join(dir!, 'agent.pid'), String(c.pid));
  await c.request('initialize', { clientInfo: { name: 'obeya-probe', title: 'Seismic probe', version: '0' }, capabilities: { experimentalApi: true } });
  c.notify('initialized', {});
  if (scoped) writeFileSync(join(dir!, 'scope.json'), JSON.stringify({ unit, cgroup: unitCgroup(unit) }));
  const started = await c.request<{ thread: { id: string } }>('thread/start', { cwd: repo, approvalPolicy: 'never', sandbox: 'danger-full-access' });
  await c.request('thread/shellCommand', { threadId: started.thread.id, command: JOBS.map((j) => `python3 job.py ${j} &`).join(' ') + ' wait' });
  await Bun.sleep(2500); // the tracker samples every 500 ms
  writeFileSync(join(dir!, 'ready'), '1');
  if (kind!.startsWith('codex-close')) {
    // the probe looks at the jobs first
    while (!existsSync(join(dir!, 'go'))) await Bun.sleep(50);
    c.close();
    await c.done.catch(() => {});
    // what an integration would do once the transport is done: end whatever is still in the scope
    if (scoped) { const { cgroup } = JSON.parse(read(join(dir!, 'scope.json'))); writeFileSync(join(dir!, 'killed'), killScope(unit, cgroup)); }
    process.exit(0);
  }
  await Bun.sleep(120_000);
  process.exit(1);
}

function jobState(repo: string, pids: Record<string, number>) {
  return Object.fromEntries(JOBS.map((j) => [j, { alive: pids[j] ? alive(pids[j]!) : null, ticks: Number(read(join(repo, `${j}.tick`))) || 0, cgroup: pids[j] && alive(pids[j]!) ? cgroupOf(pids[j]!) : null }]));
}

async function codexCase(kind: string) {
  const dir = mkdtempSync(join(tmpdir(), `obeya-scope-${kind}-`));
  const repo = join(dir, 'repo');
  mkdirSync(repo);
  writeFileSync(join(repo, 'job.py'), JOB);
  const canary = spawn('sleep', ['1000'], { stdio: 'ignore' });
  const driver = spawn(process.execPath, [import.meta.path, 'driver', dir, kind], { stdio: ['ignore', 'inherit', 'inherit'] });
  const driverGone = new Promise<void>((resolve) => driver.once('exit', () => resolve()));
  const pids: Record<string, number> = {};
  let agent = 0;
  let scope: { unit: string; cgroup: string } | undefined;
  try {
    if (!(await until(() => existsSync(join(dir, 'ready'))))) return { kind, status: 'blocked', why: 'no ready file in 30 s' };
    agent = Number(read(join(dir, 'agent.pid')));
    if (existsSync(join(dir, 'scope.json'))) scope = JSON.parse(read(join(dir, 'scope.json')));
    for (const j of JOBS) pids[j] = Number(read(join(repo, `${j}.pid`)));
    const before = jobState(repo, pids);
    if (kind.startsWith('codex-host-death')) process.kill(driver.pid!, 'SIGKILL');
    else writeFileSync(join(dir, 'go'), '1');
    await driverGone;
    await Bun.sleep(3000);
    const after = jobState(repo, pids);
    const result: Record<string, unknown> = { kind, status: 'measured', scope: scope?.unit ?? null, before, after, appServerAlive: alive(agent), canaryAlive: alive(canary.pid!) };
    if (kind.startsWith('codex-close') && scope) result.killedBy = read(join(dir, 'killed'));
    if (kind === 'codex-host-death-scope' && scope) {
      result.scopeMembersBeforeSweep = members(scope.cgroup).length;
      result.sweep = killScope(scope.unit, scope.cgroup);
      await Bun.sleep(1000);
      result.afterSweep = jobState(repo, pids);
      result.appServerAliveAfterSweep = alive(agent);
      result.canaryAliveAfterSweep = alive(canary.pid!);
    }
    return result;
  } finally {
    for (const pid of Object.values(pids)) if (pid && alive(pid) && looksLike(pid, 'job.py')) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
    if (agent && alive(agent) && looksLike(agent, 'app-server')) try { process.kill(agent, 'SIGKILL'); } catch { /* gone */ }
    if (scope) try { killScope(scope.unit, scope.cgroup); } catch { /* reported above */ }
    try { process.kill(driver.pid!, 'SIGKILL'); } catch { /* gone */ }
    canary.kill('SIGKILL');
    await Bun.sleep(200);
    rmSync(dir, { recursive: true, force: true });
  }
}

async function breakaway() {
  const dir = mkdtempSync(join(tmpdir(), 'obeya-scope-breakaway-'));
  const svc = `obeya-escape-${randomUUID()}.service`;
  const escape = `obeya-escape-${randomUUID()}`;
  const canary = spawn('sleep', ['1000'], { stdio: 'ignore' });
  // each way out writes the pid of the process that tried it
  const ways: Record<string, string> = {
    'setsid double fork': `setsid sh -c 'echo $$ > ${dir}/setsid; exec sleep 1000' &`,
    'systemd-run --scope': `systemd-run --user --scope --quiet --collect sh -c 'echo $$ > ${dir}/run-scope; exec sleep 1000' &`,
    // a service's command line is expanded by systemd ($$ would not reach the shell): its pid is read from the manager
    'systemd-run service': `systemd-run --user --quiet --collect --unit=${svc} sleep 1000 && systemctl --user show -P MainPID ${svc} > ${dir}/run-service`,
    // a cgroup of its own beside the scope, in the subtree the user owns
    'cgroup mkdir and move': `sh -c 'g=/sys/fs/cgroup$(dirname $(cut -d: -f3 /proc/self/cgroup))/${escape}; mkdir $g && echo $$ > $g/cgroup.procs 2>${dir}/move-error; echo $$ > ${dir}/move; exec sleep 1000' &`,
  };
  const files: Record<string, string> = { 'setsid double fork': 'setsid', 'systemd-run --scope': 'run-scope', 'systemd-run service': 'run-service', 'cgroup mkdir and move': 'move' };
  const r = await launchInScope('/bin/sh', ['-c', `${Object.values(ways).join('\n')}\nsleep 1000`], { stdio: ['ignore', 'ignore', 'ignore'] });
  if (r.boundary !== 'scope') return { kind: 'breakaway', status: 'blocked', why: r.reason };
  const pids: Record<string, number> = {};
  try {
    await until(() => Object.values(files).every((f) => Number(read(join(dir, f))) > 1), 10_000);
    for (const [way, f] of Object.entries(files)) pids[way] = Number(read(join(dir, f)));
    await Bun.sleep(300);
    const where = Object.fromEntries(Object.entries(pids).map(([way, pid]) => [way, cgroupOf(pid)]));
    const killedBy = r.scope.kill();
    await Bun.sleep(1000);
    return {
      kind: 'breakaway', status: 'measured', scope: r.scope.cgroup, killedBy,
      ways: Object.fromEntries(Object.entries(pids).map(([way, pid]) => [way, { cgroupBefore: where[way], inScope: where[way] === r.scope.cgroup, survivesScopeKill: alive(pid) }])),
      moveError: read(join(dir, 'move-error')) || null,
      canaryAlive: alive(canary.pid!),
    };
  } finally {
    r.scope.kill();
    spawnSync('systemctl', ['--user', 'stop', svc]);
    for (const pid of Object.values(pids)) if (pid > 1 && alive(pid) && looksLike(pid, 'sleep')) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
    await Bun.sleep(200);
    const own = `/sys/fs/cgroup${r.scope.cgroup.replace(/\/[^/]+$/, '')}/${escape}`;
    try { rmdirSync(own); } catch { /* never made */ }
    canary.kill('SIGKILL');
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The caller (Seismic's stand-in) runs in a unit of its own and starts a session scope; then its unit ends. */
async function nested() {
  const out: Record<string, unknown> = { kind: 'nested', status: 'measured' };
  for (const how of ['scope', 'service'] as const) {
    const dir = mkdtempSync(join(tmpdir(), `obeya-scope-nested-${how}-`));
    const outer = `obeya-host-${randomUUID()}.${how}`;
    const caller = `
      import { launchInScope } from ${JSON.stringify(join(import.meta.dir, 'linux-scope-prototype.ts'))};
      import { writeFileSync, readFileSync } from 'node:fs';
      const r = await launchInScope('sleep', ['1000'], { stdio: ['ignore', 'ignore', 'ignore'] });
      if (r.boundary !== 'scope') { writeFileSync(${JSON.stringify(join(dir, 'error'))}, r.reason); process.exit(1); }
      writeFileSync(${JSON.stringify(join(dir, 'session.json'))}, JSON.stringify({ unit: r.scope.unit, cgroup: r.scope.cgroup, agent: r.child.pid, caller: readFileSync('/proc/self/cgroup', 'utf8').trim().replace(/^0::/, '') }));
      setInterval(() => {}, 1000);`;
    const argv = how === 'scope'
      ? ['--user', '--scope', '--quiet', '--collect', `--unit=${outer}`, process.execPath, '-e', caller]
      : ['--user', '--quiet', '--collect', `--unit=${outer}`, `--setenv=PATH=${process.env.PATH}`, process.execPath, '-e', caller];
    const host = spawn('systemd-run', argv, { stdio: 'ignore' });
    let session: { unit: string; cgroup: string; agent: number; caller: string } | undefined;
    try {
      if (!(await until(() => existsSync(join(dir, 'session.json')) || existsSync(join(dir, 'error')), 15_000)) || existsSync(join(dir, 'error'))) {
        out[how] = { status: 'blocked', why: read(join(dir, 'error')) || 'no session in 15 s' };
        continue;
      }
      session = JSON.parse(read(join(dir, 'session.json')));
      // a terminal closing, or `systemctl --user stop obeya`: the caller's unit ends
      spawnSync('systemctl', ['--user', 'stop', outer]);
      await Bun.sleep(1000);
      out[how] = {
        caller: session!.caller, session: session!.cgroup,
        sessionInsideCaller: session!.cgroup.startsWith(`${session!.caller}/`),
        sessionSurvivesCallerStop: alive(session!.agent),
        sweep: killScope(session!.unit, session!.cgroup),
      };
      await Bun.sleep(300);
      (out[how] as Record<string, unknown>).goneAfterSweep = !alive(session!.agent);
    } finally {
      spawnSync('systemctl', ['--user', 'stop', outer]);
      host.kill('SIGKILL');
      if (session) try { killScope(session.unit, session.cgroup); } catch { /* reported */ }
      rmSync(dir, { recursive: true, force: true });
    }
  }
  return out;
}

async function killCase() {
  const r = await launchInScope('sleep', ['1000'], { stdio: ['ignore', 'ignore', 'pipe'] });
  if (r.boundary !== 'scope') return { kind: 'kill', status: 'unavailable', why: r.reason };
  let killedBy: string;
  try { killedBy = r.scope.kill(); } catch (error) { return { kind: 'kill', status: 'failed', why: String(error) }; }
  await until(() => !alive(r.child.pid!), 5000);
  return { kind: 'kill', status: 'measured', killedBy, gone: !alive(r.child.pid!) };
}

const all = ['codex-close-tracker', 'codex-close-scope', 'codex-host-death-tracker', 'codex-host-death-scope', 'breakaway', 'nested', 'kill'];
const wanted = process.argv.slice(2).length ? process.argv.slice(2) : all;
for (const kind of wanted) {
  const result = kind.startsWith('codex-') ? await codexCase(kind) : kind === 'breakaway' ? await breakaway() : kind === 'nested' ? await nested() : await killCase();
  console.log(JSON.stringify(result));
}
