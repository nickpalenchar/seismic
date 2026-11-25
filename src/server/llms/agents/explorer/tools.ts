




import { z } from 'zod';
import { type Mock, NEXT_STEPS, type NextStep, type PlannedPrototype, type Question, type SettledPart } from '../../../../core/types';
import { type Asked, withPick } from '../../../advisor';
import { type AgentTool } from '../../../runtime';
import { toSeismicTool } from '../../../to-seismic';
import { clip } from '../../../../core/text';
import { folderPath } from '../../../new-repo';
import type { Explorers, Live } from '../../../explorers';
import { WORDS } from './systemPrompt';


export type ExplorerHost = Pick<Explorers, 'o' | 'live' | 'answer'>;


export const MAX_VARIANTS = 6;

/** How a mock is written, for both tools that take them. */
const mocks = (language: string) =>
  `each with a title (the variant in a few words, in ${language}) and html: a few lines of self-contained HTML with inline styles (no files, no network), shown in a sandboxed frame that may leave it only 240 px of width, so nothing in it is wider`;

const MOCK_SCHEMA = z.array(z.object({ title: z.string(), html: z.string() })).max(MAX_VARIANTS).optional();

/** The prototypes as the agent planned them: each with an approach of its own, and a task. */
function plannedPrototypes(list: unknown): PlannedPrototype[] {
  const seen = new Set<string>();
  const out: PlannedPrototype[] = [];
  for (const p of (list as { approach?: unknown; show?: unknown }[] | undefined) ?? []) {
    const approach = clip(String(p.approach ?? '').replace(/\s+/g, ' ').trim(), 60);
    const show = clip(String(p.show ?? '').trim(), 4000);
    if (!approach || !show || seen.has(approach.toLowerCase())) continue;
    seen.add(approach.toLowerCase());
    out.push({ approach, show });
  }
  return out.slice(0, MAX_VARIANTS);
}

/** The mocks as the agent wrote them: each with a title and some HTML, at most one per variant. */
function mocksOf(list: unknown): Mock[] {
  return ((list as { title?: unknown; html?: unknown }[] | undefined) ?? [])
    .map((m) => ({ title: clip(String(m.title ?? '').replace(/\s+/g, ' ').trim(), 80), html: String(m.html ?? '').trim() }))
    .filter((m) => m.html && m.html.length <= MOCK_MAX)
    .slice(0, MAX_VARIANTS);
}


const MOCK_MAX = 20000;

/** The part to build now as the agent marked it: both a title and a brief, or no split. */
function settledPart(title: unknown, brief: unknown): SettledPart | undefined {
  const part = { title: clip(String(title ?? '').replace(/\s+/g, ' ').trim(), 160), brief: clip(String(brief ?? '').trim(), 20000) };
  return part.title && part.brief ? part : undefined;
}

/** The step the agent suggests; answering needs questions to answer, building the settled part a part marked. */
function nextStep(next: unknown, asked: Question[], split: boolean): NextStep | undefined {
  const n = next as { step?: unknown; why?: unknown } | undefined;
  if (!n || !NEXT_STEPS.includes(n.step as NextStep['step'])) return undefined;
  if (n.step === 'answer' && !asked.length) return undefined;
  if (n.step === 'splitOff' && !split) return undefined;
  return { step: n.step as NextStep['step'], why: clip(String(n.why ?? '').trim(), 400) };
}

