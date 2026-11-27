import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { HintId } from '../registries/hintRegistry';
import { HintLabel } from './components/hint';
import { HintsProvider } from './hints';

const page = (initial: ReadonlySet<HintId> | null) =>
  renderToStaticMarkup(
    <HintsProvider initial={initial}>
      <HintLabel hintId="review-pr">Ask for a review</HintLabel>
      <HintLabel hintId="needs-you">Needs you</HintLabel>
    </HintsProvider>,
  );

test('a hint not seen shows', () => {
  const html = page(new Set());
  expect(html).toContain('Ask for a review');
  expect(html).toContain('Needs you');
});

test('a hint seen does not show, and the others still do', () => {
  const html = page(new Set<HintId>(['review-pr']));
  expect(html).not.toContain('Ask for a review');
  expect(html).toContain('Needs you');
});

test('when the seen hints could not be loaded, no hint shows', () => {
  const html = page(null);
  expect(html).not.toContain('Ask for a review');
  expect(html).not.toContain('Needs you');
});

test('outside a provider no hint shows', () => {
  const html = renderToStaticMarkup(<HintLabel hintId="needs-you">Needs you</HintLabel>);
  expect(html).toBe('');
});
