// A proposal reworked by what the owner said about it: an agent rewrites its text, reason and
// questions in one read-only turn, and the proposal waits for it. What the owner did not touch stays.
// It sees the screenshots the owner showed and picks those that go with the card's task.
// The owner's words on an open proposal come straight to this agent, as to a card's worker, and it
// passes on what asks Seismic for something (`to_seismic`).

import { workerConfig } from './worker-config';
import { basename } from 'node:path';
import { formatQuestion, type Item, type Question, type Revising } from '../core/types';
import { BadRequest, type Board } from './board';
import { MAX_IMAGES } from './images';
import type { AgentRuntime } from './runtime';
import { reviseProposal, type Revised, type Shots } from './llms/agents/agentJobs/proposalRevision';
import { messageOf } from '../core/text';

export interface RevisionOptions {
  board: Board;
  runtime: AgentRuntime;
  /** The checkout the agent may read in: the card's repository. */
  pathFor: (card: Item) => string;
  /** The files of the owner's screenshots, by id; unknown ones are left out. */
  imageFiles?: (ids: string[]) => string[];
  preferences?: () => string;
  /** Passes on to Seismic what the owner's words ask of it (accept the proposal, a rule, another card), with the card in focus. */
  toSeismic?: (cardId: string, request: string) => Promise<string>;
  /** The revision is over: the new text stands (`revised`), or the agent ended without one and the old text stays. */
  onRevised?: (cardId: string, revised: boolean) => void;
}

export class Revisions {
  /** Proposals being reworked, so a resume does not start a second agent. */
  private busy = new Set<string>();

  constructor(private o: RevisionOptions) {}

  /**
   * The owner's words on a proposal (`said`: the line of the log with them; `images`: the
   * screenshots with them): it waits while an agent reworks it by them. Said while it is reworked,
   * they wait for the rework after it.
   */
  revise(cardId: string, words: string, spoken: boolean, said?: number, images: string[] = []) {
    if (!this.o.board.revising(cardId, words, spoken, said, images)) this.run(cardId);
  }

  /** The owner takes back words that wait for the next rework: they leave the conversation, and no agent hears them. */
  unsay(cardId: string, id: number) {
    if (!this.o.board.unread(cardId, id) || !this.o.board.unrevise(cardId, id)) throw new BadRequest('notHeld', 'the agent has read these words already');
    this.o.board.withdraw(cardId, id);
  }

  /** After a restart: proposals still being reworked are reworked again. */
  resume() {
    for (const i of this.o.board.items()) if (i.idea?.proposal?.revising) this.run(i.id);
  }

  private run(cardId: string) {
    if (this.busy.has(cardId)) return;
    const card = this.o.board.item(cardId);
    const said = card?.idea?.proposal?.revising;
    if (!card || !said) return;
    this.busy.add(cardId);
    this.o.board.readNow(cardId, said.said ?? []);
    const shots = this.shots(card, said);
    this.ask(card, said, shots)
      .then(
        (r) => {
          // the words only asked Seismic for something: the proposal stays as it was, and what Seismic did stands in its conversation
          if (!r) return this.o.board.revised(cardId) || undefined;
          const questions = workerConfig.proposalQuestions(r.questions);
          // of the screenshots it saw, those it names; naming none of them keeps what went with the task
          const images = r.images && [...new Set(r.images.map((f) => basename(String(f))))].filter((id) => shots.all.includes(id)).slice(0, MAX_IMAGES);
          const p = { title: r.title, task: r.task, ...(r.reason?.trim() ? { reason: r.reason.trim() } : {}), idea: !!r.idea, questions, ...(images ? { images } : {}) };
          if (!this.o.board.revised(cardId, p)) return;
          const reply = r.reply?.trim();
          if (reply) this.o.board.log(cardId, 'talk', 'worker', reply.slice(0, 4000));
          if (changed(card, p)) this.o.board.log(cardId, 'state', 'koordinator', this.o.board.t.koordinator.revised);
          // a question asked anew stands in the conversation from now on; one it kept stands where it was asked
          const asked = new Set(card.idea!.proposal!.questions.map(key));
          for (const q of questions) if (!asked.has(key(q))) this.o.board.log(cardId, 'question', 'worker', formatQuestion(q, this.o.board.language()));
          return true;
        },
        (e) => {
          if (!this.o.board.revised(cardId)) return;
          this.o.board.log(cardId, 'error', 'koordinator', this.o.board.t.koordinator.reviseFailed(messageOf(e)));
          return false;
        },
      )
      .then((revised) => revised !== undefined && this.o.onRevised?.(cardId, revised))
      .catch((e) => console.error('revision:', e))
      .finally(() => {
        this.busy.delete(cardId);
        // what the owner said meanwhile is reworked in by the next
        this.run(cardId);
      });
  }

  /**
   * The screenshots the agent sees, by id: those with the words it reworks the proposal by
   * (`said`), those that go with its task now (`kept`), and those the owner showed before in its
   * conversation (`earlier`); `all` of them, at most twice a message's worth.
   */
  private shots(card: Item, said: Revising) {
    const shown = this.o.board.events(card.id).flatMap((e) => (e.author === 'owner' && !e.unread ? (e.images ?? []) : []));
    const all = [...new Set([...(said.images ?? []), ...(card.images ?? []), ...shown.reverse()])].filter((id) => this.o.imageFiles?.([id]).length).slice(0, 2 * MAX_IMAGES);
    const kept = (card.images ?? []).filter((id) => all.includes(id));
    return { all, said: all.filter((id) => said.images?.includes(id)), kept, earlier: all.filter((id) => !said.images?.includes(id) && !kept.includes(id)) };
  }

  /** The reworked proposal, or null when the agent only passed the words on to Seismic. */
  private ask(card: Item, said: Revising, shots: Shots): Promise<Revised | null> {
    const toSeismic = this.o.toSeismic;
    return reviseProposal({
      runtime: this.o.runtime,
      board: this.o.board,
      cwd: this.o.pathFor(card),
      card,
      said,
      shots,
      preferences: this.o.preferences?.() ?? '',
      ...(toSeismic ? { toSeismic: (request: string) => toSeismic(card.id, request) } : {}),
      images: this.o.imageFiles?.(shots.all) ?? [],
      // the proposal waits on, and shows until when
      onLimit: (until, retry) => this.o.board.waitsForLimit({ card: card.id }, until, retry),
    });
  }
}

/** A question as the conversation holds it. */
const key = (q: Question) => JSON.stringify([q.text, q.options, !!q.multiple]);

/** Whether the proposal reads otherwise now: words that only asked something leave it as it was. */
function changed(card: Item, p: { title: string; task: string; reason?: string; idea: boolean; questions: Question[]; images?: string[] }): boolean {
  const was = card.idea!.proposal!;
  return (
    (!!p.images && JSON.stringify(p.images) !== JSON.stringify(card.images ?? [])) ||
    p.title !== card.title ||
    p.task !== card.body ||
    (p.reason ?? '') !== (was.reason ?? '') ||
    p.idea !== !!was.idea ||
    JSON.stringify(p.questions.map(key)) !== JSON.stringify(was.questions.map(key))
  );
}

