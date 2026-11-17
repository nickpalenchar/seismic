/**
 * The worker's tools: what it reaches Seismic through (`report`, `reply`, `ask`, `ready_for_review`
 * and the rest), as the card's state allows them. They act on the card through the `Workers` that
 * runs it (`WorkerHost`).
 */
import { z } from 'zod';
import { LANGUAGE_NAMES } from '../../../../core/locale';
import { type CardFile } from '../../../../core/files';
import { answering, AWAITED_STATES, awaited, isPausing, type CardLanding, type DemoKind, type DemoPage, formatQuestion, type Snooze, SNOOZE_LIMIT } from '../../../../core/types';
import { BadRequest, type StoredDemo, titleKey } from '../../../board';
import { type Asked, withPick } from '../../../advisor';
import { checkArtifact, readChapters } from '../../../demo';
import { artifactFiles } from '../../../demo-page';
import { remoteHost } from '../../../repo';
import { type AgentTool } from '../../../runtime';
import { toObeyaTool } from '../../../to-obeya';
import { hostName } from '../../../hosts';
import { contributionOf, type PrState, type StoredContribution } from '../../../board';
import { type PageTags, SEVERITIES } from '../../../../core/types';
import { dimensions, outside, tagsOf } from '../../../../core/page-tags';
import { type DataSignal, dataModelSignals } from '../../../data-models';
import { parsePrUrl, sameRepo } from '../../../forge';
import { clip } from '../../../../core/text';
import type { LandedState, Live, OwnCommits, Workers } from '../../../workers';
import { AFTER_LANDING, APP_URL, demoQuestion, END_TURN, landedOf, MAX_RESULT_FILES, PROPOSAL_QUESTIONS, proposalQuestions, proposalTask, snoozedUntil } from './shared';

/** What the worker's tools and prompt need of the `Workers` that runs the card. */
export type WorkerHost = Pick<Workers, 'artifacts' | 'cardTitled' | 'close' | 'dataModels' | 'demoHere' | 'demoLanguage' | 'demoSkill' | 'disputeItems' | 'earlier' | 'execLane' | 'folder' | 'followUpTask' | 'heldAt' | 'inWorktree' | 'landResolved' | 'landingOf' | 'live' | 'namedFiles' | 'o' | 'otherBoards' | 'owedTasks' | 'ownCommits' | 'probeClash' | 'proposalBoards' | 'proposalRepo' | 'report' | 'requestChanges' | 'resubmitItems' | 'retract' | 'reviewModeOf' | 'reviews' | 'setFindings' | 'shares' | 'showsFiles' | 'toOwner' | 'unheardNow'>;

