import { expect, test } from 'bun:test';
import { allowed, bashRules, codexRules, plainCommand, plainCommands } from './allow-rules';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, join } from 'node:path';

const rules = [
  'bun install',
  'bun test *',
  'bun run typecheck',
  'mkdir -p /tmp/obeya-*',
  'node /Users/nick/demos/obeya-*/demo.ts',
  'codex exec --sandbox read-only review --base main',
];
const zsh = (script: string) => `/bin/zsh -lc '${script}'`;
/** As Codex writes a script that holds quotes itself: in double quotes, with the quotes inside escaped. */
const zshq = (script: string) => `/bin/zsh -lc "${script.replace(/(["\\$`])/g, '\\$1')}"`;

test('rules are the Bash patterns of a settings file', () => {
  expect(bashRules(JSON.stringify({ permissions: { allow: ['Bash(bun install)', 'Read(x)', 'Bash(bun test *)', 5] } }))).toEqual(['bun install', 'bun test *']);
  expect(bashRules('not json')).toEqual([]);
  expect(bashRules('{}')).toEqual([]);
});

test('a plain command, wrapped in the shell Codex runs it in or not, is covered by its rule', () => {
  expect(allowed(rules, zsh('bun install'))).toBe(true);
  expect(allowed(rules, zsh('bun test src/server/board.test.ts --parallel'))).toBe(true);
  expect(allowed(rules, 'bun run typecheck')).toBe(true);
  expect(allowed(rules, ['/bin/zsh', '-lc', 'mkdir -p /tmp/obeya-demo'])).toBe(true);
  expect(allowed(rules, zsh('node /Users/nick/demos/obeya-x/demo.ts'))).toBe(true);
  expect(allowed(rules, zsh('codex exec --sandbox read-only review --base main'))).toBe(true);
});

test('what no rule covers is not allowed, and neither is a longer or shorter command', () => {
  expect(allowed(rules, zsh('bun install left-pad'))).toBe(false);
  expect(allowed(rules, zsh('bun run typecheck --watch'))).toBe(false);
  expect(allowed(rules, zsh('bun test'))).toBe(false);
  expect(allowed(rules, zsh('bunx test x'))).toBe(false);
  expect(allowed(rules, zsh('git push'))).toBe(false);
  expect(allowed([], zsh('bun install'))).toBe(false);
  expect(allowed(rules, undefined)).toBe(false);
});

test('shell syntax never rides on a rule', () => {
  for (const script of [
    'bun test x; rm -rf y',
    'bun test x && rm -rf y',
    'bun test x || true',
    'bun test x | tee out',
    'bun test x > /etc/passwd',
    'bun test $(rm -rf y)',
    'bun test `id`',
    'bun test "$HOME"',
    'bun test x\nrm -rf y',
    'bun test *.ts',
    'bun test ~root/x',
    'bun test x & ',
    'mkdir -p /tmp/obeya-x/../../etc/y',
    'node /Users/nick/demos/obeya-../../x/demo.ts',
  ]) expect([script, allowed(rules, zsh(script))]).toEqual([script, false]);
});

test('only one shell wrapper of the plain form counts', () => {
  expect(plainCommand("/bin/zsh -lc 'bun install'")).toBe('bun install');
  expect(plainCommand("/bin/zsh -lc 'bun install' extra")).toBeNull();
  expect(plainCommand("/bin/zsh -c 'bun install'")).toBe('bun install');
  expect(plainCommand("/bin/zsh -lc 'bun install")).toBeNull();
  expect(allowed(rules, "env FOO=1 /bin/zsh -lc 'bun install'")).toBe(false);
});

const more = [...rules, 'node /Users/nick/harness/obeya/plugin/skills/browser/lib/browser.ts start', 'node /Users/nick/harness/obeya/plugin/skills/browser/lib/browser.ts open *', 'node /Users/nick/harness/obeya/plugin/skills/browser/lib/browser.ts eval *'];
const browser = 'node /Users/nick/harness/obeya/plugin/skills/browser/lib/browser.ts';

