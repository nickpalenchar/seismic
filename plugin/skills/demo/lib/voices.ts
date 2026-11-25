














import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isMain, lib } from './here.ts';
import { type DemoSettings, demoSettingsHere, expandHome, type NarrationLanguage, seismicHome, referenceOf, SERVICES } from './settings.ts';
import { BUILT_IN_CLONES, DEFAULT_STYLE, QWEN3_SPEAKER, QWEN3_SPEAKERS, QWEN3_STOCK_SPEAKER, qwen3Speaker } from './voice-choices.ts';


export const PIPER_VOICES: Record<NarrationLanguage, string> = { en: 'en_US-ryan-high' };
const PIPER_BASE = 'https://huggingface.co/rhasspy/piper-voices/resolve/main';

export { QWEN3_SPEAKER };
/** A built-in clone's clip, as the demo skill ships it. */
export const builtInClip = (file: string) => lib('..', 'voices', file);




const QWEN3_EAR = 'onnx-asr[cpu,hub]';
/** Apple Silicon runs Qwen3-TTS on MLX; elsewhere it is PyTorch, in practice only with a GPU. */
export const onMlx = () => process.platform === 'darwin' && process.arch === 'arm64';
const qwen3Model = (clone: boolean) =>
  onMlx()
    ? `mlx-community/Qwen3-TTS-12Hz-1.7B-${clone ? 'Base' : 'CustomVoice'}-bf16`
    : `Qwen/Qwen3-TTS-12Hz-1.7B-${clone ? 'Base' : 'CustomVoice'}`;

export const SAY_VOICES: Record<NarrationLanguage, string> = { en: 'Samantha' };


export interface HeldVoice {
  reference?: string;
  speaker?: string;
  style?: string;
}


export type VoiceSpec =
  | {
      kind: 'command';
      
      argv?: string[];
      shell?: string;
      
      tag: string;
      
      heavy: boolean;
      



      respell?: boolean;
      



      lexicon?: string;
      




      serve?: string[];
      



      host?: HeldVoice;
    }
  | {
      kind: 'http';
      service: (typeof SERVICES)[number] | 'http';
      url?: string;
      voiceName?: string;
      
      style?: string;
      
      keyEnv: string;
      keyFile?: string;
    };


export interface Component {
  
  label: string;
  
  mb: number;
  installed: () => boolean;
  install: (log: (line: string) => void) => Promise<void>;
}

export const voicesHome = (home = seismicHome()) => path.join(home, 'voices');
const envPython = (dir: string) =>
  path.join(dir, 'env', process.platform === 'win32' ? 'Scripts' : 'bin', process.platform === 'win32' ? 'python.exe' : 'python');
const INSTALLED = '.seismic-installed';

const OLD_INSTALLED = '.obeya-installed';

function piperVoice(s: DemoSettings) {
  const name = s.voiceName || PIPER_VOICES[s.language];
  const [locale = '', ...rest] = name.split('-');
  const quality = rest.pop() ?? '';
  return { name, url: `${PIPER_BASE}/${locale.split('_')[0]}/${locale}/${rest.join('-')}/${quality}/${name}.onnx` };
}

/** Piper's Python and the voice file of these settings, as installed under Seismic's home. */
export function piperFiles(s: DemoSettings, home = seismicHome()) {
  const dir = path.join(voicesHome(home), 'piper');
  return { python: envPython(dir), onnx: path.join(dir, `${piperVoice(s).name}.onnx`) };
}

/** The Hugging Face cache, where Qwen3's models go (and where an earlier download already is). */
function hfHub() {
  if (process.env.HF_HUB_CACHE) return process.env.HF_HUB_CACHE;
  return path.join(process.env.HF_HOME || path.join(os.homedir(), '.cache', 'huggingface'), 'hub');
}

