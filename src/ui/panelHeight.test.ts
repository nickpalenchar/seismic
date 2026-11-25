import { expect, test } from 'bun:test';
import { glide, settle, speed, thrown } from './panelHeight';

test('a top let go between the edges keeps the height the owner dragged it to', () => {
  expect(settle(0.5)).toBeCloseTo(0.5);
  expect(settle(0.2)).toBeCloseTo(0.8);
  expect(settle(0.8)).toBeCloseTo(0.2);
});

test('a top let go near the screen top takes the full height', () => {
  expect(settle(0.1)).toBe(1);
  expect(settle(-0.05)).toBe(1);
});

test('a top let go near the screen bottom closes the panel', () => {
  expect(settle(0.9)).toBe('close');
  expect(settle(1.2)).toBe('close');
});

test('the speed of a finger let go comes from its last moves, and is none once it has stopped', () => {
  const trail = [
    { t: 0, y: 500 },
    { t: 100, y: 480 },
    { t: 120, y: 440 },
    { t: 140, y: 400 },
  ];
  expect(speed(trail, 140)).toBeCloseTo(-2);
  
  expect(speed(trail, 170)).toBeCloseTo(-2);
  
  expect(speed(trail, 300)).toBe(0);
  expect(speed([{ t: 0, y: 0 }], 10)).toBe(0);
});

test('a top let go with a still finger stays where it is, a thrown one glides on in its direction', () => {
  expect(thrown(0.5, 0.1, 800)).toBe(0.5);
  expect(thrown(0.5, -0.1, 800)).toBe(0.5);
  
  expect(settle(thrown(0.5, -2, 800))).toBe(1);
  
  expect(settle(thrown(0.5, 2, 800))).toBe('close');
  
  const gentle = thrown(0.5, -0.8, 800);
  expect(gentle).toBeLessThan(0.5);
  expect(settle(gentle)).toBeCloseTo(1 - gentle);
});

test('a glide starts at the speed of the finger and stops within bounds', () => {
  const g = glide(300, 2);
  expect(g.ms).toBe(300);
  expect(g.ease).toBe('cubic-bezier(.333, 0.667, .667, 1)');
  expect(glide(2000, 0.5).ms).toBe(500);
  
  expect(glide(20, 4)).toEqual({ ms: 150, ease: 'cubic-bezier(.333, 1.000, .667, 1)' });
});