test('a chain is covered where every part of it is', () => {
  expect(allowed(more, zshq(`${browser} start && ${browser} open 'http://127.0.0.1:4484/login?token=abc&next=%2F'`))).toBe(true);
  expect(allowed(more, zsh(`${browser} start; bun run typecheck\nbun install`))).toBe(true);
  expect(allowed(more, zshq(`${browser} eval "({pressed:document.querySelector('.x')?.getAttribute('aria-pressed')})"`))).toBe(true);
  // the very command Codex asked about: five calls in one script, quotes and parentheses inside its quotes
  expect(allowed(more, zshq(`${browser} start && ${browser} open 'http://127.0.0.1:4484/login?token=a&next=%2F%3Fc%3Ddemo' && ${browser} eval "({mode:document.querySelector('video')?.textTracks[0]?.mode})"`))).toBe(true);
  // an escaped dollar in the outer quotes is the script's own expansion
  expect(allowed(more, zshq(`${browser} eval "$HOME"`))).toBe(false);
  // one part no rule covers, or any other way of joining them
  expect(allowed(more, zsh(`${browser} start && git push`))).toBe(false);
  expect(allowed(more, zsh(`${browser} start || bun install`))).toBe(false);
  expect(allowed(more, zsh(`${browser} start | tee x`))).toBe(false);
  expect(allowed(more, zsh(`${browser} start & bun install`))).toBe(false);
  expect(allowed(more, zsh(`(${browser} start)`))).toBe(false);
  expect(allowed(more, zsh(`bun install && `))).toBe(true);
  expect(allowed(more, zsh(' && '))).toBe(false);
});

test('variables in front of a command and output to a temporary file do not hide what runs', () => {
  expect(allowed(rules, zsh('TMPDIR=/private/tmp/obeya-x bun test --parallel'))).toBe(true);
  expect(allowed(rules, zsh('TMPDIR=/private/tmp/obeya-x bun test --parallel > /private/tmp/obeya-x.log 2>&1'))).toBe(true);
  expect(allowed(rules, zsh('bun test a >> /tmp/obeya-x.log'))).toBe(true);
  expect(plainCommands(zsh('FOO=1 BAR=2 bun test a > /tmp/x.log 2>&1'))).toEqual(['bun test a']);
  // a variable that changes what a program is, a redirect to anywhere else, input, descriptors other than 1 and 2
  for (const script of [
    'PATH=/tmp/evil bun test a',
    'NODE_OPTIONS=--require=/tmp/x bun test a',
    'SEISMIC_HOME=/other bun test a',
    'SEISMIC_CODEX_SANDBOX=danger-full-access bun test a',
    'OBEYA_HOME=/other bun test a',
    'GIT_SSH_COMMAND=x bun test a',
    'bun test a > /etc/passwd',
    'bun test a > ~/x',
    'bun test a > /tmp/../etc/x',
    'bun test a > /tmp/x.log 2>&2',
    'bun test a < /tmp/in',
    'bun test a 3> /tmp/x',
    'bun test a > $HOME/x',
    'bun test "a > /etc/x" > /etc/y',
  ]) expect([script, allowed(rules, zsh(script))]).toEqual([script, false]);
  // `>` between quotes is an argument, not a redirect
  expect(allowed(rules, zsh('bun test "a > b"'))).toBe(true);
});

test('where the temporary directories are can be told', () => {
  expect(allowed(rules, zsh('bun test a > /var/scratch/x.log'), ['/var/scratch/'])).toBe(true);
  expect(allowed(rules, zsh('bun test a > /tmp/x.log'), ['/var/scratch/'])).toBe(false);
});

test('a rule and a command name the home directory by ~/ or in full alike; a ~ elsewhere is shell syntax', () => {
  const home = homedir();
  const nvm = ['source ~/.nvm/nvm.sh', 'pnpm install *'];
  expect(allowed(nvm, zsh('source ~/.nvm/nvm.sh && pnpm install --frozen-lockfile'))).toBe(true);
  expect(allowed(nvm, zsh(`source ${home}/.nvm/nvm.sh && pnpm install --frozen-lockfile`))).toBe(true);
  expect(allowed([`source ${home}/.nvm/nvm.sh`, 'pnpm install *'], zsh('source ~/.nvm/nvm.sh && pnpm install x'))).toBe(true);
  for (const script of ['bun test ~root/x', 'bun test a~/b', 'bun test ~']) expect([script, allowed(rules, zsh(script))]).toEqual([script, false]);
  // between quotes the shell keeps ~ as it is
  expect(plainCommands(zsh('bun test "~/x"'))).toEqual(['bun test ~/x']);
});

