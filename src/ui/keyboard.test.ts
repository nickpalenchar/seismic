import { expect, test } from 'bun:test';
import { pinned } from './keyboard';

test('with the keyboard up the page is pinned to the visible part, panned or scrolled up as Safari left it', () => {
  // an iPhone: Safari panned the page up by the keyboard's height to bring the field into view
  expect(pinned({ pageTop: 336, height: 408, scale: 1, page: 744 })).toEqual({ top: 336, height: 408 });
  // an iPad with the field high enough on the screen: nothing panned, the page only ends at the keyboard
  expect(pinned({ pageTop: 0, height: 700, scale: 1, page: 1024 })).toEqual({ top: 0, height: 700 });
});

test('without the keyboard nothing is pinned: the browser bars sliding in and out take less', () => {
  expect(pinned({ pageTop: 0, height: 744, scale: 1, page: 744 })).toBeNull();
  expect(pinned({ pageTop: 0, height: 664, scale: 1, page: 744 })).toBeNull();
  // the bars slid away: the visible part is taller than the page
  expect(pinned({ pageTop: 0, height: 820, scale: 1, page: 744 })).toBeNull();
});

test('zoomed in with two fingers the page is zoomed, not pinned', () => {
  expect(pinned({ pageTop: 120, height: 372, scale: 2, page: 744 })).toBeNull();
});
