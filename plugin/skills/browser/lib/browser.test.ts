import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { testProcessCode } from '../../../../src/test-process';
import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { alive, sessionPid, stateFile } from './browser.ts';

// Real browsers, run with plain Node as the skill's commands are; each start takes about a second.
const SCRIPT = join(import.meta.dir, 'browser.ts');

let dir: string;
let sessions: ChildProcess[];
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'obeya-browser-test-'));
  sessions = [];
});
afterEach(() => {
  for (const s of sessions) s.kill();
  rmSync(dir, { recursive: true, force: true });
});

/** A stand-in for a Claude Code session's process: the browser lives as long as it does. */
function session(): number {
  const s = spawn(process.execPath, ['-e', testProcessCode()], { stdio: 'ignore' });
  sessions.push(s);
  return s.pid!;
}

/** The skill's command in a session, with the temp directory of this test for its state. */
async function browser(pid: number | null, ...args: string[]): Promise<string> {
  // SEISMIC_AGENT_PID of the worker running these tests (a Codex worker sets it) would take precedence over this session's CLAUDE_PID
  const env: Record<string, string | undefined> = { ...process.env, TMPDIR: dir, TEMP: dir, TMP: dir, SEISMIC_AGENT_PID: undefined, OBEYA_AGENT_PID: undefined, CLAUDE_PID: pid ? String(pid) : undefined };
  // not spawnSync: a page this test serves has to be answered while the command waits for it
  const p = Bun.spawn(['node', SCRIPT, ...args], { env, stdout: 'pipe', stderr: 'pipe' });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (code !== 0) throw new Error(`${args[0]} failed: ${err}${out}`);
  return out.trim();
}

const state = (pid: number) => join(dir, 'obeya-browser', `${pid}.json`);
const readState = (pid: number) => JSON.parse(readFileSync(state(pid), 'utf8')) as { port: number; pid: number; owner: number };

async function until(check: () => boolean | Promise<boolean>, ms = 10_000) {
  const deadline = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('timed out');
    await Bun.sleep(100);
  }
}

const answers = (port: number) =>
  fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) }).then(
    (r) => r.ok,
    () => false,
  );

/** The command line of the browser the process `holder` launched (POSIX `ps`; chrome://version is empty in Playwright's headless shell). */
function browserCommand(holder: number): string {
  const ps = Bun.spawnSync(['ps', '-A', '-o', 'ppid=,args=']).stdout.toString();
  return ps.split('\n').find((line) => line.trim().startsWith(`${holder} `) && line.includes('--remote-debugging-port')) ?? '';
}

/** A mono 16-bit WAV of a 440 Hz tone. */
function tone(file: string, seconds = 1, rate = 48_000) {
  const samples = seconds * rate;
  const buf = Buffer.alloc(44 + samples * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + samples * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 16_000), 44 + i * 2);
  writeFileSync(file, buf);
}

test('portable agent identity isolates browsers and takes precedence over Claude identity', () => {
  expect(sessionPid({ OBEYA_AGENT_PID: '123', CLAUDE_PID: '456' })).toBe(123);
  expect(sessionPid({ SEISMIC_AGENT_PID: '789', OBEYA_AGENT_PID: '123' })).toBe(789);
  expect(stateFile({ OBEYA_AGENT_PID: '123' })).toBe(stateFile({ CLAUDE_PID: '123' }));
  expect(stateFile({ OBEYA_AGENT_PID: '123' })).not.toBe(stateFile({ OBEYA_AGENT_PID: '456' }));
  expect(sessionPid({ OBEYA_AGENT_PID: 'invalid' })).toBeNull();
});

const PAGE = `data:text/html,<title>-</title><button id=b style="margin:200px" onclick="this.textContent='clicked '+event.isTrusted">go</button>
<script>addEventListener('keydown', e => document.title = 'down ' + e.code); addEventListener('keyup', e => document.title = 'up ' + e.code)</script>`;

