import { expect, test } from 'bun:test';

test('critical paths run with no extensions registered', async () => {
  // These are the existing end-to-end paths, run in a clean process with the production registry:
  // authenticated pages and API, worker start and landing, settings, and both languages.
  const pattern = 'nothing without the key|a project’s and a card’s address|start leases a clean clone|landing on main: the last commit|the strings follow the language set|reads the settings whenever a field is asked for|a field that is wrong does not count';
  const child = Bun.spawn([process.execPath, 'test', '--preload', './src/extensions/testing/empty-preload.ts', '--test-name-pattern', pattern,
    'src/server/server.test.ts', 'src/server/workers.test.ts', 'src/server/workers-landing.test.ts',
    'src/adapters/index.test.ts', 'src/ui/strings.test.ts'], { stdout: 'pipe', stderr: 'pipe' });
  const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  expect(`${out}\n${err}`).toContain('0 fail');
  expect(code).toBe(0);
}, 60_000);
