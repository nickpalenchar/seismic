// A page that froze tells the server, which logs it beside its own stalls (design: Running Seismic,
// Stalls): how long, where the time went as far as the browser says (Chromium's long animation
// frames; Safari and Firefox tell only the length), and the server's messages it took in just before.

import type { PageStall } from '../core/types';

/** As the server's: a pause of half a second is one the owner notices. */
const STALL_MS = 500;
const TICK_MS = 100;
/** What the page did this long before a stall still counts as before it. */
const BEFORE_MS = 3000;
/** Without long animation frames to tell a freeze from a machine that slept, a pause this long is taken for sleep. */
const SLEPT_MS = 60_000;
const KEPT = 8;
/** Parts of a stall shorter than this say nothing of it. */
const PART_MS = 50;
/** The browser tells of a long frame shortly after it, not at once. */
const REPORTED_MS = 1000;

/** A long animation frame, as far as the page uses it (`PerformanceLongAnimationFrameTiming`). */
export interface LongFrame {
  startTime: number;
  duration: number;
  styleAndLayoutStart: number;
  scripts: { invoker: string; sourceURL: string; sourceFunctionName: string; sourceCharPosition: number; duration: number }[];
}

/** Something the page took in: a server message by its type and size. */
export interface Noted {
  at: number;
  what: string;
}

/** The long frames between `from` and `to`. */
export const framesWithin = (frames: LongFrame[], from: number, to: number) => frames.filter((f) => f.startTime + f.duration >= from && f.startTime <= to);

/** Where the time of these long frames went: their scripts and their style and layout, longest first. */
export function scriptsOf(frames: LongFrame[]): PageStall['scripts'] {
  const ms = new Map<string, number>();
  const add = (what: string, d: number) => d > 0 && ms.set(what, (ms.get(what) ?? 0) + d);
  for (const f of frames) {
    for (const s of f.scripts) {
      const file = s.sourceURL.split(/[?#]/)[0]!.split('/').pop();
      const at = file ? ` (${file}${s.sourceCharPosition >= 0 ? `@${s.sourceCharPosition}` : ''})` : '';
      add(`${s.invoker}: ${s.sourceFunctionName || '(anonymous)'}${at}`, s.duration);
    }
    if (f.styleAndLayoutStart > 0) add('style and layout', f.startTime + f.duration - f.styleAndLayoutStart);
  }
  return [...ms]
    .filter(([, d]) => d >= PART_MS)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([what, d]) => ({ what, ms: Math.round(d) }));
}

/**
 * What the page took in shortly before a stall from `from` to `to`, as the log reads it; a message
 * whose handling began the stall is in it too (its reading time says so).
 */
export function beforeOf(noted: Noted[], from: number, to: number): string[] {
  return noted
    .filter((n) => n.at >= from - BEFORE_MS && n.at <= to)
    .map((n) => `${n.what} ${(Math.max(0, from - n.at) / 1000).toFixed(1)} s before`);
}

const noted: Noted[] = [];

/** A server message the page began to handle at `at`: `bytes` long, read and handled in `ms`. */
export function noteMessage(type: string, bytes: number, at: number, ms: number) {
  const size = bytes >= 1024 ? `${Math.round(bytes / 1024)} KB` : '';
  const took = ms >= 10 ? `read in ${Math.round(ms)} ms` : '';
  noted.push({ at, what: size || took ? `${type} (${[size, took].filter(Boolean).join(', ')})` : type });
  if (noted.length > KEPT) noted.shift();
}

/**
 * The heartbeat: a worker's timer, which the browser does not hold back with the page's own (WebKit
 * runs those about once a second in a window it takes for idle, in view or not), sends the time
 * every tick for the page to take in; a page that takes it in late was held up. The worker's clock
 * starts elsewhere than the page's, so only differences between its times are compared.
 */
const HEARTBEAT = `setInterval(() => postMessage(performance.now()), ${TICK_MS});`;

/**
 * The stall that a beat taken in at `now` tells of, `late` after it was sent: none where it came
 * soon enough, and only what came after `free`, when the page took the beat before in (the beats
 * queued behind a stall tell of the same one). `least` is how late a beat must be to tell of one.
 */
export function stallOf(late: number, now: number, free: number, least = STALL_MS): { from: number; to: number } | null {
  const from = Math.max(now - late, free);
  return now - from >= least ? { from, to: now } : null;
}

/** Watches this page for stalls; `send` passes one on to the server, and says whether it could. */
export function watchPageStalls(send: (s: PageStall) => boolean) {
  let heart: Worker;
  try {
    heart = new Worker(URL.createObjectURL(new Blob([HEARTBEAT], { type: 'text/javascript' })));
  } catch {
    return;
  }
  const frames: LongFrame[] = [];
  const supported = typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes?.includes('long-animation-frame');
  if (supported)
    new PerformanceObserver((list) => {
      frames.push(...(list.getEntries() as unknown as LongFrame[]));
      const old = performance.now() - SLEPT_MS;
      while (frames.length && frames[0]!.startTime + frames[0]!.duration < old) frames.shift();
    }).observe({ type: 'long-animation-frame', buffered: true });
  // stalls the browser may not have told the long frames of yet, and those the server has not heard
  // of yet: one during a reconnect goes out once the page is connected again
  const found: { from: number; to: number; before: string[] }[] = [];
  const unsent: PageStall[] = [];
  let free = performance.now();
  // the least that worker's and page's clocks were apart on taking a beat in: what any beat took more was its wait
  let apart = Infinity;
  // the browser holds a page out of view back by itself: a pause it was out of view in, however
  // briefly, is no stall, so going out of view and back starts the count afresh
  let visible = document.visibilityState === 'visible';
  document.addEventListener('visibilitychange', () => {
    free = performance.now();
    visible = document.visibilityState === 'visible';
  });
  heart.onmessage = (e: MessageEvent<number>) => {
    const now = performance.now();
    apart = Math.min(apart, now - e.data);
    // with long frames to tell its length, a beat a tick short of a stall may have missed its start
    const stall = stallOf(now - e.data - apart, now, free, supported ? STALL_MS - TICK_MS : STALL_MS);
    free = now;
    if (stall && visible) found.push({ ...stall, before: beforeOf(noted, stall.from, stall.to) });
    while (found.length && (!supported || now - found[0]!.to >= REPORTED_MS)) {
      const f = found.shift()!;
      const long = supported ? framesWithin(frames, f.from, f.to) : [];
      // the beat went out up to a tick after the stall began; the long frames tell its length to the millisecond
      const ms = Math.max(f.to - f.from, long.reduce((sum, l) => sum + l.duration, 0));
      // and a machine asleep runs nothing at all: without long frames to tell, a very long pause is sleep
      if (ms >= STALL_MS && (supported ? long.length : ms < SLEPT_MS)) unsent.push({ ms: Math.round(ms), scripts: scriptsOf(long), before: f.before });
    }
    while (unsent.length > KEPT) unsent.shift();
    while (unsent.length && send(unsent[0]!)) unsent.shift();
  };
}
