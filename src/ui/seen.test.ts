import { expect, test } from 'bun:test';
import { cameInView, follow, type Spans } from './seen';

test('what comes while the conversation is in view counts as seen, what came while the page was hidden not', () => {
  
  let came: Spans = follow([], undefined, 7, true);
  expect(came).toEqual([]);
  came = follow(came, 7, 9, true);
  expect([8, 9].map((id) => cameInView(came, id))).toEqual([true, true]);
  expect(cameInView(came, 7)).toBe(false);
  
  came = follow(came, 9, 11, false);
  came = follow(came, 11, 12, true);
  expect([10, 11, 12].map((id) => cameInView(came, id))).toEqual([false, false, true]);
  
  expect(follow([], undefined, 12, true)).toEqual([]);
});
