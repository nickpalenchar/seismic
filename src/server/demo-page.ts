// The page a demo is shared on, for people who have never seen Seismic, in the demo's language: title, text, the video with
// its chapters and captions (or an HTML artifact in a frame), the pull request, or without one the
// commit it landed as. A repository's demo site is built from it (site.ts), and a repository
// without one exports it (share.ts): as a ZIP with the video or the artifact beside the page, or as
// one HTML file with everything inside.

import { type Dirent, existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { pagePolicy, sealed, withHeightReport, withImageViewer } from '../core/frame';
import interFont from '../ui/fonts/inter-latin-wght-normal.woff2' with { type: 'file' };
import interLicense from '../ui/fonts/LICENSE-Inter.txt' with { type: 'file' };
import { mmss } from '../../plugin/skills/demo/lib/timeline.ts';

/** The languages a page speaks: those a demo is narrated in. */
export type PageLanguage = 'en';

/** The page's own words, in the demo's language. */
export const PAGE_WORDS: Record<
  PageLanguage,
  {
    locale: string;
    captions: string;
    play: string;
    pr: string;
    /** The link to work that landed without a pull request: its commit, or the comparison over its commits. */
    commit: string;
    commits: string;
    ownWindow: string;
    demoOf: (day: string) => string;
    /** A page on a site (`site.ts`): when it was shared and by whom (git's name of the one whose Seismic shared it), the link to the overview; the overview's own words. */
    sharedOn: (day: string, by?: string) => string;
    allDemos: string;
    /** On the overview, after a page's date: who shared it. */
    by: (name: string) => string;
    overview: string;
    noDemos: string;
    /** A page with several demo versions: the first one's name in the list at the top, and the heading of each later one. */
    first: string;
    addendum: (at: string, timeZone?: string) => string;
    /** The line every page and the overview end in, before the link to Seismic's site; the overview's link to its feed. */
    recordedWith: string;
    feed: string;
    /** The overview's filter: its search field, how many of the pages it shows, copying their links, a page's link, none passing. */
    search: string;
    shown: string;
    copyLinks: string;
    copyLinksHint: string;
    copyLink: string;
    copied: string;
    noMatch: string;
  }
> = {
  en: {
    locale: 'en-US',
    captions: 'English',
    play: 'Play',
    pr: 'View pull request',
    commit: 'View commit',
    commits: 'View commits',
    ownWindow: 'Open in its own window',
    demoOf: (day) => `Demo from ${day}`,
    sharedOn: (day, by) => (by ? `Shared by ${by} on ${day}` : `Shared on ${day}`),
    allDemos: 'All demos',
    by: (name) => `by ${name}`,
    overview: 'Videos and analyses of changes, the newest first.',
    noDemos: 'No demos shared yet.',
    first: 'Demo',
    addendum: (at, timeZone) => {
      const t = timeParts(at, 'en-US', 'short', timeZone);
      return `Addendum of ${t.month} ${t.day} at ${t.hour}:${t.minute}`;
    },
    recordedWith: 'Recorded with',
    feed: 'Subscribe to the feed',
    search: 'Search …',
    shown: '{n} of {m}',
    copyLinks: 'Copy links',
    copyLinksHint: 'Copies the demos shown as a list of titles and links, for a mail, a document or Markdown',
    copyLink: 'Copy link',
    copied: 'Copied',
    noMatch: 'No demo matches the filter.',
  },
};

/**
 * The day, month, hour and minute of a time in a time zone (the machine's without one), each as the
 * locale writes it; the page joins them itself, since how a platform's ICU data joins them differs
 * (macOS says "Jan 15 at 12:00", Linux "Jan 15, 12:00").
 */
function timeParts(at: string, locale: string, month: 'numeric' | 'short', timeZone?: string): Record<'day' | 'month' | 'hour' | 'minute', string> {
  const f = new Intl.DateTimeFormat(locale, { month, day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', ...(timeZone ? { timeZone } : {}) });
  const parts = Object.fromEntries(f.formatToParts(new Date(at)).map((p) => [p.type, p.value]));
  return { day: parts.day ?? '', month: parts.month ?? '', hour: parts.hour ?? '', minute: parts.minute ?? '' };
}

/** Work that landed without a pull request, on its forge: its commit, or the comparison over its commits (`several`). */
export interface PageCommit {
  url: string;
  several?: true;
}

/** What a page shows of every demo, a video or an HTML artifact. */
interface PageParts {
  title: string;
  /** Paragraphs separated by blank lines. */
  text: string;
  pr: string | null;
  /** Without a pull request: where the work landed on the default branch, once it has. */
  commit?: PageCommit | null;
  /** The line under the title (when it was shared, and by whom). */
  when: string;
  /** The browser tab's title. */
  tabTitle: string;
  /** The demo's language, which the page's own words and the captions' name are in; English without one. */
  language?: PageLanguage;
  /** A link above the title (say, to all demos). */
  top?: { href: string; text: string };
  /** The page's tags, by dimension, each a link (say, to the overview showing the pages with it). */
  tags?: { dimension: string; value: string; href: string }[];  /** A page of an unlisted site: kept out of search engines, and its links send no referrer. */
  unlisted?: true;
  /** The theme of the card's repository (theme.ts): its CSS, after Seismic's own style. */
  theme?: string;
}

export interface DemoPageParts extends PageParts {
  chapters: [number, string][];
  /** The video's URL, or its bytes in base64 for a page that holds everything. */
  video: { src: string } | { base64: string };
  poster?: string;
  /**
   * The captions' URL, or their text in the page: a page opened from disk may not load a `<track>`
   * (Chrome treats `file:` as another origin), so those come as cues from a script.
   */
  captions: { src: string } | { vtt: string };
}

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** The text's paragraphs as HTML. */
export const paragraphs = (text: string) =>
  text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${esc(p)}</p>`)
    .join('\n');
/** The link to the change: its pull request, or without one the commit (the commits) it landed as; '' before either. */
const changeLink = (p: Pick<PageParts, 'pr' | 'commit'>, w: (typeof PAGE_WORDS)[PageLanguage]) =>
  p.pr ? `<a href="${esc(p.pr)}">${w.pr}</a>` : p.commit ? `<a href="${esc(p.commit.url)}">${p.commit.several ? w.commits : w.commit}</a>` : '';
/** Text inside a `<script>` element must not close it. */
const inScript = (s: string) => s.replace(/<\//g, '<\\/');

export const day = (at: Date | string, language: PageLanguage = 'en') =>
  new Date(at).toLocaleDateString(PAGE_WORDS[language].locale, { day: 'numeric', month: 'long', year: 'numeric' });

/**
 * Inter (OFL) inlined as a `data:` URL, so a page shows it without the viewer having it installed, and
 * a page opened from disk or sealed by `pagePolicy` needs no file beside it. Its copyright notice and
 * licence travel with it as a comment in the same stylesheet, as the OFL asks of every copy.
 */
const INTER_FACE = `/* Inter font, embedded below:\n${readFileSync(interLicense, 'utf8').replace(/\*\//g, '* /')}*/\n  @font-face { font-family: Inter; font-style: normal; font-weight: 100 900; font-display: swap; src: url(data:font/woff2;base64,${readFileSync(interFont).toString('base64')}) format("woff2"); }`;

export const PAGE_STYLE = `
  ${INTER_FACE}
  :root {
    --bg: #e6edf5;
    --board: radial-gradient(1100px 800px at 12% 18%, rgba(140,185,255,.22), transparent 60%),
      radial-gradient(900px 700px at 88% 30%, rgba(255,190,220,.14), transparent 60%),
      radial-gradient(1000px 900px at 60% 95%, rgba(150,230,220,.18), transparent 60%);
    --card: rgba(255, 255, 255, 0.82);
    --card-hover: #ffffff;
    --ink: #14202e;
    --muted: #5a6b80;
    --line: rgba(120, 145, 175, 0.28);
    --chip: rgba(120, 150, 190, 0.14);
    --chip-hover: rgba(120, 150, 190, 0.24);
    --accent: #0b8b93;
    --accent-glow: rgba(11, 139, 147, 0.3);
    --on-ink: #ffffff;
    --shadow: 0 1px 3px rgba(30, 55, 90, 0.08), 0 8px 24px -10px rgba(40, 70, 110, 0.18);
    --lift: 0 2px 6px rgba(30, 55, 90, 0.1), 0 16px 36px -12px rgba(40, 70, 110, 0.28);
    --glow-text: 0 1px 2px rgba(30, 55, 90, 0.12);
    color-scheme: light;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0d1420;
      --board: radial-gradient(1100px 800px at 12% 18%, rgba(50,90,180,.18), transparent 60%),
        radial-gradient(900px 700px at 88% 30%, rgba(130,60,150,.10), transparent 60%),
        radial-gradient(1000px 900px at 60% 95%, rgba(20,120,130,.12), transparent 60%);
      --card: rgba(18, 28, 44, 0.78);
      --card-hover: rgba(26, 40, 62, 0.92);
      --ink: #e6eef8;
      --muted: #8fa3bb;
      --line: rgba(160, 205, 255, 0.16);
      --chip: rgba(140, 185, 240, 0.12);
      --chip-hover: rgba(140, 185, 240, 0.22);
      --accent: #2fc2c0;
      --accent-glow: rgba(47, 194, 192, 0.45);
      --on-ink: #0b111a;
      --shadow: 0 1px 3px rgba(0, 0, 0, 0.4), 0 12px 28px -8px rgba(0, 0, 0, 0.7);
      --lift: 0 2px 6px rgba(0, 0, 0, 0.5), 0 18px 40px -10px rgba(0, 0, 0, 0.85), 0 0 14px rgba(47, 194, 192, 0.2);
      --glow-text: 0 0 14px rgba(47, 194, 192, 0.45), 0 0 28px rgba(106, 162, 255, 0.25);
      color-scheme: dark;
    }
  }
  :where([data-theme="light"]) {
    --bg: #e6edf5;
    --board: radial-gradient(1100px 800px at 12% 18%, rgba(140,185,255,.22), transparent 60%),
      radial-gradient(900px 700px at 88% 30%, rgba(255,190,220,.14), transparent 60%),
      radial-gradient(1000px 900px at 60% 95%, rgba(150,230,220,.18), transparent 60%);
    --card: rgba(255, 255, 255, 0.82);
    --card-hover: #ffffff;
    --ink: #14202e;
    --muted: #5a6b80;
    --line: rgba(120, 145, 175, 0.28);
    --chip: rgba(120, 150, 190, 0.14);
    --chip-hover: rgba(120, 150, 190, 0.24);
    --accent: #0b8b93;
    --accent-glow: rgba(11, 139, 147, 0.3);
    --on-ink: #ffffff;
    --shadow: 0 1px 3px rgba(30, 55, 90, 0.08), 0 8px 24px -10px rgba(40, 70, 110, 0.18);
    --lift: 0 2px 6px rgba(30, 55, 90, 0.1), 0 16px 36px -12px rgba(40, 70, 110, 0.28);
    --glow-text: 0 1px 2px rgba(30, 55, 90, 0.12);
    color-scheme: light;
  }
  :where([data-theme="dark"]) {
    --bg: #0d1420;
    --board: radial-gradient(1100px 800px at 12% 18%, rgba(50,90,180,.18), transparent 60%),
      radial-gradient(900px 700px at 88% 30%, rgba(130,60,150,.10), transparent 60%),
      radial-gradient(1000px 900px at 60% 95%, rgba(20,120,130,.12), transparent 60%);
    --card: rgba(18, 28, 44, 0.78);
    --card-hover: rgba(26, 40, 62, 0.92);
    --ink: #e6eef8;
    --muted: #8fa3bb;
    --line: rgba(160, 205, 255, 0.16);
    --chip: rgba(140, 185, 240, 0.12);
    --chip-hover: rgba(140, 185, 240, 0.22);
    --accent: #2fc2c0;
    --accent-glow: rgba(47, 194, 192, 0.45);
    --on-ink: #0b111a;
    --shadow: 0 1px 3px rgba(0, 0, 0, 0.4), 0 12px 28px -8px rgba(0, 0, 0, 0.7);
    --lift: 0 2px 6px rgba(0, 0, 0, 0.5), 0 18px 40px -10px rgba(0, 0, 0, 0.85), 0 0 14px rgba(47, 194, 192, 0.2);
    --glow-text: 0 0 14px rgba(47, 194, 192, 0.45), 0 0 28px rgba(106, 162, 255, 0.25);
    color-scheme: dark;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background-color: var(--bg);
    background-image: var(--board);
    background-attachment: fixed;
    color: var(--ink);
    font: 15px/1.55 Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    -webkit-font-smoothing: antialiased;
    min-height: 100vh;
  }
  main { max-width: 1080px; margin: 0 auto; padding: 36px 24px 64px; }
  a { color: var(--accent); text-decoration: underline; text-underline-offset: 0.2em; text-decoration-thickness: 1px; transition: color 0.15s, text-shadow 0.15s, text-decoration-color 0.15s; }
  a:hover, a:focus-visible { text-shadow: 0 0 8px var(--accent-glow); }
  .top { font-size: 13px; color: var(--muted); margin-bottom: 20px; }
  .top a { color: var(--accent); text-decoration: underline; text-underline-offset: 0.2em; text-decoration-thickness: 1px; }
  .top a:hover, .top a:focus-visible { text-shadow: 0 0 8px var(--accent-glow); }
  h1 { font: 650 32px/1.2 Inter, system-ui, -apple-system, sans-serif; letter-spacing: -0.02em; margin: 0 0 8px; color: var(--ink); text-shadow: var(--glow-text); }
  .when { color: var(--muted); font-size: 13px; margin-bottom: 18px; letter-spacing: -0.005em; }
  .text p { margin: 0 0 12px; max-width: 72ch; line-height: 1.6; }
  .grid { display: grid; grid-template-columns: minmax(0, 1fr) 280px; gap: 24px; margin-top: 24px; align-items: start; }
  @media (max-width: 800px) {
    main { padding: 24px 16px 48px; }
    h1 { font-size: 26px; }
    .grid { grid-template-columns: 1fr; gap: 18px; }
  }
  video { width: 100%; border-radius: 12px; background: #000; display: block; border: 1px solid var(--line); box-shadow: var(--shadow); }
  .player { position: relative; border-radius: 12px; }
  .start { all: unset; position: absolute; inset: 0 0 56px 0; cursor: pointer; display: grid; place-items: center; }
  .start[hidden] { display: none; }
  .start span {
    margin-top: 56px; width: 80px; height: 80px; border-radius: 50%;
    background: rgba(13, 20, 32, 0.75); border: 1.5px solid var(--accent);
    box-shadow: 0 0 20px var(--accent-glow); display: grid; place-items: center;
    transition: transform 0.18s, background 0.18s, box-shadow 0.18s;
  }
  @media (prefers-color-scheme: light) {
    .start span { background: rgba(255, 255, 255, 0.85); box-shadow: 0 2px 12px rgba(30, 55, 90, 0.2); }
  }
  .start:hover span { transform: scale(1.08); box-shadow: 0 0 28px var(--accent); }
  .start svg { width: 32px; height: 32px; margin-left: 5px; fill: var(--accent); filter: drop-shadow(0 0 4px var(--accent-glow)); }
  ol { list-style: none; margin: 0; padding: 6px; background: var(--card); border: 1px solid var(--line); border-radius: 12px; box-shadow: var(--shadow); }
  ol button { all: unset; cursor: pointer; display: flex; gap: 10px; width: 100%; padding: 8px 10px; border-radius: 8px; font-size: 13.5px; box-sizing: border-box; color: var(--ink); transition: background 0.12s, color 0.12s, text-shadow 0.12s; }
  ol button:hover { background: var(--chip); }
  ol button.on { background: var(--chip); color: var(--accent); font-weight: 600; text-shadow: 0 0 10px var(--accent-glow); }
  ol .t { color: var(--muted); font-variant-numeric: tabular-nums; min-width: 36px; }
  ol button.on .t { color: var(--accent); }
  .pr { margin-top: 14px; font-size: 13.5px; }
  .pr a { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; background: var(--card); border: 1px solid var(--line); border-radius: 8px; color: var(--accent); text-decoration: underline; text-underline-offset: 0.2em; text-decoration-thickness: 1px; box-shadow: var(--shadow); transition: border-color 0.15s, box-shadow 0.15s, text-shadow 0.15s; }
  .pr a:hover, .pr a:focus-visible { border-color: var(--accent); box-shadow: var(--lift); text-shadow: 0 0 8px var(--accent-glow); }
  ul.demos { list-style: none; padding: 0; margin: 0; display: grid; gap: 12px; }
  ul.demos a { display: block; background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 16px 20px; color: var(--ink); text-decoration: none; box-shadow: var(--shadow); transition: transform 0.15s, box-shadow 0.15s, border-color 0.15s, background 0.15s; }
  ul.demos a:hover, ul.demos a:focus-visible { border-color: var(--accent); background: var(--card-hover); transform: translateY(-2px); box-shadow: var(--lift); }
  ul.demos b { display: block; font: 620 18px/1.3 Inter, system-ui, -apple-system, sans-serif; letter-spacing: -0.012em; margin-bottom: 4px; color: var(--accent); text-decoration: underline; text-underline-offset: 0.2em; text-decoration-thickness: 1px; transition: color 0.15s, text-shadow 0.15s; }
  ul.demos a:hover b, ul.demos a:focus-visible b { text-shadow: var(--glow-text); }
  ul.demos span { color: var(--muted); font-size: 13.5px; line-height: 1.45; }
  .artifact { margin-top: 24px; background: var(--card); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; box-shadow: var(--shadow); }
  .artifact iframe { display: block; width: 100%; height: 80vh; border: 0; }
  body.alone main { max-width: none; padding: 0; }
  body.alone main > :not(.artifact) { display: none; }
  body.alone .artifact { margin: 0; border: 0; border-radius: 0; box-shadow: none; }
  body.alone .artifact iframe { height: 100vh; }
  .links { margin-top: 12px; font-size: 13.5px; display: flex; gap: 12px; flex-wrap: wrap; }
  .links a { display: inline-flex; align-items: center; padding: 6px 14px; background: var(--card); border: 1px solid var(--line); border-radius: 8px; color: var(--accent); text-decoration: underline; text-underline-offset: 0.2em; text-decoration-thickness: 1px; box-shadow: var(--shadow); transition: border-color 0.15s, box-shadow 0.15s, text-shadow 0.15s; }
  .links a:hover, .links a:focus-visible { border-color: var(--accent); box-shadow: var(--lift); text-shadow: 0 0 8px var(--accent-glow); }
  .tags { display: flex; flex-wrap: wrap; gap: 8px; margin: -4px 0 18px; }
  .tag { font-size: 12.5px; font-weight: 500; line-height: 1.5; padding: 3px 12px; border-radius: 999px; background: var(--card); color: var(--accent); text-decoration: underline; text-underline-offset: 0.18em; text-decoration-thickness: 1px; border: 1px solid var(--line); box-shadow: var(--shadow); transition: border-color 0.15s, box-shadow 0.15s, color 0.15s, text-shadow 0.15s; }
  a.tag:hover, a.tag:focus-visible { border-color: var(--accent); box-shadow: 0 0 8px var(--accent-glow); text-shadow: 0 0 8px var(--accent-glow); }
  .tag span { color: var(--muted); margin-right: 2px; }
  .credit { margin-top: 56px; padding-top: 20px; border-top: 1px solid var(--line); font-size: 13px; color: var(--muted); }
  .credit a { color: var(--accent); font-weight: 500; text-decoration: underline; text-underline-offset: 0.2em; text-decoration-thickness: 1px; }
`;

/** A repository's theme (theme.ts) in a page's head, after Seismic's own style, so it wins; nothing in it may close its element. */
export const themeStyle = (css?: string) => (css ? `<style>${css.replace(/<\/(style)/gi, '<\\/$1')}</style>` : '');

/** Seismic's site, which every page and the overview link at their end. */
export const OBEYA_URL = 'https://obeya.si';

/** The line every page and the overview end in: what made them, linking Seismic's site. */
export const credit = (language: PageLanguage) => `<footer class="credit">${PAGE_WORDS[language].recordedWith} <a href="${OBEYA_URL}">Seismic</a></footer>
`;

// the cues of captions held in the page, for a page opened from disk
const CUES = (language: PageLanguage) => `
  const vtt = document.getElementById('captions').textContent;
  const track = v.addTextTrack('captions', ${JSON.stringify(PAGE_WORDS[language].captions)}, ${JSON.stringify(language)});
  const sec = (t) => t.split(':').reduce((a, x) => a * 60 + Number(x), 0);
  for (const block of vtt.replace(/\\r/g, '').split(/\\n\\s*\\n/)) {
    const lines = block.split('\\n');
    const at = lines.findIndex((l) => l.includes('-->'));
    if (at < 0) continue;
    const [from, to] = lines[at].split('-->').map((s) => sec(s.trim().split(/\\s+/)[0]));
    track.addCue(new VTTCue(from, to, lines.slice(at + 1).join('\\n')));
  }
`;

// A host that serves no byte ranges (Cloudflare Pages answers a range request with the whole file)
// leaves a video a browser cannot seek in (it jumps back): then the page loads the video once and
// plays it from memory. A page opened from disk cannot fetch it and needs not.
const SEEKABLE = (src: string) => `
  const seekable = fetch(${JSON.stringify(src)}, { headers: { Range: 'bytes=0-' } }).then(async (r) => {
    if (r.status === 206) return r.body?.cancel();
    const url = URL.createObjectURL(await r.blob()), at = v.currentTime, playing = !v.paused;
    v.src = url; v.currentTime = at;
    if (playing) v.play();
  }).catch(() => {});
`;

// the video's bytes held in the page, played from a blob so it can seek
const BLOB = `
  const b64 = document.getElementById('video').textContent.trim();
  const bin = atob(b64), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  v.src = URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }));
