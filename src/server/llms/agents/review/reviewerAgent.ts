/**
 * The code review agent: a read-only session of the role `review` that reads a card's diff against
 * main and records its verdicts, regressions and new items once, with the `review` tool. The
 * `CodeReviews` service (`workerSupervisor/codeReview.ts`) decides when it runs and what becomes of what it
 * records, and hands in the card's state as the context.
 */
import { z } from 'zod';
import { type AgentSetting, SEVERITIES } from '../../../../core/types';
import { clip } from '../../../../core/text';
import type { AgentTool } from '../../../runtime';
import type { Given, Recorded } from '../../../workerSupervisor/codeReview';
import { reviewResumed } from '../../prompts/reviewResumed';
import { reviewSystem } from '../../prompts/reviewSystem';
import { SeismicAgent } from '../seismicAgent';
import type { AgentPermission, SessionOptions } from '../types';

export interface ReviewerContext {
  /** The card's pinned harness, model and effort; none leaves it to the "Code reviews" group's. */
  setting: AgentSetting | undefined;
  /** The exact model an earlier session named, when retrying or resuming that run. */
  resolvedModel?: string;
  /** The language the findings are written in, with the owner's standing preferences' proviso. */
  language: string;
  /** The owner's standing preferences, added to the instructions. */
  preferences: string;
  /** The session goes on from an earlier run: its first message only reminds it. */
  resumed: boolean;
  card?: { title: string; body: string };
  /** What the card's worker handed over with. */
  summary?: string;
  files: { file: string; status: string; added: number; removed: number }[];
  truncated: boolean;
  /** The branch's diff against main, cut where the brief's limit is. */
  patch?: string;
  /** The card's review items as the brief lists them. */
  itemsText: string;
  /** How many new items a review takes at most, and the number the first of them gets. */
  maxNewItems: number;
  nextNumber: number;
  /** Takes what the agent recorded; why it is refused, else none. */
  record: (given: Recorded) => string | undefined;
}

export class ReviewerAgent extends SeismicAgent<ReviewerContext> {
  readonly role = 'review' as const;
  readonly name = 'review';
  readonly description = "Reviews a card's work: reads its diff and records graded findings.";

  getModel(ctx: ReviewerContext) {
    return ctx.setting;
  }

  override getPermissionMode(): AgentPermission {
    return 'readOnly';
  }

  getPrompt(ctx: ReviewerContext) {
    return [reviewSystem(ctx.language), ctx.preferences].filter(Boolean).join('\n\n');
  }

  override getBriefing(ctx: ReviewerContext) {
    if (ctx.resumed) return reviewResumed;
    const { card, summary: handoverSummary, files, truncated, patch, itemsText } = ctx;
    return [
      // the stable parts first (the task does not change between review rounds), the ones that change each round last
      `<card-title>${card?.title ?? ''}</card-title>`,
      card?.body ? `<task>\n${clip(card.body, 8000)}\n</task>` : '',
      handoverSummary ? `<handover-summary>\n${clip(handoverSummary, 8000)}\n</handover-summary>` : '',
      `<changed-files>\n${files.map((f) => `- ${f.file} (${f.status}, +${f.added} −${f.removed})`).join('\n')}\n</changed-files>`,
      patch ? `<diff against="main"${truncated ? ' truncated="true"' : ''}>\n${patch}\n</diff>` : '<diff against="main" empty="true">\nThe branch no longer changes anything against main: verify the items under review against the code as it is.\n</diff>',
      `<review-items>\n${itemsText}\n</review-items>`,
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  override getSessionOptions(ctx: ReviewerContext): SessionOptions {
    return ctx.resolvedModel ? { resolvedModel: ctx.resolvedModel } : {};
  }

  override getTools(ctx: ReviewerContext): AgentTool[] {
    return [
      {
      name: 'review',
      description: `Record your review, once, at the end. verdicts: one for each item your brief lists as under review (the worker says it fixed it): fixed true where the diff and the code now fix it, else false with why (the original problem of the item that is still there), which reopens it for the owner; a different flaw the fix introduced is a new item, not a reason for false. regressions: the items marked fixed whose problem the diff shows again, each with why. items: the new items you found that the list does not hold yet (an empty list where there is none; at most ${ctx.maxNewItems}, so keep the most important and merge or leave out the least), most severe first, each: title (short) and text (a sentence or two) in ${ctx.language}, saying what is wrong and why it matters; severity (blocker: crashes the app or exposes a very important secret or unprotected database; critical: a clear exploit, severe degradation or other major consequence; major: a real defect or clear departure from the repository's rules and design docs; minor: worth fixing but not a reason to hold the work; low: a small issue with limited impact; info: a nitpick or something to flag that may or may not be a problem), file and line where it is, security where it is about security, and with: the numbers of the other items one agent would sensibly fix in one go with it (the same cause, the same files), else none. The new items are numbered from ${ctx.nextNumber} in the order you give them, which is how with names them.`,
      schema: {
        verdicts: z.array(z.object({ number: z.number().int(), fixed: z.boolean(), why: z.string().optional() })),
        regressions: z.array(z.object({ number: z.number().int(), why: z.string() })),
        items: z.array(
          z.object({
            title: z.string(),
            text: z.string(),
            severity: z.enum(SEVERITIES),
            file: z.string().optional(),
            line: z.number().int().positive().optional(),
            security: z.boolean().optional(),
            with: z.array(z.number().int()).optional(),
          }),
        ),
      },
        run: (args) => {
          const given = { verdicts: (args.verdicts ?? []) as Recorded['verdicts'], regressions: (args.regressions ?? []) as Recorded['regressions'], items: (args.items ?? []) as Given[] };
          const wrong = ctx.record(given);
          if (wrong) return `Not recorded: ${wrong} Call review again with the whole review.`;
          return 'Recorded. End your turn now.';
        },
      },
    ];
  }
}

export const reviewerAgent = new ReviewerAgent();
