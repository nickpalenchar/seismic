// Exploration agents: one session per idea with a worker's tools, resumed for every message, even
// days later. The owner and the agent talk on the card; the agent keeps the idea's brief, which is what
// remains of the conversation: whoever opens the card later reads the brief, not the talk. The
// brief holds the substance and the replies only the turns, so the two never say the same; how
// the agent got to a reply (what it read and thought) folds away under that reply.

import { type Language } from '../core/locale';
import { type CardEvent, formatQuestion, type Item, type Mock, type NextStep, type Question, isPaused, isPausing } from '../core/types';
import { decisionLog } from './advisor';
import { BadRequest, type Board, holdNow, type Message, replyNote, type Unread } from './board';
import { type AgentEvent, type AgentRuntime, type AgentSession } from './runtime';
import { explorerAgent } from './llms/agents/explorer/explorerAgent';
import { MAX_VARIANTS } from './llms/agents/explorer/tools';
import { BackgroundWait } from './llms/harnesses/claude';
import { imageNote } from './images';
import { describeTool, SPOKEN } from './workerSupervisor/workerSupervisor';
import { clip } from '../core/text';

export interface ExplorerOptions {
  board: Board;
  runtime: AgentRuntime;
  /** The checkout the agent works in: the one of the idea's repository. */
  pathFor: (card: Item) => string;
  /** The language of what lands in the idea's repository (`language` of its settings); English when left out. */
  repoLanguage?: (card: Item) => Language;
  /** The workers' permission mode: the agent has their tools and runs as they do. */
  /** The owner's recorded preferences, as agents read them. */
  preferences?: () => string;
  /** Called with what the owner says, so lasting preferences can be learned. */
  onOwnerInput?: (card: Item, text: string) => void;
  /** The files of the owner's screenshots, by id; unknown ones are left out. */
  imageFiles?: (ids?: string[]) => string[];
  /** The agent answered all it was told and its session ended (`replied`), or its turn ended without (an error, a restart). */
  onReplied?: (cardId: string, replied: boolean) => void;
  /** Passes on to the Koordinator what the owner's words to the idea's agent ask of Seismic (`to_seismic`); without it the agent has no such tool. */
  toSeismic?: (cardId: string, request: string) => Promise<string>;
  /** How long an ended turn waits for a sign of the agent once none of its background work runs (any more). */
  backgroundGrace?: number;
  /** How long an ended turn waits at most while the agent's background work still runs. */
  backgroundLimit?: number;
}

export interface Live {
  session: AgentSession;
  /** The messages the running turn answers. */
  current: Message[];
  /** Messages that arrived during a turn; they go in together once it ends, unread until then. */
  queue: Message[];
  replied: boolean;
  lastText: string;
  /** The turn only takes something into the brief: words without a reply are no reply. */
  quiet?: boolean;
  /** The owner's preferences as the agent last heard them: in its instructions, or since then. */
  preferences: string;
  /** The agent heard that the owner clicked "Build it like this" during its turn. */
  toldBuild?: boolean;
  /** The agent's background work, and a turn that ended without a reply waiting for it to wake the agent. */
  work: BackgroundWait;
  /** The last words of a turn that ended waiting for its background work: the reply, should it never wake the agent. */
  said?: string;
}

export class Explorers {
  live = new Map<string, Live>();

  constructor(readonly o: ExplorerOptions) {}

  /**
   * The owner says something about the idea, maybe with screenshot files and in reply to a message
   * of its conversation (`replyTo`); a parked or dropped idea is open again.
   */
  discuss(cardId: string, text: string, spoken = false, images: string[] = [], replyTo?: number) {
    const card = this.idea(cardId);
    const idea = this.o.board.idea(cardId);
    if (idea.status !== 'open') {
      this.o.board.setIdea(cardId, { status: 'open' });
      this.o.board.log(cardId, 'state', 'owner', this.o.board.t.idea.reopened);
    }
    // words said while the agent works on a reply wait for its next turn, unread until then
    const said = this.o.board.log(cardId, 'talk', 'owner', text, { images, replyTo, unread: this.live.has(cardId) });
    this.o.board.setIdea(cardId, { yourTurn: false, questions: [], next: undefined });
    if (text) this.o.onOwnerInput?.(card, text);
    const quoted = replyTo ? this.o.board.quoted(cardId, replyTo) : undefined;
    this.send(card, `The owner says${spoken ? ` (${SPOKEN})` : ''}:\n\n${replyNote(quoted, 'explorer')}${text}${imageNote(images)}`, images, false, [said.id], true);
  }

