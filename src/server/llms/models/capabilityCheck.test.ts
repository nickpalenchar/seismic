import { expect, test } from 'bun:test';
import type { ModelInfo } from '../../../core/types';
import { CapabilityCheck, IMAGES_DROPPED, mergeCapabilities } from './capabilityCheck';
import { SeismicModel } from './seismicModel';

const info = (inputModalities?: string[]): ModelInfo => ({ model: 'm', isDefault: true, supportedReasoningEfforts: [], ...(inputModalities ? { inputModalities } : {}) });
const sees = new SeismicModel('codex', 'm', info(['text', 'image']));
const blind = new SeismicModel('codex', 'm', info(['text']));
const unknown = new SeismicModel('agy', 'm', info());
const message = { text: 'look', images: ['/a.png'] };

test('a model has a capability, lacks it, or its catalog does not say', () => {
  expect([sees.has('images'), blind.has('images'), unknown.has('images'), new SeismicModel('claude', 'opus').has('images')]).toEqual([true, false, undefined, undefined]);
  expect(blind.harnessName).toBe('Codex');
});

test('a model whose catalog does not say is never held to lack what a session needs', () => {
  const check = new CapabilityCheck(unknown, { images: 'required' });
  expect([check.ok, check.missing, check.degraded, check.problem]).toEqual([true, [], [], undefined]);
  expect(check.apply(message)).toBe(message);
});

test('a required capability the model lacks says why the session may not run', () => {
  const check = new CapabilityCheck(blind, { images: 'required' });
  expect([check.ok, check.missing, check.problem]).toEqual([false, ['images'], 'The selected Codex model does not support images, which this session needs']);
  expect(new CapabilityCheck(sees, { images: 'required' }).ok).toBe(true);
});

test('an optional capability the model lacks is dropped from a message, with a note', () => {
  const check = new CapabilityCheck(blind, { images: 'optional' });
  expect([check.ok, check.degraded]).toEqual([true, ['images']]);
  expect(check.apply(message)).toEqual({ text: `look\n\n${IMAGES_DROPPED}`, images: [] });
  expect(check.apply({ text: 'hi', images: [] })).toEqual({ text: 'hi', images: [] });
});

test('images to a model that cannot read them, which nothing named, are an error', () => {
  expect(() => new CapabilityCheck(blind).apply(message)).toThrow('Selected Codex model does not support images');
});

test('what the agent and the job ask for is merged, the stricter standing', () => {
  expect(mergeCapabilities({}, { images: 'optional' })).toEqual({ images: 'optional' });
  expect(mergeCapabilities({ images: 'optional' }, { images: 'required' })).toEqual({ images: 'required' });
  expect(mergeCapabilities({ images: 'required' }, { images: 'optional' })).toEqual({ images: 'required' });
});
