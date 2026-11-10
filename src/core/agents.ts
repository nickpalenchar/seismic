// The stage of its lifecycle a card is at, as the phone's "All" groups the project's cards and the
// desktop's Agent work sorts them into "Working" and "Todo". Finished, archived and parked cards (the
// "Parked" tab lists those), and ideas the owner has nothing to answer on, are at none.

import { type Item, needsYou, inParkingLot } from './types';

/** The stages "All" groups its cards by, in the order the tab shows them. */
export const AGENT_STAGES = ['needsYou', 'working', 'reviewing', 'fixing', 'landing', 'planned'] as const;
export type AgentStage = (typeof AGENT_STAGES)[number];

/**
 * The stage the card is at, or none for a card "All" leaves out: it needs the owner (taken out of
 * its own stage), its code review runs, its worker fixes the findings the owner gave it or is
 * otherwise at work (making its demo included, which the card's state line tells), its work is landing (approved, in a pull request), or it is
 * planned and not queued. A card the owner just acted on (`underway`, as the inbox leaves it out)
 * no longer needs them while the server catches up.
 */
export function agentStage(i: Item, underway = false): AgentStage | undefined {
  if (i.archivedAt || inParkingLot(i)) return undefined;
  if (needsYou(i) && !underway) return 'needsYou';
  if (i.kind !== 'task' || i.queue) return undefined;
  if (i.review?.codeReview?.state === 'running') return 'reviewing';
  if (i.review?.landing || i.review?.landingPosition !== undefined || i.state === 'approved' || i.state === 'inPr') return 'landing';
  if (i.state === 'planned') return 'planned';
  if (i.state !== 'working' && i.state !== 'waiting') return undefined;
  if (i.review?.codeReview?.items.some((r) => r.status === 'fixing')) return 'fixing';
  return 'working';
}

/** The stages Agent work's "Working" holds; "Todo" holds the queue and then the planned cards. */
const WORKING: readonly AgentStage[] = ['working', 'reviewing', 'fixing', 'landing'];

/**
 * Agent work's groups: the cards at work (working, code reviewing, review fixing, landing) in the
 * project's order, and the planned cards that are not queued. Cards that need the owner are in
 * neither: "Needs you" lists them.
 */
export function agentWork(items: Item[], underway: (id: string) => boolean = () => false): { working: Item[]; planned: Item[] } {
  const stage = (i: Item) => agentStage(i, underway(i.id));
  return { working: items.filter((i) => WORKING.includes(stage(i)!)), planned: items.filter((i) => stage(i) === 'planned') };
}