  /**
   * The owner pauses the idea's agent while it works on a reply: its session ends at once, in the
   * middle of a step if need be, and what it has not answered yet stays with the idea (`interrupt`).
   * It goes on with those messages once the owner resumes it or says something more.
   */
  pause(cardId: string) {
    const card = this.idea(cardId);
    if (!this.live.has(cardId)) throw new BadRequest('noAgent', isPaused(card) ? 'the agent is paused already' : 'the agent is not working on anything');
    this.interrupt(cardId, 'paused', true);
    this.o.board.log(cardId, 'state', 'owner', this.o.board.t.worker.pausedByOwner);
  }

  /**
   * The owner pauses the idea's agent at a safe point (the card's pause, the project's): it finishes
   * the reply it works on, and is paused then, before it takes up what was said meanwhile.
   */
  pauseAtSafePoint(cardId: string) {
    const card = this.idea(cardId);
    if (!this.live.has(cardId) || isPausing(card)) throw new BadRequest('noAgent', isPaused(card) || isPausing(card) ? 'the agent is paused already' : 'the agent is not working on anything');
    this.o.board.work(cardId, { hold: holdNow('pausing') });
    this.o.board.log(cardId, 'state', 'owner', this.o.board.t.worker.pausing);
  }

  /** The owner lets the paused agent go on: it answers what it had not answered yet. One about to pause after its reply works on instead. */
  resume(cardId: string) {
    const card = this.idea(cardId);
    if (isPausing(card)) return this.pauseTakenBack(cardId);
    if (!isPaused(card)) throw new BadRequest('notPaused', 'the agent is not paused');
    // a reply already given left nothing unanswered: it goes on with what it did after it, its words no new reply
    const unanswered = !!this.o.board.idea(cardId).unread;
    this.send(card, unanswered ? 'Answer them now.' : RESUMED, [], !unanswered, [], true);
  }

  /** The owner lets the agent about to pause after its reply go on after all (`resume`, or their words to it). */
  private pauseTakenBack(cardId: string) {
    this.o.board.work(cardId, this.o.board.unheld(cardId, ['pausing']));
    this.o.board.log(cardId, 'state', 'owner', this.o.board.t.worker.resumedByOwner);
  }

  /**
   * The owner takes back words the agent has not read: words waiting for its next turn, or left
   * unanswered by a turn that was cut off. They leave the conversation, and the agent never hears them.
   */
  unsay(cardId: string, id: number) {
    this.idea(cardId);
    if (!this.o.board.unread(cardId, id)) throw new BadRequest('notHeld', 'the agent has read these words already');
    const taken = (m: Message) => !m.said.includes(id);
    const live = this.live.get(cardId);
    const { unread } = this.o.board.idea(cardId);
    if (live?.queue.some((m) => !taken(m))) live.queue = live.queue.filter(taken);
    else if (unread?.messages.some((m) => !taken(m))) {
      const messages = unread.messages.filter(taken);
      this.o.board.setIdea(cardId, { unread: messages.length ? { ...unread, messages } : undefined });
    } else throw new BadRequest('notHeld', 'the agent has read these words already');
    this.o.board.withdraw(cardId, id);
  }

