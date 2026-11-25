import { expect, test } from 'bun:test';
import { besideSheet, camKey, type Cam, lastCanvas, lastCanvasKey, NO_SIDES, CHASE_MS, chaseStep, DROP_ROOM, dragLimit, EDGE_ZONE, edgeScroll, KEEP, keepInView, placeIn, shows } from './camera';

const view = { left: 0, top: 70, right: 1000, bottom: 800 };
const cam: Cam = { x: 0, y: 0, s: 1 };

const wide = { x: -2000, y: -2000, w: 5000, h: 5000 };

test('a card dragged to an edge scrolls the view that way, faster the nearer the edge', () => {
  const from = { x: 500, y: 400 };
  expect(edgeScroll(cam, { x: 999, y: 400 }, from, view, wide, 100).x).toBeLessThan(0);
  expect(edgeScroll(cam, { x: 1, y: 400 }, from, view, wide, 100).x).toBeGreaterThan(0);
  expect(edgeScroll(cam, { x: 500, y: 71 }, from, view, wide, 100).y).toBeGreaterThan(0);
  expect(edgeScroll(cam, { x: 500, y: 799 }, from, view, wide, 100).y).toBeLessThan(0);
  const deep = edgeScroll(cam, { x: 1000, y: 400 }, from, view, wide, 100).x;
  const shallow = edgeScroll(cam, { x: 1000 - EDGE_ZONE / 2, y: 400 }, from, view, wide, 100).x;
  expect(deep).toBeLessThan(shallow);
  expect(shallow).toBeLessThan(0);
  
  expect(edgeScroll(cam, { x: 1000 - EDGE_ZONE - 1, y: 400 }, from, view, wide, 100)).toEqual(cam);
});

test('only towards an edge the pointer moved to: a card picked up at an edge does not run off', () => {
  expect(edgeScroll(cam, { x: 990, y: 400 }, { x: 995, y: 400 }, view, wide, 100)).toEqual(cam);
  expect(edgeScroll(cam, { x: 990, y: 400 }, { x: 990, y: 400 }, view, wide, 100)).toEqual(cam);
});

test('the view scrolls no further than the content plus room for the card', () => {
  const content = { x: 0, y: 0, w: 1500, h: 600 };
  const limit = dragLimit(content, { w: 300, h: 136 });
  expect(limit).toEqual({ x: -300 - DROP_ROOM, y: -136 - DROP_ROOM, w: 1500 + 600 + 2 * DROP_ROOM, h: 600 + 272 + 2 * DROP_ROOM });
  let c = cam;
  for (let i = 0; i < 100; i++) c = edgeScroll(c, { x: 1000, y: 400 }, { x: 500, y: 400 }, view, limit, 16);
  
  expect((view.right - c.x) / c.s).toBeCloseTo(1500 + 300 + DROP_ROOM);
  for (let i = 0; i < 300; i++) c = edgeScroll(c, { x: 0, y: 400 }, { x: 500, y: 400 }, view, limit, 16);
  expect((view.left - c.x) / c.s).toBeCloseTo(-300 - DROP_ROOM);
  for (let i = 0; i < 100; i++) c = edgeScroll(c, { x: 500, y: 70 }, { x: 500, y: 400 }, view, limit, 16);
  expect((view.top - c.y) / c.s).toBeCloseTo(-136 - DROP_ROOM);
});

test('a limit counts in world units at any zoom', () => {
  const half = { x: 0, y: 0, s: 0.5 };
  const limit = { x: 0, y: 0, w: 2400, h: 1000 };
  let c = half;
  for (let i = 0; i < 100; i++) c = edgeScroll(c, { x: 1000, y: 400 }, { x: 500, y: 400 }, view, limit, 16);
  expect((view.right - c.x) / c.s).toBeCloseTo(2400);
});

test('a view already beyond the limit stays put rather than jump back', () => {
  const far: Cam = { x: -5000, y: 0, s: 1 };
  const limit = { x: 0, y: 0, w: 1200, h: 1000 };
  expect(edgeScroll(far, { x: 1000, y: 400 }, { x: 500, y: 400 }, view, limit, 16)).toEqual(far);
  
  expect(edgeScroll(far, { x: 0, y: 400 }, { x: 500, y: 400 }, view, limit, 16).x).toBeGreaterThan(far.x);
});


const cards = [
  { x: 0, y: 100, w: 300, h: 136 },
  { x: 3000, y: 100, w: 300, h: 136 },
];

test('a view that shows some content stays where it is', () => {
  expect(keepInView(cam, cards, view)).toEqual(cam);
  
  const corner: Cam = { x: 1000 - KEEP, y: 70 - 236 + KEEP, s: 1 };
  expect(keepInView(corner, cards, view)).toEqual(corner);
});