`;

/** The page of an HTML artifact: title and text above it, the artifact in a frame below. */
export interface ArtifactPageParts extends PageParts {
  /** The artifact's page beside this one, or its HTML for a page that holds everything. */
  artifact: { src: string } | { html: string };
  /** A page passed on as a file (the ZIP), opened from disk. */
  disk?: boolean;
}

/** Where the files beside a page opened from disk (the ZIP) are: `'self'` need not match `file:`. */
export const ON_DISK = 'file:';

/**
 * The artifact runs in a sandboxed frame, an origin of its own, so its scripts reach neither the
 * page nor the site; it opens no window, and "Open in its own window" is this page with the
 * frame alone (`?alone`), not the artifact's own file, which would run in the site's origin. The
 * frame grows to the artifact's height where the artifact says it (`withHeightReport`); without
 * that it stays at 80 % of the window and scrolls. Opened from disk (`disk`), the frame keeps the
 * page's origin: there is no site to keep it from, and Chrome loads nothing beside a sandboxed page
 * from disk, not even its stylesheets and images. The artifact sends nothing elsewhere: its copy
 * starts with its policy (`sealed` in src/core/frame.ts, `pagePolicy` there), and the page's own policy lets the frame show nothing but
 * the page's own files, so the artifact cannot navigate it to another server either (a frame given
 * as `srcdoc` has the page's policy as well as its own).
 */
export function artifactPageHtml(p: ArtifactPageParts): string {
  const language = p.language ?? 'en';
  const w = PAGE_WORDS[language];
  const frame =
    'src' in p.artifact
      ? `<iframe ${p.disk ? '' : `src="${esc(p.artifact.src)}" `}sandbox="allow-scripts" title="${esc(p.title)}"></iframe>`
      : `<iframe srcdoc="${esc(sealed(withImageViewer(withHeightReport(p.artifact.html))))}" sandbox="allow-scripts" title="${esc(p.title)}"></iframe>`;
  const links = [
    'src' in p.artifact ? `<a href="?alone" target="_blank" rel="noopener">${w.ownWindow}</a>` : '',
    changeLink(p, w),
  ].filter(Boolean);
  return `${pageStart(p, language, pagePolicy(ON_DISK))}${links.length ? `<div class="links">${links.join('')}</div>\n` : ''}<div class="artifact">${frame}</div>