/** Whether a model is in the Hugging Face cache: its config and its weights (safetensors, or CTranslate2's `model.bin`). */
export function hfModelPresent(repo: string) {
  const snapshots = path.join(hfHub(), `models--${repo.replace('/', '--')}`, 'snapshots');
  if (!fs.existsSync(snapshots)) return false;
  return fs.readdirSync(snapshots).some((snap) => {
    const files = fs.readdirSync(path.join(snapshots, snap));
    return files.includes('config.json') && files.some((f) => f.endsWith('.safetensors') || f.endsWith('.onnx') || f === 'model.bin');
  });
}

/** Runs a program to its end, its output line by line into `log`; rejects with the last lines. */
function exec(cmd: string, args: string[], log: (line: string) => void, env?: Record<string, string>): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, ...(env ? { env: { ...process.env, ...env } } : {}) });
    const tail: string[] = [];
    const take = (b: Buffer) => {
      for (const line of b.toString().split(/\r?\n|\r/)) {
        if (!line.trim()) continue;
        log(line);
        tail.push(line);
        if (tail.length > 20) tail.shift();
      }
    };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    child.on('error', (e) => reject(new Error(`${cmd}: ${e.message}`)));
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args[0]} failed (${code}):\n${tail.join('\n')}`))));
  });
}

/**
 * A Python environment of its own, made by uv, with `packages` in it. One installed with fewer
 * packages than these is not installed: installing it again adds the ones it lacks.
 */
function pythonEnv(dir: string, packages: string[], label: string, mb: number): Component {
  const marker = path.join(dir, 'env', INSTALLED);
  const found = () => [marker, path.join(dir, 'env', OLD_INSTALLED)].find((f) => fs.existsSync(f));
  return {
    label,
    mb,
    installed: () => {
      const f = found();
      return !!f && packages.every((p) => fs.readFileSync(f, 'utf8').split(/\s+/).includes(p));
    },
    install: async (log) => {
      fs.mkdirSync(dir, { recursive: true });
      await exec('uv', ['venv', '--quiet', '--allow-existing', '--python', '3.12', path.join(dir, 'env')], log);
      await exec('uv', ['pip', 'install', '--python', envPython(dir), ...packages], log);
      fs.writeFileSync(path.join(dir, 'env', INSTALLED), `${packages.join(' ')}\n`);
    },
  };
}

async function download(url: string, file: string, log: (line: string) => void) {
  log(`downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`download failed (${res.status}): ${url}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.part`, Buffer.from(await res.arrayBuffer()));
  fs.renameSync(`${file}.part`, file);
}


const PART_WORDS: Record<NarrationLanguage, { piperVoice: (name: string) => string; model: (repo: string) => string }> = {
  en: { piperVoice: (name) => `Piper voice ${name}`, model: (repo) => `Model ${repo}` },
};

/** What the voice of these settings needs installed; empty for a voice that needs nothing from Seismic. */
export function components(s: DemoSettings, home = seismicHome()): Component[] {
  if (s.voice === 'piper') {
    const dir = path.join(voicesHome(home), 'piper');
    const voice = piperVoice(s);
    const { onnx } = piperFiles(s, home);
    return [
      pythonEnv(dir, ['piper-tts'], 'Piper', 150),
      {
        label: PART_WORDS[s.language].piperVoice(voice.name),
        mb: 115,
        installed: () => fs.existsSync(onnx) && fs.existsSync(`${onnx}.json`),
        install: async (log) => {
          await download(`${voice.url}.json`, `${onnx}.json`, log);
          await download(voice.url, onnx, log);
        },
      },
    ];
  }
  if (s.voice === 'qwen3') {
    const dir = path.join(voicesHome(home), 'qwen3');
    const repo = qwen3Model(!!cloneClip(qwen3Voice(s)));
    return [
      onMlx() ? pythonEnv(dir, ['mlx-audio', QWEN3_EAR], 'Qwen3-TTS (MLX)', 520) : pythonEnv(dir, ['qwen-tts', QWEN3_EAR], 'Qwen3-TTS (PyTorch)', 4070),
      {
        label: PART_WORDS[s.language].model(repo),
        mb: 4300,
        installed: () => hfModelPresent(repo),
        install: (log) =>
          exec(envPython(dir), ['-c', `from huggingface_hub import snapshot_download; snapshot_download(${JSON.stringify(repo)})`], log),
      },
    ];
  }
  return [];
}

