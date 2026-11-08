import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generic } from '../../adapters/generic';
import { readShared } from '../../adapters';
import { AGENT_DEFAULTS } from '../../core/types';
import { codexRules } from '../../server/allow-rules';
import { CanvasRuntime } from '../../server/canvas';
import { Store } from '../../server/db';
import { FakeRuntime, gitRepo, noForge, until } from '../../server/testing';
import { commandsOf } from '../../server/trust';
import { Workers } from '../../server/workers';
import { board, eachTest, flush, manual, runtime, setWorkers, spaces, workers } from '../../server/workers-fixture';
import { git } from '../../server/workstations';
import { alwaysRules } from './server';

describe('a permission question', () => {
  eachTest();

  test('„Immer erlauben“ allows the call, adds its rules where work lands on main, and the Claude session takes them; not offered where it goes through pull requests', async () => {
    // the change itself is the canvas test's below
    const added: string[] = [];
    let fails = false;
    const asOwner = async <T,>(cwd: string): Promise<T> => {
      if (fails) throw new Error('.claude/settings.json has changes of its own');
      added.push(cwd);
      return { committed: 'abc', branch: 'main' } as T;
    };
    setWorkers(new Workers({ board, runtime, workstations: spaces, adapter: { ...generic, land: 'main', workstations: 'clones' }, asOwner }));
    const c = manual();
    await workers.start(c.id);
    const suggestions = [{ type: 'addRules', behavior: 'allow', destination: 'localSettings', rules: [{ toolName: 'Bash', ruleContent: 'bun run:*' }] }];
    const answer = runtime.last.spec.askOwner!({ name: 'Bash', input: { command: 'bun run lint' }, suggestions }, new AbortController().signal);
    await flush();
    const q = board.item(c.id)!.question!;
    expect(q.options).toEqual(['Erlauben', 'Immer erlauben: bun run *', 'Ablehnen']);
    expect(q.text).toContain('„Immer erlauben“ nimmt die Regel in die Erlaubnisliste des Repositorys auf');
    workers.answer(c.id, 'Immer erlauben: bun run *');
    expect(await answer).toEqual({ allow: true, permissions: [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'bun run:*' }], behavior: 'allow', destination: 'session' }] });
    await flush();
    expect(added).toEqual([board.row(c.id).workstation!]);
    expect(board.events(c.id).at(-1)!.text).toBe('In die Erlaubnisliste aufgenommen und auf main committet: bun run *');
    // the list cannot take it: allowed once, and the card says why
    fails = true;
    const again = runtime.last.spec.askOwner!({ name: 'Bash', input: { command: 'bun run x' }, suggestions }, new AbortController().signal);
    await flush();
    workers.answer(c.id, 'Always allow: bun run *');
    expect((await again).allow).toBe(true);
    await flush();
    expect(board.events(c.id).at(-1)!.text).toBe('Einmal erlaubt; in die Erlaubnisliste ließ sich bun run * nicht aufnehmen: .claude/settings.json has changes of its own');
    await workers.stop(c.id);

    setWorkers(new Workers({ board, runtime, workstations: spaces, adapter: { ...generic, land: 'pr', workstations: 'clones' }, asOwner }));
    const pr = manual();
    await workers.start(pr.id);
    void runtime.last.spec.askOwner!({ name: 'Bash', input: { command: 'bun run lint' }, suggestions }, new AbortController().signal);
    await flush();
    expect(board.item(pr.id)!.question!.options).toEqual(['Erlauben', 'Ablehnen']);
  });
});

