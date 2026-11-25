import { expect, test } from 'bun:test';
import type { UsageLimit } from '../core/types';
import { headline } from './usage';

const limit = (kind: string, group: string, percent: number): UsageLimit => ({ kind, group, percent, severity: 'normal' });

test('the bar shows one limit per group: the one most used', () => {
  const session = limit('session', 'session', 12);
  const all = limit('weekly_all', 'weekly', 30);
  const fable = limit('weekly_scoped', 'weekly', 64);
  expect(headline([session, all, fable])).toEqual([session, fable]);
  
  expect(headline([all, { ...fable, percent: 30 }])).toEqual([all]);
});
