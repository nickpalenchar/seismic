import { describe, expect, test } from 'bun:test';
import { answers, answerText, OTHER, ownAnswers, readAnswer, toggle, toggleOther } from './answer';

const format = { text: 'Welches Format?', options: ['CSV', 'PDF', 'Excel'] };
const whom = { text: 'Für wen?\nKurz.', options: ['Vermieter', 'Verwalter'], multiple: true };

describe('an answer', () => {
  test('to one question names it, then the owner’s words', () => {
    expect(answerText([format], [['CSV']], '')).toBe('**Welches Format?** CSV');
    expect(answerText([format], [['CSV']], ' aber mit Kopfzeile ')).toBe('**Welches Format?** CSV\n\naber mit Kopfzeile');
    expect(answerText([format], [[]], 'Lieber JSON.')).toBe('Lieber JSON.');
  });

  test('to several questions names each answered one', () => {
    expect(answerText([format, whom], [['PDF'], ['Vermieter', 'Verwalter']], 'Danke.')).toBe(
      '**Welches Format?** PDF\n**Für wen? Kurz.** Vermieter, Verwalter\n\nDanke.',
    );
    expect(answerText([format, whom], [[], ['Verwalter']], '')).toBe('**Für wen? Kurz.** Verwalter');
    expect(answerText([format, whom], [[], []], '')).toBe('');
  });

  test('reads back as the options picked for each question it names, and the owner’s words', () => {
    expect(readAnswer(answerText([format, whom], [['PDF'], ['Verwalter', 'Vermieter']], 'Danke.\n\nSonst nichts.'), [whom, format])).toEqual({
      picks: [['Verwalter', 'Vermieter'], ['PDF']],
      words: 'Danke.\n\nSonst nichts.',
    });
    expect(readAnswer(answerText([format, whom], [[], ['Verwalter']], ''), [format, whom])).toEqual({ picks: [undefined, ['Verwalter']], words: '' });
    // an option that starts like another, followed by a comma
    const later = { text: 'Wann?', options: ['Jetzt', 'Jetzt, aber leise'] };
    expect(readAnswer('**Wann?** Jetzt, aber leise', [later]).picks).toEqual([['Jetzt, aber leise']]);
    // words of their own, a question asked nowhere, a line naming no question: nothing picked
    for (const text of ['Lieber JSON.', '**Wie viele?** 3\n\nGenau.', '**Welches Format?** CSV\nUnd PDF.'])
      expect(readAnswer(text, [format])).toEqual({ picks: [], words: text });
  });

  test('picks one option of a single choice, several of a multiple choice in their order', () => {
    expect(toggle(format, ['CSV'], 'PDF')).toEqual(['PDF']);
    expect(toggle(format, ['CSV'], 'CSV')).toEqual([]);
    expect(toggle(whom, ['Verwalter'], 'Vermieter')).toEqual(['Vermieter', 'Verwalter']);
    expect(toggle(whom, ['Vermieter', 'Verwalter'], 'Vermieter')).toEqual(['Verwalter']);
  });
});

describe('the owner’s own answer', () => {
  test('is picked like an option: on a single-choice question in place of the others', () => {
    expect(toggleOther(format, ['CSV'], OTHER)).toEqual([OTHER]);
    expect(toggleOther(format, [OTHER], 'PDF')).toEqual(['PDF']);
    expect(toggleOther(whom, ['Verwalter'], OTHER)).toEqual(['Verwalter', OTHER]);
  });

  test('answers its question once picked and written', () => {
    expect(answers([[OTHER], ['Vermieter', OTHER]], [' JSON ', ''])).toEqual([['JSON'], ['Vermieter']]);
    expect(answers([['CSV']], ['JSON'])).toEqual([['CSV']]);
    expect(answerText([format], answers([[OTHER]], ['JSON']), 'Danke.')).toBe('**Welches Format?** JSON\n\nDanke.');
  });

  test('reads back as its question’s answer, after the options picked', () => {
    expect(readAnswer('**Welches Format?** JSON', [format])).toEqual({ picks: [['JSON']], words: '' });
    expect(readAnswer(answerText([format, whom], answers([[], ['Verwalter', OTHER]], ['', 'die Hausmeisterin, bitte']), 'Danke.'), [format, whom])).toEqual({
      picks: [undefined, ['Verwalter', 'die Hausmeisterin, bitte']],
      words: 'Danke.',
    });
  });

  test('stands in the text where the picks go apart, named by its question where several stand', () => {
    expect(ownAnswers([format], [[OTHER]], ['JSON'], 'Danke.')).toBe('JSON\n\nDanke.');
    expect(ownAnswers([format, whom], [[OTHER], ['Vermieter']], ['JSON'], '')).toBe('**Welches Format?** JSON');
    expect(ownAnswers([format], [['CSV']], ['JSON'], ' Danke. ')).toBe('Danke.');
  });
});
