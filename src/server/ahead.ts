// Asking before the start: on a planned card nobody has worked on, what the owner types goes to an
// agent that answers at once, with a worker's tools to read and check, while the card stays planned.
// It is Seismic's answering agent as the Koordinator's look-ups have it (`advisor.ts`), one turn per
// message in a session that resumes, and the card's conversation is where the owner and it talk. The
// worker that starts later hears that conversation with its task (`history`).

import type { PermissionMode } from '@anthropic-ai/claude-agent-sdk';
import { oneAtATime } from '../core/one-at-a-time';
import { asksAhead } from '../core/queue';
import { clip, messageOf } from '../core/text';
import type { Item, WorkerTurn } from '../core/types';
import { inform, Interrupted, type OwnerAnswer } from './advisor';
import { BadRequest, type Board, replyNote } from './board';
import { imageNote } from './images';
import type { AgentRuntime } from './runtime';
import { TO_OBEYA, toObeyaTool } from './to-obeya';
import { describeTool, SPOKEN } from './workers';

export interface AheadOptions {
  board: Board;
  runtime: AgentRuntime;
  /** The checkout the agent reads: the card's repository. */
  pathFor: (card: Item) => string;
  /** The task the card's worker would get if the owner started it now. */
  startBrief: (card: Item) => string | undefined;
  /** The files of the owner's screenshots, by id; unknown ones are left out. */
  imageFiles?: (ids?: string[]) => string[];
  preferences?: () => string;
  /** The workers' permission mode, which the answering agent runs in too. */
  permissionMode?: PermissionMode;
  /** Called with what the owner says, so lasting preferences can be learned. */
  onOwnerInput?: (card: Item, text: string) => void;
  /** Passes on to the Koordinator what the owner's words ask of Seismic (`to_seismic`); without it the agent has no such tool. */
  toObeya?: (cardId: string, request: string) => Promise<string>;
}

/** The owner's words the agent has not answered yet, as `CardRow.unheard` keeps them, with the lines of the log they carry. */
interface Pending {
  said: number[];
  text: string;
  images: string[];
}

export class Ahead {
  /** Cards whose agent is in a turn, or has one waiting behind it. */
  private busy = new Set<string>();
  /** Cards whose agent reads right now: what the owner says meanwhile waits for the next turn, unread until then. */
  private reading = new Set<string>();
  /** The session of each card's agent; a fresh one gets the conversation so far, so it need not outlive a restart. */
  private sessions = new Map<string, string>();
  private turns = new Map<string, Promise<unknown>>();
  private ends = new Map<string, AbortController>();
  /** Cards whose agent the owner let go on after a pause: its next turn hears so. */
  private resumed = new Set<string>();

  constructor(private o: AheadOptions) {}

  /** The cards whose agent is in a turn, for the project to show it at work. */
  turnsShown(): Map<string, WorkerTurn> {
    return new Map([...this.busy].map((id) => [id, { tasks: [], over: false }]));
  }

  /**
   * The owner's words on the card, maybe with screenshots and in reply to a message of its
   * conversation: they stand in it at once and the agent answers them. Words that come while it
   * reads wait for its next turn, unread until then.
   */
  ask(cardId: string, text: string, images: string[], spoken: boolean, replyTo?: number) {
    const card = this.card(cardId);
    const unread = this.reading.has(cardId) || !!card.paused;
    const e = this.o.board.log(cardId, 'talk', 'owner', text, { images, replyTo, unread });
    if (text) this.o.onOwnerInput?.(card, text);
    const quoted = replyTo ? this.o.board.quoted(cardId, replyTo) : undefined;
    const words = `${replyNote(quoted, 'koordinator')}${text}${imageNote(images)}`;
    this.store(cardId, [...this.pending(cardId), { said: [e.id], text: spoken ? `(${SPOKEN}:) ${words}` : words, images }]);
    // the owner's words let a paused agent go on, and one about to pause read on
    if (card.paused) this.goOn(cardId);
    else if (card.pausing) this.pauseTakenBack(cardId);
    this.start(cardId);
  }

  /** The owner pauses the agent while it reads: its session ends at once, and what it was asked stays pending. */
  pause(cardId: string) {
    const card = this.card(cardId);
    if (card.paused || !this.busy.has(cardId)) throw new BadRequest('noAgent', card.paused ? 'the agent is paused already' : 'the agent is not working on anything');
    this.halt(cardId);
    this.ends.get(cardId)?.abort();
  }

  /** The owner pauses the agent at a safe point: it finishes the answer it reads for, and is paused then. One that has not begun is paused at once. */
  pauseAtSafePoint(cardId: string) {
    const card = this.card(cardId);
    if (card.paused || card.pausing || !this.busy.has(cardId)) throw new BadRequest('noAgent', card.paused || card.pausing ? 'the agent is paused already' : 'the agent is not working on anything');
    if (!this.reading.has(cardId)) return this.halt(cardId);
    this.o.board.work(cardId, { pausing: new Date().toISOString() });
    this.o.board.log(cardId, 'state', 'owner', this.o.board.t.worker.pausing);
  }

