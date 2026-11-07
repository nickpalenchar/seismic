// What a Job Object holds on this Windows machine, measured; it proves no containment elsewhere.
// bun scripts/windows-job-probe.ts [case ...], each case printing one JSON line:
//   codex-close-tracker, codex-close-job: a real Codex app-server (SEISMIC_CODEX, or `codex` on the
//     PATH; no model turn, no login needed) starts Python heartbeats with `thread/shellCommand`: one
//     in the shell's tree, and three started detached (DETACHED_PROCESS, a process group of their
//     own) by launchers that stay, exit after 1.5 s, or exit at once. Then the session ends: through
//     today's tracker alone (agent-processes.ts, taskkill /T), or with the app-server in a job
//     (scripts/windows-job-prototype.ts) that is then terminated.
//   codex-host-death-tracker, codex-host-death-job: the same, but the process holding the transport
//     (Seismic's stand-in) is killed; the job's kill-on-close is all that runs.
//   escapes: an agent in a job tries the ways out an unprivileged process has.
// Also says whether the probe itself already runs in a job (a terminal's, the CI runner's), in which
// case every job it makes is nested. An unrelated canary runs throughout; everything the probe
// started is ended at the end of each case.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { codexConnection } from '../src/server/codex-rpc';
import { assign, createJob, inAnyJob, inJob, launchInJob } from './windows-job-prototype';

