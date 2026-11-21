import { afterEach, expect, test } from 'bun:test';
import { setProject } from '../api';
import { getCardById, patchCard, removeCard, setShareOnApproval } from './seismic';

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