test('sourcing a file the agent cannot change and nvm use need no rule in front of covered commands', () => {
  const dir = mkdtempSync(join(homedir(), '.obeya-allow-test-'));
  const temp = mkdtempSync(join(tmpdir(), 'obeya-allow-test-'));
  try {
    const workspace = join(dir, 'workspace');
    const demos = join(dir, 'demos');
    for (const d of [workspace, demos]) mkdirSync(d);
    for (const f of [join(dir, 'nvm.sh'), join(dir, 'env.sh'), join(workspace, 'env.sh'), join(demos, 'env.sh'), join(temp, 'env.sh')]) writeFileSync(f, '');
    const nvm = `~/${basename(dir)}/nvm.sh`;
    const writable = [workspace, demos];
    const pnpm = ['pnpm -C * install *', 'pnpm -C * test'];
    const install = 'pnpm -C papercrane install --frozen-lockfile && pnpm -C extension install --frozen-lockfile';
    const ok = (script: string) => allowed(pnpm, zsh(script), undefined, writable);
    expect(ok(`source ${nvm} && nvm use 24 && ${install}`)).toBe(true);
    expect(ok(`. ${dir}/env.sh && nvm use --silent lts/iron && pnpm -C x test`)).toBe(true);
    expect(ok('nvm use && pnpm -C x test')).toBe(true);
    expect(ok('nvm use --lts && pnpm -C x test')).toBe(true);
    // a file the agent writes (its workspace, the demos, a temporary directory), relative, or through a link into one
    symlinkSync(join(workspace, 'evil.sh'), join(dir, 'link.sh'));
    for (const file of [`${workspace}/env.sh`, `${demos}/env.sh`, `${temp}/env.sh`, `${dir}/missing.sh`, 'env.sh', './env.sh', `${dir}/link.sh`, `${workspace}/../env.sh`])
      expect([file, ok(`source ${file} && pnpm -C x test`)]).toEqual([file, false]);
    // only in front, only with a covered command after it, nothing but setup
    for (const script of [
      `source ${nvm}`,
      `source ${nvm} && nvm use 24`,
      `source ${nvm} && rm -rf x`,
      `pnpm -C x test && source ${nvm} && pnpm -C x test`,
      `source ${nvm} extra && pnpm -C x test`,
      'nvm install 24 && pnpm -C x test',
      'nvm use 24 --delete-prefix && pnpm -C x test',
      'nvm use 24 20 && pnpm -C x test',
      'nvm use -s && pnpm -C x test',
      `NVM_DIR=${workspace} source ${nvm} && pnpm -C x test`,
      `source ${nvm} && NVM_DIR=${workspace} nvm use 24 && pnpm -C x test`,
    ]) expect([script, ok(script)]).toEqual([script, false]);
    // where it is not known what the agent writes, a source rides on no rule
    expect(allowed(pnpm, zsh(`source ${nvm} && pnpm -C x test`))).toBe(false);
    expect(allowed(pnpm, zsh('nvm use 24 && pnpm -C x test'))).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(temp, { recursive: true, force: true });
  }
});

test("Claude Code's older `prefix:*` rule covers the prefix alone or with more words, not a longer word", () => {
  const zsh = (c: string) => ['/bin/zsh', '-lc', c];
  expect(allowed(['bun run:*'], zsh('bun run'))).toBe(true);
  expect(allowed(['bun run:*'], zsh('bun run build --watch'))).toBe(true);
  expect(allowed(['bun run:*'], zsh('bun runner'))).toBe(false);
  expect(allowed(['bun run:*'], zsh('bun run x; rm -rf y'))).toBe(false);
  expect(codexRules(JSON.stringify({ permissions: { allow: ['Bash(bun run:*)'] } }), 'test').file).toContain('prefix_rule(pattern=["bun","run"], decision="allow")');
});
