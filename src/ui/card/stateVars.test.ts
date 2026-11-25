import { expect, test } from 'bun:test';
import { STATES } from '../../core/types';
import { stateVars } from './summary';

const css = await Bun.file(new URL('../tailwind.css', import.meta.url)).text();
const light = css.slice(css.indexOf(':root {'), css.indexOf('\n}', css.indexOf(':root {')));

test('every state and tone a card can show names colour tokens the token file defines', () => {
  
  const tones = [...STATES, 'muted', 'muted-foreground', 'destructive', 'asking', 'question', 'restart', 'reviewing'];
  const undefinedTokens = tones.flatMap((tone) =>
    Object.values(stateVars(tone)).flatMap((v) => {
      const name = /var\(--([\w-]+)\)/.exec(v)![1]!;
      return light.includes(`--${name}:`) ? [] : [`${tone}: --${name}`];
    }),
  );
  expect(undefinedTokens).toEqual([]);
});
