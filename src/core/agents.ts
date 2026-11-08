// What the Agents sheet's "Working" tab lists: the cards whose agent is at work on its task, each in
// the stage of its lifecycle it is at. Planned, finished, queued and archived cards are not there
// (the queue has its own tab), nor ideas, proposals and cards that wait for the owner (the inbox).

import { demoStage, type Item } from './types';

/** The stages "Working" groups its cards by, in the order a card passes them. */
export const AGENT_STAGES = ['working', 'reviewing', 'fixing', 'demo'] as const;
export type AgentStage = (typeof AGENT_STAGES)[number];

type Staged = Pick<Item, 'kind' | 'state' | 'queue' | 'archivedAt' | 'doing' | 'codeReview'>;

/**
 * The stage the card's agent is at, or none for a card "Working" leaves out: its code review running,
 * its worker fixing the findings the owner gave it, recording its demo, or else at work.
 */
export function agentStage(i: Staged): AgentStage | undefined {
  if (i.kind !== 'task' || i.queue || i.archivedAt) return undefined;
  if (i.codeReview?.state === 'running') return 'reviewing';
  if (i.state !== 'working' && i.state !== 'approved' && i.state !== 'inPr') return undefined;
  if (i.doing && demoStage(i.doing)) return 'demo';
  if (i.codeReview?.findings?.some((f) => f.status === 'open' && f.decided === 'self')) return 'fixing';
  return 'working';
}

/** The cards at work by stage, in the order of `AGENT_STAGES`; a stage without a card is left out. */
export function byStage<T extends Staged>(items: T[]): { stage: AgentStage; items: T[] }[] {
  return AGENT_STAGES.map((stage) => ({ stage, items: items.filter((i) => agentStage(i) === stage) })).filter((g) => g.items.length);
}
