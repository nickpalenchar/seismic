// What the Agents sheet's "All" tab lists: the project's cards in the stage of their lifecycle they
// are at, first those that need the owner, whatever their kind. Queued cards are in the "Queue" tab
// instead; finished, archived and parked cards (the "Parked" tab lists those), and ideas the owner has nothing to answer on, are not listed.

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
  if (i.codeReview?.state === 'running') return 'reviewing';
  if (i.landing || i.landingPosition !== undefined || i.state === 'approved' || i.state === 'inPr') return 'landing';
  if (i.state === 'planned') return 'planned';
  if (i.state !== 'working' && i.state !== 'waiting') return undefined;
  if (i.codeReview?.findings?.some((f) => f.status === 'open' && f.decided === 'self')) return 'fixing';
  return 'working';
}

/** The cards by stage, in the order of `AGENT_STAGES`; a stage without a card is left out. */
export function byStage(items: Item[], underway: (id: string) => boolean = () => false): { stage: AgentStage; items: Item[] }[] {
  return AGENT_STAGES.map((stage) => ({ stage, items: items.filter((i) => agentStage(i, underway(i.id)) === stage) })).filter((g) => g.items.length);
}