export function workerTools(self: WorkerHost, cardId: string, live: Live, prototype: boolean): AgentTool[] {
  // the system prompt says which language that is (`ownersLanguage`)
  const language = "the owner's language";
  // the page goes to colleagues: in the language of the repository's demos where it names one
  const pageLanguage = LANGUAGE_NAMES[self.demoLanguage()];
  // whether the repository shares, as the session's tools have it from their start on: the schema drops a page they do not
  // take, so the handover asks for one only where they take it (where sharing began since, the page is written once shared)
  const shares = self.shares;
  // the vocabulary the page's tags come from, where the repository's site names one
  const vocabulary = shares ? dimensions(self.o.vocabulary?.()) : [];
  // a proposal may go to another repository than the card's: of this project, or of another project this Seismic runs
  const repos = self.o.board.project.repos;
  const ownRepo = self.o.repo ?? self.o.board.home;
  const others = self.otherBoards().filter((b) => b.project.repos.length);
  const anotherRepo = repos.length > 1 || others.length > 0;
  const handOver = () => {
    live.handedOver = true;
    live.nudged = false;
    // a question or a handover after a snooze in the same turn: the card waits for the owner instead
    if (live.snoozed) {
      live.snoozed = false;
      self.o.board.work(cardId, self.o.board.unheld(cardId, ['snoozed']));
    }
  };
  /**
   * The result of a call that ends the worker's turn (`plain`). The owner's words that waited for
   * this step come with the result itself, with what to do about them, so that the worker takes
   * them in before its turn ends rather than ending it in silence: `stands` is what holds of the
   * call meanwhile, `change` what follows if their words change it.
   */
  const ending = (plain: string, stands: string, change?: string): string => {
    const words = self.unheardNow(cardId, live);
    if (!words) return plain;
    return `${stands} The owner wrote to you while you worked, and their words reach you only now, with this result: take them in as at any other step. Answer them with reply where they call for an answer, and do what they ask${change ? `; ${change}` : ''}. Then end your turn.\n\n${words}`;
  };
  // a session the owner stopped or replaced may still call its tools: those calls change nothing
  const current = (tools: AgentTool[]): AgentTool[] =>
    tools.map((t) => ({ ...t, run: (args) => (self.live.get(cardId) === live || live.standIn ? t.run(args) : 'This session has ended. Stop working and end your turn.') }));
  // a review card's tools to the contributor's pull request
  const review = contributionOf(self.o.board.row(cardId));
  // the tools stand for the whole session, while the project's setting may change under it: every card of the owner's has the tool, which refuses where there are no findings
  // a card whose work the project reviews makes the follow-up tasks the owner chooses of the review's findings
  const reviewed = !review && !self.folder && !self.o.board.row(cardId).idea?.prototypeOf;
  return current([
    {
      name: 'report',
      description: `Show the owner one short status line on your card (in ${language}, at most ~80 characters). Use it at milestones, not for every step.`,
      schema: { status: z.string() },
      run: ({ status }) => {
        const s = clip(String(status), 200);
        self.o.board.work(cardId, { status_line: s });
        self.o.board.log(cardId, 'report', 'worker', s);
        return 'Shown on the card.';
      },
    },
    {
      name: 'reply',
      description: `Answer a note or feedback from the owner in your card's conversation: a sentence or two in ${language}, what you change because of it or why nothing. The reply does not end your turn: if work remains, carry on with it; if none does (your work is handed over and the note changes nothing), your turn ends with the reply, and the card goes on waiting for the owner's approval.`,
      schema: { text: z.string() },
      run: ({ text }) => {
        const s = clip(String(text).trim(), 2000);
        if (!s) return 'Not shown: the reply is empty.';
        // a reply may end the turn on a handover: what the owner chose for later is made before it
        const owed = self.owedTasks(cardId);
        if (owed) return `Not shown: first make the follow-up tasks the owner chose, for ${owed}; then reply.`;
        self.o.board.log(cardId, 'talk', 'worker', s);
        live.answered = true;
        live.spoke = true;
        return 'Shown to the owner.';
      },
    },
    {
      name: 'ask',
      description: `Ask for a decision you should not make yourself: product behaviour, trade-offs, anything irreversible or external. Write the question in ${language} for a reader who has not seen the code, and offer up to four short answer options when they exist; the owner picks one on the card (several when multiple is true) or writes their own. pick: the options you would choose yourself if you had to decide (one, or several when multiple), and pick_why: why, in one short sentence in ${language}; the card marks them for the owner. Then end your turn.`,
      schema: {
        question: z.string(),
        options: z.array(z.string()).max(4).optional(),
        multiple: z.boolean().optional(),
        pick: z.array(z.string()).optional(),
        pick_why: z.string().optional(),
        demo: z
          .object({
            kind: z.enum(['video', 'html']).optional().describe("'video' (the default): a recording made with the demo skill; 'html': a page to look at"),
            dir: z.string().describe('absolute path: a video holds demo.mp4 and captions.vtt, an HTML artifact holds index.html and the files it loads'),
            chapters: z.array(z.string()).optional().describe('video only: scene titles, in order'),
          })
          .optional()
          .describe(
            "what the owner is to look at to answer, when there is something to see (drafts or variants side by side, as an HTML artifact, say): the card shows it beside your question as it shows a handover's demo. It is no handover: the handover still brings its own demo.",
          ),
      },
      run: (args) => {
        const asked = (shown?: StoredDemo): string => {
          handOver();
          const q = withPick(args as unknown as Asked);
          const e = self.o.board.log(cardId, 'question', 'worker', formatQuestion(q, self.o.board.language()));
          if (shown) {
            // the demo it replaces stays with the card, for the owner to go back to
            const row = self.o.board.row(cardId);
            self.o.board.work(cardId, { demo: { latest: { ...shown, asked: true, handover: e.id, at: e.at }, ...(row.demo?.latest ? { earlier: self.earlier(cardId, row) } : {}) } });
          }
          self.toOwner(cardId, q);
          return ending(
            END_TURN,
            'Recorded: your question waits for the owner on the card, and their answer arrives as your next message.',
            'if they change your question, ask it anew (the card shows the earlier one as asked again further below)',
          );
        };
        const given = args.demo as { kind?: DemoKind; dir: string; chapters?: string[] } | undefined;
        if (!given) return asked();
        // a demo made on another machine is shown from its copy here
        return self.demoHere(cardId, given.dir).then((here) => {
          if ('wrong' in here) return `Not asked: the demo could not be copied to the owner's machine (${here.wrong}). Check the directory, then ask again.`;
          // copying it takes a while, in which the owner may stop or replace the session
          if (self.live.get(cardId) !== live && !live.standIn) return 'This session has ended. Stop working and end your turn.';
          const kind = given.kind ?? 'video';
          if (kind === 'html') {
            const wrong = checkArtifact(here.dir);
            if (wrong) return `Not asked: ${wrong}. Fix the artifact, then ask again.`;
            return asked({ kind, dir: here.dir, chapters: [], ...(artifactFiles(here.dir).length === 1 ? { single: true as const } : {}) });
          }
          const chapters = readChapters(here.dir, given.chapters ?? []);
          if (typeof chapters === 'string') return `Not asked: ${chapters}. Fix the demo, then ask again.`;
          return asked({ kind, dir: here.dir, chapters });
        });
      },
    },
    // a prototype makes no cards of its own: what it proposes is building its idea on it
    prototype
      ? {
          name: 'propose_build',
          description: `Propose that the idea be built on this prototype: a worker then goes on from your branch, takes over what carries and brings it to production quality, and the idea's other prototypes are discarded. Use it when your approach convinced (the owner said so, or it clearly settles the idea). It shows on your card, where the owner accepts it or not. reason: why, in ${language}, a sentence or two.`,
          schema: { reason: z.string() },
          run: ({ reason }) => {
            self.o.board.proposeBuild(cardId, clip(String(reason).trim(), 2000));
            self.o.board.log(cardId, 'activity', 'worker', self.o.board.t.worker.proposesBuild(clip(String(reason).trim(), 300)));
            return 'Shown on your card; the owner decides. Continue with your task.';
          },
        }
      : {
          name: 'propose_card',
          description: [
            `Propose a separate card for something you noticed that is outside your task, instead of doing it here, or for a follow-up to your own task that can only be done later (start_at); the owner decides on it.`,
            `idea: true for something to think through with the owner before anyone builds it (it becomes an idea, discussed with an agent of its own); leave it out for a task that is clear enough to build.`,
            proposalTask('your card nor your session'),
            `reason: for the owner only, why you propose it, a sentence or two; it does not go to that agent.`,
            `questions: what the owner has to decide first (product behaviour, a trade-off), each with up to four short options; keep them out of task. The owner may answer them on the proposal; what they decided and what stays open go to the agent with the task.`,
            `replaces: the title of an earlier proposal of yours this one takes the place of; Seismic takes that one off the project, or, if the owner has taken it on already, marks it as replaced and offers to remove it.`,
            `start_at: when the card is to start, ISO 8601 with your timezone's offset (2026-11-04T08:00:00+01:00), for a task that can only be done later (whether a bank has registered a form two weeks on, say): accepted, it waits until then and starts by itself. Its agent then checks what it can and asks the owner for what only they can see.`,
            ...(anotherRepo
              ? [
                  `repo: the repository the change is to be made in, by its id: ${repos.map((r) => `${r.id} (${r.path}${r.id === ownRepo ? ', yours' : ''})`).join(', ')}${others.length ? `; on other projects, where the proposal then waits for the owner: ${others.map((b) => `on “${b.project.name}” ${b.project.repos.map((r) => `${r.id} (${r.path})`).join(', ')}`).join('; ')}` : ''}; yours when left out.`,
                ]
              : []),
            `Everything in ${language}.`,
          ].join(' '),
          schema: {
            title: z.string(),
            task: z.string(),
            reason: z.string(),
            idea: z.boolean().optional(),
            questions: PROPOSAL_QUESTIONS.optional(),
            replaces: z.string().optional(),
            start_at: z.string().optional(),
            ...(anotherRepo ? { repo: z.string().optional() } : {}),
          },
          run: ({ title, task, reason, idea, questions, replaces, start_at, repo }) => {
            const wanted = typeof repo === 'string' && repo.trim() ? repo.trim() : undefined;
            const into = wanted ? self.proposalRepo(wanted) : undefined;
            if (typeof into === 'string') return into;
            const board = into?.board ?? self.o.board;
            const named = typeof start_at === 'string' && start_at.trim() ? start_at.trim() : undefined;
            const at = named ? Date.parse(named) : NaN;
            if (named && Number.isNaN(at)) return 'Not proposed: give start_at as ISO 8601 with your timezone offset (2026-11-04T08:00:00+01:00).';
            if (named && at <= Date.now()) return `Not proposed: start_at has passed (it is ${new Date().toISOString()} now).`;
            if (named && at > Date.now() + SNOOZE_LIMIT) return 'Not proposed: start_at lies more than a year ahead.';
            const p = board.propose(cardId, {
              title: String(title),
              task: String(task),
              reason: String(reason),
              idea: !!idea,
              questions: proposalQuestions(questions as z.infer<typeof PROPOSAL_QUESTIONS> | undefined),
              ...(named ? { startAt: new Date(at).toISOString() } : {}),
              ...(into ? { repo: into.repo } : {}),
            });
            const there = board === self.o.board ? undefined : board.project.name;
            self.o.board.log(cardId, 'activity', 'worker', idea ? self.o.board.t.worker.proposedIdea(p.title, there) : self.o.board.t.worker.proposedCard(p.title, there), {
              made: { card: p.id, title: p.title, ...(there ? { project: board.project.id } : {}) },
            });
            const old = typeof replaces === 'string' && replaces.trim() ? replaces.trim() : undefined;
            return old ? `Proposed. ${self.retract(cardId, old, { by: p.id, title: p.title })}` : 'Proposed; the owner decides. Continue with your task.';
          },
        },
    // a prototype makes no cards, so it has none to take back
    ...(prototype
      ? []
      : [
          {
            name: 'withdraw_proposal',
            description: [
              `Take back a card you proposed earlier (propose_card) that turned out wrong or needless, by its title. Still open, it goes from the project at once; if the owner has taken it on already, Seismic marks it as withdrawn and offers to remove it.`,
              `replaced_by: the title of a proposal of yours that takes its place, when you made one already (a new one names the old with replaces instead).`,
              `why: for the owner, a sentence, in ${language}.`,
            ].join(' '),
            schema: { title: z.string(), why: z.string(), replaced_by: z.string().optional() },
            run: (args: Record<string, unknown>) => {
              const { title, why, replaced_by } = args as { title: string; why: string; replaced_by?: string };
              // the latest by that title, as retract takes the latest it replaces: of two alike, the newer replaces the older
              const by = replaced_by?.trim()
                ? self.proposalBoards()
                    .map((b) => b.items().findLast((i) => i.from === cardId && (!!i.idea?.proposal || !!i.idea?.proposed) && titleKey(i.title) === titleKey(replaced_by)))
                    .find(Boolean)
                : undefined;
              if (replaced_by?.trim() && !by) return `No card you proposed is called “${replaced_by.trim()}”. Nothing was withdrawn.`;
              return self.retract(cardId, String(title).trim(), { ...(by ? { by: by.id, title: by.title } : {}), ...(why?.trim() ? { why: clip(why.trim(), 1000) } : {}) });
            },
          },
        ]),
    ...(review
      ? ([
          {
            name: 'findings',
            description: `Record your review's findings for the owner, the whole list as it stands now (you keep it like a brief: call it after your review, and again whenever a finding changes, from the owner's words or a push). Each: a short title, a sentence or two in ${language}, whether it is about security, its severity (blocker: crashes the app or exposes a very important secret or unprotected database; critical: a clear exploit, severe degradation or other major consequence; major: a real defect; minor: worth fixing but not a reason to hold the PR; low: a small issue with limited impact; info: a nitpick or something to flag that may or may not be a problem), the file and line where it is, and its status: open; sent (to the contributor, with the review's url); fixed (by you, committed on your branch; Seismic pushes it with the owner's approval); resolved (a push of the contributor's fixed it, or it no longer applies); dropped (the owner does not pursue it); later (a follow-up task you made with follow_up_task, which Seismic keeps as it is). Give the id of a finding you had; a new one gets the next free number, in the order of the list. with: the ids of the other findings it would make one follow-up task with, should the owner choose that for them: only what one worker would sensibly do in one go (the same cause, the same files), else none. The card shows them beside the demo, bundles together, and the owner decides on each there.`,
            schema: {
              findings: z.array(
                z.object({
                  id: z.number().int().positive().optional(),
                  title: z.string(),
                  text: z.string(),
                  security: z.boolean().optional(),
                  severity: z.enum(SEVERITIES).optional(),
                  file: z.string().optional(),
                  line: z.number().int().positive().optional(),
                  status: z.enum(['open', 'sent', 'fixed', 'resolved', 'dropped', 'later']).optional(),
                  url: z.string().optional(),
                  with: z.array(z.number().int()).optional(),
                }),
              ),
            },
            run: ({ findings }) => self.setFindings(cardId, findings as Parameters<Workers['setFindings']>[1]),
          },
          {
            name: 'follow_up_task',
            description: `Make findings the owner chose as follow-up tasks (or asked for in words) a task of its own, beside your card and following up on it, outside this PR; it waits in the queue behind your card and starts once the PR is merged. findings: the numbers of the findings it is made of, one or several that belong together; title: short and precise, in ${language}; task: what is to be done, in ${language}, written for the agent who will take it on and has seen neither this PR nor your review: what is wrong and why, the files concerned, what done looks like, and the PR's link (${review.url}). Seismic marks those findings later, linking the task.`,
            schema: { findings: z.array(z.number().int()), title: z.string(), task: z.string() },
            run: ({ findings, title, task }) => self.followUpTask(cardId, String(title).trim(), String(task).trim(), (findings as number[]) ?? []),
          },
          {
            name: 'request_changes',
            description: `Send change requests to ${review.author} as one review of the pull request that asks for changes, posted with the owner's account. body: in the PR's language, as the owner's words to the contributor; findings: the numbers of the findings it holds, which Seismic marks as sent. Then end your turn: the card waits for ${review.author}.`,
            schema: { body: z.string(), findings: z.array(z.number().int()).optional() },
            run: async ({ body, findings }) => {
              const owed = self.owedTasks(cardId);
              if (owed) return `Not sent: first make the follow-up tasks the owner chose, for ${owed}; then call request_changes again.`;
              const own = contributionOf(self.o.board.row(cardId));
              if (own?.changing || own?.held)
                return `Not sent: your own changes to the PR wait for the owner's approval, and a request to ${review.author} goes with them as one message. Write it into pr_draft with your handover (ready_for_review): Seismic posts it once the owner approves.`;
              const sent = await self.requestChanges(cardId, String(body), (findings as number[] | undefined) ?? []);
              if (sent) return sent;
              handOver();
              return ending(
                `Sent. End your turn now: the card waits for ${review.author}, and Seismic passes you what they answer or push.`,
                `Sent: the card waits for ${review.author}.`,
                'a change request in them goes to the contributor the same way, or to you as their switch says',
              );
            },
          },
        ] satisfies AgentTool[])
      : []),
    ...(reviewed
      ? ([
          {
            name: 'follow_up_task',
            description: `Make items of the code review of your work that the owner chose as follow-up tasks a task of its own, beside your card and following up on it; it waits in the queue behind your card and starts once your work has landed. findings: the numbers of the items it is made of, one or several that belong together; title: short and precise, in ${language}; task: what is to be done, in ${language}, written for the agent who will take it on and has seen neither your card nor the review: what is wrong and why, the files concerned, what done looks like. Seismic marks those items as follow-ups, linking the task.`,
            schema: { findings: z.array(z.number().int()), title: z.string(), task: z.string() },
            run: ({ findings, title, task }) => self.followUpTask(cardId, String(title).trim(), String(task).trim(), (findings as number[]) ?? []),
          },
          {
            name: 'resubmit_review_item',
            description: `Resubmit items of the code review of your work to the reviewer, each with a note in ${language} on what you did: they go under review, and the next review verifies them. Your handover resubmits all the items you are fixing by itself; use this for an item the owner closed or made a follow-up that your work happens to fix, or to add a note to one, also one under review already.`,
            schema: { items: z.array(z.object({ number: z.number().int(), note: z.string().optional() })) },
            run: ({ items }) => self.resubmitItems(cardId, (items as { number: number; note?: string }[]) ?? []),
          },
          {
            name: 'dispute_review_item',
            description: `Dispute items of the code review of your work that you are fixing and hold wrong, each with your reasons in ${language}: they go back to the owner as reopened, who decides again. Change no code for an item you dispute.`,
            schema: { items: z.array(z.object({ number: z.number().int(), note: z.string() })) },
            run: ({ items }) => self.disputeItems(cardId, (items as { number: number; note: string }[]) ?? []),
          },
        ] satisfies AgentTool[])
      : []),
    {
      name: 'pr_opened',
      description:
        'After the owner approved: report the pull request you opened for this card (its URL); where the work also needed one in another repository, report that one too, a call for each. Then end your turn; Seismic watches them, and the card is live once all are merged.',
      schema: { url: z.string() },
      run: ({ url }) => {
        const row = self.o.board.row(cardId);
        if (!row.review?.pr) return 'Not recorded: the owner has not approved this card yet. Do not open a pull request before that.';
        const ref = parsePrUrl(String(url));
        if (!ref) return 'Not recorded: that is not the URL of a pull request (on GitHub or GitHub Enterprise https://<host>/<owner>/<repo>/pull/<number>, on Forgejo or Gitea such as Codeberg https://<host>/<owner>/<repo>/pulls/<number>).';
        handOver();
        const root = row.review.pr;
        // the card's own is the one in its repository, which the landing is about; one in another
        // repository is watched beside it, and reported again (opened again after it was closed) as before
        const host = self.o.remote && remoteHost(self.o.remote)?.toLowerCase().replace(/^ssh\.github\.com$/, 'github.com');
        const elsewhere = !!self.o.remote && (!sameRepo(self.o.remote, ref.owner, ref.repo) || (!!host && host !== ref.host.toLowerCase()));
        const known = elsewhere ? root.more?.find((m) => parsePrUrl(m.url ?? '')?.url === ref.url) : undefined;
        let pr: PrState;
        // the card's own reported again keeps what was told of it; another in its place starts afresh
        if (!elsewhere) pr = parsePrUrl(root.url ?? '')?.url === ref.url || !root.url ? { ...root, url: ref.url, number: ref.number } : { url: ref.url, number: ref.number, seen: [], reported: [], ...(root.more ? { more: root.more } : {}) };
        else if (known) {
          const { closed: _, ...open } = known;
          pr = { ...root, more: root.more!.map((m) => (m === known ? { ...open, url: ref.url } : m)) };
        } else pr = { ...root, more: [...(root.more ?? []), { url: ref.url, number: ref.number, repo: `${ref.owner}/${ref.repo}`, seen: [], reported: [] }] };
        self.o.board.work(cardId, { review: { pr } });
        self.o.board.log(cardId, 'state', 'worker', self.o.board.t.worker.prOpened(elsewhere ? `${ref.repo} #${ref.number}` : `#${ref.number}`));
        self.o.onPrOpened?.(cardId);
        return ending('Recorded. End your turn now; Seismic watches the pull request.', 'Recorded: Seismic watches the pull request.', 'a change to the work goes onto the pull request');
      },
    },
    {
      name: 'ready_for_review',
      description: `Hand the finished work to the owner, after committing it, running the checks and making the demo. The summary (in ${language}) is what this handover tells the owner beyond what the card's conversation already holds: on your first handover, what changed from the user's point of view and what they really need to know (something left open or not verified, a decision you took for them), in a few short paragraphs at most; on a later one, only what your last handover and your replies since have not said yet, often a sentence. Seismic keeps your handovers and replies together as the card's report for whoever reads it later. A problem you noticed outside the task goes to propose_card, not into the summary, as does a follow-up to your task that is due only later (start_at). The demo: a video's directory and chapter titles in scene order, or an HTML artifact's directory, with its report (in the language of its narration); without a new one, the demo already on the card stands. Then end your turn.`,
      schema: {
        summary: z.string(),
        demo: z
          .object({
            kind: z
              .enum(['video', 'html'])
              .optional()
              .describe("'video' (the default): a recording made with the demo skill; 'html': a page to look at, for results that are seen rather than watched happening"),
            dir: z.string().describe('absolute path of the demo: a video holds demo.mp4 and captions.vtt, an HTML artifact holds index.html and the files it loads'),
            chapters: z.array(z.string()).optional().describe('video only: scene titles, in order'),
            question: z
              .object({
                text: z.string(),
                options: z.array(z.string()).max(4).optional(),
                multiple: z.boolean().optional(),
                pick: z.array(z.string()).optional(),
                pick_why: z.string().optional(),
              })
              .optional()
              .describe(
                `only when something needs the owner beyond approve or feedback; the owner can answer it on the card before approving. As with ask: up to four short answer options when they exist, which the owner picks with a click (several when multiple is true) or answers in their own words; pick and pick_why: the options you would choose and why, in one short sentence in ${language}`,
              ),
            ...(shares
              ? {
                  page: z
                    .object({
                      title: z.string(),
                      text: z.string(),
                      ...(vocabulary.length
                        ? {
                            tags: z
                              .record(z.string(), z.array(z.string()))
                              .optional()
                              .describe(
                                `required: for each of these dimensions, the values that fit the change (an empty list where none does), only from those given, so colleagues find the page by them: ${vocabulary.map(([d, v]) => `${d}: ${v.join(', ')}`).join('; ')}`,
                              ),
                          }
                        : {}),
                    })
                    .optional()
                    .describe(
                      `required: the page on which the owner may share the demo (the video, or the HTML artifact below the text) with colleagues, in ${pageLanguage}. They know the product but have never seen Seismic, this card or the plan doc. title: what changes, in a few words; text: two to five sentences on what changes for the user and why, without findings, tests or internal process${vocabulary.length ? '; tags: see there' : ''}`,
                    ),
                  follows: z
                    .enum(['replaces', 'supplements'])
                    .optional()
                    .describe(
                      "when the card has a demo from an earlier handover: 'replaces' if this one shows the change afresh, so a shared page should show it instead; 'supplements' if it only shows what was corrected or explained since, to stand on the shared page beside the one before",
                    ),
                }
              : {}),
          })
          .optional(),
        ...(review
          ? {
              review: z
                .object({
                  checks: z.array(z.object({ name: z.string(), passed: z.boolean() })),
                  mergeable: z.boolean().describe('the PR merges into the current default branch without conflicts (your merge probe)'),
                })
                .optional()
                .describe("required: the checks on the PR's head and your merge probe; the findings you record with findings"),
              pr_draft: z
                .string()
                .optional()
                .describe(
                  "when your branch holds commits of your own that are not on the PR yet: the text Seismic posts on the PR once the owner approves, after pushing them onto its branch. What you changed and why, in the PR's language, as the owner's words to the contributor, without mentioning Seismic or agents; with findings the owner sends the contributor along with your changes, the request for them in the same text. The card shows it to the owner first, who may edit it there. Without it, the text on the card stands.",
                ),
            }
          : {}),
        files: z
          .array(z.object({ path: z.string(), caption: z.string() }))
          .max(MAX_RESULT_FILES)
          .optional()
          .describe(
            `the files ${self.folder ? 'in the folder' : 'of your branch'} that are the result for the owner (a document, a report, a spreadsheet, a page; not the code or configuration behind it), each with its path and a one-line caption in ${language}. The card shows them beside the demo: Markdown formatted, a PDF in the browser's viewer, any other file to open on the owner's computer. A page you rendered for review only lies in your demo's directory instead, named by its absolute path there.${self.folder || review || !self.artifacts().includes('schema') ? '' : ' With data_models changed, the first file is the schema-change page the demo skill renders, with a caption.'} Without them, the ones named at your last handover stand.`,
          ),
        ...(self.folder || review || !self.artifacts().includes('schema')
          ? {}
          : {
              data_models: z
                .enum(['changed', 'unchanged'])
                .describe(
                  "whether your branch alters the data the app persists (tables, columns, indexes, relations, migrations, ORM models; not API types or config schemas): 'changed' brings the schema-change page among files, 'unchanged' its reason in data_models_reason",
                ),
              data_models_reason: z.string().optional().describe(`with data_models 'unchanged': why, in one line in ${language} (the card may show it to the owner)`),
            }),
      },
      run: ({ summary, demo, files, review: results, pr_draft: draft, data_models: declared, data_models_reason: why }) => {
        // a stopped pull this worker resolved lands as it hands it over, without the owner
        const resolving = landedOf(self.o.board.row(cardId))?.resolve;
        if (resolving) return self.landResolved(cardId, resolving);
        type Demo = { kind?: DemoKind; dir: string; chapters?: string[]; question?: { text: string } & Omit<Asked, 'question'>; page?: DemoPage; follows?: 'replaces' | 'supplements' };
        const given = demo as Demo | undefined;
        // whether the branch holds work and decides where it lands, which git tells without blocking the server
        // a review card hands over the PR's head it reviewed, which is all Seismic ever merges
        // with the commits of its own on top of the PR's head, which Seismic pushes on the owner's approval
        const handOverWork = (d: Demo | undefined, named: CardFile[] | undefined, shows: boolean): Promise<string> =>
          review
            ? self.ownCommits(cardId, review).then((mine) => (typeof mine === 'string' ? mine : handOverNow(d, named, shows, true, undefined, mine)))
            : Promise.all([self.o.workstations.hasWork(cardId), self.landingOf(cardId)]).then(async ([work, { own }]) =>
                handOverNow(
                  d,
                  named,
                  shows,
                  work,
                  own,
                  undefined,
                  work && !self.folder ? await self.o.workstations.changedFiles(cardId) : undefined,
                  // what the branch shows of a data-model change, unless the worker says it has one
                  work && !self.folder && declared !== 'changed' && self.artifacts().includes('schema') ? dataModelSignals((await self.o.workstations.diff(cardId, true))?.patch ?? '') : [],
                ),
              );
        const handOverNow = (
          d: Demo | undefined,
          named: CardFile[] | undefined,
          shows: boolean,
          work: boolean,
          own: CardLanding | undefined,
          mine?: OwnCommits,
          changed?: string[],
          signals: DataSignal[] = [],
        ): string => {
          // reading what the change shows takes a while, in which the owner may stop or replace the session
          if (self.live.get(cardId) !== live && !live.standIn) return 'This session has ended. Stop working and end your turn.';
          const s = clip(String(summary), 6000);
          const row = self.o.board.row(cardId);
          if (row.landed) return 'Not handed over: your work is on main already.';
          if (row.review?.pr && !review) return 'Not handed over: the work is in its pull request, where Seismic follows it.';
          const checked = results as { checks: { name: string; passed: boolean }[]; mergeable: boolean } | undefined;
          if (review && !checked) return "Not handed over: a review card's handover says what the checks and the merge probe found (review). Call ready_for_review again with it.";
          if (review && !contributionOf(row)?.findings) return 'Not handed over: record your findings first (findings; an empty list where your review found nothing), then call ready_for_review again.';
          const owed = self.owedTasks(cardId);
          if (owed) return `Not handed over: first make the follow-up tasks the owner chose, for ${owed}; then call ready_for_review again.`;
          // what goes onto the PR with the owner's approval: the worker's own commits and their text, with the requests to the contributor decided meanwhile
          const held = review && mine ? self.heldAt(cardId, mine, typeof draft === 'string' ? draft : undefined) : undefined;
          if (typeof held === 'string') return held;
          // approved work that could not land comes back to be landed, not reviewed: its demo stands
          const approved = !!row.approved_at;
          // a handover in answer to the owner's words that brings no new demo is an answer to them, not a demo to watch
          const answered = !d && !!row.detail && !!(JSON.parse(row.detail) as { answering?: boolean }).answering;
          // without a new demo, the one on the card stands, unless it only came with a question
          const asked = !!row.demo?.latest?.asked;
          const kept = !d && !!row.demo?.latest && !asked;
          // in a folder without git the card's change list shows what changed, where often nothing can be shown on screen
          if (!d && !kept && !approved && !self.folder)
            return `Not handed over: every handover brings a demo${row.demo?.latest ? ' (the one you showed with your question is not one)' : ''}. Record it with ${self.demoSkill(cardId)}, or make an HTML artifact when the result is something to look at, then call ready_for_review again with it.`;
          const models = review || self.folder || approved || !self.artifacts().includes('schema') ? undefined : self.dataModels(cardId, declared, why, named, signals);
          if (models && 'refused' in models) return models.refused;
          let demoJson: string | undefined;
          if (d) {
            const allowed = self.artifacts();
            const kind = d.kind ?? (allowed.includes('video') ? 'video' : 'html');
            if (!allowed.includes(kind)) return `Not handed over: this repository's settings do not allow ${kind === 'video' ? 'a video' : 'an HTML artifact'} as a demo here. Hand over ${kind === 'video' ? "an HTML artifact (kind 'html')" : 'a video'} instead, then call ready_for_review again.`;
            // what the worker says of it beside the demo before, for the owner's buttons when the page shows that one
            const report = { ...(d.question?.text.trim() ? demoQuestion(d.question) : {}), ...(row.demo?.latest && (d.follows === 'replaces' || d.follows === 'supplements') ? { follows: d.follows } : {}) };
            const tags = vocabulary.length && d.page?.tags && typeof d.page.tags === 'object' ? (d.page.tags as PageTags) : undefined;
            const page =
              d.page && d.page.title.trim() && d.page.text.trim() ? { title: clip(d.page.title.trim(), 200), text: clip(d.page.text.trim(), 2000), ...(tags ? { tags: tagsOf(tags, Object.fromEntries(vocabulary)) } : {}) } : undefined;
            if (shares && !page)
              return 'Not handed over: a demo here needs its page (title and text) for colleagues, in case the owner shares it. Call ready_for_review again with demo.page.';
            if (vocabulary.length) {
              const wrong = tags ? outside(tags, Object.fromEntries(vocabulary)) : [];
              const lacking = vocabulary.filter(([dim]) => !tags?.[dim]).map(([dim]) => dim);
              if (wrong.length) return `Not handed over: the page's tags come from the site's alone, and these are not among them: ${wrong.join(', ')}. Call ready_for_review again with demo.page.tags from those its description gives.`;
              if (lacking.length) return `Not handed over: the page's tags lack ${lacking.join(', ')}. Give each dimension its values (an empty list where none fits), then call ready_for_review again.`;
            }
            if (kind === 'html') {
              const wrong = checkArtifact(d.dir);
              if (wrong) return `Not handed over: ${wrong}. Fix the artifact, then call ready_for_review again.`;
              // an artifact that is its index.html alone also goes out as one HTML file
              const single = artifactFiles(d.dir).length === 1;
              demoJson = JSON.stringify({ kind, dir: d.dir, chapters: [], ...report, ...(page ? { page } : {}), ...(single ? { single } : {}) });
            } else {
              const chapters = readChapters(d.dir, d.chapters ?? []);
              if (typeof chapters === 'string') return `Not handed over: ${chapters}. Fix the demo, then call ready_for_review again.`;
              demoJson = JSON.stringify({ kind, dir: d.dir, chapters, ...report, ...(page ? { page } : {}) });
            }
          }
          handOver();
          if (review && checked) {
            const now = contributionOf(self.o.board.row(cardId)) ?? review;
            const { requested: _, held: __, changing: ___, ...rest } = now;
            const results = { checks: checked.checks.slice(0, 20).map((c) => ({ name: clip(c.name, 60), passed: !!c.passed })), mergeable: !!checked.mergeable };
            const findings = held && rest.findings?.map((f) => (held.asks.includes(f.id) ? { ...f, withChanges: true as const } : f));
            self.o.board.work(cardId, {
              review: { contribution: { ...rest, reviewed: mine?.head, results, ...(held ? { held, ...(findings ? { findings } : {}) } : {}) } satisfies StoredContribution },
              ...(row.state === 'inPr' ? { state: 'working' } : {}),
            });
            // what the pull after the merge would run into on the local main, for the owner to see before approving
            void self.probeClash(cardId);
          }
          const report = self.report(cardId, s);
          const e = self.o.board.log(cardId, 'review', 'worker', s);
          // work in a git repository gets its code review where the project reviews work, whatever its landing; the forge's reviewers come after it
          if (!review && !approved) void self.reviews.handedOver(cardId, e.id, self.reviewModeOf(row, work));
          // the demo report's question goes with the handover it came with, also once a later one keeps the demo
          if (demoJson) demoJson = JSON.stringify({ ...(JSON.parse(demoJson) as object), handover: e.id, at: e.at });
          // the demo it replaces stays with the card, for the owner to go back to; so do a question's drafts, which are no handover's result
          const demos = (demoJson || asked) && row.demo?.latest ? self.earlier(cardId, row) : undefined;
          // approved work does not wait for the owner again: it stays with Seismic until its turn has ended
          self.o.board.work(cardId, {
            // the worker's last status line is about the work it hands over: it would show again once the card is at work
            ...(approved ? { status_line: self.o.board.t.worker.landing } : { state: 'waiting', need: d || kept ? 'demo' : 'review', status_line: null }),
            // approving work that changes nothing makes the card done, which the owner sees before approving; where work
            // lands that its own branch decides, likewise
            detail: JSON.stringify({
              summary: report,
              ...(work ? (own ? { lands: own } : {}) : { noChange: true }),
              ...(answered && !approved ? { answered: true } : {}),
              ...(models?.unchanged ? { modelsUnchanged: models.unchanged } : {}),
            }),
            demo: {
              ...(demoJson ? { latest: JSON.parse(demoJson) as StoredDemo } : asked ? { latest: null } : {}),
              ...(demos ? { earlier: demos } : {}),
              // the files named stand until a later handover names others (an empty list named clears them); a folder's card handed
              // over without a demo shows what it changed, while there are files of it to show
              ...(named?.length
                ? { files: named }
                : self.folder && !d && !kept && (named || !row.demo?.files?.length)
                  ? { files: shows ? [] : null }
                  : named
                    ? { files: null }
                    : {}),
            },
          });
          const card = self.o.board.item(cardId);
          if (card?.idea?.prototypeOf) self.o.onPrototype?.(card, report, demoJson);
          if (approved)
            return ending(
              'Recorded. End your turn now; once it has ended, Seismic lands your work on main.',
              'Recorded: once your turn has ended, Seismic lands your work on main.',
              'a change to the work is to be committed by then',
            );
          // what the owner's button does, as Seismic sees the branch: the worker may know of no commit on it but its own
          const lands =
            review || self.folder
              ? ''
              : !work
                ? ' Seismic sees no change on your branch: approving closes the card, and nothing lands.'
                : changed?.length
                  ? ` Approving lands your branch's change to ${changed.length === 1 ? '1 file' : `${changed.length} files`}: ${changed.slice(0, 8).join(', ')}${changed.length > 8 ? ', …' : ''}.`
                  : '';
          return ending(`${END_TURN}${lands}`, `Recorded: your handover waits for the owner's approval.${lands}`, 'if they change what you handed over, hand it over again');
        };
        // a demo made on another machine is served and shared from its copy here
        const handOverWith = (named?: CardFile[]): string | Promise<string> => {
          if (given && hostName(self.o.board.row(cardId).workstation))
            return self.demoHere(cardId, given.dir).then((here) =>
              'wrong' in here
                ? `Not handed over: the demo could not be copied to the owner's machine (${here.wrong}). Check the directory, then call ready_for_review again.`
                : handOverWork(
                    { ...given, dir: here.dir },
                    named?.map((f) => (f.dir === given.dir ? { ...f, dir: here.dir } : f)),
                    false,
                  ),
            );
          // in a folder, what the change has to show decides whether a handover without a demo shows it beside the conversation
          if (self.folder && !given) return self.showsFiles(cardId).then((shows) => handOverWork(given, named, shows));
          return handOverWork(given, named, false);
        };
        // the files named as the result, checked against what the card changed before anything is handed over
        if (files !== undefined)
          return self.namedFiles(cardId, files as { path: string; caption: string }[], given?.dir).then((named) =>
            typeof named === 'string'
              ? `Not handed over: ${named}. Name only files your card made or changed, or files in your demo's directory, then call ready_for_review again.`
              : handOverWith(named),
          );
        return handOverWith();
      },
    },
    {
      name: 'close_unchanged',
      description: `After the owner approved: your work changed nothing in the repository (no commits, nothing uncommitted), because the task needed no change to the code (a demo, an analysis, an answer). Then nothing lands and there is no pull request to open: this closes the card as done instead. Then end your turn.`,
      schema: {},
      run: async () => {
        const row = self.o.board.row(cardId);
        if (row.landed) return 'Not recorded: the card is finished already.';
        // a review card whose pull request was closed lands nothing, whatever its branch holds
        if (contributionOf(row)?.closed) return [`Recorded: the card is done.`, self.close(cardId, 'worker'), AFTER_LANDING].filter(Boolean).join(' ');
        const work = await self.o.workstations.hasWork(cardId);
        const pr = row.review?.pr ?? null;
        if (!row.approved_at && !(pr && !pr.url)) return 'Not recorded: only work the owner approved can be closed, and only before its pull request is open. Hand it over with ready_for_review first.';
        if (work)
          return 'Not recorded: your branch holds commits or uncommitted changes. Work that changes the repository lands (or goes out as a pull request); throw away what is not meant to land first, if nothing is.';
        const page = self.close(cardId, 'worker');
        return [`Recorded: the card is done.`, page, AFTER_LANDING].filter(Boolean).join(' ');
      },
    },
    {
      name: 'after_restart',
      description: 'Only after your work has landed and Seismic said it starts again for it: what remains needs Seismic to run your change. Then end your turn; Seismic tells you once it runs your change.',
      schema: {},
      run: () => {
        const l = landedOf(self.o.board.row(cardId));
        if (!l) return 'Not recorded: your work has not landed.';
        if (!l.restarts) return 'Not recorded: Seismic does not start again for this landing; what runs now is what you get.';
        self.o.board.work(cardId, { landed: JSON.stringify({ ...l, waits: true } satisfies LandedState) });
        self.o.board.log(cardId, 'activity', 'worker', self.o.board.t.worker.waitsForRestart);
        return ending('Recorded. End your turn now.', 'Recorded: Seismic tells you once it runs your change.');
      },
    },
    {
      name: 'snooze',
      description: [
        `Snooze while there is nothing to do until a point in time further off than a background command can wait (a check at midnight, a test that runs for days, a report on the 31st), or until another card on this project gets somewhere (its fix is on main, its demo is ready).`,
        `until: that time, ISO 8601 with your timezone's offset (2026-10-31T08:00:00+01:00). card: the title of the card to wait on; state: what it is to reach, 'done' (its work is on main, or it closed without a change; the default) or 'waits_for_owner' (it asks the owner or hands its work over). Give until, card or both: Seismic wakes you at whichever comes first, and also when that card can no longer get there (stopped, archived, removed).`,
        `why: what you do then, in a few words in ${language}, shown on the card. Your session ends with your turn, and whatever you still run in the background with it; workstation and branch stay. Seismic resumes this session then, or earlier with a note from the owner or whatever else comes for you (a review, the landing). For checkpoints one after the other, snooze to the next one each time you wake. Then end your turn.`,
      ].join(' '),
      schema: { until: z.string().optional(), why: z.string(), card: z.string().optional(), state: z.enum(['done', 'waits_for_owner']).optional() },
      run: ({ until, why, card: title, state }) => {
        const card = self.o.board.item(cardId);
        if (!card) return 'Not snoozed: the card is gone.';
        if (live.handedOver) return 'Not snoozed: you asked or handed over in this turn, so the card waits for the owner.';
        // taking in the owner's words on its handover, it may snooze as they ask (check again in three days): the handover stands meanwhile
        if (!(card.state === 'working' || card.state === 'inPr' || card.agent?.finishing || answering(card))) return 'Not snoozed: the card waits for the owner; their answer or approval comes as your next message.';
        if (isPausing(card)) return 'Not snoozed: the owner pauses you; end your turn, and once they let you go on, snooze then if it is still due.';
        const named = typeof until === 'string' && until.trim() !== '';
        const at = named ? Date.parse(String(until)) : NaN;
        if (named && Number.isNaN(at)) return 'Not snoozed: give the time as ISO 8601 with your timezone offset (2026-10-31T08:00:00+01:00).';
        if (named && at <= Date.now()) return `Not snoozed: that time has passed (it is ${new Date().toISOString()} now).`;
        if (named && at > Date.now() + SNOOZE_LIMIT) return 'Not snoozed: snooze for a year at most.';
        let on: Snooze['on'];
        if (typeof title === 'string' && title.trim()) {
          const found = self.cardTitled(cardId, title.trim());
          if (typeof found === 'string') return `Not snoozed: ${found}`;
          const awaits = state === 'waits_for_owner' ? 'waitsForOwner' : AWAITED_STATES[0];
          const now = awaited(found, awaits);
          if (now === 'reached') return `Not snoozed: the card “${found.title}” ${awaits === 'done' ? 'is done already' : 'waits for the owner already'}.`;
          if (now) return `Not snoozed: the card “${found.title}” cannot get there now (${now}).`;
          on = { card: found.id, title: found.title, state: awaits };
        } else if (!named) return 'Not snoozed: give until, card, or both.';
        const s: Snooze = { ...(named ? { until: new Date(at).toISOString() } : {}), ...(on ? { on } : {}), by: 'agent', ...(String(why).trim() ? { why: clip(String(why).trim(), 200) } : {}) };
        try {
          self.o.board.snooze(cardId, s);
        } catch (e) {
          if (e instanceof BadRequest && e.code === 'dependencyCycle') return 'Not snoozed: that card already waits for this one, directly or through another card.';
          throw e;
        }
        live.snoozed = true;
        live.nudged = false;
        return ending(
          `Snoozed until ${snoozedUntil(s)}. End your turn now; Seismic resumes this session then.`,
          `Snoozed until ${snoozedUntil(s)}: Seismic resumes this session then.`,
          'if they change what you wait for, snooze anew',
        );
      },
    },
    {
      name: 'app_running',
      description: `The app runs in your workstation and opens in a browser: its address as you open it (http://localhost:5173, say), so the owner can open it from the card to try it by hand while it runs. Again each time you start it anew or its address changes; an empty url once you stop it.`,
      schema: { url: z.string() },
      run: ({ url }) => {
        const u = String(url).trim();
        if (!u) {
          self.o.board.work(cardId, { app: null });
          return 'Recorded: the card no longer offers the app.';
        }
        if (!APP_URL.test(u)) return 'Not recorded: give the address as http(s)://host:port/….';
        self.o.board.work(cardId, { app: u });
        return 'Recorded: the card offers the app to the owner while it answers there.';
      },
    },
    ...(self.inWorktree(cardId)
      ? [
          {
            name: 'need_clone',
            description: "Only in a follow-up in a temporary worktree: answering the owner needs a full clone (the repository's app or tooling, which may not run here). Then end your turn; Seismic resumes you in the next free clone.",
            schema: {},
            run: () => {
              const l = landedOf(self.o.board.row(cardId));
              if (!l?.worktree) return 'Not recorded: you work in a full clone already.';
              self.o.board.work(cardId, { landed: JSON.stringify({ ...l, needsClone: true } satisfies LandedState) });
              self.o.board.log(cardId, 'activity', 'worker', self.o.board.t.worker.needsClone);
              return 'Recorded. Tell the owner with reply that you go on once a clone is free, then end your turn: Seismic resumes you in the next free clone.';
            },
          } satisfies AgentTool,
        ]
      : []),
    ...self.execLane(cardId, live),
    ...(self.o.toObeya
      ? [
          toObeyaTool((request) => {
            // what Seismic does or replies is shown to the owner as the answer to their words
            live.spoke = true;
            return self.o.toObeya!(cardId, request);
          }),
        ]
      : []),
  ]);
}
