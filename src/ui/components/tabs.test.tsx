import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './tabs';

test('each list supplies its own look without changing controlled selection', () => {
  const html = renderToStaticMarkup(
    <Tabs value="a">
      <TabsList variant="pill"><TabsTrigger value="a">Pill</TabsTrigger></TabsList>
      <TabsList variant="underline"><TabsTrigger value="b">Underline</TabsTrigger></TabsList>
      <TabsList><TabsTrigger value="c">Container styled</TabsTrigger></TabsList>
      <TabsContent value="a" forceMount hidden>Draft</TabsContent>
    </Tabs>,
  );
  const triggers = [...html.matchAll(/<button[^>]+role="tab"[^>]*>/g)].map((m) => m[0]!);
  expect(triggers).toHaveLength(3);
  expect(triggers[0]).toContain('rounded-xl');
  expect(triggers[0]).toContain('data-state="active"');
  expect(triggers[1]).toContain('border-b-2');
  expect(triggers[1]).toContain('data-state="inactive"');
  expect(triggers[2]).not.toContain('rounded-');
  expect(triggers[2]).not.toContain('px-');
  expect(html).toContain('hidden=""');
  expect(html).toContain('Draft');
});
