// Bun's runtime HTML server flattens dynamic imports. Build the checkout's production UI with
// splitting explicitly; compiled builds carry Bun's HTML manifest and use its embedded assets.
import { basename, resolve } from 'node:path';
import index from '../ui/index.html';

const BASE = '/_ui/';
let bundled: Promise<Map<string, Response>> | undefined;

// Tailwind (src/ui/tailwind.css) for this build; a compiled binary carries its UI built already, so the plugin and its
// native scanner stay out of it: the name is not a literal the bundler would follow.
const TAILWIND = 'bun-plugin-tailwind';
const tailwind = (): Promise<Bun.BunPlugin> => import(TAILWIND).then((m) => m.default);

function bundle() {
  return bundled ??= tailwind().then((plugin) => Bun.build({
    entrypoints: [resolve(import.meta.dir, '../ui/index.html')],
    target: 'browser',
    splitting: true,
    minify: true,
    plugins: [plugin],
    define: { 'process.env.NODE_ENV': '"production"' },
    publicPath: BASE,
    naming: { entry: '[name]-[hash].[ext]', chunk: 'chunk-[hash].[ext]', asset: '[name]-[hash].[ext]' },
  })).then((result) => {
    if (!result.success) throw new AggregateError(result.logs, 'Could not bundle Seismic’s UI');
    const files = new Map<string, Response>();
    for (const output of result.outputs) {
      const page = output.type.startsWith('text/html');
      files.set(page ? '/' : `${BASE}${basename(output.path)}`, new Response(output, {
        headers: {
          'content-type': output.type,
          etag: `"${output.hash}"`,
          'cache-control': page ? 'no-cache' : 'public, max-age=31536000, immutable',
        },
      }));
    }
    return files;
  }).catch((error) => {
    bundled = undefined;
    throw error;
  });
}

async function serve(req: Request, page = false) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } });
  const response = (await bundle()).get(page ? '/' : new URL(req.url).pathname);
  if (!response) return new Response('not found', { status: 404 });
  if (req.headers.get('if-none-match') === response.headers.get('etag')) return new Response(null, { status: 304, headers: response.headers });
  return req.method === 'HEAD' ? new Response(null, { headers: response.headers }) : response.clone();
}

export function uiRoutes(development: boolean) {
  // Keep Bun's native HMR in hot mode. A compiled HTML manifest is already split at build time.
  const page = development || index.files ? index : (req: Request) => serve(req, true);
  return { '/': page, '/p/*': page, '/c/*': page, '/workspaces': page, [`${BASE}*`]: (req: Request) => index.files ? new Response('not found', { status: 404 }) : serve(req) };
}
