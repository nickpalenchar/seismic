import { expect, test } from 'bun:test';
import { citable, spot } from './cite';
import { citeAt } from './draft';

const q = '„so“ - ';
const put = (text: string, caret: number) => {
  const { at, piece } = citeAt(text, caret, q);
  return text.slice(0, at) + piece + text.slice(at);
};

test('a quote goes at the end of the field when the cursor stood there, on a line of its own', () => {
  expect(put('', 0)).toBe(q);
  expect(put('Erste Zeile', 11)).toBe(`Erste Zeile\n${q}`);
  
  expect(put('Erste Zeile\n', 12)).toBe(`Erste Zeile\n${q}`);
});

test('from the middle of the text, the quote becomes the line after the cursor\'s', () => {
  expect(put('Zeile eins\nZeile zwei', 3)).toBe(`Zeile eins\n${q}\nZeile zwei`);
  expect(put('Zeile eins\nZeile zwei', 0)).toBe(`Zeile eins\n${q}\nZeile zwei`);
  
  expect(put('Zeile eins\nZeile zwei', 14)).toBe(`Zeile eins\nZeile zwei\n${q}`);
  
  expect(citeAt('Zeile eins\nZeile zwei', 3, q)).toEqual({ at: 10, piece: `\n${q}` });
});

test('the marked text is quoted on one line, without the spaces around it', () => {
  expect(citable('  erster Satz.\n\n  zweiter   Satz ')).toBe('erster Satz. zweiter Satz');
});

test('the button stands beside the marking, inside the part of the window it is seen in', () => {
  const view: [number, number, number, number] = [100, 100, 900, 700];
  
  expect(spot([200, 300, 600, 320], [200, 330, 400, 350], false, view, false)).toEqual({ x: 400, y: 350, below: true, left: true });
  expect(spot([200, 300, 600, 320], [200, 330, 400, 350], true, view, false)).toEqual({ x: 200, y: 300, below: false, left: false });
  
  expect(spot([200, 300, 600, 320], [200, 330, 400, 350], false, view, true)).toEqual({ x: 300, y: 350, below: true, left: false });
  
  expect(spot([200, 800, 600, 820], [200, 830, 400, 850], false, view, false)).toBeNull();
  expect(spot([200, 300, 5000, 320], [200, 330, 5000, 350], false, view, false)?.x).toBe(876);
  expect(spot([200, 100, 300, 120], [200, 850, 300, 870], false, view, false)?.y).toBe(700);
});