${credit(language)}</main>
<script>
  // an artifact as high as its window (100vh plus a margin) would grow with each step: it stops after a few
  const f = document.querySelector('.artifact iframe');${
    p.disk && 'src' in p.artifact
      ? `
  if (location.protocol === 'file:') f.sandbox.add('allow-same-origin');
  f.src = ${JSON.stringify(p.artifact.src)};`
      : ''
  }
  const alone = new URLSearchParams(location.search).has('alone');
  if (alone) document.body.classList.add('alone');
  let steps = alone ? 30 : 0;
  ${IMAGE_FRAME_SCRIPT}
  addEventListener('message', (e) => {
    if (e.source === f.contentWindow && e.data && typeof e.data.obeyaImage === 'boolean') { imageFrame(f, e.data.obeyaImage); return; }
    const h = e.source === f.contentWindow && e.data && e.data.obeyaHeight;
    if (typeof h === 'number' && h > 0 && f.dataset.obeyaPreviousStyle === undefined && steps++ < 30) f.style.height = Math.min(Math.ceil(h), 30000) + 'px';
  });
</script>
</body></html>
`;
}

const IMAGE_FRAME_SCRIPT = `let imageClose, activeImageFrame, imagePlaceholder;
const closeImage = () => {
  const f = activeImageFrame;
  if (!f) return;
  f.setAttribute('style', f.dataset.obeyaPreviousStyle); delete f.dataset.obeyaPreviousStyle;
  imagePlaceholder.remove(); imagePlaceholder = null;
  imageClose.remove(); imageClose = null; activeImageFrame = null;
  f.contentWindow.postMessage({ obeyaCloseImage: true }, '*');
};
const imageFrame = (f, open) => {
  if (open && !activeImageFrame) {
    activeImageFrame = f;
    imagePlaceholder = document.createElement('div'); imagePlaceholder.style.cssText = 'height:' + f.offsetHeight + 'px;width:' + f.offsetWidth + 'px'; f.before(imagePlaceholder);
    f.dataset.obeyaPreviousStyle = f.getAttribute('style') || ''; f.style.cssText += ';position:fixed;inset:0;width:100vw;height:100vh;z-index:2147483646;border:0';
    imageClose = document.createElement('button'); imageClose.textContent = '×'; imageClose.setAttribute('aria-label', 'Close');
    imageClose.style.cssText = 'position:fixed;right:16px;top:12px;z-index:2147483647;color:white;background:#222;border:0;font:36px sans-serif;cursor:pointer'; imageClose.onclick = closeImage; document.body.append(imageClose); imageClose.focus();
  } else if (!open && f === activeImageFrame) closeImage();
};
addEventListener('keydown', (e) => { if (!imageClose) return; if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); closeImage(); } else if (e.key === 'Tab') { e.preventDefault(); imageClose.focus(); } }, true);
addEventListener('message', (e) => { if (activeImageFrame && e.source === activeImageFrame.contentWindow && e.data && e.data.obeyaImageFocus) imageClose.focus(); });`;

/** What an unlisted page's head says: no index, no referrer (the meta tags hold where a host sends no headers of the site's own, GitHub Pages). */
const UNLISTED_META = '<meta name="robots" content="noindex, nofollow"><meta name="referrer" content="no-referrer">';

/**
 * A page's start, down to the demo's text: its head (with its `policy`, if it has one), the link
 * above the title, the title, when it was shared. A page with a theme has a policy in any case, that
 * of a shared artifact's page, so nothing the theme names loads from elsewhere.
 */
function pageStart(p: PageParts, language: PageLanguage, policy?: string, style = '', list = ''): string {
  policy ??= p.theme ? pagePolicy(ON_DISK) : undefined;
  return `<!doctype html>
