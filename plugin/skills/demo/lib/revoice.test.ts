import { describe, expect, test } from 'bun:test';
import { cuesOf, frameListText, framesOf, reportOf, retimed, stretched, translationProblems, type Words } from './revoice.ts';

const source: Words = {
  title: 'Vorschläge lassen sich übernehmen',
  scenes: [
    { title: 'Vorher', say: 'Ein Vorschlag. [short pause] Bisher scheiterte das.' },
    { title: 'Jetzt', say: 'Jetzt geht es.' },
  ],
  report: { summary: 'Works again.\n\nNot checked: the phone.', meta: { Branch: 'x' } },
};

describe('re-voicing a demo', () => {
  test('reads the cues of captions and chapters', () => {
    const vtt = 'WEBVTT\n\n00:00:00.352 --> 00:00:10.292\nEin Vorschlag.\n\n00:01:11.247 --> 00:01:22.467\nJetzt „geht“ es.\n';
    expect(cuesOf(vtt)).toEqual([
      { start: 0.352, end: 10.292, text: 'Ein Vorschlag.' },
      { start: 71.247, end: 82.467, text: 'Jetzt „geht“ es.' },
    ]);
  });

  test('a cue of several lines is read whole', () => {
    expect(cuesOf('WEBVTT\n\n00:00:00.002 --> 00:00:09.000\nVorher:\nkein Vorschlag\n\n00:00:09.000 --> 00:00:12.000\nJetzt\n')).toEqual([
      { start: 0.002, end: 9, text: 'Vorher:\nkein Vorschlag' },
      { start: 9, end: 12, text: 'Jetzt' },
    ]);
  });

  test('a narrated stretch plays as long as its new clip; the rest keeps its length and moves along', () => {
    const at = stretched([
      { from: 10, to: 20, ratio: 1.5 },
      { from: 30, to: 34, ratio: 0.5 },
    ]);
    expect(at(5)).toBe(5);
    expect(at(10)).toBe(10);
    // halfway through the words is halfway through the longer clip
    expect(at(15)).toBe(17.5);
    expect(at(20)).toBe(25);
    expect(at(30)).toBe(35);
    expect(at(34)).toBe(37);
    expect(at(40)).toBe(43);
  });

  test('a frame across the edge of a stretch takes a share of both', () => {
    const frames = framesOf("ffconcat version 1.0\nfile 'frames/1.jpg'\nduration 8.0000\nfile 'frames/2.jpg'\nduration 4.0000\nfile 'frames/3.jpg'\nduration 1.0000\nfile 'frames/3.jpg'\n");
    expect(frames).toEqual([
      { file: 'frames/1.jpg', seconds: 8 },
      { file: 'frames/2.jpg', seconds: 4 },
      { file: 'frames/3.jpg', seconds: 1 },
      { file: 'frames/3.jpg' },
    ]);
    const held = retimed(frames, stretched([{ from: 10, to: 12, ratio: 2 }]));
    expect(held.map((f) => f.seconds)).toEqual([8, 6, 1, undefined]);
  });

  test('the new frame list names the recorded frames from where it is written', () => {
    const text = frameListText([{ file: 'frames/1.jpg', seconds: 0.5 }, { file: 'frames/1.jpg' }], '/d/.work', '/d/.work/revoice');
    expect(text).toBe("ffconcat version 1.0\nfile '../frames/1.jpg'\nduration 0.5000\nfile '../frames/1.jpg'\n");
  });

  test('reads the report page back, a meta given as one line in one piece', () => {
    const html = `<!doctype html>
<html lang="en">
<main>
<h1>Proposals &amp; ideas</h1>
<p class="summary">Works &quot;again&quot;.</p>
<p class="summary">Not checked: the phone &lt;neu&gt;.</p>
<div class="decision"><h2>Open question</h2>What now?</div>
<dl><dt>0</dt><dd>B</dd><dt>1</dt><dd>r</dd><dt>2</dt><dd> </dd><dt>3</dt><dd>x</dd></dl>
</main>`;
    expect(reportOf(html)).toEqual({
      language: 'en',
      title: 'Proposals & ideas',
      report: { summary: 'Works "again".\n\nNot checked: the phone <neu>.', question: 'What now?', meta: { '': 'Br x' } },
    });
  });

  test('a page of an earlier director is read without its lists of what was shown, not shown and noticed', () => {
    const html = `<!doctype html>
<html lang="en">
<main>
<h1>Proposals</h1>
<p class="summary">Works again.</p>
<div class="grid">
  <section class="card"><h2>Shown</h2><ul><li>Before</li><li>Now</li></ul></section>
  <section class="card"><h2>Not shown</h2><p class="none">—</p></section>
  <section class="card"><h2>Noticed</h2><ul><li>One</li></ul></section>
</div>
<dl><dt>Branch</dt><dd>x</dd></dl>
</main>`;
    expect(reportOf(html)).toEqual({ language: 'en', title: 'Proposals', report: { summary: 'Works again.', meta: { Branch: 'x' } } });
  });

  test('a page without a summary is no report page', () => {
    expect(() => reportOf('<html lang="en"><h1>Logo</h1><p>Three drafts</p></html>')).toThrow('no report page');
  });

  test('a translation keeps the scenes, the audio tags and the summary’s paragraphs', () => {
    const good: Words = {
      title: 'Proposals can be accepted',
      scenes: [
        { title: 'Before', say: 'A proposal. [short pause] Until now, that failed.' },
        { title: 'Now', say: 'Now it works.' },
      ],
      report: { summary: 'Works again.\n\nNot checked: the phone.', meta: { Branch: 'x' } },
    };
    expect(translationProblems(source, good)).toEqual([]);
    expect(translationProblems(source, { ...good, scenes: [good.scenes[0]!] })).toEqual(['scenes: 2 expected, 1 given']);
    const untagged = { ...good, scenes: [{ title: 'Before', say: 'A proposal. Until now, that failed.' }, good.scenes[1]!] };
    expect(translationProblems(source, untagged)).toEqual(['scene 1: the audio tags differ from the source\'s ([short pause])']);
    expect(translationProblems(source, { ...good, report: { ...good.report, summary: 'Works again. Not checked: the phone.' } })).toEqual([
      'report.summary: 2 paragraphs expected, separated by a blank line',
    ]);
  });
});
