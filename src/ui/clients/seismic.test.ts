import { afterEach, expect, test } from 'bun:test';
import { setProject } from '../api';
import { archiveCard, getCardById, patchCard, removeCard, restoreCard, setShareOnApproval, unarchiveCard } from './seismic';

const real = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = real;
});

test("a card's URL names the card alone, whatever project is in view", () => {
  setProject('shop');
  expect(getCardById('c1')).toBe('/api/v1/cards/c1');
});

test('“Share on approval” goes out as a PATCH of the share and answers with the card', async () => {
  const sent: { url: string; method?: string; body?: unknown }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    sent.push({ url, method: init.method, body: JSON.parse(init.body as string) });
    return Response.json({ card: { id: 'c3', demo: { notOnApproval: true } } });
  }) as typeof fetch;
  const card = await setShareOnApproval('c3', false);
  expect(sent).toEqual([{ url: '/api/v1/cards/c3/share', method: 'PATCH', body: { onApproval: false } }]);
  expect(card.demo?.notOnApproval).toBe(true);
});

test("a card's changes go out as a PATCH of the card and answer with it", async () => {
  const sent: { url: string; method?: string; body?: unknown }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    sent.push({ url, method: init.method, body: JSON.parse(init.body as string) });
    return Response.json({ card: { id: 'c4', title: 'Checkout' } });
  }) as typeof fetch;
  const card = await patchCard('c4', { title: 'Checkout' });
  expect(sent).toEqual([{ url: '/api/v1/cards/c4', method: 'PATCH', body: { title: 'Checkout' } }]);
  expect(card.title).toBe('Checkout');
});

test('a card deleted goes out as a DELETE of the card', async () => {
  const sent: { url: string; method?: string }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    sent.push({ url, method: init.method });
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  await removeCard('c5');
  expect(sent).toEqual([{ url: '/api/v1/cards/c5', method: 'DELETE' }]);
});

test("a deletion's undo goes out as a POST of the card's restore and answers with the card", async () => {
  const sent: { url: string; method?: string }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    sent.push({ url, method: init.method });
    return Response.json({ card: { id: 'c6', title: 'Back' } });
  }) as typeof fetch;
  const card = await restoreCard('c6');
  expect(sent).toEqual([{ url: '/api/v1/cards/c6/restore', method: 'POST' }]);
  expect(card.title).toBe('Back');
});

test('archiving and unarchiving go out as POSTs of the card\'s actions and answer with the card', async () => {
  const sent: { url: string; method?: string }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    sent.push({ url, method: init.method });
    return Response.json({ card: { id: 'c7', title: 'Done' } });
  }) as typeof fetch;
  expect((await archiveCard('c7')).id).toBe('c7');
  expect((await unarchiveCard('c7')).id).toBe('c7');
  expect(sent).toEqual([
    { url: '/api/v1/cards/c7/archive', method: 'POST' },
    { url: '/api/v1/cards/c7/unarchive', method: 'POST' },
  ]);
});
