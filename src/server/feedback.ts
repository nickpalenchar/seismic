// Whom the owner's response on a card's work credits: the sessions that actually ran on it, never today's defaults.
import { harnessChoice, type AgentEffort, type AgentSetting, type Attribution, type FeedbackAnswer, type WorkConfig } from '../core/types';

/** The longest comment kept, and how many facets of how long a response may carry. */
export const MAX_COMMENT = 4000;
const MAX_FACETS = 20;
const MAX_FACET = 200;

/**
 * The configuration a session ran on: its pinned setting, with the model it resolved to where it
 * named one (`resolved`). `guessed`: the setting was not pinned but taken from defaults (a legacy
 * session resumed), so only the harness is known.
 */
export function workConfig(setting: AgentSetting, resolved: string | undefined, guessed = false): WorkConfig {
  const harness = setting.harness ?? 'claude';
  const chosen = harness === 'claude' ? setting : harnessChoice(setting);
  const named = resolved && resolved !== 'default' ? resolved : undefined;
  // a Codex model chosen by name is the one it runs; a Claude alias is resolved by the session only
  const model = named ?? (harness !== 'claude' && chosen?.model && chosen.model !== 'default' ? chosen.model : undefined);
  return {
    harness,
    model: guessed ? (named ?? null) : (model ?? null),
    effort: guessed ? null : ((chosen?.effort as AgentEffort | undefined) ?? null),
    ...(!guessed && chosen?.model ? { requested: chosen.model } : {}),
  };
}

const same = (a: WorkConfig, b: WorkConfig) => a.harness === b.harness && a.model === b.model && a.effort === b.effort;

/**
 * Whom work done by `runs` (the earliest first) up to `until` credits: each distinct configuration
 * once, the earliest first. One that is unknown in a field differs from one that knows it: a run
 * whose model is unknown is not taken for the model another run named.
 */
export function attribute(runs: (WorkConfig & { at: string })[], until?: string): { attribution: Attribution; configs: WorkConfig[] } {
  const configs: WorkConfig[] = [];
  for (const { at, harness, model, effort, requested } of runs) {
    if (until && at > until) continue;
    const run: WorkConfig = { harness, model, effort, ...(requested ? { requested } : {}) };
    if (!configs.some((c) => same(c, run))) configs.push(run);
  }
  const known = configs.filter((c) => c.harness || c.model || c.effort);
  if (!known.length) return { attribution: 'missing', configs };
  return { attribution: configs.length === 1 ? 'single' : 'mixed', configs };
}

/** The answer and facets as given, checked; a message for the owner's client where they are not. */
export function checkedFeedback(input: unknown): { answer: FeedbackAnswer; facets?: Record<string, string>; handover?: number } | string {
  if (!input || typeof input !== 'object') return 'a response is an object';
  const { answer, facets, handover } = input as Record<string, unknown>;
  if (!answer || typeof answer !== 'object') return 'a response needs an answer';
  const { rating, comment, ...rest } = answer as Record<string, unknown>;
  if (Object.keys(rest).length) return `unknown parts of the answer: ${Object.keys(rest).join(', ')}`;
  if (rating !== undefined && (typeof rating !== 'number' || !Number.isFinite(rating))) return 'a rating is a number';
  if (comment !== undefined && typeof comment !== 'string') return 'a comment is text';
  const text = typeof comment === 'string' ? comment.trim() : '';
  if (text.length > MAX_COMMENT) return `a comment has at most ${MAX_COMMENT} characters`;
  if (rating === undefined && !text) return 'a response needs a rating or a comment';
  if (handover !== undefined && (typeof handover !== 'number' || !Number.isInteger(handover))) return 'a handover is the id of one';
  let kept: Record<string, string> | undefined;
  if (facets !== undefined && facets !== null) {
    if (typeof facets !== 'object' || Array.isArray(facets)) return 'facets are named texts';
    const entries = Object.entries(facets as Record<string, unknown>);
    if (entries.length > MAX_FACETS || entries.some(([k, v]) => typeof v !== 'string' || !k || k.length > MAX_FACET || v.length > MAX_FACET)) return 'facets are a few short named texts';
    if (entries.length) kept = Object.fromEntries(entries) as Record<string, string>;
  }
  return {
    answer: { ...(rating !== undefined ? { rating: rating as number } : {}), ...(text ? { comment: text } : {}) },
    ...(kept ? { facets: kept } : {}),
    ...(handover !== undefined ? { handover: handover as number } : {}),
  };
}
