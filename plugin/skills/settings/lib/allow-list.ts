// Shows the allow list of the repository in the working directory as it stands in the checkout
// (the `Bash` rules of `.claude/settings.json`, committed or not), the way Seismic applies it to its
// workers once the owner trusted it: which rules there are, which of them let through more than a
// command (a whole program, anything at all), and for each command given as an argument whether the
// list covers it. `--codex` also writes `.codex/rules/obeya.rules`, the list's form for Codex's own
// rule engine, for Codex run outside Seismic. Exits with 1 when the file does not read or a command
// given is not covered. Run with Bun (`bun allow-list.ts [--codex] ['<command>' …]`).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { allowed, bashRules, codexRules } from '../../../../src/server/allow-rules.ts';
import { repoInfo } from '../../../../src/server/repo.ts';

const SETTINGS = join('.claude', 'settings.json');
const CODEX_RULES = join('.codex', 'rules', 'obeya.rules');

/** Why `rule` lets through more than the commands it names, or null. */
function broad(rule: string): string | null {
  const words = rule.trim().split(/\s+/);
  if (words[0]!.includes('*')) return 'any program at all';
  if (words.length === 2 && words[1] === '*') return `anything ${words[0]} runs`;
  return null;
}

const repo = repoInfo(process.cwd());
const args = process.argv.slice(2);
const codex = args.includes('--codex');
const commands = args.filter((a) => a !== '--codex');
const file = join(repo.path, SETTINGS);
const text = existsSync(file) ? readFileSync(file, 'utf8') : null;
let problem = false;

if (text === null) console.log(`No ${SETTINGS} yet: no command runs without asking.`);
else {
  let parsed: { permissions?: { allow?: unknown } } | null = null;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    console.log(`${SETTINGS} does not read as JSON: ${(e as Error).message}`);
    process.exit(1);
  }
  const allow = parsed?.permissions?.allow;
  if (allow !== undefined && !Array.isArray(allow)) {
    console.log(`${SETTINGS}: permissions.allow is not a list`);
    process.exit(1);
  }
  const all = (allow ?? []) as unknown[];
  if (all.includes('Bash')) console.log('- "Bash" alone: every shell command runs without asking');
  const rules = bashRules(text);
  console.log(`${rules.length} Bash rule${rules.length === 1 ? '' : 's'} in ${SETTINGS}:`);
  for (const r of rules) {
    const why = broad(r);
    console.log(`  Bash(${r})${why ? `   <- broad: lets through ${why}` : ''}`);
  }
}

const rules = text ? bashRules(text) : [];
if (commands.length) {
  console.log('\nCommands:');
  for (const c of commands) {
    const ok = allowed(rules, c);
    if (!ok) problem = true;
    console.log(`  ${ok ? 'covered    ' : 'NOT covered'}  ${c}`);
  }
}

if (codex) {
  const { file: rulesFile, skipped } = codexRules(text ?? '{}', 'the `allow-list.ts --codex` of the skill `obeya:settings`');
  const out = join(repo.path, CODEX_RULES);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, rulesFile);
  console.log(`\nwrote ${CODEX_RULES}${skipped.length ? ` (${skipped.length} rule${skipped.length === 1 ? '' : 's'} with a * inside a word have no Codex form; Seismic applies them to its Codex workers itself)` : ''}`);
}

process.exit(problem ? 1 : 0);
