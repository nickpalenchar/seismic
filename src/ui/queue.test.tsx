import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Item } from '../core/types';
import { PlannedDependencies } from './queue';

test('a planned card lists each unfinished prerequisite until the last is done', () => {
  const card = (id: string, title: string): Item => ({
    id, title, kind: 'task', source: 'manual', state: 'planned', body: '', repo: 'billing', x: 0, y: 0, canvasVisible: true,
  });
  const a = card('a', 'Confirm invoice fields');
  const c = card('c', 'Verify tax rules');
  const b: Item = { ...card('b', 'Build invoice export'), plan: { manualDependsOn: [a.id, c.id] } };
  const render = (first: Item['state'], second: Item['state']) => renderToStaticMarkup(
    <PlannedDependencies item={b} items={[{ ...a, state: first }, b, { ...c, state: second }]} />,
  );

  const both = render('working', 'working');
  expect(both).toContain('Waits for');
  expect(both).toContain(a.title);
  expect(both).toContain(c.title);

  const remaining = render('done', 'working');
  expect(remaining).toContain('Waits for');
  expect(remaining).toContain(c.title);
  expect(remaining).not.toContain(a.title);

  expect(render('done', 'live')).not.toContain('Waits for');
});