  /**
   * A planned card became an idea, or the owner took up an idea a worker proposed (`proposed`): its
   * agent opens the discussion with what the card says, before the owner writes, and with the notes
   * the owner left on the planned card for a worker (`notes`).
   */
  open(cardId: string, proposed?: 'idea' | 'task', notes?: { text: string; images: string[] }) {
    const card = this.o.board.item(cardId);
    if (!card || card.state !== 'idea') return;
    if (notes?.text) return this.send(card, `${OPENING_NOTES}\n\n---\n\n${notes.text}`, notes.images, false);
    this.send(card, proposed === 'idea' ? OPENING_PROPOSED : proposed === 'task' ? OPENING_PROPOSED_TASK : OPENING, [], false);
  }

  /**
   * Seismic tells the agent something the owner did not say (a prototype's result). `quiet`: it is
   * for the brief only (an answer given on a prototype), and the turn's words are no reply.
   */
  tell(cardId: string, text: string, quiet = false) {
    const card = this.o.board.item(cardId);
    if (!card || card.state !== 'idea') return;
    this.send(card, text, [], quiet);
  }

  /**
   * Ends the idea's session; its id stays, so the conversation can go on later. A pause ends with it
   * (the idea parked, dropped, decided), unless it ends for one (`paused`): then the idea is paused
   * in the same step, so the project never counts it as neither paused nor about to pause.
   */
  close(cardId: string, paused = false) {
    const live = this.live.get(cardId);
    this.live.delete(cardId);
    live?.work.stop();
    live?.session.close();
    const card = this.o.board.item(cardId);
    if (card?.idea?.discussion?.thinking) this.o.board.setIdea(cardId, { thinking: false });
    if (paused) this.o.board.work(cardId, { hold: holdNow('paused') });
    else if (card && (isPaused(card) || isPausing(card))) this.o.board.work(cardId, this.o.board.unheld(cardId, ['paused', 'pausing', 'limit']));
  }

  /**
   * Ends the idea's session in the middle of a turn (parked, dropped, an error): what the agent has
   * not answered yet stays with the idea and goes to it first when the conversation goes on.
   */
  interrupt(cardId: string, why: Unread['why'], paused = false) {
    const live = this.live.get(cardId);
    if (live) {
      // a reply already given answered the turn's messages
      const messages = [...(live.replied ? [] : live.current), ...live.queue];
      if (messages.length) this.o.board.setIdea(cardId, { unread: { why, messages } });
    } else {
      // parked or dropped while paused: that is what the agent hears when it goes on
      const { unread } = this.o.board.idea(cardId);
      if (unread?.why === 'paused') this.o.board.setIdea(cardId, { unread: { ...unread, why } });
    }
    this.close(cardId, paused);
  }

  /** After a restart: an idea whose agent was in the middle of a reply gets it. */
  resumeAll() {
    for (const i of this.o.board.items()) {
      if (i.state !== 'idea' || !i.idea?.discussion?.thinking) continue;
      // about to pause after its reply, which the restart cut off: it stays paused, its words unanswered
      if (isPausing(i)) {
        this.o.board.setIdea(i.id, { thinking: false });
        this.o.board.work(i.id, { hold: holdNow('paused') });
        this.o.board.log(i.id, 'state', 'owner', this.o.board.t.worker.pausedByOwner);
        continue;
      }
      // with its repository not on the project, what it has not answered waits for the owner's next words
      if (this.o.board.row(i.id).session_id && !i.repoDown) this.send(i, 'Seismic was restarted while you worked on your reply. Answer the owner’s last message now.');
      else {
        this.o.board.setIdea(i.id, { thinking: false });
        this.o.onReplied?.(i.id, false);
      }
    }
  }

  /**
   * Seismic stops: a session that started resumes with the message of its turn, but what waited for
   * it would be lost; a session that never started loses its turn too.
   */
  shutdown() {
    for (const [cardId, live] of this.live) {
      live.session.close();
      if (this.o.board.item(cardId)?.state !== 'idea') continue;
      const messages = this.o.board.row(cardId).session_id ? live.queue : [...live.current, ...live.queue];
      if (messages.length) this.o.board.setIdea(cardId, { unread: { why: 'restart', messages } });
    }
    this.live.clear();
  }

