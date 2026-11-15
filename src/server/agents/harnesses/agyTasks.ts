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
import { StringDecoder } from 'node:string_decoder';

export interface AgyTask { id: string; description: string }

/** The directory holding the conversations' working files, one directory per conversation. */
export function agyBrainDir(): string {
  return join(homedir(), '.gemini', 'antigravity-cli', 'brain');
}

export const agyTranscriptLog = (brain: string, conversation: string) => join(brain, conversation, '.system_generated', 'logs', 'transcript.jsonl');

const STARTED = /^Created At: [^\n]+\nTool is running as a background task with task id: (\S+)\nTask Description: ([^\n]*)\nTask logs are available at: /;
const FINISHED = /^<SYSTEM_MESSAGE>\n\[Message\] sender=(\S+) content=Task id "\1" finished/;

/** Applies transcript lines to the tasks running (a line that is no JSON, or no step, is skipped). */
export function applyLines(running: Map<string, AgyTask>, lines: Iterable<string>): void {
  for (const line of lines) {
    let step: { source?: unknown; type?: unknown; status?: unknown; content?: unknown };
    try { step = JSON.parse(line); } catch { continue; }
    if (!step || typeof step.content !== 'string') continue;
    if (step.source === 'SYSTEM' && step.type === 'SYSTEM_MESSAGE' && step.status === 'DONE') {
      const ended = FINISHED.exec(step.content);
      if (ended) running.delete(ended[1]!);
    } else if (step.source === 'MODEL' && step.type === 'GENERIC' && step.status === 'RUNNING') {
      const started = STARTED.exec(step.content);
      if (started) running.set(started[1]!, { id: started[1]!, description: started[2]!.trim() });
    }
  }
}

/** Reads a transcript as the session grows it: a complete line at a time, from where it left off. */
export class TranscriptTail {
  private offset = 0;
  private partial = '';
  private decoder = new StringDecoder('utf8');
  private running = new Map<string, AgyTask>();
  private discardPartial = false;
  constructor(private file: string, skip = false) {
    // Snapshot history now, before agy can resume. A missing file has an empty history too.
    if (skip && existsSync(file)) {
      const fd = openSync(file, 'r');
      try {
        this.offset = fstatSync(fd).size;
        if (this.offset) {
          const last = Buffer.alloc(1);
          readSync(fd, last, 0, 1, this.offset - 1);
          this.discardPartial = last[0] !== 10;
        }
      } finally { closeSync(fd); }
    }
  }

  /**
   * The lines added since the last call. A resumed conversation's history boundary was captured at construction.
   */
  read(): string[] {
    if (!existsSync(this.file)) return [];
    const fd = openSync(this.file, 'r');
    try {
      const size = fstatSync(fd).size;
      if (size < this.offset) {
        this.offset = 0;
        this.partial = '';
        this.decoder = new StringDecoder('utf8');
        this.discardPartial = false;
      }
      if (size === this.offset) return [];
      const buffer = Buffer.alloc(size - this.offset);
      const n = readSync(fd, buffer, 0, buffer.length, this.offset);
      this.offset += n;
      const text = this.partial + this.decoder.write(buffer.subarray(0, n));
      const cut = text.lastIndexOf('\n');
      this.partial = cut < 0 ? text : text.slice(cut + 1);
      const added = cut < 0 ? [] : text.slice(0, cut).split('\n');
      // The rest of a line already present at the resume boundary belongs to history.
      if (this.discardPartial && cut >= 0) { added.shift(); this.discardPartial = false; }
      return added.filter(Boolean);
    } finally { closeSync(fd); }
  }

  /** The tasks running after everything read so far. */
  tasks(): AgyTask[] {
    applyLines(this.running, this.read());
    return [...this.running.values()];
  }
}
