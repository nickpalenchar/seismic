




/** Runs in the service worker: it uses nothing from outside this function. */
export function worker() {
  
  const sw = self as unknown as {
    addEventListener(type: string, fn: (e: any) => void): void;
    skipWaiting(): Promise<void>;
    clients: { claim(): Promise<void>; matchAll(o: object): Promise<any[]>; openWindow(url: string): Promise<unknown> };
    registration: { showNotification(title: string, o: object): Promise<void> };
  };
  const CACHE = 'seismic-shell';
  
  const WAIT_MS = 3000;
  
  let quiet = false;
  /** What is never kept: the API, signing in, pairing, the worker itself. */
  const fresh = (path: string) => path.startsWith('/api/') || path === '/login' || path === '/pair' || path === '/sw.js';

  
  const recent = new Set<string>();

  /**
   * Keeps `page` with the files it names (its scripts and styles), and drops those of the page kept
   * before, another build's: all of it or nothing, so the page kept always has its files.
   */
  async function keepShell(page: Response) {
    recent.clear();
    const html = await page.clone().text();
    const files = [...new Set([...html.matchAll(/(?:src|href)="(\/[^"/][^"]*)"/g)].map((m) => m[1]!))].filter((f) => !fresh(f));
    const got = await Promise.all(files.map((f) => fetch(f).then((r) => (r.ok ? r : null), () => null)));
    if (got.some((r) => !r)) return;
    const cache = await caches.open(CACHE);
    await Promise.all(files.map((f, i) => cache.put(f, got[i]!)));
    await cache.put('/', page);
    const keep = new Set(['/', ...files].map((f) => new URL(f, location.origin).href));
    for (const k of await cache.keys()) if (!keep.has(k.url) && !recent.has(k.url)) await cache.delete(k);
  }

  
  sw.addEventListener('install', (e) => {
    void sw.skipWaiting();
    e.waitUntil(fetch('/').then((r) => (r.ok && r.type === 'basic' ? keepShell(r) : undefined), () => {}));
  });
  sw.addEventListener('activate', (e) => e.waitUntil(sw.clients.claim()));

  sw.addEventListener('fetch', (e) => {
    const req = e.request as Request;
    const url = new URL(req.url);
    if (req.method !== 'GET' || url.origin !== location.origin || fresh(url.pathname)) return;
    const page = req.mode === 'navigate';
    
    if (page && url.pathname !== '/' && !url.pathname.startsWith('/p/') && !url.pathname.startsWith('/c/')) return;
    e.respondWith(load(req, page));
  });

  /** From the network, kept for later; from what was kept when the network fails or takes too long. */
  async function load(req: Request, page: boolean): Promise<Response> {
    const cache = await caches.open(CACHE);
    
    const kept = await cache.match(page ? '/' : req);
    if (kept && quiet && !page) return kept;
    let answered = false;
    let keptShown = false;
    
    
    
    const network = fetch(page ? new Request(req.url, { redirect: 'manual' }) : req).then((r) => {
      answered = true;
      if (page) quiet = false;
      if (r.ok && r.type === 'basic') {
        
        if (page && !keptShown) void keepShell(r.clone()).catch(() => {});
        if (!page) {
          recent.add(req.url);
          void cache.put(req, r.clone()).catch(() => {});
        }
      }
      return r;
    });
    if (!kept) return network;
    const keptNow = () => {
      keptShown = true;
      if (page && !answered) quiet = true;
      return kept;
    };
    return Promise.race([network.catch(keptNow), new Promise<Response>((done) => setTimeout(() => done(keptNow()), WAIT_MS))]);
  }

  sw.addEventListener('push', (e) => {
    let m: { title?: string; body?: string; url?: string; tag?: string } = {};
    try {
      m = e.data?.json() ?? {};
    } catch {}
    e.waitUntil(sw.registration.showNotification(m.title || 'Seismic', { body: m.body ?? '', tag: m.tag, icon: '/icons/180.png', data: { url: m.url ?? '/' } }));
  });

  
  sw.addEventListener('notificationclick', (e) => {
    e.notification.close();
    const url = new URL(e.notification.data?.url ?? '/', location.origin).href;
    e.waitUntil(
      (async () => {
        const [open] = await sw.clients.matchAll({ type: 'window', includeUncontrolled: true });
        if (!open) return void (await sw.clients.openWindow(url));
        await open.focus?.().catch(() => {});
        open.postMessage({ type: 'open', url });
      })(),
    );
  });
}
