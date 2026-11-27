








import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { codexRules } from '../src/server/allowRules';
import { isGeneratedCodexRules, writeCodexRules } from '../src/server/codexRulesFile';

export { codexRules, prefixOf } from '../src/server/allowRules';

const root = resolve(import.meta.dir, '..');
const out = join(root, '.codex', 'rules', 'seismic.rules');

if (import.meta.main) {
  if (existsSync(out) && !isGeneratedCodexRules(readFileSync(out, 'utf8'))) {
    console.log(`preserved ${out}: repository-owned rules; no generated rules ${process.argv.includes('--check') ? 'to check' : 'written'}`);
    process.exit(0);
  }
  const { file } = codexRules(readFileSync(join(root, '.claude', 'settings.json'), 'utf8'));
  if (process.argv.includes('--check')) {
    const same = existsSync(out) && readFileSync(out, 'utf8') === file;
    console.log(same ? 'up to date' : `${out} is out of date: run bun scripts/codex-rules.ts`);
    process.exit(same ? 0 : 1);
  }
  const result = writeCodexRules(out, file);
  console.log(result === 'wrote' ? `wrote ${out}` : `preserved ${out}: repository-owned rules; no generated rules written`);
}