test('a view panned off the content stops with a strip of the nearest card in sight', () => {
  
  const left = keepInView({ x: 5000, y: 0, s: 1 }, cards, view);
  expect(left.x).toBe(1000 - KEEP);
  
  const above = keepInView({ x: 0, y: 3000, s: 1 }, cards, view);
  expect(above.x).toBe(0);
  expect(above.y + 100).toBe(800 - KEEP);
  
  const between = keepInView({ x: -2100, y: 0, s: 1 }, cards, view);
  expect(between.x + 3000).toBe(1000 - KEEP);
});

test('in a corner off the content the view moves both ways, at any zoom', () => {
  const c = keepInView({ x: 4000, y: 4000, s: 0.5 }, cards, view);
  expect(c.s).toBe(0.5);
  expect(c.x).toBe(1000 - KEEP);
  
  expect(c.y + 100 * 0.5).toBe(800 - 68);
});

test('a card smaller than the strip is kept in whole', () => {
  const chip = [{ x: 0, y: 0, w: 60, h: 30 }];
  const c = keepInView({ x: -5000, y: 0, s: 1 }, chip, view);
  expect(c.x).toBe(0);
  expect(c.y + 30).toBe(70 + 30);
});

test('an empty canvas sets no limit', () => {
  const far: Cam = { x: -5000, y: 9000, s: 1 };
  expect(keepInView(far, [], view)).toEqual(far);
});

test('a chased camera closes most of the way each frame and arrives without overshooting', () => {
  const to: Cam = { x: -900, y: 300, s: 1 };
  const one = chaseStep(cam, to, 16);
  expect(one.x).toBeLessThan(0);
  expect(one.x).toBeGreaterThan(to.x);
  
  expect(chaseStep(cam, to, CHASE_MS).x).toBeCloseTo(to.x * (1 - Math.exp(-1)));
  let c = cam;
  for (let i = 0; i < 100 && c !== to; i++) c = chaseStep(c, to, 16);
  expect(c).toBe(to);
});

test('a sheet docked on the right moves the view by half its width, so the middle stays the middle', () => {
  const c: Cam = { x: 100, y: 50, s: 1.5 };
  const right = (w: number) => ({ left: 0, right: w });
  
  expect(besideSheet(c, NO_SIDES, right(380))).toEqual({ x: -90, y: 50, s: 1.5 });
  
  expect(besideSheet(besideSheet(c, NO_SIDES, right(380)), right(380), NO_SIDES)).toEqual(c);
  expect(besideSheet(c, right(380), right(500))).toEqual({ x: 40, y: 50, s: 1.5 });
  expect(besideSheet(c, right(380), right(380))).toBe(c);
});

test('the navigation pinned on the left moves the view the other way, and as wide a sheet on the right cancels it out', () => {
  const c: Cam = { x: 100, y: 50, s: 1.5 };
  expect(besideSheet(c, NO_SIDES, { left: 340, right: 0 })).toEqual({ x: 270, y: 50, s: 1.5 });
  expect(besideSheet(c, NO_SIDES, { left: 380, right: 380 })).toBe(c);
});

test('a new card goes under the pointer over the canvas, else to the middle of the view', () => {
  const zoomed: Cam = { x: -100, y: 30, s: 2 };
  const shown = { x: 50, y: 20, w: 500, h: 365 };
  expect(placeIn(zoomed, view, { x: 300, y: 430 })).toEqual({ x: 200, y: 200, view: shown });
  
  expect(placeIn(zoomed, view, null)).toEqual({ x: 300, y: 202.5, view: shown });
  expect(placeIn(zoomed, view, { x: 300, y: 20 })).toEqual({ x: 300, y: 202.5, view: shown });
});

test('a card shows when it lies wholly in the view', () => {
  expect(shows(cam, view, { x: 100, y: 100, w: 300, h: 136 })).toBe(true);
  expect(shows(cam, view, { x: 800, y: 100, w: 300, h: 136 })).toBe(false);
  expect(shows(cam, view, { x: 100, y: 0, w: 300, h: 136 })).toBe(false);
});

test('a canvas keeps its saved view key wherever it stands in the order', () => {
  const main = { id: 'c1', name: 'main' };
  const other = { id: 'c2', name: 'Ideas' };
  expect(camKey('p', main)).toBe('seismic-cam-p');
  expect(camKey('p', other)).toBe('seismic-cam-p#c2');
  expect(camKey('p')).toBe('seismic-cam-p');
});

test('a return to a project finds the canvas shown last on it, while the project still has it', () => {
  const canvases = [{ id: 'm', name: 'main' }, { id: 'b', name: 'Big bets' }];
  expect(lastCanvas(canvases, 'b')?.name).toBe('Big bets');
  expect(lastCanvas(canvases, 'gone')).toBeUndefined();
  expect(lastCanvas(canvases, null)).toBeUndefined();
  expect(lastCanvasKey('p1')).not.toBe(lastCanvasKey('p2'));
  
  expect(lastCanvasKey('draft-shop-new')).not.toBe('seismic-canvas-draft-shop-new');
  expect(lastCanvasKey('x').startsWith('seismic-last-canvas-')).toBe(true);
});
