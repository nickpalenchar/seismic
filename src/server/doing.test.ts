import { describe, expect, test } from 'bun:test';
import { type Doing, onTool, onToolDone, shownDoing } from './doing';

const run = (...steps: ((d: Doing) => Doing)[]) => steps.reduce((d, s) => s(d), {} as Doing);
const tool = (name: string, input: Record<string, unknown> = {}) => (d: Doing) => onTool(d, name, input);
const bash = (command: string) => tool('Bash', { command });
const done = (name: string, ok = true) => (d: Doing) => onToolDone(d, name, ok);

describe('what a worker is doing', () => {
  test('at work by default; thinking once it went quiet, until its next step', () => {
    expect(shownDoing(run(tool('Read', { file_path: 'a.ts' })))).toBe('working');
    expect(shownDoing({ thinking: true })).toBe('thinking');
    expect(shownDoing(run(() => ({ thinking: true }), tool('Edit', { file_path: 'a.ts' })))).toBe('building');
  });

  test('a failed step makes it debugging until that tool succeeds again; Seismic’s own tools change nothing', () => {
    const failed = run(bash('bun test'), done('Bash', false));
    expect(shownDoing(failed)).toBe('debugging');
    expect(shownDoing(run(() => failed, tool('Read'), done('Read'), tool('mcp__seismic__report'), done('mcp__seismic__report')))).toBe('debugging');
    expect(shownDoing(run(() => failed, bash('bun test'), done('Bash')))).toBe('working');
  });

  test('the demo skill goes from preparing over recording to finalizing, and the handover ends it', () => {
    const preparing = run(tool('Skill', { skill: 'obeya:demo' }), done('Skill'), tool('Write', { file_path: '/home/me/demos/shop-x/demo.ts' }), bash('cd /home/me/demos/shop-x && node demo.ts --dry'));
    expect(shownDoing(preparing)).toBe('preparingDemo');
    const recording = run(() => preparing, bash('cd /home/me/demos/shop-x && node demo.ts'));
    expect(shownDoing(recording)).toBe('recordingDemo');
    // what it reports changes nothing; looking at the result is finalizing it
    expect(shownDoing(run(() => recording, tool('mcp__seismic__report')))).toBe('recordingDemo');
    const finalizing = run(() => recording, tool('Read', { file_path: '/home/me/demos/shop-x/report.md' }));
    expect(shownDoing(finalizing)).toBe('finalizingDemo');
    expect(shownDoing(run(() => finalizing, bash('node demo.ts --narration')))).toBe('finalizingDemo');
    expect(shownDoing(run(() => finalizing, tool('mcp__seismic__ready_for_review')))).toBe('working');
  });

  test('a failing render shows as debugging; the next render records again', () => {
    const failed = run(bash('node demo.ts'), done('Bash', false));
    expect(shownDoing(failed)).toBe('debugging');
    expect(shownDoing(run(() => failed, bash('node demo.ts'), done('Bash')))).toBe('recordingDemo');
    expect(shownDoing(run(() => failed, bash('node demo.ts')))).toBe('debugging');
  });

  test('editing shows building until the edit finishes', () => {
    expect(shownDoing(run(tool('Edit'), done('Edit')))).toBe('working');
  });

  test('a test file or script named like the demo is no demo', () => {
    expect(shownDoing(run(tool('Edit', { file_path: 'src/server/demo.test.ts' }), done('Edit'), bash('bun test src/server/demo.test.ts')))).toBe('working');
  });
});
