import { expect, test } from 'bun:test';
import { claudeAlwaysRules, codexAlwaysRules, codexRulesAgain, ruleValue, shownRule, withAllowed } from './rules';
import { codexRules, plainCommands } from '../../server/allow-rules';

test('the rules are added to the allow list, what else the file holds kept; none new, nothing to write', () => {
  const before = JSON.stringify({ model: 'opus', permissions: { allow: ['Bash(bun test *)'], deny: ['Bash(rm *)'] } });
  expect(JSON.parse(withAllowed(before, ['Bash(bun run *)', 'Bash(bun test *)'])!)).toEqual({ model: 'opus', permissions: { allow: ['Bash(bun test *)', 'Bash(bun run *)'], deny: ['Bash(rm *)'] } });
  expect(withAllowed(before, ['Bash(bun test *)'])).toBeNull();
  expect(JSON.parse(withAllowed(undefined, ['WebFetch(domain:bun.sh)'])!)).toEqual({ permissions: { allow: ['WebFetch(domain:bun.sh)'] } });
  expect(() => withAllowed('[1]', ['Bash(ls)'])).toThrow('no JSON object');
});

test("a Codex command's rule: its proposed prefix, else a subcommand and what follows, else the command; the shell's setup is no rule", () => {
  const plain = (c: string) => plainCommands(['/bin/zsh', '-lc', c]);
  expect(codexAlwaysRules(plain('bun run lint --fix'))).toEqual(['Bash(bun run *)']);
  expect(codexAlwaysRules(plain('source ~/.nvm/nvm.sh && nvm use 24 && pnpm install --frozen-lockfile'))).toEqual(['Bash(pnpm install *)']);
  expect(codexAlwaysRules(plain('curl https://example.com'))).toEqual(['Bash(curl https://example.com)']);
  expect(codexAlwaysRules(plain('git push origin main'), ['git', 'push'])).toEqual(['Bash(git push *)']);
  expect(codexAlwaysRules(plain('make'))).toEqual(['Bash(make)']);
  expect(codexAlwaysRules(plain('ls | wc -l'))).toEqual([]);
});

test("Claude Code's suggestions give their allow rules, as the session takes them back", () => {
  const suggestions = [
    { type: 'addRules', behavior: 'allow', destination: 'localSettings', rules: [{ toolName: 'Bash', ruleContent: 'bun run:*' }, { toolName: 'WebSearch' }] },
    { type: 'addDirectories', directories: ['/x'], destination: 'session' },
    { type: 'setMode', mode: 'acceptEdits', destination: 'session' },
  ];
  expect(claudeAlwaysRules(suggestions)).toEqual(['Bash(bun run:*)', 'WebSearch']);
  expect(claudeAlwaysRules(undefined)).toEqual([]);
  expect(ruleValue('Bash(bun run:*)')).toEqual({ toolName: 'Bash', ruleContent: 'bun run:*' });
  expect(ruleValue('WebSearch')).toEqual({ toolName: 'WebSearch' });
  expect(shownRule('Bash(bun run:*)')).toBe('bun run *');
  expect(shownRule('WebFetch(domain:bun.sh)')).toBe('WebFetch(domain:bun.sh)');
});

test('the Codex rules are made again only where the file was made from the list', () => {
  const list = JSON.stringify({ permissions: { allow: ['Bash(bun test *)'] } });
  const made = codexRules(list).file;
  const legacy = '# Generated from .claude/settings.json by the `allow-list.ts --codex` of the skill `seismic:settings`; edit that file, not this one.\n';
  const updated = JSON.stringify({ permissions: { allow: ['Bash(bun test *)', 'Bash(bun run *)'] } });
  for (const before of [made, legacy]) {
    expect(codexRulesAgain(before, updated)).toBe(codexRules(updated).file);
  }
  expect(codexRulesAgain(`# Repository policy\n${legacy}prefix_rule(pattern=["ls"], decision="allow")\n`, list)).toBeNull();
  expect(codexRulesAgain(undefined, list)).toBeNull();
});
