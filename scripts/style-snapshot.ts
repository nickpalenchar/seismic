// Computed styles of a part of the UI, for comparing a view before and after its CSS moves (each family is
// compared element by element against the commit before it).
//
//   bun scripts/style-snapshot.ts js <root selector> [--pseudo]   prints a JS expression for the browser skill's `eval`
//   bun scripts/style-snapshot.ts diff <before.json> <after.json>  prints the elements and properties that differ
//
// The expression walks every element under the root(s) the selector matches and records, per element, a set of
// properties that make up its look and box. Elements are keyed by their tag and position (`div:2>button:1`), not by
// their classes, so a class list that changed from old names to utilities still pairs with the element it was.
// With --pseudo, ::before and ::after are recorded too. Save the eval output to a file per build and theme, then diff.

const PROPS = [
  'display', 'position', 'top', 'right', 'bottom', 'left', 'z-index', 'box-sizing', 'width', 'height', 'min-width', 'max-width',
  'min-height', 'max-height', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'padding-top', 'padding-right',
  'padding-bottom', 'padding-left', 'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style', 'border-top-color', 'border-right-color',
  'border-bottom-color', 'border-left-color', 'border-top-left-radius', 'border-top-right-radius', 'border-bottom-left-radius',
  'border-bottom-right-radius', 'outline-style', 'outline-width', 'outline-color', 'outline-offset', 'color', 'background-color',
  'background-image', 'box-shadow', 'opacity', 'transform', 'transition', 'animation-name', 'animation-duration', 'filter',
  'backdrop-filter', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'text-transform',
  'text-align', 'text-decoration-line', 'white-space', 'text-overflow', 'overflow-x', 'overflow-y', 'flex-direction', 'flex-wrap',
  'flex-grow', 'flex-shrink', 'flex-basis', 'align-items', 'align-self', 'justify-content', 'row-gap', 'column-gap',
  'grid-template-columns', 'order', 'cursor', 'pointer-events', 'user-select', 'visibility', 'list-style-type', 'vertical-align',
  'fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'content', 'mask-image', 'touch-action', 'column-count', 'column-width',
];

function expression(selector: string, pseudo: boolean): string {
  return `(() => {
  const props = ${JSON.stringify(PROPS)};
  const out = {};
  const record = (key, el, p) => {
    const cs = getComputedStyle(el, p);
    if (p && (cs.content === 'none' || cs.content === 'normal')) return;
    const o = {};
    for (const n of props) o[n] = cs.getPropertyValue(n);
    out[key] = o;
  };
  const walk = (el, key) => {
    record(key, el);
    if (${pseudo}) { record(key + '::before', el, '::before'); record(key + '::after', el, '::after'); }
    const counts = {};
    for (const c of el.children) {
      const t = c.tagName.toLowerCase();
      counts[t] = (counts[t] || 0) + 1;
      walk(c, key + '>' + t + ':' + counts[t]);
    }
  };
  document.querySelectorAll(${JSON.stringify(selector)}).forEach((root, i) => walk(root, 'root' + i));
  return out;
})()`;
}

async function diff(beforePath: string, afterPath: string): Promise<number> {
  const before: Record<string, Record<string, string>> = JSON.parse(await Bun.file(beforePath).text());
  const after: Record<string, Record<string, string>> = JSON.parse(await Bun.file(afterPath).text());
  let n = 0;
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const a = before[key];
    const b = after[key];
    if (!a || !b) {
      console.log(`${key}: only ${a ? 'before' : 'after'}`);
      n++;
      continue;
    }
    for (const p of Object.keys(a)) {
      if (a[p] !== b[p]) {
        console.log(`${key} ${p}: ${a[p]} → ${b[p]}`);
        n++;
      }
    }
  }
  console.log(n ? `${n} differences` : 'no differences');
  return n;
}

const [cmd, x, y] = process.argv.slice(2);
if (cmd === 'js' && x) console.log(expression(x, process.argv.includes('--pseudo')));
else if (cmd === 'diff' && x && y) process.exitCode = (await diff(x, y)) ? 1 : 0;
else {
  console.error('usage: bun scripts/style-snapshot.ts js <root selector> [--pseudo] | diff <before.json> <after.json>');
  process.exitCode = 2;
}
