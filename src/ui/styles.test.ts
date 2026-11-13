import { expect, test } from 'bun:test';
import tailwind from 'bun-plugin-tailwind';

// The app's webview is WebKit (macOS, WebKitGTK on Linux), which knows `user-select` only by its
// prefix: without it, dragging a card selects some of its text there. The rules that set it are
// Tailwind's utilities (`select-none`, arbitrary `[user-select:…]`) and what is left of styles.css.
test('every user-select in the stylesheets also carries its -webkit- prefix', async () => {
  const dir = new URL('.', import.meta.url).pathname;
  const built = await Bun.build({ entrypoints: [`${dir}tailwind.css`], plugins: [tailwind] });
  const css = (await built.outputs[0]!.text()) + (await Bun.file(`${dir}styles.css`).text());
  const rules = css.split('}').filter((r) => /(^|[^-])user-select:/.test(r));
  expect(rules.length).toBeGreaterThan(0);
  for (const r of rules) {
    const plain = [...r.matchAll(/(?:^|[^-])user-select:\s*(\w+)/g)].map((m) => m[1]);
    const prefixed = [...r.matchAll(/-webkit-user-select:\s*(\w+)/g)].map((m) => m[1]);
    expect({ rule: r.trim(), prefixed }).toEqual({ rule: r.trim(), prefixed: plain });
  }
});
