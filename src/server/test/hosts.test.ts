



import { afterEach, beforeEach, describe, expect, setSystemTime, test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, linkSync, mkdirSync, symlinkSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SpawnOptions } from '@anthropic-ai/claude-agent-sdk';
import { generic } from '../../adapters/generic';
import { Board } from '../board';
import { Store } from '../store';
import { HostError, hostName, onHost, registerHost, remote, sessionFiles, type SshHost } from '../hosts';
import { runAppCommand } from '../appCommand';
import { type AgentEvent } from '../runtime';
import { sdkRuntime } from '../llms/harnesses/claude';
import { FakeRuntime, fakeSsh, gitRepo, identify, until } from './helpers/testing';
import { WorkerSupervisor } from '../workerSupervisor/workerSupervisor';
import { git, gitAsync, HERE, RECHECK_MS, remoteText, VERSION_LIMIT, Workstations } from '../workstations';

let dir: string;
let ssh: string;
let host: SshHost;
let name: string;
const log = () => (existsSync(join(dir, 'net', 'log')) ? readFileSync(join(dir, 'net', 'log'), 'utf8') : '');

beforeEach(() => {
  
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'obeya-hosts-')));
  ssh = fakeSsh(join(dir, 'net'));
  
  name = `box${Math.random().toString(36).slice(2, 8)}`;
  host = registerHost({ name, ssh: 'me@box', home: join(dir, 'home'), program: ssh, claudeToken: () => 'sk-claude' });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('a workstation on a host', () => {
  test('is named by its host, and found again by that name', () => {
    const path = onHost(name, '/srv/clones/1');
    expect(path).toBe(`ssh://${name}/srv/clones/1`);
    expect(remote(path)).toEqual({ host, path: '/srv/clones/1' });
    expect(hostName(path)).toBe(name);
    expect(remote('/Users/me/repo')).toBeNull();
    expect(() => remote('ssh://gone/x')).toThrow('no host gone');
    expect(hostName('ssh://gone/x')).toBe('gone');
  });

  test("a file's text there, for a diff to expand: a blob or a plain file of the workstation, never past the limit, a link or another file", async () => {
    const repo = gitRepo(join(dir, 'repo'));
    writeFileSync(join(repo, 'a.txt'), 'one\ntwo\n');
    writeFileSync(join(repo, 'big.txt'), 'x'.repeat(VERSION_LIMIT + 10));
    writeFileSync(join(repo, 'bin.dat'), Buffer.from([65, 0, 66]));
    symlinkSync('/etc/hosts', join(repo, 'link.txt'));
    git(repo, 'add', '.');
    git(repo, 'commit', '--quiet', '-m', 'Files');
    const there = remote(onHost(name, repo))!;
    const blob = (n: string) => remoteText(there, `n=$(git cat-file -s HEAD:${n}) && [ "$n" -le ${VERSION_LIMIT} ]`, `git show HEAD:${n}`);
    expect(await blob('a.txt')).toBe('one\ntwo\n');
    expect(await blob('missing.txt')).toBeNull();
    expect(await blob('big.txt')).toBeNull();
    expect(await blob('bin.dat')).toBeNull();
    const file = (n: string) => remoteText(there, `f='${n}'; [ -f "$f" ] && [ ! -L "$f" ] && case "$(realpath "$f")" in "$(pwd -P)"/*) true;; *) false;; esac && [ "$(wc -c < "$f")" -le ${VERSION_LIMIT} ]`, 'cat "$f"');
    expect(await file('a.txt')).toBe('one\ntwo\n');
    expect(await file('link.txt')).toBeNull();
    expect(await file('big.txt')).toBeNull();
    
    writeFileSync(join(repo, 'locked.txt'), 'secret\n');
    chmodSync(join(repo, 'locked.txt'), 0);
    if (process.getuid?.() !== 0) expect(await file('locked.txt')).toBeNull();
  });

  test('runs git there, with the GitHub login on stdin rather than on the command line', async () => {
    const repo = gitRepo(join(dir, 'repo'));
    host.tokenFor(repo, () => 'ghp_secret');
    const path = onHost(name, repo);
    expect(git(path, 'branch', '--show-current')).toBe('main');
    expect(await gitAsync(path, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('main');
    expect(() => git(path, 'checkout', 'nowhere')).toThrow('git checkout nowhere');
    expect((await host.run('printf %s "$GH_TOKEN"', { cwd: repo })).stdout).toBe('ghp_secret');
    expect((await host.run('printf %s "$GH_TOKEN"', { cwd: dir })).stdout).toBe('');
    expect(log()).toContain('me@box');
    expect(log()).not.toContain('ghp_secret');
  });

  test("runs the stack commands of the settings there", async () => {
    mkdirSync(join(dir, 'ws'));
    const r = await runAppCommand(onHost(name, join(dir, 'ws')), 'pwd -P && echo stopped > stack.log');
    expect(r.ok).toBe(true);
    expect(readFileSync(join(dir, 'ws', 'stack.log'), 'utf8')).toBe('stopped\n');
    writeFileSync(join(dir, 'net', 'down'), '');
    expect((await runAppCommand(onHost(name, join(dir, 'ws')), 'true')).ok).toBe(false);
  });

  test('copies directories there and back', async () => {
    mkdirSync(join(dir, 'demo', 'sub'), { recursive: true });
    writeFileSync(join(dir, 'demo', 'demo.mp4'), 'video');
    writeFileSync(join(dir, 'demo', 'sub', "it's.txt"), 'quote');
    await host.copyTo(join(dir, 'demo'), join(dir, 'there', 'demo'));
    expect(readFileSync(join(dir, 'there', 'demo', 'sub', "it's.txt"), 'utf8')).toBe('quote');
    const copy = host.localCopy(join(dir, 'there', 'demo'));
    expect(copy.startsWith(join(dir, 'home', 'hosts', name))).toBe(true);
    await host.copyFrom(join(dir, 'there', 'demo'), copy);
    expect(readFileSync(join(copy, 'demo.mp4'), 'utf8')).toBe('video');
    await expect(host.copyFrom(join(dir, 'nothing'), copy)).rejects.toThrow();
    
    expect(() => host.localCopy('/../../..')).toThrow(HostError);
    expect(() => host.localCopy('/tmp/./x')).toThrow(HostError);
    await expect(host.copyFrom(join(dir, 'there', 'demo'), join(dir, 'home'))).rejects.toThrow(HostError);
    expect(existsSync(join(dir, 'home'))).toBe(true);
  });
});

describe('a session on a host', () => {
  /** A session's process from the SDK's spawn options, with what it printed. */
  const spawnSession = (s: Omit<SpawnOptions, 'signal'>, files = { dirs: { plugin: join(dir, 'plugin') } }, onExit?: (code: number | null) => void) => {
    const p = host.session({ cwd: join(dir, 'ws'), files, onExit })({ ...s, signal: new AbortController().signal });
    let out = '';
    p.stdout.on('data', (d: Buffer) => (out += d.toString()));
    const exited = new Promise<number | null>((r) => p.on('exit', (code) => r(code)));
    return { p, out: () => out, exited };
  };

  beforeEach(() => {
    mkdirSync(join(dir, 'plugin', 'skills'), { recursive: true });
    writeFileSync(join(dir, 'plugin', 'skills', 'SKILL.md'), 'a skill');
    mkdirSync(join(dir, 'ws'));
  });

  test('starts Claude Code there once the host has the plugin, with its environment and the logins from stdin', async () => {
    const s = spawnSession({
      command: 'sh',
      args: ['-c', 'echo "$PWD|$FOO|$OBEYA_HOME|$CLAUDE_CODE_OAUTH_TOKEN|$OBEYA_URL|$1|$OBEYA_HOLDS_VOICE|$SEISMIC_URL|$SEISMIC_HOME|$SEISMIC_HOLDS_VOICE"; cat "$1/skills/SKILL.md"; echo; read line; echo "got $line"', 'x', join(dir, 'plugin')],
      env: { FOO: "it's", SEISMIC_URL: 'http://localhost:4417', SEISMIC_NARRATION_URL: 'http://127.0.0.1:4418' },
    });
    s.p.stdin.write('ping\n');
    expect(await s.exited).toBe(0);
    
    const remoteDir = join(dir, 'net', 'home', '.seismic', 'remote');
    const [first, skill, got] = s.out().trim().split('\n');
    const [pwd, foo, home, token, url, plugin, held, seismicUrl, seismicHome, seismicHeld] = first!.split('|');
    expect(pwd).toEndWith('/ws');
    expect(foo).toBe("it's");
    expect(home).toBe(remoteDir);
    expect(token).toBe('sk-claude');
    
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d{5}$/);
    expect(plugin).toBe(`${home}/plugin`);
    
    expect(held).toBe('1');
    
    expect([seismicUrl, seismicHome, seismicHeld]).toEqual([url, home, '1']);
    expect(skill).toBe('a skill');
    expect(got).toBe('got ping');
    expect(readFileSync(join(remoteDir, 'plugin.stamp'), 'utf8')).toHaveLength(16);
    expect(log()).not.toContain('sk-claude');
  });

  test("ends as a lost connection when the host cannot be made ready", async () => {
    writeFileSync(join(dir, 'net', 'down'), '');
    let heard: number | null | undefined;
    const s = spawnSession({ command: 'true', args: [], env: {} }, undefined, (code) => (heard = code));
    expect(await s.exited).toBe(255);
    
    expect(heard).toBe(255);
  });

  test("a host unreachable before Claude Code starts there loses the connection rather than failing the session", async () => {
    writeFileSync(join(dir, 'net', 'down'), '');
    const events: AgentEvent[] = [];
    const session = sdkRuntime.start({ cwd: onHost(name, join(dir, 'ws')), system: '', tools: [], plugins: [join(dir, 'plugin')], onEvent: (e) => events.push(e) }, 'hello');
    await session.done;
    expect(events).toEqual([{ type: 'lost', message: `the connection to ${name} was lost` }]);
  });

  test('ends the session a dropped connection left running there before the rename, under .obeya/remote', async () => {
    const pids = join(dir, 'net', 'home', '.obeya', 'remote', 'sessions');
    mkdirSync(pids, { recursive: true });
    const left = spawn('sh', ['-c', 'sleep 30; echo claude']);
    const legacy = join(pids, `${join(dir, 'ws').replace(/[^\w.-]+/g, '-')}.pid`);
    writeFileSync(legacy, `${left.pid}\n`);
    const ended = new Promise((r) => left.on('exit', r));
    const s = spawnSession({ command: 'sh', args: ['-c', 'echo claude here'], env: {} });
    expect(await s.exited).toBe(0);
    await ended;
    expect(s.out()).toContain('claude here');
    
    expect(existsSync(legacy)).toBe(false);
  });

  test("keeps the session's pid file where the host's own ~/.obeya is a link to ~/.seismic", async () => {
    const home = join(dir, 'net', 'home');
    mkdirSync(join(home, '.seismic', 'remote', 'sessions'), { recursive: true });
    symlinkSync('.seismic', join(home, '.obeya'));
    const s = spawnSession({ command: 'sh', args: ['-c', 'echo claude here'], env: {} });
    expect(await s.exited).toBe(0);
    const record = readFileSync(join(home, '.seismic', 'remote', 'sessions', `${join(dir, 'ws').replace(/[^\w.-]+/g, '-')}.pid`), 'utf8').trim().split(' ');
    expect(record.length).toBe(2);
  });

  test.each([false, true])('recovers a pre-rename bare record when both home paths alias it (hard link: %s)', async (hardLink) => {
    const home = join(dir, 'net', 'home');
    const pids = join(home, '.seismic', 'remote', 'sessions');
    mkdirSync(pids, { recursive: true });
    const pidFile = join(pids, `${join(dir, 'ws').replace(/[^\w.-]+/g, '-')}.pid`);
    const legacyDir = join(home, '.obeya', 'remote', 'sessions');
    if (!hardLink) symlinkSync('.seismic', join(home, '.obeya'));
    else mkdirSync(legacyDir, { recursive: true });
    const left = spawn('sh', ['-c', 'sleep 30; echo claude']);
    try {
      writeFileSync(pidFile, `${left.pid}\n`);
      const legacy = join(legacyDir, pidFile.split('/').at(-1)!);
      if (hardLink) linkSync(pidFile, legacy);
      const ended = new Promise((r) => left.on('exit', r));
      const s = spawnSession({ command: 'true', args: [], env: {} });
      expect(await s.exited).toBe(0);
      await ended;
      expect(readFileSync(pidFile, 'utf8').trim().split(' ')).toHaveLength(2);
      expect(readFileSync(legacy, 'utf8')).toBe(readFileSync(pidFile, 'utf8'));
    } finally {
      left.kill();
    }
  });

  test.each(['alias', 'distinct'])('never treats a marked legacy record as a bare PID (%s)', async (path) => {
    const home = join(dir, 'net', 'home');
    mkdirSync(join(home, '.seismic', 'remote', 'sessions'), { recursive: true });
    if (path === 'alias') symlinkSync('.seismic', join(home, '.obeya'));
    const pids = join(home, '.obeya', 'remote', 'sessions');
    mkdirSync(pids, { recursive: true });
    const legacy = join(pids, `${join(dir, 'ws').replace(/[^\w.-]+/g, '-')}.pid`);
    const other = spawn('sh', ['-c', 'sleep 30; echo claude']);
    try {
      writeFileSync(legacy, `${other.pid} different-mark\n`);
      const s = spawnSession({ command: 'true', args: [], env: {} });
      expect(await s.exited).toBe(0);
      expect(other.signalCode).toBeNull();
      expect(other.exitCode).toBeNull();
      expect(existsSync(legacy)).toBe(path === 'alias');
    } finally {
      other.kill();
    }
  });

  test('the session runs with the mark its pid file names', async () => {
    const s = spawnSession({ command: 'sh', args: ['-c', 'echo "mark $SEISMIC_REMOTE_SESSION"'], env: {} });
    expect(await s.exited).toBe(0);
    const record = readFileSync(join(dir, 'net', 'home', '.seismic', 'remote', 'sessions', `${join(dir, 'ws').replace(/[^\w.-]+/g, '-')}.pid`), 'utf8').trim().split(' ');
    expect(s.out()).toContain(`mark ${record[1]}`);
    expect(record[1]).toMatch(/^[0-9a-f-]{36}$/);
  });

  test.each([false, true])('leaves a reused PID alone with the same start second (no proc: %s)', async (noProc) => {
    if (noProc) {
      
      const original = readFileSync(ssh, 'utf8');
      writeFileSync(ssh, original.replace('exec sh -c "$*"', `script=$(printf '%s' "$*" | sed 's@/proc/@/seismic-test-no-proc/@g'); exec sh -c "$script"`));
    }
    const pids = join(dir, 'net', 'home', '.seismic', 'remote', 'sessions');
    mkdirSync(pids, { recursive: true });
    const other = spawn('sh', ['-c', 'sleep 30; echo claude']);
    try {
      writeFileSync(join(pids, `${join(dir, 'ws').replace(/[^\w.-]+/g, '-')}.pid`), `${other.pid} m3 ${spawnSync('ps', ['-p', String(other.pid), '-o', 'lstart='], { encoding: 'utf8' }).stdout.trim().split(/\s+/).join(' ')}\n`);
      const s = spawnSession({ command: 'sh', args: ['-c', 'echo claude here'], env: {} });
      expect(await s.exited).toBe(0);
      expect(other.exitCode).toBeNull();
      expect(other.signalCode).toBeNull();
    } finally {
      other.kill();
    }
  });

  test.each([false, true])('recovers an actual marked supervisor and terminates its child (no proc: %s)', async (noProc) => {
    if (noProc) {
      const original = readFileSync(ssh, 'utf8');
      writeFileSync(ssh, original.replace('exec sh -c "$*"', `script=$(printf '%s' "$*" | sed 's@/proc/@/seismic-test-no-proc/@g'); exec sh -c "$script"`));
    }
    const first = spawnSession({ command: 'sh', args: ['-c', 'echo ready; read line'], env: {} });
    try {
      await until(() => first.out().includes('ready'));
      const second = spawnSession({ command: 'sh', args: ['-c', 'exit 7'], env: {} });
      expect(await second.exited).toBe(7);
      expect(await first.exited).not.toBe(0);
    } finally {
      first.p.kill('SIGTERM');
    }
  });

  test('ends the session a dropped connection left running there, but never itself', async () => {
    const pids = join(dir, 'net', 'home', '.seismic', 'remote', 'sessions');
    const pidFile = join(pids, `${join(dir, 'ws').replace(/[^\w.-]+/g, '-')}.pid`);
    mkdirSync(pids, { recursive: true });
    
    
    const left = spawn('sh', ['-c', 'sleep 30; echo claude', 'seismic-session-m1'], { env: { ...process.env, SEISMIC_REMOTE_SESSION: 'm1' } });
    const started = spawnSync('ps', ['-p', String(left.pid), '-o', 'lstart='], { encoding: 'utf8' }).stdout.trim().split(/\s+/).join(' ');
    writeFileSync(pidFile, `${left.pid} m1 ${started}\n`);
    const ended = new Promise((r) => left.on('exit', r));
    const s = spawnSession({ command: 'sh', args: ['-c', 'echo claude here'], env: {} });
    expect(await s.exited).toBe(0);
    await ended;
    
    const wrapper = join(dir, 'net', 'same-pid');
    writeFileSync(wrapper, `#!/bin/sh\necho $$ m2 $(echo $(ps -p $$ -o lstart=)) > ${JSON.stringify(pidFile)}\nexec ${JSON.stringify(ssh)} "$@"\n`, { mode: 0o755 });
    const again = registerHost({ name: `${name}-again`, ssh: 'me@box', home: join(dir, 'home'), program: wrapper });
    const p = again.session({ cwd: join(dir, 'ws'), files: { dirs: { plugin: join(dir, 'plugin') } } })({ command: 'sh', args: ['-c', 'echo claude here'], env: {}, signal: new AbortController().signal });
    let out = '';
    p.stdout.on('data', (d: Buffer) => (out += d.toString()));
    expect(await new Promise<number | null>((r) => p.on('exit', (code: number | null) => r(code)))).toBe(0);
    expect(out).toContain('claude here');
  });

  test('copies the plugin once, until it changes', async () => {
    await host.prepare({ dirs: { plugin: join(dir, 'plugin') } });
    const again = registerHost({ name: `${name}-2`, ssh: 'me@box', home: join(dir, 'home'), program: ssh });
    const copies = () => log().split('\n').filter((l) => l.includes('tar -xf')).length;
    const before = copies();
    await again.prepare({ dirs: { plugin: join(dir, 'plugin') } });
    expect(copies()).toBe(before);
  });

  test("the owner's demo settings go there with the voice references as paths here, without a key file or the demo directory", () => {
    mkdirSync(join(dir, 'home'), { recursive: true });
    writeFileSync(join(dir, 'home', 'demo.json'), JSON.stringify({ language: 'en', voice: 'qwen3', references: { en: '~/voice/me.wav' }, keyFile: '~/.voice/key', directory: '/opt/work/demos' }));
    const settings = JSON.parse(sessionFiles(join(dir, 'home'), []).files!['demo.json']!()!);
    expect(settings.references).toEqual({ en: join(homedir(), 'voice', 'me.wav') });
    expect(settings.keyFile).toBeUndefined();
    
    expect(settings.directory).toBeUndefined();
  });
});

describe('clones on a host', () => {
  let origin: string;
  let spaces: Workstations;
  let store: Store;
  let board: Board;

  beforeEach(() => {
    gitRepo(join(dir, 'main'));
    origin = join(dir, 'origin.git');
    git(dir, 'clone', '--quiet', '--bare', join(dir, 'main'), origin);
    store = new Store(':memory:');
    board = new Board(store, { id: 'c', name: 'C', repos: [{ id: 'home', name: 'Home', path: join(dir, 'main'), branch: 'main' }] }, () => ({ docs: [], dirs: [] }));
    spaces = new Workstations(store, 'c', { mode: 'clones', repoPath: join(dir, 'main'), dir: join(dir, 'ws') });
  });

  test('are made there, leased after those here, and land through the remote', async () => {
    spaces.ensureClones(origin, 1);
    expect(await spaces.ensureHostClones(host, join(dir, 'far'), origin, 2, () => 'ghp_x')).toBeNull();
    
    expect(await spaces.ensureHostClones(host, join(dir, 'far'), origin, 2, () => 'ghp_x')).toBeNull();
    expect(spaces.list().map((w) => w.path)).toEqual([join(dir, 'ws', '1'), onHost(name, join(dir, 'far', '1')), onHost(name, join(dir, 'far', '2'))]);
    
    const trusted = JSON.parse(readFileSync(join(dir, 'net', 'home', '.claude.json'), 'utf8')).projects;
    expect(Object.keys(trusted)).toEqual([join(dir, 'far', '1'), join(dir, 'far', '2')]);
    expect(trusted[join(dir, 'far', '1')]).toEqual({ hasTrustDialogAccepted: true });
    
    expect(Bun.spawnSync(['git', '-C', join(dir, 'far', '1'), 'config', '--local', '--get-all', 'credential.helper']).stdout.toString()).toMatch(/^\n!f\(\).*GH_TOKEN/);
    const [a, b] = [board.create({ title: 'A', x: 0, y: 0 }).id, board.create({ title: 'B', x: 0, y: 0 }).id];
    const here = spaces.lease(a, 'obeya/a');
    expect(here.path).toBe(join(dir, 'ws', '1'));
    const far = spaces.lease(b, 'obeya/b');
    expect(far.path).toBe(onHost(name, join(dir, 'far', '1')));
    await Promise.all([here.ready, far.ready]);
    expect(await spaces.hasWork(b)).toBe(false);
    const local = join(dir, 'far', '1');
    identify(local);
    writeFileSync(join(local, 'new.txt'), 'x\n');
    expect(await spaces.hasWork(b)).toBe(true);
    expect(await spaces.changes(b)).toEqual([{ file: 'new.txt', regions: [] }]);
    git(local, 'add', '.');
    git(local, 'commit', '--quiet', '-m', 'far work');
    const landed = await spaces.pushToMain(b);
    expect('to' in landed && git(origin, 'log', '-1', '--format=%s', 'main')).toBe('far work');
    await spaces.discard(b, 'obeya/b');
    expect(git(local, 'branch', '--list', 'obeya/b')).toBe('');
    
  }, 30_000);

  test('take a new card on the first machine with a free slot, here first', async () => {
    let workers!: WorkerSupervisor;
    spaces = new Workstations(store, 'c', {
      mode: 'clones',
      repoPath: join(dir, 'main'),
      dir: join(dir, 'ws'),
      machines: [{ host: null, slots: 1 }, { host: name, slots: 1 }],
      busy: (h) => workers.busyOn(h),
    });
    spaces.ensureClones(origin, 2);
    expect(await spaces.ensureHostClones(host, join(dir, 'far'), origin, 2, () => undefined)).toBeNull();
    const runtime = new FakeRuntime();
    workers = new WorkerSupervisor({ board, runtime, workstations: spaces, adapter: { ...generic, workstations: 'clones', land: 'pr' } });
    const [a, b, c] = ['A', 'B', 'C'].map((title) => board.create({ title, x: 0, y: 0 }).id) as [string, string, string];
    await workers.start(a);
    expect(board.row(a).workstation).toBe(join(dir, 'ws', '1'));
    
    await workers.start(b);
    expect(board.row(b).workstation).toBe(onHost(name, join(dir, 'far', '1')));
    expect(() => workers.start(c)).toThrow(expect.objectContaining({ code: 'noSlot' }));
    expect(spaces.leasable()).toBe(false);
    expect(spaces.pool(workers.inTurn())).toEqual([
      { name: HERE, here: true, slots: 1, total: 2, cards: [a], busy: [a], workstations: [{ path: join(dir, 'ws', '1'), card: a }, { path: join(dir, 'ws', '2') }] },
      { name, slots: 1, total: 2, cards: [b], busy: [b], workstations: [{ path: join(dir, 'far', '1'), card: b }, { path: join(dir, 'far', '2') }] },
    ]);
    
    const sa = runtime.sessions.find((s) => s.spec.cwd === board.row(a).workstation)!;
    await sa.call('ask', { question: 'Welche Farbe?' });
    sa.emit({ type: 'idle' });
    expect(spaces.leasable()).toBe(true);
    await workers.start(c);
    expect(board.row(c).workstation).toBe(join(dir, 'ws', '2'));
    
    const d = board.create({ title: 'D', x: 0, y: 0 }).id;
    const lease = spaces.lease(d, 'obeya/d', { overSlots: true });
    expect(lease.path).toBe(onHost(name, join(dir, 'far', '2')));
    await lease.ready;
    workers.shutdown();
  }, 30_000);

  test('of a host that stops answering are looked at in the background, and again only a while later', async () => {
    expect(await spaces.ensureHostClones(host, join(dir, 'far'), origin, 2, () => undefined)).toBeNull();
    let back = 0;
    const stop = host.onBack(() => back++);
    const tries = () => (existsSync(join(dir, 'net', 'tries')) ? readFileSync(join(dir, 'net', 'tries'), 'utf8').split('\n').length - 1 : 0);
    writeFileSync(join(dir, 'net', 'down'), '');
    const before = tries();
    
    
    expect(spaces.leasable()).toBe(true);
    expect(host.unreachable).toBe(false);
    
    await until(() => !spaces.leasable());
    expect(host.unreachable).toBe(true);
    const looked = tries();
    expect(looked).toBeGreaterThan(before);
    
    for (let i = 0; i < 5; i++) expect(spaces.leasable()).toBe(false);
    expect(tries()).toBe(looked);
    
    rmSync(join(dir, 'net', 'down'));
    setSystemTime(new Date(Date.now() + RECHECK_MS));
    try {
      expect(spaces.leasable()).toBe(false);
    } finally {
      setSystemTime();
    }
    await until(() => spaces.leasable());
    expect(host.unreachable).toBe(false);
    expect(back).toBe(1);
    stop();
  });

  test('fewer of them in the configuration: the others leave the pool once a card no longer holds them, and their folders go', async () => {
    expect(await spaces.ensureHostClones(host, join(dir, 'far'), origin, 3, () => undefined)).toBeNull();
    const a = board.create({ title: 'A', x: 0, y: 0 }).id;
    await spaces.lease(a, 'obeya/a').ready;
    writeFileSync(join(dir, 'far', '3', 'notes.txt'), 'mine\n');
    expect(await spaces.ensureHostClones(host, join(dir, 'far'), origin, 0, () => undefined)).toBeNull();
    expect(spaces.list().map((w) => w.path)).toEqual([onHost(name, join(dir, 'far', '1'))]);
    
    await until(() => !existsSync(join(dir, 'far', '2')) && spaces.pool([]).some((h) => h.kept?.length));
    expect(spaces.pool([]).find((h) => h.name === name)?.kept).toEqual([join(dir, 'far', '3')]);
    
    writeFileSync(join(dir, 'net', 'down'), '');
    spaces.release(a);
    expect(spaces.list()).toEqual([]);
    await Bun.sleep(100);
    expect(existsSync(join(dir, 'far', '1', '.git'))).toBe(true);
    rmSync(join(dir, 'net', 'down'));
    rmSync(join(dir, 'far', '3', 'notes.txt'));
    expect(await spaces.ensureHostClones(host, join(dir, 'far'), origin, 0, () => undefined)).toBeNull();
    await until(() => !existsSync(join(dir, 'far', '1')) && !existsSync(join(dir, 'far', '3')) && !spaces.pool([]).some((h) => h.kept));
  }, 20_000);

  test('wait for a host that cannot be reached, and say why', async () => {
    writeFileSync(join(dir, 'net', 'down'), '');
    expect(await spaces.ensureHostClones(host, join(dir, 'far'), origin, 1, () => undefined)).toContain('Connection refused');
    expect(spaces.list()).toEqual([]);
  });
});

describe('a worker on a host', () => {
  test('whose connection drops resumes its session once the host answers, with the message it had not taken', async () => {
    gitRepo(join(dir, 'main'));
    const origin = join(dir, 'origin.git');
    git(dir, 'clone', '--quiet', '--bare', join(dir, 'main'), origin);
    const store = new Store(':memory:');
    const board = new Board(store, { id: 'c', name: 'C', repos: [{ id: 'home', name: 'Home', path: join(dir, 'main'), branch: 'main' }] }, () => ({ docs: [], dirs: [] }));
    const spaces = new Workstations(store, 'c', { mode: 'clones', repoPath: join(dir, 'main'), dir: join(dir, 'ws') });
    expect(await spaces.ensureHostClones(host, join(dir, 'far'), origin, 1, () => undefined)).toBeNull();
    const runtime = new FakeRuntime();
    const workers = new WorkerSupervisor({ board, runtime, workstations: spaces, adapter: { ...generic, workstations: 'clones', land: 'pr' }, reconnectMs: 20 });
    const card = board.create({ title: 'Weit weg', x: 0, y: 0 });
    await workers.start(card.id);
    const first = runtime.last;
    expect(first.spec.cwd).toBe(onHost(name, join(dir, 'far', '1')));
    first.emit({ type: 'session', id: 's1' });
    first.emit({ type: 'tool', name: 'Bash', input: { command: 'ls' } });
    first.emit({ type: 'idle' });
    
    workers.message(card.id, 'Please add CSV too.');
    writeFileSync(join(dir, 'net', 'down'), '');
    first.emit({ type: 'lost', message: 'the connection was lost' });
    expect(board.events(card.id).some((e) => e.text.includes(`The connection to ${name} is gone`))).toBe(true);
    await Bun.sleep(80);
    expect(runtime.sessions).toHaveLength(1);
    rmSync(join(dir, 'net', 'down'));
    await until(() => runtime.sessions.length === 2);
    expect(runtime.last.spec.resume).toBe('s1');
    expect(runtime.last.inbox[0]).toContain('Please add CSV too.');
    
    runtime.last.emit({ type: 'tool', name: 'Bash', input: { command: 'ls' } });
    runtime.last.emit({ type: 'lost', message: 'the connection was lost' });
    await until(() => runtime.sessions.length === 3);
    expect(runtime.last.inbox[0]).toContain('dropped');
    
    runtime.last.emit({ type: 'tool', name: 'Bash', input: { command: 'bun render.ts' } });
    runtime.last.emit({ type: 'idle', background: 1 });
    runtime.last.emit({ type: 'lost', message: 'the connection was lost' });
    await until(() => runtime.sessions.length === 4);
    expect(runtime.last.inbox[0]).toContain('dropped');
    
    const demo = join(dir, 'far', 'demo');
    mkdirSync(demo);
    writeFileSync(join(demo, 'demo.mp4'), 'video');
    writeFileSync(join(demo, 'captions.vtt'), 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nEins.\n');
    expect(await runtime.last.call('ready_for_review', { summary: 'Done.', demo: { dir: demo, chapters: ['Eins'] } })).toContain('End your turn');
    const shown = board.row(card.id).demo!.latest! as { dir: string };
    expect(shown.dir).toBe(host.localCopy(demo));
    expect(readFileSync(join(shown.dir, 'demo.mp4'), 'utf8')).toBe('video');
    expect(await runtime.last.call('ready_for_review', { summary: 'Done.', demo: { dir: join(dir, 'far', 'none'), chapters: [] } })).toContain('could not be copied');
    
    runtime.last.emit({ type: 'idle' });
    workers.message(card.id, 'Noch ein Satz im Video.');
    runtime.last.emit({ type: 'tool', name: 'Bash', input: { command: 'bun render.ts' } });
    runtime.last.emit({ type: 'idle', background: 1 });
    runtime.last.emit({ type: 'lost', message: 'the connection was lost' });
    await until(() => runtime.sessions.length === 5);
    expect(runtime.last.inbox[0]).toContain('dropped');
    workers.shutdown();
  }, 20_000);

  test('that could not start there, as the host did not answer, starts once it does, with its task', async () => {
    gitRepo(join(dir, 'main'));
    const origin = join(dir, 'origin.git');
    git(dir, 'clone', '--quiet', '--bare', join(dir, 'main'), origin);
    const store = new Store(':memory:');
    const board = new Board(store, { id: 'c', name: 'C', repos: [{ id: 'home', name: 'Home', path: join(dir, 'main'), branch: 'main' }] }, () => ({ docs: [], dirs: [] }));
    const spaces = new Workstations(store, 'c', { mode: 'clones', repoPath: join(dir, 'main'), dir: join(dir, 'ws') });
    expect(await spaces.ensureHostClones(host, join(dir, 'far'), origin, 1, () => undefined)).toBeNull();
    const runtime = new FakeRuntime();
    const workers = new WorkerSupervisor({ board, runtime, workstations: spaces, adapter: { ...generic, workstations: 'clones', land: 'pr' }, reconnectMs: 20 });
    const card = board.create({ title: 'Weit weg', body: 'Eine Wochenansicht.', x: 0, y: 0 });
    await workers.start(card.id);
    
    writeFileSync(join(dir, 'net', 'down'), '');
    runtime.last.emit({ type: 'lost', message: 'the connection was lost' });
    expect(board.events(card.id).some((e) => e.text.includes(`The connection to ${name} is gone`))).toBe(true);
    await Bun.sleep(80);
    expect(runtime.sessions).toHaveLength(1);
    rmSync(join(dir, 'net', 'down'));
    await until(() => runtime.sessions.length === 2);
    expect(runtime.last.spec.resume).toBeUndefined();
    expect(runtime.last.inbox[0]).toContain('Eine Wochenansicht.');
    workers.shutdown();
  }, 20_000);
});

describe('the app of a card on a host', () => {
  let board: Board;
  let runtime: FakeRuntime;
  let workers: WorkerSupervisor;
  let spaces: Workstations;
  let apps: ReturnType<typeof Bun.serve>[];
  /** An app running there (the stand-in's host is this machine), answering with its name. */
  const app = (name: string) => {
    const a = Bun.serve({ port: 0, fetch: () => new Response(name) });
    apps.push(a);
    return `http://localhost:${a.port}/`;
  };
  const forwards = () => (existsSync(join(dir, 'net', 'forwards')) ? readFileSync(join(dir, 'net', 'forwards'), 'utf8').trim().split('\n').map(Number) : []);
  const answers = (url: string) => fetch(url, { signal: AbortSignal.timeout(1000) }).then((r) => r.text(), () => null);
  const closed = (url: string) => until(async () => (await answers(url)) === null);

  beforeEach(async () => {
    apps = [];
    gitRepo(join(dir, 'main'));
    const origin = join(dir, 'origin.git');
    git(dir, 'clone', '--quiet', '--bare', join(dir, 'main'), origin);
    const store = new Store(':memory:');
    board = new Board(store, { id: 'c', name: 'C', repos: [{ id: 'home', name: 'Home', path: join(dir, 'main'), branch: 'main' }] }, () => ({ docs: [], dirs: [] }));
    spaces = new Workstations(store, 'c', { mode: 'clones', repoPath: join(dir, 'main'), dir: join(dir, 'ws') });
    expect(await spaces.ensureHostClones(host, join(dir, 'far'), origin, 1, () => undefined)).toBeNull();
    runtime = new FakeRuntime();
    workers = new WorkerSupervisor({ board, runtime, workstations: spaces, adapter: { ...generic, workstations: 'clones', land: 'pr' } });
  });
  afterEach(() => {
    workers.shutdown();
    for (const a of apps) a.stop(true);
  });

  test('opens through a forward of its port, which ends once the card no longer offers it', async () => {
    const card = board.create({ title: 'Weit weg', x: 0, y: 0 });
    await workers.start(card.id);
    expect(runtime.last.inbox[0]).toContain("Seismic forwards that address's port, and only that one");
    const first = app('erste');
    runtime.last.call('app_running', { url: `${first}seite?x=1` });
    expect(await workers.appUp(card.id)).toBe(true);
    const opened = (await workers.openApp(card.id))!;
    expect(opened).toMatch(/^http:\/\/localhost:\d+\/seite\?x=1$/);
    expect(new URL(opened).port).not.toBe(new URL(first).port);
    expect(await answers(opened)).toBe('erste');
    
    expect(await workers.openApp(card.id)).toBe(opened);
    expect(forwards()).toHaveLength(1);
    
    runtime.last.call('app_running', { url: app('zweite') });
    await closed(opened);
    const second = (await workers.openApp(card.id))!;
    expect(await answers(second)).toBe('zweite');
    
    runtime.last.call('app_running', { url: '' });
    await closed(second);
    expect(await workers.appUp(card.id)).toBe(false);
    expect(await workers.openApp(card.id)).toBeNull();
    
    runtime.last.call('app_running', { url: app('dritte') });
    const third = (await workers.openApp(card.id))!;
    expect(await answers(third)).toBe('dritte');
    await workers.stop(card.id);
    await closed(third);
    expect(forwards()).toHaveLength(3);
  }, 20_000);

  test('is forwarded again after its connection dropped, on the same port, and not while the host does not answer', async () => {
    const card = board.create({ title: 'Weit weg', x: 0, y: 0 });
    await workers.start(card.id);
    runtime.last.call('app_running', { url: app('da') });
    const opened = (await workers.openApp(card.id))!;
    process.kill(forwards()[0]!, 'SIGTERM');
    await closed(opened);
    writeFileSync(join(dir, 'net', 'down'), '');
    expect(await workers.appUp(card.id)).toBe(false);
    rmSync(join(dir, 'net', 'down'));
    expect(await workers.openApp(card.id)).toBe(opened);
    expect(await answers(opened)).toBe('da');
    
    workers.shutdown();
    await closed(opened);
  }, 20_000);

  test('ends when the card is parked', async () => {
    workers.shutdown();
    workers = new WorkerSupervisor({ board, runtime, workstations: spaces, adapter: { ...generic, workstations: 'clones', land: 'pr', app: { run: 'true', stop: 'true' } }, parkGrace: 10, tryGrace: 0 });
    const card = board.create({ title: 'Weit weg', x: 0, y: 0 });
    await workers.start(card.id);
    runtime.last.call('app_running', { url: app('da') });
    const opened = (await workers.openApp(card.id))!;
    expect(await answers(opened)).toBe('da');
    runtime.last.call('ask', { question: 'Welche Farbe?' });
    runtime.last.emit({ type: 'idle' });
    await until(() => board.row(card.id).parked, 10_000);
    await closed(opened);
  }, 20_000);
});