  /** The owner lets the paused agent go on: it answers what it was asked. One about to pause after its answer reads on instead. */
  resume(cardId: string) {
    const card = this.card(cardId);
    if (card.pausing) return this.pauseTakenBack(cardId);
    if (!card.paused) throw new BadRequest('notPaused', 'the agent is not paused');
    this.goOn(cardId);
    this.start(cardId);
  }

  /** The owner takes back words the agent has not read: they leave the conversation, and the agent never hears them. */
  unsay(cardId: string, id: number) {
    this.card(cardId);
    const pending = this.pending(cardId);
    const words = pending.find((p) => p.said.includes(id));
    if (!words || !this.o.board.unread(cardId, id)) throw new BadRequest('notHeld', 'the agent has read these words already');
    this.store(cardId, pending.filter((p) => p !== words));
    this.o.board.withdraw(cardId, id);
  }

  /** After a restart: what the owner asked and the agent had not answered gets its answer (not while it is paused). */
  resumeAll() {
    for (const i of this.o.board.items()) if (asksAhead(i) && !i.paused && this.pending(i.id).length) this.start(i.id);
  }

  /**
   * The card starts: its conversation goes to the worker with the task, and nothing is asked of the
   * agent any more. What the agent has not answered yet goes as a note, as on a card nobody asks.
   */
  takeAsked(cardId: string): string | undefined {
    const history = this.history(cardId);
    this.store(cardId, this.pending(cardId).map((p) => ({ ...p, text: `A note the owner left on the card while no agent worked on it:\n\n${p.text}` })));
    this.sessions.delete(cardId);
    this.resumed.delete(cardId);
    this.ends.get(cardId)?.abort();
    this.busy.delete(cardId);
    return history;
  }

  /**
   * The conversation so far, for the worker that starts the card, the agent that discusses it as an
   * idea, or an agent that starts afresh; `undefined` where there is none. What the owner said and
   * the agent has not answered is left out: it comes as the words of the next turn, or with the task.
   */
  history(cardId: string): string | undefined {
    const waiting = new Set(this.pending(cardId).flatMap((p) => p.said));
    const lines = this.o.board
      .events(cardId)
      .filter((e) => e.kind === 'talk' && !e.unread && !waiting.has(e.id) && e.text.trim())
      .map((e) => `${e.author === 'owner' ? 'The owner' : 'Seismic'}: ${e.text.trim()}`);
    if (!lines.length) return;
    return `Before the card was started, the owner talked it over with Seismic's answering agent. The conversation, oldest first (what the owner said there is part of the task):\n\n${lines.join('\n\n')}`;
  }

  private start(cardId: string) {
    this.busy.add(cardId);
    this.o.board.changed();
    void oneAtATime(this.turns, cardId, () => this.turn(cardId));
  }

  /** One turn: what the owner asked since the last answer, answered on the card. */
  private async turn(cardId: string) {
    const card = this.o.board.item(cardId);
    const taken = card ? [...this.pending(cardId)] : [];
    // paused while it waited for its turn: it goes on once the owner lets it
    if (!card || !asksAhead(card) || !taken.length || card.paused) {
      this.busy.delete(cardId);
      this.o.board.changed();
      return;
    }
    this.o.board.readNow(cardId, taken.flatMap((p) => p.said));
    this.reading.add(cardId);
    const end = new AbortController();
    this.ends.set(cardId, end);
    const words = taken.map((p) => p.text).join('\n\n');
    const images = taken.flatMap((p) => p.images);
    const resumed = this.resumed.delete(cardId) ? `${RESUMED}\n\n` : '';
    let answer: OwnerAnswer | undefined;
    let failure: string | undefined;
    try {
      answer = await this.consult(card, words, images, resumed, end.signal);
    } catch (e) {
      // paused or the card started: what it was asked stays pending, or is of no use any more
      if (e instanceof Interrupted) return this.settle(cardId, end);
      failure = this.o.board.t.answer.failed(messageOf(e));
    }
    this.settle(cardId, end);
    const now = this.o.board.item(cardId);
    // the card started or went meanwhile: the worker has the conversation, nobody answers
    if (!now || !asksAhead(now)) {
      this.busy.delete(cardId);
      return;
    }
    const left = this.pending(cardId).filter((p) => !taken.some((t) => t.said.some((id) => p.said.includes(id))));
    this.store(cardId, left);
    if (failure) this.o.board.log(cardId, 'error', 'obeya', failure);
    else if (answer) {
      const text = clip(answer.text, 12000);
      this.o.board.log(cardId, 'talk', 'koordinator', text, { agent: answer.agent });
      this.o.board.notify({ cardId, text, inTalk: true });
    }
    // asked to pause once its answer was given: what was said meanwhile waits for the owner to let it go on
    if (this.o.board.row(cardId).pausing) return this.halt(cardId);
    if (left.length) return void oneAtATime(this.turns, cardId, () => this.turn(cardId));
    this.busy.delete(cardId);
    this.o.board.changed();
  }

  private settle(cardId: string, end: AbortController) {
    this.reading.delete(cardId);
    if (this.ends.get(cardId) === end) this.ends.delete(cardId);
  }