test('a Codex command no rule covers is offered the rule that would; none for what no rule could cover', () => {
  const codex = { harness: 'codex' as const, landsOnMain: true };
  const bash = (input: Record<string, unknown>) => alwaysRules({ name: 'Bash', input }, codex);
  expect(bash({ command: "/bin/zsh -lc 'bun run lint'", proposedExecpolicyAmendment: ['bun', 'run', 'lint'] })).toEqual(['Bash(bun run lint *)']);
  expect(bash({ command: "/bin/zsh -lc 'bun test x'" })).toEqual(['Bash(bun test *)']);
  expect(bash({ command: "/bin/zsh -lc 'ls | wc -l'" })).toEqual([]);
  expect(bash({ command: "/bin/zsh -lc 'bun run lint'", grantRoot: '/' })).toEqual([]);
  expect(bash({ command: "/bin/zsh -lc 'bun run lint'", additionalPermissions: { fileSystem: { write: ['/'] } } })).toEqual([]);
  expect(alwaysRules({ name: 'Bash', input: { command: "/bin/zsh -lc 'bun run lint'" } }, { ...codex, landsOnMain: false })).toEqual([]);
});

describe('in a canvas', () => {
  let dir: string;
  let canvas: CanvasRuntime | undefined;
  afterEach(() => {
    canvas?.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });

  test('„Immer erlauben“ commits the rule into the allow list on main, trusted, and a Codex worker goes by it at once', async () => {
    dir = mkdtempSync(join(tmpdir(), 'obeya-always-allow-'));
    const allow = { permissions: { allow: ['Bash(bun test *)'] } };
    const shop = gitRepo(join(dir, 'shop'), {
      'README.md': 'Shop\n',
      '.obeya/settings.json': JSON.stringify({ land: 'main' }),
      '.claude/settings.json': `${JSON.stringify(allow, null, 2)}\n`,
      '.codex/rules/obeya.rules': codexRules(JSON.stringify(allow), '`bun scripts/codex-rules.ts`').file,
    });
    const store = new Store(':memory:');
    store.trustCommands(shop, commandsOf(readShared(shop)));
    const workers = new FakeRuntime();
    canvas = new CanvasRuntime({ repos: [{ path: shop }] }, { store, home: dir, runtime: new FakeRuntime(), workerRuntime: workers, forge: noForge, agents: (role) => ({ ...AGENT_DEFAULTS[role], ...(role === 'worker' ? { harness: 'codex' as const } : {}) }) });
    const card = canvas.board.create({ title: 'Karte', x: 0, y: 0 });
    const r = canvas.repos[0]!;
    await r.workers.start(card.id);
    await until(() => workers.sessions.length > 0);
    const answer = workers.last.permission('Bash', { command: "/bin/zsh -lc 'bun run lint --fix'" });
    await until(() => canvas!.board.item(card.id)!.state === 'waiting');
    const q = canvas.board.item(card.id)!.question!;
    expect(q.options).toEqual(['Erlauben', 'Immer erlauben: bun run *', 'Ablehnen']);
    expect(q.text).toContain('.claude/settings.json auf main');
    r.workers.answer(card.id, 'Immer erlauben: bun run *');
    expect(await answer).toEqual({ allow: true });
    await until(() => canvas!.board.events(card.id).some((e) => e.text.startsWith('In die Erlaubnisliste')));
    expect(canvas.board.events(card.id).at(-1)!.text).toBe('In die Erlaubnisliste aufgenommen und auf main committet: bun run *');
    // on main for everyone, the Codex rules made again from the list, and trusted as the owner's
    const main = readShared(shop);
    expect(JSON.parse(main.claude!['.claude/settings.json']!.text)).toEqual({ permissions: { allow: ['Bash(bun test *)', 'Bash(bun run *)'] } });
    expect(main.codex!['.codex/rules/obeya.rules']!.text).toContain('prefix_rule(pattern=["bun","run"], decision="allow")');
    expect(git(shop, 'log', '-1', '--format=%s')).toBe('Allow for agents: Bash(bun run *)');
    expect(git(shop, 'status', '--porcelain')).toBe('');
    expect(store.trustedCommands(shop)).toEqual(commandsOf(main));
    // the next such command is not asked
    expect(await workers.last.permission('Bash', { command: "/bin/zsh -lc 'bun run build'" })).toEqual({ allow: true });
  });
});
