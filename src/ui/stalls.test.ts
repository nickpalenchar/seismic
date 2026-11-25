import { expect, test } from 'bun:test';
import { beforeOf, framesWithin, type LongFrame, scriptsOf, stallOf } from './stalls';

const script = (invoker: string, fn: string, duration: number) => ({ invoker, sourceURL: 'http://127.0.0.1:4417/_bun/client/index-a1b2.js?v=3', sourceFunctionName: fn, sourceCharPosition: 1204, duration });

test('a stall’s time goes to the scripts and the style and layout of the long frames within it, longest first', () => {
  const frames: LongFrame[] = [
    { startTime: 1000, duration: 900, styleAndLayoutStart: 1700, scripts: [script('WebSocket.onmessage', '', 600), script('MessagePort.onmessage', 'performWorkUntilDeadline', 100)] },
    { startTime: 1900, duration: 300, styleAndLayoutStart: 0, scripts: [script('MessagePort.onmessage', 'performWorkUntilDeadline', 250)] },
    
    { startTime: 100, duration: 80, styleAndLayoutStart: 0, scripts: [script('DOMWindow.onclick', 'approve', 80)] },
  ];
  expect(scriptsOf(framesWithin(frames, 950, 2300))).toEqual([
    { what: 'WebSocket.onmessage: (anonymous) (index-a1b2.js@1204)', ms: 600 },
    { what: 'MessagePort.onmessage: performWorkUntilDeadline (index-a1b2.js@1204)', ms: 350 },
    { what: 'style and layout', ms: 200 },
  ]);
  
  expect(scriptsOf([{ startTime: 0, duration: 600, styleAndLayoutStart: 590, scripts: [script('WebSocket.onmessage', 'x', 580)] }])).toEqual([{ what: 'WebSocket.onmessage: x (index-a1b2.js@1204)', ms: 580 }]);
  expect(framesWithin(frames, 5000, 6000)).toEqual([]);
});

test('what the page took in within the three seconds before a stall goes with it, and the message whose handling began it', () => {
  const noted = [
    { at: 1000, what: 'event' },
    { at: 9800, what: 'snapshot (412 KB)' },
    { at: 10_020, what: 'snapshot (2 MB, read in 900 ms)' },
    { at: 11_200, what: 'usage' },
  ];
  expect(beforeOf(noted, 10_000, 11_000)).toEqual(['snapshot (412 KB) 0.2 s before', 'snapshot (2 MB, read in 900 ms) 0.0 s before']);
});

test('a heartbeat the page takes in half a second late tells of a stall, and the beats queued behind it of none', () => {
  
  expect(stallOf(20, 1020, 900)).toBeNull();
  expect(stallOf(490, 1490, 900)).toBeNull();
  
  expect(stallOf(800, 1800, 900)).toEqual({ from: 1000, to: 1800 });
  
  expect(stallOf(700, 1800.1, 1800)).toBeNull();
  
  expect(stallOf(1500, 2600, 1800)).toEqual({ from: 1800, to: 2600 });
  
  expect(stallOf(451, 1551, 1000, 400)).toEqual({ from: 1100, to: 1551 });
});
