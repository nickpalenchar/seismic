import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CLONES, type MachineView } from '../core/types';
import { Board } from './board';
import type { ProjectRuntime } from './project';
import { Config } from './config';
import { Store } from './store';
import { claudeToken } from './hosts';
import { cloneName, codexHint, machineHint, MachineSetup, runnable, tried, WELCOME_FILE, welcome } from './machine';
import { agentSetting, saveAgents } from './settings';
import { gitRepo } from './testing';
import { HarnessCheck } from './llms/harnesses';
import { VoiceSetup } from './voice-setup';
import { git } from './workstations';

let dir: string;
let home: string;
let bin: string;
let store: Store;
/** The configurations the running projects took over, as the test's Config handed them on. */
let applied: string[][];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'seismic-machine-'));
  home = join(dir, 'home');
  bin = join(dir, 'bin');
  mkdirSync(home);
  mkdirSync(bin);
  store = new Store(':memory:');
  applied = [];
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** A program on the test's PATH that answers as the script says. */
function fake(name: string, script: string) {
  writeFileSync(join(bin, name), `#!/bin/sh\n${script}\n`);
  chmodSync(join(bin, name), 0o755);
}

const config = () =>
  new Config({
    file: join(home, 'projects.json'),
    source: 'file',
    started: [],
    store,
    running: () => [],
    server: { port: 4417, home, permissionMode: 'auto' },
    apply: (_, ids) => void applied.push(ids.map((id) => id ?? '?')),
  });

const setup = (o: { compiled?: boolean; env?: Record<string, string> } = {}) =>
  new MachineSetup({ home, config: config(), env: { PATH: bin, ...o.env }, platform: 'linux', arch: 'x64', compiled: o.compiled ?? true });

const section = (v: MachineView, id: string) => v.sections.find((s) => s.id === id)!;

