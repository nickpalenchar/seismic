// "Always allow" (see README.md): a permission question offers the rule that would
// let the call through from now on, and picked, the rule goes into the repository's allow list.

// The core's modules this imports at once stay light ones: the registry loads it while the core's
// settings schema waits for it, so the git side comes in only once the owner picks the option.

import { plainCommands } from '../../server/allow-rules';
import { messageOf } from '../../core/text';
import type { PermissionContext, ServerExtension } from '../server';
import { claudeAlwaysRules, codexAlwaysRules, networkOnly, ruleValue, shownRule } from './rules';
import { inEvery, STRINGS } from './strings';

/**
 * The rules of the allow list that would let the call through from now on: for Claude those of
 * Claude Code's own suggestions; for Codex those of a plain command that asks for no more than
 * network. None where work goes through pull requests: nothing goes onto main by itself there.
 */
export function alwaysRules(request: { name: string; input: Record<string, unknown>; suggestions?: unknown }, context: Pick<PermissionContext, 'harness' | 'landsOnMain'>): string[] {
  if (!context.landsOnMain) return [];
  if (context.harness === 'claude') return claudeAlwaysRules(request.suggestions);
  const { command, kind, grantRoot } = request.input;
  const plain = request.name === 'Bash' && (kind == null || kind === 'command') && grantRoot == null && networkOnly(request.input);
  return plain ? codexAlwaysRules(plainCommands(command), request.input.proposedExecpolicyAmendment) : [];
}

export const alwaysAllow: ServerExtension = {
  permission: {
    options(request, context) {
      const rules = alwaysRules(request, context);
      if (!rules.length) return [];
      const shown = rules.map(shownRule);
      return [{ label: inEvery((s) => s.option(shown)), note: inEvery((s) => s.where), data: rules }];
    },
    picked(data, context) {
      const rules = Array.isArray(data) ? data.filter((r): r is string => typeof r === 'string') : [];
      if (!rules.length) return;
      const shown = rules.map(shownRule);
      const t = STRINGS[context.language];
      void context
        .asOwner(async ({ path, folder }): Promise<{ branch?: string } | null> => {
          const { commitAllowed, writeAllowed } = await import('./repository');
          return folder ? (writeAllowed(path, rules) ? {} : null) : commitAllowed(path, rules);
        })
        .then(
          (done) => {
            if (done) console.log(`Seismic: the owner allowed ${rules.join(', ')} for the agents of ${context.cwd}`);
            context.log(done ? t.added(shown, done.branch) : t.already(shown));
          },
          (e: unknown) => context.log(t.failed(shown, messageOf(e))),
        );
      // the asking Claude session takes the rules at once; Codex workers go by the list
      return context.harness === 'claude' ? { permissions: [{ type: 'addRules', rules: rules.map(ruleValue), behavior: 'allow', destination: 'session' }] } : undefined;
    },
  },
};
