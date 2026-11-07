// Pages Seismic shows in a sandboxed frame (a worker's HTML artifact, an idea's mock): they tell the
// page around them their height, so the frame grows to it instead of scrolling inside, and on
// Seismic's own page what the owner marks in them, to quote it; they load nothing from the internet.

/**
 * What a worker's page may load (an HTML artifact, an answer's page, an idea's mock): the files beside
 * it, where it has some (`own`: the address they are served from), inline styles and scripts, `data:`
 * and `blob:`, and nothing from anywhere else, be it a CDN, a font host or any other server, by
 * `fetch`, an image, a font, a script, a form or a frame alike. An agent steered by text it read (a
 * comment, a file) could otherwise write a page that sends what it read to another server the moment
 * the owner opens the card; writing a file passes the checks a `curl` to that server would not. The
 * address is named beside `'self'`: in a sandbox Safari matches `'self'` against the page's own
 * origin, which is `null`. A frame navigating itself elsewhere is stopped by `FRAMES_POLICY` of the
 * page around it; what a CSP does not reach (a connection opened ahead with `preconnect`, whose host
 * name alone can carry data; WebRTC) by `Connection-Allowlist`, which the server sends beside it.
 */
export function pagePolicy(own?: string): string {
  const here = own ? `'self' ${own} ` : '';
  return `default-src ${here}data: blob:; script-src ${here}'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' data: blob:; style-src ${here}'unsafe-inline' data: blob:; form-action 'none'`;
}

/** What Seismic's page (`src/ui/index.html`) may show in its frames: its own addresses, where the workers' pages are served, and nothing a frame navigates to elsewhere. */
export const FRAMES_POLICY = "frame-src 'self' data: blob:";

/**
 * A page that loads its own files alone, those at `own` (none: a page without files of its own): the
 * policy comes first, so nothing in the page (a comment, a `<head>` of its own) can push it out of
 * the head, where alone the browser heeds it; the page's own doctype, `<html>` and `<head>` after it
 * only add their attributes. It says UTF-8 ahead of the page too, for a page opened from disk, whose
 * own `<meta charset>` may come too late after the policy.
 */
export function sealed(html: string, own?: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${pagePolicy(own)}"><meta http-equiv="x-dns-prefetch-control" content="off">${html}`;
}

/**
 * The page's height, sent to the page around it whenever it changes, by a pixel too: there the
 * frame grows to it. Rounded up (a page a fraction of a pixel higher than its frame scrolls), and a
 * page wider than its frame adds the scrollbar across its foot. Once its frame holds its height, the
 * page does not scroll up and down: a page whose images grow with its width fits beside a scrollbar
 * but not without one, and kept a bar that scrolled by a few pixels. It still scrolls sideways,
 * where it is wider than its frame (a wide table on a phone).
 * The height is the page's own, never the frame's: always without that bar, and from `scrollHeight`
 * (what reaches below the page's box, a box placed absolutely) only where that is more than the
 * frame, since below it `scrollHeight` is the frame's height; where the frame is higher, the height
 * said before stands until the page's box changes. The page hears of its frame's new height a step
 * late, and a page of images as wide as itself, measured beside the bar or at the frame's height,
 * had its frame jump between two heights for a second. A frame not laid out yet says nothing and
 * asks again shortly: one out of sight hears of no change of its own until it comes into sight.
 * The frame's own measures come from the scrolling element, not the root: a page without a doctype
 * renders in quirks mode, where the root's are the page's, and its frame stayed at its first height.
 */
const HEIGHT_REPORT = `<script>(() => {
  let last = 0, box = -1, again = 0;
  const say = () => {
    const html = document.documentElement;
    if (!innerHeight || !innerWidth) { again ||= setTimeout(() => { again = 0; say(); }, 200); return; }
    const view = document.scrollingElement || html;
    html.style.setProperty('overflow-y', 'hidden');
    const own = Math.ceil(html.getBoundingClientRect().height);
    const bar = innerHeight - view.clientHeight;
    const h = view.scrollHeight > view.clientHeight ? Math.max(own, view.scrollHeight) + bar : own === box ? last : own + bar;
    box = own;
    if (h !== last) { last = h; parent.postMessage({ obeyaHeight: h }, '*'); }
    if (innerHeight < h) html.style.removeProperty('overflow-y');
  };
  addEventListener('load', say);
  addEventListener('resize', say);
  new ResizeObserver(say).observe(document.documentElement);
})();</script>`;

/** The page with its height report, at the end of its body (or of the page, without one). */
export function withHeightReport(html: string): string {
  const at = html.toLowerCase().lastIndexOf('</body>');
  return at < 0 ? html + HEIGHT_REPORT : html.slice(0, at) + HEIGHT_REPORT + html.slice(at);
}