<html lang="${language}"><head><meta charset="utf-8">${policy ? `<meta http-equiv="Content-Security-Policy" content="${policy}">` : ''}<meta name="viewport" content="width=device-width, initial-scale=1">${p.unlisted ? UNLISTED_META : ''}
<title>${esc(p.tabTitle)}</title><style>${PAGE_STYLE}${style}</style>${themeStyle(p.theme)}</head>
<body><main>
${p.top ? `<div class="top"><a href="${esc(p.top.href)}">${esc(p.top.text)}</a></div>\n` : ''}<h1>${esc(p.title)}</h1>
<div class="when">${esc(p.when)}</div>
${p.tags?.length ? `<div class="tags">${p.tags.map((x) => `<a class="tag" href="${esc(x.href)}"><span>${esc(x.dimension)}</span> ${esc(x.value)}</a>`).join('')}</div>\n` : ''}${list}<div class="text">${paragraphs(p.text)}</div>
`;
}

export function demoPageHtml(p: DemoPageParts): string {
  const language = p.language ?? 'en';
  const w = PAGE_WORDS[language];
  const chapters = p.chapters.length
    ? `<ol>${p.chapters.map(([at, title], i) => `<li><button data-at="${at}"${i === 0 ? ' class="on"' : ''}><span class="t">${mmss(at)}</span>${esc(title)}</button></li>`).join('')}</ol>`
    : '';
  const src = 'src' in p.video ? ` src="${esc(p.video.src)}"` : '';
  const link = changeLink(p, w);
  const track = 'src' in p.captions ? `<track kind="captions" src="${esc(p.captions.src)}" srclang="${language}" label="${w.captions}">` : '';
  return `${pageStart(p, language)}<div class="grid">
  <div class="player"><video controls preload="metadata"${src}${p.poster ? ` poster="${esc(p.poster)}"` : ''}>${track}</video><button class="start" aria-label="${w.play}"><span><svg viewBox="0 0 24 24"><path d="M6 4l15 8-15 8z"/></svg></span></button></div>
  <div>${chapters}${link ? `<div class="pr">${link}</div>` : ''}</div>
