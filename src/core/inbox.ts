




import { handedOver, type Item, snoozeOf, type Talk, type Waiting, type Preference, type SettingProposal, type RepoRef } from './types';
import type { NeedsYou, NeedsYouKind } from './waits';

export interface InboxEntry {
  
  key: string;
  project: string;
  projectName: string;
  
  card?: Item;
  
  seismic?: Talk;
  preference?: Preference;
  setting?: SettingProposal;
  rules?: Preference[];
  repos?: RepoRef[];
  proposalItems?: Item[];
  
  text: string;
  
  row: NeedsYou;
  kind: NeedsYouKind;
  
  since: string;
  
  updated: number;
}

/** What a card waits for, in one line or a few. */
export function waitsFor(i: Item): string {
  if (i.idea?.superseded) return i.idea.superseded.why ?? '';
  if (i.state === 'proposal') return i.idea?.proposal?.questions?.[0]?.text ?? i.body;
  if (i.idea?.discussion && i.state === 'idea') return i.idea.discussion.questions[0]?.text ?? i.agent?.statusLine ?? '';
  if (handedOver(i)) return i.question?.text ?? i.review?.summary ?? i.agent?.statusLine ?? '';
  return i.question?.text ?? i.agent?.statusLine ?? '';
}

/**
 * Everything the owner decides on while the card waits, beyond the line `waitsFor` shows: the whole
 * question with its options, a proposal with its text and questions, a merge's comparison with what
 * it compared, an idea's reply, a handover with what approving it does (its code review's items, a
 * contribution's findings and held changes, a prototype's proposal to build on it), a withdrawal's
 * reason, the pull requests waiting for their merge. A change to any of it is a change to what waits
 * (`needs_you`'s `last_updated`, the read mark). Each part goes in whole but for what decides nothing:
 * where a merge sits and which attempt it is, an agent at work, a pull request's polled checks and review.
 */
export function decidedOn(i: Item): string {
  const p = i.idea?.proposal;
  const d = i.idea?.discussion;
  const r = i.review;
  const prs = [r?.pr, ...(r?.morePrs ?? [])].flatMap((x) => (x ? [{ ...x, waits: undefined, checks: undefined, review: undefined }] : []));
  return JSON.stringify([
    waitsFor(i),
    i.question ?? null,
    handedOver(i) ? [r?.summary, r?.noChange, r?.modelsUnchanged, r?.lands, r?.blocked, r?.contribution, r?.codeReview && { ...r.codeReview, agent: undefined }, i.idea?.buildProposal, i.demo?.latest?.handover] : null,
    i.state === 'proposal' || p?.merge ? [i.title, i.body, { ...p, revising: undefined, merge: p?.merge && { ...p.merge, origin: undefined, attempt: undefined } }] : null,
    i.idea?.superseded ?? null,
    d && i.state === 'idea' ? { ...d, thinking: undefined, buildAfterReply: undefined } : null,
    i.state === 'inPr' ? prs : null,
  ]);
}

/**
 * One project's entries, one for each of its open waits (`needs_you`, the snapshot's `needsYou`)
 * whose target this list has: none for a card the owner just acted on (`underway`), nor for an
 * answer read or left out meanwhile.
 */
function projectEntries(c: { id: string; name: string }, w: Waiting, underway: (id: string) => boolean): InboxEntry[] {
  const here = { project: c.id, projectName: c.name };
  const context = { rules: w.preferences ?? [], repos: w.project?.repos ?? [], proposalItems: w.proposalItems ?? w.items };
  const items = new Map(w.items.map((i) => [i.id, i]));
  return (w.needsYou ?? []).flatMap((row): InboxEntry[] => {
    const at = { row, kind: row.kind, since: new Date(row.createdAt).toISOString(), updated: row.lastUpdated };
    if (row.card != null) {
      const i = items.get(row.card);
      return i && !underway(i.id) ? [{ ...here, ...at, key: `${c.id}/${i.id}`, card: i, text: waitsFor(i) }] : [];
    }
    if (row.preference != null) {
      const p = w.preferences?.find((x) => x.id === row.preference && x.state === 'proposed');
      return p ? [{ ...here, ...context, ...at, key: `${c.id}/preference/${p.id}`, preference: p, text: p.text }] : [];
    }
    if (row.setting != null) {
      const p = w.settingProposals?.find((x) => x.id === row.setting);
      return p ? [{ ...here, ...context, ...at, key: `${c.id}/setting/${p.id}`, setting: p, text: p.basis }] : [];
    }
    const x = w.talk.find((t) => t.id === row.talk && t.unread);
    return x ? [{ ...here, ...at, key: `${c.id}/seismic`, seismic: x, text: x.answer ?? x.reply ?? x.question ?? x.said }] : [];
  });
}

/**
 * Every project's entries in one list, the one whose wait changed last first (`lastUpdated`: a new
 * question, a new summary, an agent's new reply); cards snoozed while they waited come at the end,
 * until they come back. The desktop's inbox, its "Needs you" sheet and the phone order alike. Ties
 * keep the projects' order and, within one, the order the waits began in.
 */
export function inboxEntries(projects: { id: string; name: string }[], waiting: Record<string, Waiting | undefined>, underway: (id: string) => boolean = () => false): InboxEntry[] {
  const all = projects.flatMap((c) => (waiting[c.id] ? projectEntries(c, waiting[c.id]!, underway) : []));
  
  return all
    .map((e, n) => ({ e, n, later: counted(e) ? 0 : 1 }))
    .sort((a, b) => a.later - b.later || b.e.updated - a.e.updated || a.n - b.n)
    .map((x) => x.e);
}

/** Whether the entry counts as waiting: a card snoozed while it waited is listed, but leaves the count until it comes back. */
export const counted = (e: InboxEntry) => !(e.card && snoozeOf(e.card));

/**
 * What marks the entry read: the entry and the wait it stands for, with what it waits for. A card
 * that waits anew or brings something new to decide while it waits (`decidedOn`: a new question, a
 * new summary, a revised proposal or merge comparison) and a newer
 * answer of Seismic's are unread again; a rule or setting proposal stays one wait until it is decided.
 */
export const readMark = (e: InboxEntry) => (e.preference || e.setting ? e.key : `${e.key}@${e.since}#${digest(e.card ? decidedOn(e.card) : e.text)}`);

/** A short digest of a text, to tell it changed without keeping it. */
export function digest(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * How many unread entries wait, on the project `project` (its count in the navigation) or on every
 * project (the inbox's); `read` tells the marks the owner has read.
 */
export const waitingCount = (entries: InboxEntry[], project?: string, read: (mark: string) => boolean = () => false) =>
  entries.filter((e) => counted(e) && !read(readMark(e)) && (!project || e.project === project)).length;

/**
 * How many cards wait for the owner on every project, read or not: the "Needs you" button's count.
 * Only cards: Seismic's answers and rule or setting proposals count in the inbox alone.
 */
export const needsYouCount = (entries: InboxEntry[]) => entries.filter((e) => e.card && counted(e)).length;
