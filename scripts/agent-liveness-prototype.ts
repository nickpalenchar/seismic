







import { spawn } from 'node:child_process';
import { createReadStream, writeSync } from 'node:fs';
import { AgentProcesses } from '../src/server/llms/harnesses/processes';
import { createGeneration, processIdentity, type ProcessIdentity } from './agent-registry-prototype';


const argv = process.argv.slice(2);
if (process.platform === 'win32' || !argv.length) {
  console.error('POSIX prototype: provide a private liveness pipe on fd 3 and a command after --');
  process.exit(2);
}



const registryRoot = (process.env.SEISMIC_PROTO_REGISTRY ?? process.env.OBEYA_PROTO_REGISTRY);
let registry: ReturnType<typeof createGeneration> | undefined;
if (registryRoot) {
  try {
    const self = processIdentity(process.pid);
    if (!self) throw new Error('Linux supervisor identity unavailable');
    registry = createGeneration(registryRoot, self);
    console.error(`registry-generation:${registry.id}`);
  } catch (error) { console.error('registry startup:', error); process.exit(1); }
}
const reportFd = (process.env.SEISMIC_LIVENESS_REPORT_FD ?? process.env.OBEYA_LIVENESS_REPORT_FD) ? Number((process.env.SEISMIC_LIVENESS_REPORT_FD ?? process.env.OBEYA_LIVENESS_REPORT_FD)) : undefined;
const env = { ...process.env };
delete env.SEISMIC_PROTO_REGISTRY;
delete env.OBEYA_PROTO_REGISTRY;
delete env.SEISMIC_LIVENESS_REPORT_FD;
delete env.OBEYA_LIVENESS_REPORT_FD;


const child = spawn('/bin/sh', ['-c', 'IFS= read -r gate <&3 || exit 125; exec 3<&-; exec "$@"', 'seismic-gate', ...argv], {
  stdio: ['inherit', 'inherit', 'inherit', 'pipe'], detached: true, env,
});
const tracker = child.pid ? new AgentProcesses(child.pid) : undefined;
let cleaning: Promise<void> | undefined;
let failed = false;
let timer: ReturnType<typeof setInterval> | undefined;
const recorded = new Map<string, ProcessIdentity>();
const reported = new Set<string>();

async function snapshot() {
  if (!tracker) return;
  await tracker.track();
  if (reportFd !== undefined) for (const observed of tracker.observed()) {
    const key = `${observed.pid}:${observed.born}`;
    if (reported.has(key)) continue;
    writeSync(reportFd, `${JSON.stringify(observed)}\n`);
    reported.add(key);
  }
  if (!registry) return;
  let changed = false;
  for (const observed of tracker.observed()) {
    const current = processIdentity(observed.pid);
    
    if (!current || current.start !== observed.born) continue;
    const key = `${current.pid}:${current.start}`;
    if (!recorded.has(key)) { recorded.set(key, current); changed = true; }
  }
  if (changed) registry.publish([...recorded.values()]);
}

function cleanup() {
  return cleaning ??= ending();
}

async function ending() {
  if (timer) clearInterval(timer);
  try { await snapshot(); } catch (e) { failed = true; console.error('liveness snapshot:', e); }
  try { await tracker?.kill(); } catch (e) { failed = true; console.error('liveness cleanup:', e); }
  
  
  
  
  if (child.pid) try { process.kill(-child.pid, 'SIGKILL'); } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ESRCH') { failed = true; console.error('agent group kill:', e); }
  }
  
  if (child.exitCode === null && child.signalCode === null) {
    try { child.kill('SIGKILL'); } catch (e) { failed = true; console.error('agent kill:', e); }
  }
}

const pipe = createReadStream('', { fd: 3, autoClose: true });
pipe.on('data', () => {}); 
pipe.on('end', () => void cleanup());
pipe.on('error', (e) => { failed = true; console.error('liveness pipe:', e); void cleanup(); });
child.on('error', (e) => { failed = true; console.error('agent spawn:', e); void cleanup(); });
child.on('exit', () => { void cleanup(); pipe.destroy(); });
child.on('close', async (code) => {
  pipe.destroy();
  await cleanup();
  try { registry?.close(); } catch (e) { failed = true; console.error('registry close:', e); }
  
  
  process.exit(failed ? 1 : code ?? 1);
});
try {
  if (!tracker) throw new Error('Cannot establish agent process ownership');
  await snapshot();
  if (registry && ![...recorded.values()].some((p) => p.pid === child.pid)) throw new Error('Cannot record agent identity');
  const gate = child.stdio[3];
  if (!gate || !('end' in gate)) throw new Error('Cannot open launch gate');
  gate.on('error', (e) => { failed = true; console.error('launch gate:', e); cleanup(); });
  gate.end('go\n');
  
  let sampling = false;
  timer = setInterval(() => {
    if (sampling || cleaning) return;
    sampling = true;
    snapshot().catch((e: unknown) => { failed = true; console.error('liveness snapshot:', e); void cleanup(); }).finally(() => { sampling = false; });
  }, 100);
} catch (e) { failed = true; console.error('liveness startup:', e); void cleanup(); }
