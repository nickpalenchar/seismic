import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { Callout, type CalloutKind, CalloutTitle } from './callout';

const render = (kind?: CalloutKind) => renderToStaticMarkup(<Callout kind={kind}><CalloutTitle>Heads up</CalloutTitle></Callout>);

test('an info callout is the plain alert', () => {
  const html = render();
  expect(html).toContain('role="alert"');
  expect(html).toContain('data-kind="info"');
  expect(html).toContain('bg-card');
  expect(html).not.toMatch(/amber|red-|purple|blue/);
});

test('each other kind tints the alert in its own hue, light and dark', () => {
  const hues: Record<Exclude<CalloutKind, 'info'>, string> = { warn: 'amber', error: 'red', note: 'purple', 'bold-info': 'blue' };
  for (const [kind, hue] of Object.entries(hues)) {
    const html = render(kind as CalloutKind);
    expect(html).toContain(`data-kind="${kind}"`);
    for (const cls of [`bg-${hue}-50`, `border-${hue}-200`, `text-${hue}-900`, `dark:bg-${hue}-950`]) expect(html).toContain(cls);
    // the tint replaces the plain card fill rather than sitting beside it
    expect(html).not.toContain('bg-card ');
  }
});