</div>
${credit(language)}</main>
${'vtt' in p.captions ? `<script type="text/vtt" id="captions">${inScript(p.captions.vtt)}</script>\n` : ''}${'base64' in p.video ? `<script type="application/octet-stream" id="video">${p.video.base64}</script>\n` : ''}<script>
  const v = document.querySelector('video'), bs = [...document.querySelectorAll('ol button')];${'base64' in p.video ? `${BLOB}  const seekable = Promise.resolve();\n` : SEEKABLE(p.video.src)}${'vtt' in p.captions ? CUES(language) : ''}
  bs.forEach((b) => b.addEventListener('click', () => seekable.then(() => { v.currentTime = Number(b.dataset.at); v.play(); })));
  // a big play button over the video until it first plays: a click anywhere on it but its
  // controls starts it, instead of the small button in the corner
  const start = document.querySelector('.start');
  start.addEventListener('click', () => v.play());
  v.addEventListener('play', () => { start.hidden = true; });
  v.addEventListener('timeupdate', () => {
    let on = 0; bs.forEach((b, i) => { if (Number(b.dataset.at) <= v.currentTime + 0.05) on = i; });
    bs.forEach((b, i) => b.classList.toggle('on', i === on));
  });
</script>
</body></html>
`;
}

/** A demo version on a page with several: its title and text, and where its files are, relative to the page. */
export type StackedDemo = { title: string; text: string; base: string } & ({ kind: 'video'; chapters: [number, string][]; poster: boolean } | { kind: 'html' });

export interface StackedPageParts extends Omit<PageParts, 'title' | 'text'> {
  /** The first version, with the page's title and text, then each later one, with when it was handed over. */
  demos: [StackedDemo, ...(StackedDemo & { at: string })[]];
  /** The time zone the later ones' headings say the time in; this machine's without. */
  timeZone?: string;
}

/** The style a page with several demo versions adds: the list at the top, and each later version as an addendum. */
const STACK_STYLE = `
  .sections { font-size: 13.5px; color: var(--muted); margin: -8px 0 20px; display: flex; flex-wrap: wrap; gap: 6px 10px; }
  .sections a { display: inline-block; padding: 4px 12px; border-radius: 999px; background: var(--card); border: 1px solid var(--line); color: var(--accent); text-decoration: underline; text-underline-offset: 0.18em; text-decoration-thickness: 1px; font-size: 13px; font-weight: 500; box-shadow: var(--shadow); transition: border-color 0.15s, box-shadow 0.15s, color 0.15s, text-shadow 0.15s; }
  .sections a:hover, .sections a:focus-visible { border-color: var(--accent); box-shadow: 0 0 8px var(--accent-glow); text-shadow: 0 0 8px var(--accent-glow); }
  section.addendum { margin-top: 52px; padding-top: 28px; border-top: 1px solid var(--line); }
  section.addendum h2 { font-size: 12px; font-weight: 650; color: var(--accent); margin: 0 0 6px; text-transform: uppercase; letter-spacing: 0.08em; text-shadow: 0 0 10px var(--accent-glow); }
  section.addendum h3 { font: 650 24px/1.25 Inter, system-ui, -apple-system, sans-serif; letter-spacing: -0.015em; margin: 0 0 12px; text-shadow: var(--glow-text); }
  body.alone main > section.alone { display: block; }
  body.alone section.alone > :not(.artifact) { display: none; }
