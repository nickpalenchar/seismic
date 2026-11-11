import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { Collapsible, CollapsibleTrigger } from './collapsible';

test('an asChild trigger renders its one child as the trigger', () => {
  const html = renderToStaticMarkup(
    <Collapsible>
      <CollapsibleTrigger asChild>
        <button className="mine">Sides</button>
      </CollapsibleTrigger>
    </Collapsible>,
  );
  expect(html).toMatch(/<button class="[^"]*\bmine"[^>]*>Sides<\/button>/);
  expect(html).toContain('aria-expanded="false"');
  expect(html).not.toContain('<svg');
});

test('a marker trigger puts the chevron before its text', () => {
  const html = renderToStaticMarkup(
    <Collapsible>
      <CollapsibleTrigger marker>Thread</CollapsibleTrigger>
    </Collapsible>,
  );
  expect(html).toMatch(/<svg[^>]*lucide-chevron-right[\s\S]*<\/svg>Thread/);
});