export function explorerTools(self: ExplorerHost, cardId: string, live: Live): AgentTool[] {
  const current = (tools: AgentTool[]): AgentTool[] =>
    tools.map((t) => ({ ...t, run: (args) => (self.live.get(cardId) === live ? t.run(args) : 'This conversation has ended. End your turn.') }));
  
  const language = self.o.board.conversation();
  const OWNER_LANGUAGE = "the owner's language";
  const MOCKS = mocks(OWNER_LANGUAGE);
  const t = self.o.board.t.idea;
  return current([
    {
      name: 'reply',
      description: `Your turn in the conversation, shown on the card beside the brief (markdown, in ${OWNER_LANGUAGE}): a few sentences that do not repeat the brief. questions: the questions you ask now, each with its answer options (multiple: true when several may be chosen together); the card shows them under your reply for the owner to pick from, so the reply does not repeat them; pick: the options you would choose yourself if you had to decide (one, or several when multiple), and pick_why: why, in one short sentence in ${OWNER_LANGUAGE}. next: what you would do next in the owner's place, always: answer (the open questions come first), build, splitOff (with a part marked with plan_split), planDoc, prototype, park or drop, with why in one short sentence in ${OWNER_LANGUAGE}; the card marks that click for the owner. mocks: only when the owner asked to see something the brief has no place for; ${MOCKS}. Call it once per message, then end your turn.`,
      schema: {
        text: z.string(),
        questions: z
          .array(
            z.object({
              question: z.string(),
              options: z.array(z.string()).max(6),
              multiple: z.boolean().optional(),
              pick: z.array(z.string()).optional(),
              pick_why: z.string().optional(),
            }),
          )
          .max(4)
          .optional(),
        next: z.object({ step: z.enum(NEXT_STEPS), why: z.string() }).optional(),
        mocks: MOCK_SCHEMA,
      },
      run: ({ text, questions, next, mocks }) => {
        if (live.replied) return 'Already replied. End your turn now.';
        live.replied = true;
        const asked = ((questions as Asked[] | undefined) ?? []).map(withPick).filter((q) => q.text);
        self.answer(cardId, clip(String(text), 12000), asked, nextStep(next, asked, !!self.o.board.idea(cardId).split), mocksOf(mocks));
        return 'Shown to the owner. End your turn now; their next message arrives as a new one.';
      },
    },
    {
      name: 'update_brief',
      description: `Replace the brief of the idea ("${t.briefName}"), in ${OWNER_LANGUAGE} markdown, whenever the conversation changed it. Always the whole text, standing on its own. mocks: how the brief's variants look, one per variant, shown under the brief; ${MOCKS}. The whole list whenever it changes; leave it out to keep the mocks as they are, an empty list removes them.`,
      schema: { brief: z.string(), mocks: MOCK_SCHEMA },
      run: ({ brief, mocks }) => {
        self.o.board.setIdea(cardId, { brief: clip(String(brief).trim(), 20000), ...(mocks === undefined ? {} : { mocks: mocksOf(mocks) }) });
        self.o.board.log(cardId, 'activity', 'explorer', t.briefUpdated);
        return 'Brief updated.';
      },
    },
    {
      name: 'plan_prototypes',
      description: `The throwaway prototypes the brief plans, one per variant to be seen side by side: the whole list each time, empty when none are planned any more. When the owner clicks "${t.prototypeButton}", the card offers them, all chosen, and starts one worker per variant at once; without this list it starts one prototype of the idea as it stands. approach: the variant in a few words, in ${OWNER_LANGUAGE} (${WORDS[language].approach}); it becomes the prototype's title. show: that prototype's task, in ${OWNER_LANGUAGE}: what it builds and what its demo shows, for this variant only; its worker also reads the brief.`,
      schema: { prototypes: z.array(z.object({ approach: z.string(), show: z.string() })).max(MAX_VARIANTS) },
      run: ({ prototypes }) => {
        const variants = plannedPrototypes(prototypes);
        self.o.board.setIdea(cardId, { variants });
        self.o.board.log(cardId, 'activity', 'explorer', variants.length ? t.plansPrototypes(variants.map((v) => v.approach).join(', ')) : t.plansNoPrototypes);
        return variants.length ? `Planned ${variants.length} prototype${variants.length > 1 ? 's' : ''}.` : 'No prototypes planned.';
      },
    },
    {
      name: 'plan_split',
      description: `When part of the idea is settled and part is still open (to be discussed further, or prototyped), the part to build now: the owner splits it off with "${t.splitOffButton}" as a task of its own, which a worker starts on at once, and the idea stays with what is open. title: that task's title, a few words in ${OWNER_LANGUAGE}. brief: its worker's task, in ${OWNER_LANGUAGE} markdown, standing on its own and holding only what is settled; what is still open is no part of it. The whole value each time; both empty when no part is settled apart from the rest any more.`,
      schema: { title: z.string(), brief: z.string() },
      run: ({ title, brief }) => {
        const part = settledPart(title, brief);
        self.o.board.setIdea(cardId, { split: part });
        self.o.board.log(cardId, 'activity', 'explorer', part ? t.plansSplit(part.title) : t.plansNoSplit);
        return part ? `Marked “${part.title}” to split off.` : 'No task marked to split off.';
      },
    },
    {
      name: 'plan_repo',
      description: `When the owner wants the idea built in a repository that does not exist yet ("in a new repo under ~/dev/super59"): path, its folder (absolute or from ~), and project: true for a project of its own (the default), false where the owner wants the repository on this project beside the others. The card's repository picker then shows it, and its button builds it there: Seismic creates the folder and a local git repository (no remote, nothing published), a project named after it, moves this idea there with all it holds (brief, conversation, mocks, decisions) and builds it there; the worker hears the repository is new and sets it up (CLAUDE.md, Seismic's settings). The whole value each time; an empty path when it is to be built in an existing repository again. What the owner picked on the card stands: you do not change it.`,
      schema: { path: z.string(), project: z.boolean().optional() },
      run: ({ path, project }) => {
        const p = clip(String(path ?? '').trim(), 1000);
        if (p && !folderPath(p)) return `${p} is no folder: give it absolute or from ~.`;
        const set = self.o.board.setNewRepo(cardId, p ? { path: p, project: project !== false, by: 'agent' } : null, 'agent');
        const now = self.o.board.newRepo(cardId);
        if (!set) return `The owner picked the repository on the card themselves${now?.path ? ` (a new one at ${now.path})` : ''}; it stays as they chose.`;
        self.o.board.log(cardId, 'activity', 'explorer', p ? t.plansRepo(p) : t.plansNoRepo);
        return p ? `The card now builds it in a new repository at ${p}${project === false ? ' on this project' : ', with a project of its own'}.` : 'No new repository: it is built where the card says.';
      },
    },
    {
      name: 'record_decision',
      description: `The owner decided something in the conversation: record it in the decision log (question and answer in ${OWNER_LANGUAGE}, short).`,
      schema: { question: z.string(), answer: z.string() },
      run: ({ question, answer }) => {
        self.o.board.decide({ plan_id: null, card_id: cardId, question: clip(String(question), 500), answer: clip(String(answer), 500), by: 'owner' });
        self.o.board.log(cardId, 'state', 'explorer', t.decision(clip(String(question), 200), clip(String(answer), 200)));
        return 'Recorded.';
      },
    },
    ...(self.o.toSeismic ? [toSeismicTool((request) => self.o.toSeismic!(cardId, request))] : []),
  ]);
}