  /** `owner`: the owner's words, which let a paused agent go on; what Seismic tells it waits with what it has not answered yet. */
  private send(card: Item, message: string, images: string[] = [], quiet = false, said: number[] = [], owner = false) {
    // the owner's words let an agent about to pause after its reply go on, as they do a paused one
    if (owner && this.o.board.holdOf(card.id)?.reason === 'pausing') this.pauseTakenBack(card.id);
    const live = this.live.get(card.id);
    if (live) {
      // queued, it goes in with whatever else came, which may well need a reply
      live.queue.push({ text: message, images, said });
      // a turn waiting for its background work ended: the message goes in at once, and the turn answers it too
      if (live.work.waiting) {
        live.work.stop();
        this.sendQueued(card.id, live, [...live.current]);
      }
      return;
    }
    const row = this.o.board.row(card.id);
    // what an interrupted turn left unanswered goes first
    const { unread } = this.o.board.idea(card.id);
    if (row.hold && isPaused({ hold: row.hold })) {
      if (!owner) {
        this.o.board.setIdea(card.id, { unread: { why: unread?.why ?? 'paused', messages: [...(unread?.messages ?? []), { text: message, images, said }] } });
        return;
      }
      this.o.board.work(card.id, this.o.board.unheld(card.id, ['paused', 'limit']));
      this.o.board.log(card.id, 'state', 'owner', this.o.board.t.worker.resumedByOwner);
    }
    const current = [...(unread?.messages ?? []), { text: message, images, said }];
    this.o.board.setIdea(card.id, { thinking: true, unread: undefined });
    this.o.board.readNow(card.id, current.flatMap((m) => m.said));
    const text = unread ? `${UNREAD_NOTE[unread.why]}\n\n${unread.messages.map((m) => m.text).join('\n\n')}\n\n---\n\n${message}` : message;
    const all = current.flatMap((m) => m.images);
    if (row.session_id) return this.launch(card, current, text, row.session_id, all, quiet);
    // a planned card that became an idea brings the screenshots of its task
    const shots = this.o.imageFiles?.(card.images) ?? [];
    this.launch(card, current, `${this.briefing(card, shots, current.flatMap((m) => m.said))}\n\n${text}`, undefined, [...shots, ...all], quiet);
  }

  private launch(card: Item, current: Message[], message: string, resume: string | undefined, images: string[], quiet = false) {
    // where it reads, first: without its repository on the project, nothing starts
    const cwd = this.o.pathFor(card);
    const preferences = this.o.preferences?.() ?? '';
    const live: Live = { session: undefined!, current, queue: [], replied: false, lastText: '', quiet, preferences, work: undefined! };
    // without a sign of the agent for a long while (the work ended, and nothing woke it), its turn is over
    live.work = new BackgroundWait(
      () => {
        if (this.live.get(card.id) === live) this.turnOver(card.id, live);
      },
      { grace: this.o.backgroundGrace, limit: this.o.backgroundLimit },
    );
    this.live.set(card.id, live);
    live.session = explorerAgent.start(
      this.o.runtime,
      {
        host: this,
        cardId: card.id,
        live,
        conversation: this.o.board.conversation(),
        ui: this.o.board.language(),
        repository: this.o.repoLanguage?.(card) ?? 'en',
        toSeismic: !!this.o.toSeismic,
        preferences,
        message,
        setting: resume ? this.o.board.sessionSetting(card.id) : undefined,
        options: {
          at: { card: card.id },
          contextUpdate: () => [this.buildNote(card.id, live), this.preferencesUpdate(live)].filter(Boolean).join('\n\n') || undefined,
          // the idea's agent waits for the usage limit, on the card, and the owner's words wait with it
          onLimit: (until, retry) => this.o.board.waitsForLimit({ card: card.id }, until, retry),
        },
      },
      { cwd, onEvent: (e) => this.onEvent(card.id, live, e), ...(resume ? { resume } : {}), images },
    );
  }