describe('what Seismic needs on this machine', () => {
  test('reauthenticates even when auth status still reports a login', async () => {
    fake('claude', 'case "$1" in --version) echo "2.1.300 (Claude Code)";; auth) echo \'{"loggedIn":true,"email":"ada@example.com"}\';; esac');
    const machine = setup();
    expect(section(await machine.view(), 'needed').items.find((i) => i.id === 'claudeLogin')).toMatchObject({ state: 'ok' });
    // No terminal on this PATH: a valid login action returns the manual-command fallback.
    expect(await machine.login({ section: 'needed', id: 'claudeLogin' })).toEqual({ opened: false, command: `${bin}/claude auth login` });
    await expect(machine.login({ section: 'needed', id: 'git' })).rejects.toThrow();
  });

  test('a session on a token gets a new one: claude setup-token, its token kept for the sessions from then on', async () => {
    fake('claude', 'case "$1" in --version) echo "2.1.300 (Claude Code)";; auth) echo \'{"loggedIn":true,"authMethod":"oauth_token"}\';; esac');
    const env: Record<string, string> = { PATH: bin, CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-old' };
    const machine = new MachineSetup({ home, config: config(), env, platform: 'linux', arch: 'x64', compiled: true });
    expect(await machine.login({ section: 'needed', id: 'claudeLogin', token: true })).toEqual({ opened: false, command: `${bin}/claude setup-token` });
    await expect(machine.login({ section: 'needed', id: 'gh', token: true })).rejects.toThrow();
    expect(() => machine.saveToken({ token: 'two words' })).toThrow();
    expect(() => machine.saveToken({ token: ' ' })).toThrow();
    expect(machine.saveToken({ token: ' sk-ant-oat01-new\n' })).toEqual({ saved: true });
    expect(readFileSync(join(home, 'claude-token'), 'utf8')).toBe('sk-ant-oat01-new\n');
    expect(statSync(join(home, 'claude-token')).mode & 0o777).toBe(0o600);
    expect(claudeToken(home, {})).toBe('sk-ant-oat01-new');
    // this machine runs on the token: its sessions from now on take the new one
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('sk-ant-oat01-new');
  });

  test('a token kept for the hosts leaves a machine on its own login on that login', () => {
    const env: Record<string, string> = { PATH: bin };
    new MachineSetup({ home, config: config(), env, platform: 'linux', arch: 'x64' }).saveToken({ token: 'sk-ant-oat01-new' });
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
  });

  test('finds Claude Code, its login, git and gh, and says what is missing with how to get it', async () => {
    fake('claude', 'case "$1" in --version) echo "2.1.300 (Claude Code)";; auth) echo \'{"loggedIn": false}\'; exit 1;; esac');
    fake('git', 'case "$1" in --version) echo "git version 2.45.0";; config) exit 1;; esac');
    const v = await setup().view();
    expect(section(v, 'needed').items).toEqual([
      { id: 'claude', state: 'ok', found: '2.1.300' },
      { id: 'claudeLogin', state: 'missing', install: { commands: ['claude auth login'] }, act: 'login' },
    ]);
    // git in a section of its own: a slow git holds back no agent's result
    expect(section(v, 'git').items).toEqual([
      { id: 'git', state: 'ok', found: '2.45.0' },
      expect.objectContaining({ id: 'gitUser', state: 'missing', act: 'identity' }),
    ]);
    // gh is not there: its command for this Linux, run by hand; the login waits for it
    const pr = section(v, 'pr').items;
    expect(pr[0]).toMatchObject({ id: 'gh', state: 'missing', install: { url: 'https://cli.github.com' } });
    expect(pr[0]!.act).toBeUndefined();
    expect(pr[1]).toEqual({ id: 'ghLogin', state: 'missing' });
    expect(v.checkedClaude).toMatch(/^\d+\.\d+\.\d+$/);
    // what demos need is checked too; without a voice check there is no voice section
    expect(v.sections.map((s) => s.id)).toEqual(['needed', 'git', 'codex', 'agents', 'pr', 'demos']);
    // Antigravity is optional: not there, its login waits for it
    const agents = section(v, 'agents').items;
    expect(agents[0]).toMatchObject({ id: 'agy', state: 'missing', install: { url: 'https://antigravity.google/docs/cli' }, act: 'install' });
    expect(agents[1]).toEqual({ id: 'agyLogin', state: 'missing' });
  });

  test('Codex: missing with its npm command, found, signed in or to sign in by a terminal login', async () => {
    expect(section(await setup().view(), 'codex').items).toEqual([
      { id: 'codex', state: 'missing', install: { commands: ['npm install -g @openai/codex'], url: 'https://developers.openai.com/codex/cli' } },
      { id: 'codexLogin', state: 'missing' },
    ]);
    fake('codex', 'case "$1" in --version) echo "codex-cli 0.169.0";; login) exit 1;; esac');
    const machine = setup();
    expect(section(await machine.view(), 'codex').items).toEqual([
      { id: 'codex', state: 'ok', found: '0.169.0' },
      { id: 'codexLogin', state: 'missing', install: { commands: ['codex login'] }, act: 'login' },
    ]);
    expect(await machine.login({ section: 'codex', id: 'codexLogin' })).toEqual({ opened: false, command: `${bin}/codex login` });
    fake('codex', 'case "$1" in --version) echo "codex-cli 0.169.0";; login) echo "Logged in using ChatGPT";; esac');
    expect(section(await setup().view(), 'codex').items[1]).toEqual({ id: 'codexLogin', state: 'ok' });
  });

  test("Codex: npm's Windows shim is no Codex a worker can start, so it counts as missing", async () => {
    fake('codex.cmd', 'case "$1" in --version) echo "codex-cli 0.169.0";; login) echo "Logged in using ChatGPT";; esac');
    const items = section(await setup({ env: { SEISMIC_CODEX: join(bin, 'codex.cmd') } }).view(), 'codex').items;
    expect(items[0]).toMatchObject({ id: 'codex', state: 'missing' });
    expect(items[1]).toEqual({ id: 'codexLogin', state: 'missing' });
    // on Windows the hint names the native release, not npm's shim
    expect(codexHint('win32', false)).toEqual({ commands: [], url: 'https://github.com/openai/codex/releases' });
    expect(codexHint('darwin', true).commands).toEqual(['brew install --cask codex']);
  });

  test('Antigravity: found, signed in or to sign in by a terminal login', async () => {
    fake('agy', 'case "$1" in models) exit 1;; esac');
    const out = section(await setup().view(), 'agents').items;
    expect(out[0]).toMatchObject({ id: 'agy', state: 'ok' });
    expect(out[1]).toMatchObject({ id: 'agyLogin', state: 'missing', act: 'login' });
    fake('agy', 'case "$1" in models) echo "gemini-x\tGemini";; esac');
    expect(section(await setup().view(), 'agents').items[1]).toEqual({ id: 'agyLogin', state: 'ok' });
  });

  test('each check tells which agents are installed and signed in', async () => {
    const told: string[][] = [];
    // a check of its own that never answers: what it holds is the setup checks' alone
    const agents = new HarnessCheck(() => new Promise(() => {}), Infinity);
    const set = agents.set.bind(agents);
    agents.set = (found, check, of) => (told.push(found), set(found, check, of));
    const machine = new MachineSetup({ home, config: config(), env: { PATH: bin }, platform: 'linux', arch: 'x64', compiled: true, agents });
    fake('codex', 'case "$1" in --version) echo "codex-cli 0.169.0";; login) echo "Logged in using ChatGPT";; esac');
    fake('agy', 'case "$1" in models) exit 1;; esac');
    fake('claude', 'case "$1" in --version) echo "2.1.300 (Claude Code)";; auth) echo \'{"loggedIn": false}\'; exit 1;; esac');
    await machine.view();
    expect(told).toEqual([['codex']]);
    fake('claude', 'case "$1" in --version) echo "2.1.300 (Claude Code)";; auth) echo \'{"loggedIn":true}\';; esac');
    fake('agy', 'case "$1" in models) echo "gemini-x\tGemini";; esac');
    await machine.view();
    expect(told.at(-1)).toEqual(['claude', 'codex', 'agy']);
    expect(agents.current()).toEqual(['claude', 'codex', 'agy']);
  });

  test('a check of some sections runs and tells only those, so each agent shows as soon as it is known', async () => {
    const agents = new HarnessCheck(() => new Promise(() => {}), Infinity);
    agents.set(['claude', 'agy']);
    const machine = new MachineSetup({ home, config: config(), env: { PATH: bin }, platform: 'linux', arch: 'x64', compiled: true, agents });
    fake('codex', 'case "$1" in --version) echo "codex-cli 0.169.0";; login) echo "Logged in using ChatGPT";; esac');
    // Claude Code would answer it is logged out: a check of Codex alone never asks it
    fake('claude', 'case "$1" in --version) echo "2.1.300 (Claude Code)";; auth) echo \'{"loggedIn": false}\'; exit 1;; esac');
    const v = await machine.view(['codex']);
    expect(v.sections.map((x) => x.id)).toEqual(['codex']);
    expect(section(v, 'codex').items[1]).toEqual({ id: 'codexLogin', state: 'ok' });
    expect(agents.current()).toEqual(['claude', 'codex', 'agy']);
    expect((await machine.view(['pr', 'voice', 'demos', 'mobile'])).sections.map((x) => x.id)).toEqual(['pr', 'demos']);
    // Claude Code's section never waits for git: a check of it alone never asks git
    fake('git', `touch "${join(dir, 'git-asked')}"; exit 1`);
    const claude = await machine.view(['needed']);
    expect(claude.sections.map((x) => x.id)).toEqual(['needed']);
    expect(section(claude, 'needed').items.map((i) => i.id)).toEqual(['claude', 'claudeLogin']);
    expect(existsSync(join(dir, 'git-asked'))).toBe(false);
  });

  test('offers the official installer for a missing Claude Code, and the logins once logged in', async () => {
    fake('git', 'case "$1" in --version) echo "git version 2.45.0";; config) echo "Ada";; esac');
    fake('gh', 'case "$1" in --version) echo "gh version 2.60.0 (2024-10-01)";; auth) echo "  ✓ Logged in to github.com account ada (keyring)";; esac');
    // not where the official installer puts it either
    const v = await setup({ env: { SEISMIC_CLAUDE: join(dir, 'none', 'claude') } }).view();
    const needed = section(v, 'needed').items;
    expect(needed[0]).toMatchObject({ id: 'claude', state: 'missing', install: { commands: ['curl -fsSL https://claude.ai/install.sh | bash'] }, act: 'install' });
    expect(needed[1]).toEqual({ id: 'claudeLogin', state: 'missing' });
    expect(section(v, 'git').items[1]).toEqual({ id: 'gitUser', state: 'ok', found: 'Ada <Ada>' });
    expect(section(v, 'pr').items).toEqual([
      { id: 'gh', state: 'ok', found: '2.60.0' },
      { id: 'ghLogin', state: 'ok', found: 'ada' },
    ]);
  });

  test("from the checkout, the agents' Claude Code is the Agent SDK's", async () => {
    const v = await setup({ compiled: false }).view();
    expect(section(v, 'needed').items[0]).toEqual({ id: 'claude', state: 'ok', found: `${v.checkedClaude} (Agent SDK)` });
  });

  test('installs at a click only what needs no password', () => {
    fake('brew', 'exit 0');
    const env = { PATH: bin };
    expect(runnable('curl -LsSf https://astral.sh/uv/install.sh | sh', env, 'linux')).toEqual(['sh', '-c', 'curl -LsSf https://astral.sh/uv/install.sh | sh']);
    expect(runnable('irm https://claude.ai/install.ps1 | iex', env, 'win32')).toEqual(['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', 'irm https://claude.ai/install.ps1 | iex']);
    expect(runnable('brew install gh', env, 'darwin')).toEqual([join(bin, 'brew'), 'install', 'gh']);
    expect(runnable('sudo apt install gh', env, 'linux')).toBeNull();
    // winget is not on this PATH
    expect(runnable('winget install --id GitHub.cli -e', env, 'win32')).toBeNull();
  });

  test('says how to install git and gh on each platform', () => {
    expect(machineHint('git', 'darwin', null, false).commands).toEqual(['xcode-select --install']);
    expect(machineHint('git', 'darwin', null, true).commands).toEqual(['brew install git']);
    expect(machineHint('gh', 'win32', null, false).commands).toEqual(['winget install --id GitHub.cli -e']);
    expect(machineHint('gh', 'linux', 'pacman', false).commands).toEqual(['sudo pacman -S github-cli']);
    expect(machineHint('git', 'linux', null, false).commands).toEqual([]);
    expect(machineHint('claude', 'win32', null, false).commands).toEqual(['irm https://claude.ai/install.ps1 | iex']);
  });

  test('on Windows, every check reads the PATH from the registry again: git installed by hand is found at once', async () => {
    const later = join(dir, 'Git', 'cmd');
    // the registry's PATH, as PowerShell reads it
    fake('powershell', `echo "C:\\Windows;${later}"`);
    const machine = new MachineSetup({ home, config: config(), env: { PATH: bin }, platform: 'win32', arch: 'x64', compiled: true });
    expect(section(await machine.view(), 'git').items.find((i) => i.id === 'git')).toMatchObject({ state: 'missing' });
    // the owner installs git by hand and comes back to the window
    mkdirSync(later, { recursive: true });
    writeFileSync(join(later, 'git'), '#!/bin/sh\ncase "$1" in --version) echo "git version 2.51.0.windows.1";; config) echo Ada;; esac\n');
    chmodSync(join(later, 'git'), 0o755);
    expect(section(await machine.view(), 'git').items.find((i) => i.id === 'git')).toEqual({ id: 'git', state: 'ok', found: '2.51.0.windows.1' });
  });

  test('lists uv above the speech recognition, whose installation waits for it', async () => {
    const local = { backend: 'parakeet' as const, prepare: async () => {}, transcribe: async () => ({ text: '', doubtful: false }) };
    const voice = new VoiceSetup({ home, local, env: { PATH: bin } });
    const machine = new MachineSetup({ home, config: config(), voice, env: { PATH: bin }, platform: 'linux', arch: 'x64', compiled: true });
    const items = section(await machine.view(), 'voice').items;
    expect(items.map((i) => i.id)).toEqual(['uv', 'recognition', 'ffmpeg']);
    expect(items[0]).toMatchObject({ state: 'missing', act: 'install' });
    expect(items[1]).toMatchObject({ state: 'later', waits: 'uv', found: 'Parakeet' });
    expect(items[1]!.act).toBeUndefined();
    await expect(machine.install({ section: 'voice', id: 'recognition' })).rejects.toThrow('does not install recognition');
    await expect(voice.install()).rejects.toThrow('uv');
    // with uv there, the recognition installs at a click
    fake('uv', 'case "$1" in --version) echo "uv 0.9.2";; *) exit 1;; esac');
    const recognition = section(await machine.view(), 'voice').items.find((i) => i.id === 'recognition')!;
    expect(recognition).toMatchObject({ state: 'later', act: 'install' });
    expect(recognition.waits).toBeUndefined();
  }, 30_000);

  test("sets git's name and e-mail as the owner gives them", async () => {
    const log = join(dir, 'git.log');
    fake('git', `echo "$@" >> ${log}; case "$1" in --version) echo "git version 2.45.0";; config) [ $# -gt 3 ] || exit 1;; esac`);
    await setup().identity({ name: ' Ada Lovelace ', email: 'ada@example.com' });
    expect(readFileSync(log, 'utf8')).toContain('config --global user.name Ada Lovelace\nconfig --global user.email ada@example.com\n');
  });
});

describe('the first project', () => {
  test('a repository folder becomes a project whose workers use worktrees, and Seismic runs it at once', async () => {
    const repo = gitRepo(join(dir, 'shop'));
    git(repo, 'branch', '-m', 'master');
    const out = await setup().project({ path: repo });
    expect(out).toEqual({ project: 'shop', branch: 'master', opens: true });
    expect(applied).toEqual([['shop']]);
    expect(JSON.parse(readFileSync(join(home, 'projects.json'), 'utf8'))).toEqual([{ planBaselines: true, archive: 'manual', rightClick: 'groups', suggest: { category: true, complexity: true, priority: true }, suggestLabels: true, suggestCards: true, suggestMerges: true, codeReviews: { on: false, mode: 'auto' }, repos: [{ path: repo }] }]);
    expect(readFileSync(join(home, WELCOME_FILE), 'utf8')).toBe('shop');
  });

  test('with Claude Code configured among others, the default agent stays Claude Code', async () => {
    const repo = gitRepo(join(dir, 'shop'));
    await setup().project({ path: repo, agents: ['claude', 'codex'] });
    expect(agentSetting(home, 'worker').harness).toBeUndefined();
  });

  test('with only Codex configured, all roles default to Codex', async () => {
    const repo = gitRepo(join(dir, 'shop'));
    await setup().project({ path: repo, agents: ['codex'] });
    expect(agentSetting(home, 'worker').harness).toBe('codex');
    expect(agentSetting(home, 'review').harness).toBe('codex');
    expect(agentSetting(home, 'koordinator').harness).toBe('codex');
    expect(agentSetting(home, 'explorer').harness).toBe('codex');
    expect(agentSetting(home, 'chores').harness).toBe('codex');
  });

  test('with Codex and Antigravity configured, Codex comes first', async () => {
    const repo = gitRepo(join(dir, 'shop'));
    await setup().project({ path: repo, agents: ['agy', 'codex'] });
    expect(agentSetting(home, 'worker').harness).toBe('codex');
  });

  test('a harness the owner set before stays', async () => {
    const repo = gitRepo(join(dir, 'shop'));
    saveAgents(home, { worker: { harness: 'agy' } });
    await setup().project({ path: repo, agents: ['codex'] });
    expect(agentSetting(home, 'worker').harness).toBe('agy');
    expect(agentSetting(home, 'review').harness).toBe('codex');
  });

  test('a first project whose save fails changes no default and leaves no welcome behind', async () => {
    const repo = gitRepo(join(dir, 'shop'));
    const failing = config();
    failing.save = async () => {
      throw new Error('disk full');
    };
    const machine = new MachineSetup({ home, config: failing, env: { PATH: bin }, platform: 'linux', arch: 'x64', compiled: true });
    await expect(machine.project({ path: repo, agents: ['codex'] })).rejects.toThrow('disk full');
    expect(agentSetting(home, 'worker').harness).toBeUndefined();
    expect(existsSync(join(home, WELCOME_FILE))).toBe(false);
    // tried again with Claude Code there too: nothing of the failed try stands in the way
    await setup().project({ path: repo, agents: ['claude', 'codex'] });
    expect(agentSetting(home, 'worker').harness).toBeUndefined();
  });

  test('a default agent that cannot be written keeps the project from being saved', async () => {
    const repo = gitRepo(join(dir, 'shop'));
    // the settings file cannot be written: a directory in its place
    mkdirSync(join(home, 'settings.json'));
    await expect(setup().project({ path: repo, agents: ['codex'] })).rejects.toThrow();
    expect(existsSync(join(home, 'projects.json'))).toBe(false);
    expect(existsSync(join(home, WELCOME_FILE))).toBe(false);
    expect(applied).toEqual([]);
  });

  test('a project saved whose start then fails keeps its default agent and its welcome', async () => {
    const repo = gitRepo(join(dir, 'shop'));
    const starting = new Config({ file: join(home, 'projects.json'), source: 'file', started: [], store, running: () => [], server: { port: 4417, home, permissionMode: 'auto' }, apply: async () => { throw new Error('did not start'); } });
    const machine = new MachineSetup({ home, config: starting, env: { PATH: bin }, platform: 'linux', arch: 'x64', compiled: true });
    await expect(machine.project({ path: repo, agents: ['codex'] })).rejects.toThrow('did not start');
    expect(JSON.parse(readFileSync(join(home, 'projects.json'), 'utf8'))[0].repos).toEqual([{ path: repo }]);
    expect(agentSetting(home, 'worker').harness).toBe('codex');
    expect(readFileSync(join(home, WELCOME_FILE), 'utf8')).toBe('shop');
  });

  test('a folder without git is refused where its workers would run in Codex or Antigravity, and nothing is saved', async () => {
    const docs = join(dir, 'Dokumente');
    mkdirSync(docs);
    await expect(setup().project({ path: docs, git: false, agents: ['codex'] })).rejects.toMatchObject({ code: 'config', message: expect.stringContaining('Codex works only in a Git repository') });
    expect(agentSetting(home, 'worker').harness).toBeUndefined();
    expect(existsSync(join(home, 'projects.json'))).toBe(false);
    // set before, the same
    saveAgents(home, { worker: { harness: 'agy' } });
    await expect(setup().project({ path: docs, git: false, agents: ['claude'] })).rejects.toMatchObject({ code: 'config', message: expect.stringContaining('Antigravity') });
    // with Claude Code the folder is a project
    saveAgents(home, { worker: { harness: 'claude' } });
    expect(await setup().project({ path: docs, git: false, agents: ['claude', 'codex'] })).toMatchObject({ project: 'dokumente', branch: '' });
  });

  test('a repository whose settings say clones gets clones', async () => {
    const repo = gitRepo(join(dir, 'shop'), { 'README.md': 'hi\n', '.seismic/settings.json': '{ "workstations": "clones" }\n' });
    await setup().project({ path: repo });
    expect(JSON.parse(readFileSync(join(home, 'projects.json'), 'utf8'))).toEqual([{ planBaselines: true, archive: 'manual', rightClick: 'groups', suggest: { category: true, complexity: true, priority: true }, suggestLabels: true, suggestCards: true, suggestMerges: true, codeReviews: { on: false, mode: 'auto' }, repos: [{ path: repo, clones: CLONES }] }]);
  });

  test('says of a folder before it is saved whether it holds a repository, and its main branch', () => {
    const repo = gitRepo(join(dir, 'shop'));
    git(repo, 'branch', '-m', 'master');
    mkdirSync(join(dir, 'empty'));
    expect(setup().folder({ path: `${repo}/` })).toEqual({ repo: true, branch: 'master' });
    expect(setup().folder({ path: join(dir, 'empty') })).toEqual({ repo: false, folder: true });
    expect(setup().folder({ path: join(dir, 'nirgends') })).toEqual({ repo: false });
  });

  test('a folder without a repository is refused', async () => {
    mkdirSync(join(dir, 'empty'));
    await expect(setup().project({ path: join(dir, 'empty') })).rejects.toMatchObject({ code: 'notRepo' });
    expect(existsSync(join(home, 'projects.json'))).toBe(false);
  });

  test('a folder without git becomes a project of its own kind, where the owner keeps it without git', async () => {
    const docs = join(dir, 'Dokumente');
    mkdirSync(docs);
    writeFileSync(join(docs, 'Scan.pdf'), '%PDF');
    expect(await setup().project({ path: docs, git: false })).toEqual({ project: 'dokumente', branch: '', opens: true });
    expect(JSON.parse(readFileSync(join(home, 'projects.json'), 'utf8'))).toEqual([{ planBaselines: true, archive: 'manual', rightClick: 'groups', suggest: { category: true, complexity: true, priority: true }, suggestLabels: true, suggestCards: true, suggestMerges: true, codeReviews: { on: false, mode: 'auto' }, repos: [{ path: docs, git: false }] }]);
    expect(existsSync(join(docs, '.git'))).toBe(false);
  });

  test('a folder without git becomes a project once git is set up there', async () => {
    const shop = join(dir, 'shop');
    mkdirSync(join(shop, 'node_modules'), { recursive: true });
    writeFileSync(join(shop, 'node_modules', 'x.js'), '');
    writeFileSync(join(shop, 'app.ts'), '');
    // the name and e-mail the assistant's step for them set
    const before = process.env.GIT_CONFIG_GLOBAL;
    process.env.GIT_CONFIG_GLOBAL = join(dir, 'gitconfig');
    writeFileSync(process.env.GIT_CONFIG_GLOBAL, '[user]\n\tname = Ada\n\temail = ada@example.com\n[init]\n\tdefaultBranch = main\n');
    try {
      const s = setup();
      expect(s.gitPreview({ path: shop })).toMatchObject({ files: 2, ignored: ['node_modules/'] });
      expect(s.gitSetup({ path: shop })).toEqual({ branch: 'main' });
      expect(await s.project({ path: shop })).toMatchObject({ project: 'shop', branch: 'main' });
    } finally {
      if (before === undefined) delete process.env.GIT_CONFIG_GLOBAL;
      else process.env.GIT_CONFIG_GLOBAL = before;
    }
  });

  test('a clone goes into a folder of its name and becomes the project', async () => {
    const origin = gitRepo(join(dir, 'origin', 'shop'));
    const s = new MachineSetup({ home, config: config() });
    await s.project({ clone: origin, into: join(dir, 'code') });
    let v = await s.view();
    for (let i = 0; v.job?.running && i < 100; i++) await Bun.sleep(50), (v = await s.view());
    expect(v.job).toMatchObject({ kind: 'clone', running: false, project: 'shop', branch: 'main', opens: true });
    expect(existsSync(join(dir, 'code', 'shop', '.git'))).toBe(true);
    // the folder is there now: a second clone into it is refused
    await expect(new MachineSetup({ home, config: config() }).project({ clone: origin, into: join(dir, 'code') })).rejects.toMatchObject({ code: 'cloneTarget' });
  });

  test('reads a repository before its clone, and says why one cannot be read', async () => {
    const origin = gitRepo(join(dir, 'origin', 'shop'));
    const s = new MachineSetup({ home, config: config() });
    expect(await s.repo({ clone: origin })).toEqual({ readable: true });
    const missing = await s.repo({ clone: join(dir, 'origin', 'none') });
    expect(missing).toMatchObject({ readable: false, github: false });
    expect(missing).not.toHaveProperty('needsPassword');
    expect(missing.readable || missing.error).toBeTruthy();
    await expect(s.repo({ clone: ' ' })).rejects.toMatchObject({ code: 'invalid' });
  });

  test('a GitHub repository is read and cloned with gh\'s login where gh is logged in, through git', async () => {
    const calls = join(dir, 'git-calls');
    const loggedIn = join(dir, 'gh-logged-in');
    fake('gh', `[ "$1 $2" = "auth status" ] && test -f ${loggedIn}`);
    fake('git', `echo "$@" >> ${calls}; [ "$GIT_TERMINAL_PROMPT" = 0 ] && [ -z "$GIT_ASKPASS$SSH_ASKPASS" ] && [ "$SSH_ASKPASS_REQUIRE" = never ] || exit 3; case "$*" in *gh\\ auth\\ git-credential*) exit 0;; esac; echo "fatal: could not read Username for 'https://github.com': terminal prompts disabled" >&2; exit 128`);
    const s = setup({ env: { GIT_ASKPASS: '/usr/bin/a-dialog', SSH_ASKPASS: '/usr/bin/a-dialog' } });
    expect(await s.repo({ clone: 'acme/private-shop' })).toEqual({ readable: false, error: "could not read Username for 'https://github.com': terminal prompts disabled", github: true, ghLogin: false, needsPassword: true });
    writeFileSync(loggedIn, '');
    expect(await s.repo({ clone: 'acme/private-shop' })).toEqual({ readable: true });
    expect(await s.repo({ clone: 'https://github.com/acme/private-shop' })).toEqual({ readable: true });
    expect(await s.repo({ clone: 'http://github.com/acme/private-shop.git' })).toEqual({ readable: true });
    // not GitHub: no login to offer, and gh's stays out of it
    expect(await s.repo({ clone: 'https://example.com/acme/shop.git' })).toMatchObject({ readable: false, github: false });
    // the clone goes the way the check went
    await s.project({ clone: 'HTTP://www.GitHub.com/acme/private-shop.git', into: join(dir, 'code') });
    for (let i = 0; (await s.view()).job?.running && i < 100; i++) await Bun.sleep(50);
    // Background checks and signed-in GitHub clones clear configured helpers.
    const NP = '-c core.askPass= -c credential.interactive=false -c credential.helper= ';
    // the view's own git calls aside
    const lines = readFileSync(calls, 'utf8').trim().split('\n').filter((l) => l !== '--version');
    expect(lines).toEqual([
      `${NP}ls-remote --heads -- https://github.com/acme/private-shop.git`,
      `${NP}-c credential.https://github.com.helper=!gh auth git-credential ls-remote --heads -- https://github.com/acme/private-shop.git`,
      `${NP}-c credential.https://github.com.helper=!gh auth git-credential ls-remote --heads -- https://github.com/acme/private-shop`,
      `${NP}-c credential.https://github.com.helper=!gh auth git-credential ls-remote --heads -- https://github.com/acme/private-shop.git`,
      `${NP}ls-remote --heads -- https://example.com/acme/shop.git`,
      `${NP}-c credential.https://github.com.helper=!gh auth git-credential clone --progress -- https://github.com/acme/private-shop.git ${join(dir, 'code', 'private-shop')}`,
    ]);
  });

  test('checks skip configured helpers and explicit HTTPS clones can use saved credentials', async () => {
    const realGit = Bun.which('git')!;
    const githubOrigin = gitRepo(join(dir, 'github-origin'));
    const otherOrigin = gitRepo(join(dir, 'other-origin'));
    const gitConfig = join(dir, 'gitconfig');
    const prompt = join(bin, 'prompt');
    const prompted = join(dir, 'prompted');
    const used = join(dir, 'used-helpers');
    fake('prompt', `touch '${prompted}'; exit 1`);
    fake('saved', `echo "$1" >> '${used}'; printf 'username=saved-user\\npassword=test-token\\n'`);
    const saved = join(bin, 'saved');
    writeFileSync(gitConfig, `[core]\n\taskPass = ${prompt}\n[credential]\n\thelper = !${saved} global\n[credential "https://example.com"]\n\thelper =\n\thelper = !${saved} scoped\n`);
    fake('gh', 'exit 1');
    // Exercise Git's actual credential lookup without an authenticated server.
    const probe = join(dir, 'credential-probe.ts');
    writeFileSync(probe, `
      const args = process.argv.slice(2);
      const verb = args.findIndex((arg) => arg === 'ls-remote' || arg === 'clone');
      const git = ${JSON.stringify(realGit)};
      if (verb < 0) process.exit(Bun.spawnSync([git, ...args], { stdout: 'inherit' }).exitCode);
      const remote = args.indexOf('--') + 1;
      const url = new URL(args[remote]);
      const credential = Bun.spawnSync([git, ...args.slice(0, verb), 'credential', 'fill'], {
        stdin: Buffer.from('protocol=https\\nhost=' + url.hostname + '\\n\\n'),
        stderr: 'inherit',
      });
      if (credential.exitCode !== 0 || args[verb] !== 'clone') process.exit(credential.exitCode);
      args[remote] = url.hostname === 'github.com' ? ${JSON.stringify(githubOrigin)} : ${JSON.stringify(otherOrigin)};
      process.exit(Bun.spawnSync([git, ...args], { stderr: 'inherit' }).exitCode);
    `);
    fake('git', `exec '${process.execPath}' '${probe}' "$@"`);
    const machine = setup({ env: { GIT_CONFIG_GLOBAL: gitConfig, GIT_CONFIG_NOSYSTEM: '1', GIT_ASKPASS: prompt, PATH: `${bin}:${process.env.PATH}` } });
    const authError = expect.stringMatching(/unable to get password|terminal prompts disabled/);
    const repos = ['acme/private-shop', 'https://example.com/acme/shop.git'];
    for (const clone of repos) {
      expect(await machine.repo({ clone })).toMatchObject({ readable: false, error: authError, needsPassword: true });
    }
    expect(existsSync(used)).toBe(false);
    for (const clone of repos) {
      await machine.project({ clone, into: join(dir, 'code') });
      let view = await machine.view();
      for (let i = 0; view.job?.running && i < 100; i++) await Bun.sleep(50), (view = await machine.view());
      expect(view.job).toMatchObject({ kind: 'clone', running: false, branch: 'main' });
      expect(existsSync(join(dir, 'code', cloneName(clone), '.git'))).toBe(true);
    }
    expect(readFileSync(used, 'utf8').trim().split('\n')).toEqual(['global', 'scoped']);
    expect(existsSync(prompted)).toBe(false);
  });

  test.skipIf(process.platform === 'win32').each(['configured', 'conditional', 'GIT_SSH', 'GIT_SSH_COMMAND', 'default'])('checks and clones use the %s SSH transport', async (transport) => {
    const origin = gitRepo(join(dir, 'origin'));
    const calls = join(dir, 'ssh-calls');
    const gitConfig = join(dir, 'gitconfig');
    const script = (name: string) => `echo "${name} $*" >> '${calls}'; exec git upload-pack '${origin}'`;
    fake('ssh', script('default'));
    fake('custom-ssh', script('custom'));
    const custom = join(bin, 'custom-ssh');
    const env: Record<string, string> = { PATH: `${bin}:${process.env.PATH}`, GIT_CONFIG_GLOBAL: gitConfig, GIT_CONFIG_NOSYSTEM: '1' };
    const remote = 'ssh://git@example.invalid/team/shop.git';
    let configText = '[ssh]\n\tvariant = simple\n';
    const sshConfig = `[core]\n\tsshCommand = '${custom}' --identity team-key\n`;
    if (transport === 'configured' || transport === 'GIT_SSH_COMMAND') configText += sshConfig;
    if (transport === 'conditional') {
      const included = join(dir, 'clone-config');
      writeFileSync(included, sshConfig);
      configText += `[includeIf "gitdir:${realpathSync(dir)}/code/shop/"]\n\tpath = ${included}\n`;
    }
    if (transport === 'GIT_SSH') env.GIT_SSH = custom;
    if (transport === 'GIT_SSH_COMMAND') env.GIT_SSH_COMMAND = `'${custom}' --jump bastion`;
    // An HTTPS URL rewritten to SSH must use the same transport selection.
    const clone = transport === 'configured' ? 'https://example.invalid/team/shop.git' : remote;
    if (clone !== remote) configText += `[url "${remote}"]\n\tinsteadOf = ${clone}\n`;
    writeFileSync(gitConfig, configText);
    const machine = setup({ env });
    expect(await machine.repo({ clone })).toEqual({ readable: true });
    await machine.project({ clone, into: join(dir, 'code') });
    let view = await machine.view();
    for (let i = 0; view.job?.running && i < 100; i++) await Bun.sleep(50), (view = await machine.view());
    expect(view.job).toMatchObject({ kind: 'clone', running: false, branch: 'main' });
    const args = { configured: 'custom --identity team-key', conditional: 'default -o BatchMode=yes', GIT_SSH: 'custom', GIT_SSH_COMMAND: 'custom --jump bastion', default: 'default -o BatchMode=yes' }[transport];
    const cloneArgs = transport === 'conditional' ? 'custom --identity team-key' : args;
    expect(readFileSync(calls, 'utf8').trim().split('\n')).toEqual([
      `${args} git@example.invalid git-upload-pack '/team/shop.git'`,
      `${cloneArgs} git@example.invalid git-upload-pack '/team/shop.git'`,
    ]);
  });

  test.skipIf(process.platform === 'win32')('a command times out even when a child keeps stderr open', async () => {
    fake('holds-stderr', '/bin/sleep 10 >&2 & exit 0');
    expect(await tried([join(bin, 'holds-stderr')], {}, 100)).toEqual({ ok: false, last: 'no answer in time' });
  });

  test('names a clone after its repository', () => {
    expect(cloneName('owner/shop')).toBe('shop');
    expect(cloneName('https://github.com/owner/shop.git')).toBe('shop');
    expect(cloneName('git@github.com:owner/shop.git')).toBe('shop');
    expect(cloneName('/srv/git/shop/')).toBe('shop');
  });

  test('the project the assistant created gets one first card that says what to try', () => {
    const board = new Board(store, { id: 'shop', name: 'Shop', repos: [{ id: 'shop', name: 'Shop', path: '/r', branch: 'main' }] }, () => ({ docs: [], dirs: [] }));
    const project = { id: 'shop', board } as unknown as ProjectRuntime;
    writeFileSync(join(home, WELCOME_FILE), 'shop');
    welcome(home, [project]);
    welcome(home, [project]);
    const cards = board.snapshot().items.filter((i) => i.kind === 'task');
    expect(cards.map((c) => c.title)).toEqual([board.t.welcome.title]);
    expect(existsSync(join(home, WELCOME_FILE))).toBe(false);
  });
});

describe('mobile development, on the recommended page', () => {
  const mac = () => new MachineSetup({ home, config: config(), env: { PATH: bin, USER: 'ada' }, platform: 'darwin', arch: 'arm64', compiled: true });

  test('only a Mac has the section', async () => {
    expect(await setup().view().then((v) => v.sections.map((s) => s.id))).not.toContain('mobile');
  });

  test('without Xcode: it comes from the App Store; the simulator waits for it; safaridriver asks for a terminal', async () => {
    fake('xcodebuild', 'exit 1');
    fake('safaridriver', 'exit 0');
    fake('dseditgroup', 'exit 67');
    fake('open', 'exit 0');
    const items = section(await mac().view(), 'mobile').items;
    expect(items.map((i) => [i.id, i.state])).toEqual([['xcode', 'missing'], ['simulator', 'missing'], ['safaridriver', 'missing'], ['axe', 'missing']]);
    expect(items[0]).toMatchObject({ act: 'install', install: { commands: ['open macappstore://apps.apple.com/app/id497799835'] } });
    expect(items[1]!.install).toBeUndefined();
    expect(items[2]).toMatchObject({ act: 'terminal', install: { commands: ['safaridriver --enable'] } });
  });

  test('with Xcode, an iPhone and the group: all there', async () => {
    fake('xcodebuild', 'echo "Xcode 27.0"; echo "Build version 27A1"');
    fake('xcrun', 'printf -- "-- iOS 27.2 --\n    iPhone 17 (ABC-123) (Shutdown)\n"');
    fake('safaridriver', 'exit 0');
    fake('dseditgroup', 'exit 0');
    const items = section(await mac().view(), 'mobile').items;
    expect(items.map((i) => [i.id, i.state, i.found])).toEqual([['xcode', 'ok', '27.0'], ['simulator', 'ok', 'iPhone 17'], ['safaridriver', 'ok', undefined], ['axe', 'missing', undefined]]);
    fake('axe', 'exit 0');
    expect(section(await mac().view(), 'mobile').items[3]).toMatchObject({ id: 'axe', state: 'ok' });
  });

  test('Xcode without an iPhone runtime offers to download it; safaridriver --enable opens a terminal, only for itself', async () => {
    fake('xcodebuild', 'echo "Xcode 27.0"');
    fake('xcrun', 'echo "== Devices =="');
    fake('safaridriver', 'exit 0');
    fake('dseditgroup', 'exit 67');
    const machine = mac();
    const items = section(await machine.view(), 'mobile').items;
    expect(items[1]).toMatchObject({ state: 'missing', act: 'install', install: { commands: ['xcodebuild -downloadPlatform iOS'] } });
    expect(await machine.login({ section: 'mobile', id: 'safaridriver' })).toMatchObject({ command: 'safaridriver --enable' });
    await expect(machine.login({ section: 'mobile', id: 'xcode' })).rejects.toThrow();
  });
});
