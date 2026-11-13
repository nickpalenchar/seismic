import { expect, test } from 'bun:test';

// The contrast of the frost look's text, measured from the tokens in tailwind.css: each state's strong step as the
// state line at a card's foot (12 px semibold, so WCAG's 4.5:1 for small text), on the glass of a card
// of that state, over the lightest and the darkest of the board, at rest and with the tint (--unblurred) a
// card takes for its blur zoomed far out or moving. Finished cards are pushed back on purpose (faded): their line keeps 3:1.
// The marks drawn in the inks (a card's tab and frame, the pin) keep WCAG's 3:1 for graphics.

type RGBA = [number, number, number, number];

const css = await Bun.file(new URL('./tailwind.css', import.meta.url)).text();
const palette = await Bun.file(new URL('../../node_modules/tailwindcss/theme.css', import.meta.url)).text();

/** The custom properties of the first rule whose selector is `selector`. */
function declared(source: string, selector: string): Record<string, string> {
  const at = source.indexOf(`${selector} {`);
  if (at < 0) throw new Error(`no ${selector} in tailwind.css`);
  const body = source.slice(at + selector.length + 2, source.indexOf('\n}', at));
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));
}

/** `a, b(c, d), e` split at its top-level commas. */
function args(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') depth--;
    else if (s[i] === ',' && depth === 0) { out.push(s.slice(from, i).trim()); from = i + 1; }
  }
  return [...out, s.slice(from).trim()];
}

