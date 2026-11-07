import { expect, test } from 'bun:test';
import { MAX_ZOOM, MIN_ZOOM, toWorld } from './camera';
import { type Clock, DOUBLE_TAP_MS, HOLD_MS, pinchCam, type Pos, SLOP, Touches } from './touch';

/** A clock the test moves by hand, and a host that writes down what the fingers did. */
function rig() {
  let now = 0;
  let timers: { at: number; f: () => void }[] = [];
  const clock: Clock = {
    after: (ms, f) => {
      const h = { at: now + ms, f };
      timers.push(h);
      return h;
    },
    cancel: (h) => (timers = timers.filter((x) => x !== h)),
    now: () => now,
  };
  const log: string[] = [];
  const touches = new Touches(
    {
      pan: (dx, dy) => log.push(`pan ${dx},${dy}`),
      pinch: (from, to) => log.push(`pinch ${from[0].x},${from[0].y}->${to[0].x},${to[0].y}`),
      tap: (_, target) => log.push(`tap ${target ?? 'canvas'}`),
      doubleTap: (at) => log.push(`double ${at.x},${at.y}`),
      hold: (_, target) => log.push(`hold ${target ?? 'canvas'}`),
      holdMove: (at) => log.push(`holdMove ${at.x},${at.y}`),
      holdEnd: (at, cut) => log.push(`holdEnd ${at.x},${at.y}${cut ? ' cut' : ''}`),
      moving: (on) => log.push(on ? 'moving' : 'still'),
    },
    clock,
  );
  const wait = (ms: number) => {
    now += ms;
    for (const t of timers.filter((x) => x.at <= now)) {
      timers = timers.filter((x) => x !== t);
      t.f();
    }
  };
  return { touches, log, wait };
}

const p = (x: number, y: number): Pos => ({ x, y });

test('a pinch zooms around the midpoint of the fingers: the world point there stays under it', () => {
  const c = { x: 100, y: 50, s: 1 };
  const next = pinchCam(c, [p(300, 300), p(500, 300)], [p(250, 300), p(550, 300)]);
  expect(next.s).toBeCloseTo(1.5);
  const before = toWorld(c, 400, 300);
  const after = toWorld(next, 400, 300);
  expect(after.x).toBeCloseTo(before.x);
  expect(after.y).toBeCloseTo(before.y);
});

test('two fingers moving together pan without zooming', () => {
  const c = { x: 0, y: 0, s: 1.2 };
  const next = pinchCam(c, [p(100, 100), p(200, 100)], [p(130, 140), p(230, 140)]);
  expect(next.s).toBe(1.2);
  expect(next.x).toBeCloseTo(30);
  expect(next.y).toBeCloseTo(40);
});

test('a pinch stays within the zoom limits, and the midpoint still follows the fingers', () => {
  const c = { x: 0, y: 0, s: 1 };
  expect(pinchCam(c, [p(390, 300), p(410, 300)], [p(0, 300), p(800, 300)]).s).toBe(MAX_ZOOM);
  const out = pinchCam(c, [p(0, 300), p(800, 300)], [p(395, 300), p(405, 300)]);
  expect(out.s).toBe(MIN_ZOOM);
  const w = toWorld(out, 400, 300);
  expect(w.x).toBeCloseTo(400);
  expect(w.y).toBeCloseTo(300);
});

test('a short touch without moving is a tap on what it landed on', () => {
  const { touches, log, wait } = rig();
  touches.down(1, p(10, 10), 'card-a');
  wait(100);
  touches.move(1, p(12, 13));
  touches.up(1, p(12, 13));
  expect(log).toEqual(['tap card-a']);
  expect(touches.busy).toBe(false);
});

test('one finger that moves pans, on a card as well as on the canvas, and never taps', () => {
  const { touches, log, wait } = rig();
  touches.down(1, p(10, 10), 'card-a');
  touches.move(1, p(10 + SLOP + 2, 10));
  touches.move(1, p(40, 20));
  wait(HOLD_MS * 2);
  touches.up(1, p(40, 20));
  expect(log).toEqual(['moving', `pan ${SLOP + 2},0`, `pan ${40 - 10 - SLOP - 2},10`, 'still']);
});