  /** The owner clicked "Build it like this" while the agent works: it hears so once, as the brief it leaves becomes the task. */
  private buildNote(cardId: string, live: Live): string | undefined {
    if (live.toldBuild || !this.o.board.item(cardId)?.idea?.discussion?.buildAfterReply) return;
    live.toldBuild = true;
    return BUILD_AFTER_REPLY;
  }

  /** A preference learned or changed during the session reaches the agent once, with its next tool call. */
  private preferencesUpdate(live: Live): string | undefined {
    const now = this.o.preferences?.() ?? '';
    if (now === live.preferences) return;
    live.preferences = now;
    return now ? `The owner's preferences changed during this conversation; they now read:\n\n${now}` : 'The owner withdrew their standing preferences; none apply any more.';
  }

  private onEvent(cardId: string, live: Live, e: AgentEvent) {
    if (this.live.get(cardId) !== live) return;
    if (e.type === 'background') return live.work.changed(e.tasks.length);
    // a turn may also start without a message from Seismic (a finished background command)
    live.work.stop();
    switch (e.type) {
      case 'session':
        this.o.board.work(cardId, { session_id: e.id, ...(e.setting ? { agent_setting: JSON.stringify(e.setting) } : {}) });
        break;
      case 'text':
        live.lastText = e.text;
        // what it thinks on the way to its reply; words after the reply only close the turn
        if (!live.replied && e.text.trim()) this.o.board.log(cardId, 'say', 'explorer', clip(e.text.trim(), 12000));
        break;
      case 'tool':
        // its own tools show in the conversation and the brief, not as reading
        if (!e.name.startsWith('mcp__') && !OWN_TOOLS.includes(e.name)) this.o.board.log(cardId, 'activity', 'explorer', describeTool(e.name, e.input, this.o.board.t));
        break;
      case 'error':
        this.o.board.log(cardId, 'error', 'seismic', e.message, { token: e.token });
        this.interrupt(cardId, 'error');
        this.o.onReplied?.(cardId, false);
        break;
      case 'idle': {
        live.work.running = e.background ?? 0;
        // its background work still runs (a download, a watcher), and it wakes the agent when it ends:
        // the idea shows it at work until then, and it goes on from there; its words so far are no reply
        if (live.work.running > 0) {
          if (live.replied) {
            // a reply it gave (that it waits for the work, say) answered the turn's messages
            live.current = [];
            live.said = undefined;
            live.replied = false;
          } else if (live.lastText.trim()) live.said = live.lastText.trim();
          live.lastText = '';
          // what the owner said meanwhile goes in now, and the turn answers it too
          if (live.queue.length) this.sendQueued(cardId, live, [...live.current]);
          else live.work.start();
          return;
        }
        this.turnOver(cardId, live);
        break;
      }
    }
  }

  /** The agent's turn is over: what it said last is the reply, and the owner is next, unless more waits for it. */
  private turnOver(cardId: string, live: Live) {
    // a turn without reply still said something: that is the reply, unless the turn was for the brief only
    const said = live.lastText.trim() || live.said;
    if (!live.replied && !live.quiet && said) this.answer(cardId, said);
    live.replied = false;
    live.lastText = '';
    live.said = undefined;
    live.quiet = false;
    // the owner asked it to pause once its reply was given: what was said meanwhile waits for them to let it go on
    if (this.o.board.holdOf(cardId)?.reason === 'pausing') {
      live.current = [];
      this.interrupt(cardId, 'paused', true);
      this.o.board.log(cardId, 'state', 'owner', this.o.board.t.worker.pausedByOwner);
      this.o.onReplied?.(cardId, true);
      return;
    }
    if (live.queue.length) return this.sendQueued(cardId, live, []);
    this.close(cardId);
    this.o.onReplied?.(cardId, true);
  }

  /** What the owner said during the turn starts the next one, which answers it after `unanswered`. */
  private sendQueued(cardId: string, live: Live, unanswered: Message[]) {
    const queued = live.queue.splice(0);
    live.current = [...unanswered, ...queued];
    this.o.board.readNow(cardId, queued.flatMap((m) => m.said));
    live.session.send(
      [...queued.map((m) => m.text), this.buildNote(cardId, live)].filter(Boolean).join('\n\n'),
      queued.flatMap((m) => m.images),
    );
  }