  /** Asks the agent: its session resumed when there is one, else (or when it cannot be resumed) a fresh one that gets the conversation so far. */
  private async consult(card: Item, words: string, images: string[], resumed: string, signal: AbortSignal): Promise<OwnerAnswer> {
    const toObeya = this.o.toObeya;
    const run = (message: string, shots: string[], resume?: string) =>
      inform({
        runtime: this.o.runtime,
        cwd: this.o.pathFor(card),
        system: `You are the Koordinator of Seismic, a project on which the owner directs coding agents; the owner knows you simply as Seismic.\n\n${AHEAD_RULES}${toObeya ? `\n\n${TO_OBEYA}` : ''}`,
        message: [message, this.o.preferences?.() ?? ''].filter(Boolean).join('\n\n'),
        onTool: (name, input) => {
          if (!name.startsWith('mcp__')) this.o.board.log(card.id, 'activity', 'koordinator', describeTool(name, input, this.o.board.t));
        },
        onSession: (id) => this.sessions.set(card.id, id),
        onLimit: (until, retry) => this.o.board.waitsForLimit({ card: card.id }, until, retry),
        at: { card: card.id },
        language: this.o.board.conversation(),
        signal,
        ...(resume ? { resume } : {}),
        ...(shots.length ? { images: shots } : {}),
        ...(toObeya ? { tools: [toObeyaTool((request) => toObeya(card.id, request))] } : {}),
        ...(this.o.permissionMode ? { permissionMode: this.o.permissionMode } : {}),
      });
    const session = this.sessions.get(card.id);
    const fresh = () => {
      const before = this.history(card.id);
      return run([this.intro(card), before, `The owner says now:\n\n${words}`].filter(Boolean).join('\n\n'), [...(this.o.imageFiles?.(card.images) ?? []), ...images]);
    };
    if (!session) return fresh();
    return run(`${resumed}The owner says:\n\n${words}`, images, session).catch((e) => {
      if (e instanceof Interrupted) throw e;
      return fresh();
    });
  }

  private intro(card: Item): string {
    const brief = this.o.startBrief(card);
    return [
      `The owner talks about the task of the card “${card.title}”, which nobody has started.`,
      brief ? `The task its worker would get if the owner started it now (the worker also follows the repository's CLAUDE.md and docs):\n\n<task>\n${brief}\n</task>` : '',
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  private pending(cardId: string): Pending[] {
    const stored = this.o.board.row(cardId).unheard;
    return stored ? (JSON.parse(stored) as Pending[]) : [];
  }

  private store(cardId: string, pending: Pending[]) {
    this.o.board.work(cardId, { unheard: pending.length ? JSON.stringify(pending) : null });
  }

  /** Pauses the agent: what it was asked stays pending. */
  private halt(cardId: string) {
    this.o.board.work(cardId, { paused: '{}', pausing: null });
    this.busy.delete(cardId);
    this.o.board.log(cardId, 'state', 'owner', this.o.board.t.worker.pausedByOwner);
  }

  private pauseTakenBack(cardId: string) {
    this.o.board.work(cardId, { pausing: null });
    this.o.board.log(cardId, 'state', 'owner', this.o.board.t.worker.resumedByOwner);
  }

  private goOn(cardId: string) {
    this.o.board.work(cardId, { paused: null });
    this.o.board.log(cardId, 'state', 'owner', this.o.board.t.worker.resumedByOwner);
    this.resumed.add(cardId);
  }

  private card(id: string): Item {
    const i = this.o.board.item(id);
    if (!i) throw new BadRequest('unknownCard', 'unknown card');
    if (!asksAhead(i)) throw new BadRequest('noAgent', 'this card is not one to ask before its start');
    return i;
  }
}

/** What the agent hears when the owner lets it go on after a pause. */
const RESUMED =
  'The owner paused you while you worked on your answer and has now let you go on. Pausing ended your session at once: whatever you had running was stopped with it (a command still running shows exit code 137). What they asked is still unanswered.';

/** How the answering agent of a card nobody has started works. */
const AHEAD_RULES = `
The owner talks a task card over with you before anyone starts it: they ask what the task would involve, what the code or docs say, what you would do, or tell you what the worker should keep in mind. No worker has begun; when the owner starts the card, a worker takes over the task and gets this whole conversation with it, so what the owner settles with you here (a decision, a constraint, a change of the task) is not lost. The owner heard that your answer comes in a moment. Take the time to look it up: the repository's docs and plan docs, CLAUDE.md, the code, and what the message gives you. You have the tools a worker has: what the answer depends on beyond the text (the git history, a pull request or CI run on GitHub with gh, a page on the web), check rather than guess.
- Answer what was asked, concretely and grounded in what you read; name the source (plan doc section, file). Say where you are guessing. Never answer that you cannot know: say what the sources say.
- A statement that changes or settles the task (not a question) gets a short confirmation of what the worker will take from it; anything unclear in it, ask back in your answer.
- The owner does not read code: no code blocks, file paths only where they help.
Read and check what you need, then call answer_owner exactly once and end your turn.
`.trim();
