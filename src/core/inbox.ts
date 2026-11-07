// The owner's inbox: everything that waits for them, across every canvas, as one chronological list
// of entries. Built once from what each canvas has waiting, so the desktop's inbox and the phone's
// "Needs you" list the same entries. The phone puts the most recently updated first.

import { handedOver, type Item, needsYou, type Talk, type Waiting, type Preference, type SettingProposal, type RepoRef } from './types';

export interface InboxEntry {
  /** What the entry is known by in the list. */
  key: string;
  canvas: string;
  canvasName: string;
  /** The card that waits for the owner; absent for Seismic's answers waiting unread in its sheet. */
  card?: Item;
  /** Seismic's latest unread answer on that canvas. */
  obeya?: Talk;
  preference?: Preference;
  setting?: SettingProposal;
  rules?: Preference[];
  repos?: RepoRef[];
  proposalItems?: Item[];
  /** The question, the summary or whatever else it waits for (markdown for a card, plain for Seismic). */
  text: string;
  /** Since when it waits (ISO). */
  since: string;
}

/** What a card waits for, in one line or a few. */
export function waitsFor(i: Item): string {
  if (i.superseded) return i.superseded.why ?? '';
  if (i.state === 'proposal') return i.proposal?.questions?.[0]?.text ?? i.body;
  if (i.idea && i.state === 'idea') return i.idea.questions[0]?.text ?? i.statusLine ?? '';
  if (handedOver(i)) return i.question?.text ?? i.summary ?? i.statusLine ?? '';
  return i.question?.text ?? i.statusLine ?? '';
}

/** One canvas's entries: the cards that need the owner (none they just acted on, `underway`) and Seismic's latest unread answer. */
function canvasEntries(c: { id: string; name: string }, w: Waiting, underway: (id: string) => boolean, now: string): InboxEntry[] {
  const here = { canvas: c.id, canvasName: c.name };
  const cards = w.items.filter((i) => needsYou(i) && !underway(i.id));
  const out = cards.map((i): InboxEntry => ({ ...here, key: `${c.id}/${i.id}`, card: i, text: waitsFor(i), since: i.waitingSince ?? now }));
  const context = { rules: w.preferences ?? [], repos: w.canvas?.repos ?? [], proposalItems: w.proposalItems ?? w.items };
  for (const p of w.preferences ?? []) if (p.state === 'proposed') out.push({ ...here, ...context, key: `${c.id}/preference/${p.id}`, preference: p, text: p.text, since: now });
  for (const p of w.settingProposals ?? []) out.push({ ...here, ...context, key: `${c.id}/setting/${p.id}`, setting: p, text: p.basis, since: now });
  const last = w.talk.filter((x) => x.unread).at(-1);
  if (last) out.push({ ...here, key: `${c.id}/obeya`, obeya: last, text: last.answer ?? last.reply ?? last.question ?? last.said, since: last.at });
  return out;
}

/**
 * Every canvas's entries in one list, the one that has waited longest first; cards snoozed while they
 * waited come at the end, until they come back. The phone uses `updated` for newest changes first.
 * Ties keep the canvases' order and, within one, Tab's.
 */
export function inboxEntries(canvases: { id: string; name: string }[], waiting: Record<string, Waiting | undefined>, underway: (id: string) => boolean = () => false, order: 'waiting' | 'updated' = 'waiting'): InboxEntry[] {
  const now = new Date().toISOString();
  const all = canvases.flatMap((c) => (waiting[c.id] ? canvasEntries(c, waiting[c.id]!, underway, now) : []));
  // a stable sort: ties stay in the order built above
  return all
    .map((e, n) => ({ e, n, later: counted(e) ? 0 : 1, t: Date.parse(order === 'updated' ? (e.card?.updatedAt ?? e.card?.createdAt ?? e.since) : e.since) }))
    .sort((a, b) => a.later - b.later || (order === 'updated' ? b.t - a.t : a.t - b.t) || a.n - b.n)
    .map((x) => x.e);
}

/** Whether the entry counts as waiting: a card snoozed while it waited is listed, but leaves the count until it comes back. */
export const counted = (e: InboxEntry) => !e.card?.snoozed;

/**
 * What marks the entry read: the entry and the wait it stands for, with what it waits for. A card
 * that waits anew or asks something new while it waits (a new question, a new summary) and a newer
 * answer of Seismic's are unread again; a rule or setting proposal stays one wait until it is decided.
 */
export const readMark = (e: InboxEntry) => (e.preference || e.setting ? e.key : `${e.key}@${e.since}#${digest(e.text)}`);

/** A short digest of a text, to tell it changed without keeping it. */
function digest(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * How many unread entries wait, on the canvas `canvas` (its count in the navigation) or on every
 * canvas (the inbox's); `read` tells the marks the owner has read.
 */
export const waitingCount = (entries: InboxEntry[], canvas?: string, read: (mark: string) => boolean = () => false) =>
  entries.filter((e) => counted(e) && !read(readMark(e)) && (!canvas || e.canvas === canvas)).length;