  /**
   * The agent's reply stands in the conversation, its mocks and questions below it; the owner is next,
   * unless the reply asks nothing while a prototype of the idea is still being built: then the owner
   * waits for that, and the agent's reply to its result gives them the turn.
   * Its questions stand in the conversation too, and stay there once answered, with the options picked.
   */
  answer(cardId: string, text: string, questions: Question[] = [], next?: NextStep, mocks: Mock[] = []) {
    this.o.board.log(cardId, 'talk', 'explorer', text, { mocks });
    for (const q of questions) this.o.board.log(cardId, 'question', 'explorer', formatQuestion(q, this.o.board.language()));
    const building = this.o.board.items().some((i) => i.idea?.prototypeOf === cardId && (i.state === 'planned' || i.state === 'working'));
    this.o.board.setIdea(cardId, { yourTurn: questions.length > 0 || !building, questions, next });
  }


  /**
   * The first message of a session from scratch: the card and the decisions, and for an idea discussed
   * before (its session gone, pruned after weeks, say) where it stands: the brief, its mocks, the
   * prototypes planned and built, and the conversation so far up to the messages this turn answers (`said`).
   */
  private briefing(card: Item, shots: string[], said: number[] = []): string {
    return [
      `The idea: “${card.title}”.`,
      card.body.trim(),
      shots.length ? `The owner attached ${shots.length === 1 ? 'a screenshot' : `${shots.length} screenshots`} to the card (shown with this message; files: ${shots.join(', ')}).` : '',
      `Decisions on cards without a plan so far:\n${decisionLog(this.o.board.decisions(null))}`,
      this.standing(card, said),
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  /**
   * Where an idea discussed before stands, for a session that starts without its earlier ones; empty
   * for an idea its agent has not taken up yet (new, or a Question card just turned into one).
   */
  private standing(card: Item, said: number[]): string {
    const { brief, mocks = [], variants = [], split } = this.o.board.idea(card.id);
    const repo = card.idea?.newRepo;
    // in the order the agent read them: words it read later stand after the reply it read them at
    const place = (e: CardEvent) => (e.readAfter ? e.readAfter + 0.5 : e.id);
    const talk = this.o.board
      .talkOf(card.id, EARLIER_MESSAGES + said.length)
      .filter((e) => !said.includes(e.id))
      .slice(-EARLIER_MESSAGES)
      .sort((a, b) => place(a) - place(b) || a.id - b.id);
    const prototypes = card.idea?.prototypes ?? [];
    const shown = prototypes.slice(-MAX_VARIANTS);
    if (!brief.trim() && !mocks.length && !variants.length && !split && !repo && !prototypes.length && !talk.some((e) => e.author === 'explorer')) return '';
    const who = (e: CardEvent) => (e.author === 'owner' ? 'Owner' : e.author === 'explorer' ? 'You' : 'Seismic');
    return [
      'This idea was discussed before, in a session of yours that is gone. Where it stands, as Seismic keeps it; go on from there, and keep in the brief what still holds:',
      brief.trim() ? `The brief as you left it:\n\n${brief.trim()}` : '',
      mocks.length ? `The brief's mocks, shown under it (update_brief without mocks keeps them): ${mocks.map((m) => `“${m.title}”`).join(', ')}.` : '',
      variants.length ? `The prototypes you planned (plan_prototypes):\n${variants.map((v) => `- ${v.approach}: ${v.show}`).join('\n')}` : '',
      split ? `The part you marked to split off (plan_split): “${split.title}”.\n\n${split.brief}` : '',
      repo ? `It is to be built in a new repository at ${repo.path || '(no folder named yet)'}${repo.project ? ', with a project of its own' : ' on this project'}, as ${repo.by === 'owner' ? 'the owner picked on the card' : 'you marked with plan_repo'}.` : '',
      shown.length
        ? `The idea's prototypes${prototypes.length > shown.length ? ` (the latest ${shown.length} of ${prototypes.length})` : ''}:\n${shown.map((p) => `- “${p.title}”, ${prototypeState(p)}${p.review?.summary ? `. Its summary: ${clip(p.review.summary, 2000)}` : ''}`).join('\n')}`
        : '',
      talk.length
        ? `The conversation so far${talk.length === EARLIER_MESSAGES ? ' (its latest messages)' : ''}:\n\n${talk.map((e) => `${who(e)}${e.kind === 'question' ? ' (question)' : ''}: ${clip(e.text, 2000)}`).join('\n\n')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  private idea(id: string): Item {
    const i = this.o.board.item(id);
    if (!i) throw new BadRequest('unknownCard', 'unknown card');
    if (i.state !== 'idea') throw new BadRequest('notIdea', 'the card is not an idea');
    return i;
  }
}



const OWN_TOOLS = ['reply', 'update_brief', 'plan_prototypes', 'plan_split', 'plan_repo', 'record_decision', 'to_seismic'];



/** How many messages of the conversation so far a session from scratch reads. */
const EARLIER_MESSAGES = 20;

/** A prototype's state, as a session from scratch hears it. */
function prototypeState(p: Item): string {
  if (p.idea?.prototypeEnd === 'discarded') return 'discarded';
  if (p.idea?.prototypeEnd === 'built') return 'the idea was built on it';
  if (p.state === 'planned' || p.state === 'working') return 'being built';
  if (p.state === 'waiting' && (p.need === 'demo' || p.need === 'review')) return 'handed over';
  return p.state;
}

/** How the agent opens the discussion of an idea the owner wrote, or one a worker proposed. */
const OPENING =
  'The owner wrote this as a card to be built, then chose to discuss it first. They have not said more yet: what the card says above is where the conversation starts. Look into it and open the discussion.';

const OPENING_NOTES =
  'The owner wrote this as a card to be built, left the notes below on it for the agent that would take it on, then chose to discuss it first. What the card says above and these notes are where the conversation starts. Look into them and open the discussion.';

const OPENING_PROPOSED =
  "A worker proposed this idea while on another card, and the owner took it up to discuss it. They have not said more yet: what the card says above is where the conversation starts, with what the owner decided on the proposal and the questions still open. Look into it and open the discussion.";

const OPENING_PROPOSED_TASK =
  "A worker proposed this as a task to build while on another card, and the owner chose to discuss it as an idea first. They have not said more yet: what the card says above is where the conversation starts, with what the owner decided on the proposal and the questions still open. Look into it and open the discussion.";

/** The owner let the paused agent go on after it had replied already. */
const RESUMED =
  'The owner paused you after your reply and has now let you go on. Pausing ended your session at once: whatever you had running was stopped with it (a command still running shows exit code 137). Go on where you stopped.';

/** The owner clicked "Build it like this" during the agent's turn. */
const BUILD_AFTER_REPLY =
  'The owner clicked "Build it like this" while you worked on this reply: once it is there, a worker builds the idea from the brief as you leave it, unless your reply asks questions; then nothing is built, and the owner decides again after answering them.';

/** How the agent hears the messages an interrupted turn left unanswered. */
const UNREAD_NOTE: Record<Unread['why'], string> = {
  parked: 'The owner parked the idea while you were working on a reply, which ended that turn. These messages are still unanswered; take them in with the one after them:',
  dropped: 'The owner dropped the idea while you were working on a reply, which ended that turn. These messages are still unanswered; take them in with the one after them:',
  error: 'Your last turn ended with an error before you replied. These messages are still unanswered; take them in with the one after them:',
  restart: 'Seismic was restarted while you worked on a reply. These messages are still unanswered; take them in with the one after them:',
  paused:
    'The owner paused you while you worked on a reply and has now let you go on. Pausing ended your session at once: whatever you had running was stopped with it (a command still running shows exit code 137). These messages are still unanswered; take them in with the one after them:',
};






