import { expect, test } from 'bun:test';
import { BadRequest } from '../../board';
import { NotFound } from '../../notFound';
import { CardService } from '../../services/cardService';
import { useChatServer } from '../helpers/chatServer';

const server = useChatServer();

const serviceOf = () => new CardService(server.website().dataStore.cardRepository, () => [server.shop(), server.website()]);

test('finds the project a card is on; a deleted card only when asked', async () => {
  const service = serviceOf();
  const card = server.website().board.create({ title: 'A', x: 0, y: 0 });
  expect(await service.getProjectRuntimeForCard(card.id)).toBe(server.website());
  await expect(service.getProjectRuntimeForCard('nope')).rejects.toBeInstanceOf(NotFound);
  server.website().board.remove(card.id);
  await expect(service.getProjectRuntimeForCard(card.id)).rejects.toBeInstanceOf(NotFound);
  expect(await service.getProjectRuntimeForCard(card.id, { deleted: true })).toBe(server.website());
});

test('finds the project of a list of cards by its first; an empty or unknown list is refused', async () => {
  const service = serviceOf();
  const card = server.website().board.create({ title: 'A', x: 0, y: 0 });
  expect(await service.getProjectRuntimeForCards([card.id])).toBe(server.website());
  await expect(service.getProjectRuntimeForCards([])).rejects.toBeInstanceOf(BadRequest);
  await expect(service.getProjectRuntimeForCards('nope')).rejects.toBeInstanceOf(BadRequest);
  await expect(service.getProjectRuntimeForCards(['nope', card.id])).rejects.toBeInstanceOf(NotFound);
});

test("runs the owner's action on a card and answers with it; an unknown card is refused", async () => {
  const service = serviceOf();
  const card = server.shop().board.create({ title: 'A', x: 0, y: 0 });
  const named = await service.performAction(card.id, { action: 'name' });
  expect(named.id).toBe(card.id);
  await expect(service.performAction('nope', { action: 'undo' })).rejects.toBeInstanceOf(NotFound);
});
