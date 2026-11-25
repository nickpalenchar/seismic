













import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sitePaused } from '../distribution.ts';
import { ghEnv } from '../gh.ts';

const RELEASE = 'site-media';

const OUT = process.env.HERO_OUT ?? path.join((await import('../../plugin/skills/demo/lib/settings.ts')).demoDirectory(), 'seismic-hero');
const posterOnly = process.argv.includes('--poster-only');
const poster = posterOnly || process.argv.includes('--poster');




const LOOP = { from: ['Your wall', 3], until: ['The agent starts', 5.5], speed: 1.5, hold: 1.5, width: 1280, fps: 12 } as const;


function chapterStarts(vtt: string): Map<string, number> {
  const starts = new Map<string, number>();
  for (const m of vtt.matchAll(/^(?:(\d+):)?(\d+):(\d+(?:\.\d+)?) -->.*\r?\n(.+)$/gm)) {
    starts.set(m[4]!.trim(), Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]));
  }
  return starts;
}

function loopRange(vtt: string): [number, number] {
  const starts = chapterStarts(vtt);
  const at = ([title, offset]: readonly [string, number]) => {
    const start = starts.get(title);
    if (start === undefined) fail(`chapters.vtt has no scene "${title}" for the README's loop: name another in LOOP (publish.ts)`);
    return start + offset;
  };
  return [at(LOOP.from), at(LOOP.until)];
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv = process.env) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', env });
  if (r.status !== 0) fail(`${cmd} ${args.slice(0, 2).join(' ')} failed`);
}

const video = path.join(OUT, 'demo.mp4');
const captions = path.join(OUT, 'captions.vtt');
const chapters = path.join(OUT, 'chapters.vtt');
for (const f of [video, captions, chapters]) {
  if (!fs.existsSync(f)) fail(`missing ${f}: render first (scripts/hero-video/README.md)`);
}


const paused = sitePaused('Publishing the hero video');
if (paused && !posterOnly) fail(paused);

const root = path.join(import.meta.dirname, '..', '..');
if (poster) {
  console.log('Taking the poster from the new video');
  run('uv', ['run', '--with', 'pillow', 'python', path.join(import.meta.dirname, 'poster.py'), video,
    path.join(root, 'site', 'img', 'hero-poster.jpg')]);
}
if (posterOnly) {
  console.log('Took the poster and nothing went up: commit site/img/hero-poster.jpg.');
  process.exit(0);
}
const [loopFrom, loopUntil] = loopRange(fs.readFileSync(chapters, 'utf8'));

let repo: string, env: NodeJS.ProcessEnv;
try {
  ({ repo, env } = ghEnv());
} catch (e) {
  fail((e as Error).message);
}


const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hero-publish-'));
try {
  const files = [path.join(tmp, 'hero.mp4'), path.join(tmp, 'hero.vtt'), path.join(tmp, 'hero.chapters.vtt'), path.join(tmp, 'hero.loop.gif')] as const;
  fs.copyFileSync(video, files[0], fs.constants.COPYFILE_FICLONE);
  fs.copyFileSync(captions, files[1], fs.constants.COPYFILE_FICLONE);
  fs.copyFileSync(chapters, files[2], fs.constants.COPYFILE_FICLONE);
  console.log(`Cutting the README's loop from ${loopFrom.toFixed(1)} s to ${loopUntil.toFixed(1)} s`);
  run('ffmpeg', ['-v', 'error', '-y', '-ss', String(loopFrom), '-to', String(loopUntil), '-i', video, '-vf',
    `setpts=PTS/${LOOP.speed},tpad=stop_mode=clone:stop_duration=${LOOP.hold},fps=${LOOP.fps},scale=${LOOP.width}:-1:flags=lanczos,split[a][b];` +
    '[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle',
    '-loop', '0', files[3]]);
  const exists = spawnSync('gh', ['release', 'view', RELEASE], { env, stdio: 'ignore' }).status === 0;
  if (exists) {
    console.log(`Replacing hero.mp4, hero.vtt, hero.chapters.vtt and hero.loop.gif in the release ${RELEASE}`);
    run('gh', ['release', 'upload', RELEASE, ...files, '--clobber'], env);
  } else {
    console.log(`Creating the release ${RELEASE} with hero.mp4, hero.vtt, hero.chapters.vtt and hero.loop.gif`);
    run('gh', ['release', 'create', RELEASE, ...files, '--title', 'Site media',
      '--notes', 'Video for seismic.im, fetched by the Pages workflow.', '--prerelease', '--latest=false'], env);
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('Running the Pages workflow');
run('gh', ['workflow', 'run', 'pages.yml'], env);
console.log(`Published: https://github.com/${repo}/actions/workflows/pages.yml shows the run.`);
if (poster) console.log('The poster changed: commit site/img/hero-poster.jpg and push main, which publishes it.');
