import { expect, test } from 'bun:test';
import type { ModelInfo } from '../../../core/types';
import { IMAGES_DROPPED, messageForModel } from './needs';

const model = (inputModalities?: string[]): ModelInfo => ({ model: 'm', isDefault: true, supportedReasoningEfforts: [], ...(inputModalities ? { inputModalities } : {}) });
const message = { text: 'look', images: ['/a.png'] };

test('a model that reads images, or whose catalog does not say, gets the message as it is', () => {
  expect(messageForModel(undefined, model(['text', 'image']), message, 'Codex')).toBe(message);
  expect(messageForModel({ images: 'required' }, model(), message, 'Antigravity')).toBe(message);
  expect(messageForModel({ images: 'required' }, undefined, message, 'Antigravity')).toBe(message);
});

test('a message without images needs nothing of the model', () => {
  const plain = { text: 'hi', images: [] };
  expect(messageForModel({ images: 'required' }, model(['text']), plain, 'Codex')).toBe(plain);
});

test('where the model cannot read images, optional ones are left out with a note', () => {
  expect(messageForModel({ images: 'optional' }, model(['text']), message, 'Codex')).toEqual({ text: `look\n\n${IMAGES_DROPPED}`, images: [] });
});

test('where the model cannot read images, a required need or none declared is an error', () => {
  expect(() => messageForModel({ images: 'required' }, model(['text']), message, 'Codex')).toThrow('The selected Codex model does not support images, which this session needs');
  expect(() => messageForModel(undefined, model(['text']), message, 'Codex')).toThrow('Selected Codex model does not support images');
});