/** Install image enlargement on every artifact page, independently of height reporting. */
const IMAGE_VIEWER = `<script>(() => {
  let viewer, origin;
  const close = () => { if (!viewer) return; viewer.remove(); viewer = null; if (origin && origin.isConnected) origin.focus({ preventScroll: true }); origin = null; parent.postMessage({ obeyaImage: false }, '*'); };
  const open = (img) => {
    if (viewer) return;
    origin = img;
    viewer = document.createElement('div');
    viewer.setAttribute('role', 'dialog'); viewer.setAttribute('aria-label', img.alt || 'Image');
    viewer.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.92);display:flex;align-items:center;justify-content:center;cursor:zoom-out;padding:48px;box-sizing:border-box';
    const copy = document.createElement('img'); copy.src = img.currentSrc || img.src; copy.alt = img.alt;
    copy.style.cssText = 'all:initial !important;display:block !important;width:auto !important;height:auto !important;max-width:100% !important;max-height:100% !important;object-fit:contain !important';
    viewer.append(copy); viewer.addEventListener('click', close); document.body.append(viewer);
    parent.postMessage({ obeyaImage: true }, '*');
  };
  addEventListener('message', (e) => { if (e.source === parent && e.data && e.data.obeyaCloseImage) close(); });
  document.addEventListener('click', (e) => { const img = e.target.closest('img'); if (img && !viewer && !img.closest('a,button')) open(img); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && viewer) { e.preventDefault(); e.stopPropagation(); close(); } else if (e.key === 'Tab' && viewer) { e.preventDefault(); parent.postMessage({ obeyaImageFocus: true }, '*'); } else if ((e.key === 'Enter' || e.key === ' ') && e.target.tagName === 'IMG' && !e.target.closest('a,button') && !viewer) { e.preventDefault(); open(e.target); } });
  const prepare = () => document.querySelectorAll('img:not([data-obeya-image])').forEach((img) => { if (img.closest('a,button')) return; img.dataset.obeyaImage = '1'; if (!img.hasAttribute('tabindex')) img.tabIndex = 0; img.style.cursor = 'zoom-in'; img.setAttribute('role', 'button'); });
  new MutationObserver(prepare).observe(document.documentElement, {childList:true, subtree:true});
  addEventListener('load', prepare);
})();</script>`;
export function withImageViewer(html: string): string {
  const at = html.toLowerCase().lastIndexOf('</body>');
  return at < 0 ? html + IMAGE_VIEWER : html.slice(0, at) + IMAGE_VIEWER + html.slice(at);
}

/**
 * What the owner marks in the page, sent to Seismic's page around it, where a button beside it quotes
 * it into the card's field (`CiteButton` in src/ui/cite.tsx): the text, its first and last line in
 * the frame's window, and whether it was marked backwards; null once nothing is marked. While the
 * mouse still drags it out, the marking is not said. `{ obeyaUnmark }` from the page around takes the
 * marking away, as a click elsewhere there would on a page of its own.
 */
const MARK_REPORT = `<script>(() => {
  let last = 'null', down = false;
  const tell = (m) => {
    const now = JSON.stringify(m);
    if (now !== last) { last = now; parent.postMessage({ obeyaMarked: m }, '*'); }
  };
  const say = () => {
    if (down) return;
    const s = getSelection();
    if (!s || s.isCollapsed || !s.rangeCount) return tell(null);
    const r = s.getRangeAt(0);
    const lines = [...r.getClientRects()].filter((c) => c.width > 0);
    const text = s.toString();
    if (!text.trim() || !lines.length) return tell(null);
    const at = (c) => [c.left, c.top, c.right, c.bottom];
    tell({ text, first: at(lines[0]), last: at(lines[lines.length - 1]), backwards: s.anchorNode === r.endContainer && s.anchorOffset === r.endOffset });
  };
  document.addEventListener('selectionchange', say);
  addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse') { down = true; tell(null); } }, true);
  addEventListener('pointerup', () => { if (down) { down = false; say(); } }, true);
  addEventListener('blur', () => { if (down) { down = false; say(); } });
  addEventListener('scroll', say, true);
  addEventListener('resize', say);
  addEventListener('message', (e) => { if (e.source === parent && e.data && e.data.obeyaUnmark) getSelection().removeAllRanges(); });
})();</script>`;

/** The page with its marking report (`MARK_REPORT`), for a page shown on Seismic's own page: at the end of its body, or of the page without one. */
export function withMarkReport(html: string): string {
  const at = html.toLowerCase().lastIndexOf('</body>');
  return at < 0 ? html + MARK_REPORT : html.slice(0, at) + MARK_REPORT + html.slice(at);
}

/**
 * The height of a mock's content, not of its frame's window (that one only grows as the frame does):
 * a frame laid out narrow first shrinks back once it is wide.
 */
const CONTENT_HEIGHT_REPORT = `<script>(() => {
  let last = 0;
  const say = () => {
    const h = Math.ceil(document.body.getBoundingClientRect().height) + 16;
    if (Math.abs(h - last) > 2) { last = h; parent.postMessage({ obeyaHeight: h }, '*'); }
  };
  addEventListener('load', say);
  new ResizeObserver(say).observe(document.body);
})();</script>`;

/**
 * A mock's few lines of HTML as a page of their own, in a plain sans-serif on white; a mock that is a
 * whole page itself stays as it is. Either says what the owner marks in it (`MARK_REPORT`) and
 * loads nothing from the internet (`sealed`). The frame the page is written into has the same policy
 * already (`/api/mock-frame`); this one holds where the page is shown otherwise.
 */
export function mockPage(html: string): string {
  if (/<html[\s>]/i.test(html)) return sealed(withMarkReport(withHeightReport(html)));
  return sealed(`<style>body{margin:8px;display:flow-root;font:14px/1.4 system-ui,sans-serif;color:#222;background:#fff}</style></head><body>${html}${CONTENT_HEIGHT_REPORT}${MARK_REPORT}</body></html>`);
}
