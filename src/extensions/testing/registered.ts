// Run in a fresh process: the production registry stays empty in the rest of the suite.
import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { z } from 'zod';
import { serverExtensions, type ServerExtension } from '../server';
import { clientExtensions, type ClientExtension } from '../client';

const events: { type: string; project: string; card: string }[] = [];
const picked: unknown[] = [];
(serverExtensions as ServerExtension[]).splice(0);
(clientExtensions as ClientExtension[]).splice(0);
(clientExtensions as ClientExtension[]).push({
  strings: { en: { exampleExtension: { label: 'Hello' } }, de: { exampleExtension: { label: 'Hallo' } } },
});
(serverExtensions as ServerExtension[]).push({
  settings: { example: z.string().optional() },
  routes: { '/api/extension-example': { GET: (_request, context) => Response.json({ settings: context.settings('project', 'repo') }) } },
  event: (event) => { events.push(event); },
  permission: {
    options: (request, context) => request.name === 'Bash' && context.landsOnMain ? [{ label: { en: 'Example', de: 'Beispiel' }, note: { en: 'Example note', de: 'Beispielnotiz' }, data: { rule: request.input.command } }] : [],
    picked: (data, context) => {
      picked.push([data, context.harness, context.settings]);
      context.log('Example picked');
      return { permissions: [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }] };
    },
  },
});
const { checkShared } = await import('../../adapters/schema');
const { generic } = await import('../../adapters/generic');
const { withSettings, repoValues } = await import('../../adapters');
assert.deepEqual(checkShared({ example: 'value' }), { settings: { example: 'value' }, problems: [] });
assert.equal(checkShared({ example: 3 }).problems.length, 1);
assert.equal((withSettings(generic, () => ({ land: 'main', example: 'value' })) as unknown as Record<string, unknown>).example, 'value');
const strings = await import('../../ui/strings');
for (const [language, expected] of [['en', 'Hello'], ['de', 'Hallo']] as const) {
  strings.setLanguage(language, []);
  assert.equal((strings.t as unknown as { exampleExtension: { label: string } }).exampleExtension.label, expected);
}
const { sharedPreview } = await import('../../ui/config');
const values = repoValues({ path: '/example', remote: null, branch: 'main' }, false, { example: 'repository' } as never, 'main');
assert.equal(sharedPreview({ path: '/example', settings: { example: 'machine' } as never }, values).example, 'machine');
assert.equal(sharedPreview({ path: '/example' }, values).example, 'repository');
const { Config, readConfigFile } = await import('../../server/config');
const { Store } = await import('../../server/db');
const configDir = mkdtempSync(join(tmpdir(), 'obeya-extension-config-'));
try {
  const file = join(configDir, 'config.json');
  writeFileSync(file, JSON.stringify([{ repos: [{ path: '/example', settings: { example: 'machine' } }] }]));
  assert.equal((readConfigFile(file)[0]!.repos[0]!.settings as unknown as Record<string, unknown>).example, 'machine');
  const config = new Config({ file, source: 'file', started: [], store: new Store(':memory:'), running: () => [], server: { port: 0, home: configDir, permissionMode: 'auto' } });
  config.takenOver('/example', undefined, { example: 'machine' } as never);
  assert.equal(readConfigFile(file)[0]!.repos[0]!.settings, undefined);
} finally { rmSync(configDir, { recursive: true, force: true }); }
const { serve } = await import('../../server/server');
const { asOwner, artifact } = await import('../../server/testing');
let showRepo = false;
const served = { all: () => showRepo ? [{ id: 'project', repos: [{ ref: { id: 'repo' }, adapter: { example: 'route value' } }] }] : [] };
const server = serve(served as never, { transcriber: { transcribe: async () => ({ text: '', doubtful: false }) } }, 0);
try {
  const url = new URL('/api/extension-example', server.url);
  assert.notEqual((await fetch(url)).status, 200);
  showRepo = true;
  assert.deepEqual(await (await asOwner(() => server).fetch(url)).json(), { settings: { example: 'route value' } });
} finally { server.stop(true); }
const fixture = await import('../../server/workers-fixture');
const { git } = await import('../../server/workstations');
fixture.setup({ ...generic, land: 'main', workstations: 'clones', ...{ example: 'worker value' } });
try {
  // A runtime that cannot start must not tell extensions that a worker started.
  const start = fixture.runtime.start.bind(fixture.runtime);
  fixture.runtime.start = () => { throw new Error('Example runtime unavailable'); };
  const failed = fixture.manual();
  await fixture.workers.start(failed.id);
  assert.equal(fixture.runtime.sessions.length, 0);
  assert.equal(fixture.board.item(failed.id)!.question!.stuck, true);
  assert.equal(events.length, 0);
  await fixture.workers.stop(failed.id);
  await fixture.workers.freed();
  fixture.runtime.start = start;

  const card = fixture.manual();
  await fixture.workers.start(card.id);
  // start() already waits for workstation preparation and the runtime launch.
  assert.equal(fixture.runtime.sessions.length, 1);
  assert.deepEqual(events, [{ type: 'workerStarted', project: 'c', card: card.id, settings: { example: 'worker value' } }]);
  // a permission question carries the extension's option; picked, the call runs with its updates
  const permitted = fixture.runtime.last.spec.askOwner!({ name: 'Bash', input: { command: 'make' } }, new AbortController().signal);
  await fixture.flush();
  const question = fixture.board.item(card.id)!.question!;
  assert.deepEqual(question.options, ['Erlauben', 'Beispiel', 'Ablehnen']);
  assert.ok(question.text.endsWith('\n\nBeispielnotiz'));
  fixture.workers.answer(card.id, 'Example');
  assert.deepEqual(await permitted, { allow: true, permissions: [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }] });
  assert.deepEqual(picked, [[{ rule: 'make' }, 'claude', { example: 'worker value' }]]);
  assert.equal(fixture.board.events(card.id).at(-1)!.text, 'Example picked');
  const workstation = fixture.board.row(card.id).workstation!;
  writeFileSync(join(workstation, 'example.txt'), 'example');
  git(workstation, 'add', 'example.txt');
  git(workstation, 'commit', '--quiet', '-m', 'Example');
  await fixture.runtime.last.call('ready_for_review', { summary: 'Example', demo: artifact() });
  await fixture.workers.approve(card.id);
  assert.deepEqual(events.map((e) => e.type), ['workerStarted', 'landed']);
  await fixture.workers.freed();
} finally { rmSync(fixture.dir, { recursive: true, force: true }); }
