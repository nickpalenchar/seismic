import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ClonePool, Item } from '../core/types';
import { WorkingRows } from './workstations';

test('working rows keep their activity and separate description after releasing a workstation', () => {
  for (const state of ['working', 'approved', 'live'] as const) {
    const item: Item = {
      id: 'checkout', kind: 'task', source: 'manual', repo: 'shop', x: 0, y: 0, canvasVisible: true,
      title: 'Improve checkout', body: 'Keep the checkout easy to use.', state,
      agent: { inTurn: true, doing: 'debugging', statusLine: 'Checking the checkout.', ...(state === 'live' ? { finishing: true } : {}) },
    };
    const pools: ClonePool[] = [{ repo: 'shop', hosts: [{
      name: 'local', slots: 2, total: 1, cards: [item.id], busy: [item.id],
      workstations: [{ path: '/shop/checkout', card: item.id }],
    }] }];
    const render = (pools: ClonePool[]) => renderToStaticMarkup(<WorkingRows
      cards={[item]} items={[item]} pools={pools} underway={{}} projects={[]}
      onOpen={() => {}} onElsewhere={() => {}} onKeep={() => {}}
    />);
    const face = (html: string) => html.slice(html.indexOf('<span class="face '), html.indexOf('</button>'));
    const assigned = face(render(pools));
    expect(assigned).toContain('doing');
    expect(assigned).toContain('block truncate text-muted-foreground">Checking the checkout.</span>');
    expect(assigned).not.toContain(item.body);
    // No pool snapshot, an empty pool, and a released clone all use the same face.
    expect(face(render([]))).toBe(assigned);
    expect(face(render([{ repo: 'shop', hosts: [] }]))).toBe(assigned);
    pools[0]!.hosts[0]!.workstations[0] = { path: '/shop/checkout' };
    expect(face(render(pools))).toBe(assigned);
  }
});

test("an idea whose agent is at work pulses in the phone's list as its dot does in the header", () => {
  const idea: Item = { id: 'gift', kind: 'task', source: 'manual', repo: 'shop', x: 0, y: 0, canvasVisible: true, title: 'Gift wrapping', body: 'Offer gift wrapping.', state: 'idea' };
  const render = (exploring?: string[]) => renderToStaticMarkup(<WorkingRows
    cards={[idea]} items={[idea]} underway={{}} projects={[]} onOpen={() => {}} onElsewhere={() => {}} onKeep={() => {}}
    pools={[{ repo: 'shop', hosts: [{ name: 'local', here: true, slots: 1, total: 1, cards: [], busy: [], workstations: [{ path: '/shop/1' }], ...(exploring ? { exploring } : {}) }] }]}
  />);
  expect(render(['gift'])).toContain('animate-[ws-pulse');
  // its agent done with the reply, the idea stands still
  expect(render()).not.toContain('animate-[ws-pulse');
});