describe('browser skill', () => {
  test('a session drives its own muted browser with trusted input, and it closes with the session', async () => {
    const pid = session();
    expect(await browser(pid, 'start', '--window-size', '1000,700')).toContain('muted');
    const { port, pid: holder } = readState(pid);
    expect(browserCommand(holder)).toContain('--mute-audio');
    // start again in the same session: the same browser
    expect(await browser(pid, 'start')).toContain(`Already running on CDP port ${port}`);

    const tab = await browser(pid, 'open', PAGE);
    expect(await browser(pid, 'tabs')).toContain(tab);
    expect(await browser(pid, 'eval', 'innerWidth')).toBe('1000');
    // a key held with down: stays down until up:, across steps of one input
    const shot = join(dir, 'shot.png');
    const steps = await browser(pid, 'input', 'click:@#b', 'down:Space', 'wait:100', 'eval:document.title', 'up:Space', 'eval:document.title', `shot:${shot}`, '--tab', tab.slice(0, 6));
    expect(steps.split('\n')).toEqual(['down Space', 'up Space', `Screenshot saved to ${shot}.`]);
    expect(await browser(pid, 'text')).toBe('clicked true');
    expect(readFileSync(shot).subarray(1, 4).toString()).toBe('PNG');

    // the session ends: its browser goes with it
    sessions[0]!.kill();
    await until(() => !alive(holder));
    expect(await answers(port)).toBe(false);
    expect(existsSync(state(pid))).toBe(false);
    expect(existsSync(state(pid).replace('.json', '.log'))).toBe(false);
  }, 30_000);

  test('two sessions never share a browser; stop closes only its own', async () => {
    const a = session();
    const b = session();
    await browser(a, 'start');
    await browser(b, 'start');
    const [sa, sb] = [readState(a), readState(b)];
    expect(sa.port).not.toBe(sb.port);
    await browser(a, 'open', 'data:text/html,<p>a</p>');
    await browser(b, 'open', 'data:text/html,<p>b</p>');
    expect(await browser(a, 'text')).toBe('a');
    expect(await browser(b, 'text')).toBe('b');

    expect(await browser(a, 'stop')).toBe('Browser stopped.');
    expect(alive(sa.pid)).toBe(false);
    expect(await answers(sa.port)).toBe(false);
    await expect(browser(a, 'text')).rejects.toThrow('run `start` first');
    expect(await browser(b, 'text')).toBe('b');
    await browser(b, 'stop');
  }, 30_000);

  test("a page's speechSynthesis speaks nothing, from its first script on, in its frames too", async () => {
    const pid = session();
    await browser(pid, 'start');
    // the frame from another site (localhost, not 127.0.0.1) runs in a process of its own
    const server = Bun.serve({
      port: 0,
      fetch: (req) =>
        new Response(
          new URL(req.url).pathname === '/frame'
            ? `<script>parent.postMessage('frame ' + !!speechSynthesis.__silent, '*')</script>`
            : `<button>go</button><script>window.log = ['first ' + !!speechSynthesis.__silent]; addEventListener('message', (e) => log.push(e.data))</script><iframe src="http://localhost:${new URL(req.url).port}/frame"></iframe>`,
          { headers: { 'content-type': 'text/html' } },
        ),
    });
    const tab = await browser(pid, 'open', `http://127.0.0.1:${server.port}/`);
    await until(async () => (await browser(pid, 'eval', 'log.length')) === '2');
    expect(JSON.parse(await browser(pid, 'eval', 'log'))).toEqual(['first true', 'frame true']);
    // spoken after a trusted click, it goes on as if said
    const said = await browser(pid, 'input', 'click:@button', `eval:await new Promise((r) => { const u = new SpeechSynthesisUtterance('Lena'); u.onend = () => r('said'); u.onerror = (e) => r(e.error); speechSynthesis.speak(u) })`, '--tab', tab);
    expect(said).toBe('said');
    await browser(pid, 'nav', 'data:text/html,<p>next</p>', '--tab', tab);
    expect(await browser(pid, 'eval', '!!speechSynthesis.__silent', '--tab', tab)).toBe('true');
    server.stop();
    await browser(pid, 'stop');
  }, 30_000);

  test('a fake microphone plays the WAV into the page', async () => {
    const pid = session();
    const wav = join(dir, 'tone.wav');
    tone(wav);
    await browser(pid, 'start', '--fake-mic', wav);
    // the microphone is only there for a secure context, such as a page from localhost
    const server = Bun.serve({ port: 0, fetch: () => new Response('<p>mic</p>', { headers: { 'content-type': 'text/html' } }) });
    await browser(pid, 'open', `http://127.0.0.1:${server.port}/`);
    // the loudest frequency the page hears: the WAV's tone, not the fake device's own beep
    const heard = await browser(
      pid,
      'eval',
      `const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
       const ctx = new AudioContext(); await ctx.resume();
       const analyser = ctx.createAnalyser(); analyser.fftSize = 4096; ctx.createMediaStreamSource(stream).connect(analyser);
       const bins = new Float32Array(analyser.frequencyBinCount); let peak = -Infinity, at = 0;
       for (let i = 0; i < 20 && peak < -40; i++) {
         await new Promise(r => setTimeout(r, 100)); analyser.getFloatFrequencyData(bins);
         peak = Math.max(...bins); at = bins.indexOf(peak) * ctx.sampleRate / analyser.fftSize;
       }
       at`,
    );
    server.stop();
    expect(Math.abs(Number(heard) - 440)).toBeLessThan(20);
    await browser(pid, 'stop');
  }, 30_000);

  test("playwright names the import of the Playwright it launches with, which a script anywhere runs, and Playwright's WebKit and Firefox", async () => {
    const out = (await browser(null, 'playwright')).split('\n');
    expect(out[0]).toMatch(/^import \{ chromium, firefox, webkit \} from "file:\/\/.+playwright-core\/index\.mjs";$/);
    expect(out.slice(1).map((l) => l.split(':')[0])).toEqual(['webkit', 'firefox']);
    // a script outside any project with node_modules (the test's temp directory)
    const script = join(dir, 'probe.mjs');
    writeFileSync(script, `${out[0]}\nconsole.log(typeof webkit.launch, typeof chromium.connectOverCDP);\n`);
    const p = Bun.spawnSync(['node', script], { cwd: dir, stdout: 'pipe', stderr: 'pipe' });
    expect({ code: p.exitCode, out: p.stdout.toString().trim() }).toEqual({ code: 0, out: 'function function' });
  }, 30_000);
});