`;

/**
 * A page with several demo versions of one change, in order of handover: the first with the page's
 * title and text on top, each later one below as an addendum ("Addendum from …") with its own
 * title, text and video or artifact, and a list of them at the top. A page with one version is
 * `demoPageHtml` or `artifactPageHtml`. "Open in its own window" shows an artifact alone
 * (`?alone=<n>`, its place on the page).
 */
export function stackedPageHtml(p: StackedPageParts): string {
  const language = p.language ?? 'en';
  const w = PAGE_WORDS[language];
  const [first, ...later] = p.demos;
  const name = (i: number) => (i === 0 ? w.first : w.addendum(later[i - 1]!.at, p.timeZone));
  const list = `<nav class="sections">${p.demos.map((_, i) => `<a href="#v${i + 1}">${i + 1}. ${esc(name(i))}</a>`).join('')}</nav>
`;
  const block = (d: StackedDemo, i: number) => {
    const link = i === 0 ? changeLink(p, w) : '';
    if (d.kind === 'html')
      return `<div class="links"><a href="?alone=${i + 1}" target="_blank" rel="noopener">${w.ownWindow}</a>${link}</div>
<div class="artifact"><iframe src="${esc(d.base + ARTIFACT_DIR)}/index.html" sandbox="allow-scripts" title="${esc(d.title)}"></iframe></div>`;
    const chapters = d.chapters.length
      ? `<ol>${d.chapters.map(([at, title], j) => `<li><button data-at="${at}"${j === 0 ? ' class="on"' : ''}><span class="t">${mmss(at)}</span>${esc(title)}</button></li>`).join('')}</ol>`
      : '';
    return `<div class="grid">
  <div class="player"><video controls preload="metadata" src="${esc(d.base)}demo.mp4"${d.poster ? ` poster="${esc(d.base)}poster.jpg"` : ''}><track kind="captions" src="${esc(d.base)}captions.vtt" srclang="${language}" label="${w.captions}"></video><button class="start" aria-label="${w.play}"><span><svg viewBox="0 0 24 24"><path d="M6 4l15 8-15 8z"/></svg></span></button></div>
  <div>${chapters}${link ? `<div class="pr">${link}</div>` : ''}</div>
