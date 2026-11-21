import { expect, test } from 'bun:test';
import type { Item } from '../../../../../core/types';
import { CardTags } from '../../../../llms/agents/agentJobs/cardTags';

const card = (id: string) => ({ id }) as unknown as Item;

test('cards are tagged in the order of the lists, a card in several lists keeping its first tag', () => {
  const tags = new CardTags([card('a'), card('b')], [card('b'), card('c')]);
  expect(['a', 'b', 'c'].map((id) => tags.tagOf(id))).toEqual(['K1', 'K2', 'K3']);
  expect(['K1', 'K2', 'K3'].map((t) => tags.idOf(t))).toEqual(['a', 'b', 'c']);
});

test('a tag that was never given names no card, and a card that was never tagged has no tag', () => {
  const tags = new CardTags([card('a')]);
  expect(tags.idOf('K9')).toBeUndefined();
  expect(() => tags.tagOf('zz')).toThrow('card zz has no tag');
});
