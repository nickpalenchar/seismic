






export type Mark = { kind: 'frame'; x: number; y: number; w: number; h: number } | { kind: 'pin'; x: number; y: number };
export type Point = { x: number; y: number };


export const CLICK_PX = 5;

export const RED = '#e02b1e';
export const EDGE = '#fff';

/** The mark of a gesture from `a` to `b` (image pixels) that went `moved` screen pixels at most from where it began. */
export const markOf = (a: Point, b: Point, moved: number): Mark =>
  moved < CLICK_PX ? { kind: 'pin', x: a.x, y: a.y } : { kind: 'frame', x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };


export type Corners = [number, number, number, number];

/**
 * Where a frame's number stands: a square of `side` (a pin's width) on its top left corner, flush
 * with the red line's outer edge, so its red runs into the line. Outside above the frame like a tab,
 * with the frame's corner under it square; inside where the image ends above the frame, its own
 * corner rounded like the frame's. `corners` the badge's rounding, `frame` the frame's.
 */
export function badgeOf(m: Extract<Mark, { kind: 'frame' }>, s: ReturnType<typeof markSize>) {
  const side = 2 * s.radius;
  const out = s.line / 2;
  
  const r = s.corner + out;
  const c = s.corner;
  const above = m.y - side + out;
  return above - s.edge >= 0
    ? { x: m.x - out, y: above, side, corners: [r, r, 0, 0] as Corners, frame: [0, c, c, c] as Corners }
    : { x: m.x - out, y: m.y - out, side, corners: [r, 0, r, 0] as Corners, frame: [c, c, c, c] as Corners };
}

/** Corners no rounder than half of a `w`×`h` rectangle allows. */
export const fit = (w: number, h: number, c: Corners) => c.map((r) => Math.min(r, w / 2, h / 2)) as Corners;

/** A rectangle with the corners `c`, as an SVG path (an SVG rect rounds all four alike). */
export function roundedRect(x: number, y: number, w: number, h: number, c: Corners) {
  const [tl, tr, br, bl] = fit(w, h, c);
  const arc = (r: number, ex: number, ey: number) => `A${r},${r} 0 0 1 ${ex},${ey}`;
  return `M${x + tl},${y}H${x + w - tr}${arc(tr, x + w, y + tr)}V${y + h - br}${arc(br, x + w - br, y + h)}H${x + bl}${arc(bl, x, y + h - bl)}V${y + tl}${arc(tl, x + tl, y)}Z`;
}

/**
 * How large marks are on an image of `w`×`h` pixels: the same share of its long side, so they look
 * the same however large it is shown. `line` the red line, `edge` the white rim on each side of it,
 * `radius` a pin's, `corner` a frame's rounding.
 */
export function markSize(w: number, h: number) {
  const long = Math.max(w, h);
  const line = Math.max(2, long * 0.003);
  const radius = Math.max(10, long * 0.015);
  return { line, edge: line * 0.5, radius, corner: line * 1.5, font: radius * 1.25 };
}

type Ctx = Pick<
  CanvasRenderingContext2D,
  'beginPath' | 'roundRect' | 'arc' | 'stroke' | 'fill' | 'fillText' | 'strokeStyle' | 'fillStyle' | 'lineWidth' | 'lineJoin' | 'font' | 'textAlign' | 'textBaseline'
>;

/** Draws the marks onto a context of the image's size, as the page shows them. */
export function drawMarks(ctx: Ctx, marks: Mark[], w: number, h: number) {
  const s = markSize(w, h);
  const number = (n: number, x: number, y: number) => {
    ctx.fillStyle = EDGE;
    ctx.font = `700 ${s.font}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(n), x, y + s.font * 0.05);
  };
  marks.forEach((m, i) => {
    ctx.beginPath();
    if (m.kind === 'pin') {
      ctx.arc(m.x, m.y, s.radius, 0, 2 * Math.PI);
      ctx.fillStyle = RED;
      ctx.fill();
      ctx.strokeStyle = EDGE;
      ctx.lineWidth = s.edge * 2;
      ctx.stroke();
      return number(i + 1, m.x, m.y);
    }
    
    const b = badgeOf(m, s);
    const frame = () => {
      ctx.beginPath();
      ctx.roundRect(m.x, m.y, m.w, m.h, fit(m.w, m.h, b.frame));
    };
    const badge = () => {
      ctx.beginPath();
      ctx.roundRect(b.x, b.y, b.side, b.side, fit(b.side, b.side, b.corners));
    };
    ctx.lineJoin = 'round';
    ctx.strokeStyle = EDGE;
    frame();
    ctx.lineWidth = s.line + 2 * s.edge;
    ctx.stroke();
    badge();
    ctx.lineWidth = s.edge * 2;
    ctx.stroke();
    ctx.fillStyle = RED;
    ctx.fill();
    frame();
    ctx.strokeStyle = RED;
    ctx.lineWidth = s.line;
    ctx.stroke();
    number(i + 1, b.x + b.side / 2, b.y + b.side / 2);
  });
}
