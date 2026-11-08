import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { CANVAS_LUCIDE_ICONS, isCanvasIcon } from './canvas-icons';

test('a canvas icon is one emoji or a curated Lucide icon', () => {
  for (const ok of ['💡', '💶', '👩🏽‍💻', '🇩🇪', '❤️', '⭐', 'lucide:lightbulb', 'lucide:rocket']) expect([ok, isCanvasIcon(ok)]).toEqual([ok, true]);
  for (const bad of ['billing', 'lucide:no-such-icon', 'lucide:', '💡💡', 'a💡', '1', '#', '💡 ', 'lucide:Lightbulb']) expect([bad, isCanvasIcon(bad)]).toEqual([bad, false]);
});

test('every curated Lucide icon exists in lucide-react', () => {
  const dir = join(import.meta.dir, '../../node_modules/lucide-react/dist/esm/icons');
  expect(CANVAS_LUCIDE_ICONS.filter((n) => !existsSync(join(dir, `${n}.mjs`)))).toEqual([]);
});
