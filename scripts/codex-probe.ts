// Native Codex spike, deliberately independent of main.ts and the owner's running Seismic.
// bun scripts/codex-probe.ts [model] — uses the installed Codex login and bills model turns.
// Keeps its scratch directory (printed at startup) for inspection; never commits or uses ~/.obeya.
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { codexRuntime } from '../src/server/codex-runtime';
import type { AgentEvent, AgentSession, AgentSpec } from '../src/server/runtime';
import { spawnOutput } from '../src/server/spawn';

const root = mkdtempSync(join(tmpdir(), 'obeya-codex-probe-'));
const cwd = join(root, 'repo');
mkdirSync(cwd);
const git = await spawnOutput(['git', 'init', '--quiet', '--template=', cwd]);
if (git.code) throw new Error(git.stderr);
console.log(`Scratch: ${root}`);
let session: AgentSession | undefined;
let sessionId: string | undefined;
let steeringSent = false;
let question = false;
let artifact = false;
let artifactPath: string | undefined;
let resumedTool = false;
const events: AgentEvent[] = [];
const waiters = new Set<() => void>();
function waitFor(check: () => boolean, label: string, timeout = 180_000): Promise<void> {
  if (check()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { waiters.delete(tick); reject(new Error(`Timed out: ${label}`)); }, timeout);
    const tick = () => {
      const error = events.find((e) => e.type === 'error');
      if (error?.type === 'error') { clearTimeout(timer); waiters.delete(tick); reject(new Error(error.message)); }
      else if (check()) { clearTimeout(timer); waiters.delete(tick); resolve(); }
    };
    waiters.add(tick);
  });
}
function idleSince(index: number) { return events.slice(index).some((e) => e.type === 'idle' && !e.background && !e.more); }
const spec: AgentSpec = {
  cwd,
  env: { SEISMIC_HOME: join(root, 'home') },
  ...(process.argv[2] ? { model: process.argv[2] } : {}),
  system: 'You are exercising the Seismic native Codex adapter in a disposable repository. Use the Seismic tools to report, ask questions and hand over. When ask or ready_for_review returns, end your turn. Follow the exact probe steps, no commits.',
  tools: [
    { name: 'report', description: 'Report progress.', schema: { message: z.string() }, run: ({ message }) => {
      console.log(`REPORT ${String(message)}`);
      if (!steeringSent) {
        steeringSent = true;
        session!.send('Append exactly STEERED followed by a newline to result.txt. This is a live owner message. Then use the Seismic ask tool to ask which color to use, and end the turn after ask.');
      } else if (artifact) resumedTool = true;
      return 'Progress recorded.';
    } },
    { name: 'ask', description: 'Ask the owner a question, then end the turn.', schema: { question: z.string() }, run: ({ question: text }) => { question = true; console.log(`ASK ${String(text)}`); return 'Question recorded. End this turn and wait for the owner response.'; } },
    { name: 'ready_for_review', description: 'Hand an artifact to the owner, then end the turn.', schema: { path: z.string() }, run: ({ path }) => { artifact = true; artifactPath = String(path); console.log(`ARTIFACT ${String(path)}`); return 'Artifact recorded. End this turn and wait for review.'; } },
  ],
  askOwner: async (request) => { console.log(`DENY ${request.name} ${JSON.stringify(request.input)}`); return { allow: false, message: 'Probe refuses permissions outside its workspace' }; },
  onEvent: (event) => {
    events.push(event);
    if (event.type === 'session') sessionId = event.id;
    if (event.type === 'text') process.stdout.write(event.text);
    else console.log(`\n${JSON.stringify(event)}`);
    for (const tick of [...waiters]) tick();
  },
};
const interrupted = () => { session?.close(); };
process.on('SIGINT', interrupted);
process.on('SIGTERM', interrupted);
try {
  session = codexRuntime.start(spec, 'Create result.txt containing exactly START followed by a newline. Call report once with a short status. Then read result.txt to verify it and summarize the result.');
  await waitFor(() => question && idleSince(0), 'file edit, live steering, question and idle');
  if (readFileSync(join(cwd, 'result.txt'), 'utf8') !== 'START\nSTEERED\n') throw new Error('The live steering instruction was not applied exactly');
  const next = events.length;
  session.send('The color is blue. Create artifact.html with an h1 heading saying Codex native Seismic probe, styled with color: blue. Use ready_for_review with path artifact.html, then end the turn.');
  await waitFor(() => artifact && idleSince(next), 'owner response and artifact handover');
  if (!artifactPath || resolve(cwd, artifactPath) !== join(cwd, 'artifact.html')) throw new Error('The handed-over path is not the requested artifact');
  const html = readFileSync(resolve(cwd, artifactPath), 'utf8');
  if (!html.includes('Codex native Seismic probe') || !/color\s*:\s*blue/i.test(html) || !/<h1\b/i.test(html)) throw new Error('Artifact does not reflect the owner reply (blue heading)');
  if (!sessionId) throw new Error('No resumable session id');
  session.close();
  await session.done;
  const resume = events.length;
  session = codexRuntime.start({ ...spec, resume: sessionId }, 'Append exactly RESUMED followed by a newline to result.txt. Then call the Seismic report tool with message resumed. End the turn.');
  await waitFor(() => resumedTool && idleSince(resume), 'subprocess restart, resume and restored tool');
  if (readFileSync(join(cwd, 'result.txt'), 'utf8') !== 'START\nSTEERED\nRESUMED\n') throw new Error('Resumed file edit missing');
  console.log('\nPASS: edit, Seismic tool, active-turn message, ask/reply, HTML handover, process restart/resume and persisted tool.');
  console.log('Not a full canvas acceptance test: permissions, background command cleanup, trust and card lifecycle remain rollout gates.');
} finally {
  session?.close();
  await session?.done;
  process.off('SIGINT', interrupted);
  process.off('SIGTERM', interrupted);
}