const read = (file: string) => { try { return readFileSync(file, 'utf8').trim(); } catch { return ''; } };
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const until = async (check: () => boolean, ms = 60_000) => { const end = Date.now() + ms; while (!check() && Date.now() < end) await Bun.sleep(100); return check(); };
// a file a just-ended process held can stay locked a moment longer
const remove = (dir: string) => { try { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch (error) { console.error(`left ${dir}: ${error}`); } };
const taskkill = (pid: number) => spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
const python = (process.env.SEISMIC_PYTHON ?? process.env.OBEYA_PYTHON) ?? 'python';

const JOBS = ['same', 'detached', 'late', 'fast'] as const;
const JOB = `import os, sys, time, subprocess
from pathlib import Path
name = sys.argv[1]
DETACHED = 0x00000008 | 0x00000200  # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
def beat(n):
    Path(n + '.pid').write_text(str(os.getpid()))
    i = 0
    while True:
        i += 1
        Path(n + '.tick').write_text(str(i))
        time.sleep(0.1)
if name == 'launch':
    for j in ['detached', 'late', 'fast']:
        subprocess.Popen([sys.executable, 'job.py', 'launcher-' + j])
    beat('same')
elif name.startswith('launcher-'):
    j = name[len('launcher-'):]
    subprocess.Popen([sys.executable, 'job.py', 'beat-' + j], creationflags=DETACHED)
    if j == 'detached':
        time.sleep(10 ** 6)
    elif j == 'late':
        time.sleep(1.5)
elif name.startswith('beat-'):
    beat(name[len('beat-'):])
`;

const [mode, dir, kind] = process.argv.slice(2);
if (mode === 'driver') {
  const repo = join(dir!, 'repo');
  const codex = (process.env.SEISMIC_CODEX ?? process.env.OBEYA_CODEX) ?? Bun.which('codex');
  if (!codex) throw new Error('codex is not installed');
  const inJobCase = kind!.endsWith('-job');
  const made = inJobCase ? createJob() : undefined;
  const app = [codex, 'app-server', '--listen', 'stdio://'];
  const [command, ...args] = made ? [process.execPath, join(import.meta.dir, 'windows-job-prototype.ts'), 'gate', made.job.name, ...app] : app;
  const c = codexConnection({ command: command!, args, cwd: repo, env: { ...process.env, ...(made ? { BUN_BE_BUN: '1' } : {}) } }, { notification() {}, request: async () => ({}) });
  if (made) assign(made.handle, c.pid!);
  writeFileSync(join(dir!, 'agent.pid'), String(c.pid));
  await c.request('initialize', { clientInfo: { name: 'obeya-probe', title: 'Seismic probe', version: '0' }, capabilities: { experimentalApi: true } });
  c.notify('initialized', {});
  const started = await c.request<{ thread: { id: string } }>('thread/start', { cwd: repo, approvalPolicy: 'never', sandbox: 'danger-full-access' });
  await c.request('thread/shellCommand', { threadId: started.thread.id, command: `${python} job.py launch` });
  await until(() => JOBS.every((j) => existsSync(join(repo, `${j}.pid`))), 30_000);
  await Bun.sleep(3000); // the tracker samples every 500 ms, through PowerShell
  if (made) writeFileSync(join(dir!, 'job.json'), JSON.stringify({ name: made.job.name, members: made.job.members().length }));
  writeFileSync(join(dir!, 'ready'), '1');
  if (kind!.startsWith('codex-close')) {
    while (!existsSync(join(dir!, 'go'))) await Bun.sleep(50);
    c.close();
    await c.done.catch(() => {});
    if (made) { made.job.kill(); writeFileSync(join(dir!, 'killed'), 'TerminateJobObject'); }
    process.exit(0);
  }
  await Bun.sleep(300_000);
  process.exit(1);
}

function jobState(repo: string, pids: Record<string, number>, job?: string) {
  return Object.fromEntries(JOBS.map((j) => [j, { alive: pids[j] ? alive(pids[j]!) : null, ticks: Number(read(join(repo, `${j}.tick`))) || 0, ...(job ? { inJob: pids[j] && alive(pids[j]!) ? inJob(job, pids[j]) : null } : {}) }]));
}

async function codexCase(kind: string) {
  const dir = mkdtempSync(join(tmpdir(), `obeya-job-${kind}-`));
  const repo = join(dir, 'repo');
  mkdirSync(repo);
  writeFileSync(join(repo, 'job.py'), JOB);
  const canary = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore', windowsHide: true });
  const driver = spawn(process.execPath, [import.meta.path, 'driver', dir, kind], { stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true });
  const driverGone = new Promise<void>((resolve) => driver.once('exit', () => resolve()));
  const pids: Record<string, number> = {};
  let agent = 0;
  try {
    if (!(await until(() => existsSync(join(dir, 'ready')), 120_000))) return { kind, status: 'blocked', why: 'no ready file in 120 s' };
    agent = Number(read(join(dir, 'agent.pid')));
    const job = existsSync(join(dir, 'job.json')) ? JSON.parse(read(join(dir, 'job.json'))) as { name: string; members: number } : undefined;
    for (const j of JOBS) pids[j] = Number(read(join(repo, `${j}.pid`)));
    const before = jobState(repo, pids, job?.name);
    if (kind.startsWith('codex-host-death')) driver.kill(); // TerminateProcess: no cleanup of its own
    else writeFileSync(join(dir, 'go'), '1');
    await driverGone;
    await Bun.sleep(3000);
    return {
      kind, status: 'measured', job: job ?? null, before, after: jobState(repo, pids),
      agentAlive: alive(agent), canaryAlive: alive(canary.pid!), ...(kind.startsWith('codex-close') && job ? { killedBy: read(join(dir, 'killed')) } : {}),
    };
  } finally {
    for (const pid of Object.values(pids)) if (pid && alive(pid)) taskkill(pid);
    if (agent && alive(agent)) taskkill(agent);
    driver.kill();
    canary.kill();
    await Bun.sleep(500);
    remove(dir);
  }
}

async function escapes() {
  const dir = mkdtempSync(join(tmpdir(), 'obeya-job-escapes-'));
  const task = `obeya-escape-${process.pid}`;
  const canary = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore', windowsHide: true });
  // paths and names come by the environment, so no Windows path is quoted in code within code
  const agent = `
    const { spawn, spawnSync } = require('node:child_process');
    const fs = require('node:fs');
    const path = require('node:path');
    const dir = (process.env.SEISMIC_ESC_DIR ?? process.env.OBEYA_ESC_DIR), task = (process.env.SEISMIC_ESC_TASK ?? process.env.OBEYA_ESC_TASK), python = (process.env.SEISMIC_ESC_PYTHON ?? process.env.OBEYA_ESC_PYTHON);
    const beat = (file) => python + ' -c "import os,time,pathlib; pathlib.Path(r\\'' + path.join(dir, file) + '\\').write_text(str(os.getpid())); time.sleep(1000)"';
    const log = (name, r) => fs.writeFileSync(path.join(dir, name), [r.status, r.stdout, r.stderr, r.error].join(' | '));
    const c = spawn(process.execPath, ['-e', 'require("node:fs").writeFileSync((process.env.SEISMIC_ESC_DIR ?? process.env.OBEYA_ESC_DIR) + "/detached", String(process.pid)); setInterval(()=>{},1000)'], { detached: true, stdio: 'ignore', windowsHide: true }); c.unref();
    spawn('cmd.exe /d /c start "" /b ' + beat('cmd-start'), { shell: true, stdio: 'ignore', windowsHide: true });
    log('wmi-result', spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '(Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{CommandLine=$env:SEISMIC_ESC_CMD}).ProcessId'], { encoding: 'utf8', windowsHide: true, env: { ...process.env, SEISMIC_ESC_CMD: beat('wmi-inner') } }));
    const st = spawnSync('schtasks.exe', ['/Create', '/F', '/TN', task, '/SC', 'ONCE', '/ST', '23:59', '/TR', beat('task')], { encoding: 'utf8', windowsHide: true });
    const run = spawnSync('schtasks.exe', ['/Run', '/TN', task], { encoding: 'utf8', windowsHide: true });
    log('task-result', { status: [st.status, run.status].join(','), stdout: st.stdout + run.stdout, stderr: st.stderr + run.stderr });
    setInterval(() => {}, 1000);`;
  const r = await launchInJob(process.execPath, ['-e', agent], { stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, SEISMIC_ESC_DIR: dir, SEISMIC_ESC_TASK: task, SEISMIC_ESC_PYTHON: python } });
  if (r.boundary !== 'job') return { kind: 'escapes', status: 'blocked', why: r.reason };
  let stderr = '';
  r.child.stderr!.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
  const files = { 'detached spawn': 'detached', 'cmd start /b': 'cmd-start', 'WMI Win32_Process.Create': 'wmi-inner', 'task scheduler': 'task' };
  const pids: Record<string, number> = {};
  try {
    await until(() => existsSync(join(dir, 'task-result')), 60_000);
    await until(() => Object.values(files).every((f) => existsSync(join(dir, f))), 20_000);
    for (const [way, f] of Object.entries(files)) pids[way] = Number(read(join(dir, f)));
    const where = Object.fromEntries(Object.entries(pids).map(([way, pid]) => [way, pid ? inJob(r.job.name, pid) : null]));
    r.job.kill();
    await Bun.sleep(1500);
    return {
      kind: 'escapes', status: 'measured',
      ways: Object.fromEntries(Object.entries(pids).map(([way, pid]) => [way, pid ? { inJob: where[way], survivesJobKill: alive(pid) } : { started: false }])),
      wmi: read(join(dir, 'wmi-result')).slice(0, 300), task: read(join(dir, 'task-result')).slice(0, 300), agentStderr: stderr.slice(0, 500),
      canaryAlive: alive(canary.pid!),
    };
  } finally {
    r.job.kill();
    r.job.close();
    spawnSync('schtasks.exe', ['/Delete', '/F', '/TN', task], { stdio: 'ignore', windowsHide: true });
    for (const pid of Object.values(pids)) if (pid && alive(pid)) taskkill(pid);
    canary.kill();
    await Bun.sleep(500);
    remove(dir);
  }
}

console.log(JSON.stringify({ kind: 'environment', probeInAJob: inAnyJob(), os: spawnSync('cmd.exe', ['/d', '/c', 'ver'], { encoding: 'utf8' }).stdout.trim() }));
const all = ['codex-close-tracker', 'codex-close-job', 'codex-host-death-tracker', 'codex-host-death-job', 'escapes'];
const wanted = process.argv.slice(2).length ? process.argv.slice(2) : all;
for (const kind of wanted) console.log(JSON.stringify(kind === 'escapes' ? await escapes() : await codexCase(kind)));
