// The rules "Always allow" offers and how they go into the repository's allow list,
// the `permissions.allow` of its `.claude/settings.json` that Claude Code and Seismic's Codex workers
// both read, and into `.codex/rules/obeya.rules` where the repository has that generated from the
// list.

import { codexRules } from '../../server/allow-rules';

export const ALLOW_FILE = '.claude/settings.json';
export const CODEX_RULES_FILE = '.codex/rules/obeya.rules';

/**
 * A rule as the owner reads it on the button: a `Bash` rule as its command pattern, Claude Code's
 * older `prefix:*` as `prefix *`; any other tool's as it is (`WebFetch(domain:bun.sh)`).
 */
export function shownRule(rule: string): string {
  const bash = /^Bash\((.*)\)$/s.exec(rule)?.[1];
  return bash === undefined ? rule : bash.replace(/:\*$/, ' *');
}

/**
 * The text of a `.claude/settings.json` (`before`; none: there is none yet) with `rules` added to
 * its allow list, what else it holds as it was; null where every rule is in it already. Refused
 * (thrown) where the file holds no JSON object, so that nothing of it is lost.
 */
export function withAllowed(before: string | undefined, rules: string[]): string | null {
  let settings: Record<string, unknown> = {};
  if (before?.trim()) {
    const parsed: unknown = JSON.parse(before);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`${ALLOW_FILE} holds no JSON object`);
    settings = parsed as Record<string, unknown>;
  }
  const permissions = settings.permissions && typeof settings.permissions === 'object' && !Array.isArray(settings.permissions) ? (settings.permissions as Record<string, unknown>) : {};
  const allow: unknown[] = Array.isArray(permissions.allow) ? permissions.allow : [];
  const added = [...new Set(rules)].filter((r) => !allow.includes(r));
  if (!added.length) return null;
  settings.permissions = { ...permissions, allow: [...allow, ...added] };
  return `${JSON.stringify(settings, null, 2)}\n`;
}

/**
 * `.codex/rules/obeya.rules` made again from the allow list `settingsText`, where the file `before`
 * was made from it (its header names by what, which the new one names again); null where there is
 * none or it is the repository's own.
 */
export function codexRulesAgain(before: string | undefined, settingsText: string): string | null {
  const by = before && /^# Generated from \.claude\/settings\.json by (.+?); edit that file/m.exec(before)?.[1];
  return by ? codexRules(settingsText, by).file : null;
}

/**
 * The rules "Always allow" saves for a Codex command, given its plain commands (`plainCommands`;
 * none: it is not plain, and no rule could cover it): per program it runs (the shell's setup in
 * front left out), Codex's own proposed prefix where it gives one and the command starts with it,
 * else its first two words and whatever follows (`bun test *`) where the second is a subcommand,
 * else the command as it is.
 */
export function codexAlwaysRules(plain: string[] | null, proposed?: unknown): string[] {
  if (!plain?.length) return [];
  const prefix = Array.isArray(proposed) && proposed.length && proposed.every((w) => typeof w === 'string' && w && !/[\s*]/.test(w)) ? (proposed as string[]).join(' ') : undefined;
  const commands = plain.filter((c) => !/^(?:source|\.|nvm use)(?: |$)/.test(c));
  const rule = (c: string) => {
    if (prefix && (c === prefix || c.startsWith(`${prefix} `))) return `Bash(${prefix} *)`;
    const w = c.split(' ');
    return w.length > 2 && /^[a-z][\w:-]*$/i.test(w[1]!) ? `Bash(${w[0]} ${w[1]} *)` : `Bash(${c})`;
  };
  return [...new Set(commands.map(rule))];
}

/**
 * The rules of Claude Code's suggestions for a call it asks about (`canUseTool`'s `suggestions`)
 * that "Always allow" saves: those that add allow rules; a change of mode or of the directories
 * is no rule for the list.
 */
export function claudeAlwaysRules(suggestions: unknown): string[] {
  if (!Array.isArray(suggestions)) return [];
  const rules = suggestions.flatMap((s: { type?: unknown; behavior?: unknown; rules?: unknown }) =>
    s?.type === 'addRules' && s.behavior === 'allow' && Array.isArray(s.rules)
      ? (s.rules as { toolName?: unknown; ruleContent?: unknown }[]).flatMap((r) =>
          typeof r?.toolName === 'string' && r.toolName ? [typeof r.ruleContent === 'string' && r.ruleContent ? `${r.toolName}(${r.ruleContent})` : r.toolName] : [],
        )
      : [],
  );
  return [...new Set(rules)];
}

/** A rule of the allow list as Claude Code's session takes it (`PermissionRuleValue`). */
export function ruleValue(rule: string): { toolName: string; ruleContent?: string } {
  const m = /^([^()]+)\((.*)\)$/s.exec(rule);
  return m ? { toolName: m[1]!, ruleContent: m[2]! } : { toolName: rule };
}

/**
 * Whether a Codex approval asks for no more than its command and, at most, network for it, as the
 * core's `networkOnly` (runtime.ts) has it: a path grant or anything else rides on no rule.
 */
export function networkOnly(input: Record<string, unknown>): boolean {
  const extra = input.additionalPermissions;
  if (extra != null) {
    if (typeof extra !== 'object' || Array.isArray(extra)) return false;
    const { network, ...rest } = extra as Record<string, unknown>;
    if (Object.values(rest).some((v) => v != null)) return false;
    if (network != null && network !== true && !(typeof network === 'object' && Object.keys(network).length === 1 && (network as Record<string, unknown>).enabled === true)) return false;
  }
  const context = input.networkApprovalContext;
  return context == null || (typeof context === 'object' && typeof (context as Record<string, unknown>).host === 'string');
}
