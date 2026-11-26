import { afterEach, expect, test } from 'bun:test';
import { chatLongClosed, chatWentQuiet, forgetChatClosings, markChatClosed, REOPEN_WITHIN_MS } from './chatReopen';

afterEach(forgetChatClosings);

const minutes = (n: number) => n * 60_000;

test('a panel closed within 15 minutes resumes its chat, a later one opens on a new chat', () => {
  markChatClosed('shop', 0);
  expect(REOPEN_WITHIN_MS).toBe(minutes(15));
  expect(chatLongClosed('shop', minutes(15))).toBe(false);
  expect(chatLongClosed('shop', minutes(15) + 1)).toBe(true);
  expect(chatLongClosed('site', minutes(60))).toBe(false);
});

test('the first open on a page judges the chat by its last words, closings by the closing', () => {
  const said = new Date(0).toISOString();
  expect(chatWentQuiet('shop', said, minutes(10))).toBe(false);
  expect(chatWentQuiet('shop', said, minutes(16))).toBe(true);
  markChatClosed('shop', minutes(15));
  expect(chatWentQuiet('shop', said, minutes(16))).toBe(false);
});
