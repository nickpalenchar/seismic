/**
 * The background tasks of an `agy` conversation. `agy` turns a command that outlives its wait into a
 * task of its own (`<conversation id>/task-N`) and holds the conversation's turn open until it ends; its
 * stream-json frames say nothing of it (the step stays active, and the frames behind it wait). What does
 * say so is the conversation's transcript, a JSON line per step that grows while the session runs
 * (`brain/<conversation id>/.system_generated/logs/transcript.jsonl`, measured 2026-11-14): a task starts
 * with a step "Tool is running as a background task with task id: X / Task Description: <command>" and
 * ends with a system message `Task id "X" finished`.
 */
import { closeSync, existsSync, fstatSync, openSync, readSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface AgyTask { id: string; description: string }

/** The directory holding the conversations' working files, one directory per conversation. */
export function agyBrainDir(): string {
  return join(homedir(), '.gemini', 'antigravity-cli', 'brain');
}

export const agyTranscriptLog = (brain: string, conversation: string) => join(brain, conversation, '.system_generated', 'logs', 'transcript.jsonl');

const STARTED = /running as a background task with task id: (\S+)\s*\n\s*Task Description: ([^\n]*)/;
const FINISHED = /Task id "([^"]+)" finished/;

/** Applies transcript lines to the tasks running (a line that is no JSON, or no step, is skipped). */
export function applyLines(running: Map<string, AgyTask>, lines: Iterable<string>): void {
  for (const line of lines) {
    let step: { type?: unknown; content?: unknown };
    try { step = JSON.parse(line); } catch { continue; }
    if (!step || typeof step.content !== 'string') continue;
    if (step.type === 'SYSTEM_MESSAGE') {
      const ended = FINISHED.exec(step.content);
      if (ended) running.delete(ended[1]!);
    } else {
      const started = STARTED.exec(step.content);
      if (started) running.set(started[1]!, { id: started[1]!, description: started[2]!.trim() });
    }
  }
}

/** Reads a transcript as the session grows it: a complete line at a time, from where it left off. */
export class TranscriptTail {
  private offset = 0;
  private partial = '';
  private running = new Map<string, AgyTask>();
  constructor(private file: string, private skip = false) {}

  /**
   * The lines added since the last call. With `skip` the lines present at the first call are left out:
   * a resumed conversation's old tasks are not this session's.
   */
  read(): string[] {
    if (!existsSync(this.file)) return [];
    const fd = openSync(this.file, 'r');
    try {
      const size = fstatSync(fd).size;
      if (size < this.offset) { this.offset = 0; this.partial = ''; }
      if (size === this.offset) return [];
      const buffer = Buffer.alloc(size - this.offset);
      const n = readSync(fd, buffer, 0, buffer.length, this.offset);
      this.offset += n;
      const text = this.partial + buffer.toString('utf8', 0, n);
      const cut = text.lastIndexOf('\n');
      this.partial = cut < 0 ? text : text.slice(cut + 1);
      const added = cut < 0 ? [] : text.slice(0, cut).split('\n').filter(Boolean);
      if (this.skip) { this.skip = false; return []; }
      return added;
    } finally { closeSync(fd); }
  }

  /** The tasks running after everything read so far. */
  tasks(): AgyTask[] {
    applyLines(this.running, this.read());
    return [...this.running.values()];
  }
}
