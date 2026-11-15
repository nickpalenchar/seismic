import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { codexRules, prefixOf } from './codex-rules';

const root = join(import.meta.dir, '..');

test('a rule becomes a word prefix, unless a `*` stands inside a word', () => {
  expect(prefixOf('bun test *')).toEqual(['bun', 'test']);
  expect(prefixOf('bun run typecheck')).toEqual(['bun', 'run', 'typecheck']);
  expect(prefixOf('mkdir -p /tmp/obeya-*')).toBeNull();
  expect(prefixOf('node /x/obeya-*/demo.ts --dry')).toBeNull();
  expect(prefixOf('*')).toBeNull();
});

test('the committed Codex rules are the ones its allow list gives', () => {
  const { file, skipped } = codexRules(readFileSync(join(root, '.claude', 'settings.json'), 'utf8'));
  expect(readFileSync(join(root, '.codex', 'rules', 'obeya.rules'), 'utf8')).toBe(file);
  expect(skipped.length).toBeGreaterThan(0);
  expect(file).not.toContain('decision="prompt"');
});

test('the standalone writer and --check preserve repository-owned rules even without Claude settings', () => {
  const dir = mkdtempSync(join(tmpdir(), 'codex-rules-'));
  try {
    mkdirSync(join(dir, 'scripts'));
    const script = join(dir, 'scripts', 'codex-rules.ts');
    const source = readFileSync(join(root, 'scripts', 'codex-rules.ts'), 'utf8');
    writeFileSync(script, source.replaceAll("'../src/server/", `'${root.replaceAll('\\', '/')}/src/server/`));
    mkdirSync(join(dir, '.codex', 'rules'), { recursive: true });
    const out = join(dir, '.codex', 'rules', 'obeya.rules');
    const custom = '# Repository policy\nprefix_rule(pattern=["make","test"], decision="allow")\n';
    writeFileSync(out, custom);
    for (const args of [[], ['--check']]) {
      const result = Bun.spawnSync([process.execPath, script, ...args]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.toString()).toContain('repository-owned rules');
      expect(readFileSync(out, 'utf8')).toBe(custom);
    }
    mkdirSync(join(dir, '.claude'));
    writeFileSync(join(dir, '.claude', 'settings.json'), JSON.stringify({ permissions: { allow: ['Bash(bun test *)'] } }));
    const old = codexRules('{}').file;
    writeFileSync(out, old);
    expect(Bun.spawnSync([process.execPath, script, '--check']).exitCode).toBe(1);
    expect(readFileSync(out, 'utf8')).toBe(old);
    expect(Bun.spawnSync([process.execPath, script]).exitCode).toBe(0);
    expect(readFileSync(out, 'utf8')).toContain('pattern=["bun","test"]');
    expect(Bun.spawnSync([process.execPath, script, '--check']).exitCode).toBe(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