/** Whether the voice can speak without installing anything more, and how much is missing. */
export function installState(s: DemoSettings, home = seismicHome()) {
  const missing = components(s, home).filter((c) => !c.installed());
  return { installed: !missing.length, missing: missing.map((c) => c.label), mb: missing.reduce((n, c) => n + c.mb, 0) };
}

/**
 * What keeps the voice of these settings from speaking that installing would not mend: a Qwen3
 * speaker the model does not have. For the agent and the settings sheet alike, in English.
 */
export function voiceProblem(s: DemoSettings): string | undefined {
  if (s.voice === 'qwen3' && !referenceOf(s) && s.voiceName && !qwen3Speaker(s.voiceName))
    return `Qwen3-TTS has no speaker "${s.voiceName}"; its speakers: ${QWEN3_SPEAKERS.join(', ')} (Seismic's settings, Configuration → Demos)`;
  return undefined;
}

/** Installs what the voice is missing, one part after the other. */
export async function installVoice(s: DemoSettings, log: (line: string) => void = () => {}, home = seismicHome()) {
  for (const c of components(s, home)) {
    if (c.installed()) continue;
    log(`installing ${c.label} (about ${c.mb} MB)`);
    await c.install(log);
  }
}

/**
 * Who speaks for Qwen3 in these settings: the owner's clip for the narration language, else the
 * speaker named (the default when none). A built-in clone stays a speaker name here, so a voice
 * Seismic holds for a worker on another machine is cloned from Seismic's own copy of its clip.
 */
export function qwen3Voice(s: DemoSettings): HeldVoice {
  const clip = referenceOf(s);
  if (clip) return { reference: expandHome(clip) };
  const speaker = (s.voiceName ? qwen3Speaker(s.voiceName) : QWEN3_SPEAKER) ?? s.voiceName ?? QWEN3_SPEAKER;
  return builtInFile(speaker) ? { speaker } : { speaker, style: s.style || DEFAULT_STYLE };
}

const builtInFile = (speaker: string | undefined) => (speaker ? BUILT_IN_CLONES[speaker as keyof typeof BUILT_IN_CLONES] : undefined);

/** The clip a Qwen3 voice clones, on this machine: the owner's, or a built-in speaker's; none for a stock speaker. */
export function cloneClip(voice: HeldVoice): string | undefined {
  const builtIn = builtInFile(voice.speaker);
  return voice.reference ?? (builtIn && builtInClip(builtIn));
}

/** `qwen3.py` for a clone of `reference`, a built-in clone or a stock `speaker`, before `--out` or `--serve`. */
function qwen3Command(voice: HeldVoice, language: NarrationLanguage, home: string) {
  const clip = cloneClip(voice);
  const who = clip
    ? ['--reference', clip]
    : ['--speaker', voice.speaker || QWEN3_STOCK_SPEAKER, ...(voice.style ? [`--instruct=${voice.style}`] : [])];
  return [envPython(path.join(voicesHome(home), 'qwen3')), lib('qwen3.py'), '--model', qwen3Model(!!clip), '--language', language, ...who];
}

/** The command Seismic holds a Qwen3 voice with across renders (`src/server/narration.ts`). */
export const qwen3Serve = (voice: HeldVoice, language: NarrationLanguage, home = seismicHome()) => [...qwen3Command(voice, language, home), '--serve'];

