










import { chmodSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import type { Language } from '../core/locale';
import { MESSAGES } from '../core/messages.ts';

export const KEY_FILE = 'owner.key';
export const KEY_HEADER = 'x-seismic-key';

export const OLD_KEY_HEADER = 'x-obeya-key';

const COOKIE_MAX_AGE = 400 * 24 * 3600;

const OUTSTANDING = 32;

const random = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');

/** The owner's key in `home`, made on first use. */
export function ownerKey(home: string): string {
  const file = join(home, KEY_FILE);
  for (let tries = 0; ; tries++) {
    try {
      const key = readFileSync(file, 'utf8').trim();
      if (key) {
        if (process.platform !== 'win32' && (statSync(file).mode & 0o077) !== 0) chmodSync(file, 0o600);
        return key;
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      const key = random();
      try {
        
        writeFileSync(file, `${key}\n`, { mode: 0o600, flag: 'wx' });
        return key;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      }
    }
    
    if (tries > 100) throw new Error(`${file} stays empty`);
    Bun.sleepSync(10);
  }
}

/** The header that carries the owner's key of `home`, for a script's requests. */
export const ownerHeaders = (home: string) => ({ [KEY_HEADER]: ownerKey(home) });

/** A link for `base` (`http://127.0.0.1:4417`) to open signed in, from the Seismic there that holds the key of `home`; `null` when none answers. */
export async function loginLink(base: string, home: string, next = '/'): Promise<string | null> {
  try {
    const r = await fetch(`${base.replace(/\/$/, '')}/api/login-link`, {
      method: 'POST',
      headers: { ...ownerHeaders(home), 'content-type': 'application/json' },
      body: JSON.stringify({ next }),
      signal: AbortSignal.timeout(5000),
    });
    return r.ok ? ((await r.json()) as { url: string }).url : null;
  } catch {
    return null;
  }
}

const keys = new WeakMap<object, string>();

/** Notes the key `server` wants: for a test, which holds no home to read it from. */
export const serving = (server: object, owner: Owner) => void keys.set(server, owner.key);

/** The key a server `serving` noted wants. */
export const keyOf = (server: object) => keys.get(server)!;

const cookie = (req: Request, name: string) =>
  req.headers
    .get('cookie')
    ?.split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${name}=`))
    ?.slice(name.length + 1);

const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * On to `next` from a page of Seismic's own rather than with a redirect: a link opened from another
 * site or app (the app's shell navigates its window from its own `tauri:` page) starts a cross-site
 * navigation, and a browser sends a `SameSite=Strict` cookie on none of its redirects, so the
 * project would get no cookie. Going on from this page, the navigation is the site's own.
 */
function onward(next: string, headers: Record<string, string> = {}): Response {
  const attr = next.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const html = `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${attr}"><title>Seismic</title><script>location.replace(${JSON.stringify(next).replace(/</g, '\\u003c')})</script>`;
  return new Response(html, { headers: { ...headers, 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}

/** A path of Seismic's to go to after signing in; anything else is `/`. */
const localPath = (next: string | null) => (next && next.startsWith('/') && new URL(next, 'http://seismic').origin === 'http://seismic' ? next : '/');

export class Owner {
  readonly key: string;
  private readonly language: () => Language;
  
  private readonly run = random();
  
  private readonly tokens = new Set<string>();

  /** Without `home` (a test) the key is made up and kept in memory. */
  constructor(o: { home?: string; language?: () => Language } = {}) {
    this.key = o.home ? ownerKey(o.home) : random();
    this.language = o.language ?? (() => 'en');
  }

  /** The cookie of the Seismic on `port`: a browser keeps cookies per host, not per port, and a scratch Seismic beside it has another key. */
  cookieName(port: number) {
    return `seismic-${port}`;
  }

  /** The cookie's name before the rename, which a browser signed in before it still sends; only the new one is written. */
  oldCookieName(port: number) {
    return `obeya-${port}`;
  }

  /** Whether `req` names the owner's key, in the header or in the cookie, under either name. */
  admits(req: Request, port: number): boolean {
    const given = req.headers.get(KEY_HEADER) ?? req.headers.get(OLD_KEY_HEADER) ?? cookie(req, this.cookieName(port)) ?? cookie(req, this.oldCookieName(port));
    return !!given && same(given, this.key);
  }

  /** What a request from this machine gets instead of its route's answer, or `null` when it names the key. */
  refusal(req: Request, port: number, route: string): Response | null {
    if (this.admits(req, port)) return null;
    
    const url = new URL(req.url);
    if (req.headers.get('sec-fetch-site') === 'cross-site' && req.headers.get('sec-fetch-mode') === 'navigate' && !url.pathname.startsWith('/api/'))
      return onward(localPath(`${url.pathname}${url.search}`));
    if (route.startsWith('/api/')) return Response.json({ code: 'notOwner', error: 'only the owner talks to Seismic: this request names no owner key' }, { status: 401 });
    return this.page(false);
  }

  /**
   * A link at `base` that signs a browser in and opens `next`, a path of Seismic's: with the run's
   * token, or with `once` one of its own that signs in one browser.
   */
  link(base: string, next = '/', once = false): string {
    let token = this.run;
    if (once) {
      token = random();
      this.tokens.add(token);
      if (this.tokens.size > OUTSTANDING) this.tokens.delete(this.tokens.values().next().value!);
    }
    const path = localPath(next);
    return `${base.replace(/\/$/, '')}/login?token=${token}${path === '/' ? '' : `&next=${encodeURIComponent(path)}`}`;
  }

  /** `/login?token=…&next=…`: the cookie for the run's token or a one-time token not used yet, and on to `next`. */
  login(req: Request, port: number): Response {
    const url = new URL(req.url);
    const next = localPath(url.searchParams.get('next'));
    const token = url.searchParams.get('token') ?? '';
    if (same(token, this.run) || this.tokens.delete(token)) {
      const set = `${this.cookieName(port)}=${this.key}; Path=/; Max-Age=${COOKIE_MAX_AGE}; HttpOnly; SameSite=Strict`;
      return onward(next, { 'set-cookie': set });
    }
    
    if (this.admits(req, port)) return onward(next);
    return this.page(true);
  }

  private page(used: boolean): Response {
    const m = MESSAGES[this.language()].notOwner;
    const html = `<!doctype html>
<html lang="${this.language()}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${m.title}</title>
<style>
:root { color-scheme: light dark; font: 17px/1.45 -apple-system, system-ui, sans-serif; }
body { margin: 0; padding: 12vh 24px; max-width: 34rem; margin-inline: auto; }
h1 { font-size: 1.3rem; margin: 0 0 1rem; }
.used { color: #d33; }
</style></head>
<body><h1>${m.heading}</h1>
${used ? `<p class="used">${m.used}</p>` : ''}<p>${m.how}</p>
</body></html>`;
    return new Response(html, { status: 401, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
  }
}
