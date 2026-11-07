// Writes `.codex/rules/obeya.rules`, the Codex form of the allow list in `.claude/settings.json`
// (one list, two harnesses; `codexRules` in src/server/allow-rules.ts): `bun scripts/codex-rules.ts`; `--check` only tells whether the file
// is up to date. Codex reads such rules of a project it trusts (`[projects."<path>"]` in
// ~/.codex/config.toml; for Seismic's workers, once the owner trusts the repository's `.codex/`), takes a command inside `zsh -lc '…'` as the command it is, and asks
// for what no rule allows. A rule is a literal word prefix, so only a `Bash` rule that names its
// words (or ends in ` *` after them) fits; a rule with a `*` inside a path stays with Seismic, which
// applies the allow list to Codex workers itself (src/server/allow-rules.ts). A prefix also allows
// arguments after a rule that Claude Code reads as the exact command.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { codexRules as rulesFor } from '../src/server/allow-rules';

export { prefixOf } from '../src/server/allow-rules';
export const codexRules = (settingsText: string) => rulesFor(settingsText, '`bun scripts/codex-rules.ts`');

const root = resolve(import.meta.dir, '..');
const out = join(root, '.codex', 'rules', 'obeya.rules');

if (import.meta.main) {
  const { file } = codexRules(readFileSync(join(root, '.claude', 'settings.json'), 'utf8'));
  if (process.argv.includes('--check')) {
    const same = existsSync(out) && readFileSync(out, 'utf8') === file;
    console.log(same ? 'up to date' : `${out} is out of date: run bun scripts/codex-rules.ts`);
    process.exit(same ? 0 : 1);
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, file);
  console.log(`wrote ${out}`);
}
