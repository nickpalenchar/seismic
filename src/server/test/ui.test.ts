import { afterAll, expect, test } from 'bun:test';
import { uiRoutes } from '../ui';

const server = Bun.serve({ port: 0, hostname: '127.0.0.1', development: false, routes: uiRoutes(false) });
afterAll(() => server.stop(true));
const get = (path: string, init?: RequestInit) => fetch(new URL(path, server.url), init);

test('the production page loads without the diff viewer or highlighting grammars; lazy assets are separately served and cached', async () => {
  const page = await get('/p/example/c/123');
  const html = await page.text();
  expect(page.status).toBe(200);
  const entry = html.match(/<script type="module"[^>]*src="([^"]+)"/)?.[1];
  expect(entry).toStartWith('/_ui/');
  const seen = new Set<string>();
  const lazy = new Set<string>();
  const scan = new Bun.Transpiler({ loader: 'js' });
  let size = 0;
  async function visit(path: string) {
    if (seen.has(path)) return;
    seen.add(path);
    const response = await get(path);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('javascript');
    const code = await response.text();
    size += Buffer.byteLength(code);
    expect(code).not.toContain('source.tsx'); // A Shiki grammar's scope must stay out of startup.
    for (const item of scan.scanImports(code)) {
      const next = new URL(item.path, new URL(path, server.url)).pathname;
      if (item.kind === 'dynamic-import') lazy.add(next);
      else await visit(next);
    }
  }
  await visit(entry!);
  expect(size).toBeLessThan(2_000_000);
  expect(lazy.size).toBeGreaterThan(0);
  for (const path of lazy) {
    const response = await get(path);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('immutable');
    const etag = response.headers.get('etag')!;
    expect(etag).toBeTruthy();
    const cached = await get(path, { headers: { 'if-none-match': etag } });
    expect(cached.status).toBe(304);
    expect(await cached.text()).toBe('');
    const head = await get(path, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
  }
  expect((await get('/_ui/missing.js')).status).toBe(404);
  expect((await get(entry!, { method: 'POST' })).status).toBe(405);
});
