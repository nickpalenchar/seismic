






import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { codexConnection, endSessionsHere } from '../src/server/llms/harnesses/codexRpc';

const read = (file: string) => { try { return readFileSync(file, 'utf8').trim(); } catch { return ''; } };
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

const looksLike = (pid: number, what: string) => Bun.spawnSync(['ps', '-o', 'command=', '-p', String(pid)]).stdout.toString().includes(what);
const JOBS = ['same', 'detached', 'late'] as const;
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
else:
    if os.fork() == 0:
        os.setsid()
        beat()
    elif name == 'detached':
        os.wait()
    else:
        time.sleep(1.5)  # the launcher exits; the job keeps running with a parent that is gone
`;

const [mode, dir, kind] = process.argv.slice(2);
if (mode === 'driver') {
  const repo = join(dir!, 'repo');
  const codex = Bun.which((process.env.SEISMIC_CODEX ?? process.env.OBEYA_CODEX) ?? 'codex');
  if (!codex) throw new Error('codex is not installed');
  const c = codexConnection({ command: codex, args: ['app-server', '--listen', 'stdio://'], cwd: repo, env: { ...process.env } }, { notification() {}, request: async () => ({}) });
  writeFileSync(join(dir!, 'agent.pid'), String(c.pid));
  await c.request('initialize', { clientInfo: { name: 'seismic-probe', title: 'Seismic probe', version: '0' }, capabilities: { experimentalApi: true } });
  c.notify('initialized', {});
  const started = await c.request<{ thread: { id: string } }>('thread/start', { cwd: repo, approvalPolicy: 'never', sandbox: 'danger-full-access' });
  await c.request('thread/shellCommand', { threadId: started.thread.id, command: JOBS.map((j) => `python3 job.py ${j} &`).join(' ') + ' wait' });
  await Bun.sleep(2500); 
  writeFileSync(join(dir!, 'ready'), '1');
  if (kind === 'graceful') { await endSessionsHere(); process.exit(0); }
  if (kind === 'forced') { await endSessionsHere(true); process.exit(0); }
  await Bun.sleep(60_000);
  process.exit(1);
}

async function run(kind: string) {
  const dir = mkdtempSync(join(tmpdir(), `seismic-lifecycle-${kind}-`));
  const repo = join(dir, 'repo');
  mkdirSync(repo);
  writeFileSync(join(repo, 'job.py'), JOB);
  const canary = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
  const driver = spawn(process.execPath, [import.meta.path, 'driver', dir, kind], { stdio: 'inherit' });
  
  const driverGone = new Promise<void>((resolve) => driver.once('exit', () => resolve()));
  const pids: Record<string, number> = {};
  let agent = 0;
  try {
    const end = Date.now() + 30_000;
    while (Date.now() < end && !existsSync(join(dir, 'ready'))) await Bun.sleep(100);
    if (!existsSync(join(dir, 'ready'))) return { kind, status: 'blocked', why: 'no ready file in 30 s (is Codex logged in?)' };
    agent = Number(read(join(dir, 'agent.pid')));
    for (const j of JOBS) pids[j] = Number(read(join(repo, `${j}.pid`)));
    const before = Object.fromEntries(JOBS.map((j) => [j, Number(read(join(repo, `${j}.tick`)))]));
    const started = Date.now();
    if (kind === 'agent-death') process.kill(agent, 'SIGKILL');
    if (kind === 'host-death') process.kill(driver.pid!, 'SIGKILL');
    if (kind === 'graceful' || kind === 'forced') await driverGone;
    const stoppedIn = Date.now() - started;
    await Bun.sleep(3500);
    const ticks = Object.fromEntries(JOBS.map((j) => [j, Number(read(join(repo, `${j}.tick`)))]));
    return {
      kind, status: 'measured', stoppedInMs: stoppedIn,
      jobs: Object.fromEntries(JOBS.map((j) => [j, { pid: pids[j], alive: pids[j] ? alive(pids[j]!) : null, ticksBefore: before[j], ticksAfter: ticks[j] }])),
      appServerAlive: agent ? alive(agent) : null, driverAlive: alive(driver.pid!), canaryAlive: alive(canary.pid!),
    };
  } finally {
    
    for (const pid of Object.values(pids)) if (pid && alive(pid) && looksLike(pid, 'job.py')) try { process.kill(pid, 'SIGKILL'); } catch {  }
    if (agent && alive(agent) && looksLike(agent, 'app-server')) { try { process.kill(-agent, 'SIGKILL'); } catch {  } try { process.kill(agent, 'SIGKILL'); } catch {  } }
    try { process.kill(driver.pid!, 'SIGKILL'); } catch {  }
    try { canary.kill('SIGKILL'); } catch {  }
    await Bun.sleep(200);
    rmSync(dir, { recursive: true, force: true });
  }
}

const wanted = process.argv.slice(2).length ? process.argv.slice(2) : ['graceful', 'forced', 'agent-death', 'host-death'];
for (const kind of wanted) console.log(JSON.stringify(await run(kind)));
