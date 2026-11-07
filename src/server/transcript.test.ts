import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { excerpt, excerptOf, excerptText, findTranscript } from './transcript';

const SAMPLE = join(import.meta.dir, 'fixtures', 'transcript.jsonl');
const CODEX = join(import.meta.dir, 'fixtures', 'codex-rollout.jsonl');
const sample = () => readFileSync(SAMPLE, 'utf8');

let dir: string | undefined;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe('transcript excerpt', () => {
  test('an unqualified worker status call is not treated as missing repository tooling', () => {
    const call = (id: string, name: string) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input: { status: 'Checking the UI' } }] } });
    const result = (id: string, failed: boolean, output: string) => JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: failed, content: output }] } });
    const run = [call('a', 'report'), result('a', true, '<tool_use_error>Error: No such tool available: report</tool_use_error>'), call('b', 'mcp__seismic__report'), result('b', false, 'Status updated.')].join('\n');
    expect(excerpt(run)).toMatchObject({ steps: 2, findings: [] });
    expect(excerptText([excerpt(run)!])).toBe('');
  });

  test('finds failed calls, corrections, repeated commands and rewritten files, with the words around them', () => {
    const e = excerpt(sample())!;
    // the subagent's call is not the worker's
    expect(e.steps).toBe(13);
    expect(e.firstChange).toBe(4);
    const [flags, script, typecheck, polling, rewrite] = e.findings;
    expect(flags).toMatchObject({
      kind: 'retry',
      calls: [
        { step: 3, tool: 'Bash', what: '`bun run dev --port=4500`', failed: true, before: 'Ich starte den Server.' },
        { step: 4, what: '`bun run dev -p 4500`', failed: false, after: 'Läuft auf 4500.' },
      ],
    });
    expect(flags?.kind === 'retry' && flags.calls[0]!.error).toContain("unknown option '--port=4500'");
    expect(script).toMatchObject({ kind: 'failure', call: { step: 6, what: '`bun scripts/demo.ts`', after: 'Das Skript scheitert; ich schreibe es neu.' } });
    expect(script?.kind === 'failure' && script.call.error).toContain('TypeError: x is undefined');
    // `bun test` cut off by a restart is no mistake
    expect(typecheck).toMatchObject({ kind: 'failure', call: { step: 9, what: '`bun run typecheck`', before: 'Seismic startet neu.', after: 'Ein Tippfehler; ich korrigiere ihn.' } });
    expect(polling).toMatchObject({ kind: 'retry', calls: [{ step: 11 }, { step: 12 }, { step: 13 }] });
    expect(rewrite).toEqual({ kind: 'rewrite', file: '/ws/card/scripts/demo.ts', times: 2, before: 'Das Skript scheitert; ich schreibe es neu.' });
    expect(e.findings).toHaveLength(5);
  });

  test('reads as one text for the model, run by run', () => {
    const e = excerpt(sample())!;
    const text = excerptText([{ steps: 40, firstChange: 3, findings: [] }, e]);
    expect(text).toContain('Run 2 of 2: 13 tool calls, the first change to a file after 4.');
    expect(text).toContain('2 similar Bash calls in a row, 1 failed');
    expect(text).toContain("Error: Exit code 1\n   error: unknown option '--port=4500'");
    expect(text).toContain('/ws/card/scripts/demo.ts written whole 2 times.');
    expect(excerptText([{ steps: 40, firstChange: 3, findings: [] }])).toBe('');
  });

  test('a long error keeps its start and its end', () => {
    const line = (o: object) => JSON.stringify(o);
    const long = `Exit code 1\n${'x'.repeat(3000)}\nthe cause`;
    const jsonl = [
      line({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'a', name: 'Bash', input: { command: 'make' } }] } }),
      line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'a', content: long, is_error: true }] } }),
    ].join('\n');
    const f = excerpt(jsonl)!.findings[0]!;
    const error = f.kind === 'failure' ? f.call.error! : '';
    expect(error.startsWith('Exit code 1')).toBe(true);
    expect(error.endsWith('the cause')).toBe(true);
    expect(error.length).toBeLessThan(900);
  });

  test('a run without anything gone wrong, a file of another format, or no file gives no excerpt', () => {
    dir = mkdtempSync(join(tmpdir(), 'obeya-tr-'));
    const smooth = join(dir, 'smooth.jsonl');
    writeFileSync(
      smooth,
      [
        { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'a', name: 'Bash', input: { command: 'bun test' } }] } },
        { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'a', content: 'ok' }] } },
      ]
        .map((l) => JSON.stringify(l))
        .join('\n'),
    );
    expect(excerpt(readFileSync(smooth, 'utf8'))).toMatchObject({ steps: 1, findings: [] });
    expect(excerptOf(smooth)).toBeNull();
    const other = join(dir, 'other.jsonl');
    writeFileSync(other, '{"kind":"event","payload":{"calls":[]}}\nnot json at all\n');
    expect(excerpt(readFileSync(other, 'utf8'))).toBeNull();
    expect(excerptOf(other)).toBeNull();
    expect(excerptOf(join(dir, 'missing.jsonl'))).toBeNull();
    expect(excerptOf(null)).toBeNull();
    expect(excerptOf(SAMPLE)!.findings).toHaveLength(5);
  });

  test('finds a session’s file under its working directory, or in any directory', () => {
    dir = mkdtempSync(join(tmpdir(), 'obeya-tr-'));
    const id = '11111111-2222-3333-4444-555555555555';
    mkdirSync(join(dir, '-Users-me--obeya-workspaces-c-1'));
    writeFileSync(join(dir, '-Users-me--obeya-workspaces-c-1', `${id}.jsonl`), sample());
    expect(findTranscript(id, '/Users/me/.obeya/workspaces/c/1', dir)).toBe(join(dir, '-Users-me--obeya-workspaces-c-1', `${id}.jsonl`));
    expect(findTranscript(id, '/somewhere/else', dir)).toBe(join(dir, '-Users-me--obeya-workspaces-c-1', `${id}.jsonl`));
    expect(findTranscript(id, null, dir)).not.toBeNull();
    expect(findTranscript('22222222-0000-0000-0000-000000000000', null, dir)).toBeNull();
    expect(findTranscript('../../etc/passwd', null, dir)).toBeNull();
    expect(findTranscript(id, null, join(dir, 'missing'))).toBeNull();
  });

  test('reads a Codex rollout: commands as Bash calls, files added as writes, a command stopped with Ctrl-C as no mistake', () => {
    const e = excerpt(readFileSync(CODEX, 'utf8'))!;
    expect(e.steps).toBe(15);
    expect(e.firstChange).toBe(3);
    const [flags, script, typecheck, polling, rewrite] = e.findings;
    expect(flags).toMatchObject({
      kind: 'retry',
      calls: [
        { step: 1, tool: 'Bash', what: '`bun run dev --port=4500`', failed: true, before: 'I start the dev server.' },
        { step: 2, what: '`bun run dev -p 4500`', failed: false },
      ],
    });
    expect(flags?.kind === 'retry' && flags.calls[0]!.error).toContain("unknown option '--port=4500'");
    expect(script).toMatchObject({ kind: 'failure', call: { step: 5, what: '`bun scripts/demo.ts`', after: 'The script fails; I write it again.' } });
    // `bun test` stopped with Ctrl-C is no mistake
    expect(typecheck).toMatchObject({ kind: 'failure', call: { step: 10, what: '`bun run typecheck`', after: 'A typo; I fix it.' } });
    expect(polling).toMatchObject({ kind: 'retry', calls: [{ step: 13 }, { step: 14 }, { step: 15 }] });
    expect(rewrite).toEqual({ kind: 'rewrite', file: '/ws/card/scripts/demo.ts', times: 2, before: 'The script fails; I write it again.' });
    expect(e.findings).toHaveLength(5);
    expect(excerptText([e])).toContain('Error: Exit code 1\n   error: unknown option');
    expect(excerptOf(CODEX)!.findings).toHaveLength(5);
  });

  test('a Codex rollout shows where the owner paused: the command the pause killed is cut off, not failed', () => {
    const thread = '01a1aaaa-0000-7000-8000-000000000009';
    const event = (turn: string, payload: Record<string, unknown>) => JSON.stringify({ type: 'event_msg', payload: { thread_id: thread, turn_id: turn, ...payload } });
    const said = (turn: string, id: string, text: string) => event(turn, { type: 'item_completed', item: { type: 'AgentMessage', id, content: [{ type: 'Text', text }] } });
    const ran = (turn: string, id: string, script: string, code: number, output = '') =>
      event(turn, { type: 'item_completed', item: { type: 'CommandExecution', id, command: ['/bin/zsh', '-lc', script], status: code ? 'failed' : 'completed', aggregated_output: output, exit_code: code } });
    const rollout = [
      JSON.stringify({ type: 'session_meta', payload: { id: thread } }),
      said('t1', 'm1', 'I run the slow check.'),
      // the owner pauses: the turn is aborted, then the command it was running ends with -1
      event('t1', { type: 'turn_aborted', reason: 'interrupted' }),
      ran('t1', 'c1', 'bun run slow-check', -1, 'slow-check: step 4 of 9 done\n'),
      said('t2', 'm2', 'The pause cut the check off; I run it again.'),
      ran('t2', 'c2', 'bun run slow-check', 1, 'slow-check: step 6 failed\n'),
      ran('t2', 'c3', 'bun run slow-check', 0),
      // exit -1 in a turn nobody interrupted is the agent's own failure
      ran('t3', 'c4', 'npx playwright test', -1, 'e2e: timed out\n'),
    ].join('\n');
    const e = excerpt(rollout)!;
    expect(e.cutOff).toEqual([1]);
    const [rerun, e2e] = e.findings;
    expect(rerun).toMatchObject({ kind: 'retry', calls: [{ step: 1, failed: false, cutOff: true }, { step: 2, failed: true }, { step: 3, failed: false }] });
    expect(e2e).toMatchObject({ kind: 'failure', call: { step: 4, what: '`npx playwright test`', failed: true } });
    expect(e.findings).toHaveLength(2);
    const text = excerptText([e]);
    expect(text).toContain('The owner paused, stopped or restarted the card during step 1');
    expect(text).toContain('⏸ `bun run slow-check` (cut off');
    expect(text).not.toContain('step 4 of 9');

    // the pause alone, and the rerun that passed, is no friction
    const paused = excerpt([rollout.split('\n').slice(0, 5).join('\n'), ran('t2', 'c3', 'bun run slow-check', 0)].join('\n'))!;
    expect(paused).toMatchObject({ steps: 2, cutOff: [1], findings: [] });
  });

  test('finds a Codex session’s rollout by its thread id, in a day directory or the archive', () => {
    dir = mkdtempSync(join(tmpdir(), 'obeya-tr-'));
    const thread = '01a1aaaa-0000-7000-8000-000000000001';
    const day = join(dir, 'sessions', '2026', '11', '01');
    mkdirSync(day, { recursive: true });
    mkdirSync(join(dir, 'archived_sessions'));
    writeFileSync(join(day, `rollout-2026-11-01T10-00-00-${thread}.jsonl`), readFileSync(CODEX));
    writeFileSync(join(day, 'rollout-2026-11-01T10-00-00-01a1aaaa-0000-7000-8000-000000000002.jsonl'), '');
    writeFileSync(join(dir, 'archived_sessions', 'rollout-2026-10-01T10-00-00-01a1aaaa-0000-7000-8000-000000000003.jsonl'), readFileSync(CODEX));
    expect(findTranscript(`codex:${thread}`, null, join(dir, 'sessions'))).toBe(join(day, `rollout-2026-11-01T10-00-00-${thread}.jsonl`));
    expect(findTranscript('codex:01a1aaaa-0000-7000-8000-000000000003', null, join(dir, 'archived_sessions'))).toBe(join(dir, 'archived_sessions', 'rollout-2026-10-01T10-00-00-01a1aaaa-0000-7000-8000-000000000003.jsonl'));
    expect(findTranscript('codex:01a1aaaa-0000-7000-8000-0000000000ff', null, join(dir, 'sessions'))).toBeNull();
    expect(findTranscript('codex:../../etc/passwd', null, join(dir, 'sessions'))).toBeNull();
    expect(findTranscript(`codex:${thread}`, null, join(dir, 'missing'))).toBeNull();
  });
});
