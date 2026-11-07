// Renders the hero video (`demo.ts`) in the owner's ElevenLabs voice, without touching Seismic's own
// demo settings: a home of its own beside the output holds the voice settings, its voices directory
// is Seismic's (for Qwen3-TTS with `--qwen`). The key lies in `.voice/elevenlabs.key` of the main
// checkout, gitignored. `--qwen` renders in the owner's voice cloned by Qwen3-TTS instead (the
// reference `.voice/qwen-reference-en.wav` there), which costs no credits: for trying a change out,
// into `obeya-hero-qwen` in the demo directory (`~/demos` unless the demo settings name another).
// `--record` records the take's agents (real ones) into a directory, `obeya-hero-recording` there
// unless named; `--replay` plays such a recording back instead of
// running agents, the same take in minutes (the README says when which). Other arguments go on to
// the demo (`--narration`, `--dry`).
//
//   node scripts/hero-video/render.ts [--qwen] [--record [<dir>] | --replay [<dir>]] [--narration | --dry]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { demoDirectory } from '../../plugin/skills/demo/lib/settings.ts';

const VOICE = 'IErGHDQU4vPqicCi8dwR';
const qwen = process.argv.includes('--qwen');
/** The owner's demo directory: the take's own home below names it too, so its agents' demos go there. */
const DEMOS = demoDirectory();
const OUT = process.env.HERO_OUT ?? path.join(DEMOS, qwen ? 'obeya-hero-qwen' : 'obeya-hero');
const common = spawnSync('git', ['-C', import.meta.dirname, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).stdout.trim();
const voiceDir = path.join(path.dirname(common), '.voice');
const keyFile = path.join(voiceDir, 'elevenlabs.key');
const reference = path.join(voiceDir, 'qwen-reference-en.wav');
const needed = qwen ? reference : keyFile;
if (!fs.existsSync(needed)) {
  console.error(`missing ${needed}`);
  process.exit(1);
}

/** The directory after `--<flag>`, else the default recording, when the flag is given. */
const recording = (flag: string) => {
  const i = process.argv.indexOf(`--${flag}`);
  if (i < 0) return undefined;
  const given = process.argv[i + 1];
  return path.resolve(given && !given.startsWith('--') ? given : path.join(DEMOS, 'obeya-hero-recording'));
};
const record = recording('record');
const replay = recording('replay');
if (record && replay) {
  console.error('--record or --replay, not both');
  process.exit(1);
}
const own = new Set(['--qwen', '--record', '--replay', ...[record, replay].filter((d) => d !== undefined)]);

const home = path.join(OUT, 'home');
fs.mkdirSync(home, { recursive: true });
const settings = qwen
  ? { language: 'en', voice: 'qwen3', ownVoice: true, reference }
  : { language: 'en', voice: 'elevenlabs', ownVoice: true, voiceName: VOICE, keyFile };
fs.writeFileSync(path.join(home, 'demo.json'), JSON.stringify({ ...settings, directory: DEMOS }, null, 2));
const voices = path.join((process.env.SEISMIC_HOME ?? process.env.OBEYA_HOME) ?? path.join(os.homedir(), '.obeya'), 'voices');
if (fs.existsSync(voices) && !fs.existsSync(path.join(home, 'voices'))) fs.symlinkSync(voices, path.join(home, 'voices'));

const r = spawnSync('node', [path.join(import.meta.dirname, 'demo.ts'), ...process.argv.slice(2).filter((a) => !own.has(a) && !own.has(path.resolve(a)))], {
  stdio: 'inherit',
  env: { ...process.env, SEISMIC_HOME: home, OBEYA_HOME: home, HERO_OUT: OUT, DEMO_ELEVENLABS_MODEL: 'eleven_v4', ...(record ? { HERO_RECORD: record } : {}), ...(replay ? { HERO_REPLAY: replay } : {}) },
});
process.exit(r.status ?? 1);