</div>`;
  };
  const artifacts = p.demos.some((d) => d.kind === 'html');
  return `${pageStart({ ...p, title: first.title, text: first.text }, language, artifacts ? pagePolicy(ON_DISK) : undefined, STACK_STYLE, list)}<section id="v1">
${block(first, 0)}
</section>
${later
  .map(
    (d, i) => `<section id="v${i + 2}" class="addendum">
<h2>${esc(name(i + 1))}</h2>
<h3>${esc(d.title)}</h3>
<div class="text">${paragraphs(d.text)}</div>
${block(d, i + 1)}
</section>`,
  )
  .join('\n')}
${credit(language)}</main>
<script>
  // each video: seekable on a host without byte ranges, its chapters, its big play button
  for (const g of document.querySelectorAll('.grid')) {
    const v = g.querySelector('video'), bs = [...g.querySelectorAll('ol button')], src = v.getAttribute('src');
    const seekable = fetch(src, { headers: { Range: 'bytes=0-' } }).then(async (r) => {
      if (r.status === 206) return r.body?.cancel();
      const url = URL.createObjectURL(await r.blob()), at = v.currentTime, playing = !v.paused;
      v.src = url; v.currentTime = at;
      if (playing) v.play();
    }).catch(() => {});
    bs.forEach((b) => b.addEventListener('click', () => seekable.then(() => { v.currentTime = Number(b.dataset.at); v.play(); })));
    const start = g.querySelector('.start');
    start.addEventListener('click', () => v.play());
    v.addEventListener('play', () => { start.hidden = true; });
    v.addEventListener('timeupdate', () => {
      let on = 0; bs.forEach((b, i) => { if (Number(b.dataset.at) <= v.currentTime + 0.05) on = i; });
      bs.forEach((b, i) => b.classList.toggle('on', i === on));
    });
  }
  // each artifact grows to its height, at most 30 steps; ?alone=<n> shows the one at that place alone
  const alone = new URLSearchParams(location.search).get('alone');
  const shown = alone === null ? null : document.getElementById('v' + (alone || '1'));
  if (shown && shown.querySelector('.artifact')) { document.body.classList.add('alone'); shown.classList.add('alone'); }
  const steps = new Map([...document.querySelectorAll('.artifact iframe')].map((f) => [f, shown && shown.contains(f) ? 30 : 0]));
  ${IMAGE_FRAME_SCRIPT}
  addEventListener('message', (e) => {
    const f = [...steps.keys()].find((f) => f.contentWindow === e.source);
    if (f && e.data && typeof e.data.obeyaImage === 'boolean') { imageFrame(f, e.data.obeyaImage); return; }
    const h = f && e.data && e.data.obeyaHeight;
    if (typeof h === 'number' && h > 0 && f.dataset.obeyaPreviousStyle === undefined && steps.get(f) < 30) { steps.set(f, steps.get(f) + 1); f.style.height = Math.min(Math.ceil(h), 30000) + 'px'; }
  });
</script>
</body></html>
`;
}

/** An HTML artifact's directory on a page, beside the page's `index.html`. */
export const ARTIFACT_DIR = 'artifact';

/**
 * A file of a demo's directory by its path there: the file itself where it is one and lies inside the
 * directory, else null. A link to a file outside counts as outside: the worker made the directory,
 * and what is in it is served, published and passed on.
 */
export function demoFile(dir: string, name: string): string | null {
  try {
    const root = realpathSync(dir);
    const path = realpathSync(resolve(root, name));
    return path.startsWith(root + sep) && statSync(path).isFile() ? path : null;
  } catch {
    return null;
  }
}

/** The files of an HTML artifact's directory, relative to it, without hidden ones; links only to a file inside it. */
export function artifactFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  // its own walk: one that follows a link to a directory may walk the whole disk
  const walk = (sub: string) => {
    for (const e of readdirSync(join(dir, sub), { withFileTypes: true }) as Dirent[]) {
      if (e.name.startsWith('.')) continue;
      const f = sub ? `${sub}/${e.name}` : e.name;
      if (e.isDirectory()) walk(f);
      else if (e.isFile() || (e.isSymbolicLink() && demoFile(dir, f))) out.push(f);
    }
  };
  walk('');
  return out.sort();
}