test('a long press picks up the card; it follows the finger and lets go with it', () => {
  const { touches, log, wait } = rig();
  touches.down(1, p(10, 10), 'card-a');
  wait(HOLD_MS - 1);
  expect(log).toEqual([]);
  wait(1);
  touches.move(1, p(80, 90));
  touches.up(1, p(80, 90));
  expect(log).toEqual(['hold card-a', 'holdMove 80,90', 'holdEnd 80,90']);
});

test('a long press on the empty canvas starts the lasso', () => {
  const { touches, log, wait } = rig();
  touches.down(1, p(10, 10), null);
  wait(HOLD_MS);
  expect(log).toEqual(['hold canvas']);
});

test('a finger that moved before the long press ran out pans and picks nothing up', () => {
  const { touches, log, wait } = rig();
  touches.down(1, p(10, 10), 'card-a');
  touches.move(1, p(40, 10));
  wait(HOLD_MS);
  expect(log).not.toContain('hold card-a');
});

test('two taps close together on the empty canvas are a double-tap; on a card they stay taps', () => {
  const { touches, log, wait } = rig();
  touches.down(1, p(100, 100), null);
  touches.up(1, p(100, 100));
  wait(DOUBLE_TAP_MS - 50);
  touches.down(2, p(105, 104), null);
  touches.up(2, p(105, 104));
  expect(log).toEqual(['tap canvas', 'double 100,100']);
  log.length = 0;
  touches.down(3, p(100, 100), 'card-a');
  touches.up(3, p(100, 100));
  touches.down(4, p(100, 100), 'card-a');
  touches.up(4, p(100, 100));
  expect(log).toEqual(['tap card-a', 'tap card-a']);
});

test('taps too far apart in time or space are two taps', () => {
  const { touches, log, wait } = rig();
  touches.down(1, p(100, 100), null);
  touches.up(1, p(100, 100));
  wait(DOUBLE_TAP_MS + 1);
  touches.down(2, p(100, 100), null);
  touches.up(2, p(100, 100));
  touches.down(3, p(200, 100), null);
  touches.up(3, p(200, 100));
  expect(log).toEqual(['tap canvas', 'tap canvas', 'tap canvas']);
});

test('a second finger turns a press into a pinch: no tap, no long press', () => {
  const { touches, log, wait } = rig();
  touches.down(1, p(100, 100), 'card-a');
  touches.down(2, p(200, 100), null);
  wait(HOLD_MS);
  touches.move(2, p(220, 100));
  touches.up(1, p(100, 100));
  // the finger that stays pans on
  touches.move(2, p(230, 110));
  touches.up(2, p(230, 110));
  expect(log).toEqual(['moving', 'pinch 200,100->220,100', 'pan 10,10', 'still']);
});

test('a second finger while a card is held drops it where it is, then pinches', () => {
  const { touches, log, wait } = rig();
  touches.down(1, p(10, 10), 'card-a');
  wait(HOLD_MS);
  touches.move(1, p(50, 60));
  touches.down(2, p(300, 300), null);
  touches.move(1, p(40, 60));
  touches.up(1, p(40, 60));
  touches.up(2, p(300, 300));
  expect(log).toEqual(['hold card-a', 'holdMove 50,60', 'holdEnd 50,60 cut', 'moving', 'pinch 50,60->40,60', 'still']);
});

test('a third finger is left out of the pinch', () => {
  const { touches, log } = rig();
  touches.down(1, p(0, 0), null);
  touches.down(2, p(100, 0), null);
  touches.down(3, p(50, 50), null);
  touches.move(3, p(60, 60));
  touches.up(3, p(60, 60));
  expect(log).toEqual(['moving']);
  expect(touches.busy).toBe(true);
});

test('a cancelled touch is no tap, and a cancelled hold ends cut', () => {
  const { touches, log, wait } = rig();
  touches.down(1, p(10, 10), 'card-a');
  touches.cancel(1, p(10, 10));
  touches.down(2, p(10, 10), 'card-a');
  wait(HOLD_MS);
  touches.cancel(2, p(10, 10));
  expect(log).toEqual(['hold card-a', 'holdEnd 10,10 cut']);
  expect(touches.busy).toBe(false);
});
