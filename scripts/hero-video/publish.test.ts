import { afterAll, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// publish.ts in a checkout whose origin is a fork, against a fake gh on PATH that logs each call
// with the token and repository it got, and the first line of the files it was handed, so no release or workflow on
// GitHub is touched
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hero-publish-test-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
const checkout = path.join(dir, 'checkout');
fs.mkdirSync(path.join(checkout, 'scripts', 'hero-video'), { recursive: true });
fs.copyFileSync(path.join(import.meta.dirname, '..', 'gh.ts'), path.join(checkout, 'scripts', 'gh.ts'));
fs.copyFileSync(path.join(import.meta.dirname, 'publish.ts'), path.join(checkout, 'scripts', 'hero-video', 'publish.ts'));
Bun.spawnSync(['git', 'init', '-q', checkout]);
Bun.spawnSync(['git', '-C', checkout, 'remote', 'add', 'origin', 'git@github.com:alice/obeya.git']);
const out = path.join(dir, 'out');
fs.mkdirSync(out);
fs.writeFileSync(path.join(out, 'demo.mp4'), 'video');
fs.writeFileSync(path.join(out, 'captions.vtt'), 'WEBVTT');
const chapters = 'WEBVTT\n\n00:00:00.001 --> 00:00:20.099\nOne project\n\n00:00:20.099 --> 00:00:42.662\nYour wall\n\n00:00:42.662 --> 00:01:00.015\nThe agent starts\n';
fs.writeFileSync(path.join(out, 'chapters.vtt'), chapters);
const bin = path.join(dir, 'bin');
fs.mkdirSync(bin);
const log = path.join(dir, 'gh.log');
fs.writeFileSync(path.join(bin, 'gh'), `#!/bin/sh
echo "[$GH_TOKEN] [$GH_REPO] $*" >> "${log}"
for f in "$@"; do case "$f" in /*/hero.*) echo "$(basename "$f"): $(head -n 1 "$f")" >> "${log}";; esac; done
case "$1 $2" in
  "auth token") echo "token-of-$4";;
  "release view") exit $FAKE_RELEASE_MISSING;;
esac
`, { mode: 0o755 });
// ffmpeg cuts the README's loop from the video into the file it is given last
fs.writeFileSync(path.join(bin, 'ffmpeg'), `#!/bin/sh
for a in "$@"; do last="$a"; case "$a" in -ss|-to) next=1;; *) [ -n "$next" ] && echo "ffmpeg $prev $a" >> "${log}"; next=;; esac; prev="$a"; done
echo "loop" > "$last"
`, { mode: 0o755 });
// uv runs poster.py, which takes the poster from the video
fs.writeFileSync(path.join(bin, 'uv'), `#!/bin/sh
echo "uv $*" >> "${log}"
`, { mode: 0o755 });

function publish(releaseMissing: boolean, ...args: string[]) {
  fs.rmSync(log, { force: true });
  const r = Bun.spawnSync(['node', path.join(checkout, 'scripts', 'hero-video', 'publish.ts'), ...args], {
    env: { ...process.env, GH_TOKEN: 'from-the-shell', PATH: `${bin}${path.delimiter}${process.env.PATH}`, HERO_OUT: out, FAKE_RELEASE_MISSING: releaseMissing ? '1' : '0' },
  });
  expect(r.exitCode).toBe(0);
  return fs.readFileSync(log, 'utf8').replaceAll(/\/\S*\/hero\./g, 'hero.').replaceAll(/\/\S*\/(?=[\w-]+\.(py|mp4|jpg))/g, '').trim().split('\n');
}

test.skipIf(process.platform === 'win32')('replaces the assets of the release, then runs the Pages workflow, on the origin as its owner', () => {
  expect(publish(false)).toEqual([
    '[] [] auth token --user alice',
    'ffmpeg -ss 23.099',
    'ffmpeg -to 48.162',
    '[token-of-alice] [alice/obeya] release view site-media',
    '[token-of-alice] [alice/obeya] release upload site-media hero.mp4 hero.vtt hero.chapters.vtt hero.loop.gif --clobber',
    'hero.mp4: video',
    'hero.vtt: WEBVTT',
    'hero.chapters.vtt: WEBVTT',
    'hero.loop.gif: loop',
    '[token-of-alice] [alice/obeya] workflow run pages.yml',
  ]);
});

test.skipIf(process.platform === 'win32')('creates the release when it is missing', () => {
  const calls = publish(true);
  expect(calls[4]).toStartWith('[token-of-alice] [alice/obeya] release create site-media hero.mp4 hero.vtt hero.chapters.vtt hero.loop.gif --title Site media');
  // a pre-release, so that it never becomes the latest release, whose installers the README links
  expect(calls[4]).toEndWith('--prerelease --latest=false');
  expect(calls.at(-1)).toBe('[token-of-alice] [alice/obeya] workflow run pages.yml');
});

test.skipIf(process.platform === 'win32')('--poster-only takes the poster and uploads nothing', () => {
  expect(publish(false, '--poster-only')).toEqual(['uv run --with pillow python poster.py demo.mp4 hero-poster.jpg']);
});

test.skipIf(process.platform === 'win32')('names the scene the loop needs when the render has none of that name', () => {
  const other = path.join(dir, 'other');
  fs.mkdirSync(other);
  for (const f of ['demo.mp4', 'captions.vtt']) fs.copyFileSync(path.join(out, f), path.join(other, f));
  fs.writeFileSync(path.join(other, 'chapters.vtt'), chapters.replace('Your wall', 'The wall'));
  const r = Bun.spawnSync(['node', path.join(checkout, 'scripts', 'hero-video', 'publish.ts')], {
    env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, HERO_OUT: other },
  });
  expect(r.exitCode).toBe(1);
  expect(r.stderr.toString()).toContain('chapters.vtt has no scene "Your wall"');
});