/** OKLab to sRGB (0 to 255). */
function fromOklab(L: number, a: number, b: number): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
  return lin.map((v) => 255 * Math.min(1, Math.max(0, v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055))) as [number, number, number];
}
function toOklab([r, g, b]: [number, number, number]): [number, number, number] {
  const lin = [r, g, b].map((v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const l = Math.cbrt(0.4122214708 * lin[0]! + 0.5363325363 * lin[1]! + 0.0514459929 * lin[2]!);
  const m = Math.cbrt(0.2119034982 * lin[0]! + 0.6806995451 * lin[1]! + 0.1073969566 * lin[2]!);
  const s = Math.cbrt(0.0883024619 * lin[0]! + 0.2817188376 * lin[1]! + 0.6299787005 * lin[2]!);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

/** A colour of the token file as sRGB: `oklch()` hues, `white`, `black`, `transparent`, `color-mix(in oklab, …)` and `var()`s of either. */
function colour(value: string, tokens: Record<string, string>): RGBA {
  const v = value.trim();
  const ref = /^var\(--([\w-]+)\)$/.exec(v);
  if (ref) {
    const raw = tokens[ref[1]!] ?? palette.match(new RegExp(`--${ref[1]}:\\s*([^;]+);`))?.[1];
    if (!raw) throw new Error(`no token --${ref[1]}`);
    return colour(raw, tokens);
  }
  if (v === 'white') return [255, 255, 255, 1];
  if (v === 'black') return [0, 0, 0, 1];
  if (v === 'transparent') return [0, 0, 0, 0];
  const lch = /^oklch\(([\d.]+)%?\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)$/.exec(v);
  if (lch) {
    const [L, C, H] = [+lch[1]! / 100, +lch[2]!, (+lch[3]! * Math.PI) / 180];
    return [...fromOklab(L, C * Math.cos(H), C * Math.sin(H)), lch[4] ? +lch[4] : 1] as RGBA;
  }
  const mixed = /^color-mix\(in oklab,\s*(.+)\)$/.exec(v);
  if (mixed) {
    const [x, y] = args(mixed[1]!);
    const share = (part: string) => /\s([\d.]+)%$/.exec(part);
    const pa = share(x!);
    const pb = share(y!);
    const p = pa ? +pa[1]! / 100 : pb ? 1 - +pb[1]! / 100 : 0.5;
    const ca = colour(x!.replace(/\s[\d.]+%$/, ''), tokens);
    const cb = colour(y!.replace(/\s[\d.]+%$/, ''), tokens);
    const alpha = ca[3] * p + cb[3] * (1 - p);
    const [la, lb] = [toOklab([ca[0], ca[1], ca[2]]), toOklab([cb[0], cb[1], cb[2]])];
    const ch = (i: number) => (la[i]! * ca[3] * p + lb[i]! * cb[3] * (1 - p)) / alpha;
    return [...fromOklab(ch(0), ch(1), ch(2)), alpha] as RGBA;
  }
  throw new Error(`cannot read colour ${v}`);
}

/** Every colour token of a look, light or dark (dark over light), resolved. */
function look(dark: boolean): Record<string, RGBA> {
  const raw = { ...declared(css, ':root'), ...(dark ? declared(css, DARK) : {}) };
  return Object.fromEntries(Object.keys(raw).filter((k) => !/^(font|mono|s|radius|shadow|lift|board|chart-\d|tl|ta|tel|tea|tga|tna)$/.test(k)).map((k) => [k, colour(raw[k]!, raw)]));
}

/** `top` laid over the opaque `under`. */
const over = (top: RGBA, under: RGBA): RGBA => [0, 1, 2].map((i) => top[i]! * top[3] + under[i]! * (1 - top[3])).concat(1) as RGBA;
/** color-mix(in srgb, a p%, b), premultiplied as CSS mixes. */
function mix(a: RGBA, p: number, b: RGBA): RGBA {
  const alpha = a[3] * p + b[3] * (1 - p);
  const ch = (i: number) => (a[i]! * a[3] * p + b[i]! * b[3] * (1 - p)) / alpha;
  return [ch(0), ch(1), ch(2), alpha];
}
function luminance([r, g, b]: RGBA): number {
  const lin = (v: number) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function contrast(a: RGBA, b: RGBA): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
}

const STATES = ['planned', 'working', 'reviewing', 'waiting', 'approved', 'inPr', 'proposal', 'idea', 'question', 'asking', 'restart'] as const;
const DARK = ':root:where([data-theme="dark"], :not([data-theme])[data-system-theme="dark"])';

/** Every pairing of text on glass one mode has, with the contrast it reaches at its worst. */
function measure(t: Record<string, RGBA>) {
  const boards = [t['board-from']!, t['board-mid']!, t['board-to']!];
  const unblurred = t.unblurred!;
  const card = t.card!;
  const glass = (stock: RGBA, board: RGBA, dense: boolean) => {
    const g = over(stock, board);
    return dense ? over(unblurred, g) : g;
  };
  const worst = (text: RGBA, stock: RGBA, fade = 1) =>
    Math.min(
      ...boards.flatMap((board) =>
        [false, true].map((dense) => {
          const under = glass(stock, board, dense);
          return contrast(over([...text.slice(0, 3), fade] as RGBA, under), under);
        }),
      ),
    );
  // a card tinted by its state (card/faceClasses.ts): the state's colour at 9% (8% for a Question) over the glass
  const stockOf = (s: string): RGBA => mix(t[s]!, s === 'question' ? 0.08 : 0.09, card);
  const rows: { what: string; ratio: number; needs: number }[] = [
    { what: 'foreground', ratio: worst(t.foreground!, card), needs: 4.5 },
    { what: 'muted', ratio: worst(t['muted-foreground']!, card), needs: 4.5 },
    { what: 'primary button', ratio: contrast(t['primary-foreground']!, t.primary!), needs: 4.5 },
    // a state line is the state's strong step on the tint of its card
    ...STATES.map((s) => ({ what: `${s} line`, ratio: worst(t[`${s}-strong`]!, ['idea', 'question'].includes(s) ? stockOf(s) : card), needs: 4.5 })),
    // done and live: the card at .74 opacity on stock tinted with its own colour
    { what: 'live line', ratio: worst(t['live-strong']!, mix(t.live!, 0.14, card), 0.74), needs: 3 },
    // the status colours as text on the glass
    ...(['destructive', 'success', 'warning', 'info'] as const).map((s) => ({ what: `${s} text`, ratio: worst(t[s]!, card), needs: 4.5 })),
    // the marks in the colours themselves (tab, frame, pin, minimap) as graphics: 3:1, but for planned, which stays quiet
    ...STATES.filter((s) => s !== 'planned').map((s) => ({ what: `${s} mark`, ratio: worst(t[s]!, ['idea', 'question'].includes(s) ? stockOf(s) : card), needs: 3 })),
  ];
  return rows.map((r) => ({ ...r, ratio: Math.round(r.ratio * 100) / 100 }));
}

for (const [mode, dark] of [['light', false], ['dark', true]] as const) {
  test(`every text on glass reaches its contrast in ${mode} mode`, () => {
    const rows = measure(look(dark));
    expect(rows.filter((r) => r.ratio < r.needs)).toEqual([]);
  });
}

test('the dark palette has one definition shared by system and choice', () => {
  expect(css.match(/--background: var\(--color-slate-950\)/g)).toHaveLength(1);
  expect(css).not.toContain('@media (prefers-color-scheme: dark)');
});

if (process.env.FROST_CONTRAST) for (const dark of [false, true]) console.table(measure(look(dark)));
