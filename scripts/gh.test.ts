import { afterAll, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { githubRepo } from './gh';




const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-test-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
const checkout = path.join(dir, 'checkout');
fs.mkdirSync(path.join(checkout, 'scripts'), { recursive: true });
fs.copyFileSync(path.join(import.meta.dirname, 'gh.ts'), path.join(checkout, 'scripts', 'gh.ts'));
Bun.spawnSync(['git', 'init', '-q', checkout]);
const bin = path.join(dir, 'bin');
fs.mkdirSync(bin);
const log = path.join(dir, 'gh.log');
fs.writeFileSync(path.join(bin, 'gh'), `#!/bin/sh
echo "[$GH_TOKEN] [$GH_REPO] $*" >> "${log}"
case "$1 $2" in
  "auth token") case " $FAKE_LOGINS " in *" $4 "*) echo "token-of-$4";; *) echo "no oauth token found for github.com account $4" >&2; exit 1;; esac;;
  "run rerun") cat; echo "rerun on stdout"; echo "rerun on stderr" >&2; exit 3;;
esac
`, { mode: 0o755 });

function gh(origin: string | null, args: string[], logins = 'sadilek alice') {
  Bun.spawnSync(['git', '-C', checkout, 'remote', 'remove', 'origin']);
  if (origin) Bun.spawnSync(['git', '-C', checkout, 'remote', 'add', 'origin', origin]);
  fs.rmSync(log, { force: true });
  const r = Bun.spawnSync(['bun', path.join(checkout, 'scripts', 'gh.ts'), ...args], {
    cwd: os.tmpdir(),
    env: { ...process.env, GH_TOKEN: 'from-the-shell', GITHUB_TOKEN: 'also-from-the-shell', PATH: `${bin}${path.delimiter}${process.env.PATH}`, FAKE_LOGINS: logins },
    stdin: Buffer.from('from stdin\n'),
  });
  const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : [];
  return { code: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString(), calls };
}

test('reads owner/name from the URLs GitHub hands out, and nothing else', () => {
  expect(githubRepo('git@github.com:sadilek/seismic.git\n')).toBe('sadilek/seismic');
  expect(githubRepo('https://github.com/alice/seismic.git')).toBe('alice/seismic');
  expect(githubRepo('https://github.com/alice/my.seismic')).toBe('alice/my.seismic');
  expect(githubRepo('ssh://git@github.com/alice/seismic.git')).toBe('alice/seismic');
  expect(githubRepo('https://x-access-token:abc@github.com/alice/seismic')).toBe('alice/seismic');
  expect(githubRepo('/Users/alice/dev/seismic')).toBeNull();
  expect(githubRepo('git@gitlab.com:alice/seismic.git')).toBeNull();
});

test.skipIf(process.platform === 'win32')('runs gh on the origin as its owner, not with the token from the shell', () => {
  expect(gh('git@github.com:sadilek/seismic.git', ['workflow', 'run', 'build.yml', '--ref', 'main', '-f', 'sign=true'])).toEqual({
    code: 0,
    stdout: '',
    stderr: '',
    calls: [
      '[] [] auth token --user sadilek',
      '[token-of-sadilek] [sadilek/seismic] workflow run build.yml --ref main -f sign=true',
    ],
  });
});

test.skipIf(process.platform === 'win32')('in a fork, on the fork as the fork\'s owner', () => {
  expect(gh('https://github.com/alice/seismic.git', ['run', 'list']).calls).toEqual([
    '[] [] auth token --user alice',
    '[token-of-alice] [alice/seismic] run list',
  ]);
});

test.skipIf(process.platform === 'win32')('without a login for the owner (an organisation), gh runs as it would anyway', () => {
  expect(gh('git@github.com:some-org/seismic.git', ['run', 'list']).calls).toEqual([
    '[] [] auth token --user some-org',
    '[from-the-shell] [some-org/seismic] run list',
  ]);
});

test.skipIf(process.platform === 'win32')('passes stdin, stdout, stderr and the exit code through', () => {
  const r = gh('git@github.com:sadilek/seismic.git', ['run', 'rerun', '123', '--failed']);
  expect(r.code).toBe(3);
  expect(r.stdout).toBe('from stdin\nrerun on stdout\n');
  expect(r.stderr).toBe('rerun on stderr\n');
});

test.skipIf(process.platform === 'win32')('leaves a repository named in the args to gh, which prefers it to GH_REPO', () => {
  expect(gh('git@github.com:sadilek/seismic.git', ['run', 'list', '--repo', 'someone/else']).calls[1]).toBe('[token-of-sadilek] [sadilek/seismic] run list --repo someone/else');
});

test.skipIf(process.platform === 'win32')('without a GitHub origin it says so and runs nothing', () => {
  for (const origin of [null, '/Users/alice/dev/seismic']) {
    const r = gh(origin, ['run', 'list']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('is no GitHub repository, which gh would run on');
    expect(r.calls).toEqual([]);
  }
});