/** The spec `tts.py` synthesises the voice of these settings with. */
export function voiceSpec(s: DemoSettings, home = seismicHome()): VoiceSpec {
  const keyFile = s.keyFile ? expandHome(s.keyFile) : undefined;
  switch (s.voice) {
    case 'piper': {
      const { python, onnx } = piperFiles(s, home);
      return { kind: 'command', argv: [python, '-m', 'piper', '-m', onnx, '-f', '{out}'], tag: `piper|${piperVoice(s).name}`, heavy: false, respell: true };
    }
    case 'qwen3': {
      const voice = qwen3Voice(s);
      const reference = cloneClip(voice);
      const run = qwen3Command(voice, s.language, home);
      return {
        kind: 'command',
        argv: [...run, '--out', '{out}'],
        serve: [...run, '--serve'],
        host: voice,
        tag: `qwen3|${qwen3Model(!!reference)}|${voice.reference ?? (voice.style ? `${voice.speaker}|${voice.style}` : voice.speaker)}`,
        heavy: true,
        lexicon: 'qwen3',
      };
    }
    case 'say': {
      const voice = s.voiceName || SAY_VOICES[s.language];
      return { kind: 'command', argv: ['say', '-v', voice, '-o', '{out}', '--file-format=WAVE', '--data-format=LEI16@24000', '-f', '-'], tag: `say|${voice}`, heavy: false, respell: true };
    }
    case 'command':
      
      return { kind: 'command', shell: s.command ?? '', tag: `command|${s.command ?? ''}`, heavy: true };
    case 'http':
      return { kind: 'http', service: 'http', url: s.url, keyEnv: KEY_ENV.http, keyFile };
    default:
      return { kind: 'http', service: s.voice, url: s.url, voiceName: s.voiceName, style: s.style || DEFAULT_STYLE, keyEnv: KEY_ENV[s.voice], keyFile };
  }
}


export const KEY_ENV: Record<(typeof SERVICES)[number] | 'http', string> = {
  gemini: 'GEMINI_API_KEY',
  openai: 'OPENAI_API_KEY',
  elevenlabs: 'ELEVENLABS_API_KEY',
  azure: 'AZURE_SPEECH_KEY',
  http: 'DEMO_TTS_API_KEY',
};


export const SAMPLE_TEXT: Record<NarrationLanguage, string> = {
  en: 'This is how the voice sounds in a demo: the card now shows the link, and one click opens the page.',
};

/**
 * Synthesises one sample with `tts.py`, without listening back, into `out`: `text`, else
 * `SAMPLE_TEXT`. For the settings sheet, so the owner hears a voice before choosing it; with `seismicUrl`, Seismic holds a voice that
 * can stay loaded, so the next sample (and the next render) skips loading it. A heavy voice waits
 * for `lock`, the machine's TTS_LOCK unless a test gives its own.
 */
export function sample(s: DemoSettings, out: string, home = seismicHome(), seismicUrl?: string, lockFile = TTS_LOCK, text?: string): Promise<void> {
  const spec = voiceSpec(s, home);
  const specFile = `${out}.spec.json`;
  fs.writeFileSync(specFile, JSON.stringify(spec));
  const args = [...ttsArgs(spec, lockFile), '--sample', specFile, s.language, text?.trim() || SAMPLE_TEXT[s.language], out];
  return exec('uv', args, () => {}, seismicUrl ? { SEISMIC_URL: seismicUrl, OBEYA_URL: seismicUrl } : undefined).finally(() => fs.rmSync(specFile, { force: true }));
}

/**
 * `uv`'s arguments that run `tts.py` for `spec`, before its own. A voice that loads a large model
 * takes the machine's turn (`lockFile`); a hosted or light one does not, so rate-limit waits never
 * hold up a clone.
 */
export function ttsArgs(spec: VoiceSpec, lockFile = TTS_LOCK) {
  const lock = spec.kind === 'command' && spec.heavy ? ['--lock', lockFile] : [];
  return ['run', '--quiet', '--no-project', 'python', lib('tts.py'), ...lock];
}








export const TTS_LOCK = path.join(os.homedir(), '.cache', 'demo-skill', 'tts.lock');

if (isMain(import.meta.filename)) {
  const s = demoSettingsHere();
  const state = installState(s);
  const problem = voiceProblem(s);
  if (problem) console.log(`${s.voice}: ${problem}`);
  if (process.argv[2] === 'install') {
    await installVoice(s, (line) => console.log(line));
    console.log(`${s.voice}: installed`);
  } else {
    if (!problem) console.log(state.installed ? `${s.voice}: ready` : `${s.voice}: missing ${state.missing.join(', ')} (about ${state.mb} MB); run \`node voices.ts install\``);
  }
}
