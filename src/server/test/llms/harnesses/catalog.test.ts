import { expect, test } from 'bun:test';
import type { ModelInfo } from '../../../../core/types';
import { ModelCatalog } from '../../../llms/harnesses/catalog';

const model = (name: string): ModelInfo => ({ model: name, isDefault: true, supportedReasoningEfforts: [] });

test('the pickers wait only for the first listing, then get the last list at once while a stale one is listed again', async () => {
  let clock = 0;
  let calls = 0;
  let answer: (models: ModelInfo[]) => void = () => {};
  const catalog = new ModelCatalog(() => (calls++, new Promise<ModelInfo[]>((r) => (answer = r))), 60_000, () => clock);
  
  const first = catalog.models();
  const second = catalog.models();
  expect(calls).toBe(1);
  answer([model('gpt-a')]);
  expect(await first).toEqual([model('gpt-a')]);
  expect(await second).toEqual([model('gpt-a')]);
  
  expect(await catalog.models()).toEqual([model('gpt-a')]);
  expect(calls).toBe(1);
  
  clock = 120_000;
  expect(await catalog.models()).toEqual([model('gpt-a')]);
  expect(calls).toBe(2);
  answer([model('gpt-b')]);
  await Promise.resolve();
  expect(await catalog.models()).toEqual([model('gpt-b')]);
});

test('a listing that fails fails the picker only while no list is known', async () => {
  let fail = true;
  const catalog = new ModelCatalog(async () => { if (fail) throw new Error('not signed in'); return [model('gpt-a')]; }, 60_000, () => 0);
  await expect(catalog.models()).rejects.toThrow('not signed in');
  fail = false;
  expect(await catalog.models()).toEqual([model('gpt-a')]);
  fail = true;
  await catalog.refresh().catch(() => {});
  expect(await catalog.models()).toEqual([model('gpt-a')]);
});
