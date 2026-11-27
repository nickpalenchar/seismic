import { expect, test } from 'bun:test';
import { CardService } from '../../services/cardService';
import { useChatServer } from '../helpers/chatServer';

const server = useChatServer();

test('finds the project a card is on; a deleted card only when asked', () => {
  const service = new CardService(() => [server.shop(), server.website()]);
  const card = server.website().board.create({ title: 'A', x: 0, y: 0 });
  expect(service.getProjectRuntimeForCard(card.id)).toBe(server.website());
  expect(service.getProjectRuntimeForCard('nope')).toBeUndefined();
  server.website().board.remove(card.id);
  expect(service.getProjectRuntimeForCard(card.id)).toBeUndefined();
  expect(service.getProjectRuntimeForCard(card.id, { deleted: true })).toBe(server.website());
});

test('finds the project of a list of cards by its first, and the card as the project shows it', () => {
  const service = new CardService(() => [server.shop(), server.website()]);
  const card = server.website().board.create({ title: 'A', x: 0, y: 0 });
  expect(service.getProjectRuntimeForCards([card.id])).toBe(server.website());
  expect(service.getProjectRuntimeForCards([])).toBeUndefined();
  expect(service.getProjectRuntimeForCards(['nope', card.id])).toBeUndefined();
  expect(service.getCard(card.id)?.title).toBe('A');
  expect(service.getCard('nope')).toBeUndefined();
});

test("runs the owner's action on a card and answers with it; an unknown card has none", async () => {
  const service = new CardService(() => [server.shop(), server.website()]);
  const card = server.shop().board.create({ title: 'A', x: 0, y: 0 });
  const named = await service.performAction(card.id, { action: 'name' });
  expect(named?.id).toBe(card.id);
  expect(await service.performAction('nope', { action: 'undo' })).toBeUndefined();
});
