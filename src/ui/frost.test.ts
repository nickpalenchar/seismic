import { expect, test } from 'bun:test';

// The contrast of the frost look's text, measured from frost.css's own tokens: each state's ink as the
// state line at a card's foot (12 px semibold, so WCAG's 4.5:1 for small text), on the glass of a card
// of that state, over the lightest and the darkest of the board, at rest and with the tint (--unblurred) a
// card takes for its blur zoomed far out or moving. Finished cards are pushed back on purpose (faded): their line keeps 3:1.
// The marks drawn in the inks (a card's tab and frame, the pin) keep WCAG's 3:1 for graphics.

type RGBA = [number, number, number, number];

const css = await Bun.file(new URL('./frost.css', import.meta.url)).text();

/** The custom properties of the first rule whose selector is `selector`. */
function tokens(selector: string): Record<string, string> {
  const at = css.indexOf(`${selector} {`);
  if (at < 0) throw new Error(`no ${selector} in frost.css`);
  const body = css.slice(at + selector.length + 2, css.indexOf('\n}', at));
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));
}

function parse(c: string): RGBA {
  const hex = /^#([0-9a-f]{6})$/i.exec(c);
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1]!.slice(i, i + 2), 16)).concat(1) as RGBA;
  const rgba = /^rgba?\(([^)]+)\)$/.exec(c);
  if (rgba) {
    const [r, g, b, a = '1'] = rgba[1]!.split(',').map((s) => s.trim());
    return [+r!, +g!, +b!, +a];
  }
  throw new Error(`cannot read colour ${c}`);
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

const STATES = ['planned', 'working', 'waiting', 'approved', 'inPr', 'proposal', 'idea', 'question', 'asking'] as const;

/** Every pairing of text on glass one mode has, with the contrast it reaches at its worst. */
function measure(t: Record<string, string>) {
  const boards = [...t.board!.matchAll(/#[0-9a-f]{6}/gi)].map((m) => parse(m[0]));
  const unblurred = parse(t.unblurred!);
  const card = parse(t.card!);
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
  const stockOf: Record<string, RGBA> = {
    idea: mix(parse(t.idea!), 0.09, card),
    question: mix(parse(t.question!), 0.08, card),
  };
  // a state line is its ink darkened (light) or lightened (dark) toward the text's, by --state-text-ink
  const share = parseFloat(t['state-text-ink']!) / 100;
  const line = (s: string) => mix(parse(t.ink!), share, parse(t[s]!));
  const rows: { what: string; ratio: number; needs: number }[] = [
    { what: 'ink', ratio: worst(parse(t.ink!), card), needs: 4.5 },
    { what: 'muted', ratio: worst(parse(t.muted!), card), needs: 4.5 },
    { what: 'primary button', ratio: contrast(parse(t['on-ink']!), parse(t.working!)), needs: 4.5 },
    ...STATES.map((s) => ({ what: `${s} line`, ratio: worst(line(s), stockOf[s] ?? card), needs: 4.5 })),
    // done and live: the card at .74 opacity on stock tinted with its own ink
    { what: 'live line', ratio: worst(line('live'), mix(parse(t.live!), 0.14, card), 0.74), needs: 3 },
    // the marks in the inks themselves (tab, frame, pin, minimap) as graphics: 3:1, but for planned, which stays quiet
    ...STATES.filter((s) => s !== 'planned').map((s) => ({ what: `${s} mark`, ratio: worst(parse(t[s]!), stockOf[s] ?? card), needs: 3 })),
  ];
  return rows.map((r) => ({ ...r, ratio: Math.round(r.ratio * 100) / 100 }));
}

for (const [mode, selector] of [['light', ':root'], ['dark', ':root[data-theme="dark"]']] as const) {
  test(`every text on glass reaches its contrast in ${mode} mode`, () => {
    const rows = measure(tokens(selector));
    expect(rows.filter((r) => r.ratio < r.needs)).toEqual([]);
  });
}

test('dark by system and dark by choice share their tokens', () => {
  const system = /@media \(prefers-color-scheme: dark\) \{ :root:not\(\[data-theme="light"\]\) \{([^}]+)\} \}/.exec(css)?.[1];
  const chosen = /:root\[data-theme="dark"\] \{([^}]+)\}/.exec(css)?.[1];
  expect(system?.trim()).toBe(chosen?.trim());
});

if (process.env.FROST_CONTRAST) for (const s of [':root', ':root[data-theme="dark"]']) console.table(measure(tokens(s)));
